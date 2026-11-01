/**
 * Main-thread handle on the region sim running in a worker. It keeps a mirror of the region
 * (same `RegionWorld` shape the views and the globe syncer already read) that is refreshed
 * from worker snapshots, and turns player actions into commands. Mirrors lag the sim by at
 * most one snapshot; `flush()` waits for one that includes everything sent so far.
 */
import type { RegionWorld } from './region';
import type { FireStepResult } from './systems/fire';
import type { ImpactSpec, Shockwave } from './systems/impact';
import type { TornadoSpec } from './disasters/tornado';
import type { Edge } from './systems/water';
import { createLedger, type DamageLedger } from './systems/structureDamage';
import type { WindField } from './systems/wind';
import type { FromWorker, RegionInit, Snapshot, TornadoView, Transport } from './regionProtocol';

/** Ticks queued while a step is in flight are capped so a slow worker cannot snowball. */
const MAX_PENDING_TICKS = 20;

export class RegionSimClient {
  /** The mirror: views, emitters and the syncer read it exactly like a local region. */
  readonly region: RegionWorld;
  /** Authoritative on this side (the panel edits it); `setWind` forwards changes. */
  readonly wind: WindField;
  elapsed = 0;
  lastFire: FireStepResult = { ignited: 0, burntOut: 0, burning: 0, structuresLost: 0 };
  readonly damage: DamageLedger = createLedger();
  readonly shockwaves: Shockwave[] = [];
  readonly craters: { col: number; row: number; radiusCells: number }[] = [];
  readonly tornados: TornadoView[] = [];
  readonly tornadoTrack: { col: number; row: number; radiusCells: number }[] = [];
  /** Called after each snapshot is applied. */
  onSnapshot: (() => void) | null = null;

  private fresh = false;
  private nextToken = 1;
  private stepInFlight = false;
  private pendingTicks = 0;
  private readonly waiters = new Map<number, () => void>();
  private readonly waveById = new Map<number, Shockwave>();

  constructor(
    region: RegionWorld,
    wind: WindField,
    private readonly transport: Transport,
  ) {
    this.region = region;
    this.wind = wind;
    transport.onMessage((m) => this.receive(m));
    const copy = <T extends Float32Array | Uint8Array>(a: T): T => a.slice() as T;
    const init: RegionInit = {
      id: region.id,
      seed: region.seed,
      lat: region.lat,
      lon: region.lon,
      size: region.size,
      centerBiome: region.centerBiome,
      towns: region.towns,
      height: copy(region.height),
      water: copy(region.water),
      biome: copy(region.biome),
      fuel: copy(region.fuel),
      moisture: copy(region.moisture),
      fireState: copy(region.fireState),
      heat: copy(region.heat),
      structure: copy(region.structure),
      structHP: copy(region.structHP),
      population: copy(region.population),
    };
    const transfer = [
      init.height,
      init.water,
      init.biome,
      init.fuel,
      init.moisture,
      init.fireState,
      init.heat,
      init.structure,
      init.structHP,
      init.population,
    ].map((a) => a.buffer);
    transport.post(
      { type: 'init', region: init, wind: { fromDeg: wind.fromDeg, speed: wind.speed } },
      transfer,
    );
  }

  /** Queues fixed region ticks; at most one step request is outstanding at a time. */
  advance(ticks: number): void {
    this.pendingTicks = Math.min(MAX_PENDING_TICKS, this.pendingTicks + ticks);
    this.pump();
  }

  private pump(): void {
    if (this.stepInFlight) return;
    this.sendPending(() => {
      this.stepInFlight = false;
      this.pump();
    });
  }

  /** Sends queued ticks as one step message; `done` runs when the worker has run them. */
  private sendPending(done: () => void): void {
    if (this.pendingTicks <= 0) return;
    this.stepInFlight = true;
    const ticks = this.pendingTicks;
    this.pendingTicks = 0;
    const token = this.nextToken++;
    this.waiters.set(token, done);
    this.transport.post({ type: 'step', ticks, token });
  }

  ignite(col: number, row: number, radiusCells?: number, intensity?: number): void {
    this.transport.post({ type: 'ignite', col, row, radiusCells, intensity });
  }

  spawnTornado(spec: TornadoSpec): void {
    this.transport.post({ type: 'tornado', spec });
  }

  /** Sends a one-crest tsunami in through a region edge. */
  spawnTsunami(edge: Edge, amplitudeM: number, durationS?: number): void {
    this.transport.post({ type: 'tsunami', edge, amplitudeM, durationS });
  }

  /** Resolves once the worker has resolved the impact and its terrain change is mirrored. */
  impact(spec: ImpactSpec): Promise<void> {
    return this.request((token) => ({ type: 'impact', spec, token }));
  }

  /** Resolves with a mirror that includes every command sent so far. */
  flush(): Promise<void> {
    return this.request((token) => ({ type: 'flush', token }));
  }

  setWind(fromDeg: number, speed: number): void {
    this.wind.fromDeg = fromDeg;
    this.wind.speed = speed;
    this.transport.post({ type: 'wind', fromDeg, speed });
  }

  /** True once per applied snapshot; the loop uses it to refresh the fire overlay. */
  takeFresh(): boolean {
    const f = this.fresh;
    this.fresh = false;
    return f;
  }

  dispose(): void {
    this.transport.terminate();
    this.waiters.clear();
  }

  private request(build: (token: number) => Parameters<Transport['post']>[0]): Promise<void> {
    // The worker handles messages in order, so queued ticks go first and nothing is skipped.
    this.sendPending(() => {});
    return new Promise((resolve) => {
      const token = this.nextToken++;
      this.waiters.set(token, resolve);
      this.transport.post(build(token));
    });
  }

  private receive(s: FromWorker): void {
    const r = this.region;
    r.fuel.set(s.fuel);
    r.heat.set(s.heat);
    r.fireState.set(s.fireState);
    r.structure.set(s.structure);
    r.structHP.set(s.structHP);
    r.population.set(s.population);
    if (s.terrain) {
      r.height.set(s.terrain.height);
      r.water.set(s.terrain.water);
      r.moisture.set(s.terrain.moisture);
    }
    if (s.water) r.water.set(s.water);
    this.applyMeta(s);
    this.fresh = true;
    this.onSnapshot?.();
    for (const t of s.tokens) {
      const done = this.waiters.get(t);
      this.waiters.delete(t);
      done?.();
    }
  }

  private applyMeta(s: Snapshot): void {
    this.elapsed = s.elapsed;
    this.lastFire = s.lastFire;
    this.wind.px.set(s.windPx);
    this.wind.py.set(s.windPy);
    this.damage.deaths = s.deaths;
    this.damage.structuresLost = s.structuresLost;
    if (s.collapsed) this.damage.collapsed = s.collapsed;
    if (s.craters) replace(this.craters, s.craters);
    if (s.tornadoTrack) replace(this.tornadoTrack, s.tornadoTrack);
    replace(this.tornados, s.tornados);
    // Rings are keyed by object identity in the view, so keep one object per wave id.
    const live = new Set<number>();
    this.shockwaves.length = 0;
    for (const w of s.shockwaves) {
      live.add(w.id);
      let obj = this.waveById.get(w.id);
      if (!obj) this.waveById.set(w.id, (obj = { ...w }));
      obj.col = w.col;
      obj.row = w.row;
      obj.radius = w.radius;
      obj.blastRadiusCells = w.blastRadiusCells;
      obj.maxRadius = w.maxRadius;
      this.shockwaves.push(obj);
    }
    for (const id of this.waveById.keys()) if (!live.has(id)) this.waveById.delete(id);
  }
}

function replace<T>(target: T[], next: readonly T[]): void {
  target.length = 0;
  target.push(...next);
}
