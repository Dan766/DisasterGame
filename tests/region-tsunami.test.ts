import { describe, expect, it } from 'vitest';
import type { LandfallRecord } from '../src/sim/GlobeSim';
import { createRegionWorld } from '../src/sim/region';
import { edgeFacing, MAX_REGION_WAVE_M, planRegionTsunami } from '../src/sim/systems/regionTsunami';

const region = createRegionWorld('0.00,0.00', 1, 0, 0, 0);
const hit = (cell: number, runupM: number, sourceLon = -3): LandfallRecord => ({
  cell,
  sourceLat: 0,
  sourceLon,
  runupM,
});

describe('region tsunami replay', () => {
  it('picks the edge facing the source', () => {
    expect(edgeFacing(region, 0, -3)).toBe('W');
    expect(edgeFacing(region, 0, 3)).toBe('E');
    expect(edgeFacing(region, 3, 0)).toBe('N');
    expect(edgeFacing(region, -3, 0)).toBe('S');
  });

  it('ignores other cells and already-applied landfalls', () => {
    expect(planRegionTsunami(region, 5, [hit(6, 10)])).toBeNull();
    expect(planRegionTsunami(region, 5, [hit(5, 10)], 1)).toBeNull();
  });

  it('uses the strongest landfall, halves run-up to open-water height and caps it', () => {
    const plan = planRegionTsunami(region, 5, [hit(5, 6), hit(5, 12, 3), hit(7, 99)]);
    expect(plan).toEqual({ edge: 'E', amplitudeM: 6, count: 2 });
    expect(planRegionTsunami(region, 5, [hit(5, 500)])!.amplitudeM).toBe(MAX_REGION_WAVE_M);
  });
});
