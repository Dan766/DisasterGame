/**
 * Regional shallow-water flow (DESIGN.md §4.2): a virtual-pipes solver over `height` + `water`.
 * Each cell holds four outflow fluxes (to W/E/N/S) driven by the surface-height difference to
 * the neighbour; fluxes are scaled so a cell never gives away more than it holds, then volumes
 * are updated from net flux. Dry cells with no wet neighbour cost almost nothing, and the whole
 * solver is skipped while the field is quiet (`WaterField.active`).
 *
 * Used for the region-scale impact tsunami (`TsunamiSource`): a wave is fed in along one edge,
 * runs up over the coast and floods low land, damaging structures by depth.
 */
import { REGION_CELL_M, type RegionWorld } from '../region';
import { Lethality, damageStructure, type DamageLedger } from './structureDamage';

const G = 9.81;
/** Flux damping per second (friction); keeps the sloshing from ringing forever. */
const FRICTION = 0.05;
/** Below this depth (m) a cell counts as dry. */
export const DRY_DEPTH = 0.02;
/** Flood depth (m) at which a structure takes 1 HP of damage per game second. */
const DAMAGE_DEPTH = 4;
/** Shallowest flood that harms structures. */
const DAMAGE_MIN_DEPTH = 0.8;
/** Total water volume moved per tick below this (m³) lets the field go to sleep. */
const SLEEP_EPS = 50;

export type Edge = 'N' | 'S' | 'E' | 'W';

export interface WaterField {
  /** Outflow flux (m³/s) from each cell toward W, E, N, S. */
  readonly fluxW: Float32Array;
  readonly fluxE: Float32Array;
  readonly fluxN: Float32Array;
  readonly fluxS: Float32Array;
  /** True while there is anything to simulate. */
  active: boolean;
  /** Deepest flood seen this visit on land (m), per cell; for the persisted flood mark / views. */
  readonly maxDepth: Float32Array;
}

export function createWaterField(size: number): WaterField {
  const n = size * size;
  return {
    fluxW: new Float32Array(n),
    fluxE: new Float32Array(n),
    fluxN: new Float32Array(n),
    fluxS: new Float32Array(n),
    active: false,
    maxDepth: new Float32Array(n),
  };
}

/** A wave fed into the region through one edge (cells that are open water there). */
export interface TsunamiSource {
  edge: Edge;
  /** Crest height above the resting sea surface, meters. */
  amplitudeM: number;
  /** Seconds the source keeps pushing (wave period ≈ 2 × this). */
  durationS: number;
  /** Seconds since launch. */
  age: number;
}

export function launchTsunami(edge: Edge, amplitudeM: number, durationS = 60): TsunamiSource {
  return { edge, amplitudeM, durationS, age: 0 };
}

/** Cells along an edge, in order. */
function edgeCells(size: number, edge: Edge): number[] {
  const out: number[] = [];
  for (let k = 0; k < size; k++) {
    if (edge === 'N') out.push(k);
    else if (edge === 'S') out.push((size - 1) * size + k);
    else if (edge === 'W') out.push(k * size);
    else out.push(k * size + size - 1);
  }
  return out;
}

/**
 * Pushes the source's current crest into the edge cells that are open water. Returns false
 * once the source has finished (caller drops it).
 */
export function stepTsunamiSource(
  region: RegionWorld,
  field: WaterField,
  src: TsunamiSource,
  seaLevel: number,
  dt: number,
): boolean {
  src.age += dt;
  if (src.age > src.durationS) return false;
  // Half-sine pulse: one crest.
  const crest = src.amplitudeM * Math.sin((Math.PI * src.age) / src.durationS);
  for (const i of edgeCells(region.size, src.edge)) {
    if (region.height[i]! > seaLevel) continue; // only open sea feeds the wave
    const surface = seaLevel + crest;
    const want = surface - region.height[i]!;
    if (want > region.water[i]!) region.water[i] = want;
  }
  field.active = true;
  return true;
}

/**
 * One solver step.  * Returns the number of wet cells (0 lets callers sleep the field).
 */
export function stepWater(region: RegionWorld, field: WaterField, dt: number): number {
  if (!field.active) return 0;
  const s = region.size;
  const { height: h, water: w } = region;
  const { fluxW, fluxE, fluxN, fluxS } = field;
  const area = REGION_CELL_M * REGION_CELL_M;
  // flux += dt · g · (pipe area L·d) / L · Δsurface; L cancels.
  const k = dt * G;
  const damp = Math.max(0, 1 - FRICTION * dt);

  // 1) Update fluxes from surface differences.
  for (let row = 0; row < s; row++) {
    for (let col = 0; col < s; col++) {
      const i = row * s + col;
      const wi = w[i]!;
      // Dry cell with dry neighbours and no momentum: nothing can flow here.
      if (
        wi === 0 &&
        fluxW[i] === 0 &&
        fluxE[i] === 0 &&
        fluxN[i] === 0 &&
        fluxS[i] === 0 &&
        (col === 0 || w[i - 1] === 0) &&
        (col === s - 1 || w[i + 1] === 0) &&
        (row === 0 || w[i - s] === 0) &&
        (row === s - 1 || w[i + s] === 0)
      )
        continue;
      const surf = h[i]! + wi;
      let fw = fluxW[i]! * damp;
      let fe = fluxE[i]! * damp;
      let fn = fluxN[i]! * damp;
      let fs = fluxS[i]! * damp;
      if (col > 0) {
        const j = i - 1;
        const dh = surf - (h[j]! + w[j]!);
        fw = Math.max(0, fw + k * dh * pipeDepth(surf, h[i]!, h[j]!));
      } else fw = 0;
      if (col < s - 1) {
        const j = i + 1;
        const dh = surf - (h[j]! + w[j]!);
        fe = Math.max(0, fe + k * dh * pipeDepth(surf, h[i]!, h[j]!));
      } else fe = 0;
      if (row > 0) {
        const j = i - s;
        const dh = surf - (h[j]! + w[j]!);
        fn = Math.max(0, fn + k * dh * pipeDepth(surf, h[i]!, h[j]!));
      } else fn = 0;
      if (row < s - 1) {
        const j = i + s;
        const dh = surf - (h[j]! + w[j]!);
        fs = Math.max(0, fs + k * dh * pipeDepth(surf, h[i]!, h[j]!));
      } else fs = 0;

      // Never export more than the cell holds.
      const out = (fw + fe + fn + fs) * dt;
      const have = wi * area;
      if (out > have && out > 0) {
        const scale = have / out;
        fw *= scale;
        fe *= scale;
        fn *= scale;
        fs *= scale;
      }
      fluxW[i] = fw;
      fluxE[i] = fe;
      fluxN[i] = fn;
      fluxS[i] = fs;
    }
  }

  // 2) Update depths from net flux.
  let wet = 0;
  let moved = 0;
  for (let row = 0; row < s; row++) {
    for (let col = 0; col < s; col++) {
      const i = row * s + col;
      let inflow = 0;
      if (col > 0) inflow += fluxE[i - 1]!;
      if (col < s - 1) inflow += fluxW[i + 1]!;
      if (row > 0) inflow += fluxS[i - s]!;
      if (row < s - 1) inflow += fluxN[i + s]!;
      const outflow = fluxW[i]! + fluxE[i]! + fluxN[i]! + fluxS[i]!;
      const dv = (inflow - outflow) * dt;
      moved += Math.abs(dv);
      let nw = w[i]! + dv / area;
      if (nw < 0) nw = 0;
      w[i] = nw;
      if (nw > DRY_DEPTH) {
        wet++;
        if (h[i]! > 0 && nw > field.maxDepth[i]!) field.maxDepth[i] = nw;
      }
    }
  }
  if (moved < SLEEP_EPS) field.active = false;
  return wet;
}

/** Effective flow depth through the pipe between two cells: surface above the higher bed. */
function pipeDepth(surf: number, bedA: number, bedB: number): number {
  const d = surf - Math.max(bedA, bedB);
  return d > 0 ? d : 0;
}

/**
 * Floods hurt structures by depth: ≥ 0.8 m starts to damage, ≥ 4 m collapses a house in about a
 * second. Only land (bed above `seaLevel`) counts. Returns structures lost this step.
 */
export function floodDamage(
  region: RegionWorld,
  seaLevel: number,
  dt: number,
  ledger: DamageLedger,
): number {
  const { height: h, water: w } = region;
  let lost = 0;
  for (let i = 0; i < h.length; i++) {
    const d = w[i]!;
    if (d < DAMAGE_MIN_DEPTH || h[i]! <= seaLevel) continue;
    if (damageStructure(region, i, (d / DAMAGE_DEPTH) * dt, Lethality.Flood, ledger)) lost++;
  }
  return lost;
}
