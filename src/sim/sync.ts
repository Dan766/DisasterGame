/**
 * Region → globe sync (DESIGN.md §3.6): folds what happened inside a regional diorama
 * (deaths, lost structures, burnt ground) into the overlapping global cells, so leaving a
 * region shows its damage on the globe and in the global stats.
 *
 * A `RegionSyncer` is created when a region is entered (after stored scars and globe strikes
 * were applied, since the globe already accounts for those) and is incremental: each `sync`
 * pushes only what changed since the previous one, so periodic syncs and the final sync on
 * exit never double count. Pure typed-array code, no DOM or three.js.
 */
import { wrapLon } from '../core/geo';
import { M_PER_DEG_LAT, REGION_CELL_M, Structure, FireState, type RegionWorld } from './region';
import { cellAt, type GlobalWorld } from './world';

/** Replacement value of a lost structure, USD. */
export const STRUCTURE_VALUE_USD: Readonly<Record<number, number>> = {
  [Structure.House]: 250_000,
  [Structure.Tower]: 5_000_000,
  [Structure.Farm]: 400_000,
};

/** Globe fire intensity per unit of the cell's area newly scorched (makes small burns visible). */
const SCORCH_GAIN = 12;

const REGION_CELL_KM2 = (REGION_CELL_M / 1000) ** 2;

/** What the globe needs to show scorched ground; implemented by `GlobeSim`. */
export interface GlobeFireSink {
  igniteCell(cell: number, intensity: number): void;
}

export interface SyncResult {
  deaths: number;
  structuresLost: number;
  damageUSD: number;
  /** Region cells newly burnt since the previous sync. */
  burntCells: number;
}

const alive = (region: RegionWorld, i: number): boolean => {
  const s = region.structure[i]!;
  return s !== Structure.None && s !== Structure.Road && region.structHP[i]! > 0;
};

export class RegionSyncer {
  private readonly globeCell: Int32Array;
  private readonly lastPop: Float32Array;
  /** Structure type of cells whose structure stood at the last sync, else 0. */
  private readonly lastStanding: Uint8Array;
  private readonly lastBurnt: Uint8Array;
  /** Per overlapped global cell: region cells inside it and structures standing at entry. */
  private readonly cellsIn = new Map<number, number>();
  private readonly structsIn = new Map<number, number>();

  constructor(
    private readonly region: RegionWorld,
    private readonly world: GlobalWorld,
  ) {
    const n = region.size * region.size;
    this.globeCell = new Int32Array(n);
    this.lastPop = Float32Array.from(region.population);
    this.lastStanding = new Uint8Array(n);
    this.lastBurnt = new Uint8Array(n);
    const cosLat = Math.max(0.05, Math.cos((region.lat * Math.PI) / 180));
    const half = region.size / 2;
    for (let row = 0; row < region.size; row++) {
      const lat = region.lat + ((half - (row + 0.5)) * REGION_CELL_M) / M_PER_DEG_LAT;
      for (let col = 0; col < region.size; col++) {
        const i = row * region.size + col;
        const lon = region.lon + ((col + 0.5 - half) * REGION_CELL_M) / (M_PER_DEG_LAT * cosLat);
        const g = cellAt(world, Math.max(-90, Math.min(90, lat)), wrapLon(lon));
        this.globeCell[i] = g;
        this.cellsIn.set(g, (this.cellsIn.get(g) ?? 0) + 1);
        if (alive(region, i)) {
          this.lastStanding[i] = region.structure[i]!;
          this.structsIn.set(g, (this.structsIn.get(g) ?? 0) + 1);
        }
        this.lastBurnt[i] = region.fireState[i] !== FireState.Unburnt ? 1 : 0;
      }
    }
  }

  /** Pushes everything that changed since the last call into the global world. */
  sync(sink?: GlobeFireSink): SyncResult {
    const { region, world } = this;
    const deathsIn = new Map<number, number>();
    const lostIn = new Map<number, number>();
    const burntIn = new Map<number, number>();
    const result: SyncResult = { deaths: 0, structuresLost: 0, damageUSD: 0, burntCells: 0 };
    const add = (m: Map<number, number>, g: number, v: number) => m.set(g, (m.get(g) ?? 0) + v);

    for (let i = 0; i < this.globeCell.length; i++) {
      const g = this.globeCell[i]!;
      const pop = region.population[i]!;
      if (pop < this.lastPop[i]!) {
        add(deathsIn, g, this.lastPop[i]! - pop);
        result.deaths += this.lastPop[i]! - pop;
      }
      this.lastPop[i] = pop;

      const type = this.lastStanding[i]!;
      if (type !== 0 && !alive(region, i)) {
        add(lostIn, g, 1);
        result.structuresLost++;
        result.damageUSD += STRUCTURE_VALUE_USD[type] ?? 0;
        this.lastStanding[i] = 0;
      }

      if (!this.lastBurnt[i] && region.fireState[i] !== FireState.Unburnt) {
        add(burntIn, g, 1);
        result.burntCells++;
        this.lastBurnt[i] = 1;
      }
    }

    for (const [g, deaths] of deathsIn) {
      world.population[g] = Math.max(0, world.population[g]! - deaths);
    }
    for (const [g, lost] of lostIn) {
      const row = Math.floor(g / world.width);
      const coverage = Math.min(
        1,
        ((this.cellsIn.get(g) ?? 0) * REGION_CELL_KM2) / world.rowAreaKm2[row]!,
      );
      const share = lost / Math.max(1, this.structsIn.get(g) ?? 1);
      const before = world.damage[g]!;
      world.damage[g] = 1 - (1 - before) * (1 - Math.min(1, coverage * share));
    }
    if (sink) {
      for (const [g, cells] of burntIn) {
        const row = Math.floor(g / world.width);
        const intensity = Math.min(
          1,
          ((cells * REGION_CELL_KM2) / world.rowAreaKm2[row]!) * SCORCH_GAIN,
        );
        sink.igniteCell(g, intensity);
      }
    }

    world.stats.casualties += result.deaths;
    world.stats.damageUSD += result.damageUSD;
    return result;
  }
}
