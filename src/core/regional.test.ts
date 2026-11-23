import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOCAL_ANESTHETICS, blockNamesOf, doseOverMax, doseWarnMessage, localAnestheticMg,
  localAnestheticsOf, maxMgKgFor, mgPerKg, sameAnestheticName, totalForAnesthetic,
} from './regional';

describe('localAnestheticMg', () => {
  it('мг = % × 10 × мл', () => {
    expect(localAnestheticMg('0,5', '20')).toBe(100); // 0,5% × 10 × 20 мл = 100 мг
    expect(localAnestheticMg(2, 5)).toBe(100);
    expect(localAnestheticMg('1', '3,5')).toBe(35);
  });
  it('пусто и мусор — null, отрицательное — null', () => {
    expect(localAnestheticMg('', '10')).toBeNull();
    expect(localAnestheticMg('0,5', '')).toBeNull();
    expect(localAnestheticMg('x', 5)).toBeNull();
    expect(localAnestheticMg(-1, 5)).toBeNull();
  });
  it('мг/кг по весу', () => {
    expect(mgPerKg(100, '28')).toBeCloseTo(3.571, 3);
    expect(mgPerKg(100, '0')).toBeNull();
    expect(mgPerKg(null, '28')).toBeNull();
    expect(mgPerKg(35, '3,5')).toBe(10);
  });
});

describe('catalogs', () => {
  it('названия блокад изначально пустые, анестетики — три стартовых без максимума', () => {
    expect(blockNamesOf(undefined)).toEqual([]);
    expect(blockNamesOf([])).toEqual([]);
    expect(localAnestheticsOf(undefined).map(x => x.name)).toEqual(['Бупивакаин', 'Лидокаин', 'Ропивакаин']);
    expect(localAnestheticsOf(undefined).every(x => x.maxMgKg == null)).toBe(true);
    expect(DEFAULT_LOCAL_ANESTHETICS.every(x => x.maxMgKg == null)).toBe(true);
    expect(localAnestheticsOf([{ name: '  Лидокаин  ', maxMgKg: 6 }])).toEqual([{ name: 'Лидокаин', maxMgKg: 6 }]);
  });
});

describe('totals and flags', () => {
  it('суммирует блокады и другие введения одного препарата, разные имена не смешивает', () => {
    const sources = [
      { name: 'Лидокаин', mg: 70, weightKg: '10' },
      { name: 'лидокаин', mg: 30, weightKg: '10' },
      { name: 'Бупивакаин', mg: 20, weightKg: '10' },
    ];
    expect(sameAnestheticName('Лидокаин', 'лидокаин')).toBe(true);
    expect(totalForAnesthetic('Лидокаин', sources)).toEqual({ mg: 100, mgKg: 10 });
    expect(totalForAnesthetic('Бупивакаин', sources)).toEqual({ mg: 20, mgKg: 2 });
  });
  it('флаг только если клиника задала максимум и сумма его превысила; пустой максимум не предупреждает', () => {
    expect(doseOverMax(7, null)).toBe(false);
    expect(doseOverMax(7, 6)).toBe(true);
    expect(doseOverMax(6, 6)).toBe(false);
    expect(doseOverMax(null, 6)).toBe(false);
    expect(doseWarnMessage('Лидокаин', 7, 6)).toContain('7 мг/кг > 6 мг/кг');
  });
  it('макс. из справочника регионарки, иначе из формуляра; мкг/кг переводятся в мг/кг', () => {
    const cat = [{ name: 'Лидокаин', maxMgKg: 6 }];
    expect(maxMgKgFor('лидокаин', cat)).toBe(6);
    expect(maxMgKgFor('Бупивакаин', cat, [{ name: 'Бупивакаин', doseUnit: 'mg/kg', maxDose: 2 }])).toBe(2);
    expect(maxMgKgFor('X', cat, [{ name: 'X', doseUnit: 'mcg/kg', maxDose: 2000 }])).toBe(2);
    expect(maxMgKgFor('Y', cat, [{ name: 'Y', doseUnit: 'mg/kg', maxDose: null }])).toBeNull();
  });
});
