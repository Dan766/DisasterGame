/**
 * Procedural planet generation (DESIGN.md §3.3).
 * Elevation → sea level → climate → biomes → population → cities.
 * Every field is sampled in 3D on the unit sphere, so there are no seams.
 */
import { greatCircleDistance, latLonToVec3 } from '../../core/geo';
import { clamp01, smoothstep } from '../../core/math';
import { createNoise, fbm3, ridged3 } from '../../core/noise';
import { createRng } from '../../core/rng';
import {
  Biome,
  GLOBE_HEIGHT,
  GLOBE_WIDTH,
  cellCenter,
  createGlobalWorld,
  type City,
  type GlobalWorld,
} from '../world';
import { createNameGenerator } from './names';

export interface GlobeGenOptions {
  width?: number;
  height?: number;
  /** Area-weighted fraction of the surface below sea level. */
  oceanFraction?: number;
  worldPopulation?: number;
  maxCities?: number;
  /** Minimum great-circle spacing between cities. */
  citySpacingKm?: number;
}

const MAX_DEPTH_M = 6000;
const SHELF_DEPTH_M = 150;
const MAX_HEIGHT_M = 7500;

/** Relative habitability per biome, indexed by Biome. */
const HABITABILITY = [0, 0, 0.04, 0.55, 1, 0.06, 0.4, 0.03];

export function generateGlobe(seed: string, options: GlobeGenOptions = {}): GlobalWorld {
  const {
    width = GLOBE_WIDTH,
    height = GLOBE_HEIGHT,
    oceanFraction = 0.68,
    worldPopulation = 8e9,
    maxCities = 48,
    citySpacingKm = 500,
  } = options;

  const world = createGlobalWorld(seed, width, height);
  const { elevation, biome, population, baseTemp, moisture, rowAreaKm2 } = world;
  const n = width * height;
  const rng = createRng(seed);
  const terrainNoise = createNoise(rng.fork('terrain').seed);
  const warpNoise = createNoise(rng.fork('warp').seed);
  const ridgeNoise = createNoise(rng.fork('ridges').seed);
  const climateNoise = createNoise(rng.fork('climate').seed);
  const peopleNoise = createNoise(rng.fork('people').seed);

  // Unit-sphere position of every cell center.
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const { lat, lon } = cellCenter(world, i);
    const v = latLonToVec3(lat, lon);
    px[i] = v.x;
    py[i] = v.y;
    pz[i] = v.z;
  }

  // 1. Raw height: domain-warped continents + ridged mountains on land.
  const raw = new Float32Array(n);
  let rawMin = Infinity;
  let rawMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = px[i]!;
    const y = py[i]!;
    const z = pz[i]!;
    const warpOpts = { octaves: 3 };
    const wx = x + 0.35 * fbm3(warpNoise, x * 1.4 + 11.3, y * 1.4, z * 1.4, warpOpts);
    const wy = y + 0.35 * fbm3(warpNoise, x * 1.4, y * 1.4 + 27.1, z * 1.4, warpOpts);
    const wz = z + 0.35 * fbm3(warpNoise, x * 1.4, y * 1.4, z * 1.4 + 41.7, warpOpts);
    const continent = fbm3(terrainNoise, wx * 1.1, wy * 1.1, wz * 1.1, { octaves: 6 });
    const ridge = ridged3(ridgeNoise, wx * 2.6, wy * 2.6, wz * 2.6, { octaves: 5 });
    const h = continent + smoothstep(-0.05, 0.25, continent) * 0.45 * ridge ** 3;
    raw[i] = h;
    if (h < rawMin) rawMin = h;
    if (h > rawMax) rawMax = h;
  }

  // 2. Sea level at the area-weighted ocean quantile.
  const seaRaw = areaWeightedQuantile(raw, rawMin, rawMax, oceanFraction, width, rowAreaKm2);

  // 3. Convert to meters: shallow continental shelves, then the abyss; land skewed low.
  for (let i = 0; i < n; i++) {
    const r = raw[i]!;
    if (r < seaRaw) {
      const t = (seaRaw - r) / (seaRaw - rawMin);
      elevation[i] = -(
        SHELF_DEPTH_M * Math.min(t / 0.06, 1) +
        (MAX_DEPTH_M - SHELF_DEPTH_M) * smoothstep(0.06, 0.6, t)
      );
    } else {
      const t = (r - seaRaw) / (rawMax - seaRaw);
      elevation[i] = 1 + MAX_HEIGHT_M * t ** 1.7;
    }
  }

  // 4. Distance (in cells) from each land cell to the nearest ocean.
  const coastDist = distanceToOcean(elevation, width, height);

  // 5–6. Climate and biomes.
  for (let i = 0; i < n; i++) {
    const x = px[i]!;
    const y = py[i]!;
    const z = pz[i]!;
    const latAbs = Math.abs((Math.asin(y) * 180) / Math.PI);
    const elev = elevation[i]!;
    const isOcean = elev < 0;

    const temp =
      28 -
      50 * (latAbs / 90) ** 1.25 -
      (6.5 * Math.max(0, elev)) / 1000 +
      4 * fbm3(climateNoise, x * 2, y * 2, z * 2, { octaves: 3 });

    // Wet equator, dry subtropics (~28°), wet mid-latitudes (~56°), dry poles.
    const bands = 0.5 + 0.3 * Math.cos((latAbs * 2 * Math.PI) / 56);
    const coastal = isOcean ? 1 : Math.exp(-coastDist[i]! / 10);
    const wet = clamp01(
      bands * 0.6 +
        coastal * 0.35 +
        0.35 * fbm3(climateNoise, x * 3 + 5.1, y * 3 + 5.1, z * 3 + 5.1, { octaves: 4 }),
    );

    baseTemp[i] = temp;
    moisture[i] = wet;
    biome[i] = classifyBiome(elev, temp, wet);
  }

  // 7. Population: habitability × coast bonus × comfort × clumping, scaled to the target.
  let popSum = 0;
  for (let i = 0; i < n; i++) {
    const hab = HABITABILITY[biome[i]!]!;
    if (hab === 0) continue;
    const x = px[i]!;
    const y = py[i]!;
    const z = pz[i]!;
    const row = Math.floor(i / width);
    const clump = clamp01(0.5 + 0.6 * fbm3(peopleNoise, x * 7, y * 7, z * 7, { octaves: 4 })) ** 3;
    const comfort = Math.exp(-(((baseTemp[i]! - 17) / 12) ** 2));
    const coastBonus = 1 + 2 * Math.exp(-coastDist[i]! / 2.5);
    const altitudePenalty = elevation[i]! > 2000 ? 0.3 : 1;
    const p = hab * comfort * clump * coastBonus * altitudePenalty * rowAreaKm2[row]!;
    population[i] = p;
    popSum += p;
  }
  if (popSum > 0) {
    const scale = worldPopulation / popSum;
    for (let i = 0; i < n; i++) population[i] *= scale;
  }
  world.stats.initialPopulation = popSum > 0 ? worldPopulation : 0;

  // 8. Cities at the densest cells, kept apart from each other.
  world.cities = placeCities(
    world,
    maxCities,
    citySpacingKm,
    createNameGenerator(rng.fork('names')),
  );

  return world;
}

export function classifyBiome(elev: number, temp: number, wet: number): Biome {
  if (elev < 0) return temp < -10 ? Biome.Ice : Biome.Ocean;
  if (temp < -12) return Biome.Ice;
  if (elev > 3200) return Biome.Mountain;
  if (temp < 2) return Biome.Tundra;
  if (wet < 0.28) return temp > 8 ? Biome.Desert : Biome.Grassland;
  if (temp > 20 && wet > 0.6) return Biome.Jungle;
  if (wet > 0.45) return Biome.Forest;
  return Biome.Grassland;
}

function areaWeightedQuantile(
  values: Float32Array,
  min: number,
  max: number,
  q: number,
  width: number,
  rowArea: Float64Array,
): number {
  const BINS = 4096;
  const hist = new Float64Array(BINS);
  const range = max - min || 1;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    const w = rowArea[Math.floor(i / width)]!;
    hist[Math.floor(((values[i]! - min) / range) * (BINS - 1))] += w;
    total += w;
  }
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b]!;
    if (acc >= q * total) return min + ((b + 1) / (BINS - 1)) * range;
  }
  return max;
}

/** Multi-source BFS from all ocean cells; longitude wraps, latitude clamps. */
function distanceToOcean(elevation: Float32Array, width: number, height: number): Int32Array {
  const n = width * height;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (elevation[i]! < 0) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++]!;
    const col = i % width;
    const row = (i - col) / width;
    const d = dist[i]! + 1;
    const neighbors = [
      row * width + ((col + 1) % width),
      row * width + ((col - 1 + width) % width),
      row > 0 ? i - width : -1,
      row < height - 1 ? i + width : -1,
    ];
    for (const j of neighbors) {
      if (j >= 0 && dist[j] === -1) {
        dist[j] = d;
        queue[tail++] = j;
      }
    }
  }
  // A world with no ocean at all: treat everything as far inland.
  for (let i = 0; i < n; i++) if (dist[i] === -1) dist[i] = 1e6;
  return dist;
}

function placeCities(
  world: GlobalWorld,
  maxCities: number,
  spacingKm: number,
  nextName: () => string,
): City[] {
  const { population, width, height } = world;
  const candidates: number[] = [];
  for (let i = 0; i < population.length; i++) if (population[i]! > 0) candidates.push(i);
  candidates.sort((a, b) => population[b]! - population[a]!);

  const cities: City[] = [];
  for (const cell of candidates) {
    if (cities.length >= maxCities) break;
    const { lat, lon } = cellCenter(world, cell);
    if (cities.some((c) => greatCircleDistance(c, { lat, lon }) < spacingKm)) continue;

    const col = cell % width;
    const row = (cell - col) / width;
    let pop = 0;
    for (let dr = -1; dr <= 1; dr++) {
      const r = row + dr;
      if (r < 0 || r >= height) continue;
      for (let dc = -1; dc <= 1; dc++) pop += population[r * width + ((col + dc + width) % width)]!;
    }
    cities.push({ name: nextName(), lat, lon, cell, population: pop });
  }
  return cities;
}
