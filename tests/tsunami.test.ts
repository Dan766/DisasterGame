import { describe, expect, it } from 'vitest';
import { GlobeSim } from '../src/sim/GlobeSim';
import { generateGlobe } from '../src/sim/gen/globe';
import {
  floodImpact,
  planTsunami,
  sourceAmplitudeM,
  TSUNAMI_KM_PER_DAY,
  tsunamiReachKm,
  waveFrontAlpha,
  waveFrontKm,
  waveHeightM,
} from '../src/sim/systems/tsunami';
import { cellCenter, createGlobalWorld, livingPopulation } from '../src/sim/world';

const small = { width: 128, height: 64 };

function oceanSpot(world: ReturnType<typeof generateGlobe>) {
  const i = world.elevation.findIndex(
    (e, idx) => e < -3000 && Math.abs(cellCenter(world, idx).lat) < 40,
  );
  return cellCenter(world, i);
}

describe('tsunami scaling', () => {
  it('bigger craters make bigger, longer-reaching waves that decay with distance', () => {
    expect(sourceAmplitudeM(10)).toBeGreaterThan(sourceAmplitudeM(1));
    const a = sourceAmplitudeM(5);
    expect(waveHeightM(a, 5, 100)).toBeGreaterThan(waveHeightM(a, 5, 1000));
    expect(tsunamiReachKm(sourceAmplitudeM(10), 10)).toBeGreaterThan(tsunamiReachKm(a, 1));
  });

  it('floods low ground harder than high ground', () => {
    const low = floodImpact(10, 1);
    const high = floodImpact(10, 8);
    expect(low.fatality).toBeGreaterThan(high.fatality);
    expect(floodImpact(10, 50)).toEqual({ fatality: 0, destruction: 0 });
  });
});

describe('planTsunami', () => {
  it('lists landfalls in arrival order, nearest coasts first', () => {
    const world = generateGlobe('wave', small);
    const falls = planTsunami(world, oceanSpot(world), 40);
    expect(falls.length).toBeGreaterThan(0);
    for (let i = 1; i < falls.length; i++) {
      expect(falls[i]!.arrivalDay).toBeGreaterThanOrEqual(falls[i - 1]!.arrivalDay);
    }
    for (const f of falls) expect(world.elevation[f.cell]!).toBeGreaterThanOrEqual(0);
  });

  it('does nothing for land strikes and tiny splashes', () => {
    const world = generateGlobe('wave', small);
    const land = world.elevation.findIndex((e) => e > 100);
    expect(planTsunami(world, cellCenter(world, land), 40)).toEqual([]);
    expect(planTsunami(world, oceanSpot(world), 0.05)).toEqual([]);
  });

  it('cannot cross land: a closed basin only floods its own shores', () => {
    const world = createGlobalWorld('basin', 64, 32);
    world.elevation.fill(100); // all land…
    for (let r = 12; r < 20; r++) for (let c = 10; c < 18; c++) world.elevation[r * 64 + c] = -500;
    const falls = planTsunami(world, { lat: 0, lon: -98 }, 30);
    expect(falls.length).toBeGreaterThan(0);
    for (const f of falls) {
      const col = f.cell % 64;
      const row = (f.cell - col) / 64;
      expect(col).toBeGreaterThanOrEqual(9);
      expect(col).toBeLessThanOrEqual(18);
      expect(row).toBeGreaterThanOrEqual(11);
      expect(row).toBeLessThanOrEqual(20);
    }
  });
});

describe('GlobeSim tsunami', () => {
  it('an ocean strike floods coasts over the following days and books the toll', () => {
    const world = generateGlobe('wave-sim', small);
    const sim = new GlobeSim(world);
    const impact = sim.submit({
      type: 'spawn',
      disaster: 'asteroid',
      params: { diameterM: 3000, velocityKms: 20, angleDeg: 90, composition: 'iron' },
      target: oceanSpot(world),
    })!;
    expect(impact.ocean).toBe(true);
    const deathsAtImpact = world.stats.casualties;
    for (let d = 0; d < 30; d++) sim.step(1);
    const events = sim.drainEvents().filter((e) => e.type === 'tsunami');
    expect(events).toHaveLength(1);
    const tsunami = events[0]!;
    if (tsunami.type !== 'tsunami') throw new Error('unreachable');
    expect(tsunami.deaths).toBeGreaterThan(0);
    expect(world.stats.casualties - deathsAtImpact).toBeGreaterThanOrEqual(tsunami.deaths * 0.99);
    expect(livingPopulation(world)).toBeLessThan(world.stats.initialPopulation);
  });

  it('land strikes raise no tsunami', () => {
    const world = generateGlobe('wave-land', small);
    const sim = new GlobeSim(world);
    const land = world.elevation.findIndex((e) => e > 100);
    sim.submit({
      type: 'spawn',
      disaster: 'asteroid',
      params: { diameterM: 3000, velocityKms: 20, angleDeg: 90, composition: 'iron' },
      target: cellCenter(world, land),
    });
    for (let d = 0; d < 10; d++) sim.step(1);
    expect(sim.drainEvents().some((e) => e.type === 'tsunami')).toBe(false);
  });
});

describe('tsunami wave front', () => {
  it('travels at wave speed and fades out at its reach', () => {
    expect(waveFrontKm(2)).toBeCloseTo(2 * TSUNAMI_KM_PER_DAY);
    expect(waveFrontKm(-1)).toBe(0);
    expect(waveFrontAlpha(0, 5000)).toBe(1);
    expect(waveFrontAlpha(4900, 5000)).toBeLessThan(0.1);
    expect(waveFrontAlpha(5000, 5000)).toBe(0);
  });

  it('GlobeSim reports a front while the wave is under way, then none', () => {
    const world = generateGlobe('wave-front', small);
    const sim = new GlobeSim(world);
    expect(sim.waveFronts()).toEqual([]);
    sim.submit({
      type: 'spawn',
      disaster: 'asteroid',
      params: { diameterM: 3000, velocityKms: 20, angleDeg: 90, composition: 'iron' },
      target: oceanSpot(world),
    });
    sim.step(0.5);
    const [front] = sim.waveFronts();
    expect(front).toBeDefined();
    expect(front!.radiusKm).toBeCloseTo(0.5 * TSUNAMI_KM_PER_DAY);
    expect(front!.alpha).toBeGreaterThan(0);
    for (let d = 0; d < 60; d++) sim.step(1);
    expect(sim.waveFronts()).toEqual([]);
  });
});
