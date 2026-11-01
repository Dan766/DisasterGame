import { describe, expect, it } from 'vitest';
import { moveAxes } from '../src/input/KeyMove';

describe('moveAxes', () => {
  it('maps WASD and arrows to forward / right', () => {
    expect(moveAxes(new Set(['KeyW']))).toEqual({ x: 0, y: 1 });
    expect(moveAxes(new Set(['ArrowDown']))).toEqual({ x: 0, y: -1 });
    expect(moveAxes(new Set(['KeyA']))).toEqual({ x: -1, y: 0 });
    expect(moveAxes(new Set(['ArrowRight']))).toEqual({ x: 1, y: 0 });
  });

  it('cancels opposing keys and ignores everything else', () => {
    expect(moveAxes(new Set(['KeyW', 'KeyS', 'KeyM']))).toEqual({ x: 0, y: 0 });
  });

  it('normalizes diagonals so they are not faster', () => {
    const a = moveAxes(new Set(['KeyW', 'KeyD']));
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(1);
  });
});
