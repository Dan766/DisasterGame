/**
 * Tornado presentation on the shared particle system (DESIGN.md §6, M5). Each pass, every
 * live tornado emits three layers that together read as a funnel:
 * - the funnel: translucent grey-brown puffs on rotating rings that widen with height,
 *   with the ring phase advancing each pass so the column visibly spins,
 * - a debris ring: dark chunks flung around the core that arc outward and fall,
 * - a dust skirt: a wide, low, tan cloud kicked up around the base.
 * Layers scale with the tornado's current strength, so they thin out as it ropes out.
 * World units are cells (100 m), x east / z south, matching `RegionView`.
 */
import { REGION_SIZE } from '../../sim/region';
import type { TornadoView } from '../../sim/regionProtocol';
import type { ParticleSink } from './FireEmitter';

/** Seconds between emit passes (real time). */
const PASS_INTERVAL = 1 / 30;
/** Funnel height in world units (cells), by EF-independent visual scale. */
const FUNNEL_HEIGHT = 34;
const FUNNEL_LAYERS = 7;
/** Visual spin rate, rad/s at the core radius. */
const SPIN = 5;

export class TornadoEmitter {
  private acc = 0;
  private phase = 0;

  constructor(
    private readonly sink: ParticleSink,
    private readonly rng: () => number = Math.random,
  ) {}

  /** Call once per rendered frame with real dt. Returns the number of particles emitted. */
  update(
    dt: number,
    tornados: readonly TornadoView[],
    heightAt: (x: number, z: number) => number,
  ): number {
    this.acc += dt;
    if (this.acc < PASS_INTERVAL) return 0;
    const elapsed = Math.min(this.acc, 0.25);
    this.acc = 0;
    this.phase += elapsed * SPIN;
    let emitted = 0;
    const half = REGION_SIZE / 2;
    for (const t of tornados) {
      const s = t.strength;
      if (s <= 0.01) continue;
      const x = t.col - half + 0.5;
      const z = t.row - half + 0.5;
      const ground = heightAt(x, z);
      const core = Math.max(0.8, t.radiusCells);
      emitted += this.funnel(x, z, ground, core, s);
      emitted += this.debris(x, z, ground, core, s, elapsed);
      emitted += this.skirt(x, z, ground, core, s, elapsed);
    }
    return emitted;
  }

  private funnel(x: number, z: number, y0: number, core: number, s: number): number {
    let n = 0;
    const perLayer = Math.max(1, Math.round(3 * s));
    for (let layer = 0; layer < FUNNEL_LAYERS; layer++) {
      const u = layer / (FUNNEL_LAYERS - 1); // 0 = ground, 1 = cloud base
      // Narrow at the ground, flaring toward the cloud.
      const radius = core * (0.35 + 1.5 * u * u) * (0.8 + 0.4 * this.rng());
      const height = y0 + u * FUNNEL_HEIGHT * (0.5 + 0.5 * s);
      for (let k = 0; k < perLayer; k++) {
        const a = this.phase * (1.4 - 0.6 * u) + (k / perLayer) * Math.PI * 2 + this.rng() * 0.6;
        const tangential = SPIN * radius * 0.7;
        n++;
        this.sink.emit({
          x: x + Math.cos(a) * radius,
          y: height,
          z: z + Math.sin(a) * radius,
          vx: -Math.sin(a) * tangential,
          vy: 1 + this.rng() * 2,
          vz: Math.cos(a) * tangential,
          gravity: 0.3,
          life: Math.max(0.2, 0.9 + this.rng() * 0.6),
          size: core * (0.5 + 0.7 * u),
          sizeEnd: core * (0.9 + 1.0 * u),
          color: u < 0.35 ? 0x8a7a66 : 0x6c6a68,
          colorEnd: 0x504e4c,
          alpha: (0.22 + 0.2 * (1 - u)) * s,
        });
      }
    }
    return n;
  }

  private debris(x: number, z: number, y0: number, core: number, s: number, dt: number): number {
    const count = Math.round((6 + 40 * dt) * s);
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = core * (0.6 + this.rng() * 1.1);
      const tangential = SPIN * r * (0.9 + this.rng() * 0.5);
      this.sink.emit({
        x: x + Math.cos(a) * r,
        y: y0 + 0.5 + this.rng() * 3,
        z: z + Math.sin(a) * r,
        vx: -Math.sin(a) * tangential + Math.cos(a) * 4,
        vy: 5 + this.rng() * 9,
        vz: Math.cos(a) * tangential + Math.sin(a) * 4,
        gravity: -16,
        life: 1.2 + this.rng() * 1.4,
        size: 0.35 + this.rng() * 0.5,
        color: this.rng() < 0.5 ? 0x3a2e24 : 0x7a6a50,
        colorEnd: 0x2a2420,
        alpha: 0.95,
      });
    }
    return count;
  }

  private skirt(x: number, z: number, y0: number, core: number, s: number, dt: number): number {
    const count = Math.round((3 + 18 * dt) * s);
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = core * (1.0 + this.rng() * 1.6);
      this.sink.emit({
        x: x + Math.cos(a) * r,
        y: y0 + 0.3,
        z: z + Math.sin(a) * r,
        vx: -Math.sin(a) * SPIN * r * 0.4,
        vy: 1.5 + this.rng() * 2,
        vz: Math.cos(a) * SPIN * r * 0.4,
        gravity: 0.2,
        life: 1.6 + this.rng() * 1.2,
        size: core * 0.5,
        sizeEnd: core * 1.6,
        color: 0xa58f6c,
        colorEnd: 0x8a7a62,
        alpha: 0.4 * s,
      });
    }
    return count;
  }
}
