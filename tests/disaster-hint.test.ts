import { describe, expect, it } from 'vitest';
import { getDisaster } from '../src/sim/disasters/registry';
import { disasterHint } from '../src/ui/DisasterPanel';

describe('disasterHint', () => {
  it('tells the player region-only disasters need a zoom-in from the globe', () => {
    expect(disasterHint(getDisaster('tornado')!, 'globe')).toMatch(/zoom in/);
    expect(disasterHint(getDisaster('wildfire')!, 'globe')).toMatch(/zoom in/);
  });

  it('uses the launch hint for globe-capable disasters', () => {
    expect(disasterHint(getDisaster('asteroid')!, 'globe')).toMatch(/Click the planet/);
  });

  it('points at the ground inside the region', () => {
    for (const id of ['asteroid', 'tornado', 'wildfire']) {
      expect(disasterHint(getDisaster(id)!, 'region')).toMatch(/Click the ground/);
    }
  });
});
