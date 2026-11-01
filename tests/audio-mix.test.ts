import { describe, expect, it } from 'vitest';
import {
  boomDelaySeconds,
  boomGain,
  crackleLevel,
  quakeRumbleLevel,
  quakeShakeTrauma,
  windRoarLevel,
} from '../src/audio/mix';

describe('audio mix', () => {
  it('delays boom by distance / speed of sound, capped', () => {
    expect(boomDelaySeconds(0)).toBe(0);
    expect(boomDelaySeconds(343)).toBeCloseTo(1, 5);
    expect(boomDelaySeconds(1e9)).toBe(4);
  });
  it('boom is louder for bigger and closer impacts, within 0..1', () => {
    expect(boomGain(1000)).toBeGreaterThan(boomGain(1));
    expect(boomGain(10, 0)).toBeGreaterThan(boomGain(10, 8000));
    expect(boomGain(1e6)).toBeLessThanOrEqual(1);
  });
  it('crackle scales with burning cells and saturates', () => {
    expect(crackleLevel(0)).toBe(0);
    expect(crackleLevel(100)).toBeGreaterThan(crackleLevel(10));
    expect(crackleLevel(1e6)).toBe(1);
  });
  it('wind roar follows the largest tornado', () => {
    expect(windRoarLevel([])).toBe(0);
    expect(windRoarLevel([1.5, 7])).toBe(1);
    expect(windRoarLevel([3.5])).toBeCloseTo(0.5, 5);
  });
  it('quake rumble and sustained shake scale with active quakes and saturate', () => {
    expect(quakeRumbleLevel(0)).toBe(0);
    expect(quakeRumbleLevel(2)).toBeGreaterThan(quakeRumbleLevel(1));
    expect(quakeRumbleLevel(50)).toBe(1);
    expect(quakeShakeTrauma(0)).toBe(0);
    expect(quakeShakeTrauma(50)).toBeLessThanOrEqual(0.5);
  });
});
