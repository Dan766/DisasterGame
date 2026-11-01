/**
 * Impact slow-motion: time drops to a floor on a hit, holds briefly, then eases back to 1×.
 * Pure (no DOM/three) so it is unit-testable; the caller multiplies its frame time by `scale`.
 */
export class SlowMo {
  /** Current time scale, 1 = real time. */
  scale = 1;
  private floor = 1;
  private hold = 0;
  private recover = 0;
  private recoverTotal = 1;

  /** Starts a slow-mo; `strength` 0..1 deepens it (0 = barely, 1 = ~0.15×). Never shortens an active one. */
  trigger(strength: number): void {
    const s = Math.min(1, Math.max(0, strength));
    const floor = 1 - 0.85 * s;
    if (this.scale < 1 && floor > this.scale) return; // already slower
    this.floor = floor;
    this.hold = 0.12 + 0.25 * s;
    this.recoverTotal = this.recover = 0.5 + 0.9 * s;
    this.scale = floor;
  }

  /** Advances by real seconds and returns the new scale. */
  update(realDt: number): number {
    if (this.scale >= 1 && this.hold <= 0) return (this.scale = 1);
    if (this.hold > 0) {
      this.hold -= realDt;
      return this.scale;
    }
    this.recover -= realDt;
    const k = Math.max(0, this.recover) / this.recoverTotal;
    this.scale = 1 - (1 - this.floor) * k * k;
    if (this.recover <= 0) this.scale = 1;
    return this.scale;
  }

  reset(): void {
    this.scale = 1;
    this.hold = this.recover = 0;
  }
}
