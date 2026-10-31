/**
 * Regional wind (DESIGN.md §4.2): a uniform base wind plus a coarse grid of local
 * perturbations (fire updrafts, tornado vortices, shock gusts) that decay over time.
 * Directions are in cell space: +x is east (increasing column), +y is south (increasing row).
 */
import { REGION_SIZE } from '../region';

export const WIND_GRID = 32;
const CELLS_PER_WIND_CELL = REGION_SIZE / WIND_GRID;

export interface WindField {
  /** Compass bearing the wind blows FROM, degrees (0 = north, 90 = east). */
  fromDeg: number;
  /** Base speed, m/s. */
  speed: number;
  /** Local perturbation velocity, m/s, per wind-grid cell. */
  readonly px: Float32Array;
  readonly py: Float32Array;
}

export function createWind(fromDeg = 270, speed = 5): WindField {
  return {
    fromDeg,
    speed,
    px: new Float32Array(WIND_GRID * WIND_GRID),
    py: new Float32Array(WIND_GRID * WIND_GRID),
  };
}

/** Unit-speed base velocity vector (the direction the wind blows TOWARD), in cell space. */
export function baseVelocity(wind: WindField): { x: number; y: number } {
  const toward = ((wind.fromDeg + 180) * Math.PI) / 180;
  return { x: Math.sin(toward) * wind.speed, y: -Math.cos(toward) * wind.speed };
}

/** Total wind velocity (m/s) at fractional cell coordinates. */
export function windAt(wind: WindField, col: number, row: number): { x: number; y: number } {
  const base = baseVelocity(wind);
  const gx = Math.min(WIND_GRID - 1, Math.max(0, Math.floor(col / CELLS_PER_WIND_CELL)));
  const gy = Math.min(WIND_GRID - 1, Math.max(0, Math.floor(row / CELLS_PER_WIND_CELL)));
  const i = gy * WIND_GRID + gx;
  return { x: base.x + wind.px[i]!, y: base.y + wind.py[i]! };
}

/** Adds a radial perturbation (e.g. an updraft inflow or a blast gust) around a cell. */
export function addGust(
  wind: WindField,
  col: number,
  row: number,
  radiusCells: number,
  strength: number,
  /** 'out' pushes air away from the center, 'in' pulls it toward the center. */
  mode: 'out' | 'in' = 'out',
): void {
  const sign = mode === 'out' ? 1 : -1;
  for (let gy = 0; gy < WIND_GRID; gy++) {
    for (let gx = 0; gx < WIND_GRID; gx++) {
      const dx = (gx + 0.5) * CELLS_PER_WIND_CELL - col;
      const dy = (gy + 0.5) * CELLS_PER_WIND_CELL - row;
      const d = Math.hypot(dx, dy);
      if (d > radiusCells || d === 0) continue;
      const falloff = 1 - d / radiusCells;
      const i = gy * WIND_GRID + gx;
      wind.px[i] = wind.px[i]! + sign * (dx / d) * strength * falloff;
      wind.py[i] = wind.py[i]! + sign * (dy / d) * strength * falloff;
    }
  }
}

/** Exponentially decays all perturbations toward the base wind. */
export function stepWind(wind: WindField, dt: number, halfLifeS = 6): void {
  const k = Math.pow(0.5, dt / halfLifeS);
  for (let i = 0; i < wind.px.length; i++) {
    wind.px[i] = wind.px[i]! * k;
    wind.py[i] = wind.py[i]! * k;
  }
}

/**
 * Adds a rotating perturbation (a tornado vortex): counter-clockwise swirl around a cell
 * with a small inflow component. `strength` is the peak tangential speed (m/s) at
 * `radiusCells / 2`; it fades to zero at `radiusCells`.
 */
export function addVortex(
  wind: WindField,
  col: number,
  row: number,
  radiusCells: number,
  strength: number,
  inflow = 0.3,
): void {
  for (let gy = 0; gy < WIND_GRID; gy++) {
    for (let gx = 0; gx < WIND_GRID; gx++) {
      const dx = (gx + 0.5) * CELLS_PER_WIND_CELL - col;
      const dy = (gy + 0.5) * CELLS_PER_WIND_CELL - row;
      const d = Math.hypot(dx, dy);
      if (d > radiusCells || d === 0) continue;
      const u = d / radiusCells;
      // Rises to a peak at u = 0.5, then falls to zero at the edge.
      const profile = 4 * u * (1 - u) * strength;
      // Screen space has +y south, so "counter-clockwise on the map" is (dy, -dx)/d.
      const tx = dy / d;
      const ty = -dx / d;
      const i = gy * WIND_GRID + gx;
      wind.px[i] = wind.px[i]! + profile * (tx - inflow * (dx / d));
      wind.py[i] = wind.py[i]! + profile * (ty - inflow * (dy / d));
    }
  }
}
