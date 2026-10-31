import { describe, expect, it } from 'vitest';
import { hashString } from '../src/core/rng';
import { generateRegion } from '../src/sim/gen/region';
import { generateGlobe } from '../src/sim/gen/globe';
import {
  REGION_SIZE,
  RegionDeltaStore,
  Structure,
  emptyDelta,
  type RegionWorld,
} from '../src/sim/region';
import { Biome, cellAt, type GlobalWorld } from '../src/sim/world';

const world = generateGlobe('region-seed');

/** FNV-1a over the raw bytes of every layer. */
function hashLayers(region: RegionWorld): number {
  let h = 0x811c9dc5;
  const layers = [
    region.height,
    region.water,
    region.biome,
    region.fuel,
    region.moisture,
    region.structure,
    region.structHP,
    region.population,
  ];
  for (const layer of layers) {
    const bytes = new Uint8Array(layer.buffer, layer.byteOffset, layer.byteLength);
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193) >>> 0;
  }
  return h;
}

function landCell(w: GlobalWorld, biome: number): { lat: number; lon: number } | undefined {
  for (let i = 0; i < w.biome.length; i++) {
    if (w.biome[i] !== biome) continue;
    // Require a 5×5 neighborhood of the same biome so the region is biome-pure.
    const col = i % w.width;
    const row = Math.floor(i / w.width);
    let pure = true;
    for (let dr = -2; dr <= 2 && pure; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= w.height || w.biome[r * w.width + ((c + w.width) % w.width)] !== biome) {
          pure = false;
          break;
        }
      }
    }
    if (pure)
      return {
        lat: 90 - ((row + 0.5) * 180) / w.height,
        lon: -180 + ((col + 0.5) * 360) / w.width,
      };
  }
  return undefined;
}

function share(region: RegionWorld, biome: number): number {
  let n = 0;
  for (const b of region.biome) if (b === biome) n++;
  return n / region.biome.length;
}

describe('generateRegion', () => {
  const city = world.cities[0]!;

  it('is deterministic: same seed + lat/lon → identical layers', () => {
    const a = generateRegion(world, city.lat, city.lon);
    const b = generateRegion(world, city.lat, city.lon);
    expect(hashLayers(a)).toBe(hashLayers(b));
    expect(a.id).toBe(b.id);
  });

  it('snaps nearby clicks to the same region', () => {
    const a = generateRegion(world, 10.0012, 20.0013);
    const b = generateRegion(world, 10.0, 20.0);
    expect(hashLayers(a)).toBe(hashLayers(b));
  });

  it('differs by location and by world seed', () => {
    const a = generateRegion(world, city.lat, city.lon);
    const elsewhere = generateRegion(world, city.lat + 3, city.lon + 3);
    const other = generateRegion(generateGlobe('other-seed'), city.lat, city.lon);
    expect(hashLayers(elsewhere)).not.toBe(hashLayers(a));
    expect(hashLayers(other)).not.toBe(hashLayers(a));
    expect(hashString(a.id)).not.toBe(hashString(elsewhere.id));
  });

  it('generates in well under a second', () => {
    const t0 = performance.now();
    generateRegion(world, city.lat, city.lon);
    const ms = performance.now() - t0;
    console.info(`region gen: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });

  it('keeps layers in range and consistent', () => {
    const r = generateRegion(world, city.lat, city.lon);
    expect(r.height.length).toBe(REGION_SIZE * REGION_SIZE);
    for (let i = 0; i < r.height.length; i++) {
      expect(Number.isFinite(r.height[i]!)).toBe(true);
      expect(r.fuel[i]).toBeGreaterThanOrEqual(0);
      expect(r.fuel[i]).toBeLessThanOrEqual(1);
      expect(r.moisture[i]).toBeGreaterThanOrEqual(0);
      expect(r.moisture[i]).toBeLessThanOrEqual(1);
      expect(r.water[i]).toBeGreaterThanOrEqual(0);
      expect(r.population[i]).toBeGreaterThanOrEqual(0);
      if (r.structure[i] !== Structure.None) expect(r.structHP[i]).toBe(1);
      if (r.water[i]! > 0.05) expect(r.fuel[i]).toBe(0);
    }
  });

  it('builds towns, roads and houses around a global city', () => {
    const r = generateRegion(world, city.lat, city.lon);
    expect(r.towns.length).toBeGreaterThan(0);
    const counts = new Array(5).fill(0);
    let people = 0;
    for (let i = 0; i < r.structure.length; i++) {
      counts[r.structure[i]!]++;
      people += r.population[i]!;
    }
    expect(counts[Structure.House]).toBeGreaterThan(20);
    expect(counts[Structure.Road]).toBeGreaterThan(20);
    expect(people).toBeGreaterThan(0);
  });

  it('looks different per biome', () => {
    const forest = landCell(world, Biome.Forest);
    const desert = landCell(world, Biome.Desert);
    const tundra = landCell(world, Biome.Tundra);
    expect(forest && desert && tundra).toBeTruthy();
    const f = generateRegion(world, forest!.lat, forest!.lon);
    const d = generateRegion(world, desert!.lat, desert!.lon);
    const t = generateRegion(world, tundra!.lat, tundra!.lon);
    const meanFuel = (r: RegionWorld) => r.fuel.reduce((a, v) => a + v, 0) / r.fuel.length;
    expect(share(f, Biome.Forest)).toBeGreaterThan(0.5);
    expect(share(d, Biome.Desert)).toBeGreaterThan(0.5);
    expect(share(t, Biome.Tundra)).toBeGreaterThan(0.5);
    expect(meanFuel(f)).toBeGreaterThan(meanFuel(t));
    expect(meanFuel(t)).toBeGreaterThan(meanFuel(d) * 0.5);
    expect(meanFuel(f)).toBeGreaterThan(meanFuel(d) * 3);
  });

  it('seeds terrain from the global elevation of its footprint', () => {
    const r = generateRegion(world, city.lat, city.lon);
    const mean = r.height.reduce((a, v) => a + v, 0) / r.height.length;
    const global = world.elevation[cellAt(world, city.lat, city.lon)]!;
    expect(Math.abs(mean - global)).toBeLessThan(Math.max(400, Math.abs(global)));
  });

  it('applies stored deltas (destroyed structures) and stays deterministic', () => {
    const base = generateRegion(world, city.lat, city.lon);
    const target = base.structure.findIndex((s) => s === Structure.House);
    const store = new RegionDeltaStore();
    expect(store.get(base.id)).toBeUndefined();
    store.getOrCreate(base.id).destroyedStructIds.push(target);
    const scarred = generateRegion(world, city.lat, city.lon, store.get(base.id));
    expect(scarred.structure[target]).toBe(Structure.None);
    expect(scarred.structHP[target]).toBe(0);
    const empty = generateRegion(world, city.lat, city.lon, emptyDelta());
    expect(hashLayers(empty)).toBe(hashLayers(base));
  });
});
