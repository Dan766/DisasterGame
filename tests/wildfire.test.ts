import { describe, expect, it } from 'vitest';
import { wildfire, wildfireSpecFromParams } from '../src/sim/disasters/wildfire';
import { defaultParams } from '../src/sim/disasters/types';
import { DISASTERS } from '../src/sim/disasters/registry';
import { REGION_SIZE, createRegionWorld } from '../src/sim/region';
import { RegionSim } from '../src/sim/RegionSim';
import { createWind } from '../src/sim/systems/wind';

const mid = REGION_SIZE / 2;
const sim = () => {
  const r = createRegionWorld('t', 1, 0, 0, 0);
  r.fuel.fill(1);
  return new RegionSim(r, createWind(0, 0));
};

describe('wildfire', () => {
  it('is registered as a region disaster', () => {
    expect(DISASTERS).toContain(wildfire);
    expect(wildfire.scales).toEqual(['region']);
  });

  it('clamps params into a valid spec', () => {
    expect(wildfireSpecFromParams({ brushCells: 99, intensityPct: 500 })).toEqual({
      radiusCells: 12,
      intensity: 1,
    });
    expect(wildfireSpecFromParams(defaultParams(wildfire)).intensity).toBeCloseTo(0.9);
  });

  it('a bigger brush ignites more cells', () => {
    const small = wildfireSpecFromParams({ brushCells: 1, intensityPct: 100 });
    const big = wildfireSpecFromParams({ brushCells: 8, intensityPct: 100 });
    const a = sim().ignite(mid, mid, small.radiusCells, small.intensity);
    const b = sim().ignite(mid, mid, big.radiusCells, big.intensity);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a * 10);
  });
});
