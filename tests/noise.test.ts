import { describe, expect, it } from 'vitest';
import { createNoise, fbm2, fbm3, ridged3 } from '../src/core/noise';
import { createRng } from '../src/core/rng';

const samplePoints = (n: number) => {
  const rng = createRng('points');
  return Array.from({ length: n }, () => [
    rng.float(-50, 50),
    rng.float(-50, 50),
    rng.float(-50, 50),
  ]) as [number, number, number][];
};

describe('simplex noise', () => {
  const noise = createNoise(123);
  const points = samplePoints(5000);

  it('is deterministic per seed and differs across seeds', () => {
    const other = createNoise(124);
    const again = createNoise(123);
    for (const [x, y, z] of points.slice(0, 100)) {
      expect(again.noise3(x, y, z)).toBe(noise.noise3(x, y, z));
    }
    const diffs = points
      .slice(0, 100)
      .filter(([x, y, z]) => other.noise3(x, y, z) !== noise.noise3(x, y, z));
    expect(diffs.length).toBeGreaterThan(90);
  });

  it('stays within [-1, 1] with mean near 0 and real spread', () => {
    for (const fn of [
      ([x, y]: number[]) => noise.noise2(x!, y!),
      ([x, y, z]: number[]) => noise.noise3(x!, y!, z!),
    ]) {
      const values = points.map(fn);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(-1);
      expect(Math.max(...values)).toBeLessThanOrEqual(1);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      expect(Math.abs(mean)).toBeLessThan(0.05);
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(1.2);
    }
  });

  it('is continuous (small step → small change)', () => {
    for (const [x, y, z] of points.slice(0, 500)) {
      expect(Math.abs(noise.noise3(x, y, z) - noise.noise3(x + 1e-3, y, z))).toBeLessThan(0.02);
      expect(Math.abs(noise.noise2(x, y) - noise.noise2(x, y + 1e-3))).toBeLessThan(0.02);
    }
  });
});

describe('fractal helpers', () => {
  const noise = createNoise('fractal');
  const points = samplePoints(2000);

  it('fbm stays normalized', () => {
    for (const [x, y, z] of points) {
      const a = fbm3(noise, x, y, z, { octaves: 6 });
      const b = fbm2(noise, x, y, { octaves: 6 });
      expect(Math.abs(a)).toBeLessThanOrEqual(1);
      expect(Math.abs(b)).toBeLessThanOrEqual(1);
    }
  });

  it('ridged noise lies in [0, 1]', () => {
    for (const [x, y, z] of points) {
      const r = ridged3(noise, x, y, z);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});
