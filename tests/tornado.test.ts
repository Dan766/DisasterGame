import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Tornado, type TornadoSpec } from '../src/sim/disasters/tornado';
import { REGION_SIZE, Structure, createRegionWorld, type RegionWorld } from '../src/sim/region';
import { RegionSim } from '../src/sim/RegionSim';
import { igniteCell, stepFire } from '../src/sim/systems/fire';
import { createLedger } from '../src/sim/systems/structureDamage';
import { createWind, stepWind } from '../src/sim/systems/wind';

const mid = REGION_SIZE / 2;

function town(): RegionWorld {
  const r = createRegionWorld('test', 1, 0, 0, 0);
  r.fuel.fill(1);
  r.moisture.fill(0.1);
  for (let row = mid - 10; row <= mid + 10; row++) {
    for (let col = mid - 30; col <= mid + 30; col++) {
      const i = row * r.size + col;
      r.structure[i] = Structure.House;
      r.structHP[i] = 1;
      r.population[i] = 4;
    }
  }
  return r;
}

const spec = (over: Partial<TornadoSpec> = {}): TornadoSpec => ({
  col: mid - 25,
  row: mid,
  ef: 4,
  headingDeg: 90,
  speed: 15,
  lifetimeS: 60,
  ...over,
});

const totalPop = (r: RegionWorld) => r.population.reduce((a, b) => a + b, 0);

describe('tornado', () => {
  it('destroys structures along its track and conserves population', () => {
    const r = town();
    const before = totalPop(r);
    const sim = new RegionSim(r);
    sim.spawnTornado(spec());
    for (let k = 0; k < 600; k++) sim.step();
    expect(sim.tornados.length).toBe(0);
    expect(sim.damage.structuresLost).toBeGreaterThan(10);
    expect(sim.damage.deaths).toBeGreaterThan(0);
    expect(totalPop(r) + sim.damage.deaths).toBeCloseTo(before, 1);
    // Damage is along the track: cells far off to the side are untouched.
    expect(r.structHP[(mid + 10) * r.size + mid - 20]).toBe(1);
  });

  it('a weak tornado does far less damage than a strong one', () => {
    const lost = (ef: 0 | 4) => {
      const sim = new RegionSim(town());
      sim.spawnTornado(spec({ ef }));
      for (let k = 0; k < 600; k++) sim.step();
      return sim.damage.structuresLost;
    };
    expect(lost(0)).toBeLessThan(lost(4) / 2);
  });

  it('strips fuel under its core', () => {
    const r = town();
    const t = new Tornado(spec());
    const wind = createWind();
    const rng = createRng(1);
    const ledger = createLedger();
    for (let k = 0; k < 300; k++) t.step(r, wind, rng, 0.1, ledger);
    const fuelAt = r.fuel[mid * r.size + mid - 20]!;
    expect(fuelAt).toBeLessThan(0.1);
    expect(r.fuel[(mid + 40) * r.size + mid]).toBe(1);
  });

  it('wind perturbation measurably shifts fire spread', () => {
    const burntNorth = (withTornado: boolean) => {
      const r = createRegionWorld('test', 1, 0, 0, 0);
      r.fuel.fill(1);
      r.moisture.fill(0.1);
      const wind = createWind(270, 2); // gentle westerly
      const rng = createRng(3);
      igniteCell(r, mid, mid);
      // Tornado passing just west of the fire, with an empty (structure-free) region.
      const t = new Tornado(spec({ col: mid - 6, row: mid + 8, ef: 3, headingDeg: 0, speed: 8 }));
      const tr = createRng(9);
      const ledger = createLedger();
      for (let k = 0; k < 400; k++) {
        if (withTornado) t.step(createRegionWorld('x', 1, 0, 0, 0), wind, tr, 0.1, ledger);
        stepWind(wind, 0.1);
        stepFire(r, wind, rng, 0.1);
      }
      let n = 0;
      for (let row = 0; row < r.size; row++)
        for (let col = 0; col < r.size; col++)
          if (r.fireState[row * r.size + col] !== 0 && row < mid) n++;
      return n;
    };
    expect(burntNorth(true)).not.toBe(burntNorth(false));
  });
});
