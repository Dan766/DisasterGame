/**
 * Regional earthquake (DESIGN.md §5.4 backlog): a shaking event around an epicentre.
 * - Shaking intensity (0–1) falls off with distance from the epicentre and follows a
 *   rise / plateau / decay envelope over the quake's duration.
 * - Structures take damage in proportion to the shaking (through the shared ledger).
 * - The ground jitters: a small permanent random height offset, strongest near the epicentre.
 * - Landslides: on steep slopes under strong shaking, soil slumps to the lowest neighbour,
 *   burying whatever stands on the receiving cell and undermining the source cell.
 * Deterministic given the RNG stream; pure typed-array code like the other systems.
 */
import type { Rng } from '../../core/rng';
import { REGION_CELL_M, type RegionWorld } from '../region';
import { Lethality, damageStructure, type DamageLedger } from './structureDamage';

/** Slope (rise over run) above which shaking can start a landslide. */
export const LANDSLIDE_SLOPE = 0.35;
/** Largest permanent height jitter, meters, at peak intensity. */
const MAX_JITTER_M = 0.4;
/** Structure HP lost per second at full intensity (structures spawn with 1 HP). */
const STRUCTURE_DPS = 0.5;

export interface QuakeSpec {
  col: number;
  row: number;
  /** Moment magnitude, 4–9. */
  magnitude: number;
  /** Shaking duration, seconds; defaults from magnitude. */
  durationS?: number;
}

/** Radius in cells within which a quake of this magnitude is felt (zero intensity beyond). */
export function quakeReachCells(magnitude: number): number {
  const km = Math.pow(10, 0.5 * magnitude - 1.8);
  return (km * 1000) / REGION_CELL_M;
}

/** Peak shaking intensity (0–1) at `distCells` from the epicentre. */
export function quakeIntensity(magnitude: number, distCells: number): number {
  const mag = Math.min(1, Math.max(0, (magnitude - 4) / 4));
  const reach = quakeReachCells(magnitude);
  if (distCells >= reach) return 0;
  return mag * Math.pow(1 - distCells / reach, 1.5);
}

export class Quake {
  elapsed = 0;
  readonly durationS: number;
  readonly reachCells: number;
  /** Total cells that slid this quake. */
  landslides = 0;

  constructor(readonly spec: QuakeSpec) {
    this.durationS = spec.durationS ?? 4 + 3 * Math.max(0, spec.magnitude - 4);
    this.reachCells = quakeReachCells(spec.magnitude);
  }

  /** 0–1 shaking envelope: quick rise (15 %), plateau, then a long decay. */
  get envelope(): number {
    const t = this.elapsed / this.durationS;
    if (t < 0 || t >= 1) return 0;
    if (t < 0.15) return t / 0.15;
    if (t < 0.5) return 1;
    return 1 - (t - 0.5) / 0.5;
  }

  get alive(): boolean {
    return this.elapsed < this.durationS;
  }
}

export interface QuakeStepResult {
  /** True if terrain heights changed this step (the view must refresh the mesh). */
  terrainChanged: boolean;
  landslides: number;
}

/** Advances one quake by `dt`. Mutates height, structure HP and the ledger. */
export function stepQuake(
  region: RegionWorld,
  q: Quake,
  rng: Rng,
  dt: number,
  ledger: DamageLedger,
): QuakeStepResult {
  const out: QuakeStepResult = { terrainChanged: false, landslides: 0 };
  const env = q.envelope;
  q.elapsed += dt;
  if (env <= 0) return out;

  const s = region.size;
  const { magnitude, col: ec, row: er } = q.spec;
  const reach = q.reachCells;
  const magScale = Math.min(1, Math.max(0, (magnitude - 4) / 4));
  const c0 = Math.max(1, Math.floor(ec - reach));
  const c1 = Math.min(s - 2, Math.ceil(ec + reach));
  const r0 = Math.max(1, Math.floor(er - reach));
  const r1 = Math.min(s - 2, Math.ceil(er + reach));
  const h = region.height;
  const slidThisStep = new Set<number>();

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const x = 1 - Math.sqrt((col - ec) * (col - ec) + (row - er) * (row - er)) / reach;
      if (x <= 0) continue;
      const k = magScale * x * Math.sqrt(x) * env; // == quakeIntensity(...) * env, minus the pow
      if (k < 0.01) continue;
      const i = row * s + col;

      damageStructure(
        region,
        i,
        k * STRUCTURE_DPS * dt * (0.5 + rng.next()),
        Lethality.Quake,
        ledger,
      );

      if (k > 0.05) {
        h[i] = h[i]! + (rng.next() - 0.5) * 2 * MAX_JITTER_M * k * dt;
        out.terrainChanged = true;
      }

      if (k < 0.25 || slidThisStep.has(i)) continue;
      // Steepest descent among the 4 neighbours.
      let best = -1;
      let drop = 0;
      for (const n of [i - 1, i + 1, i - s, i + s]) {
        const dh = h[i]! - h[n]!;
        if (dh > drop) {
          drop = dh;
          best = n;
        }
      }
      const slope = drop / REGION_CELL_M;
      if (best < 0 || slope < LANDSLIDE_SLOPE) continue;
      // Chance grows with shaking and with how far past the threshold the slope is.
      if (rng.next() > k * (slope / LANDSLIDE_SLOPE) * 0.5 * dt * 10) continue;

      const moved = drop * 0.4;
      h[i] = h[i]! - moved;
      h[best] = h[best]! + moved;
      slidThisStep.add(best);
      damageStructure(region, best, 2, Lethality.Landslide, ledger);
      damageStructure(region, i, 0.5, Lethality.Landslide, ledger);
      out.landslides++;
      out.terrainChanged = true;
    }
  }
  q.landslides += out.landslides;
  return out;
}
