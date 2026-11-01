/**
 * Trauma-based camera shake. Impacts add "trauma" (0..1); the visible amplitude is trauma²,
 * so small hits barely register and big ones hit hard. Offsets come from layered sines, not
 * white noise, so the camera sways instead of jittering. Pure (no DOM/three/Math.random).
 */
export class CameraShake {
  /** Current trauma, 0..1. */
  trauma = 0;
  private time = 0;

  /** Adds trauma. Never lowers an active shake; stacked hits accumulate with diminishing returns. */
  add(amount: number): void {
    const a = Math.min(1, Math.max(0, amount));
    this.trauma = Math.min(1, Math.max(this.trauma, a) + a * (1 - this.trauma) * 0.35);
  }

  /** Raises trauma to at least `amount` without stacking, so a sustained source (quake) can call it every frame. */
  hold(amount: number): void {
    this.trauma = Math.max(this.trauma, Math.min(1, Math.max(0, amount)));
  }

  /** Advances by sim seconds; trauma decays linearly. */
  update(dt: number): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.1);
  }

  /** Smooth offset in -1..1 per axis, scaled by trauma². Multiply by a distance-based amplitude. */
  sample(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const k = this.trauma * this.trauma;
    const t = this.time;
    out.x = k * wobble(t, 0);
    out.y = k * wobble(t, 1);
    out.z = k * wobble(t, 2);
    return out;
  }

  reset(): void {
    this.trauma = 0;
    this.time = 0;
  }
}

/** Sum of two incommensurate sines per axis, normalised to -1..1; ~8-14 Hz. */
function wobble(t: number, axis: number): number {
  const f = 9 + axis * 2.3;
  return Math.sin(t * f + axis * 1.7) * 0.65 + Math.sin(t * f * 1.618 + axis * 4.1) * 0.35;
}
