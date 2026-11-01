/**
 * Replays globe tsunami landfalls in a region (DESIGN.md §5.1, M7+). When the player enters a
 * region whose globe cell was hit while they were away, a wave is sent in through the edge
 * facing the wave's source. Pure: `planRegionTsunami` only decides; the caller spawns it.
 */
import type { LandfallRecord } from '../GlobeSim';
import type { RegionWorld } from '../region';
import { strikeToCell } from './persistence';
import type { Edge } from './water';

/** Shoaling factor used by the globe model (run-up = 2 x open-water height). */
const RUNUP_FACTOR = 2;
/** Largest wave sent into a region, meters (keeps the shallow-water solver stable). */
export const MAX_REGION_WAVE_M = 25;

export interface RegionTsunamiPlan {
  edge: Edge;
  amplitudeM: number;
  /** Landfalls from `landfalls` that hit this region's globe cell and are folded into the wave. */
  count: number;
}

/** Edge of the region square that faces (lat, lon). */
export function edgeFacing(region: RegionWorld, lat: number, lon: number): Edge {
  const { col, row } = strikeToCell(region, lat, lon);
  const dx = col - (region.size - 1) / 2;
  const dy = row - (region.size - 1) / 2;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

/**
 * Plans the wave for landfalls `from..` that struck `regionCell` (the globe cell containing the
 * region). The strongest landfall sets the edge and height. Returns null when none apply.
 */
export function planRegionTsunami(
  region: RegionWorld,
  regionCell: number,
  landfalls: readonly LandfallRecord[],
  from = 0,
): RegionTsunamiPlan | null {
  let best: LandfallRecord | null = null;
  let count = 0;
  for (let k = from; k < landfalls.length; k++) {
    const l = landfalls[k]!;
    if (l.cell !== regionCell) continue;
    count++;
    if (!best || l.runupM > best.runupM) best = l;
  }
  if (!best) return null;
  return {
    edge: edgeFacing(region, best.sourceLat, best.sourceLon),
    amplitudeM: Math.min(MAX_REGION_WAVE_M, best.runupM / RUNUP_FACTOR),
    count,
  };
}
