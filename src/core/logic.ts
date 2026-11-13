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

/** Формат с запятой, без лишних нулей. */
export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return String(Number(n.toFixed(digits))).replace('.', ',');
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
