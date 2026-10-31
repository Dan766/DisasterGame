import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { FireState, REGION_SIZE, createRegionWorld, type RegionWorld } from '../src/sim/region';
import { igniteCell, stepFire } from '../src/sim/systems/fire';
import { addGust, createWind, stepWind, windAt } from '../src/sim/systems/wind';

function flatForest(): RegionWorld {
  const r = createRegionWorld('test', 1, 0, 0, 0);
  r.fuel.fill(1);
  r.moisture.fill(0.1);
  return r;
}

function run(region: RegionWorld, fromDeg: number, speed: number, seconds: number, seed = 7) {
  const wind = createWind(fromDeg, speed);
  const rng = createRng(seed);
  for (let t = 0; t < seconds * 10; t++) stepFire(region, wind, rng, 0.1);
}

const mid = REGION_SIZE / 2;
const touched = (r: RegionWorld, i: number) => r.fireState[i] !== FireState.Unburnt;

function extent(r: RegionWorld): { east: number; west: number } {
  let east = 0;
  let west = 0;
  for (let c = 0; c < r.size; c++) {
    if (touched(r, mid * r.size + c)) {
      if (c > mid) east = Math.max(east, c - mid);
      if (c < mid) west = Math.max(west, mid - c);
    }
  }
  return { east, west };
}

describe('fire', () => {
  it('spreads faster downwind than upwind', () => {
    const r = flatForest();
    igniteCell(r, mid, mid);
    run(r, 270, 10, 40); // from the west, blowing east
    const { east, west } = extent(r);
    expect(east).toBeGreaterThan(west + 3);
  });

  it('does not cross a water barrier', () => {
    const r = flatForest();
    for (let row = 0; row < r.size; row++) {
      r.water[row * r.size + mid + 5] = 2;
      r.water[row * r.size + mid + 6] = 2;
    }
    igniteCell(r, mid, mid);
    run(r, 270, 15, 120);
    let crossed = 0;
    let burnedNearSource = 0;
    for (let row = 0; row < r.size; row++) {
      for (let col = 0; col < r.size; col++) {
        if (!touched(r, row * r.size + col)) continue;
        if (col > mid + 6) crossed++;
        else burnedNearSource++;
      }
    }
    expect(burnedNearSource).toBeGreaterThan(20);
    expect(crossed).toBe(0);
  });

  it('burns out into burnt cells and cannot re-ignite them', () => {
    const r = flatForest();
    igniteCell(r, mid, mid);
    run(r, 270, 0, 60);
    expect(r.fireState[mid * r.size + mid]).toBe(FireState.Burnt);
    expect(igniteCell(r, mid, mid)).toBe(false);
  });

  it('is deterministic for a given seed', () => {
    const a = flatForest();
    const b = flatForest();
    igniteCell(a, mid, mid);
    igniteCell(b, mid, mid);
    run(a, 90, 6, 30, 3);
    run(b, 90, 6, 30, 3);
    expect(Array.from(a.fireState)).toEqual(Array.from(b.fireState));
  });
});

describe('wind', () => {
  it('a west wind blows toward +x', () => {
    const w = windAt(createWind(270, 8), 10, 10);
    expect(w.x).toBeCloseTo(8);
    expect(w.y).toBeCloseTo(0);
  });

  it('gusts perturb locally and decay', () => {
    const wind = createWind(0, 0);
    addGust(wind, 100, 100, 40, 10, 'out');
    const before = windAt(wind, 116, 100);
    expect(before.x).toBeGreaterThan(0);
    stepWind(wind, 30);
    expect(Math.abs(windAt(wind, 116, 100).x)).toBeLessThan(before.x * 0.1);
  });
});
