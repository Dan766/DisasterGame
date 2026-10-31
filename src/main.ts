import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { FixedStepClock } from './core/clock';
import { GlobeControls } from './input/GlobeControls';
import { GlobePicker, type GlobePick } from './input/Picking';
import { DISPLACE_SCALE, GlobeView } from './render/globe/GlobeView';
import { ImpactFx } from './render/globe/ImpactFx';
import { ashOpacity } from './render/globe/surfaceTextures';
import { createStarfield } from './render/Starfield';
import { GlobeSim } from './sim/GlobeSim';
import { asteroidEffects, parseAsteroidParams } from './sim/disasters/asteroid';
import { DISASTERS } from './sim/disasters/registry';
import type { Params } from './sim/disasters/types';
import { generateGlobe } from './sim/gen/globe';
import { meanAsh } from './sim/systems/atmosphere';
import { cellAt, livingPopulation, type GlobalWorld } from './sim/world';
import { DisasterPanel } from './ui/DisasterPanel';
import { EventLog } from './ui/EventLog';
import { StatsPanel } from './ui/StatsPanel';
import { TimeControls } from './ui/TimeControls';
import { Tooltip } from './ui/Tooltip';
import { WorldPanel, randomSeed } from './ui/WorldPanel';
import './ui/styles.css';

/** Globe sim rate from DESIGN.md §4: one tick per game-day, 1 Hz at 1×. */
const GLOBE_STEP_MS = 1000;
/** A press that moves less than this (px) and is this short (ms) is a click, not a drag. */
const CLICK_SLOP_PX = 5;
const CLICK_MAX_MS = 450;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050a);
scene.add(createStarfield());

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
camera.position.set(0, 0.9, 3.2);

// --- World & sim -----------------------------------------------------------

function timedGenerate(seed: string): { world: GlobalWorld; ms: number } {
  const t0 = performance.now();
  const world = generateGlobe(seed);
  return { world, ms: performance.now() - t0 };
}

const initialSeed = new URLSearchParams(location.search).get('seed') || randomSeed();
const initial = timedGenerate(initialSeed);
let world = initial.world;
let sim = new GlobeSim(world);
const globe = new GlobeView(world);
scene.add(globe.root);
const fx = new ImpactFx();
scene.add(fx.root);

const clock = new FixedStepClock(GLOBE_STEP_MS);

// --- HUD -------------------------------------------------------------------

const worldPanel = new WorldPanel((seed) => {
  worldPanel.setBusy(true);
  // Let the "Generating…" state paint before the synchronous generation blocks.
  setTimeout(() => {
    const result = timedGenerate(seed);
    world = result.world;
    sim = new GlobeSim(world);
    globe.setWorld(world);
    fx.clear();
    eventLog.clear();
    worldPanel.showWorld(world, result.ms);
    worldPanel.setBusy(false);
    const url = new URL(location.href);
    url.searchParams.set('seed', seed);
    history.replaceState(null, '', url);
  }, 30);
});
worldPanel.showWorld(world, initial.ms);

const disasterPanel = new DisasterPanel(DISASTERS, () => updateTargeting());
const statsPanel = new StatsPanel();
const eventLog = new EventLog();
const timeControls = new TimeControls(clock);
const tooltip = new Tooltip();

const stats = new Stats();
stats.dom.style.cssText = 'position:absolute;bottom:12px;left:12px;';

hud.append(
  worldPanel.el,
  disasterPanel.el,
  statsPanel.el,
  eventLog.el,
  timeControls.el,
  tooltip.el,
  stats.dom,
);

// --- Input -----------------------------------------------------------------

const controls = new GlobeControls(camera, canvas);
const picker = new GlobePicker(
  globe.root,
  (lat, lon) => Math.max(world.elevation[cellAt(world, lat, lon)]!, 0) * DISPLACE_SCALE,
);

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.75, 1, 48),
  new THREE.MeshBasicMaterial({
    color: 0xff7a3d,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
reticle.visible = false;
scene.add(reticle);

const pointer = { x: 0, y: 0, inside: false, down: false, downX: 0, downY: 0, downAt: 0 };
let hover: GlobePick | null = null;

canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
});
canvas.addEventListener('pointerleave', () => (pointer.inside = false));
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  Object.assign(pointer, {
    down: true,
    downX: e.clientX,
    downY: e.clientY,
    downAt: performance.now(),
  });
});
window.addEventListener('pointerup', (e) => {
  if (!pointer.down) return;
  pointer.down = false;
  const moved = Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY);
  if (moved < CLICK_SLOP_PX && performance.now() - pointer.downAt < CLICK_MAX_MS) {
    handleClick(e.clientX, e.clientY);
  }
});

function handleClick(x: number, y: number) {
  const def = disasterPanel.selected;
  if (!def?.spawnGlobe) return;
  const hit = picker.pick(x, y, camera, canvas);
  if (!hit) return;
  launch(def.id, disasterPanel.currentParams, hit);
}

/** Plays the approach, then applies the strike to the sim the moment it lands. */
function launch(disaster: string, params: Params, hit: GlobePick) {
  const targetSim = sim;
  const effects = asteroidEffects(parseAsteroidParams(params));
  fx.launch({
    point: hit.point,
    angleDeg: Number(params.angleDeg ?? 90),
    energyMt: effects.megatons,
    onImpact: () => {
      if (targetSim !== sim) return; // world was regenerated mid-flight
      const event = sim.submit({
        type: 'spawn',
        disaster,
        params,
        target: { lat: hit.lat, lon: hit.lon },
      });
      if (!event) return;
      fx.detonate(hit.point, event.megatons, event.blastRadiusKm);
      globe.setCraters(world.craters);
      eventLog.add(event);
    },
  });
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') {
    timeControls.togglePause();
    e.preventDefault();
  } else if (e.key >= '1' && e.key <= '4') {
    timeControls.setSpeed(Number(e.key) - 1);
  } else if (e.key === 'Escape') {
    disasterPanel.select(null);
  }
});

function updateHover() {
  hover =
    pointer.inside && !pointer.down ? picker.pick(pointer.x, pointer.y, camera, canvas) : null;
  if (!hover) {
    tooltip.hide();
    reticle.visible = false;
  } else {
    tooltip.show(world, hover, pointer.x, pointer.y);
    const normal = hover.point.clone().normalize();
    reticle.position.copy(hover.point).addScaledVector(normal, 0.002);
    reticle.lookAt(hover.point.clone().add(normal));
    reticle.scale.setScalar(0.012 * camera.position.distanceTo(hover.point));
    reticle.visible = true;
  }
  updateTargeting();
}

/** Projects the selected disaster's reach onto the planet under the cursor. */
function updateTargeting() {
  const preview = disasterPanel.currentPreview;
  if (!hover || !preview) {
    globe.setTarget(null);
    return;
  }
  const radius = (kind: string) => preview.rings.find((r) => r.kind === kind)?.radiusKm ?? 0;
  globe.setTarget(hover.point, {
    crater: radius('crater'),
    blast: radius('blast'),
    thermal: radius('thermal'),
  });
}

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (w === 0 || h === 0) return; // minimized/collapsed: keep the last valid size
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Dev-only handle for poking at state from the browser console.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: {
      get world() {
        return world;
      },
      get sim() {
        return sim;
      },
      camera,
      controls,
      picker,
      globe,
      canvas,
      clock,
      launch,
    },
  });
}

// --- Loop ------------------------------------------------------------------

let last = performance.now();
let hudTimer = 0;
renderer.setAnimationLoop((now) => {
  stats.begin();
  const frameMs = now - last;
  last = now;
  const dt = Math.min(frameMs, 100) / 1000;

  const steps = clock.advance(frameMs);
  for (let i = 0; i < steps; i++) sim.step(1);
  globe.syncLayers(world, sim.dirty);
  Object.assign(sim.dirty, { terrain: false, effects: false, ash: false });

  fx.update(dt);
  globe.setShocks(fx.shockRings());
  globe.update(now / 1000);

  controls.update(dt);
  // Picking reads camera.matrixWorld, which render() would otherwise refresh only afterwards.
  camera.updateMatrixWorld();
  updateHover();
  fx.applyShake(camera);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    const sky = ashOpacity(meanAsh(world));
    globe.setAshOpacity(sky);
    globe.setLightsScale(livingPopulation(world) / world.stats.initialPopulation);
    statsPanel.update(world, sky);
  }
  timeControls.update(world.stats.simDays);

  renderer.render(scene, camera);
  stats.end();
});
