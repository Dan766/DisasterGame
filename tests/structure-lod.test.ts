import { BoxGeometry, Matrix4, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { StructureLodSet, selectLod } from '../src/render/region/structureLod';

describe('selectLod', () => {
  it('is detailed near and simple far', () => {
    expect(selectLod(10 * 10, 0, 90)).toBe(0);
    expect(selectLod(200 * 200, 0, 90)).toBe(1);
  });
  it('has hysteresis at the border', () => {
    expect(selectLod(92 * 92, 0, 90)).toBe(0);
    expect(selectLod(88 * 88, 1, 90)).toBe(1);
    expect(selectLod(70 * 70, 1, 90)).toBe(0);
  });
});

describe('StructureLodSet', () => {
  const make = () => {
    const set = new StructureLodSet(
      [0, 1],
      new BoxGeometry(),
      new BoxGeometry(),
      new MeshBasicMaterial(),
      50,
    );
    set.setMatrix(0, new Matrix4().makeTranslation(0, 0, 0));
    set.setMatrix(1, new Matrix4().makeTranslation(200, 0, 0));
    return set;
  };
  const shown = (set: StructureLodSet, k: number) => {
    const m = new Matrix4();
    set.near.getMatrixAt(k, m);
    const n = m.elements[0] !== 0;
    set.far.getMatrixAt(k, m);
    return { near: n, far: m.elements[0] !== 0 };
  };

  it('shows each instance in exactly one mesh', () => {
    const set = make();
    set.updateLod(0, 0, 0);
    expect(shown(set, 0)).toEqual({ near: true, far: false });
    expect(shown(set, 1)).toEqual({ near: false, far: true });
  });

  it('switches when the camera moves and is stable otherwise', () => {
    const set = make();
    set.updateLod(0, 0, 0);
    expect(set.updateLod(0, 0, 0)).toBe(0);
    expect(set.updateLod(200, 0, 0)).toBe(2);
    expect(shown(set, 0)).toEqual({ near: false, far: true });
    expect(shown(set, 1)).toEqual({ near: true, far: false });
  });

  it('keeps removed instances hidden in both meshes', () => {
    const set = make();
    set.setMatrix(0, new Matrix4().makeScale(0, 0, 0));
    set.updateLod(200, 0, 0);
    expect(shown(set, 0)).toEqual({ near: false, far: false });
  });
});
