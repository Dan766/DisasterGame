import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { FixedStepClock } from './core/clock';
import './ui/styles.css';

/** Region sim rate from DESIGN.md §4: 10 Hz fixed steps. */
const SIM_STEP_MS = 100;
const SPEEDS = [1, 10, 100, 1000] as const;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e17);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 1.2, 4);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x302010, 0.8));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 4, 2);
scene.add(sun);

// M0 placeholder: a spinning cube driven by the fixed-step sim, rendered with interpolation.
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 1.2, 1.2),
  new THREE.MeshStandardMaterial({ color: 0xff7a3d, flatShading: true }),
);
scene.add(cube);

const sim = { prevAngle: 0, angle: 0, ticks: 0 };
function simStep(dtSeconds: number) {
  sim.prevAngle = sim.angle;
  sim.angle += 0.8 * dtSeconds;
  sim.ticks++;
}

const clock = new FixedStepClock(SIM_STEP_MS);

const stats = new Stats();
stats.dom.style.cssText = 'position:absolute;top:0;left:0;';
hud.appendChild(stats.dom);

const status = document.createElement('div');
status.className = 'hud-status';
hud.appendChild(status);
function updateStatus() {
  const state = clock.paused ? 'paused' : `${clock.speed}×`;
  status.textContent = `sim ${state} · tick ${sim.ticks} · [space] pause · [1-4] speed`;
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
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  stats.begin();
  const steps = clock.advance(now - last);
  last = now;
  for (let i = 0; i < steps; i++) simStep(SIM_STEP_MS / 1000);

  const angle = THREE.MathUtils.lerp(sim.prevAngle, sim.angle, clock.alpha);
  cube.rotation.set(angle * 0.6, angle, 0);
  updateStatus();

  renderer.render(scene, camera);
  stats.end();
});
