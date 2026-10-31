import { describe, expect, it } from 'vitest';
import { FireState, REGION_SIZE, Structure, createRegionWorld } from '../src/sim/region';
import { Lethality, createLedger, damageStructure } from '../src/sim/systems/structureDamage';
import { REGION_DT, RegionSim } from '../src/sim/RegionSim';
import { igniteCell } from '../src/sim/systems/fire';

function forest(seed: number) {
  const r = createRegionWorld('t', seed, 0, 0, 0);
  r.fuel.fill(1);
  r.moisture.fill(0.1);
  return r;
}

function burn(seed: number, ticks: number) {
  const r = forest(seed);
  igniteCell(r, REGION_SIZE / 2, REGION_SIZE / 2);
  const sim = new RegionSim(r);
  for (let i = 0; i < ticks; i++) sim.step();
  return { r, sim };
}

describe('RegionSim', () => {
  it('advances game time by dt each tick', () => {
    const { sim } = burn(1, 50);
    expect(sim.elapsed).toBeCloseTo(50 * REGION_DT, 6);
  });

  it('spreads fire over time', () => {
    const { r } = burn(1, 300);
    const touched = r.fireState.reduce((n, s) => n + (s !== FireState.Unburnt ? 1 : 0), 0);
    expect(touched).toBeGreaterThan(20);
  });

  it('is deterministic for the same region seed', () => {
    const a = burn(5, 200).r;
    const b = burn(5, 200).r;
    expect(Array.from(a.fireState)).toEqual(Array.from(b.fireState));
  });
});

describe('RegionSim.ignite', () => {
  it('starts fires in a brush around a cell on burnable ground', () => {
    const r = forest(2);
    const sim = new RegionSim(r);
    const n = sim.ignite(100, 100, 3, 1);
    expect(n).toBeGreaterThan(10);
    expect(r.fireState[100 * REGION_SIZE + 100]).toBe(FireState.Burning);
  });
});

describe('structure damage', () => {
  const house = (pop: number) => {
    const r = createRegionWorld('t', 1, 0, 0, 0);
    const i = 10 * REGION_SIZE + 10;
    r.structure[i] = Structure.House;
    r.structHP[i] = 1;
    r.population[i] = pop;
    return { r, i };
  };

  it('collapses at 0 HP, killing a fraction and conserving people', () => {
    const { r, i } = house(100);
    const ledger = createLedger();
    expect(damageStructure(r, i, 0.4, Lethality.Blast, ledger)).toBe(false);
    expect(ledger.deaths).toBe(0);
    expect(damageStructure(r, i, 0.7, Lethality.Blast, ledger)).toBe(true);
    expect(ledger.structuresLost).toBe(1);
    expect(ledger.collapsed).toEqual([i]);
    expect(ledger.deaths + r.population[i]!).toBeCloseTo(100, 6);
    expect(ledger.deaths).toBeCloseTo(60, 6);
  });

  it('counts a collapse only once and ignores roads', () => {
    const { r, i } = house(50);
    const ledger = createLedger();
    damageStructure(r, i, 2, Lethality.Fire, ledger);
    expect(damageStructure(r, i, 2, Lethality.Fire, ledger)).toBe(false);
    expect(ledger.structuresLost).toBe(1);
    r.structure[i + 1] = Structure.Road;
    r.structHP[i + 1] = 1;
    expect(damageStructure(r, i + 1, 5, Lethality.Blast, ledger)).toBe(false);
  });

  it('fire burns a town down through the ledger without losing people', () => {
    const r = forest(2);
    let total = 0;
    for (let k = 0; k < 40; k++) {
      const i = 128 * REGION_SIZE + 100 + k;
      r.structure[i] = Structure.House;
      r.structHP[i] = 1;
      r.population[i] = 10;
      total += 10;
    }
    const sim = new RegionSim(r);
    sim.ignite(120, 128, 3, 1);
    for (let t = 0; t < 1500; t++) sim.step();
    expect(sim.damage.structuresLost).toBeGreaterThan(0);
    const alive = r.population.reduce((a, b) => a + b, 0);
    expect(alive + sim.damage.deaths).toBeCloseTo(total, 4);
  });
});
