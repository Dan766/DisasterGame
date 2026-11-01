/**
 * Message protocol between the main thread and the region sim worker (DESIGN.md §4).
 * Plain data only, so it survives structured cloning; typed arrays travel as transferables.
 */
import type { Shockwave } from './systems/impact';
import type { ImpactSpec } from './systems/impact';
import type { FireStepResult } from './systems/fire';
import type { TornadoSpec } from './disasters/tornado';
import type { Town } from './region';

/** Everything the presentation needs from a tornado. */
export interface TornadoView {
  col: number;
  row: number;
  radiusCells: number;
  /** 0..1 life envelope. */
  strength: number;
}

export interface RegionInit {
  id: string;
  seed: number;
  lat: number;
  lon: number;
  size: number;
  centerBiome: number;
  towns: Town[];
  height: Float32Array;
  water: Float32Array;
  biome: Uint8Array;
  fuel: Float32Array;
  moisture: Float32Array;
  fireState: Uint8Array;
  heat: Float32Array;
  structure: Uint8Array;
  structHP: Float32Array;
  population: Float32Array;
}

export type ToWorker =
  | { type: 'init'; region: RegionInit; wind: { fromDeg: number; speed: number } }
  | { type: 'step'; ticks: number; token: number }
  | { type: 'ignite'; col: number; row: number; radiusCells?: number; intensity?: number }
  | { type: 'tornado'; spec: TornadoSpec }
  | { type: 'impact'; spec: ImpactSpec; token: number }
  | { type: 'wind'; fromDeg: number; speed: number }
  /** Asks for a snapshot reflecting every message sent before this one. */
  | { type: 'flush'; token: number };

export interface ShockwaveSnap extends Shockwave {
  id: number;
}

/** State the sim changed since the previous snapshot. Sent after every handled message. */
export interface Snapshot {
  type: 'snapshot';
  /** Tokens of the step/impact/flush messages this snapshot answers. */
  tokens: number[];
  /** Per-cell layers that change as the sim runs. */
  fuel: Float32Array;
  heat: Float32Array;
  fireState: Uint8Array;
  structure: Uint8Array;
  structHP: Float32Array;
  population: Float32Array;
  /** Present only after terrain changed (impacts). */
  terrain?: { height: Float32Array; water: Float32Array; moisture: Float32Array };
  elapsed: number;
  lastFire: FireStepResult;
  windPx: Float32Array;
  windPy: Float32Array;
  deaths: number;
  structuresLost: number;
  /** Lists are sent whole, and only when their length changed. */
  collapsed?: number[];
  craters?: { col: number; row: number; radiusCells: number }[];
  tornadoTrack?: { col: number; row: number; radiusCells: number }[];
  tornados: TornadoView[];
  shockwaves: ShockwaveSnap[];
}

export type FromWorker = Snapshot;

/** One end of a message channel (a Worker, or a loopback in tests). */
export interface Transport {
  post(msg: ToWorker, transfer?: Transferable[]): void;
  onMessage(cb: (msg: FromWorker) => void): void;
  terminate(): void;
}
