/**
 * Deterministic regional terrain generation (DESIGN.md §3.5).
 * The same (world seed, lat, lon) always yields identical layers, so only a
 * small `RegionDelta` ever needs to be persisted.
 */
import { createNoise, fbm2, type Noise } from '../../core/noise';
import { sampleBilinear } from '../../core/grid';
import { degToRad } from '../../core/geo';
import { clamp, clamp01, smoothstep } from '../../core/math';
import { createRng, hashCombine, hashString, type Rng } from '../../core/rng';
import { classifyBiome } from './globe';
import { createNameGenerator } from './names';
import {
  REGION_CELL_M,
  REGION_EXTENT_KM,
  REGION_SIZE,
  Structure,
  createRegionWorld,
  regionId,
  type RegionDelta,
  type RegionWorld,
  type Town,
} from '../region';
import { Biome, type GlobalWorld } from '../world';

const S = REGION_SIZE;
const M_PER_DEG_LAT = 111_320;
/** Fuel loading by biome before noise. */
const FUEL_BY_BIOME: Record<number, number> = {
  [Biome.Ocean]: 0,
  [Biome.Ice]: 0,
  [Biome.Tundra]: 0.22,
  [Biome.Forest]: 0.85,
  [Biome.Grassland]: 0.5,
  [Biome.Desert]: 0.08,
  [Biome.Jungle]: 0.95,
  [Biome.Mountain]: 0.25,
};
const FARM_BIOMES = new Set<number>([Biome.Grassland, Biome.Forest, Biome.Jungle]);
const MOISTURE_REACH = 8;

/** Region centers are quantized to 0.01° so ids and seeds are stable. */
export function quantizeCenter(lat: number, lon: number): { lat: number; lon: number } {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return {
    lat: Math.round(clamp(lat, -85, 85) * 100) / 100,
    lon: Math.round(wrapped * 100) / 100,
  };
}

export function generateRegion(
  world: GlobalWorld,
  lat: number,
  lon: number,
  delta?: RegionDelta,
): RegionWorld {
  const center = quantizeCenter(lat, lon);
  const seed = hashCombine(
    hashString(world.seed),
    Math.round(center.lat * 100),
    Math.round(center.lon * 100),
  );
  const rng = createRng(seed);
  const detailNoise = createNoise(hashCombine(seed, 1));
  const climateNoise = createNoise(hashCombine(seed, 2));

  const cosLat = Math.max(0.05, Math.cos(degToRad(center.lat)));
  const sample = (layer: ArrayLike<number>, col: number, row: number) =>
    sampleBilinear(
      layer,
      world.width,
      world.height,
      center.lat + ((S / 2 - (row + 0.5)) * REGION_CELL_M) / M_PER_DEG_LAT,
      center.lon + ((col + 0.5 - S / 2) * REGION_CELL_M) / (M_PER_DEG_LAT * cosLat),
    );

  const centerBiome = world.biome[
    Math.floor(((90 - center.lat) / 180) * world.height) * world.width +
      Math.min(world.width - 1, Math.floor(((center.lon + 180) / 360) * world.width))
  ] as number;
  const region = createRegionWorld(
    regionId(center.lat, center.lon),
    seed,
    center.lat,
    center.lon,
    centerBiome,
  );

  generateTerrain(region, sample, world, detailNoise, climateNoise);
  carveRivers(region, rng.fork('rivers'));
  const slope = computeSlope(region.height);
  growVegetation(region, slope, climateNoise);
  settle(region, world, center.lat, slope, rng.fork('towns'), detailNoise);

  if (delta) {
    for (const id of delta.destroyedStructIds) {
      region.structure[id] = Structure.None;
      region.structHP[id] = 0;
    }
  }
  return region;
}

// --- Terrain ---------------------------------------------------------------

function generateTerrain(
  region: RegionWorld,
  sample: (layer: ArrayLike<number>, col: number, row: number) => number,
  world: GlobalWorld,
  detail: Noise,
  climate: Noise,
): void {
  const { height, water, biome, moisture } = region;
  // The global grid is ~78 km per cell, so its slope across a 25 km region is a
  // steep ramp. Keep only a fraction of it so the diorama reads as local terrain.
  const centerElev = sample(world.elevation, S / 2, S / 2);
  for (let row = 0; row < S; row++) {
    for (let col = 0; col < S; col++) {
      const i = row * S + col;
      const rawElev = sample(world.elevation, col, row);
      const baseElev =
        rawElev > 0 && centerElev > 0 ? centerElev + 0.15 * (rawElev - centerElev) : rawElev;
      const wet = sample(world.moisture, col, row);

      // Roughness follows the global terrain: flat plains, jagged high country.
      const alpine = smoothstep(1200, 4500, baseElev);
      const amp = (30 + 900 * alpine + 40 * wet) * smoothstep(-300, 20, baseElev);
      const nx = (col * REGION_CELL_M) / 2600;
      const ny = (row * REGION_CELL_M) / 2600;
      const rolling = fbm2(detail, nx, ny, { octaves: 5 });
      const ridge = 1 - Math.abs(detail.noise2(nx * 1.7 + 40, ny * 1.7 + 40));
      const landBias = smoothstep(-20, 60, baseElev) * 0.4 * amp;
      height[i] = baseElev + amp * rolling + alpine * amp * 0.7 * ridge * ridge + landBias;
      if (height[i]! < 0) water[i] = -height[i]!;

      const lapse = height[i]! > 0 && baseElev > 0 ? (6.5 * (height[i]! - baseElev)) / 1000 : 0;
      const temp = sample(world.baseTemp, col, row) - lapse + 1.5 * climate.noise2(nx * 2, ny * 2);
      const localWet = clamp01(wet + 0.12 * climate.noise2(nx * 3 + 9, ny * 3 + 9));
      moisture[i] = localWet;
      biome[i] = classifyBiome(height[i]!, temp, localWet);
    }
  }
}

/** Rise over run (dimensionless) from central differences. */
function computeSlope(height: Float32Array): Float32Array {
  const slope = new Float32Array(S * S);
  for (let row = 0; row < S; row++) {
    for (let col = 0; col < S; col++) {
      const w = height[row * S + Math.max(0, col - 1)]!;
      const e = height[row * S + Math.min(S - 1, col + 1)]!;
      const n = height[Math.max(0, row - 1) * S + col]!;
      const s = height[Math.min(S - 1, row + 1) * S + col]!;
      slope[row * S + col] = Math.hypot(e - w, s - n) / (2 * REGION_CELL_M);
    }
  }
  return slope;
}

const NEIGHBORS8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function carveRivers(region: RegionWorld, rng: Rng): void {
  const { height, water, centerBiome } = region;
  const maxRivers =
    centerBiome === Biome.Ice || centerBiome === Biome.Ocean
      ? 0
      : centerBiome === Biome.Desert
        ? 1
        : centerBiome === Biome.Mountain
          ? 3
          : 2;
  const count = maxRivers === 0 ? 0 : rng.int(maxRivers > 1 ? 1 : 0, maxRivers);

  // Springs: the highest of a random sample, kept apart from each other.
  const springs: number[] = [];
  const candidates: number[] = [];
  for (let k = 0; k < 400; k++) {
    const col = rng.int(8, S - 9);
    const row = rng.int(8, S - 9);
    if (height[row * S + col]! > 5) candidates.push(row * S + col);
  }
  candidates.sort((a, b) => height[b]! - height[a]!);
  for (const c of candidates) {
    if (springs.length >= count) break;
    const col = c % S;
    const row = Math.floor(c / S);
    const apart = springs.every((o) => Math.hypot((o % S) - col, Math.floor(o / S) - row) > 50);
    if (apart) springs.push(c);
  }

  for (const spring of springs) {
    const path: number[] = [];
    const seen = new Set<number>([spring]);
    let cur = spring;
    for (let step = 0; step < 3000; step++) {
      path.push(cur);
      if (height[cur]! <= 0) break;
      const col = cur % S;
      const row = Math.floor(cur / S);
      let best = -1;
      let bestH = height[cur]!;
      for (const [dc, dr] of NEIGHBORS8) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= S || r >= S) continue;
        const j = r * S + c;
        if (!seen.has(j) && height[j]! < bestH) {
          bestH = height[j]!;
          best = j;
        }
      }
      if (best < 0) break; // pit: the river ends in a pond
      seen.add(best);
      cur = best;
    }

    path.forEach((cell, idx) => {
      const wide = idx / path.length > 0.4;
      const col = cell % S;
      const row = Math.floor(cell / S);
      const bed: [number, number][] = [[0, 0]];
      if (wide) bed.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      for (const [dc, dr] of bed) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= S || r >= S) continue;
        const j = r * S + c;
        if (height[j]! <= 0) continue; // already sea
        height[j] = height[j]! - 3;
        water[j] = Math.max(water[j]!, 1.8 + (height[j]! < 0 ? -height[j]! : 0));
      }
    });
    // A pond where the river dead-ends.
    const end = path[path.length - 1]!;
    if (height[end]! > 0) {
      const col = end % S;
      const row = Math.floor(end / S);
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= S || r >= S || Math.hypot(dc, dr) > 2.2) continue;
          const j = r * S + c;
          water[j] = Math.max(water[j]!, 2);
          height[j] = height[j]! - 2;
        }
      }
    }
  }
}

// --- Vegetation ------------------------------------------------------------

function growVegetation(region: RegionWorld, slope: Float32Array, noise: Noise): void {
  const { fuel, moisture, water, biome } = region;
  const dist = distanceToWater(water);
  for (let row = 0; row < S; row++) {
    for (let col = 0; col < S; col++) {
      const i = row * S + col;
      const d = dist[i]!;
      moisture[i] = clamp01(moisture[i]! + 0.35 * (1 - d / MOISTURE_REACH));
      if (water[i]! > 0.05) {
        fuel[i] = 0;
        moisture[i] = 1;
        continue;
      }
      const patch = 0.65 + 0.35 * noise.noise2(col * 0.07 + 100, row * 0.07 + 100);
      const lush = 0.8 + 0.4 * moisture[i]!;
      fuel[i] = clamp01(
        (FUEL_BY_BIOME[biome[i]!] ?? 0) * patch * lush * (1 - 0.5 * clamp01(slope[i]! * 1.5)),
      );
    }
  }
}

/** Chebyshev distance to the nearest water cell, capped at MOISTURE_REACH. */
function distanceToWater(water: Float32Array): Uint8Array {
  const dist = new Uint8Array(S * S).fill(MOISTURE_REACH);
  const queue: number[] = [];
  for (let i = 0; i < water.length; i++) {
    if (water[i]! > 0.05) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const d = dist[cur]!;
    if (d + 1 >= MOISTURE_REACH) continue;
    const col = cur % S;
    const row = Math.floor(cur / S);
    for (const [dc, dr] of NEIGHBORS8) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= S || r >= S) continue;
      const j = r * S + c;
      if (dist[j]! > d + 1) {
        dist[j] = d + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

// --- Settlements -----------------------------------------------------------

function settle(
  region: RegionWorld,
  world: GlobalWorld,
  lat: number,
  slope: Float32Array,
  rng: Rng,
  noise: Noise,
): void {
  const density =
    sampleBilinear(world.population, world.width, world.height, lat, region.lon) /
    world.rowAreaKm2[Math.min(world.height - 1, Math.floor(((90 - lat) / 180) * world.height))]!;
  const regionPop = density * REGION_EXTENT_KM ** 2;
  if (regionPop < 200) return;

  const towns = placeTowns(region, slope, rng, regionPop);
  region.towns = towns;
  if (towns.length === 0) return;

  const { structure, structHP, water, fuel, biome } = region;
  const isLand = (i: number) => region.height[i]! > 2 && water[i]! < 0.05;

  // Roads: minimum spanning tree between towns, routed around slopes and water.
  for (const [a, b] of spanningTree(towns)) {
    for (const cell of routeRoad(region, slope, towns[a]!, towns[b]!)) {
      if (isLand(cell)) structure[cell] = Structure.Road;
    }
  }

  // Street grid, houses on a lattice between the streets, towers downtown.
  const townCells: number[][] = towns.map(() => []);
  towns.forEach((town, t) => {
    const radius = townRadius(town.population);
    for (let row = Math.max(0, Math.floor(town.row - radius)); row <= town.row + radius; row++) {
      for (let col = Math.max(0, Math.floor(town.col - radius)); col <= town.col + radius; col++) {
        if (row >= S || col >= S) continue;
        const i = row * S + col;
        const d = Math.hypot(col - town.col, row - town.row);
        if (d > radius || !isLand(i) || slope[i]! > 0.4) continue;
        if (structure[i] === Structure.Road) continue;
        if (col % 8 === 0 || row % 8 === 0) {
          structure[i] = Structure.Road;
          continue;
        }
        if (col % 2 !== 0 || row % 2 !== 0) continue;
        const chance = 0.1 + 0.85 * (1 - d / radius) ** 0.7;
        if (!rng.chance(chance)) continue;
        const downtown = d < radius * 0.35 && town.population > 15000 && rng.chance(0.18);
        structure[i] = downtown ? Structure.Tower : Structure.House;
        townCells[t]!.push(i);
      }
    }
  });

  // Farms in patches around the towns.
  const farmCells: number[] = [];
  towns.forEach((town) => {
    const inner = townRadius(town.population) * 1.1;
    const outer = inner + 18 + Math.sqrt(town.population) / 30;
    for (let row = Math.max(0, Math.floor(town.row - outer)); row <= town.row + outer; row++) {
      for (let col = Math.max(0, Math.floor(town.col - outer)); col <= town.col + outer; col++) {
        if (row >= S || col >= S) continue;
        const i = row * S + col;
        const d = Math.hypot(col - town.col, row - town.row);
        if (d < inner || d > outer || structure[i] !== Structure.None) continue;
        if (!isLand(i) || slope[i]! > 0.12 || !FARM_BIOMES.has(biome[i]!)) continue;
        if (noise.noise2(col * 0.05 + 300, row * 0.05 + 300) > 0.1) {
          structure[i] = Structure.Farm;
          farmCells.push(i);
        }
      }
    }
  });

  // People: towns hold ~85 %, the countryside the rest. Houses weigh 1, towers 8.
  const farmShare = farmCells.length > 0 ? 0.15 : 0;
  towns.forEach((town, t) => {
    const cells = townCells[t]!;
    const weight = cells.reduce((w, i) => w + (structure[i] === Structure.Tower ? 8 : 1), 0);
    for (const i of cells) {
      const w = structure[i] === Structure.Tower ? 8 : 1;
      region.population[i] = (town.population * (1 - farmShare) * w) / weight;
    }
  });
  for (const i of farmCells) {
    region.population[i] = (regionPop * 0.85 * farmShare) / farmCells.length;
  }

  for (let i = 0; i < structure.length; i++) {
    if (structure[i] === Structure.None) continue;
    structHP[i] = 1;
    if (structure[i] === Structure.Farm) fuel[i] = Math.min(fuel[i]!, 0.35);
    else fuel[i] = Math.min(fuel[i]!, structure[i] === Structure.Road ? 0 : 0.1);
  }
}

function townRadius(population: number): number {
  return clamp(3 + Math.sqrt(population) / 12, 4, 28);
}

function placeTowns(region: RegionWorld, slope: Float32Array, rng: Rng, regionPop: number): Town[] {
  const count = clamp(Math.floor(Math.log10(regionPop)) - 1, 1, 6);
  const nameOf = createNameGenerator(rng.fork('names'));
  const margin = 30;
  const MIN_SPACING = 50;
  const spots: { col: number; row: number }[] = [];
  for (let attempt = 0; attempt < 600 && spots.length < count; attempt++) {
    const col = rng.int(margin, S - 1 - margin);
    const row = rng.int(margin, S - 1 - margin);
    const i = row * S + col;
    if (region.height[i]! < 3 || region.water[i]! > 0.05 || slope[i]! > 0.2) continue;
    if (spots.some((o) => Math.hypot(o.col - col, o.row - row) < MIN_SPACING)) continue;
    spots.push({ col, row });
  }
  const weights = spots.map(() => rng.float(0.25, 1) ** 2);
  const total = weights.reduce((a, b) => a + b, 0);
  return spots.map((spot, k) => ({
    name: nameOf(),
    ...spot,
    population: Math.round((regionPop * 0.85 * weights[k]!) / total),
  }));
}

/** Prim's algorithm over town centers; returns index pairs. */
function spanningTree(towns: Town[]): [number, number][] {
  const edges: [number, number][] = [];
  const inTree = new Set<number>([0]);
  while (inTree.size < towns.length) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const a of inTree) {
      for (let b = 0; b < towns.length; b++) {
        if (inTree.has(b)) continue;
        const d = Math.hypot(towns[a]!.col - towns[b]!.col, towns[a]!.row - towns[b]!.row);
        if (d < bestD) {
          bestD = d;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    edges.push(best);
    inTree.add(best[1]);
  }
  return edges;
}

/** Terrain-cost A* between two towns. Water is passable (bridges) but expensive. */
function routeRoad(region: RegionWorld, slope: Float32Array, from: Town, to: Town): number[] {
  const start = from.row * S + from.col;
  const goal = to.row * S + to.col;
  const g = new Float32Array(S * S).fill(Infinity);
  const parent = new Int32Array(S * S).fill(-1);
  const closed = new Uint8Array(S * S);
  const heap = new MinHeap();
  const heuristic = (i: number) => {
    const dx = Math.abs((i % S) - to.col);
    const dy = Math.abs(Math.floor(i / S) - to.row);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  g[start] = 0;
  heap.push(start, heuristic(start));
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const col = cur % S;
    const row = Math.floor(cur / S);
    for (const [dc, dr] of NEIGHBORS8) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= S || r >= S) continue;
      const j = r * S + c;
      if (closed[j]) continue;
      const stepLen = dc !== 0 && dr !== 0 ? Math.SQRT2 : 1;
      const cost =
        stepLen * (1 + 14 * slope[j]!) +
        (region.water[j]! > 0.05 || region.height[j]! < 1 ? 30 : 0);
      if (g[cur]! + cost < g[j]!) {
        g[j] = g[cur]! + cost;
        parent[j] = cur;
        heap.push(j, g[j]! + heuristic(j));
      }
    }
  }
  const path: number[] = [];
  for (let cur = goal; cur >= 0; cur = parent[cur]!) {
    path.push(cur);
    if (cur === start) break;
  }
  return path;
}

/** Binary min-heap of (item, priority) pairs. */
class MinHeap {
  private items: number[] = [];
  private prios: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, prio: number): void {
    let i = this.items.length;
    this.items.push(item);
    this.prios.push(prio);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prios[p]! <= prio) break;
      this.items[i] = this.items[p]!;
      this.prios[i] = this.prios[p]!;
      i = p;
    }
    this.items[i] = item;
    this.prios[i] = prio;
  }

  pop(): number {
    const top = this.items[0]!;
    const item = this.items.pop()!;
    const prio = this.prios.pop()!;
    const n = this.items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.prios[c + 1]! < this.prios[c]!) c++;
        if (this.prios[c]! >= prio) break;
        this.items[i] = this.items[c]!;
        this.prios[i] = this.prios[c]!;
        i = c;
      }
      this.items[i] = item;
      this.prios[i] = prio;
    }
    return top;
  }
}
