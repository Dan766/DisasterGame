import { describe, expect, it } from 'vitest';
import {
  ASH_LIFETIME_DAYS,
  equilibriumCooling,
  injectAsh,
  meanAsh,
  stepAtmosphere,
  totalAsh,
  zonalWindDegPerDay,
} from '../src/sim/systems/atmosphere';
import { createGlobalWorld } from '../src/sim/world';

const blank = () => createGlobalWorld('atmo', 512, 256);

describe('atmosphere', () => {
  it('injects exactly the requested mass', () => {
    const world = blank();
    injectAsh(world, 20, 40, 800, 1e6);
    expect(totalAsh(world)).toBeCloseTo(1e6, -1);
    const tiny = blank();
    injectAsh(tiny, 20, 40, 1, 500); // narrower than a cell
    expect(totalAsh(tiny)).toBeCloseTo(500, 3);
  });

  it('conserves mass under transport (only fallout removes ash)', () => {
    const world = blank();
    injectAsh(world, 45, 0, 600, 1e7);
    const days = 30;
    for (let d = 0; d < days; d++) stepAtmosphere(world, 1);
    const expected = 1e7 * Math.exp(-days / ASH_LIFETIME_DAYS);
    expect(totalAsh(world) / expected).toBeCloseTo(1, 4);
  });

  it('carries ash downwind and spreads it across latitudes', () => {
    const world = blank();
    injectAsh(world, 45, 0, 400, 1e7);
    for (let d = 0; d < 30; d++) stepAtmosphere(world, 1);
    const { ash, ashWidth: w, ashHeight: h } = world;
    const at = (lat: number, lon: number) =>
      ash[Math.floor(((90 - lat) / 180) * h) * w + Math.floor(((lon + 180) / 360) * w)]!;
    // Mid-latitude westerlies push it far east of the impact…
    expect(at(45, 120)).toBeGreaterThan(at(45, 0) * 0.05);
    // …and mixing spreads it toward the tropics and the pole.
    expect(at(20, 60)).toBeGreaterThan(0);
    expect(at(70, 60)).toBeGreaterThan(0);
  });

  it('winds follow the classic bands', () => {
    expect(zonalWindDegPerDay(10)).toBeLessThan(0); // trades blow west
    expect(zonalWindDegPerDay(-45)).toBeGreaterThan(0); // westerlies blow east
    expect(zonalWindDegPerDay(80)).toBeLessThan(0); // polar easterlies
  });

  it('cools toward equilibrium with lag, then recovers', () => {
    expect(equilibriumCooling(0)).toBeCloseTo(0);
    expect(equilibriumCooling(1)).toBeLessThan(-10);
    const world = blank();
    world.ash.fill(1);
    expect(meanAsh(world)).toBeCloseTo(1, 6);
    stepAtmosphere(world, 1);
    const afterOneDay = world.stats.globalTempAnomaly;
    expect(afterOneDay).toBeLessThan(0);
    expect(afterOneDay).toBeGreaterThan(-2); // lagged, not instant
    for (let d = 0; d < 60; d++) stepAtmosphere(world, 1);
    expect(world.stats.globalTempAnomaly).toBeLessThan(-8);
    for (let d = 0; d < 2000; d++) stepAtmosphere(world, 1);
    expect(world.stats.globalTempAnomaly).toBeGreaterThan(-0.5);
  });
});
