import { describe, expect, it } from 'vitest';
import { SlowMo } from '../src/core/slowmo';

describe('SlowMo', () => {
  it('is 1x until triggered', () => {
    expect(new SlowMo().update(0.1)).toBe(1);
  });
  it('drops to a floor, holds, then recovers monotonically to exactly 1', () => {
    const s = new SlowMo();
    s.trigger(1);
    expect(s.scale).toBeCloseTo(0.15);
    let prev = s.update(0.05);
    expect(prev).toBeCloseTo(0.15); // still holding
    for (let i = 0; i < 400; i++) {
      const v = s.update(0.01);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(prev).toBe(1);
  });
  it('stronger hits go slower; a weak hit does not override a strong one', () => {
    const a = new SlowMo();
    a.trigger(0.2);
    const b = new SlowMo();
    b.trigger(0.9);
    expect(b.scale).toBeLessThan(a.scale);
    b.trigger(0.1);
    expect(b.scale).toBeLessThan(0.3);
  });
  it('reset restores real time', () => {
    const s = new SlowMo();
    s.trigger(1);
    s.reset();
    expect(s.update(0.01)).toBe(1);
  });
});
