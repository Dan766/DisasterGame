/**
 * Asteroid impact (DESIGN.md §5.1). Plausible, simplified scaling laws:
 * - Kinetic energy from size, density and speed.
 * - Final crater diameter ≈ 0.58 km · E_Mt^0.317 · sin(angle)^(1/3), fitted to
 *   Meteor Crater (~1.2 km) and Chicxulub (~180 km).
 * - Air blast (≈5 psi, structures flattened) ∝ E^(1/3), like nuclear yield scaling.
 * - Thermal ignition radius ∝ E^0.38, capped where the horizon blocks the fireball.
 * - Small weak bodies airburst: no crater, but a wider blast (Tunguska, Chelyabinsk).
 * - Ejected dust scales with energy; at Chicxulub energy it veils the whole sky (τ≈1).
 */
import { PLANET_RADIUS_KM, degToRad, greatCircleDistance } from '../../core/geo';
import { smoothstep } from '../../core/math';
import { applyRadialDamage } from '../systems/damage';
import { cellAt, type GlobalWorld } from '../world';
import { describeLocation } from '../describe';
import type { DisasterDef, GlobeSpawnContext, ImpactOutcome, Params, Preview } from './types';

export const COMPOSITIONS = {
  stony: { label: 'Stony', density: 3000, airburstBelowM: 60 },
  iron: { label: 'Iron', density: 7800, airburstBelowM: 15 },
  icy: { label: 'Icy', density: 1000, airburstBelowM: 120 },
} as const;
export type Composition = keyof typeof COMPOSITIONS;

export interface AsteroidParams {
  diameterM: number;
  velocityKms: number;
  angleDeg: number;
  composition: Composition;
}

export interface AsteroidEffects {
  massKg: number;
  energyJ: number;
  megatons: number;
  airburst: boolean;
  craterRadiusKm: number;
  blastRadiusKm: number;
  thermalRadiusKm: number;
  /** Dust lofted into the atmosphere, in τ·km². */
  ashMass: number;
}

const JOULES_PER_MEGATON = 4.184e15;
const EARTH_AREA_KM2 = 4 * Math.PI * PLANET_RADIUS_KM ** 2;
/** Chicxulub-scale energy that veils the whole planet at τ ≈ 1. */
const SKY_VEIL_MEGATONS = 7.5e7;
const MAX_THERMAL_KM = 5000;

export function asteroidEffects(p: AsteroidParams): AsteroidEffects {
  const comp = COMPOSITIONS[p.composition];
  const radiusM = p.diameterM / 2;
  const massKg = comp.density * (4 / 3) * Math.PI * radiusM ** 3;
  const energyJ = 0.5 * massKg * (p.velocityKms * 1000) ** 2;
  const megatons = energyJ / JOULES_PER_MEGATON;
  const airburst = p.diameterM < comp.airburstBelowM;
  const angleFactor = Math.sin(degToRad(p.angleDeg)) ** (1 / 3);
  return {
    massKg,
    energyJ,
    megatons,
    airburst,
    craterRadiusKm: airburst ? 0 : 0.5 * 0.58 * megatons ** 0.317 * angleFactor,
    blastRadiusKm: 4.6 * megatons ** (1 / 3) * (airburst ? 2.2 : 1),
    thermalRadiusKm: Math.min(10 * megatons ** 0.38, MAX_THERMAL_KM),
    ashMass: EARTH_AREA_KM2 * (megatons / SKY_VEIL_MEGATONS) ** 0.85 * (airburst ? 0.1 : 1),
  };
}

export function parseAsteroidParams(params: Params): AsteroidParams {
  const composition = String(params.composition);
  return {
    diameterM: Number(params.diameterM),
    velocityKms: Number(params.velocityKms),
    angleDeg: Number(params.angleDeg),
    composition: composition in COMPOSITIONS ? (composition as Composition) : 'stony',
  };
}

export function formatDiameter(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`;
}

export function formatMegatons(mt: number): string {
  if (mt < 1) return `${Math.round(mt * 1000)} kt`;
  if (mt < 1e3) return `${mt.toFixed(mt < 10 ? 1 : 0)} Mt`;
  if (mt < 1e6) return `${Math.round(mt).toLocaleString('en-US')} Mt`;
  return `${(mt / 1e6).toFixed(1)} million Mt`;
}

function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-US')} km`;
}

/** Per-distance damage for a given impact. */
function impactProfile(fx: AsteroidEffects) {
  const { craterRadiusKm: rc, blastRadiusKm: rb, thermalRadiusKm: rt } = fx;
  return (d: number) => {
    if (d < rc) return { fatality: 1, destruction: 1, fire: 0 };
    const blast = d < rb ? 1 - 0.75 * (d / rb) ** 1.5 : 0;
    const heat = d < rt ? 1 - d / rt : 0;
    return {
      fatality: Math.max(blast, 0.25 * heat ** 1.5),
      destruction: Math.max(d < rb ? 1 - 0.7 * (d / rb) ** 2 : 0, 0.15 * heat),
      fire: heat ** 0.7,
    };
  };
}

/** Carves a bowl with a raised rim for craters big enough to show on the globe grid. */
function carveCrater(world: GlobalWorld, lat: number, lon: number, radiusKm: number): boolean {
  const cellKm = (Math.PI * PLANET_RADIUS_KM) / world.height;
  // Smaller craters are drawn exactly by the globe shader; carving them into the
  // coarse grid would only add blocky steps.
  if (radiusKm < cellKm * 2) return false;
  const depth = Math.min(3000, 25 * radiusKm);
  const rim = depth * 0.25;
  const { width, height, elevation } = world;
  const reachDeg = ((radiusKm * 1.4) / (Math.PI * PLANET_RADIUS_KM)) * 180 + 180 / height;
  for (let row = 0; row < height; row++) {
    const cellLat = 90 - ((row + 0.5) * 180) / height;
    if (Math.abs(cellLat - lat) > reachDeg) continue;
    for (let col = 0; col < width; col++) {
      const cellLon = -180 + ((col + 0.5) * 360) / width;
      const x = greatCircleDistance({ lat, lon }, { lat: cellLat, lon: cellLon }) / radiusKm;
      if (x > 1.4) continue;
      const i = row * width + col;
      const before = elevation[i]!;
      const change = x < 1 ? -depth * (1 - x * x) : rim * (1 - smoothstep(1, 1.4, x));
      // Land stays land (craters read as scars, not lakes); the seafloor is only ever
      // deepened, so rims never pile up into fake shallows.
      elevation[i] = before >= 0 ? Math.max(1, before + change) : before + Math.min(0, change);
    }
  }
  return true;
}

export const asteroid: DisasterDef = {
  id: 'asteroid',
  name: 'Asteroid',
  scales: ['globe', 'region'],
  params: [
    {
      kind: 'number',
      key: 'diameterM',
      label: 'Diameter',
      min: 10,
      max: 10000,
      default: 500,
      scale: 'log',
      unit: 'm',
    },
    {
      kind: 'number',
      key: 'velocityKms',
      label: 'Speed',
      min: 11,
      max: 70,
      default: 20,
      unit: 'km/s',
    },
    {
      kind: 'number',
      key: 'angleDeg',
      label: 'Entry angle',
      min: 15,
      max: 90,
      default: 45,
      unit: '°',
    },
    {
      kind: 'choice',
      key: 'composition',
      label: 'Composition',
      options: Object.entries(COMPOSITIONS).map(([value, c]) => ({ value, label: c.label })),
      default: 'stony',
    },
  ],

  preview(params: Params): Preview {
    const fx = asteroidEffects(parseAsteroidParams(params));
    const rings: Preview['rings'] = [
      { kind: 'thermal', radiusKm: fx.thermalRadiusKm },
      { kind: 'blast', radiusKm: fx.blastRadiusKm },
    ];
    if (!fx.airburst) rings.push({ kind: 'crater', radiusKm: fx.craterRadiusKm });
    return {
      rings,
      facts: [
        { label: 'Energy', value: formatMegatons(fx.megatons) },
        {
          label: 'Crater',
          value: fx.airburst ? 'none (airburst)' : formatKm(fx.craterRadiusKm * 2),
        },
        { label: 'Blast radius', value: formatKm(fx.blastRadiusKm) },
        { label: 'Fire radius', value: formatKm(fx.thermalRadiusKm) },
      ],
    };
  },

  spawnGlobe({ world, target, params, effects }: GlobeSpawnContext): ImpactOutcome {
    const p = parseAsteroidParams(params);
    const fx = asteroidEffects(p);
    const ocean = world.elevation[cellAt(world, target.lat, target.lon)]! < 0;
    const location = describeLocation(world, target);

    const maxRadius = Math.max(fx.craterRadiusKm, fx.blastRadiusKm, fx.thermalRadiusKm);
    const totals = applyRadialDamage(world, target, maxRadius, impactProfile(fx), effects.ignite);

    if (!fx.airburst) {
      if (carveCrater(world, target.lat, target.lon, fx.craterRadiusKm))
        effects.markTerrainChanged();
      world.craters.push({ lat: target.lat, lon: target.lon, radiusKm: fx.craterRadiusKm, ocean });
    }
    if (ocean && !fx.airburst) effects.launchTsunami(target.lat, target.lon, fx.craterRadiusKm);
    // Ocean strikes loft more vapor than dust.
    effects.injectAsh(
      target.lat,
      target.lon,
      Math.max(fx.blastRadiusKm * 1.5, 300),
      fx.ashMass * (ocean ? 0.6 : 1),
    );

    const kind = `${COMPOSITIONS[p.composition].label.toLowerCase()} asteroid`;
    const verb = fx.airburst ? 'exploded over' : 'struck';
    return {
      title: `${formatDiameter(p.diameterM)} ${kind} ${verb} ${location}`,
      deaths: totals.deaths,
      damageUSD: totals.damageUSD,
      megatons: fx.megatons,
      craterRadiusKm: fx.craterRadiusKm,
      blastRadiusKm: fx.blastRadiusKm,
      thermalRadiusKm: fx.thermalRadiusKm,
      airburst: fx.airburst,
      ocean,
    };
  },
};
