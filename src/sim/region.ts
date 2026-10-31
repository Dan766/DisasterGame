/**
 * Regional world state: a 256 × 256 cell, 100 m/cell diorama (DESIGN.md §3.4).
 * Index a cell with `row * REGION_SIZE + col`; row 0 is the northern edge and
 * column 0 the western edge.
 */

export const REGION_SIZE = 256;
export const REGION_CELL_M = 100;
/** Region edge length in km. */
export const REGION_EXTENT_KM = (REGION_SIZE * REGION_CELL_M) / 1000;

export const Structure = { None: 0, House: 1, Tower: 2, Road: 3, Farm: 4 } as const;
export type Structure = (typeof Structure)[keyof typeof Structure];

export const FireState = { Unburnt: 0, Burning: 1, Burnt: 2 } as const;

export interface Town {
  name: string;
  /** Cell coordinates of the town center. */
  col: number;
  row: number;
  population: number;
}

/** Persistent scars on a region; base terrain is always regenerated from the seed. */
export interface RegionDelta {
  craters: { col: number; row: number; radiusCells: number }[];
  /** Run-length encoded burn mask (alternating run lengths, starting with unburnt). */
  burnMaskRLE: number[];
  destroyedStructIds: number[];
  /** Flat `[cell, population, ...]` pairs: residents left in cells whose structure collapsed. */
  survivors: number[];
  deaths: number;
  /** How many globe-scale strikes (see `RegionDeltaStore.strikes`) were already folded in. */
  strikesApplied: number;
}

export function emptyDelta(): RegionDelta {
  return {
    craters: [],
    burnMaskRLE: [],
    destroyedStructIds: [],
    survivors: [],
    deaths: 0,
    strikesApplied: 0,
  };
}

/** An asteroid that hit the globe; regions it reaches replay it the first time they are entered. */
export interface GlobalStrike {
  lat: number;
  lon: number;
  /** Zero for airbursts. */
  craterRadiusKm: number;
  blastRadiusKm: number;
  thermalRadiusKm: number;
}

export const M_PER_DEG_LAT = 111_320;

/** In-memory per-region delta store, keyed by region id. IndexedDB comes later. */
export class RegionDeltaStore {
  private readonly deltas = new Map<string, RegionDelta>();
  /** Globe-scale strikes in the order they happened. */
  readonly strikes: GlobalStrike[] = [];

  recordStrike(strike: GlobalStrike): void {
    this.strikes.push({ ...strike });
  }

  get(id: string): RegionDelta | undefined {
    return this.deltas.get(id);
  }

  getOrCreate(id: string): RegionDelta {
    let delta = this.deltas.get(id);
    if (!delta) {
      delta = emptyDelta();
      this.deltas.set(id, delta);
    }
    return delta;
  }

  set(id: string, delta: RegionDelta): void {
    this.deltas.set(id, delta);
  }

  clear(): void {
    this.deltas.clear();
    this.strikes.length = 0;
  }
}

export interface RegionWorld {
  /** Stable key: "<lat>,<lon>" quantized to 0.01°. */
  readonly id: string;
  readonly seed: number;
  /** Quantized region center. */
  readonly lat: number;
  readonly lon: number;
  readonly size: number;
  /** Biome at the region center (drives the sky/fog palette). */
  readonly centerBiome: number;
  /** Meters above sea level. */
  readonly height: Float32Array;
  /** Water depth above terrain, meters. */
  readonly water: Float32Array;
  /** Per-cell biome (Biome enum). */
  readonly biome: Uint8Array;
  /** Burnable biomass, 0–1. */
  readonly fuel: Float32Array;
  /** 0–1, dampens fire. */
  readonly moisture: Float32Array;
  readonly fireState: Uint8Array;
  readonly heat: Float32Array;
  readonly structure: Uint8Array;
  readonly structHP: Float32Array;
  /** People in cell. */
  readonly population: Float32Array;
  towns: Town[];
}

export function regionId(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export function createRegionWorld(
  id: string,
  seed: number,
  lat: number,
  lon: number,
  centerBiome: number,
): RegionWorld {
  const n = REGION_SIZE * REGION_SIZE;
  return {
    id,
    seed,
    lat,
    lon,
    size: REGION_SIZE,
    centerBiome,
    height: new Float32Array(n),
    water: new Float32Array(n),
    biome: new Uint8Array(n),
    fuel: new Float32Array(n),
    moisture: new Float32Array(n),
    fireState: new Uint8Array(n),
    heat: new Float32Array(n),
    structure: new Uint8Array(n),
    structHP: new Float32Array(n),
    population: new Float32Array(n),
    towns: [],
  };
}

/** Bilinear terrain height (m) at fractional cell coordinates, clamped to the region. */
export function heightAtCell(region: RegionWorld, col: number, row: number): number {
  const max = region.size - 1;
  const x = Math.max(0, Math.min(max, col));
  const y = Math.max(0, Math.min(max, row));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(max, x0 + 1);
  const y1 = Math.min(max, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const h = region.height;
  const s = region.size;
  const top = h[y0 * s + x0]! * (1 - fx) + h[y0 * s + x1]! * fx;
  const bottom = h[y1 * s + x0]! * (1 - fx) + h[y1 * s + x1]! * fx;
  return top * (1 - fy) + bottom * fy;
}
