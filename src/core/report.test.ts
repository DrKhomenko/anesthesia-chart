import { describe, it, expect } from 'vitest';
import { drugTotals, buildSeries, niceRange } from './report';

describe('report', () => {
  it('sums per drug, hides total if any row lacks calc', () => {
    const t = drugTotals([
      { drugNameSnapshot: 'A', totalMg: 1.5, volumeMl: 0.15, givenAt: '1' },
      { drugNameSnapshot: 'A', totalMg: 1, volumeMl: 0.1, givenAt: '2' },
      { drugNameSnapshot: 'B', totalMg: 2, volumeMl: null, givenAt: '3' },
      { drugNameSnapshot: 'C', totalMg: 9, volumeMl: 9, givenAt: '3', deletedAt: 'x' },
    ]);
    expect(t).toEqual([
      { name: 'A', count: 2, totalMg: 2.5, totalMl: 0.25 },
      { name: 'B', count: 1, totalMg: 2, totalMl: null },
    ]);
  });
  it('builds series only for present values, sorted by time', () => {
    const s = buildSeries([
      { at: '2026-11-23T10:05:00Z', hr: 90, t2: 37.5 },
      { at: '2026-11-23T10:00:00Z', hr: 100, spo2: 98 },
    ]);
    expect(s.map(x => x.key)).toEqual(['hr', 'spo2', 'temp']);
    expect(s[0].points.map(p => p.v)).toEqual([100, 90]);
  });
  it('nice range', () => {
    expect(niceRange([37.2, 38.1], 0.5)).toEqual([37, 38.5]);
    expect(niceRange([60, 140], 20, true)).toEqual([0, 140]);
    expect(niceRange([], 10)).toEqual([0, 10]);
  });
});
