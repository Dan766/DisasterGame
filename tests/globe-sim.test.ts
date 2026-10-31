import { describe, expect, it } from 'vitest';
import { GlobeSim, type SpawnCommand } from '../src/sim/GlobeSim';
import { generateGlobe } from '../src/sim/gen/globe';
import { cellCenter, livingPopulation, totalPopulation, type GlobalWorld } from '../src/sim/world';

const small = { width: 128, height: 64 };

function strike(diameterM: number, target: { lat: number; lon: number }, composition = 'stony') {
  return {
    type: 'spawn',
    disaster: 'asteroid',
    params: { diameterM, velocityKms: 20, angleDeg: 90, composition },
    target,
  } satisfies SpawnCommand;
}

/** The most populous land cell: a guaranteed target with people in it. */
function populatedSpot(world: GlobalWorld) {
  let best = 0;
  for (let i = 0; i < world.population.length; i++) {
    if (world.population[i]! > world.population[best]!) best = i;
  }
  return cellCenter(world, best);
}

function oceanSpot(world: GlobalWorld) {
  const i = world.elevation.findIndex(
    (e, idx) => e < -3000 && Math.abs(cellCenter(world, idx).lat) < 40,
  );
  return cellCenter(world, i);
}

describe('GlobeSim', () => {
  it('a dinosaur-killer causes impact winter and mass casualties', () => {
    const world = generateGlobe('k-pg', small);
    const sim = new GlobeSim(world);
    const event = sim.submit(strike(10000, populatedSpot(world)))!;
    expect(event.type).toBe('impact');
    expect(event.deaths).toBeGreaterThan(1e8);
    expect(event.craterRadiusKm).toBeGreaterThan(70);
    for (let d = 0; d < 60; d++) sim.step(1);
    expect(world.stats.globalTempAnomaly).toBeLessThan(-5);
    expect(world.stats.casualties).toBeGreaterThan(event.deaths); // famine adds more
  });

  it('carves only craters that span several grid cells, and never raises the seafloor', () => {
    const world = generateGlobe('carve');
    const before = world.elevation.slice();
    const sim = new GlobeSim(world);
    sim.submit(strike(10000, populatedSpot(world))); // ~180 km crater: shader-only
    expect(sim.dirty.terrain).toBe(false);
    expect(world.elevation).toEqual(before);

    // Largest possible impactor: ~550 km crater, carved into the grid.
    const giant = {
      ...strike(10000, oceanSpot(world), 'iron'),
      params: { diameterM: 10000, velocityKms: 70, angleDeg: 90, composition: 'iron' },
    };
    const event = sim.submit(giant)!;
    expect(event.craterRadiusKm).toBeGreaterThan(200);
    expect(sim.dirty.terrain).toBe(true);
    let raisedSeafloor = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i]! < 0 && world.elevation[i]! > before[i]!) raisedSeafloor++;
    }
    expect(raisedSeafloor).toBe(0);
  });

  it('a small impact barely moves the climate', () => {
    const world = generateGlobe('small-rock', small);
    const sim = new GlobeSim(world);
    sim.submit(strike(100, populatedSpot(world)));
    for (let d = 0; d < 60; d++) sim.step(1);
    expect(world.stats.globalTempAnomaly).toBeGreaterThan(-0.1);
  });

  it('a sub-cell impact still kills a sensible share of its cell', () => {
    const world = generateGlobe('sub-cell', { width: 512, height: 256 });
    const sim = new GlobeSim(world);
    const target = populatedSpot(world);
    const event = sim.submit(strike(200, target))!;
    // ~200 m stony: blast radius ~20 km, far smaller than a ~78 km cell.
    expect(event.blastRadiusKm).toBeLessThan(40);
    expect(event.deaths).toBeGreaterThan(0);
    expect(event.deaths).toBeLessThan(world.stats.initialPopulation * 0.01);
  });

  it('keeps the population ledger exact', () => {
    const world = generateGlobe('ledger', small);
    const sim = new GlobeSim(world);
    sim.submit(strike(3000, populatedSpot(world)));
    sim.submit(strike(800, oceanSpot(world)));
    for (let d = 0; d < 120; d++) sim.step(1);
    sim.flushFamine();
    const alive = totalPopulation(world);
    expect(alive / livingPopulation(world)).toBeCloseTo(1, 4);
  });

  it('flags ocean impacts and records craters', () => {
    const world = generateGlobe('splash', small);
    const sim = new GlobeSim(world);
    const event = sim.submit(strike(2000, oceanSpot(world)))!;
    expect(event.ocean).toBe(true);
    expect(world.craters).toHaveLength(1);
    expect(world.craters[0]!.ocean).toBe(true);
    expect(sim.drainEvents()).toHaveLength(1);
    expect(sim.drainEvents()).toHaveLength(0);
  });

  it('starts fires that burn out', () => {
    const world = generateGlobe('fires', small);
    const sim = new GlobeSim(world);
    sim.submit(strike(2000, populatedSpot(world)));
    const burningAtStart = world.fire.filter((f) => f > 0).length;
    expect(burningAtStart).toBeGreaterThan(0);
    for (let d = 0; d < 60; d++) sim.step(1);
    expect(world.fire.filter((f) => f > 0).length).toBe(0);
  });

  it('replays deterministically from the command log', () => {
    const run = () => {
      const world = generateGlobe('replay', small);
      const sim = new GlobeSim(world);
      const target = populatedSpot(world);
      sim.submit(strike(1500, target, 'iron'));
      for (let d = 0; d < 10; d++) sim.step(1);
      sim.submit(strike(5000, oceanSpot(world)));
      for (let d = 0; d < 30; d++) sim.step(1);
      return world.stats;
    };
    expect(run()).toEqual(run());
  });
});
