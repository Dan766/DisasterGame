/**
 * Pure helpers for the region water surface: where a cell's water vertex sits and how much
 * foam it shows. Foam marks the moving front of a flood (cells whose depth is changing fast)
 * and the thin wet fringe on land, so a tsunami reads as a white-capped wave.
 */

/** Below this depth (m) a cell is dry and its water vertex is sunk below the ground. */
export const WET_DEPTH = 0.05;
/** How far (m) dry water vertices sink under the terrain so only wet cells show. */
export const DRY_SINK_M = 6;
/** Depth (m) up to which a wet cell counts as the shallow fringe. */
const FRINGE_DEPTH = 1.5;
/** Depth change per snapshot (m) that gives full foam. */
const FRONT_DELTA = 0.6;

/** Water vertex height in metres for a cell with ground `height` and water `depth`. */
export function waterSurfaceM(height: number, depth: number): number {
  return depth > WET_DEPTH ? Math.max(height, 0) + depth : height - DRY_SINK_M;
}

/**
 * Foam amount 0..1. `delta` is the depth change since the previous snapshot; a cell that is
 * rising or draining quickly is a wave front, and shallow wet land gets a lighter fringe.
 */
export function foamStrength(depth: number, delta: number): number {
  if (depth <= WET_DEPTH) return 0;
  const front = Math.min(1, Math.abs(delta) / FRONT_DELTA);
  const fringe = depth < FRINGE_DEPTH ? 0.45 * (1 - depth / FRINGE_DEPTH) : 0;
  return Math.min(1, Math.max(front, fringe));
}
