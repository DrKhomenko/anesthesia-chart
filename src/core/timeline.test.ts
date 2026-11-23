import { describe, it, expect } from 'vitest';
import { computeTimeline, fmtDuration, timelineSummary, timelineCompact, span } from './timeline';

const at = (hm: string) => new Date(`2026-11-23T${hm}:00`).toISOString();

describe('timeline', () => {
  it('formats durations', () => {
    expect(fmtDuration(40)).toBe('40 мин');
    expect(fmtDuration(65)).toBe('1 ч 05 мин');
    expect(fmtDuration(-1)).toBe('—');
  });
  it('closed spans', () => {
    const tl = computeTimeline({ anesthesiaStartAt: at('10:00'), anesthesiaEndAt: at('11:05'), surgeryStartAt: at('10:20'), surgeryEndAt: at('11:00') });
    expect(tl.anesthesia?.minutes).toBe(65);
    expect(tl.surgery?.minutes).toBe(40);
    expect(tl.warnings).toEqual([]);
    expect(timelineSummary(tl)).toBe('Анестезия 1 ч 05 мин · Операция 40 мин');
    expect(timelineCompact(tl)).toEqual(['Анест. 1:05', 'Опер. 0:40']);
  });
  it('running span counts to now', () => {
    const s = span(at('10:00'), null, new Date(at('10:30')));
    expect(s).toMatchObject({ minutes: 30, running: true });
    expect(timelineSummary(computeTimeline({ anesthesiaStartAt: at('10:00') }, new Date(at('10:30'))))).toBe('Анестезия 30 мин…');
  });
  it('no start → nothing', () => {
    const tl = computeTimeline({ anesthesiaEndAt: at('11:00') });
    expect(tl.anesthesia).toBeNull();
    expect(tl.warnings).toContain('Не указано начало анестезии');
  });
  it('reversed times are flagged, never negative', () => {
    const tl = computeTimeline({ anesthesiaStartAt: at('11:00'), anesthesiaEndAt: at('10:00') });
    expect(tl.anesthesia?.minutes).toBe(0);
    expect(tl.warnings).toContain('Конец анестезии раньше начала');
  });
});
