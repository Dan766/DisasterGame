/**
 * Wildfire cellular automaton (DESIGN.md §4.2). A burning cell ignites each of its
 * 8 neighbors with probability proportional to
 *   fuel × (1 − moisture) × windAlignment × slopeBoost
 * then burns for `fuel × k` seconds before becoming `burnt`.
 *
 * `region.heat` stores the seconds of burn time remaining for burning cells.
 * Fire is blocked by water, partially by roads, and cannot re-enter burnt cells.
 */
import { FireState, Structure, type RegionWorld } from '../region';
import type { Rng } from '../../core/rng';
import { windAt, type WindField } from './wind';

/** Ignition rate per second for a fully dry, fully fuelled neighbor with neutral wind/slope. */
const BASE_RATE = 0.35;
/** Seconds a cell with fuel = 1 burns for. */
const BURN_SECONDS = 20;
const MIN_BURN_SECONDS = 4;
/** Water deeper than this (m) stops fire entirely. */
const WATER_BLOCK_M = 0.05;
const ROAD_FACTOR = 0.35;
/** Structure HP lost per second while the cell is burning. */
const STRUCTURE_BURN_DPS = 8;
/** Wind speed (m/s) at which a fully aligned wind roughly triples the spread rate. */
const WIND_REF = 10;

const NEIGHBORS: readonly [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export interface FireStepResult {
  ignited: number;
  burntOut: number;
  burning: number;
  structuresLost: number;
}

/** Starts a fire at a cell. Returns false if it cannot burn there. */
export function igniteCell(region: RegionWorld, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= region.size || row >= region.size) return false;
  const i = row * region.size + col;
  if (region.fireState[i] !== FireState.Unburnt) return false;
  if (region.water[i]! > WATER_BLOCK_M || region.fuel[i]! <= 0.01) return false;
  region.fireState[i] = FireState.Burning;
  region.heat[i] = Math.max(MIN_BURN_SECONDS, region.fuel[i]! * BURN_SECONDS);
  return true;
}

/** Ignites every burnable cell within `radiusCells` of a point, with probability `intensity`. */
export function igniteDisk(
  region: RegionWorld,
  col: number,
  row: number,
  radiusCells: number,
  intensity: number,
  rng: Rng,
): number {
  let count = 0;
  const r = Math.ceil(radiusCells);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > radiusCells * radiusCells) continue;
      if (!rng.chance(intensity)) continue;
      if (igniteCell(region, Math.round(col) + dx, Math.round(row) + dy)) count++;
    }
  }
  return count;
}

export function stepFire(
  region: RegionWorld,
  wind: WindField,
  rng: Rng,
  dt: number,
): FireStepResult {
  const { size, fireState, heat, fuel, moisture, water, height, structure, structHP } = region;
  const result: FireStepResult = { ignited: 0, burntOut: 0, burning: 0, structuresLost: 0 };
  const toIgnite: number[] = [];

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const i = row * size + col;
      if (fireState[i] !== FireState.Burning) continue;

      const w = windAt(wind, col, row);
      for (const [dx, dy] of NEIGHBORS) {
        const nc = col + dx;
        const nr = row + dy;
        if (nc < 0 || nr < 0 || nc >= size || nr >= size) continue;
        const n = nr * size + nc;
        if (fireState[n] !== FireState.Unburnt) continue;
        if (water[n]! > WATER_BLOCK_M) continue;
        const f = fuel[n]!;
        if (f <= 0.01) continue;

        const dist = Math.hypot(dx, dy);
        // Wind component along the spread direction, -1..1 scaled by speed.
        const along = (w.x * dx + w.y * dy) / dist / WIND_REF;
        const windFactor = Math.max(0.1, 1 + 2 * along);
        // Fire climbs slopes faster than it descends them.
        const slope = (height[n]! - height[i]!) / (dist * 100);
        const slopeFactor = Math.min(2.5, Math.max(0.4, 1 + 3 * slope));
        const roadFactor = structure[n] === Structure.Road ? ROAD_FACTOR : 1;

        const p =
          (BASE_RATE * f * (1 - moisture[n]!) * windFactor * slopeFactor * roadFactor * dt) / dist;
        if (rng.chance(p)) toIgnite.push(n);
      }

      // Heat damages structures in the burning cell.
      if (structure[i] !== Structure.None && structure[i] !== Structure.Road && structHP[i]! > 0) {
        structHP[i] = Math.max(0, structHP[i]! - STRUCTURE_BURN_DPS * dt);
        if (structHP[i] === 0) result.structuresLost++;
      }

      heat[i] = heat[i]! - dt;
      if (heat[i]! <= 0) {
        fireState[i] = FireState.Burnt;
        heat[i] = 0;
        fuel[i] = 0;
        result.burntOut++;
      } else {
        result.burning++;
      }
    }
  }

  for (const n of toIgnite) {
    if (fireState[n] !== FireState.Unburnt) continue; // duplicate from several neighbors
    fireState[n] = FireState.Burning;
    heat[n] = Math.max(MIN_BURN_SECONDS, fuel[n]! * BURN_SECONDS);
    result.ignited++;
    result.burning++;
  }
  return result;
}
