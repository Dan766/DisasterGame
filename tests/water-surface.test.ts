import { describe, expect, it } from 'vitest';
import {
  DRY_SINK_M,
  WET_DEPTH,
  foamStrength,
  waterSurfaceM,
} from '../src/render/region/waterSurface';

describe('waterSurfaceM', () => {
  it('sinks dry cells below the ground', () => {
    expect(waterSurfaceM(10, 0)).toBe(10 - DRY_SINK_M);
    expect(waterSurfaceM(10, WET_DEPTH)).toBe(10 - DRY_SINK_M);
  });
  it('sits depth above ground on wet land and above sea level in the ocean', () => {
    expect(waterSurfaceM(10, 2)).toBe(12);
    expect(waterSurfaceM(-30, 30)).toBe(30);
  });
});

describe('foamStrength', () => {
  it('is zero for dry cells', () => {
    expect(foamStrength(0, 5)).toBe(0);
  });
  it('is strong at a fast-moving front and capped at 1', () => {
    expect(foamStrength(3, 0.6)).toBe(1);
    expect(foamStrength(3, -5)).toBe(1);
  });
  it('gives a lighter fringe on shallow, still water and none on deep still water', () => {
    const shallow = foamStrength(0.3, 0);
    expect(shallow).toBeGreaterThan(0);
    expect(shallow).toBeLessThan(0.5);
    expect(foamStrength(20, 0)).toBe(0);
  });
});
