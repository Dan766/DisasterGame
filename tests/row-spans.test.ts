import { describe, expect, it } from 'vitest';
import { RowSpans } from '../src/render/region/rowSpans';

describe('RowSpans', () => {
  it('starts empty', () => {
    const s = new RowSpans(8, 4);
    expect(s.isEmpty).toBe(true);
    expect(s.spans()).toEqual([]);
  });

  it('keeps one min..max span per touched row, never straddling rows', () => {
    const s = new RowSpans(8, 4);
    s.mark(1, 5);
    s.mark(1, 2);
    s.mark(1, 6);
    s.mark(3, 0);
    expect(s.isEmpty).toBe(false);
    expect(s.spans()).toEqual([
      [8 + 2, 5],
      [24, 1],
    ]);
  });

  it('reset clears everything', () => {
    const s = new RowSpans(4, 4);
    s.mark(2, 2);
    s.reset();
    expect(s.spans()).toEqual([]);
  });
});
