/**
 * Owns the global world's evolution: applies player commands, steps shared
 * systems (fires, atmosphere, climate) once per game-day, and reports events
 * and which layers changed so the renderer can re-upload only what's needed.
 */
import type { LatLon } from '../core/geo';
import { createRng, type Rng } from '../core/rng';
import { describeLocation } from './describe';
import { getDisaster } from './disasters/registry';
import type { GlobeEffects, ImpactOutcome, Params } from './disasters/types';
import {
  planTsunami,
  floodImpact,
  sourceAmplitudeM,
  tsunamiReachKm,
  waveFrontKm,
  waveFrontAlpha,
  type Landfall,
} from './systems/tsunami';
import { VALUE_PER_PERSON_USD } from './systems/damage';
import { injectAsh, stepAtmosphere } from './systems/atmosphere';
import { livingPopulation, type GlobalWorld } from './world';

export interface SpawnCommand {
  type: 'spawn';
  disaster: string;
  params: Params;
  target: LatLon;
}
export type GlobeCommand = SpawnCommand;

export interface ImpactEvent extends ImpactOutcome {
  type: 'impact';
  id: number;
  day: number;
  disaster: string;
  lat: number;
  lon: number;
}
/** Summary of a tsunami once its wave has finished reaching coastlines. */
export interface TsunamiEvent {
  type: 'tsunami';
  id: number;
  day: number;
  title: string;
  deaths: number;
  damageUSD: number;
  /** Coastal cells flooded. */
  coastCells: number;
  maxRunupM: number;
}
export type SimEvent = ImpactEvent | TsunamiEvent;

/** A tsunami wave front still travelling across open water, for the globe overlay. */
export interface WaveFront {
  lat: number;
  lon: number;
  radiusKm: number;
  alpha: number;
}

/** A wave that has come ashore on a globe cell; regions inside the cell replay it on first entry. */
export interface LandfallRecord {
  cell: number;
  /** Where the wave came from, for choosing the region edge it enters through. */
  sourceLat: number;
  sourceLon: number;
  runupM: number;
}

interface ActiveTsunami {
  lat: number;
  lon: number;
  reachKm: number;
  startDay: number;
  landfalls: Landfall[];
  next: number;
  title: string;
  deaths: number;
  damageUSD: number;
  maxRunupM: number;
}

/** e-folding time for wildfires on the global grid. */
const FIRE_LIFETIME_DAYS = 8;
/** Smoke lofted per unit of burning area per day (τ·km² per km²). */
const SMOKE_PER_KM2_DAY = 0.002;
/** Below this cooling, crop failure starts to kill. */
const FAMINE_THRESHOLD_C = -2;
/** Daily death rate per °C of cooling beyond the threshold. */
const FAMINE_RATE_PER_C_DAY = 0.00015;

export class GlobeSim {
  /** Layers changed since the renderer last looked. */
  readonly dirty = { terrain: false, effects: false, ash: false };
  /** Every applied command with the day it happened, for replay. */
  readonly log: { day: number; command: GlobeCommand }[] = [];

  private readonly events: SimEvent[] = [];
  private readonly burning = new Set<number>();
  private readonly tsunamis: ActiveTsunami[] = [];
  /** Every landfall so far, in arrival order. */
  readonly landfalls: LandfallRecord[] = [];
  private readonly rng: Rng;
  private nextEventId = 1;
  /** Famine survival factor not yet applied to the per-cell population layer. */
  private pendingFamineKeep = 1;
  private readonly effects: GlobeEffects;

  constructor(readonly world: GlobalWorld) {
    this.rng = createRng(world.seed).fork('globe-sim');
    this.effects = {
      injectAsh: (lat, lon, sigmaKm, mass) => {
        injectAsh(world, lat, lon, sigmaKm, mass);
        this.dirty.ash = true;
      },
      ignite: (cell, intensity) => {
        world.fire[cell] = Math.max(world.fire[cell]!, Math.min(1, intensity));
        this.burning.add(cell);
        this.dirty.effects = true;
      },
      markTerrainChanged: () => {
        this.dirty.terrain = true;
      },
      launchTsunami: (lat, lon, craterRadiusKm) => {
        const landfalls = planTsunami(world, { lat, lon }, craterRadiusKm);
        if (landfalls.length === 0) return;
        this.tsunamis.push({
          lat,
          lon,
          reachKm: tsunamiReachKm(sourceAmplitudeM(craterRadiusKm), craterRadiusKm),
          startDay: world.stats.simDays,
          landfalls,
          next: 0,
          title: `Impact tsunami hit coasts (strike at ${describeLocation(world, { lat, lon })})`,
          deaths: 0,
          damageUSD: 0,
          maxRunupM: 0,
        });
      },
    };
  }

  /** Applies a command immediately (even while paused) and returns the resulting event. */
  submit(command: GlobeCommand): ImpactEvent | null {
    const def = getDisaster(command.disaster);
    if (!def?.spawnGlobe) return null;
    const day = this.world.stats.simDays;
    this.log.push({ day, command });
    this.flushFamine(); // damage must see the current per-cell population
    const outcome = def.spawnGlobe({
      world: this.world,
      target: command.target,
      params: command.params,
      rng: this.rng.fork(this.log.length),
      effects: this.effects,
    });
    this.dirty.effects = true;
    const event: ImpactEvent = {
      ...outcome,
      type: 'impact',
      id: this.nextEventId++,
      day,
      disaster: def.id,
      lat: command.target.lat,
      lon: command.target.lon,
    };
    this.events.push(event);
    return event;
  }

  /** Lights a cell on the globe fire layer (used by region → globe sync for scorched ground). */
  igniteCell(cell: number, intensity: number): void {
    this.effects.ignite(cell, intensity);
  }

  /** Events since the last call. */
  drainEvents(): SimEvent[] {
    return this.events.splice(0);
  }

  /** Advances one tick of `dtDays` game-days. */
  step(dtDays: number): void {
    const { world } = this;
    world.stats.simDays += dtDays;
    this.stepFires(dtDays);
    this.stepTsunamis();
    stepAtmosphere(world, dtDays);
    if (world.ash.some((v) => v > 1e-6)) this.dirty.ash = true;
    this.stepFamine(dtDays);
  }

  /** Wave fronts of tsunamis still under way (empty once they have run their course). */
  waveFronts(): WaveFront[] {
    const fronts: WaveFront[] = [];
    for (const ts of this.tsunamis) {
      const radiusKm = waveFrontKm(this.world.stats.simDays - ts.startDay);
      const alpha = waveFrontAlpha(radiusKm, ts.reachKm);
      if (alpha > 0) fronts.push({ lat: ts.lat, lon: ts.lon, radiusKm, alpha });
    }
    return fronts;
  }

  /** Floods every coastal cell the waves have reached by now; reports each tsunami when it has run its course. */
  private stepTsunamis(): void {
    if (this.tsunamis.length === 0) return;
    const { world } = this;
    const { population, damage, elevation } = world;
    for (let t = this.tsunamis.length - 1; t >= 0; t--) {
      const ts = this.tsunamis[t]!;
      const elapsed = world.stats.simDays - ts.startDay;
      while (ts.next < ts.landfalls.length && ts.landfalls[ts.next]!.arrivalDay <= elapsed) {
        const { cell, runupM } = ts.landfalls[ts.next++]!;
        const flood = floodImpact(runupM, elevation[cell]!);
        const people = population[cell]!;
        const deaths = people * flood.fatality;
        population[cell] = people - deaths;
        const before = damage[cell]!;
        const after = 1 - (1 - before) * (1 - flood.destruction);
        damage[cell] = after;
        ts.deaths += deaths;
        ts.damageUSD += people * VALUE_PER_PERSON_USD * (after - before);
        ts.maxRunupM = Math.max(ts.maxRunupM, runupM);
        this.landfalls.push({ cell, sourceLat: ts.lat, sourceLon: ts.lon, runupM });
        this.dirty.effects = true;
      }
      if (ts.next < ts.landfalls.length) continue;
      world.stats.casualties += ts.deaths;
      world.stats.damageUSD += ts.damageUSD;
      this.events.push({
        type: 'tsunami',
        id: this.nextEventId++,
        day: world.stats.simDays,
        title: ts.title,
        deaths: ts.deaths,
        damageUSD: ts.damageUSD,
        coastCells: ts.landfalls.length,
        maxRunupM: ts.maxRunupM,
      });
      this.tsunamis.splice(t, 1);
    }
  }

  private stepFires(dtDays: number): void {
    if (this.burning.size === 0) return;
    const { world } = this;
    const keep = Math.exp(-dtDays / FIRE_LIFETIME_DAYS);
    const ashCol = world.ashWidth / world.width;
    const ashRow = world.ashHeight / world.height;
    for (const cell of this.burning) {
      const fire = world.fire[cell]!;
      const col = cell % world.width;
      const row = (cell - col) / world.width;
      // Smoke goes into the overlying ash cell.
      const ai = Math.floor(row * ashRow) * world.ashWidth + Math.floor(col * ashCol);
      const smoke = fire * world.rowAreaKm2[row]! * SMOKE_PER_KM2_DAY * dtDays;
      world.ash[ai] += smoke / world.ashRowAreaKm2[Math.floor(row * ashRow)]!;
      const next = fire * keep;
      if (next < 0.02) {
        world.fire[cell] = 0;
        this.burning.delete(cell);
      } else {
        world.fire[cell] = next;
      }
    }
    this.dirty.effects = true;
  }

  /**
   * Famine kills the same fraction everywhere, so deaths are booked exactly from the
   * global total each day while the per-cell multiply is batched (see flushFamine).
   */
  private stepFamine(dtDays: number): void {
    const { world } = this;
    const excess = FAMINE_THRESHOLD_C - world.stats.globalTempAnomaly;
    if (excess <= 0) return;
    const keep = Math.exp(-excess * FAMINE_RATE_PER_C_DAY * dtDays);
    world.stats.casualties += livingPopulation(world) * (1 - keep);
    this.pendingFamineKeep *= keep;
    if (this.pendingFamineKeep < 0.995) this.flushFamine();
  }

  /** Applies batched famine losses to the per-cell population layer (lags ≤ 0.5% otherwise). */
  flushFamine(): void {
    const keep = this.pendingFamineKeep;
    if (keep === 1) return;
    const pop = this.world.population;
    for (let i = 0; i < pop.length; i++) pop[i] *= keep;
    this.pendingFamineKeep = 1;
  }
}
