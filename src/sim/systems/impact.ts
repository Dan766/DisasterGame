/**
 * Regional asteroid impact (DESIGN.md §5.1, region scale). Three parts:
 * - `carveCrater`: bowl + raised rim written into `height`; everything inside is erased.
 * - `Shockwave`: an expanding ring that damages structures (through the ledger) as it passes.
 * - thermal ignition: the fireball lights fuel within the thermal radius at impact time.
 * Radii are in region cells; callers convert from the km values of `asteroidEffects`.
 */
import type { Rng } from '../../core/rng';
import { REGION_CELL_M, Structure, type RegionWorld } from '../region';
import { igniteCell } from './fire';
import { Lethality, damageStructure, type DamageLedger } from './structureDamage';

/** Crater depth as a fraction of its diameter (simple bowl craters). */
const DEPTH_RATIO = 0.2;
/** Rim height as a fraction of depth, extending to 1.5 crater radii. */
const RIM_RATIO = 0.25;
/** Shockwave front speed in cells per second (~ speed of sound, 340 m/s). */
export const SHOCK_CELLS_PER_S = 340 / REGION_CELL_M;
/** Structure HP damage applied at the blast radius (structures spawn with 1 HP). */
const BLAST_EDGE_DAMAGE = 1.2;

export interface ImpactSpec {
  col: number;
  row: number;
  /** Zero for airbursts. */
  craterRadiusCells: number;
  /** Radius within which structures are flattened. */
  blastRadiusCells: number;
  /** Radius within which the fireball ignites fuel. */
  thermalRadiusCells: number;
}

/** Converts the kilometer radii of an asteroid's effects into a region-scale impact spec. */
export function impactSpecFromKm(
  col: number,
  row: number,
  radiiKm: { craterRadiusKm: number; blastRadiusKm: number; thermalRadiusKm: number },
): ImpactSpec {
  const perKm = 1000 / REGION_CELL_M;
  return {
    col,
    row,
    craterRadiusCells: radiiKm.craterRadiusKm * perKm,
    blastRadiusCells: radiiKm.blastRadiusKm * perKm,
    thermalRadiusCells: radiiKm.thermalRadiusKm * perKm,
  };
}

export interface Shockwave {
  col: number;
  row: number;
  /** Current front radius, cells. */
  radius: number;
  blastRadiusCells: number;
  /** The wave dies at 1.8 × blast radius. */
  maxRadius: number;
}

/** Excavates a crater: lowers terrain into a bowl, raises a rim, clears fuel/fire/structures. */
export function carveCrater(
  region: RegionWorld,
  col: number,
  row: number,
  radiusCells: number,
  ledger: DamageLedger,
): void {
  if (radiusCells <= 0) return;
  const depth = DEPTH_RATIO * 2 * radiusCells * REGION_CELL_M;
  const rimH = depth * RIM_RATIO;
  const reach = radiusCells * 1.5;
  const s = region.size;
  const r0 = Math.ceil(reach);
  for (let y = Math.max(0, Math.round(row) - r0); y <= Math.min(s - 1, Math.round(row) + r0); y++) {
    for (
      let x = Math.max(0, Math.round(col) - r0);
      x <= Math.min(s - 1, Math.round(col) + r0);
      x++
    ) {
      const d = Math.hypot(x - col, y - row);
      if (d > reach) continue;
      const i = y * s + x;
      if (d <= radiusCells) {
        const t = d / radiusCells;
        region.height[i] = region.height[i]! - depth * (1 - t * t);
        region.fuel[i] = 0;
        region.heat[i] = 0;
        region.water[i] = 0;
        if (region.structure[i] !== Structure.None) {
          // Direct hit: vaporized, everyone inside dies.
          if (region.structure[i] !== Structure.Road) {
            damageStructure(region, i, 1e9, 1, ledger);
          }
          region.structure[i] = Structure.None;
          region.structHP[i] = 0;
        }
      } else {
        const t = (d - radiusCells) / (reach - radiusCells);
        region.height[i] = region.height[i]! + rimH * (1 - t) * (1 - t);
      }
    }
  }
}

/** Fireball ignition: probability falls linearly from 1 at the center to 0 at the radius. */
export function igniteFireball(
  region: RegionWorld,
  col: number,
  row: number,
  radiusCells: number,
  rng: Rng,
): number {
  let count = 0;
  const r = Math.ceil(radiusCells);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > radiusCells) continue;
      if (rng.next() >= 1 - d / radiusCells) continue;
      if (igniteCell(region, Math.round(col) + dx, Math.round(row) + dy)) count++;
    }
  }
  return count;
}

export function startShockwave(spec: ImpactSpec): Shockwave {
  return {
    col: spec.col,
    row: spec.row,
    radius: 0,
    blastRadiusCells: spec.blastRadiusCells,
    maxRadius: spec.blastRadiusCells * 1.8,
  };
}

/** Structure damage at distance d from the center: falls from strong to zero at 1.8 × blast radius. */
export function blastDamage(d: number, blastRadiusCells: number): number {
  const edge = blastRadiusCells * 1.8;
  if (d >= edge) return 0;
  return (BLAST_EDGE_DAMAGE * (edge - d)) / (edge - blastRadiusCells);
}

/** Applies the full shockwave damage field at once (for impacts that happened off-screen). */
export function applyBlast(
  region: RegionWorld,
  col: number,
  row: number,
  blastRadiusCells: number,
  ledger: DamageLedger,
): void {
  if (blastRadiusCells <= 0) return;
  const s = region.size;
  const reach = Math.ceil(blastRadiusCells * 1.8);
  for (
    let y = Math.max(0, Math.round(row) - reach);
    y <= Math.min(s - 1, Math.round(row) + reach);
    y++
  ) {
    for (
      let x = Math.max(0, Math.round(col) - reach);
      x <= Math.min(s - 1, Math.round(col) + reach);
      x++
    ) {
      const dmg = blastDamage(Math.hypot(x - col, y - row), blastRadiusCells);
      if (dmg > 0) damageStructure(region, y * s + x, dmg, Lethality.Blast, ledger);
    }
  }
}

/**
 * Advances the front by `dt`, damaging structures in the ring it swept.
 * Returns false once the wave has expired.
 */
export function stepShockwave(
  region: RegionWorld,
  wave: Shockwave,
  dt: number,
  ledger: DamageLedger,
): boolean {
  const prev = wave.radius;
  wave.radius = Math.min(wave.maxRadius, prev + SHOCK_CELLS_PER_S * dt);
  const s = region.size;
  const r = Math.ceil(wave.radius);
  for (
    let y = Math.max(0, Math.round(wave.row) - r);
    y <= Math.min(s - 1, Math.round(wave.row) + r);
    y++
  ) {
    for (
      let x = Math.max(0, Math.round(wave.col) - r);
      x <= Math.min(s - 1, Math.round(wave.col) + r);
      x++
    ) {
      const d = Math.hypot(x - wave.col, y - wave.row);
      if (d < prev || d >= wave.radius) continue;
      const dmg = blastDamage(d, wave.blastRadiusCells);
      if (dmg > 0) damageStructure(region, y * s + x, dmg, Lethality.Blast, ledger);
    }
  }
  return wave.radius < wave.maxRadius;
}
