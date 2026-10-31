/**
 * Fire smoke and sparks on the shared particle system (DESIGN.md §6, M4b). Each emit pass
 * scans the region's fire state and spawns drifting smoke and rising sparks from burning
 * cells. The pass is budgeted: a big fire thins its per-cell rate rather than flooding the
 * 20k pool, so a large blaze still reads as one tall plume by its smoke.
 * World units are cells (100 m), x east / z south, matching `RegionView`.
 */
import { FireState, REGION_SIZE, type RegionWorld } from '../../sim/region';
import { windAt, type WindField } from '../../sim/systems/wind';
import type { ParticleSpec } from './Particles';

/** Seconds between emit passes (real time). */
const PASS_INTERVAL = 1 / 15;
/** Max particles one pass may emit. */
const PASS_BUDGET = 90;
/** Smoke puffs per burning cell per second when the fire is small. */
const SMOKE_RATE = 1.4;
const SPARK_RATE = 0.5;
/** Wind (m/s) → world units/s drift for smoke; cells are 100 m, so this is a visual scale-up. */
const WIND_DRIFT = 0.8;

export interface ParticleSink {
  emit(spec: ParticleSpec): void;
}

export class FireEmitter {
  private acc = 0;

  constructor(
    private readonly sink: ParticleSink,
    private readonly rng: () => number = Math.random,
  ) {}

  /** Call once per rendered frame with real dt. Returns the number of particles emitted. */
  update(
    dt: number,
    region: RegionWorld,
    wind: WindField,
    heightAt: (x: number, z: number) => number,
  ): number {
    this.acc += dt;
    if (this.acc < PASS_INTERVAL) return 0;
    const elapsed = Math.min(this.acc, 0.25);
    this.acc = 0;

    const state = region.fireState;
    let burning = 0;
    for (let i = 0; i < state.length; i++) if (state[i] === FireState.Burning) burning++;
    if (burning === 0) return 0;

    // Expected puffs this pass, scaled down so the whole fire stays within the pass budget.
    const want = burning * (SMOKE_RATE + SPARK_RATE) * elapsed;
    const keep = Math.min(1, PASS_BUDGET / Math.max(1, want));
    const pSmoke = SMOKE_RATE * elapsed * keep;
    const pSpark = SPARK_RATE * elapsed * keep;

    let emitted = 0;
    const half = REGION_SIZE / 2;
    for (let i = 0; i < state.length; i++) {
      if (state[i] !== FireState.Burning) continue;
      const col = i % REGION_SIZE;
      const row = (i - col) / REGION_SIZE;
      const x = col - half + this.rng();
      const z = row - half + this.rng();
      const y = heightAt(x, z);
      const w = windAt(wind, col, row);
      const fuel = region.fuel[i] ?? 0;
      if (this.rng() < pSmoke) {
        // Wind y is "south-positive", the same axis as world z.
        emitted++;
        this.sink.emit({
          x,
          y: y + 0.5,
          z,
          vx: w.x * WIND_DRIFT + (this.rng() - 0.5) * 0.8,
          vy: 3 + this.rng() * 3,
          vz: w.y * WIND_DRIFT + (this.rng() - 0.5) * 0.8,
          gravity: 0.4,
          life: 5 + this.rng() * 4,
          size: 1.2,
          sizeEnd: 5 + this.rng() * 3,
          color: fuel > 0.5 ? 0x3a3532 : 0x6a625a,
          colorEnd: 0x9a948c,
          alpha: 0.38,
        });
      }
      if (this.rng() < pSpark) {
        emitted++;
        this.sink.emit({
          x,
          y: y + 0.5,
          z,
          vx: w.x * WIND_DRIFT * 0.5 + (this.rng() - 0.5) * 3,
          vy: 4 + this.rng() * 5,
          vz: w.y * WIND_DRIFT * 0.5 + (this.rng() - 0.5) * 3,
          gravity: -7,
          life: 0.8 + this.rng() * 1.2,
          size: 0.25,
          sizeEnd: 0.05,
          color: 0xffc060,
          colorEnd: 0xff4010,
          alpha: 1,
          additive: true,
        });
      }
    }
    return emitted;
  }
}
