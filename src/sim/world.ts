/**
 * Global world state: equirectangular layers stored as typed arrays (DESIGN.md §3.2).
 * Index a cell with `row * width + col`; row 0 is the northernmost row.
 */
import { PLANET_RADIUS_KM, cellToLatLon, degToRad, latLonToCell } from '../core/geo';

export const GLOBE_WIDTH = 512;
export const GLOBE_HEIGHT = 256;

export const Biome = {
  Ocean: 0,
  Ice: 1,
  Tundra: 2,
  Forest: 3,
  Grassland: 4,
  Desert: 5,
  Jungle: 6,
  Mountain: 7,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES: readonly string[] = [
  'Ocean',
  'Ice',
  'Tundra',
  'Forest',
  'Grassland',
  'Desert',
  'Jungle',
  'Mountains',
];

export interface City {
  name: string;
  lat: number;
  lon: number;
  /** Cell index of the city center. */
  cell: number;
  /** People in the city's 3×3 cell neighborhood. */
  population: number;
}

export interface Crater {
  lat: number;
  lon: number;
  radiusKm: number;
}

export interface GlobalStats {
  initialPopulation: number;
  casualties: number;
  damageUSD: number;
  globalTempAnomaly: number;
  simDays: number;
}

export interface GlobalWorld {
  readonly seed: string;
  readonly width: number;
  readonly height: number;
  /** Meters; < 0 is ocean. */
  readonly elevation: Float32Array;
  readonly biome: Uint8Array;
  /** People in the cell. */
  readonly population: Float32Array;
  /** °C climate baseline. */
  readonly baseTemp: Float32Array;
  /** 0–1. */
  readonly moisture: Float32Array;
  /** Atmospheric dust/ash optical depth, 0–1. */
  readonly ash: Float32Array;
  /** Fraction of cell burning, 0–1. */
  readonly fire: Float32Array;
  /** Fraction of infrastructure destroyed, 0–1. */
  readonly damage: Float32Array;
  /** km² covered by one cell in each row (index by row). */
  readonly rowAreaKm2: Float64Array;
  cities: City[];
  craters: Crater[];
  stats: GlobalStats;
}

export function createGlobalWorld(seed: string, width: number, height: number): GlobalWorld {
  const n = width * height;
  const rowAreaKm2 = new Float64Array(height);
  const dLon = degToRad(360 / width);
  for (let row = 0; row < height; row++) {
    const north = degToRad(90 - (row * 180) / height);
    const south = degToRad(90 - ((row + 1) * 180) / height);
    rowAreaKm2[row] = PLANET_RADIUS_KM ** 2 * dLon * (Math.sin(north) - Math.sin(south));
  }
  return {
    seed,
    width,
    height,
    elevation: new Float32Array(n),
    biome: new Uint8Array(n),
    population: new Float32Array(n),
    baseTemp: new Float32Array(n),
    moisture: new Float32Array(n),
    ash: new Float32Array(n),
    fire: new Float32Array(n),
    damage: new Float32Array(n),
    rowAreaKm2,
    cities: [],
    craters: [],
    stats: { initialPopulation: 0, casualties: 0, damageUSD: 0, globalTempAnomaly: 0, simDays: 0 },
  };
}

export function cellAt(world: GlobalWorld, lat: number, lon: number): number {
  const { col, row } = latLonToCell(lat, lon, world.width, world.height);
  return row * world.width + col;
}

export function cellCenter(world: GlobalWorld, cell: number) {
  return cellToLatLon(
    cell % world.width,
    Math.floor(cell / world.width),
    world.width,
    world.height,
  );
}

export function totalPopulation(world: GlobalWorld): number {
  let sum = 0;
  for (let i = 0; i < world.population.length; i++) sum += world.population[i]!;
  return sum;
}

/** Area-weighted fraction of the surface that is ocean. */
export function oceanFraction(world: GlobalWorld): number {
  let ocean = 0;
  let total = 0;
  for (let row = 0; row < world.height; row++) {
    const area = world.rowAreaKm2[row]!;
    for (let col = 0; col < world.width; col++) {
      if (world.elevation[row * world.width + col]! < 0) ocean += area;
      total += area;
    }
  }
  return ocean / total;
}
