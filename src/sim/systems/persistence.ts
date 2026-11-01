/**
 * RegionDelta persistence (DESIGN.md §3.6): captures the scars a visit leaves on a region
 * (craters, burn mask, collapsed structures) and replays them on top of the regenerated
 * base terrain, so a revisited region looks the way it was left.
 */
import { degToRad } from '../../core/geo';
import { createRng } from '../../core/rng';
import {
  FireState,
  M_PER_DEG_LAT,
  REGION_CELL_M,
  Structure,
  type GlobalStrike,
  type RegionDelta,
  type RegionWorld,
} from '../region';
import { stepFire } from './fire';
import { applyBlast, carveCrater, igniteFireball, impactSpecFromKm } from './impact';
import { createLedger, type DamageLedger } from './structureDamage';
import { createWind } from './wind';

/** Fixed-step ticks (0.1 s each) the aftermath fire is allowed to spread before it is frozen. */
const AFTERMATH_FIRE_TICKS = 300;

/** Encodes a 0/1 mask as alternating run lengths, starting with a run of zeros (may be 0). */
export function rleEncode(mask: ArrayLike<number>): number[] {
  const runs: number[] = [];
  let current = 0;
  let len = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === current) {
      len++;
    } else {
      runs.push(len);
      current = v;
      len = 1;
    }
  }
  runs.push(len);
  return runs;
}

/** Inverse of `rleEncode`; returns a `length`-long 0/1 mask (extra/missing runs are clamped). */
export function rleDecode(runs: readonly number[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let pos = 0;
  let value = 0;
  for (const run of runs) {
    const end = Math.min(length, pos + run);
    if (value) out.fill(1, pos, end);
    pos = end;
    value ^= 1;
  }
  return out;
}

/**
 * Folds one visit into the region's stored delta and returns the new delta. Cells still
 * burning at exit are recorded as burnt (the fire is assumed to burn out off-screen).
 * `prior` is the delta the region was generated with, if any.
 */
export function captureDelta(
  region: RegionWorld,
  visit: {
    craters: RegionDelta['craters'];
    damage: DamageLedger;
    tornadoTrack?: RegionDelta['tornadoTrack'];
  },
  prior?: RegionDelta,
): RegionDelta {
  const mask = new Uint8Array(region.fireState.length);
  for (let i = 0; i < mask.length; i++) mask[i] = region.fireState[i] !== FireState.Unburnt ? 1 : 0;

  const destroyed = new Set(prior?.destroyedStructIds);
  for (const i of visit.damage.collapsed) destroyed.add(i);

  const survivors = new Map<number, number>();
  for (let k = 0; k < (prior?.survivors.length ?? 0); k += 2) {
    survivors.set(prior!.survivors[k]!, prior!.survivors[k + 1]!);
  }
  for (const i of visit.damage.collapsed) survivors.set(i, region.population[i]!);

  return {
    craters: [...(prior?.craters ?? []), ...visit.craters.map((c) => ({ ...c }))],
    burnMaskRLE: rleEncode(mask),
    destroyedStructIds: [...destroyed].sort((a, b) => a - b),
    survivors: [...survivors].flat(),
    deaths: (prior?.deaths ?? 0) + visit.damage.deaths,
    tornadoTrack: [
      ...(prior?.tornadoTrack ?? []),
      ...(visit.tornadoTrack ?? []).map((s) => ({ ...s })),
    ],
    strikesApplied: prior?.strikesApplied ?? 0,
  };
}

/** Replays a stored delta onto a freshly generated region. Deterministic. */
export function applyDelta(region: RegionWorld, delta: RegionDelta): void {
  const discard: DamageLedger = createLedger();
  for (const id of delta.destroyedStructIds) {
    region.structure[id] = Structure.None;
    region.structHP[id] = 0;
  }
  for (const c of delta.craters) {
    carveCrater(region, c.col, c.row, c.radiusCells, discard);
  }
  // Craters wipe out residents in their footprint; restore survivors of collapsed cells after.
  for (let k = 0; k + 1 < delta.survivors.length; k += 2) {
    const i = delta.survivors[k]!;
    region.population[i] = Math.min(region.population[i]!, delta.survivors[k + 1]!);
  }
  const burnt = rleDecode(delta.burnMaskRLE, region.fireState.length);
  for (let i = 0; i < burnt.length; i++) {
    if (!burnt[i]) continue;
    region.fireState[i] = FireState.Burnt;
    region.fuel[i] = 0;
    region.heat[i] = 0;
  }
}

/** Fractional (col, row) of a lat/lon within a region; cell centers sit on integers. */
export function strikeToCell(region: RegionWorld, lat: number, lon: number) {
  const cosLat = Math.max(0.05, Math.cos(degToRad(region.lat)));
  const dLon = ((((lon - region.lon + 180) % 360) + 360) % 360) - 180;
  return {
    col: region.size / 2 - 0.5 + (dLon * M_PER_DEG_LAT * cosLat) / REGION_CELL_M,
    row: region.size / 2 - 0.5 - ((lat - region.lat) * M_PER_DEG_LAT) / REGION_CELL_M,
  };
}

/**
 * Plays globe strikes this region has not seen yet onto it, in order: crater, instant blast
 * damage, fireball ignition and a short burst of fire spread. Returns the updated delta to
 * store, or null if nothing reached the region. The region must already have `prior` applied.
 */
export function applyPendingStrikes(
  region: RegionWorld,
  strikes: readonly GlobalStrike[],
  prior?: RegionDelta,
): RegionDelta | null {
  const from = prior?.strikesApplied ?? 0;
  if (from >= strikes.length) return null;

  const ledger = createLedger();
  const craters: RegionDelta['craters'] = [];
  const rng = createRng(region.seed).fork('globe-strikes');
  let touched = false;

  for (let k = from; k < strikes.length; k++) {
    const strike = strikes[k]!;
    const { col, row } = strikeToCell(region, strike.lat, strike.lon);
    const spec = impactSpecFromKm(col, row, strike);
    // Distance from the strike to the nearest point of the region square.
    const edge = region.size - 1;
    const dx = Math.max(0, -col, col - edge);
    const dy = Math.max(0, -row, row - edge);
    const reach = Math.max(
      spec.craterRadiusCells * 1.5,
      spec.blastRadiusCells * 1.8,
      spec.thermalRadiusCells,
    );
    if (Math.hypot(dx, dy) > reach) continue;
    touched = true;

    carveCrater(region, col, row, spec.craterRadiusCells, ledger);
    if (spec.craterRadiusCells > 0) craters.push({ col, row, radiusCells: spec.craterRadiusCells });
    applyBlast(region, col, row, spec.blastRadiusCells, ledger);
    igniteFireball(region, col, row, spec.thermalRadiusCells, rng);
  }
  if (!touched) return null;

  const wind = createWind();
  for (let t = 0; t < AFTERMATH_FIRE_TICKS; t++) {
    if (stepFire(region, wind, rng, 0.1, ledger).burning === 0) break;
  }

  const delta = captureDelta(region, { craters, damage: ledger }, prior);
  delta.strikesApplied = strikes.length;
  return delta;
}
