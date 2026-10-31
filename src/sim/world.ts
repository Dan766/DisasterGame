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
  ocean: boolean;
}

/** The ash layer is coarser than the surface grid; ash transport is smooth and runs every tick. */
export const ASH_DOWNSAMPLE = 4;

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
  /**
   * Atmospheric dust/ash optical depth (τ, unbounded) on a coarse equirectangular grid of
   * `ashWidth × ashHeight` cells covering the same lat/lon extent as the surface layers.
   */
  readonly ash: Float32Array;
  readonly ashWidth: number;
  readonly ashHeight: number;
  /** km² covered by one ash cell in each ash row. */
  readonly ashRowAreaKm2: Float64Array;
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

/** km² of one equirectangular cell in each row. */
export function rowAreas(width: number, height: number): Float64Array {
  const areas = new Float64Array(height);
  const dLon = degToRad(360 / width);
  for (let row = 0; row < height; row++) {
    const north = degToRad(90 - (row * 180) / height);
    const south = degToRad(90 - ((row + 1) * 180) / height);
    areas[row] = PLANET_RADIUS_KM ** 2 * dLon * (Math.sin(north) - Math.sin(south));
  }
  return areas;
}

export function createGlobalWorld(seed: string, width: number, height: number): GlobalWorld {
  const n = width * height;
  const ashWidth = Math.max(8, Math.floor(width / ASH_DOWNSAMPLE));
  const ashHeight = Math.max(4, Math.floor(height / ASH_DOWNSAMPLE));
  return {
    seed,
    width,
    height,
    elevation: new Float32Array(n),
    biome: new Uint8Array(n),
    population: new Float32Array(n),
    baseTemp: new Float32Array(n),
    moisture: new Float32Array(n),
    ash: new Float32Array(ashWidth * ashHeight),
    ashWidth,
    ashHeight,
    ashRowAreaKm2: rowAreas(ashWidth, ashHeight),
    fire: new Float32Array(n),
    damage: new Float32Array(n),
    rowAreaKm2: rowAreas(width, height),
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

/** People still alive: every death is booked as a casualty, so this stays exact. */
export function livingPopulation(world: GlobalWorld): number {
  return Math.max(0, world.stats.initialPopulation - world.stats.casualties);
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
