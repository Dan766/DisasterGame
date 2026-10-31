import { describe, expect, it } from 'vitest';
import { greatCircleDistance } from '../src/core/geo';
import { classifyBiome, generateGlobe } from '../src/sim/gen/globe';
import { Biome, cellCenter, oceanFraction, totalPopulation } from '../src/sim/world';

const t0 = performance.now();
const world = generateGlobe('golden-seed');
const genMs = performance.now() - t0;

describe('generateGlobe (full size)', () => {
  it('generates fast enough (DESIGN target < 1 s; generous bound for CI)', () => {
    console.info(`globe gen: ${genMs.toFixed(0)} ms`);
    expect(genMs).toBeLessThan(2000);
  });

  it('hits the target ocean fraction', () => {
    const f = oceanFraction(world);
    expect(f).toBeGreaterThan(0.66);
    expect(f).toBeLessThan(0.7);
  });

  it('distributes the target population only onto habitable land', () => {
    expect(totalPopulation(world)).toBeCloseTo(8e9, -7);
    expect(world.stats.initialPopulation).toBe(8e9);
    let oceanPeople = 0;
    let negative = 0;
    for (let i = 0; i < world.population.length; i++) {
      if (world.elevation[i]! < 0) oceanPeople += world.population[i]!;
      if (world.population[i]! < 0) negative++;
    }
    expect(oceanPeople).toBe(0);
    expect(negative).toBe(0);
  });

  it('produces a varied set of biomes with ice at the poles and none at the equator', () => {
    const counts = new Array(8).fill(0);
    for (const b of world.biome) counts[b]++;
    expect(counts.filter((c) => c > 0).length).toBeGreaterThanOrEqual(7);

    const { width, height } = world;
    const equatorRow = Math.floor(height / 2);
    for (let col = 0; col < width; col++) {
      const i = equatorRow * width + col;
      if (world.elevation[i]! < 2000) expect(world.biome[i]).not.toBe(Biome.Ice);
    }
    let polarIce = 0;
    for (let col = 0; col < width; col++) if (world.biome[col] === Biome.Ice) polarIce++;
    expect(polarIce / width).toBeGreaterThan(0.9);
  });

  it('keeps climate layers in range', () => {
    const range = (a: Float32Array) =>
      a.reduce(([lo, hi], v) => [Math.min(lo, v), Math.max(hi, v)], [Infinity, -Infinity]);
    const [wetMin, wetMax] = range(world.moisture);
    expect(wetMin).toBeGreaterThanOrEqual(0);
    expect(wetMax).toBeLessThanOrEqual(1);
    const [tempMin, tempMax] = range(world.baseTemp);
    expect(tempMax).toBeLessThan(45);
    expect(tempMin).toBeGreaterThan(-60);
  });

  it('places spaced-out cities on land', () => {
    expect(world.cities.length).toBeGreaterThan(20);
    expect(world.cities.length).toBeLessThanOrEqual(48);
    const names = new Set(world.cities.map((c) => c.name));
    expect(names.size).toBe(world.cities.length);
    for (const [i, a] of world.cities.entries()) {
      expect(world.elevation[a.cell]).toBeGreaterThanOrEqual(0);
      expect(a.population).toBeGreaterThan(0);
      for (const b of world.cities.slice(i + 1)) {
        expect(greatCircleDistance(a, b)).toBeGreaterThanOrEqual(500);
      }
    }
  });
});

describe('generateGlobe determinism', () => {
  const small = { width: 128, height: 64 };

  it('is identical for the same seed', () => {
    const a = generateGlobe('repeat', small);
    const b = generateGlobe('repeat', small);
    expect(a.elevation).toEqual(b.elevation);
    expect(a.population).toEqual(b.population);
    expect(a.cities).toEqual(b.cities);
  });

  it('differs between seeds', () => {
    const a = generateGlobe('one', small);
    const b = generateGlobe('two', small);
    let same = 0;
    for (let i = 0; i < a.biome.length; i++) if (a.biome[i] === b.biome[i]) same++;
    expect(same / a.biome.length).toBeLessThan(0.8);
  });

  it('cell centers line up with the layer index', () => {
    const { lat } = cellCenter(world, 0);
    expect(lat).toBeGreaterThan(89);
  });
});

describe('classifyBiome', () => {
  it('classifies representative climates', () => {
    expect(classifyBiome(-100, 20, 0.5)).toBe(Biome.Ocean);
    expect(classifyBiome(-100, -20, 0.5)).toBe(Biome.Ice);
    expect(classifyBiome(100, 26, 0.1)).toBe(Biome.Desert);
    expect(classifyBiome(100, 26, 0.8)).toBe(Biome.Jungle);
    expect(classifyBiome(100, 12, 0.6)).toBe(Biome.Forest);
    expect(classifyBiome(100, 12, 0.35)).toBe(Biome.Grassland);
    expect(classifyBiome(100, -5, 0.5)).toBe(Biome.Tundra);
    expect(classifyBiome(4000, 5, 0.5)).toBe(Biome.Mountain);
  });
});
