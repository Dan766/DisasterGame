/**
 * Worker side of the region sim: owns the authoritative `RegionSim`, applies commands in
 * order and answers each message with a snapshot of the layers that changed. No DOM, no three.js.
 */
import type { RegionWorld } from './region';
import { REGION_DT, RegionSim } from './RegionSim';
import { createWind } from './systems/wind';
import type { Shockwave } from './systems/impact';
import type { FromWorker, ShockwaveSnap, Snapshot, ToWorker } from './regionProtocol';

export interface HostPort {
  post(msg: FromWorker, transfer?: Transferable[]): void;
}

export class RegionSimHost {
  private sim: RegionSim | null = null;
  private terrainDirty = false;
  private terrainVersion = 0;
  private tokens: number[] = [];
  private sent = { collapsed: 0, craters: 0, track: 0 };
  private readonly waveIds = new WeakMap<Shockwave, number>();
  private nextWaveId = 1;

  constructor(private readonly port: HostPort) {}

  handle(msg: ToWorker): void {
    if (msg.type === 'init') {
      const r = msg.region;
      const region: RegionWorld = { ...r };
      this.sim = new RegionSim(region, createWind(msg.wind.fromDeg, msg.wind.speed));
      this.sent = { collapsed: 0, craters: 0, track: 0 };
      this.terrainDirty = true;
      this.post();
      return;
    }
    const sim = this.sim;
    if (!sim) return;
    switch (msg.type) {
      case 'step':
        for (let i = 0; i < msg.ticks; i++) sim.step(REGION_DT);
        this.tokens.push(msg.token);
        break;
      case 'ignite':
        sim.ignite(msg.col, msg.row, msg.radiusCells, msg.intensity);
        break;
      case 'tornado':
        sim.spawnTornado(msg.spec);
        break;
      case 'tsunami':
        sim.spawnTsunami(msg.edge, msg.amplitudeM, msg.durationS);
        break;
      case 'quake':
        sim.spawnQuake(msg.spec);
        break;
      case 'impact':
        sim.impact(msg.spec);
        this.terrainDirty = true;
        this.tokens.push(msg.token);
        break;
      case 'wind':
        sim.wind.fromDeg = msg.fromDeg;
        sim.wind.speed = msg.speed;
        break;
      case 'flush':
        this.tokens.push(msg.token);
        break;
    }
    this.post();
  }

  private waterWasActive = false;

  private waveId(w: Shockwave): number {
    let id = this.waveIds.get(w);
    if (id === undefined) this.waveIds.set(w, (id = this.nextWaveId++));
    return id;
  }

  private post(): void {
    const sim = this.sim!;
    const r = sim.region;
    const snap: Snapshot = {
      type: 'snapshot',
      tokens: this.tokens,
      fuel: r.fuel.slice(),
      heat: r.heat.slice(),
      fireState: r.fireState.slice(),
      structure: r.structure.slice(),
      structHP: r.structHP.slice(),
      population: r.population.slice(),
      elapsed: sim.elapsed,
      lastFire: { ...sim.lastFire },
      windPx: sim.wind.px.slice(),
      windPy: sim.wind.py.slice(),
      deaths: sim.damage.deaths,
      structuresLost: sim.damage.structuresLost,
      quakesActive: sim.quakes.length,
      tornados: sim.tornados.map((t) => ({
        col: t.col,
        row: t.row,
        radiusCells: t.radiusCells,
        strength: t.strength,
      })),
      shockwaves: sim.shockwaves.map((w): ShockwaveSnap => ({ ...w, id: this.waveId(w) })),
    };
    this.tokens = [];
    const transfer: Transferable[] = [
      snap.fuel.buffer,
      snap.heat.buffer,
      snap.fireState.buffer,
      snap.structure.buffer,
      snap.structHP.buffer,
      snap.population.buffer,
      snap.windPx.buffer,
      snap.windPy.buffer,
    ];
    if (sim.terrainVersion !== this.terrainVersion) {
      this.terrainVersion = sim.terrainVersion;
      this.terrainDirty = true;
    }
    if (this.terrainDirty) {
      this.terrainDirty = false;
      snap.terrain = {
        height: r.height.slice(),
        water: r.water.slice(),
        moisture: r.moisture.slice(),
      };
      transfer.push(
        snap.terrain.height.buffer,
        snap.terrain.water.buffer,
        snap.terrain.moisture.buffer,
      );
    }
    // Flood water moves every tick; ship it while the solver is awake, plus the settled state.
    if ((sim.waterField.active || this.waterWasActive) && !snap.terrain) {
      snap.water = r.water.slice();
      transfer.push(snap.water.buffer);
    }
    this.waterWasActive = sim.waterField.active;
    if (sim.damage.collapsed.length !== this.sent.collapsed) {
      this.sent.collapsed = sim.damage.collapsed.length;
      snap.collapsed = sim.damage.collapsed.slice();
    }
    if (sim.craters.length !== this.sent.craters) {
      this.sent.craters = sim.craters.length;
      snap.craters = sim.craters.map((c) => ({ ...c }));
    }
    if (sim.tornadoTrack.length !== this.sent.track) {
      this.sent.track = sim.tornadoTrack.length;
      snap.tornadoTrack = sim.tornadoTrack.map((c) => ({ ...c }));
    }
    this.port.post(snap, transfer);
  }
}
