import { describe, expect, it } from 'vitest';
import { TornadoEmitter } from '../src/render/fx/TornadoEmitter';
import type { ParticleSpec } from '../src/render/fx/Particles';
import { Tornado } from '../src/sim/disasters/tornado';
import { tornado as tornadoDef, tornadoSpecFromParams } from '../src/sim/disasters/tornado';
import { defaultParams } from '../src/sim/disasters/types';

function setup() {
  const out: ParticleSpec[] = [];
  let s = 99;
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  return { out, emitter: new TornadoEmitter({ emit: (p) => out.push(p) }, rng) };
}
const flat = () => 0;
const live = (age: number) => {
  const t = new Tornado(
    tornadoSpecFromParams(100, 100, { ...defaultParams(tornadoDef), ef: 4, lifetimeS: 100 }),
  );
  t.age = age;
  return t;
};

describe('TornadoEmitter', () => {
  it('emits nothing without tornados', () => {
    const { emitter, out } = setup();
    expect(emitter.update(0.1, [], flat)).toBe(0);
    expect(out).toHaveLength(0);
  });

  it('emits a funnel that widens with height, plus fast debris and a low dust skirt', () => {
    const { emitter, out } = setup();
    let n = 0;
    for (let k = 0; k < 6; k++) n += emitter.update(0.04, [live(50)], flat);
    expect(n).toBe(out.length);
    const funnel = out.filter((p) => p.alpha! < 0.5 && p.y > 1);
    const low = funnel.filter((p) => p.y < 10);
    const high = funnel.filter((p) => p.y > 20);
    const spread = (ps: ParticleSpec[]) =>
      ps.reduce((a, p) => a + Math.hypot(p.x - 0 - (100 - 128), p.z - (100 - 128)), 0) / ps.length;
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    expect(spread(high)).toBeGreaterThan(spread(low));
    expect(out.some((p) => p.gravity! < -10)).toBe(true); // debris falls
  });

  it('thins out as the tornado ropes out', () => {
    const peak = setup();
    const dying = setup();
    for (let k = 0; k < 10; k++) {
      peak.emitter.update(0.04, [live(50)], flat);
      dying.emitter.update(0.04, [live(95)], flat);
    }
    expect(dying.out.length).toBeLessThan(peak.out.length);
  });
});
