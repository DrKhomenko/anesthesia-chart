/** Подготовка данных для печатной карты: итоги по препаратам и ряды для графика. Без клинических порогов. */
export interface AdminLike { drugNameSnapshot: string; totalMg: number | null; volumeMl: number | null; deletedAt?: string | null; givenAt: string }
export interface DrugTotal { name: string; count: number; totalMg: number | null; totalMl: number | null }

export function drugTotals(rows: AdminLike[]): DrugTotal[] {
  const m = new Map<string, DrugTotal & { mgUnknown: boolean; mlUnknown: boolean }>();
  for (const r of rows) {
    if (r.deletedAt) continue;
    const k = r.drugNameSnapshot || '—';
    const cur = m.get(k) ?? { name: k, count: 0, totalMg: 0, totalMl: 0, mgUnknown: false, mlUnknown: false };
    cur.count++;
    if (r.totalMg == null) cur.mgUnknown = true; else cur.totalMg = (cur.totalMg ?? 0) + r.totalMg;
    if (r.volumeMl == null) cur.mlUnknown = true; else cur.totalMl = (cur.totalMl ?? 0) + r.volumeMl;
    m.set(k, cur);
  }
  // Если хотя бы одно введение без расчёта — сумму не показываем, чтобы не занизить итог.
  return [...m.values()].map(({ mgUnknown, mlUnknown, ...t }) => ({ ...t, totalMg: mgUnknown ? null : round(t.totalMg!), totalMl: mlUnknown ? null : round(t.totalMl!) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
const round = (n: number) => Math.round(n * 1000) / 1000;

export interface TickLike { at: string; hr?: number | null; spo2?: number | null; etco2?: number | null; sys?: number | null; dia?: number | null; map?: number | null; tempC?: number | null; t2?: number | null }
export type SeriesKey = 'hr' | 'spo2' | 'etco2' | 'sys' | 'dia' | 'map' | 'temp';
export interface Series { key: SeriesKey; label: string; points: { t: number; v: number }[] }
export const SERIES_LABEL: Record<SeriesKey, string> = { hr: 'ЧСС', spo2: 'SpO₂', etco2: 'EtCO₂', sys: 'САД', dia: 'ДАД', map: 'СрАД', temp: 'T °C' };

export function buildSeries(ticks: TickLike[]): Series[] {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const get: Record<SeriesKey, (t: TickLike) => number | null | undefined> = {
    hr: t => t.hr, spo2: t => t.spo2, etco2: t => t.etco2, sys: t => t.sys, dia: t => t.dia, map: t => t.map, temp: t => t.tempC ?? t.t2,
  };
  return (Object.keys(get) as SeriesKey[]).map(key => ({
    key, label: SERIES_LABEL[key],
    points: sorted.flatMap(t => { const v = get[key](t); const ts = new Date(t.at).getTime(); return typeof v === 'number' && Number.isFinite(v) && Number.isFinite(ts) ? [{ t: ts, v }] : []; }),
  })).filter(s => s.points.length > 0);
}

/** Шкала графика по данным (не нормы): округление вниз/вверх до шага. */
export function niceRange(values: number[], step: number, floorAtZero = false): [number, number] {
  if (!values.length) return [0, step];
  let lo = Math.floor(Math.min(...values) / step) * step;
  let hi = Math.ceil(Math.max(...values) / step) * step;
  if (floorAtZero) lo = Math.min(0, lo);
  if (hi === lo) hi = lo + step;
  return [lo, hi];
}
