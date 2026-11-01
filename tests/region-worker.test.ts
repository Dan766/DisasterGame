import { describe, expect, it } from 'vitest';
import { FireState, REGION_SIZE, createRegionWorld } from '../src/sim/region';
import { REGION_DT, RegionSim } from '../src/sim/RegionSim';
import { RegionSimClient } from '../src/sim/RegionSimClient';
import { RegionSimHost } from '../src/sim/RegionSimHost';
import type { FromWorker, ToWorker, Transport } from '../src/sim/regionProtocol';
import { igniteCell } from '../src/sim/systems/fire';
import { createWind } from '../src/sim/systems/wind';

function forest(seed: number) {
  const r = createRegionWorld('t', seed, 0, 0, 0);
  r.fuel.fill(1);
  r.moisture.fill(0.1);
  igniteCell(r, REGION_SIZE / 2, REGION_SIZE / 2);
  return r;
}

/** Loopback transport: the host runs in-process but every message is structured-cloned. */
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

describe('region sim worker protocol', () => {
  it('mirrors the same fire as a local RegionSim', async () => {
    const local = new RegionSim(forest(3), createWind(270, 5));
    for (let i = 0; i < 120; i++) local.step(REGION_DT);

    const client = new RegionSimClient(forest(3), createWind(270, 5), loopback());
    for (let i = 0; i < 6; i++) {
      client.advance(20);
      await client.flush();
    }

    expect(Array.from(client.region.fireState)).toEqual(Array.from(local.region.fireState));
    expect(client.elapsed).toBeCloseTo(local.elapsed, 6);
    expect(client.lastFire.burning).toBe(local.lastFire.burning);
    expect(client.region.fireState.some((s) => s === FireState.Burning)).toBe(true);
  });

  it('queues ticks behind an in-flight step without losing any', async () => {
    const client = new RegionSimClient(forest(4), createWind(), loopback());
    client.advance(5);
    client.advance(5);
    client.advance(5);
    await client.flush();
    expect(client.elapsed).toBeCloseTo(15 * REGION_DT, 6);
  });

  it('resolves an impact with its crater and terrain change mirrored', async () => {
    const client = new RegionSimClient(forest(5), createWind(), loopback());
    const before = client.region.height[128 * REGION_SIZE + 128]!;
    await client.impact({
      col: 128,
      row: 128,
      craterRadiusCells: 6,
      blastRadiusCells: 20,
      thermalRadiusCells: 12,
    });
    expect(client.craters).toHaveLength(1);
    expect(client.region.height[128 * REGION_SIZE + 128]!).toBeLessThan(before);
    expect(client.shockwaves).toHaveLength(1);
  });

  it('keeps one shockwave object per wave across snapshots', async () => {
    const client = new RegionSimClient(forest(6), createWind(), loopback());
    await client.impact({
      col: 100,
      row: 100,
      craterRadiusCells: 2,
      blastRadiusCells: 30,
      thermalRadiusCells: 5,
    });
    const wave = client.shockwaves[0]!;
    const r0 = wave.radius;
    client.advance(3);
    await client.flush();
    expect(client.shockwaves[0]).toBe(wave);
    expect(wave.radius).toBeGreaterThan(r0);
  });

  it('applies wind changes and spawns tornados in the worker', async () => {
    const client = new RegionSimClient(forest(7), createWind(), loopback());
    client.setWind(90, 12);
    client.spawnTornado({ col: 60, row: 60, ef: 3, headingDeg: 90, speed: 15, lifetimeS: 60 });
    client.advance(10);
    await client.flush();
    expect(client.wind.fromDeg).toBe(90);
    expect(client.tornados).toHaveLength(1);
    expect(client.tornados[0]!.col).toBeGreaterThan(60);
  });
});
