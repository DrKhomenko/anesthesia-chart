import { describe, it, expect } from 'vitest';
import { MONITOR_FIELDS, MACHINE_FIELDS, PRESET_DEVICES, fieldsFor } from './devices';
import {
  parseModelOutput, parseLooseNumber, parseNibp, isBlankToken, isOutOfRange, rangeFlags,
  parseDeviceTime, chooseTickTime, mergeValues, findTickAtMinute, suggestMergeTime,
  resolveTickTime, extractJsonText, emptyValues, buildVisionPrompt,
} from './vision';

const monitorFields = fieldsFor('monitor', PRESET_DEVICES[0].fieldKeys);
const machineFields = fieldsFor('machine', PRESET_DEVICES[1].fieldKeys);

/** Мок ответа модели по фото uMEC12 Vet (человеческая сверка). */
const MONITOR_FIXTURE_RAW = `{
  "hr": 142,
  "pr": 142,
  "spo2": 100,
  "etco2": 38,
  "fico2": 0,
  "rr": 12,
  "t1": 23.3,
  "t2": "38,2",
  "nibp": "---/---",
  "deviceTime": "12:47:47 13-11-2026"
}`;

/** Мок ответа модели по фото WATO EX-35Vet (человеческая сверка). */
const WATO_FIXTURE_RAW = `{
  "ventMode": "PCV",
  "setPinsp": 10,
  "setRr": 12,
  "setIE": "1:2",
  "setTslope": 0.1,
  "setPeep": 3,
  "pPeak": 10,
  "pPlat": 10,
  "peep": 3,
  "vtInsp": 45,
  "vtExp": 37,
  "mv": 0.5,
  "rrMeas": 12,
  "fio2": 72,
  "raw": 60,
  "compliance": 6,
  "deviceTime": "12:46"
}`;

describe('parseLooseNumber', () => {
  it('запятая, точка, проценты', () => {
    expect(parseLooseNumber('38,2')).toBeCloseTo(38.2);
    expect(parseLooseNumber('0,5')).toBeCloseTo(0.5);
    expect(parseLooseNumber('72%')).toBe(72);
    expect(parseLooseNumber(142)).toBe(142);
    expect(parseLooseNumber('  12  ')).toBe(12);
  });
  it('пусто и мусор → null', () => {
    expect(parseLooseNumber('')).toBeNull();
    expect(parseLooseNumber(null)).toBeNull();
    expect(parseLooseNumber('---')).toBeNull();
    expect(parseLooseNumber('abc')).toBeNull();
    expect(parseLooseNumber('n/a')).toBeNull();
  });
});

describe('isBlankToken / parseNibp', () => {
  it('плейсхолдеры', () => {
    for (const s of ['---', '--', '—', 'null', 'N/A', 'measuring', 'измерение', '', null, '---/---', '--/--/--'])
      expect(isBlankToken(s), String(s)).toBe(true);
    expect(isBlankToken('142')).toBe(false);
  });
  it('---/--- → все null', () => {
    expect(parseNibp('---/---')).toEqual({ sys: null, dia: null, map: null });
    expect(parseNibp('—/—/—')).toEqual({ sys: null, dia: null, map: null });
    expect(parseNibp('measuring')).toEqual({ sys: null, dia: null, map: null });
  });
  it('110/65/80', () => {
    expect(parseNibp('110/65/80')).toEqual({ sys: 110, dia: 65, map: 80 });
    expect(parseNibp('110 / 65')).toEqual({ sys: 110, dia: 65, map: null });
  });
});

describe('parseModelOutput', () => {
  it('мусор → ok: false, значения пустые', () => {
    const r = parseModelOutput('это не json и не показания', monitorFields);
    expect(r.ok).toBe(false);
    expect(r.deviceTimeRaw).toBeNull();
    expect(Object.values(r.values).every(v => v == null)).toBe(true);
  });
  it('обрезанный json', () => {
    expect(parseModelOutput('{ "hr": 10,', monitorFields).ok).toBe(false);
    expect(extractJsonText('нет скобок')).toBeNull();
  });
  it('null и отсутствующие поля', () => {
    const r = parseModelOutput('{"hr": null, "spo2": 98}', monitorFields);
    expect(r.ok).toBe(true);
    expect(r.values.hr).toBeNull();
    expect(r.values.spo2).toBe(98);
    expect(r.values.etco2).toBeNull();
  });
  it('запятая как десятичный разделитель', () => {
    const r = parseModelOutput('{"t2": "38,2", "mv": "0,5", "t1": "23,3"}', [...monitorFields, ...machineFields]);
    expect(r.values.t2).toBeCloseTo(38.2);
    expect(r.values.mv).toBeCloseTo(0.5);
    expect(r.values.t1).toBeCloseTo(23.3);
  });
  it('НИАД ---/--- → null', () => {
    const r = parseModelOutput('{"nibp": "---/---", "hr": 142}', monitorFields);
    expect(r.values.hr).toBe(142);
    expect(r.values.nibpSys).toBeNull();
    expect(r.values.nibpDia).toBeNull();
    expect(r.values.nibpMap).toBeNull();
  });
  it('НИАД составной 110/65/80', () => {
    const r = parseModelOutput('{"nibp": "110/65/80"}', monitorFields);
    expect(r.values.nibpSys).toBe(110);
    expect(r.values.nibpDia).toBe(65);
    expect(r.values.nibpMap).toBe(80);
  });
  it('JSON в ограде markdown и лишний текст', () => {
    const r = parseModelOutput('Конечно, вот данные:\n```json\n{"hr": 88, "deviceTime": "14:05"}\n```\nудачи', monitorFields);
    expect(r.ok).toBe(true);
    expect(r.values.hr).toBe(88);
    expect(r.deviceTimeRaw).toBe('14:05');
  });
  it('висячая запятая', () => {
    const r = parseModelOutput('{"hr": 90,}', monitorFields);
    expect(r.ok).toBe(true);
    expect(r.values.hr).toBe(90);
  });
  it('ключи без учёта регистра, единицы и строки-числа', () => {
    const r = parseModelOutput('{"HR": "142 bpm", "SpO2": "97%", "T2": "38,2 °C"}', monitorFields);
    expect(r.ok).toBe(true);
    expect(r.values.hr).toBe(142);
    expect(r.values.spo2).toBe(97);
    expect(r.values.t2).toBeCloseTo(38.2);
  });
  it('обёртка { data: {...} } и массив частей не мешают', () => {
    const r = parseModelOutput('Sure:\n```\n{ "data": { "hr": 88, "spo2": 99 } }\n```', monitorFields);
    expect(r.ok).toBe(true);
    expect(r.values.hr).toBe(88);
    expect(r.values.spo2).toBe(99);
  });
});

describe('фото-фикстуры (мок ответа модели)', () => {
  it('uMEC12 Vet: сверка с ручным чтением', () => {
    const r = parseModelOutput(MONITOR_FIXTURE_RAW, monitorFields);
    expect(r.ok).toBe(true);
    expect(r.values.hr).toBe(142);
    expect(r.values.pr).toBe(142);
    expect(r.values.spo2).toBe(100);
    expect(r.values.etco2).toBe(38);
    expect(r.values.fico2).toBe(0);
    expect(r.values.rr).toBe(12);
    expect(r.values.t1).toBeCloseTo(23.3);
    expect(r.values.t2).toBeCloseTo(38.2);
    expect(r.values.nibpSys).toBeNull();
    expect(r.values.nibpDia).toBeNull();
    expect(r.values.nibpMap).toBeNull();
    expect(r.deviceTimeRaw).toBe('12:47:47 13-11-2026');
    const flags = rangeFlags(monitorFields, r.values);
    expect(Object.values(flags).every(v => !v)).toBe(true); // 23,3 и 38,2 в рамке 15–45
  });
  it('WATO EX-35Vet: сверка с ручным чтением', () => {
    const r = parseModelOutput(WATO_FIXTURE_RAW, machineFields);
    expect(r.ok).toBe(true);
    expect(r.values.ventMode).toBe('PCV');
    expect(r.values.setPinsp).toBe(10);
    expect(r.values.setRr).toBe(12);
    expect(r.values.setIE).toBe('1:2');
    expect(r.values.setTslope).toBeCloseTo(0.1);
    expect(r.values.setPeep).toBe(3);
    expect(r.values.pPeak).toBe(10);
    expect(r.values.pPlat).toBe(10);
    expect(r.values.peep).toBe(3);
    expect(r.values.vtInsp).toBe(45);
    expect(r.values.vtExp).toBe(37);
    expect(r.values.mv).toBeCloseTo(0.5);
    expect(r.values.rrMeas).toBe(12);
    expect(r.values.fio2).toBe(72);
    expect(r.values.raw).toBe(60);
    expect(r.values.compliance).toBe(6);
    expect(r.deviceTimeRaw).toBe('12:46');
  });
});

describe('рамки здравого смысла', () => {
  const hr = MONITOR_FIELDS.find(f => f.key === 'hr')!;
  const spo2 = MONITOR_FIELDS.find(f => f.key === 'spo2')!;
  it('в рамках и вне', () => {
    expect(isOutOfRange(hr, 142)).toBe(false);
    expect(isOutOfRange(hr, 1420)).toBe(true);
    expect(isOutOfRange(hr, 5)).toBe(true);
    expect(isOutOfRange(spo2, 100)).toBe(false);
    expect(isOutOfRange(spo2, 40)).toBe(true);
    expect(isOutOfRange(hr, null)).toBe(false);
  });
});

describe('время прибора', () => {
  const now = new Date(2026, 10, 13, 12, 50, 0); // 13.11.2026 12:50
  it('разбор форматов', () => {
    const a = parseDeviceTime('12:47:47 13-11-2026', now)!;
    expect(a.getFullYear()).toBe(2026);
    expect(a.getMonth()).toBe(10);
    expect(a.getDate()).toBe(13);
    expect(a.getHours()).toBe(12);
    expect(a.getMinutes()).toBe(47);
    expect(a.getSeconds()).toBe(47);
    const b = parseDeviceTime('12:46', now)!;
    expect(b.getHours()).toBe(12);
    expect(b.getMinutes()).toBe(46);
    expect(b.getSeconds()).toBe(0);
    const c = parseDeviceTime('2026-11-13T12:47:47', now)!;
    expect(c.getMinutes()).toBe(47);
    expect(parseDeviceTime(null, now)).toBeNull();
    expect(parseDeviceTime('---', now)).toBeNull();
  });
  it('в окне ±10 мин берём часы прибора', () => {
    const r = chooseTickTime('12:47:47 13-11-2026', now);
    expect(r.usedDeviceTime).toBe(true);
    expect(r.at.getMinutes()).toBe(47);
    expect(r.at.getSeconds()).toBe(47);
  });
  it('старше 10 мин → сейчас', () => {
    const late = new Date(2026, 10, 13, 13, 5, 0);
    const r = chooseTickTime('12:47:47 13-11-2026', late);
    expect(r.usedDeviceTime).toBe(false);
    expect(r.at.getTime()).toBe(late.getTime());
  });
  it('нет часов прибора → сейчас', () => {
    const r = chooseTickTime(null, now);
    expect(r.usedDeviceTime).toBe(false);
    expect(r.at.getTime()).toBe(now.getTime());
  });
  it('ровно 10 минут — ещё окно', () => {
    const edge = new Date(2026, 10, 13, 12, 57, 47);
    expect(chooseTickTime('12:47:47 13-11-2026', edge).usedDeviceTime).toBe(true);
  });
});

describe('слияние двух снимков в одну минуту', () => {
  it('не затирает существующее пустым', () => {
    const mon = parseModelOutput(MONITOR_FIXTURE_RAW, monitorFields).values;
    const wato = parseModelOutput(WATO_FIXTURE_RAW, machineFields).values;
    const merged = mergeValues(mon, wato);
    expect(merged.hr).toBe(142);
    expect(merged.spo2).toBe(100);
    expect(merged.ventMode).toBe('PCV');
    expect(merged.vtInsp).toBe(45);
    expect(merged.fio2).toBe(72);
    const back = mergeValues(merged, { hr: null, spo2: 99, sevoPct: 2 });
    expect(back.hr).toBe(142);
    expect(back.spo2).toBe(99);
    expect(back.sevoPct).toBe(2);
  });
  it('поиск записи той же минуты', () => {
    const ticks = [{ id: 'a', at: new Date(2026, 10, 13, 12, 47, 47).toISOString() }];
    expect(findTickAtMinute(ticks, new Date(2026, 10, 13, 12, 47, 10))?.id).toBe('a');
    expect(findTickAtMinute(ticks, new Date(2026, 10, 13, 12, 46, 0))).toBeUndefined();
    expect(findTickAtMinute([{ ...ticks[0], deletedAt: 'x' }], new Date(2026, 10, 13, 12, 47, 0))).toBeUndefined();
  });
  it('два фото подряд (часы 12:47 и 12:46) предлагают одну минуту', () => {
    const now = new Date(2026, 10, 13, 12, 50, 0);
    const monAt = chooseTickTime('12:47:47 13-11-2026', now).at;
    const ticks = [{ id: 'm', at: monAt.toISOString() }];
    const wato = resolveTickTime({ deviceTimeRaw: '12:46', now, existingTicks: ticks });
    expect(wato.existing?.id).toBe('m');
    expect(findTickAtMinute(ticks, wato.at)?.id).toBe('m');
  });
});

describe('промпт', () => {
  it('просит строгий JSON и не выдумывать газ', () => {
    const p = buildVisionPrompt({ type: 'monitor', name: 'Mindray uMEC12 Vet', fields: monitorFields });
    expect(p).toContain('hr: ЧСС');
    expect(p).toContain('deviceTime');
    expect(p).toContain('Return ONLY a JSON object');
    expect(p).toContain('no anesthetic gas module');
  });
  it('пустые значения для ручного ввода', () => {
    const v = emptyValues(monitorFields);
    expect(v.hr).toBeNull();
    expect(Object.keys(v).length).toBe(monitorFields.length);
  });
});
