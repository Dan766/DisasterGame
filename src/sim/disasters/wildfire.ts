/**
 * Wildfire (DESIGN.md §5.3), region-scale. An ignition brush: clicking the terrain sets
 * fuel alight in a disk, and the fire cellular automaton (systems/fire.ts) does the rest,
 * driven by wind, slope, fuel and moisture. Replaces the M4a debug ignite.
 */
import { clamp } from '../../core/math';
import { REGION_CELL_M } from '../region';
import type { DisasterDef, Params, Preview } from './types';

export interface WildfireSpec {
  /** Brush radius in region cells. */
  radiusCells: number;
  /** Probability each burnable cell in the brush catches (0..1). */
  intensity: number;
}

/** Reads the panel params into an ignition spec. */
export function wildfireSpecFromParams(params: Params): WildfireSpec {
  return {
    radiusCells: clamp(Number(params.brushCells ?? 3), 1, 12),
    intensity: clamp(Number(params.intensityPct ?? 90) / 100, 0.05, 1),
  };
}

export const wildfire: DisasterDef = {
  id: 'wildfire',
  name: 'Wildfire',
  scales: ['region'],
  params: [
    { kind: 'number', key: 'brushCells', label: 'Brush radius', min: 1, max: 12, default: 3 },
    {
      kind: 'number',
      key: 'intensityPct',
      label: 'Ignition density',
      min: 10,
      max: 100,
      default: 90,
      unit: '%',
    },
  ],

  preview(params: Params): Preview {
    const spec = wildfireSpecFromParams(params);
    return {
      rings: [],
      facts: [
        { label: 'Brush diameter', value: `${Math.round(spec.radiusCells * 2 * REGION_CELL_M)} m` },
        { label: 'Max ignition', value: `${Math.round(Math.PI * spec.radiusCells ** 2)} cells` },
      ],
    };
  },
};
