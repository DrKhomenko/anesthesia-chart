// Чистая логика без UI и БД. Дозы и пороги не придумываются: всё задаёт клиника.
export type Species = 'dog' | 'cat';
export const SPECIES_RU: Record<Species, string> = { dog: 'Собака', cat: 'Кошка' };
export type DoseUnit = 'mg/kg' | 'mcg/kg';
export type ConcUnit = 'mg/ml' | 'mcg/ml' | 'percent';

/** Разбор числа: принимает «3,3» и «3.3», пробелы. Пусто/мусор → NaN. */
export function parseNum(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input;
  if (input == null) return NaN;
  const s = String(input).trim().replace(/\s+/g, '').replace(',', '.');
  if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

/** Формат с запятой, без лишних нулей. Округляет как врач на бумаге (0,825 → 0,83), не как toFixed. */
export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const p = 10 ** digits;
  const r = Math.round((n + Math.sign(n) * 1e-10) * p) / p;
  return String(r).replace('.', ',');
}

export type DoseResult =
  | { ok: true; totalMg: number; volumeMl: number; formula: string }
  | { ok: false; error: string };

export function calcDose(p: {
  weightKg: string | number; dose: string | number; doseUnit: DoseUnit;
  concentration: string | number | null | undefined; concUnit: ConcUnit;
}): DoseResult {
  const w = parseNum(p.weightKg), d = parseNum(p.dose);
  const c = p.concentration == null || p.concentration === '' ? NaN : parseNum(p.concentration);
  if (Number.isNaN(w)) return { ok: false, error: 'Вес не указан или не число' };
  if (w <= 0) return { ok: false, error: 'Вес должен быть больше нуля' };
  if (Number.isNaN(d)) return { ok: false, error: 'Доза не указана или не число' };
  if (d <= 0) return { ok: false, error: 'Доза должна быть больше нуля' };
  if (p.concentration == null || p.concentration === '') return { ok: false, error: 'Не задана концентрация препарата' };
  if (Number.isNaN(c)) return { ok: false, error: 'Концентрация не число' };
  if (c <= 0) return { ok: false, error: 'Концентрация должна быть больше нуля' };
  const totalMg = w * (p.doseUnit === 'mcg/kg' ? d / 1000 : d);
  const concMgMl = p.concUnit === 'mcg/ml' ? c / 1000 : p.concUnit === 'percent' ? c * 10 : c;
  const volumeMl = totalMg / concMgMl;
  const du = p.doseUnit === 'mcg/kg' ? 'мкг/кг' : 'мг/кг';
  const cu = p.concUnit === 'mcg/ml' ? 'мкг/мл' : p.concUnit === 'percent' ? '%' : 'мг/мл';
  return { ok: true, totalMg, volumeMl,
    formula: `${fmt(w)} кг × ${fmt(d, 3)} ${du} = ${fmt(totalMg, 3)} мг ÷ ${fmt(c, 3)} ${cu} = ${fmt(volumeMl)} мл` };
}

export interface WeightLimit { species: Species; minKg?: number | null; maxKg?: number | null }
export type WeightCheck =
  | { state: 'empty' } | { state: 'invalid'; message: string }
  | { state: 'not-configured'; message: string }
  | { state: 'ok' }
  | { state: 'warn'; message: string; hint?: string };

/** Проверка веса по рамкам клиники. Нет рамок → не блокируем, но сообщаем «не настроено». */
export function checkWeight(species: Species, weight: string | number, limits: WeightLimit[]): WeightCheck {
  if (weight === '' || weight == null) return { state: 'empty' };
  const w = parseNum(weight);
  if (Number.isNaN(w)) return { state: 'invalid', message: 'Вес не число' };
  if (w <= 0) return { state: 'invalid', message: 'Вес должен быть больше нуля' };
  const l = limits.find(x => x.species === species);
  const min = l?.minKg ?? null, max = l?.maxKg ?? null;
  if (min == null && max == null) return { state: 'not-configured', message: 'Рамки веса не настроены' };
  const inRange = (v: number) => (min == null || v >= min) && (max == null || v <= max);
  if (inRange(w)) return { state: 'ok' };
  const sp = SPECIES_RU[species].toLowerCase();
  const message = max != null && w > max ? `${fmt(w)} кг больше рамки ${fmt(max)} кг (${sp})` : `${fmt(w)} кг меньше рамки ${fmt(min!)} кг (${sp})`;
  let hint: string | undefined;
  if (inRange(w / 10)) hint = `Возможно, лишний ноль: ${fmt(w / 10)} кг?`;
  else if (inRange(w * 10)) hint = `Возможно, пропущен ноль или запятая: ${fmt(w * 10)} кг?`;
  return { state: 'warn', message, hint };
}

export type VitalParam = 'hr' | 'spo2' | 'sys' | 'map' | 'dia' | 'etco2' | 'rr' | 'tempC';
export const PARAM_RU: Record<VitalParam, { label: string; unit: string }> = {
  hr: { label: 'ЧСС', unit: 'уд/мин' }, spo2: { label: 'SpO₂', unit: '%' },
  sys: { label: 'САД', unit: 'мм рт. ст.' }, map: { label: 'МАД', unit: 'мм рт. ст.' },
  dia: { label: 'ДАД', unit: 'мм рт. ст.' }, etco2: { label: 'ETCO₂', unit: 'мм рт. ст.' },
  rr: { label: 'ЧДД', unit: 'в мин' }, tempC: { label: 'T', unit: '°C' },
};
export const PARAMS = Object.keys(PARAM_RU) as VitalParam[];
export interface Threshold { species: Species; parameter: VitalParam; low?: number | null; high?: number | null; isDefaultFromPaperChart?: boolean }

/** Значения по умолчанию — только с бумажного бланка: МАД < 60, T < 36,5. Остальное пусто. */
export function defaultThresholds(): Threshold[] {
  const out: Threshold[] = [];
  for (const species of ['dog', 'cat'] as Species[]) for (const parameter of PARAMS)
    out.push({ species, parameter,
      low: parameter === 'map' ? 60 : parameter === 'tempC' ? 36.5 : null, high: null,
      isDefaultFromPaperChart: parameter === 'map' || parameter === 'tempC' });
  return out;
}

export interface AlarmHit { parameter: VitalParam; value: number; limit: number; kind: 'low' | 'high'; message: string }
export function evaluateAlarms(species: Species, vitals: Partial<Record<VitalParam, number | null>>, thresholds: Threshold[]): AlarmHit[] {
  const hits: AlarmHit[] = [];
  for (const t of thresholds) {
    if (t.species !== species) continue;
    const v = vitals[t.parameter];
    if (v == null || Number.isNaN(v)) continue; // пусто = не измеряли
    const label = PARAM_RU[t.parameter].label;
    if (t.low != null && v < t.low) hits.push({ parameter: t.parameter, value: v, limit: t.low, kind: 'low', message: `${label} ${fmt(v, 1)} < ${fmt(t.low, 1)}` });
    else if (t.high != null && v > t.high) hits.push({ parameter: t.parameter, value: v, limit: t.high, kind: 'high', message: `${label} ${fmt(v, 1)} > ${fmt(t.high, 1)}` });
  }
  return hits;
}

export interface InfusionSegment { from: Date; rateMlH: number; isBolus?: boolean; bolusVolumeMl?: number | null }
/** Объём инфузии: отрезок длится до начала следующего или до конца анестезии. Болюс = его объём. */
export function infusionTotalMl(segments: InfusionSegment[], end: Date): number {
  const s = [...segments].sort((a, b) => a.from.getTime() - b.from.getTime());
  let total = 0;
  s.forEach((seg, i) => {
    if (seg.isBolus) { total += seg.bolusVolumeMl ?? 0; return; }
    const until = i + 1 < s.length ? s[i + 1].from : end;
    const h = Math.max(0, until.getTime() - seg.from.getTime()) / 3_600_000;
    total += seg.rateMlH * h;
  });
  return Math.round(total * 10) / 10;
}

// --- Время: список вокруг «сейчас» ---
export function pad2(n: number): string { return String(n).padStart(2, '0'); }
export function fmtTime(d: Date): string { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

/** Разбор «14:05», «14.05», «1405». Дата берётся из base, секунды обнуляются. */
export function parseTimeInput(text: string, base = new Date()): Date | null {
  const s = text.trim().replace(/[.,]/g, ':');
  let h: number, m: number;
  const colon = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (colon) { h = Number(colon[1]); m = Number(colon[2]); }
  else if (/^\d{3,4}$/.test(s)) { const t = s.padStart(4, '0'); h = Number(t.slice(0, 2)); m = Number(t.slice(2)); }
  else return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const d = new Date(base.getTime());
  d.setHours(h, m, 0, 0);
  return d;
}

export function applyClock(base: Date, hours: number, minutes: number): Date {
  const d = new Date(base.getTime());
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export interface TimeSlot { date: Date; label: string; isNow?: boolean }

/** Список времён вокруг now: крупный шаг (5 мин) в окне и мелкий (1 мин) рядом с now. Всегда включает точное «сейчас». */
export function generateTimeList(now: Date, opts: { stepMin?: number; beforeMin?: number; afterMin?: number; fineStepMin?: number; fineWindowMin?: number; selected?: Date | null } = {}): TimeSlot[] {
  const step = opts.stepMin ?? 5;
  const before = opts.beforeMin ?? 480;
  const after = opts.afterMin ?? 240;
  const fine = opts.fineStepMin ?? 1;
  const fineWin = opts.fineWindowMin ?? 10;
  const origin = new Date(now.getTime());
  origin.setSeconds(0, 0);
  const map = new Map<number, TimeSlot>();
  const add = (d: Date, isNow = false) => {
    const x = new Date(d.getTime()); x.setSeconds(0, 0);
    const k = x.getTime();
    const prev = map.get(k);
    if (!prev || isNow) map.set(k, { date: x, label: fmtTime(x), isNow: isNow || prev?.isNow });
  };
  const walk = (from: Date, to: Date, st: number) => {
    const cur = new Date(from.getTime());
    const min = cur.getMinutes();
    cur.setMinutes(min - (min % st), 0, 0); // ближайшая отметка шага в начале окна
    while (cur.getTime() <= to.getTime() + 500) { add(new Date(cur.getTime())); cur.setMinutes(cur.getMinutes() + st); }
  };
  walk(new Date(origin.getTime() - before * 60_000), new Date(origin.getTime() + after * 60_000), step);
  walk(new Date(origin.getTime() - fineWin * 60_000), new Date(origin.getTime() + fineWin * 60_000), fine);
  add(origin, true);
  if (opts.selected) add(new Date(opts.selected.getTime()));
  return [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

// --- Предустановки дозы ---
function niceStep(span: number, target = 8): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw * 0.8) return m * mag;
  return 10 * mag;
}
const doseKey = (n: number) => Number(n.toPrecision(8));

/** Предустановки: от мин до макс с «красивым» шагом, плюс недавно использованные. Без рамок — только недавние. */
export function dosePresets(opts: { min?: number | null; max?: number | null; recent?: number[] }): number[] {
  const set = new Set<number>();
  const add = (n: number) => { if (Number.isFinite(n) && n > 0) set.add(doseKey(n)); };
  const lo = opts.min != null && Number.isFinite(opts.min) ? opts.min : null;
  const hi = opts.max != null && Number.isFinite(opts.max) ? opts.max : null;
  if (lo != null && hi != null && hi > lo) {
    const step = niceStep(hi - lo);
    add(lo);
    const start = Math.ceil((lo + step * 1e-9) / step) * step;
    for (let v = start; v < hi - step * 1e-9; v = doseKey(v + step)) add(v);
    add(hi);
  } else {
    if (lo != null && lo > 0) add(lo);
    if (hi != null && hi > 0) add(hi);
  }
  for (const r of opts.recent ?? []) add(r);
  return [...set].sort((a, b) => a - b);
}

// --- Справочник: нормализация и дедупликация ---
export function normalizeCatalogName(name: string): string { return name.trim().replace(/\s+/g, ' '); }

export type CatalogAdd =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'duplicate'; existingName?: string };

/** Проверка перед добавлением в справочник. existing — уже отфильтрованный список (например, породы этого вида). */
export function canAddCatalogItem(name: string, existing: { name: string; deletedAt?: string | null }[]): CatalogAdd {
  const n = normalizeCatalogName(name);
  if (!n) return { ok: false, reason: 'empty' };
  const hit = existing.find(x => normalizeCatalogName(x.name).toLowerCase() === n.toLowerCase());
  if (hit) return { ok: false, reason: 'duplicate', existingName: hit.name };
  return { ok: true, name: n };
}

// --- Лимиты физикальных и лабораторных показателей (значения задаёт клиника) ---
export type ExamLabParam =
  | 'hr' | 'rr' | 'tempC' | 'crtSec' | 'map' | 'sys' | 'dia' | 'spo2' | 'weightKg'
  | 'hctPct' | 'totalProteinGl' | 'albuminGl' | 'glucoseMmolL' | 'lactateMmolL'
  | 'creatinineUmolL' | 'ureaMmolL' | 'potassiumMmolL' | 'sodiumMmolL' | 'icaMmolL'
  | 'plateletsE9L' | 'wbcE9L';

export const EXAM_LAB_PARAMS: { key: ExamLabParam; group: 'physical' | 'lab'; label: string; unit: string }[] = [
  { key: 'hr', group: 'physical', label: 'ЧСС', unit: 'уд/мин' },
  { key: 'rr', group: 'physical', label: 'ЧДД', unit: 'в мин' },
  { key: 'tempC', group: 'physical', label: 'T', unit: '°C' },
  { key: 'crtSec', group: 'physical', label: 'СРК', unit: 'с' },
  { key: 'sys', group: 'physical', label: 'САД', unit: 'мм рт. ст.' },
  { key: 'map', group: 'physical', label: 'МАД', unit: 'мм рт. ст.' },
  { key: 'dia', group: 'physical', label: 'ДАД', unit: 'мм рт. ст.' },
  { key: 'spo2', group: 'physical', label: 'SpO₂', unit: '%' },
  { key: 'weightKg', group: 'physical', label: 'Вес', unit: 'кг' },
  { key: 'hctPct', group: 'lab', label: 'Ht (НСТ)', unit: '%' },
  { key: 'totalProteinGl', group: 'lab', label: 'Общий белок', unit: 'г/л' },
  { key: 'albuminGl', group: 'lab', label: 'Альбумин', unit: 'г/л' },
  { key: 'glucoseMmolL', group: 'lab', label: 'Глюкоза', unit: 'ммоль/л' },
  { key: 'lactateMmolL', group: 'lab', label: 'Лактат', unit: 'ммоль/л' },
  { key: 'creatinineUmolL', group: 'lab', label: 'Креатинин', unit: 'мкмоль/л' },
  { key: 'ureaMmolL', group: 'lab', label: 'Мочевина', unit: 'ммоль/л' },
  { key: 'potassiumMmolL', group: 'lab', label: 'K⁺', unit: 'ммоль/л' },
  { key: 'sodiumMmolL', group: 'lab', label: 'Na⁺', unit: 'ммоль/л' },
  { key: 'icaMmolL', group: 'lab', label: 'iCa', unit: 'ммоль/л' },
  { key: 'plateletsE9L', group: 'lab', label: 'Тромбоциты', unit: '×10⁹/л' },
  { key: 'wbcE9L', group: 'lab', label: 'Лейкоциты', unit: '×10⁹/л' },
];
export const EXAM_LAB_KEYS = EXAM_LAB_PARAMS.map(p => p.key);
export const EXAM_LAB_RU: Record<ExamLabParam, { label: string; unit: string; group: 'physical' | 'lab' }> =
  Object.fromEntries(EXAM_LAB_PARAMS.map(p => [p.key, { label: p.label, unit: p.unit, group: p.group }])) as Record<ExamLabParam, { label: string; unit: string; group: 'physical' | 'lab' }>;

export interface ExamLabLimit { species: Species; parameter: ExamLabParam; low?: number | null; high?: number | null }
export type LimitCheck =
  | { state: 'empty' }
  | { state: 'invalid'; message: string }
  | { state: 'not-configured'; message: string }
  | { state: 'ok' }
  | { state: 'warn'; message: string };

/** Проверка значения по лимитам клиники. Нет рамок — «не настроено», не блокируем. Значения по умолчанию не подставляются. */
export function checkLimit(species: Species, parameter: ExamLabParam, value: string | number | null | undefined, limits: ExamLabLimit[]): LimitCheck {
  if (value === '' || value == null) return { state: 'empty' };
  const v = parseNum(value);
  if (Number.isNaN(v)) return { state: 'invalid', message: 'Не число' };
  if (v < 0) return { state: 'invalid', message: 'Значение не может быть отрицательным' };
  const l = limits.find(x => x.species === species && x.parameter === parameter);
  const min = l?.low ?? null, max = l?.high ?? null;
  if (min == null && max == null) return { state: 'not-configured', message: 'не настроено' };
  if ((min == null || v >= min) && (max == null || v <= max)) return { state: 'ok' };
  const meta = EXAM_LAB_RU[parameter];
  const message = max != null && v > max
    ? `${meta.label} ${fmt(v, 2)} > ${fmt(max, 2)} ${meta.unit}`
    : `${meta.label} ${fmt(v, 2)} < ${fmt(min!, 2)} ${meta.unit}`;
  return { state: 'warn', message };
}
