import { describe, expect, it } from 'vitest';
import { FireEmitter } from '../src/render/fx/FireEmitter';
import type { ParticleSpec } from '../src/render/fx/Particles';
import { FireState, REGION_SIZE, createRegionWorld } from '../src/sim/region';
import { createWind } from '../src/sim/systems/wind';

function setup() {
  const region = createRegionWorld('t', 1, 0, 0, 0);
  const out: ParticleSpec[] = [];
  let s = 12345;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return { region, out, emitter: new FireEmitter({ emit: (p) => out.push(p) }, rng) };
}
const flat = () => 0;

describe('FireEmitter', () => {
  it('emits nothing without fire', () => {
    const { region, emitter, out } = setup();
    expect(emitter.update(0.1, region, createWind(), flat)).toBe(0);
    expect(out).toHaveLength(0);
  });

  it('emits smoke and sparks from burning cells, smoke drifting downwind', () => {
    const { region, emitter, out } = setup();
    for (let i = 0; i < 40; i++) region.fireState[100 * REGION_SIZE + 100 + i] = FireState.Burning;
    let n = 0;
    for (let k = 0; k < 10; k++) n += emitter.update(0.07, region, createWind(270, 10), flat);
    expect(n).toBe(out.length);
    expect(out.some((p) => p.additive)).toBe(true);
    const smoke = out.filter((p) => !p.additive);
    expect(smoke.length).toBeGreaterThan(0);
    // Wind from the west blows east: smoke gains +x velocity on average.
    expect(smoke.reduce((a, p) => a + p.vx, 0) / smoke.length).toBeGreaterThan(2);
  });

  it('caps a huge fire to the per-pass budget', () => {
    const { region, emitter, out } = setup();
    region.fireState.fill(FireState.Burning);
    const n = emitter.update(0.07, region, createWind(), flat);
    expect(n).toBe(out.length);
    expect(n).toBeLessThan(250);
    expect(n).toBeGreaterThan(20);
  });
});
