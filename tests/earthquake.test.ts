import { describe, expect, it } from 'vitest';
import { REGION_SIZE, Structure, createRegionWorld } from '../src/sim/region';
import { REGION_DT, RegionSim } from '../src/sim/RegionSim';
import { RegionSimClient } from '../src/sim/RegionSimClient';
import { RegionSimHost } from '../src/sim/RegionSimHost';
import type { FromWorker, ToWorker, Transport } from '../src/sim/regionProtocol';
import { Quake, quakeIntensity, quakeReachCells } from '../src/sim/systems/earthquake';
import { createWind } from '../src/sim/systems/wind';

const S = REGION_SIZE;

/** Flat town with a steep ridge in the east. */
function town() {
  const r = createRegionWorld('q', 7, 0, 0, 0);
  for (let row = 0; row < S; row++)
    for (let col = 0; col < S; col++) {
      const i = row * S + col;
      r.height[i] = col > 150 ? (col - 150) * 60 : 10; // 60 m per 100 m cell: slope 0.6
      if (col > 100 && col < 140 && row > 100 && row < 140) {
        r.structure[i] = Structure.House;
        r.structHP[i] = 1;
        r.population[i] = 10;
      }
    }
  return r;
}

function loopback(): Transport {
  let cb: (m: FromWorker) => void = () => {};
  const host = new RegionSimHost({
    post: (msg, transfer) => queueMicrotask(() => cb(structuredClone(msg, { transfer }))),
  });
  return {
    post: (msg: ToWorker, transfer: Transferable[] = []) =>
      queueMicrotask(() => host.handle(structuredClone(msg, { transfer }))),
    onMessage: (c) => (cb = c),
    terminate: () => {},
  };
}

describe('earthquake', () => {
  it('scales reach and intensity with magnitude and distance', () => {
    expect(quakeReachCells(8)).toBeGreaterThan(quakeReachCells(6));
    expect(quakeIntensity(8, 0)).toBeGreaterThan(quakeIntensity(8, 50));
    expect(quakeIntensity(8, 0)).toBeGreaterThan(quakeIntensity(5, 0));
    expect(quakeIntensity(6, quakeReachCells(6) + 1)).toBe(0);
  });

  it('has a rise / plateau / decay envelope and ends', () => {
    const q = new Quake({ col: 0, row: 0, magnitude: 7 });
    const seen: number[] = [];
    for (let t = 0; t < q.durationS; t += 0.5) {
      seen.push(q.envelope);
      q.elapsed = t + 0.5;
    }
    expect(Math.max(...seen)).toBe(1);
    expect(seen[0]).toBeLessThan(1);
    expect(q.alive).toBe(false);
  });

  it('collapses buildings near the epicentre and kills some residents', () => {
    const sim = new RegionSim(town());
    const pop0 = sim.region.population.reduce((a, b) => a + b, 0);
    sim.spawnQuake({ col: 120, row: 120, magnitude: 8 });
    for (let t = 0; t < 400; t++) sim.step(REGION_DT);
    expect(sim.quakes).toHaveLength(0);
    expect(sim.damage.structuresLost).toBeGreaterThan(100);
    expect(sim.damage.deaths).toBeGreaterThan(0);
    const pop1 = sim.region.population.reduce((a, b) => a + b, 0);
    expect(pop1 + sim.damage.deaths).toBeCloseTo(pop0, 3);
  });

  it('does little to a distant town from a small quake', () => {
    const sim = new RegionSim(town());
    sim.spawnQuake({ col: 10, row: 10, magnitude: 5 });
    for (let t = 0; t < 200; t++) sim.step(REGION_DT);
    expect(sim.damage.structuresLost).toBe(0);
  });

  it('triggers landslides on steep slopes and bumps the terrain version', () => {
    const sim = new RegionSim(town());
    const v0 = sim.terrainVersion;
    sim.spawnQuake({ col: 180, row: 128, magnitude: 8 });
    for (let t = 0; t < 400; t++) sim.step(REGION_DT);
    expect(sim.landslides).toBeGreaterThan(0);
    expect(sim.terrainVersion).toBeGreaterThan(v0);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const sim = new RegionSim(town());
      sim.spawnQuake({ col: 160, row: 128, magnitude: 7.5 });
      for (let t = 0; t < 300; t++) sim.step(REGION_DT);
      return [Array.from(sim.region.height), sim.damage.structuresLost, sim.landslides];
    };
    expect(run()).toEqual(run());
  });

  it('matches a local sim through the worker protocol, terrain included', async () => {
    const local = new RegionSim(town(), createWind());
    local.spawnQuake({ col: 170, row: 128, magnitude: 8 });
    for (let t = 0; t < 120; t++) local.step(REGION_DT);

    const client = new RegionSimClient(town(), createWind(), loopback());
    client.spawnQuake({ col: 170, row: 128, magnitude: 8 });
    for (let i = 0; i < 6; i++) {
      client.advance(20);
      await client.flush();
    }
    expect(Array.from(client.region.height)).toEqual(Array.from(local.region.height));
    expect(client.quakesActive).toBe(local.quakes.length);
  });
});
