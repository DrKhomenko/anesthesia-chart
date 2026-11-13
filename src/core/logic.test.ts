import { describe, it, expect } from 'vitest';
import { parseNum, calcDose, checkWeight, evaluateAlarms, defaultThresholds, infusionTotalMl } from './logic';

describe('parseNum', () => {
  it('запятая и точка', () => { expect(parseNum('3,3')).toBe(3.3); expect(parseNum(' 3.3 ')).toBe(3.3); });
  it('мусор → NaN', () => { expect(parseNum('')).toBeNaN(); expect(parseNum('abc')).toBeNaN(); expect(parseNum('1,2,3')).toBeNaN(); });
});

describe('calcDose', () => {
  const base = { weightKg: '3,3', dose: '25', doseUnit: 'mg/kg' as const, concentration: '100', concUnit: 'mg/ml' as const };
  it('мг/кг', () => { const r = calcDose(base); expect(r.ok && r.totalMg).toBeCloseTo(82.5); expect(r.ok && r.volumeMl).toBeCloseTo(0.825); });
  it('мкг/кг и мкг/мл', () => { const r = calcDose({ ...base, dose: '10', doseUnit: 'mcg/kg', concentration: '1000', concUnit: 'mcg/ml' }); expect(r.ok && r.totalMg).toBeCloseTo(0.033); expect(r.ok && r.volumeMl).toBeCloseTo(0.033); });
  it('проценты: 1% = 10 мг/мл', () => { const r = calcDose({ ...base, dose: '4', concentration: '1', concUnit: 'percent' }); expect(r.ok && r.volumeMl).toBeCloseTo(1.32); });
  it('формула на русском с запятой', () => { const r = calcDose(base); expect(r.ok && r.formula).toContain('3,3 кг × 25 мг/кг'); });
  it('нет концентрации', () => { expect(calcDose({ ...base, concentration: '' })).toEqual({ ok: false, error: 'Не задана концентрация препарата' }); expect(calcDose({ ...base, concentration: null }).ok).toBe(false); });
  it('ноль и минус', () => { expect(calcDose({ ...base, dose: '0' }).ok).toBe(false); expect(calcDose({ ...base, weightKg: '-1' }).ok).toBe(false); expect(calcDose({ ...base, concentration: '0' }).ok).toBe(false); });
  it('NaN', () => { expect(calcDose({ ...base, dose: 'x' }).ok).toBe(false); expect(calcDose({ ...base, weightKg: '' }).ok).toBe(false); });
});

describe('checkWeight', () => {
  const limits = [{ species: 'cat' as const, minKg: 0.5, maxKg: 12 }];
  it('рамки не заданы → не блок, «не настроено»', () => { expect(checkWeight('dog', '30', limits).state).toBe('not-configured'); });
  it('в рамках', () => { expect(checkWeight('cat', '3,3', limits).state).toBe('ok'); });
  it('лишний ноль', () => { const r = checkWeight('cat', '33', limits); expect(r.state).toBe('warn'); expect(r.state === 'warn' && r.hint).toContain('3,3'); });
  it('пропущен ноль', () => { const r = checkWeight('cat', '0,33', limits); expect(r.state).toBe('warn'); expect(r.state === 'warn' && r.hint).toContain('3,3'); });
  it('пусто и мусор', () => { expect(checkWeight('cat', '', limits).state).toBe('empty'); expect(checkWeight('cat', 'abc', limits).state).toBe('invalid'); expect(checkWeight('cat', '0', limits).state).toBe('invalid'); });
});

describe('alarms', () => {
  const th = defaultThresholds();
  it('по умолчанию только МАД 60 и T 36,5', () => {
    const set = th.filter(t => t.low != null || t.high != null);
    expect(set.map(t => `${t.species}:${t.parameter}:${t.low}`).sort()).toEqual(['cat:map:60', 'cat:tempC:36.5', 'dog:map:60', 'dog:tempC:36.5']);
  });
  it('МАД 52 < 60', () => { expect(evaluateAlarms('cat', { map: 52 }, th).map(a => a.message)).toEqual(['МАД 52 < 60']); });
  it('T 36,1 < 36,5', () => { expect(evaluateAlarms('dog', { tempC: 36.1 }, th)[0].message).toBe('T 36,1 < 36,5'); });
  it('пусто = не измеряли, нет тревоги', () => { expect(evaluateAlarms('dog', { map: null, hr: 300 }, th)).toEqual([]); });
  it('верхний порог клиники', () => { const t = [...th, { species: 'dog' as const, parameter: 'hr' as const, high: 180 }]; expect(evaluateAlarms('dog', { hr: 200 }, t)[0].message).toBe('ЧСС 200 > 180'); });
});

describe('infusionTotalMl', () => {
  const t = (h: number, m: number) => new Date(2026, 10, 13, h, m);
  it('отрезки скорости', () => { expect(infusionTotalMl([{ from: t(14, 30), rateMlH: 160 }, { from: t(14, 45), rateMlH: 10 }], t(15, 45))).toBe(50); });
  it('болюс + скорость, порядок не важен', () => { expect(infusionTotalMl([{ from: t(15, 0), rateMlH: 0, isBolus: true, bolusVolumeMl: 40 }, { from: t(14, 0), rateMlH: 20 }], t(15, 30))).toBe(60); });
  it('пусто', () => { expect(infusionTotalMl([], t(15, 0))).toBe(0); });
});
