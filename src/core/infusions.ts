// Инфузии (CRI/растворы): отрезки скорости. Объём считается только для мл/ч и болюсов в мл — другие единицы не пересчитываем.
import { fmt, infusionTotalMl, parseNum } from './logic';

export const DEFAULT_INFUSION_RATE_UNITS = [
  'мл/ч',
  'мл/кг/ч',
  'мкг/кг/мин',
  'мг/кг/ч',
  'мг/кг/мин',
  'мкг/кг/ч',
] as const;

export const ML_PER_HOUR = 'мл/ч';

export function infusionRateUnitsOf(list?: string[] | null): string[] {
  const src = Array.isArray(list) ? list.filter(x => typeof x === 'string' && x.trim()) : [];
  return src.length ? src.map(x => x.trim()) : [...DEFAULT_INFUSION_RATE_UNITS];
}

export interface InfusionSegment {
  id: string;
  from: string;
  rate: string;
  rateUnit: string;
  isBolus?: boolean;
  bolusVolumeMl?: string | null;
  note?: string;
}

export interface InfusionView {
  id: string;
  caseId: string;
  line: number;
  drugId?: string | null;
  solutionName: string;
  segments: InfusionSegment[];
  endedAt?: string | null;
  note?: string;
  deletedAt?: string | null;
}

export function liveInfusions<T extends { deletedAt?: string | null; line: number; solutionName?: string }>(rows: T[]): T[] {
  return rows.filter(r => !r.deletedAt).sort((a, b) => a.line - b.line || (a.solutionName ?? '').localeCompare(b.solutionName ?? '', 'ru'));
}

export function nextInfusionLine(rows: { deletedAt?: string | null; line: number }[]): number {
  const live = rows.filter(r => !r.deletedAt);
  return live.reduce((m, r) => Math.max(m, r.line), 0) + 1;
}

export function sortedSegments(inf: { segments?: InfusionSegment[] | null }): InfusionSegment[] {
  return [...(inf.segments ?? [])].sort((a, b) => a.from.localeCompare(b.from));
}

export function segmentAt(inf: { segments?: InfusionSegment[] | null }, at: Date | string): InfusionSegment | undefined {
  const iso = typeof at === 'string' ? at : at.toISOString();
  const segs = sortedSegments(inf).filter(s => s.from <= iso);
  return segs.length ? segs[segs.length - 1] : undefined;
}

export function isInfusionRunning(inf: { deletedAt?: string | null; endedAt?: string | null; segments?: InfusionSegment[] | null }, at: Date | string = new Date()): boolean {
  if (inf.deletedAt) return false;
  const iso = typeof at === 'string' ? at : at.toISOString();
  if (inf.endedAt && inf.endedAt <= iso) return false;
  const first = sortedSegments(inf)[0];
  if (!first) return false;
  return first.from <= iso;
}

export function startedAtOf(inf: { segments?: InfusionSegment[] | null }): string | null {
  return sortedSegments(inf)[0]?.from ?? null;
}

export function rateLabel(seg: InfusionSegment | undefined): string {
  if (!seg) return '—';
  if (seg.isBolus) {
    const v = (seg.bolusVolumeMl ?? '').trim();
    return v ? `болюс ${v} мл` : 'болюс';
  }
  const r = (seg.rate ?? '').trim();
  const u = (seg.rateUnit ?? '').trim();
  if (!r && !u) return '—';
  return [r, u].filter(Boolean).join(' ');
}

export function currentRateLabel(inf: { segments?: InfusionSegment[] | null }, at: Date | string = new Date()): string {
  return rateLabel(segmentAt(inf, at));
}

/** Объём в мл — только отрезки в мл/ч и болюсы с объёмом. Иначе null (не выдумываем перевод единиц). */
export function infusionVolumeMl(inf: { segments?: InfusionSegment[] | null; endedAt?: string | null }, end: Date | string): number | null {
  const until = typeof end === 'string' ? new Date(end) : end;
  const stop = inf.endedAt ? new Date(Math.min(until.getTime(), new Date(inf.endedAt).getTime())) : until;
  const segs = sortedSegments(inf);
  if (!segs.length) return 0;
  const countable = segs.filter(s => s.isBolus || s.rateUnit === ML_PER_HOUR);
  if (!countable.length) return null;
  // Если среди отрезков есть другие единицы — объём в мл не считаем целиком.
  if (segs.some(s => !s.isBolus && s.rateUnit !== ML_PER_HOUR && (s.rate ?? '').trim() !== '')) return null;
  const mapped = segs.map(s => ({
    from: new Date(s.from),
    rateMlH: s.isBolus ? 0 : (parseNum(s.rate) || 0),
    isBolus: !!s.isBolus,
    bolusVolumeMl: s.bolusVolumeMl != null && s.bolusVolumeMl !== '' ? parseNum(s.bolusVolumeMl) : null,
  }));
  return infusionTotalMl(mapped, stop);
}

export function formatVolumeMl(n: number | null): string {
  if (n == null) return '—';
  return fmt(n, 1);
}

/** Текст изменений для PDF и списка: «14:30 — 160 мл/ч; 14:45 — 10 мл/ч». */
export function infusionChangesText(inf: { segments?: InfusionSegment[] | null }, time: (iso: string) => string): string {
  return sortedSegments(inf).map(s => `${time(s.from)} — ${rateLabel(s)}`).join('; ');
}
