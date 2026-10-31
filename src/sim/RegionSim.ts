/**
 * Regional simulation driver (DESIGN.md §4): owns the wind field and the RNG stream for
 * one region and advances the shared field systems in a fixed order each tick
 * (wind → fire → damage ledger). Pure typed-array code, so it is deterministic and worker-ready.
 */
import { createRng, type Rng } from '../core/rng';
import type { RegionWorld } from './region';
import { igniteDisk, stepFire, type FireStepResult } from './systems/fire';
import { createLedger, type DamageLedger } from './systems/structureDamage';
import { createWind, stepWind, type WindField } from './systems/wind';

/** Region ticks per real second at 1× (DESIGN.md §4: 10 Hz). */
export const REGION_TICK_HZ = 10;
/** Game seconds per region tick. */
export const REGION_DT = 1 / REGION_TICK_HZ;

export class RegionSim {
  readonly wind: WindField;
  /** Game seconds simulated since the region was entered. */
  elapsed = 0;
  /** Result of the most recent fire step. */
  lastFire: FireStepResult = { ignited: 0, burntOut: 0, burning: 0, structuresLost: 0 };

  /** Casualties and collapsed structures since the region was entered. */
  readonly damage: DamageLedger = createLedger();

  private readonly fireRng: Rng;

  constructor(
    readonly region: RegionWorld,
    wind: WindField = createWind(),
  ) {
    this.wind = wind;
    this.fireRng = createRng(region.seed).fork('fire');
  }

  /** Debug/wildfire ignition brush at a (fractional) cell. Returns how many cells caught. */
  ignite(col: number, row: number, radiusCells = 2, intensity = 0.9): number {
    return igniteDisk(this.region, col, row, radiusCells, intensity, this.fireRng);
  }

  /** Advances all region systems by one fixed tick. */
  step(dt: number = REGION_DT): FireStepResult {
    stepWind(this.wind, dt);
    this.lastFire = stepFire(this.region, this.wind, this.fireRng, dt, this.damage);
    this.elapsed += dt;
    return this.lastFire;
  }
}
