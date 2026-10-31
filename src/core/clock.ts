/**
 * Fixed-timestep accumulator. The render loop feeds it real frame time; it says
 * how many fixed sim steps to run and how far between steps to interpolate.
 */
export class FixedStepClock {
  /** Sim speed multiplier (1×, 10×, 100×…). */
  speed = 1;
  paused = false;

  private accumulator = 0;

  constructor(
    /** Real milliseconds per sim step at 1× speed. */
    readonly stepMs: number,
    /** Upper bound on steps per frame so a slow frame can't spiral. */
    readonly maxStepsPerFrame = 32,
    /** Frame deltas above this (tab was hidden, debugger pause) are clamped. */
    readonly maxFrameMs = 250,
  ) {}

  /** Advances by one rendered frame and returns the number of sim steps to run. */
  advance(frameMs: number): number {
    if (this.paused) return 0;
    this.accumulator += Math.min(Math.max(frameMs, 0), this.maxFrameMs) * this.speed;
    const steps = Math.min(Math.floor(this.accumulator / this.stepMs), this.maxStepsPerFrame);
    this.accumulator -= steps * this.stepMs;
    // When overloaded, drop the time we couldn't simulate instead of carrying it forever.
    if (this.accumulator >= this.stepMs) this.accumulator %= this.stepMs;
    return steps;
  }

  /** Interpolation factor in [0, 1) between the previous and current sim state. */
  get alpha(): number {
    return this.accumulator / this.stepMs;
  }
}
