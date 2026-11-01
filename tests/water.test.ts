import { describe, expect, it } from 'vitest';
import { REGION_SIZE, Structure, createRegionWorld } from '../src/sim/region';
import { REGION_DT, RegionSim } from '../src/sim/RegionSim';
import { createWaterField, stepWater } from '../src/sim/systems/water';

const S = REGION_SIZE;

/** Narrow open sea in the west (bed -10 m, 600 m wide), then a gentle beach rising inland. */
function coast() {
  const r = createRegionWorld('w', 1, 0, 0, 0);
  for (let row = 0; row < S; row++) {
    for (let col = 0; col < S; col++) {
      const i = row * S + col;
      const h = col < 6 ? -10 : (col - 6) * 0.4 - 1;
      r.height[i] = h;
      if (h < 0) r.water[i] = -h;
    }
  }
  return r;
}

const total = (w: Float32Array) => w.reduce((a, b) => a + b, 0);

describe('water flow', () => {
  it('is asleep (and free) when nothing perturbs it', () => {
    const r = coast();
    const before = Array.from(r.water);
    const f = createWaterField(S);
    expect(stepWater(r, f, REGION_DT)).toBe(0);
    expect(Array.from(r.water)).toEqual(before);
  });

  it('conserves water in a closed basin and levels a heap', () => {
    const r = createRegionWorld('b', 1, 0, 0, 0);
    const c = (S / 2) * S + S / 2;
    r.water[c] = 10;
    const f = createWaterField(S);
    f.active = true;
    const before = total(r.water);
    for (let t = 0; t < 400; t++) stepWater(r, f, REGION_DT);
    expect(total(r.water)).toBeCloseTo(before, 2);
    expect(r.water[c]!).toBeLessThan(5);
    expect(r.water[c + 1]!).toBeGreaterThan(0.005);
  });

  it('a tsunami floods the beach and falls back to rest', () => {
    const r = coast();
    const sim = new RegionSim(r);
    sim.spawnTsunami('W', 8, 100);
    let maxCol = 0;
    for (let t = 0; t < 3000; t++) {
      sim.step();
      for (let col = 6; col < S; col++) {
        if (r.water[128 * S + col]! > 0.1) maxCol = Math.max(maxCol, col);
      }
    }
    // Run-up goes inland of the shoreline (col ~8.5) but not unboundedly.
    expect(maxCol).toBeGreaterThan(9);
    expect(maxCol).toBeLessThan(150);
    expect(sim.waterField.maxDepth[128 * S + 9]!).toBeGreaterThan(0.3);
  }, 90_000);

  it('flood destroys coastal houses and kills some residents, deterministically', () => {
    const run = () => {
      const r = coast();
      const near = 128 * S + 9;
      const far = 128 * S + 90;
      for (const i of [near, far]) {
        r.structure[i] = Structure.House;
        r.structHP[i] = 1;
        r.population[i] = 10;
      }
      const sim = new RegionSim(r);
      sim.spawnTsunami('W', 10, 100);
      for (let t = 0; t < 3000; t++) sim.step();
      return { r, sim, near, far };
    };
    const a = run();
    expect(a.r.structHP[a.near]).toBe(0);
    expect(a.r.structHP[a.far]).toBe(1);
    expect(a.sim.damage.deaths).toBeGreaterThan(0);
    expect(a.sim.damage.deaths).toBeLessThan(10);
    expect(Array.from(run().r.water)).toEqual(Array.from(a.r.water));
  }, 90_000);

  it('goes back to sleep once the water settles', () => {
    const r = coast();
    const sim = new RegionSim(r);
    sim.spawnTsunami('W', 1, 20);
    for (let t = 0; t < 8000 && (sim.tsunamis.length || sim.waterField.active); t++) sim.step();
    expect(sim.waterField.active).toBe(false);
  }, 90_000);
});
