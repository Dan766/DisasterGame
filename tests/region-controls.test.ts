import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { RegionControls } from '../src/input/RegionControls';

/** Just enough of a DOM element for OrbitControls to attach to in node. */
function fakeDom(): HTMLElement {
  const noop = () => {};
  const el = {
    style: {},
    addEventListener: noop,
    removeEventListener: noop,
    getRootNode: () => ({ addEventListener: noop, removeEventListener: noop }),
    ownerDocument: { addEventListener: noop, removeEventListener: noop },
  };
  return el as unknown as HTMLElement;
}

function setup() {
  const camera = new PerspectiveCamera();
  const controls = new RegionControls(camera, fakeDom(), () => 0, 500);
  controls.enabled = true;
  // Camera due south of the center (+z), looking north (-z).
  controls.reset(0, 100, 0, 0.9);
  return { camera, controls };
}

describe('RegionControls.move', () => {
  it('W slides the view along the camera heading', () => {
    const { camera, controls } = setup();
    const offset = camera.position.clone().sub(controls.orbit.target);
    controls.move({ x: 0, y: 1 }, 1);
    expect(controls.orbit.target.z).toBeLessThan(0);
    expect(controls.orbit.target.x).toBeCloseTo(0);
    // Camera travels with the focus, keeping the same framing.
    expect(camera.position.clone().sub(controls.orbit.target).distanceTo(offset)).toBeCloseTo(0);
  });

  it('D strafes to the camera right', () => {
    const { controls } = setup();
    controls.move({ x: 1, y: 0 }, 1);
    expect(controls.orbit.target.x).toBeGreaterThan(0);
    expect(controls.orbit.target.z).toBeCloseTo(0);
  });

  it('does nothing while disabled', () => {
    const { controls } = setup();
    controls.enabled = false;
    controls.move({ x: 1, y: 1 }, 1);
    expect(controls.orbit.target.x).toBe(0);
    expect(controls.orbit.target.z).toBe(0);
  });
});
