import { describe, it, expect } from 'vitest';
import {
  currentRateLabel, formatVolumeMl, infusionChangesText, infusionRateUnitsOf,
  infusionVolumeMl, isInfusionRunning, liveInfusions, nextInfusionLine, startedAtOf,
  DEFAULT_INFUSION_RATE_UNITS, type InfusionView,
} from './infusions';

const inf = (p: Partial<InfusionView> & { segments: InfusionView['segments'] }): InfusionView => ({
  id: 'i', caseId: 'c', line: 1, solutionName: 'Стерофундин', ...p,
});
const seg = (id: string, from: string, rate: string, unit = 'мл/ч', extra: Partial<InfusionView['segments'][0]> = {}) => ({
  id, from, rate, rateUnit: unit, ...extra,
});

describe('units and list', () => {
  it('пустой список клиники — единицы по умолчанию, без выдуманных доз', () => {
    expect(infusionRateUnitsOf(null)).toEqual([...DEFAULT_INFUSION_RATE_UNITS]);
    expect(infusionRateUnitsOf(['  мл/ч  ', '', 'мкг/кг/мин'])).toEqual(['мл/ч', 'мкг/кг/мин']);
  });
  it('liveInfusions и следующий номер линии', () => {
    const rows = [
      inf({ id: 'b', line: 2, solutionName: 'Б', segments: [] }),
      inf({ id: 'a', line: 1, solutionName: 'А', segments: [], deletedAt: 'x' }),
    ];
    expect(liveInfusions(rows).map(r => r.id)).toEqual(['b']);
    expect(nextInfusionLine(rows)).toBe(3);
    expect(nextInfusionLine([])).toBe(1);
  });
});

describe('rate and running', () => {
  const t0 = '2026-11-23T14:30:00.000Z';
  const t1 = '2026-11-23T14:45:00.000Z';
  const row = inf({
    segments: [seg('1', t0, '160'), seg('2', t1, '10')],
  });
  it('текущая скорость — последний отрезок не позже «сейчас»', () => {
    expect(startedAtOf(row)).toBe(t0);
    expect(currentRateLabel(row, '2026-11-23T14:40:00.000Z')).toBe('160 мл/ч');
    expect(currentRateLabel(row, '2026-11-23T15:00:00.000Z')).toBe('10 мл/ч');
    expect(isInfusionRunning(row, '2026-11-23T15:00:00.000Z')).toBe(true);
    expect(isInfusionRunning({ ...row, endedAt: '2026-11-23T14:50:00.000Z' }, '2026-11-23T15:00:00.000Z')).toBe(false);
    expect(isInfusionRunning(row, '2026-11-23T14:00:00.000Z')).toBe(false);
  });
  it('объём только для мл/ч: 15 мин × 160 + 60 мин × 10 = 50', () => {
    expect(infusionVolumeMl(row, '2026-11-23T15:45:00.000Z')).toBe(50);
    expect(formatVolumeMl(50)).toBe('50');
  });
  it('другие единицы — объём не считаем', () => {
    const cri = inf({ segments: [seg('1', t0, '5', 'мкг/кг/мин')] });
    expect(infusionVolumeMl(cri, '2026-11-23T15:30:00.000Z')).toBeNull();
    expect(formatVolumeMl(null)).toBe('—');
  });
  it('болюс плюс мл/ч', () => {
    const mix = inf({
      segments: [
        seg('1', '2026-11-23T14:00:00.000Z', '20'),
        seg('2', '2026-11-23T15:00:00.000Z', '', 'мл/ч', { isBolus: true, bolusVolumeMl: '40' }),
      ],
    });
    expect(infusionVolumeMl(mix, '2026-11-23T15:30:00.000Z')).toBe(60);
    expect(currentRateLabel(mix, '2026-11-23T15:10:00.000Z')).toBe('болюс 40 мл');
  });
  it('текст изменений', () => {
    expect(infusionChangesText(row, s => s.slice(11, 16))).toBe('14:30 — 160 мл/ч; 14:45 — 10 мл/ч');
  });
});
