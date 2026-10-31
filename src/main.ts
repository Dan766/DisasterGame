import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { FixedStepClock } from './core/clock';
import { GlobeControls } from './input/GlobeControls';
import { GlobePicker, type GlobePick } from './input/Picking';
import { RegionControls } from './input/RegionControls';
import { DISPLACE_SCALE, GlobeView } from './render/globe/GlobeView';
import { ImpactFx } from './render/globe/ImpactFx';
import { ashOpacity } from './render/globe/surfaceTextures';
import { RegionFx } from './render/region/RegionFx';
import { RegionView } from './render/region/RegionView';
import { createStarfield } from './render/Starfield';
import { Transition, easeInCubic, easeInOutCubic, tween } from './render/Transition';
import { GlobeSim } from './sim/GlobeSim';
import { asteroidEffects, parseAsteroidParams } from './sim/disasters/asteroid';
import { DISASTERS } from './sim/disasters/registry';
import type { Params } from './sim/disasters/types';
import { generateGlobe } from './sim/gen/globe';
import { generateRegion, quantizeCenter } from './sim/gen/region';
import { RegionDeltaStore, regionId } from './sim/region';
import { applyPendingStrikes, captureDelta } from './sim/systems/persistence';
import { REGION_DT, REGION_TICK_HZ, RegionSim } from './sim/RegionSim';
import { meanAsh } from './sim/systems/atmosphere';
import { impactSpecFromKm } from './sim/systems/impact';
import { cellAt, livingPopulation, type GlobalWorld } from './sim/world';
import { DisasterPanel } from './ui/DisasterPanel';
import { EventLog } from './ui/EventLog';
import { RegionPanel } from './ui/RegionPanel';
import { StatsPanel } from './ui/StatsPanel';
import { SPEEDS, TimeControls } from './ui/TimeControls';
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
/** Region sim clock: 10 Hz at 1×, paused/sped up together with the globe clock. */
const regionClock = new FixedStepClock(1000 / REGION_TICK_HZ);
/** Region speed multiplier per time-control button (the globe's day/s rates make no sense here). */
const REGION_SPEEDS = [1, 2, 5, 10] as const;
let regionSim: RegionSim | null = null;

// --- Regional view ---------------------------------------------------------

type Mode = 'globe' | 'region';
let mode: Mode = 'globe';
const regionView = new RegionView();
const regionFx = new RegionFx();
regionView.scene.add(regionFx.group);
const regionDeltas = new RegionDeltaStore();
const regionCamera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
const regionControls = new RegionControls(
  regionCamera,
  canvas,
  (x, z) => regionView.heightAt(x, z),
  regionView.halfExtent,
);
const transition = new Transition();
document.body.append(transition.el);

// --- HUD -------------------------------------------------------------------

const worldPanel = new WorldPanel((seed) => {
  worldPanel.setBusy(true);
  // Let the "Generating…" state paint before the synchronous generation blocks.
  setTimeout(() => {
    const result = timedGenerate(seed);
    world = result.world;
    regionDeltas.clear();
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
const regionPanel = new RegionPanel(() => void exitRegion());

const stats = new Stats();
stats.dom.style.cssText = 'position:absolute;bottom:12px;left:12px;';

hud.append(
  worldPanel.el,
  disasterPanel.el,
  statsPanel.el,
  eventLog.el,
  timeControls.el,
  tooltip.el,
  regionPanel.el,
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
  if (mode === 'region') {
    const def = disasterPanel.selected;
    return def?.id === 'asteroid' && def.scales.includes('region')
      ? strikeRegionAt(x, y, disasterPanel.currentParams)
      : igniteAt(x, y);
  }
  if (mode !== 'globe' || transition.active) return;
  const def = disasterPanel.selected;
  if (!def?.spawnGlobe) return;
  const hit = picker.pick(x, y, camera, canvas);
  if (!hit) return;
  launch(def.id, disasterPanel.currentParams, hit);
}

/** Debug ignite (becomes the wildfire disaster in M5): click the terrain to start a fire. */
const igniteRay = new THREE.Raycaster();
function igniteAt(x: number, y: number) {
  if (!regionSim || transition.active) return;
  const rect = canvas.getBoundingClientRect();
  igniteRay.setFromCamera(
    new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    ),
    regionCamera,
  );
  const cell = regionView.pickCell(igniteRay.ray.origin, igniteRay.ray.direction);
  if (!cell) return;
  if (regionSim.ignite(cell.col, cell.row) > 0) {
    regionView.updateFire(regionSim.region, performance.now() / 1000);
  }
}

/** Region-scale asteroid: meteor streak, then the sim resolves the strike and the view reacts. */
function strikeRegionAt(x: number, y: number, params: Params) {
  const targetSim = regionSim;
  if (!targetSim || transition.active) return;
  const rect = canvas.getBoundingClientRect();
  igniteRay.setFromCamera(
    new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    ),
    regionCamera,
  );
  const cell = regionView.pickCell(igniteRay.ray.origin, igniteRay.ray.direction);
  if (!cell) return;
  const effects = asteroidEffects(parseAsteroidParams(params));
  const spec = impactSpecFromKm(cell.col, cell.row, effects);
  const half = regionView.halfExtent;
  const point = new THREE.Vector3(cell.col - half + 0.5, 0, cell.row - half + 0.5);
  point.y = regionView.heightAt(point.x, point.z);
  const size = Math.max(3, Math.min(40, spec.thermalRadiusCells * 0.5));
  regionFx.launch(point, Number(params.angleDeg ?? 90), Math.max(1.5, size * 0.25), () => {
    if (regionSim !== targetSim) return; // left the region mid-flight
    targetSim.impact(spec);
    const crater = targetSim.craters[targetSim.craters.length - 1];
    regionView.remeshTerrain(
      targetSim.region,
      crater ?? { col: cell.col, row: cell.row, radiusCells: spec.blastRadiusCells * 0.3 },
    );
    regionView.updateFire(targetSim.region, performance.now() / 1000);
    regionFx.detonate(point, size);
  });
}

// Double-click dives into the region (with a disaster armed, use Enter instead so
// the two clicks don't each launch one).
canvas.addEventListener('dblclick', (e) => {
  if (disasterPanel.selected) return;
  void enterRegionAt(picker.pick(e.clientX, e.clientY, camera, canvas));
});

/** Dives from the globe into a freshly generated region around a land point. */
async function enterRegionAt(hit: GlobePick | null): Promise<void> {
  if (mode !== 'globe' || transition.active || !hit) return;
  if (world.elevation[cellAt(world, hit.lat, hit.lon)]! < 0) return; // land only

  const savedPosition = camera.position.clone();
  returnPosition = savedPosition;
  const diveTo = hit.point.clone().multiplyScalar(1.03);
  const origin = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  controls.orbit.enabled = false;

  await transition.run({
    fadeOutMs: 600,
    fadeInMs: 700,
    before: (flash) =>
      tween(
        650,
        (t) => {
          camera.position.lerpVectors(savedPosition, diveTo, t);
          camera.lookAt(lookAt.lerpVectors(origin, hit.point, t));
          flash(Math.max(0, (t - 0.55) / 0.45));
        },
        easeInCubic,
      ),
    swap: () => {
      // Stored scars for this region id are replayed on top (empty until M4+).
      const center = quantizeCenter(hit.lat, hit.lon);
      const region = generateRegion(
        world,
        center.lat,
        center.lon,
        regionDeltas.get(regionId(center.lat, center.lon)),
      );
      // Globe strikes since the last visit land on the region now (crater, blast, fires).
      const caughtUp = applyPendingStrikes(
        region,
        regionDeltas.strikes,
        regionDeltas.get(region.id),
      );
      if (caughtUp) regionDeltas.set(region.id, caughtUp);
      regionView.show(region);
      regionView.updateFire(region, performance.now() / 1000);
      regionSim = new RegionSim(region);
      regionPanel.show(region);
      hud.classList.add('region-mode');
      mode = 'region';
      tooltip.hide();
      reticle.visible = false;
      globe.setTarget(null);
      regionControls.reset(regionView.centerHeight, 480, 0.2, 0.5);
    },
    after: async () => {
      const centerY = regionView.centerHeight;
      await tween(1400, (t) => {
        regionControls.reset(centerY, 480 + (170 - 480) * t, 0.2 + 0.4 * t, 0.5 + 0.45 * t);
      });
      regionControls.enabled = true;
    },
  });
}

let returnPosition: THREE.Vector3 | null = null;

/** Flies back out to the globe, restoring the camera it left from. */
async function exitRegion(): Promise<void> {
  if (mode !== 'region' || transition.active) return;
  const saved = returnPosition ?? new THREE.Vector3(0, 0.9, 3.2);
  regionControls.enabled = false;
  const startOffset = regionCamera.position.clone().sub(regionControls.orbit.target);
  const target = regionControls.orbit.target.clone();

  await transition.run({
    fadeOutMs: 500,
    fadeInMs: 700,
    before: (flash) =>
      tween(
        550,
        (t) => {
          regionCamera.position.copy(target).addScaledVector(startOffset, 1 + 2.2 * t);
          regionCamera.lookAt(target);
          flash(Math.max(0, (t - 0.4) / 0.6));
        },
        easeInCubic,
      ),
    swap: () => {
      mode = 'globe';
      hud.classList.remove('region-mode');
      regionPanel.hide();
      if (regionSim) {
        const id = regionSim.region.id;
        regionDeltas.set(id, captureDelta(regionSim.region, regionSim, regionDeltas.get(id)));
      }
      regionView.clear();
      regionFx.clear();
      regionView.scene.add(regionFx.group);
      regionSim = null;
      camera.position.copy(saved).setLength(1.15); // start close to the surface, settle out
      camera.lookAt(0, 0, 0);
    },
    after: async () => {
      const near = saved.clone().normalize().multiplyScalar(1.15);
      await tween(
        900,
        (t) => {
          camera.position.lerpVectors(near, saved, t);
          camera.lookAt(0, 0, 0);
        },
        easeInOutCubic,
      );
      controls.orbit.enabled = true;
      controls.orbit.update();
    },
  });
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
      regionDeltas.recordStrike({
        lat: event.lat,
        lon: event.lon,
        craterRadiusKm: event.airburst ? 0 : event.craterRadiusKm,
        blastRadiusKm: event.blastRadiusKm,
        thermalRadiusKm: event.thermalRadiusKm,
      });
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
    if (mode === 'region') void exitRegion();
    else disasterPanel.select(null);
  } else if (e.key === 'Enter' && mode === 'globe') {
    void enterRegionAt(hover);
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
  regionCamera.aspect = w / h;
  regionCamera.updateProjectionMatrix();
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
      enterRegionAt,
      exitRegion,
      get mode() {
        return mode;
      },
      regionView,
      regionCamera,
      get regionSim() {
        return regionSim;
      },
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

  // The globe only advances while viewed from orbit; the region has its own 10 Hz clock.
  if (mode === 'globe') {
    const steps = clock.advance(frameMs);
    for (let i = 0; i < steps; i++) sim.step(1);
  } else if (regionSim) {
    regionClock.paused = clock.paused;
    regionClock.speed = REGION_SPEEDS[Math.max(0, SPEEDS.indexOf(clock.speed as never))] ?? 1;
    const ticks = regionClock.advance(frameMs);
    for (let i = 0; i < ticks; i++) regionSim.step(REGION_DT);
    if (ticks > 0 || regionSim.lastFire.burning > 0)
      regionView.updateFire(regionSim.region, now / 1000);
  }
  globe.syncLayers(world, sim.dirty);
  Object.assign(sim.dirty, { terrain: false, effects: false, ash: false });

  fx.update(dt);
  globe.setShocks(fx.shockRings());
  globe.update(now / 1000);

  if (mode === 'globe') {
    if (controls.orbit.enabled) controls.update(dt);
    // Picking reads camera.matrixWorld, which render() would otherwise refresh only afterwards.
    camera.updateMatrixWorld();
    updateHover();
    fx.applyShake(camera);
  } else {
    regionControls.update(dt);
  }
  if (mode === 'region') {
    regionFx.update(dt, regionSim?.shockwaves ?? [], (x, z) => regionView.heightAt(x, z));
  }

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.25;
    const sky = ashOpacity(meanAsh(world));
    globe.setAshOpacity(sky);
    globe.setLightsScale(livingPopulation(world) / world.stats.initialPopulation);
    statsPanel.update(world, sky);
  }
  timeControls.update(world.stats.simDays);

  if (mode === 'region') {
    const shakeOffset = regionFx.shakeOffset(new THREE.Vector3()).multiplyScalar(6);
    regionCamera.position.add(shakeOffset);
    renderer.render(regionView.scene, regionCamera);
    regionCamera.position.sub(shakeOffset);
  } else renderer.render(scene, camera);
  stats.end();
});
