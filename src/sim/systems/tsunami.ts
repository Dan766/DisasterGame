/**
 * Impact tsunami (DESIGN.md §5.1, M7+). An ocean strike launches a wave that travels
 * across open water and floods the coastline it reaches:
 * - Source amplitude grows with crater size; the wave then decays ~ 1/distance
 *   (impact waves are short and disperse faster than earthquake tsunamis).
 * - Travel is a shortest-path flood over ocean cells only, so continents shadow
 *   the water behind them and the wave bends around landmasses.
 * - Wave height at the shore is amplified by shoaling into a run-up; low-lying
 *   coastal cells flood more than elevated ones.
 * `planTsunami` is pure: it returns time-ordered landfalls; `GlobeSim` applies them
 * as game-days pass so a distant coast is hit after a nearby one.
 */
import { greatCircleDistance } from '../../core/geo';
import { cellCenter, cellAt, type GlobalWorld } from '../world';

/** Deep-water wave speed, ~700 km/h. */
export const TSUNAMI_KM_PER_DAY = 700 * 24;
/** Source amplitude cap, meters. */
const MAX_SOURCE_AMPLITUDE_M = 1500;
/** Shoaling amplification from open-water height to shore run-up. */
const RUNUP_FACTOR = 2;
/** Landfalls below this run-up (meters) are ignored. */
const MIN_RUNUP_M = 1;

export interface Landfall {
  cell: number;
  /** Game-days after the strike. */
  arrivalDay: number;
  /** Water height reached at the coast, meters. */
  runupM: number;
}

/** Initial wave amplitude (meters) at the rim of the splash. */
export function sourceAmplitudeM(craterRadiusKm: number): number {
  return Math.min(MAX_SOURCE_AMPLITUDE_M, 60 * Math.max(craterRadiusKm, 0.05) ** 0.9);
}

/** Open-water wave height at `distanceKm` from the source. */
export function waveHeightM(sourceAmplitude: number, craterRadiusKm: number, distanceKm: number) {
  const r = Math.max(craterRadiusKm, 0.05);
  return (sourceAmplitude * r) / Math.max(distanceKm, r);
}

/** Largest distance at which the wave still reaches MIN_RUNUP_M at a shore. */
export function tsunamiReachKm(sourceAmplitude: number, craterRadiusKm: number): number {
  const r = Math.max(craterRadiusKm, 0.05);
  return (sourceAmplitude * r * RUNUP_FACTOR) / MIN_RUNUP_M;
}

/** Fractions of people killed / infrastructure destroyed for a flooded cell. */
export function floodImpact(runupM: number, elevationM: number) {
  const inundation = Math.max(0, Math.min(1, 1 - elevationM / runupM));
  return {
    fatality: inundation * Math.min(0.8, runupM / 30),
    destruction: inundation * Math.min(1, runupM / 15),
  };
}

/** Minimal binary min-heap keyed by distance. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    let i = this.keys.length;
    this.keys.push(key);
    this.vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): { key: number; val: number } {
    const key = this.keys[0]!;
    const val = this.vals[0]!;
    const lastK = this.keys.pop()!;
    const lastV = this.vals.pop()!;
    const n = this.keys.length;
    if (n > 0) {
      this.keys[0] = lastK;
      this.vals[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.keys[l]! < this.keys[m]!) m = l;
        if (r < n && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return { key, val };
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.vals[a], this.vals[b]] = [this.vals[b]!, this.vals[a]!];
  }
}

/** Floods outward from an ocean strike and lists every coastal cell the wave reaches, earliest first. */
export function planTsunami(
  world: GlobalWorld,
  source: { lat: number; lon: number },
  craterRadiusKm: number,
): Landfall[] {
  const { width, height, elevation } = world;
  const start = cellAt(world, source.lat, source.lon);
  if (elevation[start]! >= 0) return [];

  const amplitude = sourceAmplitudeM(craterRadiusKm);
  const reachKm = tsunamiReachKm(amplitude, craterRadiusKm);
  const dist = new Float64Array(width * height).fill(Infinity);
  const landfalls = new Map<number, Landfall>();
  const heap = new MinHeap();
  dist[start] = 0;
  heap.push(0, start);

  while (heap.size > 0) {
    const { key: d, val: cell } = heap.pop();
    if (d > dist[cell]!) continue;
    if (d > reachKm) break;
    const col = cell % width;
    const row = (cell - col) / width;
    const here = cellCenter(world, cell);
    const runup = RUNUP_FACTOR * waveHeightM(amplitude, craterRadiusKm, d);
    for (let dy = -1; dy <= 1; dy++) {
      const nr = row + dy;
      if (nr < 0 || nr >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = (col + dx + width) % width;
        const n = nr * width + nc;
        if (elevation[n]! >= 0) {
          if (runup >= MIN_RUNUP_M && !landfalls.has(n)) {
            landfalls.set(n, { cell: n, arrivalDay: d / TSUNAMI_KM_PER_DAY, runupM: runup });
          }
          continue;
        }
        const nd = d + greatCircleDistance(here, cellCenter(world, n));
        if (nd < dist[n]!) {
          dist[n] = nd;
          heap.push(nd, n);
        }
      }
    }
  }
  return [...landfalls.values()].sort((a, b) => a.arrivalDay - b.arrivalDay);
}
