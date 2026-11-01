import { Spherical, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp } from '../core/math';
import type { MoveAxes } from './KeyMove';

/** Seconds of inactivity before the idle spin resumes. */
const IDLE_RESUME_S = 6;
/** Keeps keyboard tilt short of the poles, where azimuth flips. */
const POLE_MARGIN = 0.05;

/**
 * Orbit camera around the planet: drag to rotate with inertia, wheel to zoom.
 * Rotation slows as you zoom in so the surface doesn't whip past. The camera
 * idly circles the globe until the player interacts.
 */
export class GlobeControls {
  readonly orbit: OrbitControls;
  private idle = 0;
  private interacting = false;
  private readonly spherical = new Spherical();

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
  ) {
    const orbit = new OrbitControls(camera, dom);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.enablePan = false;
    orbit.minDistance = 1.2;
    orbit.maxDistance = 6;
    orbit.zoomSpeed = 0.8;
    orbit.autoRotate = true;
    orbit.autoRotateSpeed = 0.35;
    orbit.addEventListener('start', () => {
      this.interacting = true;
      orbit.autoRotate = false;
    });
    orbit.addEventListener('end', () => {
      this.interacting = false;
      this.idle = 0;
    });
    this.orbit = orbit;
  }

  /** Swings the camera around the planet: W/S toward the poles, A/D east-west. */
  move(axes: MoveAxes, dtSeconds: number): void {
    if (!this.orbit.enabled || (axes.x === 0 && axes.y === 0)) return;
    this.orbit.autoRotate = false;
    this.idle = 0;
    const altitude = this.camera.position.length() - 1;
    const rate = clamp(altitude * 0.5, 0.06, 0.9) * dtSeconds;
    const s = this.spherical.setFromVector3(this.camera.position);
    s.theta += axes.x * rate;
    s.phi = clamp(s.phi - axes.y * rate, POLE_MARGIN, Math.PI - POLE_MARGIN);
    this.camera.position.setFromSpherical(s);
    this.camera.lookAt(this.orbit.target);
  }

  update(dtSeconds: number): void {
    const altitude = this.camera.position.length() - 1;
    this.orbit.rotateSpeed = clamp(altitude * 0.45, 0.04, 1);
    if (!this.interacting && !this.orbit.autoRotate) {
      this.idle += dtSeconds;
      if (this.idle > IDLE_RESUME_S) this.orbit.autoRotate = true;
    }
    this.orbit.update(dtSeconds);
  }

  dispose(): void {
    this.orbit.dispose();
  }
}
