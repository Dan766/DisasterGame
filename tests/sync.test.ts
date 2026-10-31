import { describe, expect, it } from 'vitest';
import { generateGlobe } from '../src/sim/gen/globe';
import { generateRegion } from '../src/sim/gen/region';
import { GlobeSim } from '../src/sim/GlobeSim';
import { RegionSim } from '../src/sim/RegionSim';
import { RegionSyncer } from '../src/sim/sync';
import { totalPopulation } from '../src/sim/world';

const city = (w: ReturnType<typeof generateGlobe>) =>
  [...w.cities].sort((a, b) => b.population - a.population)[0]!;

function setup() {
  const world = generateGlobe('sync-seed');
  const c = city(world);
  const region = generateRegion(world, c.lat, c.lon);
  return { world, region, sim: new RegionSim(region), globe: new GlobeSim(world) };
}

function blast(sim: RegionSim, region: { size: number }) {
  const mid = Math.floor(region.size / 2);
  sim.impact({
    col: mid,
    row: mid,
    craterRadiusCells: 4,
    blastRadiusCells: 14,
    thermalRadiusCells: 10,
  });
  for (let i = 0; i < 300; i++) sim.step();
}

describe('region → globe sync', () => {
  it('conserves population: regional deaths equal globe casualties and cell losses', () => {
    const { world, region, sim, globe } = setup();
    const syncer = new RegionSyncer(region, world);
    const popBefore = totalPopulation(world);
    blast(sim, region);
    const r = syncer.sync(globe);
    expect(r.deaths).toBeGreaterThan(0);
    expect(r.deaths).toBeCloseTo(sim.damage.deaths, 3);
    expect(world.stats.casualties).toBeCloseTo(r.deaths, 3);
    expect(popBefore - totalPopulation(world)).toBeCloseTo(r.deaths, 1);
  });

  it('is incremental: syncing twice without changes adds nothing', () => {
    const { world, region, sim, globe } = setup();
    const syncer = new RegionSyncer(region, world);
    blast(sim, region);
    syncer.sync(globe);
    const casualties = world.stats.casualties;
    const usd = world.stats.damageUSD;
    const again = syncer.sync(globe);
    expect(again).toMatchObject({ deaths: 0, structuresLost: 0, burntCells: 0 });
    expect(world.stats.casualties).toBe(casualties);
    expect(world.stats.damageUSD).toBe(usd);
  });

  it('periodic plus final sync equals a single sync', () => {
    const a = setup();
    const b = setup();
    const sa = new RegionSyncer(a.region, a.world);
    const sb = new RegionSyncer(b.region, b.world);
    const mid = Math.floor(a.region.size / 2);
    const spec = {
      col: mid,
      row: mid,
      craterRadiusCells: 4,
      blastRadiusCells: 14,
      thermalRadiusCells: 10,
    };
    a.sim.impact(spec);
    b.sim.impact(spec);
    for (let i = 0; i < 300; i++) {
      a.sim.step();
      b.sim.step();
      if (i % 50 === 0) sa.sync(a.globe);
    }
    sa.sync(a.globe);
    sb.sync(b.globe);
    expect(a.world.stats.casualties).toBeCloseTo(b.world.stats.casualties, 3);
    expect(a.world.stats.damageUSD).toBeCloseTo(b.world.stats.damageUSD, 0);
  });

  it('marks damaged and scorched globe cells and books losses', () => {
    const { world, region, sim, globe } = setup();
    const syncer = new RegionSyncer(region, world);
    blast(sim, region);
    const r = syncer.sync(globe);
    expect(r.structuresLost).toBeGreaterThan(0);
    expect(r.burntCells).toBeGreaterThan(0);
    expect(world.stats.damageUSD).toBeGreaterThan(0);
    expect(world.damage.some((v) => v > 0)).toBe(true);
    expect(world.fire.some((v) => v > 0)).toBe(true);
  });
});
