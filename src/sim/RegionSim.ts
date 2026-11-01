/**
 * Regional simulation driver (DESIGN.md §4): owns the wind field and the RNG stream for
 * one region and advances the shared field systems in a fixed order each tick
 * (wind → fire → damage ledger). Pure typed-array code, so it is deterministic and worker-ready.
 */
import { createRng, type Rng } from '../core/rng';
import type { RegionWorld } from './region';
import { igniteDisk, stepFire, type FireStepResult } from './systems/fire';
import {
  carveCrater,
  igniteFireball,
  startShockwave,
  stepShockwave,
  type ImpactSpec,
  type Shockwave,
} from './systems/impact';
import { Tornado, type TornadoSpec } from './disasters/tornado';
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

  /** Active shockwaves (for the view's ring effect). */
  readonly shockwaves: Shockwave[] = [];
  /** Craters carved this visit, in order. */
  readonly craters: { col: number; row: number; radiusCells: number }[] = [];

  /** Active tornados (for the view's funnel effect). */
  readonly tornados: Tornado[] = [];

  /** Sparse samples of tornado core positions this visit (for the persisted damage path). */
  readonly tornadoTrack: { col: number; row: number; radiusCells: number }[] = [];

  private readonly fireRng: Rng;
  private readonly tornadoRng: Rng;

  constructor(
    readonly region: RegionWorld,
    wind: WindField = createWind(),
  ) {
    this.wind = wind;
    this.fireRng = createRng(region.seed).fork('fire');
    this.tornadoRng = createRng(region.seed).fork('tornado');
  }

  /** Debug/wildfire ignition brush at a (fractional) cell. Returns how many cells caught. */
  ignite(col: number, row: number, radiusCells = 2, intensity = 0.9): number {
    return igniteDisk(this.region, col, row, radiusCells, intensity, this.fireRng);
  }

  /**
   * Resolves an impact: carves the crater, lights the fireball ignition zone and launches
   * the shockwave. Returns the number of cells ignited.
   */
  impact(spec: ImpactSpec): number {
    carveCrater(this.region, spec.col, spec.row, spec.craterRadiusCells, this.damage);
    if (spec.craterRadiusCells > 0) {
      this.craters.push({ col: spec.col, row: spec.row, radiusCells: spec.craterRadiusCells });
    }
    this.shockwaves.push(startShockwave(spec));
    return igniteFireball(this.region, spec.col, spec.row, spec.thermalRadiusCells, this.fireRng);
  }

  /** Touches down a tornado; it is stepped with the other systems until it dissipates. */
  spawnTornado(spec: TornadoSpec): Tornado {
    const t = new Tornado(spec);
    this.tornados.push(t);
    return t;
  }

  /** Records a core position when the tornado has moved far enough from its last sample. */
  private sampleTrack(t: Tornado): void {
    const r = Math.max(1, t.radiusCells);
    for (let k = this.tornadoTrack.length - 1, seen = 0; k >= 0 && seen < 8; k--, seen++) {
      const s = this.tornadoTrack[k]!;
      if (Math.hypot(s.col - t.col, s.row - t.row) < r * 0.5) return;
    }
    this.tornadoTrack.push({ col: t.col, row: t.row, radiusCells: r });
  }

  /** Advances all region systems by one fixed tick. */
  step(dt: number = REGION_DT): FireStepResult {
    stepWind(this.wind, dt);
    for (let k = this.shockwaves.length - 1; k >= 0; k--) {
      if (!stepShockwave(this.region, this.shockwaves[k]!, dt, this.damage))
        this.shockwaves.splice(k, 1);
    }
    for (let k = this.tornados.length - 1; k >= 0; k--) {
      const t = this.tornados[k]!;
      t.step(this.region, this.wind, this.tornadoRng, dt, this.damage);
      this.sampleTrack(t);
      if (!t.alive) this.tornados.splice(k, 1);
    }
    this.lastFire = stepFire(this.region, this.wind, this.fireRng, dt, this.damage);
    this.elapsed += dt;
    return this.lastFire;
  }
}
