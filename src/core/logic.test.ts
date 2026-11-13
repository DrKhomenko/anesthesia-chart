import { describe, it, expect } from 'vitest';
import { parseNum, fmt, calcDose, checkWeight, evaluateAlarms, defaultThresholds, infusionTotalMl, generateTimeList, parseTimeInput, fmtTime, dosePresets, canAddCatalogItem, checkLimit, EXAM_LAB_PARAMS } from './logic';


describe('fmt', () => {
  it('0,825 → 0,83, без лишних нулей', () => {
    expect(fmt(0.825)).toBe('0,83');
    expect(fmt(3.3 * 25 / 100)).toBe('0,83');
    expect(fmt(82.5, 3)).toBe('82,5');
    expect(fmt(0.0198)).toBe('0,02');
  });
});
describe('parseNum', () => {
  it('запятая и точка', () => { expect(parseNum('3,3')).toBe(3.3); expect(parseNum(' 3.3 ')).toBe(3.3); });
  it('мусор → NaN', () => { expect(parseNum('')).toBeNaN(); expect(parseNum('abc')).toBeNaN(); expect(parseNum('1,2,3')).toBeNaN(); });
});

describe('calcDose', () => {
  const base = { weightKg: '3,3', dose: '25', doseUnit: 'mg/kg' as const, concentration: '100', concUnit: 'mg/ml' as const };
  it('мг/кг', () => { const r = calcDose(base); expect(r.ok && r.totalMg).toBeCloseTo(82.5); expect(r.ok && r.volumeMl).toBeCloseTo(0.825); });
  it('мкг/кг и мкг/мл', () => { const r = calcDose({ ...base, dose: '10', doseUnit: 'mcg/kg', concentration: '1000', concUnit: 'mcg/ml' }); expect(r.ok && r.totalMg).toBeCloseTo(0.033); expect(r.ok && r.volumeMl).toBeCloseTo(0.033); });
  it('проценты: 1% = 10 мг/мл', () => { const r = calcDose({ ...base, dose: '4', concentration: '1', concUnit: 'percent' }); expect(r.ok && r.volumeMl).toBeCloseTo(1.32); });
  it('формула на русском с запятой', () => { const r = calcDose(base); expect(r.ok && r.formula).toContain('3,3 кг × 25 мг/кг'); expect(r.ok && r.formula).toContain('0,83 мл'); });
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

describe('generateTimeList', () => {
  const now = new Date(2026, 10, 13, 14, 7, 30);
  const labels = () => generateTimeList(now).map(s => s.label);
  it('включает точное «сейчас» и помечает его', () => {
    const list = generateTimeList(now);
    const n = list.find(s => s.isNow);
    expect(n?.label).toBe('14:07');
    expect(list.some(s => s.label === '14:07')).toBe(true);
  });
  it('шаг 5 мин в окне ± и 1 мин рядом', () => {
    const l = labels();
    expect(l).toContain('12:05');
    expect(l).toContain('14:05');
    expect(l).toContain('14:10');
    expect(l).toContain('14:35');
    expect(l).toContain('14:06'); // мелкий шаг
    expect(l).toContain('14:08');
    expect(l.indexOf('12:05')).toBeLessThan(l.indexOf('14:07'));
  });
  it('без дублей и по возрастанию', () => {
    const list = generateTimeList(now);
    const labs = list.map(s => s.label);
    expect(new Set(labs).size).toBe(labs.length);
    const ts = list.map(s => s.date.getTime());
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
  it('включает выбранное время вне окна', () => {
    const sel = new Date(2026, 10, 13, 3, 17, 0);
    const list = generateTimeList(now, { selected: sel, beforeMin: 60, afterMin: 30 });
    expect(list.map(s => s.label)).toContain('03:17');
  });
});

describe('parseTimeInput / fmtTime', () => {
  const base = new Date(2026, 10, 13, 8, 0, 0);
  it('14:05, 14.05 и 1405', () => {
    for (const t of ['14:05', '14.05', '1405']) {
      const d = parseTimeInput(t, base)!;
      expect(fmtTime(d)).toBe('14:05');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getDate()).toBe(13);
    }
  });
  it('мусор и неверные часы', () => {
    expect(parseTimeInput('', base)).toBeNull();
    expect(parseTimeInput('25:00', base)).toBeNull();
    expect(parseTimeInput('14:99', base)).toBeNull();
    expect(parseTimeInput('abc', base)).toBeNull();
  });
});

describe('dosePresets', () => {
  it('мин–макс 5–30 с шагом 5, края входят', () => {
    expect(dosePresets({ min: 5, max: 30 })).toEqual([5, 10, 15, 20, 25, 30]);
  });
  it('мелкие дозы', () => {
    const p = dosePresets({ min: 0.002, max: 0.01 });
    expect(p[0]).toBeCloseTo(0.002);
    expect(p[p.length - 1]).toBeCloseTo(0.01);
    expect(p.length).toBeGreaterThanOrEqual(3);
  });
  it('без рамок — только уникальные недавние по возрастанию', () => {
    expect(dosePresets({ recent: [25, 10, 25, 10] })).toEqual([10, 25]);
  });
  it('недавние дополняют рамки, пусто → []', () => {
    const p = dosePresets({ min: 5, max: 15, recent: [20, 5] });
    expect(p).toContain(20);
    expect(p).toContain(5);
    expect(dosePresets({})).toEqual([]);
  });
});

describe('canAddCatalogItem', () => {
  const have = [{ name: 'Метис' }, { name: 'Лабрадор' }];
  it('нормализует пробелы и пустое отвергает', () => {
    expect(canAddCatalogItem('  Шпиц  ', have)).toEqual({ ok: true, name: 'Шпиц' });
    expect(canAddCatalogItem('   ', have)).toEqual({ ok: false, reason: 'empty' });
    expect(canAddCatalogItem('Сиамская   короткошёрстная', [])).toEqual({ ok: true, name: 'Сиамская короткошёрстная' });
  });
  it('дубль без учёта регистра', () => {
    const r = canAddCatalogItem(' метис ', have);
    expect(r).toEqual({ ok: false, reason: 'duplicate', existingName: 'Метис' });
  });
  it('одинаковое имя в другом списке (другой вид) — можно', () => {
    expect(canAddCatalogItem('Лабрадор', [{ name: 'Метис' }]).ok).toBe(true);
  });
});

describe('checkLimit', () => {
  const limits = [
    { species: 'cat' as const, parameter: 'hr' as const, low: 80, high: 200 },
    { species: 'cat' as const, parameter: 'glucoseMmolL' as const, low: 3, high: 8 },
  ];
  it('пусто / мусор / минус', () => {
    expect(checkLimit('cat', 'hr', '', limits).state).toBe('empty');
    expect(checkLimit('cat', 'hr', null, limits).state).toBe('empty');
    expect(checkLimit('cat', 'hr', 'abc', limits).state).toBe('invalid');
    expect(checkLimit('cat', 'hr', '-1', limits).state).toBe('invalid');
  });
  it('нет рамок → не блок, «не настроено»', () => {
    const r = checkLimit('dog', 'hr', '80', limits);
    expect(r.state).toBe('not-configured');
    expect(r.state === 'not-configured' && r.message).toBe('не настроено');
    expect(checkLimit('cat', 'tempC', '38', limits).state).toBe('not-configured');
  });
  it('в рамках и вне рамок', () => {
    expect(checkLimit('cat', 'hr', '140', limits).state).toBe('ok');
    const hi = checkLimit('cat', 'hr', '240', limits);
    expect(hi.state).toBe('warn');
    expect(hi.state === 'warn' && hi.message).toContain('ЧСС');
    expect(hi.state === 'warn' && hi.message).toContain('240');
    const lo = checkLimit('cat', 'glucoseMmolL', '2,1', limits);
    expect(lo.state).toBe('warn');
    expect(lo.state === 'warn' && lo.message).toContain('2,1');
  });
  it('по умолчанию рамок нет — приложение их не придумывает', () => {
    expect(EXAM_LAB_PARAMS.length).toBeGreaterThanOrEqual(18);
    expect(checkLimit('dog', 'hctPct', '35', []).state).toBe('not-configured');
    expect(checkLimit('cat', 'potassiumMmolL', '4', []).state).toBe('not-configured');
  });
});
