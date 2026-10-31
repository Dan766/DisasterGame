import { describe, expect, it } from 'vitest';
import { createRng, hashCombine, hashString } from '../src/core/rng';

const draw = (seed: number | string, n = 100) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('createRng', () => {
  it('is deterministic for the same seed', () => {
    expect(draw(42)).toEqual(draw(42));
    expect(draw('world-1')).toEqual(draw('world-1'));
  });

  it('differs across seeds', () => {
    expect(draw(1)).not.toEqual(draw(2));
  });

  it('produces values in [0, 1) with a roughly uniform mean', () => {
    const values = draw(7, 20000);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
  });

  it('int() is inclusive and covers the whole range', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('fork() is independent of how much the parent has drawn', () => {
    const a = createRng(9);
    const b = createRng(9);
    for (let i = 0; i < 50; i++) b.next();
    expect(a.fork('fire').next()).toBe(b.fork('fire').next());
    expect(a.fork('fire').next()).not.toBe(a.fork('wind').next());
  });

  it('pick() throws on an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });
});

describe('hashing', () => {
  it('hashString is stable and spreads similar inputs', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('hashCombine is order-sensitive', () => {
    expect(hashCombine(1, 2, 3)).toBe(hashCombine(1, 2, 3));
    expect(hashCombine(1, 2, 3)).not.toBe(hashCombine(1, 3, 2));
  });
});
