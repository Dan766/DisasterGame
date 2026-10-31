import { describe, expect, it } from 'vitest';
import { FireState, REGION_SIZE, createRegionWorld } from '../src/sim/region';
import { REGION_DT, RegionSim } from '../src/sim/RegionSim';
import { igniteCell } from '../src/sim/systems/fire';

function forest(seed: number) {
  const r = createRegionWorld('t', seed, 0, 0, 0);
  r.fuel.fill(1);
  r.moisture.fill(0.1);
  return r;
}

function burn(seed: number, ticks: number) {
  const r = forest(seed);
  igniteCell(r, REGION_SIZE / 2, REGION_SIZE / 2);
  const sim = new RegionSim(r);
  for (let i = 0; i < ticks; i++) sim.step();
  return { r, sim };
}

describe('RegionSim', () => {
  it('advances game time by dt each tick', () => {
    const { sim } = burn(1, 50);
    expect(sim.elapsed).toBeCloseTo(50 * REGION_DT, 6);
  });

  it('spreads fire over time', () => {
    const { r } = burn(1, 300);
    const touched = r.fireState.reduce((n, s) => n + (s !== FireState.Unburnt ? 1 : 0), 0);
    expect(touched).toBeGreaterThan(20);
  });

  it('is deterministic for the same region seed', () => {
    const a = burn(5, 200).r;
    const b = burn(5, 200).r;
    expect(Array.from(a.fireState)).toEqual(Array.from(b.fireState));
  });
});

describe('RegionSim.ignite', () => {
  it('starts fires in a brush around a cell on burnable ground', () => {
    const r = forest(2);
    const sim = new RegionSim(r);
    const n = sim.ignite(100, 100, 3, 1);
    expect(n).toBeGreaterThan(10);
    expect(r.fireState[100 * REGION_SIZE + 100]).toBe(FireState.Burning);
  });
});
