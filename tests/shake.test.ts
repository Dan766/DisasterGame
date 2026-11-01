import { describe, expect, it } from 'vitest';
import { CameraShake } from '../src/core/shake';

const v = () => ({ x: 0, y: 0, z: 0 });
const mag = (o: { x: number; y: number; z: number }) =>
  Math.max(Math.abs(o.x), Math.abs(o.y), Math.abs(o.z));

describe('CameraShake', () => {
  it('is still with no trauma', () => {
    expect(mag(new CameraShake().sample(v()))).toBe(0);
  });

  it('a big hit shakes much harder than a small one (quadratic)', () => {
    const peak = (amt: number) => {
      const s = new CameraShake();
      s.add(amt);
      let m = 0;
      for (let i = 0; i < 100; i++) {
        m = Math.max(m, mag(s.sample(v())));
        (s as unknown as { time: number }).time += 0.01;
      }
      return m;
    };
    expect(peak(1)).toBeGreaterThan(peak(0.3) * 5);
  });

  it('a weak hit never cancels a stronger active shake, and stacking is capped at 1', () => {
    const s = new CameraShake();
    s.add(0.8);
    s.add(0.1);
    expect(s.trauma).toBeGreaterThanOrEqual(0.8);
    for (let i = 0; i < 20; i++) s.add(1);
    expect(s.trauma).toBeLessThanOrEqual(1);
  });

  it('decays to zero and is deterministic and bounded', () => {
    const a = new CameraShake();
    const b = new CameraShake();
    a.add(1);
    b.add(1);
    for (let i = 0; i < 30; i++) {
      a.update(0.016);
      b.update(0.016);
      const oa = a.sample(v());
      expect(oa).toEqual(b.sample(v()));
      expect(mag(oa)).toBeLessThanOrEqual(1);
    }
    a.update(5);
    expect(a.trauma).toBe(0);
    expect(mag(a.sample(v()))).toBe(0);
  });
});
