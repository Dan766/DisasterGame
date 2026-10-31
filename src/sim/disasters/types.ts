/**
 * Disaster plug-in contract (DESIGN.md §4.1). A disaster declares its parameters
 * (the UI builds controls from them), a preview of its reach for the targeting
 * overlay, and how it changes the world when launched.
 */
import type { LatLon } from '../../core/geo';
import type { Rng } from '../../core/rng';
import type { GlobalWorld } from '../world';

export type ParamValue = number | string;
export type Params = Record<string, ParamValue>;

export interface NumberParam {
  kind: 'number';
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  /** Slider response; 'log' for values spanning orders of magnitude. */
  scale?: 'linear' | 'log';
  unit?: string;
}

export interface ChoiceParam {
  kind: 'choice';
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  default: string;
}

export type ParamSpec = NumberParam | ChoiceParam;

export interface PreviewRing {
  kind: 'crater' | 'blast' | 'thermal';
  radiusKm: number;
}

export interface Preview {
  rings: PreviewRing[];
  facts: { label: string; value: string }[];
}

/** Hooks a disaster uses to start ongoing processes owned by shared systems. */
export interface GlobeEffects {
  injectAsh(lat: number, lon: number, sigmaKm: number, mass: number): void;
  ignite(cell: number, intensity: number): void;
  markTerrainChanged(): void;
}

export interface GlobeSpawnContext {
  world: GlobalWorld;
  target: LatLon;
  params: Params;
  rng: Rng;
  effects: GlobeEffects;
}

export interface ImpactOutcome {
  title: string;
  deaths: number;
  damageUSD: number;
  megatons: number;
  craterRadiusKm: number;
  blastRadiusKm: number;
  thermalRadiusKm: number;
  airburst: boolean;
  ocean: boolean;
}

export interface DisasterDef {
  id: string;
  name: string;
  scales: readonly ('globe' | 'region')[];
  params: readonly ParamSpec[];
  preview(params: Params): Preview;
  /** Applies the disaster to the global world at the moment it strikes. */
  spawnGlobe?(ctx: GlobeSpawnContext): ImpactOutcome;
}

export function defaultParams(def: DisasterDef): Params {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}
