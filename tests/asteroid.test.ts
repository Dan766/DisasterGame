import { describe, expect, it } from 'vitest';
import {
  asteroid,
  asteroidEffects,
  formatMegatons,
  type AsteroidParams,
} from '../src/sim/disasters/asteroid';
import { defaultParams } from '../src/sim/disasters/types';

const base: AsteroidParams = {
  diameterM: 1000,
  velocityKms: 20,
  angleDeg: 45,
  composition: 'stony',
};

describe('asteroidEffects', () => {
  it('computes kinetic energy (1 km stony at 20 km/s ≈ 75,000 Mt)', () => {
    const fx = asteroidEffects({ ...base, angleDeg: 90 });
    expect(fx.megatons).toBeGreaterThan(74_000);
    expect(fx.megatons).toBeLessThan(76_000);
  });

  it('reproduces the calibration craters', () => {
    // Meteor Crater: ~50 m iron at 12.8 km/s → ~1.2 km crater.
    const meteor = asteroidEffects({
      diameterM: 50,
      velocityKms: 12.8,
      angleDeg: 90,
      composition: 'iron',
    });
    expect(meteor.airburst).toBe(false);
    expect(meteor.craterRadiusKm * 2).toBeGreaterThan(0.9);
    expect(meteor.craterRadiusKm * 2).toBeLessThan(1.6);
    // Chicxulub: ~10 km stony at 20 km/s → ~150–200 km crater.
    const chicxulub = asteroidEffects({ ...base, diameterM: 10000, angleDeg: 90 });
    expect(chicxulub.craterRadiusKm * 2).toBeGreaterThan(150);
    expect(chicxulub.craterRadiusKm * 2).toBeLessThan(210);
  });

  it('grows monotonically with size and speed', () => {
    const keys = [
      'megatons',
      'craterRadiusKm',
      'blastRadiusKm',
      'thermalRadiusKm',
      'ashMass',
    ] as const;
    let prev = asteroidEffects({ ...base, diameterM: 100 });
    for (const d of [200, 500, 1000, 3000, 10000]) {
      const fx = asteroidEffects({ ...base, diameterM: d });
      for (const k of keys) expect(fx[k]).toBeGreaterThanOrEqual(prev[k]);
      prev = fx;
    }
    prev = asteroidEffects({ ...base, velocityKms: 11 });
    for (const v of [20, 35, 50, 70]) {
      const fx = asteroidEffects({ ...base, velocityKms: v });
      for (const k of keys) expect(fx[k]).toBeGreaterThanOrEqual(prev[k]);
      prev = fx;
    }
  });

  it('shallow entries dig smaller craters', () => {
    const steep = asteroidEffects({ ...base, angleDeg: 90 });
    const shallow = asteroidEffects({ ...base, angleDeg: 15 });
    expect(shallow.craterRadiusKm).toBeLessThan(steep.craterRadiusKm);
    expect(shallow.megatons).toBe(steep.megatons);
  });

  it('small weak bodies airburst; small iron ones still crater', () => {
    const stony = asteroidEffects({ ...base, diameterM: 20 });
    expect(stony.airburst).toBe(true);
    expect(stony.craterRadiusKm).toBe(0);
    expect(stony.blastRadiusKm).toBeGreaterThan(0);
    expect(asteroidEffects({ ...base, diameterM: 20, composition: 'iron' }).airburst).toBe(false);
  });

  it('Tunguska-like airburst flattens tens of km', () => {
    const fx = asteroidEffects({
      diameterM: 50,
      velocityKms: 15,
      angleDeg: 45,
      composition: 'stony',
    });
    expect(fx.airburst).toBe(true);
    expect(fx.blastRadiusKm).toBeGreaterThan(10);
    expect(fx.blastRadiusKm).toBeLessThan(40);
  });
});

describe('asteroid definition', () => {
  it('previews rings matching its effects', () => {
    const preview = asteroid.preview(defaultParams(asteroid));
    expect(preview.rings.map((r) => r.kind).sort()).toEqual(['blast', 'crater', 'thermal']);
    expect(preview.facts.length).toBeGreaterThan(2);
  });

  it('formats energy readably', () => {
    expect(formatMegatons(0.5)).toBe('500 kt');
    expect(formatMegatons(12)).toBe('12 Mt');
    expect(formatMegatons(75_000)).toBe('75,000 Mt');
    expect(formatMegatons(7.5e7)).toBe('75.0 million Mt');
  });
});
