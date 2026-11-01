import type { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp } from '../core/math';
import type { MoveAxes } from './KeyMove';

/** Keeps the camera above the terrain by at least this many world units. */
const GROUND_CLEARANCE = 2.5;
/** Keyboard pan speed as a fraction of the camera distance per second. */
const KEY_PAN_RATE = 0.7;

/**
 * Orbit / pan / zoom camera for the regional diorama. Right-drag (or two
 * fingers) pans along the ground; the camera can never dip below the terrain
 * and the focus point stays inside the region.
 */
export class RegionControls {
  readonly orbit: OrbitControls;

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
    private readonly heightAt: (x: number, z: number) => number,
    private readonly halfExtent: number,
  ) {
    const orbit = new OrbitControls(camera, dom);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.1;
    orbit.screenSpacePanning = false;
    orbit.minDistance = 6;
    orbit.maxDistance = 420;
    orbit.maxPolarAngle = Math.PI * 0.47;
    orbit.zoomSpeed = 0.9;
    orbit.panSpeed = 1.1;
    orbit.enabled = false;
    this.orbit = orbit;
  }

  set enabled(on: boolean) {
    this.orbit.enabled = on;
  }

  /** Looks at the region center from a given distance, azimuth and elevation angle. */
  reset(targetY: number, distance = 180, azimuth = 0.6, polar = 0.95): void {
    const t = this.orbit.target;
    t.set(0, targetY, 0);
    this.camera.position.set(
      Math.sin(azimuth) * Math.sin(polar) * distance,
      targetY + Math.cos(polar) * distance,
      Math.cos(azimuth) * Math.sin(polar) * distance,
    );
    this.orbit.update();
  }

  /** Slides camera and focus across the ground, relative to where the camera faces. */
  move(axes: MoveAxes, dtSeconds: number): void {
    if (!this.orbit.enabled || (axes.x === 0 && axes.y === 0)) return;
    const target = this.orbit.target;
    const fx = target.x - this.camera.position.x;
    const fz = target.z - this.camera.position.z;
    const len = Math.hypot(fx, fz) || 1;
    const step = this.camera.position.distanceTo(target) * KEY_PAN_RATE * dtSeconds;
    // Forward is the camera's ground heading; right is that turned 90° clockwise.
    const dx = ((fx * axes.y - fz * axes.x) / len) * step;
    const dz = ((fz * axes.y + fx * axes.x) / len) * step;
    target.x += dx;
    target.z += dz;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
  }

  update(dtSeconds: number): void {
    const target = this.orbit.target;
    const limit = this.halfExtent * 0.9;
    const cx = clamp(target.x, -limit, limit);
    const cz = clamp(target.z, -limit, limit);
    this.camera.position.x += cx - target.x;
    this.camera.position.z += cz - target.z;
    target.x = cx;
    target.z = cz;
    target.y = this.heightAt(cx, cz);

    this.orbit.update(dtSeconds);

    const floor =
      this.heightAt(
        clamp(this.camera.position.x, -this.halfExtent, this.halfExtent),
        clamp(this.camera.position.z, -this.halfExtent, this.halfExtent),
      ) + GROUND_CLEARANCE;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
  }

  dispose(): void {
    this.orbit.dispose();
  }
}
