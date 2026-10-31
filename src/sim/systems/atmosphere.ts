/**
 * Global ash/dust transport and climate response (DESIGN.md §5.1 "Globe effects").
 *
 * Ash is optical depth τ on a coarse grid. Each step it is carried by latitude-banded
 * zonal winds (semi-Lagrangian, so any time step is stable), mixed by diffusion,
 * and rained out. Mean τ sets an equilibrium cooling that the temperature anomaly
 * relaxes toward, so impact winter sets in over weeks and lifts over years.
 */
import { greatCircleDistance } from '../../core/geo';
import { smoothstep } from '../../core/math';
import type { GlobalWorld } from '../world';

/** e-folding time for ash fallout. */
export const ASH_LIFETIME_DAYS = 240;
/** Climate response time of the temperature anomaly. */
export const CLIMATE_RESPONSE_DAYS = 20;
/** Cooling at full saturation of the sky. */
export const MAX_COOLING_C = 18;
/** Diffusivity in ash cells² per day (meridional + zonal mixing). */
const DIFFUSIVITY = 1.2;

/** Zonal wind in degrees of longitude per day: easterly trades, westerlies, polar easterlies. */
export function zonalWindDegPerDay(lat: number): number {
  const a = Math.abs(lat);
  const trades = -9 * (1 - smoothstep(20, 32, a));
  const westerlies = 24 * smoothstep(28, 40, a) * (1 - smoothstep(55, 68, a));
  const polar = -4 * smoothstep(65, 75, a);
  return trades + westerlies + polar;
}

/** Equilibrium temperature anomaly (°C, ≤ 0) for a global mean optical depth. */
export function equilibriumCooling(meanTau: number): number {
  return -MAX_COOLING_C * (1 - Math.exp(-1.6 * meanTau));
}

/** Adds `mass` (τ·km²) of ash as a Gaussian plume of width `sigmaKm` around a point. */
export function injectAsh(
  world: GlobalWorld,
  lat: number,
  lon: number,
  sigmaKm: number,
  mass: number,
): void {
  const { ash, ashWidth: w, ashHeight: h, ashRowAreaKm2 } = world;
  const weights = new Float64Array(w * h);
  let total = 0;
  const twoSigma2 = 2 * sigmaKm * sigmaKm;
  for (let row = 0; row < h; row++) {
    const cellLat = 90 - ((row + 0.5) * 180) / h;
    const area = ashRowAreaKm2[row]!;
    for (let col = 0; col < w; col++) {
      const cellLon = -180 + ((col + 0.5) * 360) / w;
      const d = greatCircleDistance({ lat, lon }, { lat: cellLat, lon: cellLon });
      if (d > sigmaKm * 3.5) continue;
      const wgt = Math.exp(-(d * d) / twoSigma2) * area;
      weights[row * w + col] = wgt;
      total += wgt;
    }
  }
  if (total === 0) {
    // Plume narrower than one ash cell: drop it all into the containing cell.
    const col = Math.min(w - 1, Math.floor(((lon + 180) / 360) * w));
    const row = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));
    ash[row * w + col] += mass / ashRowAreaKm2[row]!;
    return;
  }
  for (let i = 0; i < weights.length; i++) {
    const wgt = weights[i]!;
    if (wgt > 0) ash[i] += (mass * wgt) / total / ashRowAreaKm2[Math.floor(i / w)]!;
  }
}

/** Total ash in τ·km². */
export function totalAsh(world: GlobalWorld): number {
  const { ash, ashWidth: w, ashHeight: h, ashRowAreaKm2 } = world;
  let sum = 0;
  for (let row = 0; row < h; row++) {
    let rowSum = 0;
    for (let col = 0; col < w; col++) rowSum += ash[row * w + col]!;
    sum += rowSum * ashRowAreaKm2[row]!;
  }
  return sum;
}

/** Area-weighted global mean optical depth. */
export function meanAsh(world: GlobalWorld): number {
  let area = 0;
  for (let row = 0; row < world.ashHeight; row++)
    area += world.ashRowAreaKm2[row]! * world.ashWidth;
  return totalAsh(world) / area;
}

let scratch = new Float32Array(0);

export function stepAtmosphere(world: GlobalWorld, dtDays: number): void {
  const { ash, ashWidth: w, ashHeight: h } = world;
  if (scratch.length !== ash.length) scratch = new Float32Array(ash.length);
  let any = false;
  for (let i = 0; i < ash.length; i++)
    if (ash[i]! > 1e-7) {
      any = true;
      break;
    }

  if (any) {
    // 1. Zonal advection, semi-Lagrangian with linear interpolation (mass-conserving per row).
    for (let row = 0; row < h; row++) {
      const lat = 90 - ((row + 0.5) * 180) / h;
      const shiftCells = (zonalWindDegPerDay(lat) * dtDays * w) / 360;
      const base = row * w;
      for (let col = 0; col < w; col++) {
        const src = col - shiftCells;
        const i0 = Math.floor(src);
        const f = src - i0;
        const a = ash[base + (((i0 % w) + w) % w)]!;
        const b = ash[base + ((((i0 + 1) % w) + w) % w)]!;
        scratch[base + col] = a * (1 - f) + b * f;
      }
    }
    ash.set(scratch);

    // 2. Diffusion, sub-stepped to stay stable. Meridional exchange uses symmetric
    //    area-weighted fluxes so mass is conserved between rows of different area,
    //    with no flux across the poles.
    const area = world.ashRowAreaKm2;
    const iterations = Math.max(1, Math.ceil((DIFFUSIVITY * dtDays) / 0.2));
    const k = (DIFFUSIVITY * dtDays) / iterations;
    for (let it = 0; it < iterations; it++) {
      for (let row = 0; row < h; row++) {
        const a = area[row]!;
        const kn = row > 0 ? (k * Math.min(a, area[row - 1]!)) / a : 0;
        const ks = row < h - 1 ? (k * Math.min(a, area[row + 1]!)) / a : 0;
        for (let col = 0; col < w; col++) {
          const i = row * w + col;
          const c = ash[i]!;
          const east = ash[row * w + ((col + 1) % w)]!;
          const west = ash[row * w + ((col - 1 + w) % w)]!;
          const north = row > 0 ? ash[i - w]! : c;
          const south = row < h - 1 ? ash[i + w]! : c;
          scratch[i] = c + k * (east + west - 2 * c) + kn * (north - c) + ks * (south - c);
        }
      }
      ash.set(scratch);
    }

    // 3. Fallout.
    const keep = Math.exp(-dtDays / ASH_LIFETIME_DAYS);
    for (let i = 0; i < ash.length; i++) ash[i] *= keep;
  }

  // 4. Climate relaxes toward the equilibrium set by the current sky.
  const target = equilibriumCooling(any ? meanAsh(world) : 0);
  const s = world.stats;
  s.globalTempAnomaly +=
    (target - s.globalTempAnomaly) * (1 - Math.exp(-dtDays / CLIMATE_RESPONSE_DAYS));
}
