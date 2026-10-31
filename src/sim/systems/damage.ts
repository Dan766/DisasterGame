/**
 * Radially symmetric damage applied to the global grid: casualties, infrastructure
 * destruction and fire ignition as functions of great-circle distance from a point.
 *
 * Effects much larger than a cell are evaluated per cell (edge cells supersampled).
 * Effects comparable to or smaller than a cell are integrated in polar coordinates
 * around the impact, so a 10 km blast inside a 78 km cell still kills the right
 * fraction of that cell.
 */
import {
  PLANET_RADIUS_KM,
  destinationPoint,
  greatCircleDistance,
  type LatLon,
} from '../../core/geo';
import { cellAt, cellCenter, type GlobalWorld } from '../world';

/** Infrastructure value at risk per resident, in USD. */
export const VALUE_PER_PERSON_USD = 60_000;

/** How readily each biome burns (index = Biome). */
export const FLAMMABILITY = [0, 0, 0.3, 1, 0.8, 0.1, 0.9, 0.2];

export interface DamageSample {
  /** Fraction of people killed, 0–1. */
  fatality: number;
  /** Fraction of infrastructure destroyed, 0–1. */
  destruction: number;
  /** Fire intensity before biome flammability, 0–1. */
  fire: number;
}

export interface DamageTotals {
  deaths: number;
  damageUSD: number;
}

type Profile = (distanceKm: number) => DamageSample;

export function applyRadialDamage(
  world: GlobalWorld,
  center: LatLon,
  maxRadiusKm: number,
  profile: Profile,
  ignite: (cell: number, intensity: number) => void,
): DamageTotals {
  const cellKm = (Math.PI * PLANET_RADIUS_KM) / world.height;
  const perCell =
    maxRadiusKm < cellKm * 3
      ? integratePolar(world, center, maxRadiusKm, profile)
      : sampleGrid(world, center, maxRadiusKm, cellKm, profile);

  const { population, damage, biome } = world;
  const totals: DamageTotals = { deaths: 0, damageUSD: 0 };
  for (const [cell, s] of perCell) {
    const fatality = Math.min(1, s.fatality);
    const destruction = Math.min(1, s.destruction);
    const fire = Math.min(1, s.fire) * FLAMMABILITY[biome[cell]!]!;

    const people = population[cell]!;
    if (people > 0 && fatality > 0) {
      const deaths = people * fatality;
      population[cell] = people - deaths;
      totals.deaths += deaths;
    }
    if (destruction > 0) {
      const before = damage[cell]!;
      const after = 1 - (1 - before) * (1 - destruction);
      damage[cell] = after;
      totals.damageUSD += people * VALUE_PER_PERSON_USD * (after - before);
    }
    if (fire > 0.02) ignite(cell, fire);
  }

  world.stats.casualties += totals.deaths;
  world.stats.damageUSD += totals.damageUSD;
  return totals;
}

/** Cell-average effect for large footprints; cells straddling the outer edge are supersampled. */
function sampleGrid(
  world: GlobalWorld,
  center: LatLon,
  maxRadiusKm: number,
  cellKm: number,
  profile: Profile,
): Map<number, DamageSample> {
  const { width, height } = world;
  const cellDeg = 180 / height;
  const reachKm = maxRadiusKm + cellKm * 1.5;
  const reachDeg = (reachKm / (Math.PI * PLANET_RADIUS_KM)) * 180;
  const rowMin = Math.max(0, Math.floor((90 - (center.lat + reachDeg)) / cellDeg));
  const rowMax = Math.min(height - 1, Math.floor((90 - (center.lat - reachDeg)) / cellDeg));
  const SUB = 3;
  const out = new Map<number, DamageSample>();

  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      const c = cellCenter(world, cell);
      const dCenter = greatCircleDistance(center, c);
      if (dCenter > reachKm) continue;

      const n = Math.abs(dCenter - maxRadiusKm) < cellKm * 1.5 ? SUB : 1;
      const acc: DamageSample = { fatality: 0, destruction: 0, fire: 0 };
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const d =
            n === 1
              ? dCenter
              : greatCircleDistance(center, {
                  lat: c.lat + ((sy + 0.5) / n - 0.5) * cellDeg,
                  lon: c.lon + ((sx + 0.5) / n - 0.5) * (360 / width),
                });
          if (d > maxRadiusKm) continue;
          const s = profile(d);
          acc.fatality += s.fatality;
          acc.destruction += s.destruction;
          acc.fire += s.fire;
        }
      }
      const inv = 1 / (n * n);
      if (acc.fatality + acc.destruction + acc.fire === 0) continue;
      out.set(cell, {
        fatality: acc.fatality * inv,
        destruction: acc.destruction * inv,
        fire: acc.fire * inv,
      });
    }
  }
  return out;
}

/**
 * Area-weighted integral of the profile over the disk, binned into cells and
 * divided by each cell's area: exact for footprints of any size.
 */
function integratePolar(
  world: GlobalWorld,
  center: LatLon,
  maxRadiusKm: number,
  profile: Profile,
): Map<number, DamageSample> {
  const RINGS = 32;
  const SPOKES = 48;
  const dr = maxRadiusKm / RINGS;
  const dTheta = 360 / SPOKES;
  const sums = new Map<number, DamageSample>();

  for (let i = 0; i < RINGS; i++) {
    const r = (i + 0.5) * dr;
    const s = profile(r);
    if (s.fatality + s.destruction + s.fire === 0) continue;
    const area = r * dr * ((dTheta * Math.PI) / 180);
    for (let j = 0; j < SPOKES; j++) {
      const p = destinationPoint(center, (j + 0.5) * dTheta, r);
      const cell = cellAt(world, p.lat, p.lon);
      let acc = sums.get(cell);
      if (!acc) sums.set(cell, (acc = { fatality: 0, destruction: 0, fire: 0 }));
      acc.fatality += s.fatality * area;
      acc.destruction += s.destruction * area;
      acc.fire += s.fire * area;
    }
  }

  for (const [cell, acc] of sums) {
    const cellArea = world.rowAreaKm2[Math.floor(cell / world.width)]!;
    acc.fatality /= cellArea;
    acc.destruction /= cellArea;
    acc.fire /= cellArea;
  }
  return sums;
}
