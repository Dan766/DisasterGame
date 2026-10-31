/** Camera dive and white-flash fade between the globe and a region (DESIGN.md §6.3). */

export const easeInCubic = (t: number): number => t * t * t;
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** Runs `step(t)` with eased t in [0, 1] over `ms`, once per animation frame. */
export function tween(ms: number, step: (t: number) => void, ease = easeInOutCubic): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      step(ease(t));
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

export class Transition {
  readonly el = document.createElement('div');
  private busy = false;

  constructor() {
    this.el.className = 'transition-flash';
  }

  get active(): boolean {
    return this.busy;
  }

  private setOpacity(v: number): void {
    this.el.style.opacity = String(v);
  }

  /**
   * Fades to white, runs `swap` (the scene change, may be slow) while fully
   * covered, then fades back in. `before` runs first, alongside the fade-out
   * (the camera dive); `after` runs alongside the fade-in (the camera settle).
   */
  async run(opts: {
    before?: (flash: (t: number) => void) => Promise<void>;
    fadeOutMs: number;
    swap: () => void | Promise<void>;
    after?: () => Promise<void>;
    fadeInMs: number;
  }): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const fadeOut = (t: number) => this.setOpacity(t);
      if (opts.before) {
        await opts.before(fadeOut);
      } else {
        await tween(opts.fadeOutMs, fadeOut);
      }
      this.setOpacity(1);
      await opts.swap();
      const settle = opts.after?.();
      await tween(opts.fadeInMs, (t) => this.setOpacity(1 - t), easeOutCubic);
      await settle;
    } finally {
      this.setOpacity(0);
      this.busy = false;
    }
  }
}
