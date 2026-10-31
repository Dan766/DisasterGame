import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/core/clock';

describe('FixedStepClock', () => {
  it('accumulates partial frames into whole steps', () => {
    const clock = new FixedStepClock(100);
    expect(clock.advance(60)).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.6);
    expect(clock.advance(60)).toBe(1);
    expect(clock.alpha).toBeCloseTo(0.2);
  });

  it('runs the right number of steps over many frames', () => {
    const clock = new FixedStepClock(100);
    let steps = 0;
    for (let i = 0; i < 600; i++) steps += clock.advance(1000 / 60);
    // 10 s of frames at 10 Hz; float rounding may leave the last step pending.
    expect(steps).toBeGreaterThanOrEqual(99);
    expect(steps).toBeLessThanOrEqual(100);
  });

  it('applies the speed multiplier', () => {
    const clock = new FixedStepClock(100);
    clock.speed = 10;
    expect(clock.advance(100)).toBe(10);
  });

  it('runs nothing while paused', () => {
    const clock = new FixedStepClock(100);
    clock.paused = true;
    expect(clock.advance(1000)).toBe(0);
    expect(clock.alpha).toBe(0);
  });

  it('caps steps per frame and drops the backlog', () => {
    const clock = new FixedStepClock(10, 5);
    expect(clock.advance(200)).toBe(5);
    expect(clock.alpha).toBeLessThan(1);
    expect(clock.advance(0)).toBe(0);
  });

  it('clamps huge frame gaps', () => {
    const clock = new FixedStepClock(100, 1000, 250);
    expect(clock.advance(60_000)).toBe(2);
  });
});
