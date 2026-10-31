import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { FixedStepClock } from './core/clock';
import { GlobeControls } from './input/GlobeControls';
import { GlobePicker } from './input/Picking';
import { DISPLACE_SCALE, GlobeView } from './render/globe/GlobeView';
import { createStarfield } from './render/Starfield';
import { generateGlobe } from './sim/gen/globe';
import { cellAt, type GlobalWorld } from './sim/world';
import { Tooltip } from './ui/Tooltip';
import { WorldPanel, randomSeed } from './ui/WorldPanel';
import './ui/styles.css';

/** Globe sim rate from DESIGN.md §4: one tick per game-day, 1 Hz at 1×. */
const GLOBE_STEP_MS = 1000;
const SPEEDS = [1, 10, 100, 1000] as const;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050a);
scene.add(createStarfield());

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
camera.position.set(0, 0.9, 3.2);

// --- World -----------------------------------------------------------------

function timedGenerate(seed: string): { world: GlobalWorld; ms: number } {
  const t0 = performance.now();
  const world = generateGlobe(seed);
  return { world, ms: performance.now() - t0 };
}

const initialSeed = new URLSearchParams(location.search).get('seed') || randomSeed();
const initial = timedGenerate(initialSeed);
let world = initial.world;
const globe = new GlobeView(world);
scene.add(globe.root);

const panel = new WorldPanel((seed) => {
  panel.setBusy(true);
  // Let the "Generating…" state paint before the synchronous generation blocks.
  setTimeout(() => {
    const result = timedGenerate(seed);
    world = result.world;
    globe.setWorld(world);
    panel.showWorld(world, result.ms);
    panel.setBusy(false);
    const url = new URL(location.href);
    url.searchParams.set('seed', seed);
    history.replaceState(null, '', url);
  }, 30);
});
hud.appendChild(panel.el);
panel.showWorld(world, initial.ms);

// --- Input -----------------------------------------------------------------

const controls = new GlobeControls(camera, canvas);

const picker = new GlobePicker(
  globe.root,
  (lat, lon) => Math.max(world.elevation[cellAt(world, lat, lon)]!, 0) * DISPLACE_SCALE,
);
const tooltip = new Tooltip();
hud.appendChild(tooltip.el);

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

const pointer = { x: 0, y: 0, inside: false, dragging: false };
canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
});
canvas.addEventListener('pointerleave', () => (pointer.inside = false));
canvas.addEventListener('pointerdown', () => (pointer.dragging = true));
window.addEventListener('pointerup', () => (pointer.dragging = false));

function updateHover() {
  const hit =
    pointer.inside && !pointer.dragging ? picker.pick(pointer.x, pointer.y, camera, canvas) : null;
  if (!hit) {
    tooltip.hide();
    reticle.visible = false;
    return;
  }
  tooltip.show(world, hit, pointer.x, pointer.y);
  const normal = hit.point.clone().normalize();
  reticle.position.copy(hit.point).addScaledVector(normal, 0.002);
  reticle.lookAt(hit.point.clone().add(normal));
  reticle.scale.setScalar(0.012 * camera.position.distanceTo(hit.point));
  reticle.visible = true;
}

// --- Sim clock & HUD -------------------------------------------------------

const clock = new FixedStepClock(GLOBE_STEP_MS);

const stats = new Stats();
stats.dom.style.cssText = 'position:absolute;bottom:12px;right:12px;';
hud.appendChild(stats.dom);

const status = document.createElement('div');
status.className = 'hud-status';
hud.appendChild(status);
function updateStatus() {
  const state = clock.paused ? 'paused' : `${clock.speed}×`;
  status.textContent = `Day ${world.stats.simDays} · ${state} · [space] pause · [1-4] speed`;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    clock.paused = !clock.paused;
    e.preventDefault();
  } else if (e.key >= '1' && e.key <= '4') {
    clock.speed = SPEEDS[Number(e.key) - 1]!;
  }
});

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
      camera,
      controls,
      picker,
      globe,
      canvas,
    },
  });
}

// --- Loop ------------------------------------------------------------------

let last = performance.now();
renderer.setAnimationLoop((now) => {
  stats.begin();
  const frameMs = now - last;
  last = now;

  // Global systems (ash, climate) arrive in M2; for now a tick just advances the calendar.
  const steps = clock.advance(frameMs);
  world.stats.simDays += steps;

  controls.update(Math.min(frameMs, 100) / 1000);
  // Picking reads camera.matrixWorld, which render() would otherwise refresh only afterwards.
  camera.updateMatrixWorld();
  updateHover();
  updateStatus();

  renderer.render(scene, camera);
  stats.end();
});
