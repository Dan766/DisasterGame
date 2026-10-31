/**
 * Tornado (DESIGN.md §5.2), region-scale simulation. A vortex agent that spawns, travels
 * along a slightly meandering track, intensifies, then dissipates ("roping out").
 *
 * Each tick it:
 * - moves along its track,
 * - damages structures through the shared damage ledger (Rankine vortex wind profile vs. an
 *   EF-style damage threshold),
 * - strips fuel from vegetation under the core (so fire has less to burn behind it),
 * - stirs the regional wind field so a nearby fire front is pushed around.
 */
import type { Rng } from '../../core/rng';
import { clamp } from '../../core/math';
import { REGION_CELL_M, type RegionWorld } from '../region';
import { Lethality, damageStructure, type DamageLedger } from '../systems/structureDamage';
import { addVortex, type WindField } from '../systems/wind';
import type { DisasterDef, Params, Preview } from './types';

export type EfRating = 0 | 1 | 2 | 3 | 4 | 5;

/** Peak wind speed (m/s) and damage-core radius (cells) per Enhanced Fujita rating. */
export const EF_SCALE: readonly { vmax: number; radiusCells: number }[] = [
  { vmax: 35, radiusCells: 1.5 },
  { vmax: 45, radiusCells: 2 },
  { vmax: 58, radiusCells: 3 },
  { vmax: 70, radiusCells: 4 },
  { vmax: 85, radiusCells: 5.5 },
  { vmax: 100, radiusCells: 7 },
];

/** Wind below this (m/s) does not damage structures. */
const DAMAGE_THRESHOLD = 28;
/** Wind (m/s) above which vegetation is torn out. */
const STRIP_THRESHOLD = 40;
/** Outer influence of the vortex, in core radii. */
const REACH = 2.5;
/** Fraction of the ramp-up / ramp-down of a tornado's life. */
const RAMP = 0.2;

export interface TornadoSpec {
  col: number;
  row: number;
  ef: EfRating;
  /** Compass bearing the tornado travels TOWARD, degrees (0 = north, 90 = east). */
  headingDeg: number;
  /** Ground speed, m/s. */
  speed: number;
  /** Total lifetime, game seconds. */
  lifetimeS: number;
}

export interface TornadoStepResult {
  structuresLost: number;
  fuelStripped: number;
}

export class Tornado {
  col: number;
  row: number;
  age = 0;
  /** Track so far, one point per step (for the view's damage path). */
  readonly track: { col: number; row: number }[] = [];
  private heading: number;

  constructor(readonly spec: TornadoSpec) {
    this.col = spec.col;
    this.row = spec.row;
    this.heading = (spec.headingDeg * Math.PI) / 180;
  }

  get alive(): boolean {
    return this.age < this.spec.lifetimeS;
  }

  /** 0..1 life envelope: ramps up, holds, ropes out. */
  get strength(): number {
    const t = clamp(this.age / this.spec.lifetimeS, 0, 1);
    return Math.min(1, t / RAMP, (1 - t) / RAMP);
  }

  get vmax(): number {
    return EF_SCALE[this.spec.ef]!.vmax * this.strength;
  }

  get radiusCells(): number {
    const r = EF_SCALE[this.spec.ef]!.radiusCells;
    // The funnel is narrow at birth and death.
    return r * (0.5 + 0.5 * this.strength);
  }

  /** Rankine vortex: solid-body core, steep (1/r²) decay outside, so the damage swath stays narrow. Speed in m/s at distance d (cells). */
  windSpeedAt(d: number): number {
    const r = this.radiusCells;
    const v = this.vmax;
    if (r <= 0) return 0;
    return d <= r ? v * (d / r) : v * (r / d) ** 2;
  }

  step(
    region: RegionWorld,
    wind: WindField,
    rng: Rng,
    dt: number,
    ledger: DamageLedger,
  ): TornadoStepResult {
    const result: TornadoStepResult = { structuresLost: 0, fuelStripped: 0 };
    if (!this.alive) return result;

    // Meander: small random heading drift, then advance (m/s -> cells/s).
    this.heading += (rng.next() - 0.5) * 0.4 * dt;
    const cellsPerS = this.spec.speed / REGION_CELL_M;
    this.col += Math.sin(this.heading) * cellsPerS * dt;
    this.row -= Math.cos(this.heading) * cellsPerS * dt;
    this.age += dt;
    this.track.push({ col: this.col, row: this.row });

    const { size, structure, fuel } = region;
    const reach = this.radiusCells * REACH;
    const c0 = Math.max(0, Math.floor(this.col - reach));
    const c1 = Math.min(size - 1, Math.ceil(this.col + reach));
    const r0 = Math.max(0, Math.floor(this.row - reach));
    const r1 = Math.min(size - 1, Math.ceil(this.row + reach));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const d = Math.hypot(col - this.col, row - this.row);
        const v = this.windSpeedAt(d);
        const i = row * size + col;
        if (v > DAMAGE_THRESHOLD && structure[i] !== 0) {
          // Structure HP is 1; a cell at twice the threshold is destroyed in about a second.
          const hp = ((v - DAMAGE_THRESHOLD) / DAMAGE_THRESHOLD) * dt;
          if (damageStructure(region, i, hp, Lethality.Wind, ledger)) result.structuresLost++;
        }
        if (v > STRIP_THRESHOLD && fuel[i]! > 0) {
          const before = fuel[i]!;
          fuel[i] = before * Math.max(0, 1 - 0.8 * dt);
          result.fuelStripped += before - fuel[i]!;
        }
      }
    }

    // Stir the wind: the swirl is what carries a fire front sideways.
    addVortex(wind, this.col, this.row, reach * 1.5, this.vmax * 0.5 * dt * 2);
    return result;
  }
}

/** Reads the panel params into a spawn spec at the given cell. */
export function tornadoSpecFromParams(col: number, row: number, params: Params): TornadoSpec {
  const ef = Math.round(Math.min(5, Math.max(0, Number(params.ef ?? 3)))) as EfRating;
  return {
    col,
    row,
    ef,
    headingDeg: Number(params.headingDeg ?? 45),
    speed: Number(params.speedMs ?? 15),
    lifetimeS: Number(params.lifetimeS ?? 90),
  };
}

/** Region-scale only: there is no globe-scale tornado. */
export const tornado: DisasterDef = {
  id: 'tornado',
  name: 'Tornado',
  scales: ['region'],
  params: [
    { kind: 'number', key: 'ef', label: 'EF rating', min: 0, max: 5, default: 3 },
    {
      kind: 'number',
      key: 'headingDeg',
      label: 'Travels toward',
      min: 0,
      max: 359,
      default: 45,
      unit: '°',
    },
    {
      kind: 'number',
      key: 'speedMs',
      label: 'Ground speed',
      min: 5,
      max: 30,
      default: 15,
      unit: 'm/s',
    },
    {
      kind: 'number',
      key: 'lifetimeS',
      label: 'Lifetime',
      min: 20,
      max: 300,
      default: 90,
      unit: 's',
    },
  ],

  preview(params: Params): Preview {
    const spec = tornadoSpecFromParams(0, 0, params);
    const { vmax, radiusCells } = EF_SCALE[spec.ef]!;
    return {
      rings: [],
      facts: [
        { label: 'Peak wind', value: `${vmax} m/s` },
        { label: 'Damage swath', value: `${Math.round(radiusCells * 2 * REGION_CELL_M)} m` },
        { label: 'Path length', value: `${((spec.speed * spec.lifetimeS) / 1000).toFixed(1)} km` },
      ],
    };
  },
};
