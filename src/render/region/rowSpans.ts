/**
 * Tracks, per texture row, the min..max changed column so a DataTexture can be
 * re-uploaded with one narrow `texSubImage2D` per touched row instead of the whole image.
 * (three.js update ranges are contiguous memory and are uploaded one row high, so a range
 * must never straddle a row.)
 */
export class RowSpans {
  private readonly lo: Int32Array;
  private readonly hi: Int32Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.lo = new Int32Array(height).fill(-1);
    this.hi = new Int32Array(height).fill(-1);
  }

  mark(row: number, col: number): void {
    if (this.lo[row]! < 0 || col < this.lo[row]!) this.lo[row] = col;
    if (col > this.hi[row]!) this.hi[row] = col;
  }

  get isEmpty(): boolean {
    for (let r = 0; r < this.height; r++) if (this.lo[r]! >= 0) return false;
    return true;
  }

  /** Dirty spans as `[startPixel, pixelCount]` in row-major pixel indices (one per touched row). */
  spans(): [number, number][] {
    const out: [number, number][] = [];
    for (let r = 0; r < this.height; r++) {
      if (this.lo[r]! < 0) continue;
      out.push([r * this.width + this.lo[r]!, this.hi[r]! - this.lo[r]! + 1]);
    }
    return out;
  }

  reset(): void {
    this.lo.fill(-1);
    this.hi.fill(-1);
  }
}
