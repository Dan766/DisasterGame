import { describe, expect, it } from 'vitest';
import { generateGlobe } from '../src/sim/gen/globe';
import { generateRegion } from '../src/sim/gen/region';
import { RegionSim } from '../src/sim/RegionSim';
import { FireState, RegionDeltaStore, Structure } from '../src/sim/region';
import {
  applyPendingStrikes,
  captureDelta,
  rleDecode,
  rleEncode,
  strikeToCell,
} from '../src/sim/systems/persistence';
import { cellAt } from '../src/sim/world';

const world = generateGlobe('persist-seed');
const city = [...world.cities].sort((a, b) => b.population - a.population)[0]!;

function visit(sim: RegionSim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

describe('RLE mask', () => {
  it('round-trips masks including leading/trailing runs', () => {
    for (const m of [[0, 0, 1, 1, 1, 0], [1, 1, 0], [0, 0, 0], [1], []]) {
      expect(Array.from(rleDecode(rleEncode(m), m.length))).toEqual(m);
    }
  });
});

describe('RegionDelta persistence', () => {
  it('a revisited region reproduces the burn mask, craters and losses', () => {
    const store = new RegionDeltaStore();
    const first = generateRegion(world, city.lat, city.lon);
    const sim = new RegionSim(first);
    const c = Math.floor(first.size / 2);
    sim.impact({
      col: c,
      row: c,
      craterRadiusCells: 4,
      blastRadiusCells: 12,
      thermalRadiusCells: 10,
    });
    sim.ignite(c + 30, c + 30, 3);
    visit(sim, 400);
    store.set(first.id, captureDelta(first, sim));

    const again = generateRegion(world, city.lat, city.lon, store.get(first.id));
    const burntBefore = first.fireState.map((s) => (s !== FireState.Unburnt ? 1 : 0));
    const burntAfter = again.fireState.map((s) => (s !== FireState.Unburnt ? 1 : 0));
    expect(burntBefore.some((v) => v === 1)).toBe(true);
    expect(Array.from(burntAfter)).toEqual(Array.from(burntBefore));
    expect(Array.from(again.height)).toEqual(Array.from(first.height));
    for (let i = 0; i < first.structure.length; i++) {
      if (first.structure[i] === Structure.None) expect(again.structure[i]).toBe(Structure.None);
    }
  });

  it('conserves population: delta deaths match the people lost', () => {
    const base = generateRegion(world, city.lat, city.lon);
    const sim = new RegionSim(generateRegion(world, city.lat, city.lon));
    const town = base.towns[0]!;
    sim.impact({
      col: town.col,
      row: town.row,
      craterRadiusCells: 3,
      blastRadiusCells: 10,
      thermalRadiusCells: 6,
    });
    visit(sim, 200);
    const delta = captureDelta(sim.region, sim);
    const again = generateRegion(world, city.lat, city.lon, delta);
    const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
    expect(delta.deaths).toBeGreaterThan(0);
    expect(sum(again.population)).toBeCloseTo(sum(base.population) - delta.deaths, 0);
  });

  it('accumulates across visits', () => {
    const store = new RegionDeltaStore();
    const r1 = generateRegion(world, city.lat, city.lon);
    const s1 = new RegionSim(r1);
    s1.ignite(100, 100, 3);
    visit(s1, 300);
    store.set(r1.id, captureDelta(r1, s1));
    const r2 = generateRegion(world, city.lat, city.lon, store.get(r1.id));
    const s2 = new RegionSim(r2);
    s2.ignite(180, 180, 3);
    visit(s2, 300);
    const d2 = captureDelta(r2, s2, store.get(r1.id));
    const r3 = generateRegion(world, city.lat, city.lon, d2);
    for (let i = 0; i < r2.fireState.length; i++) {
      if (r2.fireState[i] !== FireState.Unburnt) expect(r3.fireState[i]).toBe(FireState.Burnt);
    }
    expect(cellAt(world, city.lat, city.lon)).toBeGreaterThanOrEqual(0);
  });
});

describe('global strikes replayed on region entry', () => {
  const strike = (lat: number, lon: number) => ({
    lat,
    lon,
    craterRadiusKm: 0.4,
    blastRadiusKm: 2,
    thermalRadiusKm: 1.5,
  });

  it('carves a crater and burns the area, then is not applied twice', () => {
    const store = new RegionDeltaStore();
    const base = generateRegion(world, city.lat, city.lon);
    const first = generateRegion(world, city.lat, city.lon);
    store.recordStrike(strike(base.lat, base.lon));
    const delta = applyPendingStrikes(first, store.strikes, store.get(first.id))!;
    expect(delta).not.toBeNull();
    const c = Math.round(strikeToCell(first, base.lat, base.lon).col);
    const i = c * first.size + c;
    expect(first.height[i]!).toBeLessThan(base.height[i]!);
    expect(delta.craters).toHaveLength(1);
    expect(delta.strikesApplied).toBe(1);
    store.set(first.id, delta);

    // Re-entry replays the stored delta and does not re-apply the strike.
    const again = generateRegion(world, city.lat, city.lon, store.get(first.id));
    expect(Array.from(again.height)).toEqual(Array.from(first.height));
    expect(applyPendingStrikes(again, store.strikes, store.get(first.id))).toBeNull();
  });

  it('ignores strikes far from the region', () => {
    const region = generateRegion(world, city.lat, city.lon);
    const far = strike(region.lat + 5, region.lon);
    expect(applyPendingStrikes(region, [far])).toBeNull();
  });

  it('a strike just outside the region still blasts its edge', () => {
    const region = generateRegion(world, city.lat, city.lon);
    const edgeLat = region.lat + (130 * 100) / 111_320 + 0.01;
    const s = { ...strike(edgeLat, region.lon), craterRadiusKm: 0, blastRadiusKm: 4 };
    expect(applyPendingStrikes(region, [s])).not.toBeNull();
  });
});
