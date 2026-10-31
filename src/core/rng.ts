/**
 * Seeded, deterministic random numbers. Sim code must use this instead of
 * Math.random so that a world seed + command log always replays identically.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /**
   * Independent child stream derived from this stream's seed and a label.
   * It doesn't depend on how many numbers the parent has drawn, so
   * `rng.fork('fire')` is stable even when other systems change.
   */
  fork(label: string | number): Rng;
  readonly seed: number;
}

/** 32-bit finalizer (MurmurHash3 fmix32). */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a over UTF-16 code units, then avalanched. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

/** Order-sensitive combination of 32-bit integers into one hash. */
export function hashCombine(seed: number, ...values: number[]): number {
  let h = seed >>> 0;
  for (const v of values) {
    h = fmix32((h ^ (fmix32(v >>> 0) + 0x9e3779b9 + (h << 6) + (h >>> 2))) >>> 0);
  }
  return h;
}

function splitmix32(state: number): () => number {
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let t = state ^ (state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/** Small fast counter generator (sfc32): good statistical quality, 128-bit state. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function createRng(seed: number | string): Rng {
  const seedNum = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const init = splitmix32(seedNum);
  const next = sfc32(init(), init(), init(), init());
  // Discard the first outputs; sfc32 needs a few rounds to diffuse its state.
  for (let i = 0; i < 12; i++) next();

  return {
    seed: seedNum,
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('Rng.pick: empty array');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    fork: (label) =>
      createRng(hashCombine(seedNum, typeof label === 'string' ? hashString(label) : label)),
  };
}
