import { describe, expect, it } from 'vitest';
import { Particles, PARTICLE_BUDGET } from '../src/render/fx/Particles';

const spec = { x: 0, y: 0, z: 0, vx: 0, vy: 1, vz: 0, life: 2, size: 1, color: 0xffffff };

describe('Particles', () => {
  it('has a 20k default budget', () => {
    const p = new Particles();
    expect(p.capacity).toBe(PARTICLE_BUDGET);
    expect(PARTICLE_BUDGET).toBe(20_000);
  });

  it('counts live particles and expires them by life', () => {
    const p = new Particles(100);
    for (let i = 0; i < 10; i++) p.emit(spec);
    p.update(0.5);
    expect(p.liveCount).toBe(10);
    p.update(2);
    expect(p.liveCount).toBe(0);
  });

  it('never exceeds capacity: the oldest slots are recycled', () => {
    const p = new Particles(50);
    for (let i = 0; i < 120; i++) p.emit(spec);
    p.update(0.1);
    expect(p.liveCount).toBe(50);
    expect(p.totalEmitted).toBe(120);
  });

  it('clear kills everything', () => {
    const p = new Particles(20);
    for (let i = 0; i < 20; i++) p.emit(spec);
    p.update(0.1);
    p.clear();
    expect(p.liveCount).toBe(0);
  });
});
