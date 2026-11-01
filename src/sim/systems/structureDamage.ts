/**
 * Regional structure damage (DESIGN.md §4): the single place where structure HP is
 * reduced, collapses are detected and casualties are counted. Fire, shockwaves and
 * (later) tornados all go through `damageStructure`, so deaths are never double counted.
 *
 * Invariant: for every cell, `population + deaths-attributed-to-it` equals its initial
 * population, i.e. alive + dead is conserved.
 */
import { Structure, type RegionWorld } from '../region';

/** Fraction of a cell's residents killed when its structure collapses, by cause. */
export const Lethality = {
  /** Fire is slow: most people get out before the roof comes down. */
  Fire: 0.04,
  /** Blast overpressure / flying debris: collapses are deadly. */
  Blast: 0.6,
  /** Wind-driven collapse (tornado). */
  Wind: 0.25,
  /** Flood / tsunami: sudden, but many reach higher ground. */
  Flood: 0.3,
  /** Ground shaking: buildings pancake, but people often get out. */
  Quake: 0.15,
  /** Buried by a landslide: nearly always fatal. */
  Landslide: 0.7,
} as const;

/** Running totals for one region visit; owned by `RegionSim`. */
export interface DamageLedger {
  deaths: number;
  structuresLost: number;
  /** Cell indices of structures that collapsed, in order (debris events for the views). */
  collapsed: number[];
}

export function createLedger(): DamageLedger {
  return { deaths: 0, structuresLost: 0, collapsed: [] };
}

/** True for structures that have HP and can collapse (roads and bare ground cannot). */
export function isDamageable(region: RegionWorld, i: number): boolean {
  const s = region.structure[i];
  return s !== Structure.None && s !== Structure.Road && region.structHP[i]! > 0;
}

/**
 * Applies `hp` damage (structures spawn with HP 1) to the structure in cell `i`.
 * On collapse, kills `lethality` of the cell's residents and records it in the ledger.
 * Returns true if this call collapsed the structure.
 */
export function damageStructure(
  region: RegionWorld,
  i: number,
  hp: number,
  lethality: number,
  ledger: DamageLedger,
): boolean {
  if (!isDamageable(region, i) || hp <= 0) return false;
  const left = Math.max(0, region.structHP[i]! - hp);
  region.structHP[i] = left;
  if (left > 0) return false;

  const killed = region.population[i]! * lethality;
  region.population[i] = region.population[i]! - killed;
  ledger.deaths += killed;
  ledger.structuresLost++;
  ledger.collapsed.push(i);
  return true;
}
