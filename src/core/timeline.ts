/** Общая шкала времени карты: длительности анестезии и операции. Только арифметика по введённым временам. */
export interface TimelineInput {
  anesthesiaStartAt?: string | null; anesthesiaEndAt?: string | null;
  surgeryStartAt?: string | null; surgeryEndAt?: string | null;
  firstPremedAt?: string | null;
}
export interface Span { startAt: string; endAt: string | null; minutes: number; running: boolean }
export interface Timeline { anesthesia: Span | null; surgery: Span | null; sincePremed: Span | null; warnings: string[] }

const t = (s?: string | null) => { if (!s) return NaN; const v = new Date(s).getTime(); return Number.isFinite(v) ? v : NaN; };

export function span(start?: string | null, end?: string | null, now: Date = new Date()): Span | null {
  const a = t(start); if (!Number.isFinite(a)) return null;
  const b = t(end);
  const running = !Number.isFinite(b);
  const stop = running ? now.getTime() : b;
  if (stop < a) return { startAt: start!, endAt: end ?? null, minutes: 0, running };
  return { startAt: start!, endAt: running ? null : end!, minutes: Math.floor((stop - a) / 60_000), running };
}

export function computeTimeline(c: TimelineInput, now: Date = new Date()): Timeline {
  const warnings: string[] = [];
  const anesthesia = span(c.anesthesiaStartAt, c.anesthesiaEndAt, now);
  const surgery = span(c.surgeryStartAt, c.surgeryEndAt, now);
  const sincePremed = span(c.firstPremedAt, c.anesthesiaStartAt ?? null, now);
  if (t(c.anesthesiaEndAt) < t(c.anesthesiaStartAt)) warnings.push('Конец анестезии раньше начала');
  if (t(c.surgeryEndAt) < t(c.surgeryStartAt)) warnings.push('Конец операции раньше начала');
  if (t(c.surgeryStartAt) < t(c.anesthesiaStartAt)) warnings.push('Операция началась раньше анестезии');
  if (Number.isFinite(t(c.surgeryEndAt)) && t(c.anesthesiaEndAt) < t(c.surgeryEndAt)) warnings.push('Анестезия закончилась раньше операции');
  if (!Number.isFinite(t(c.anesthesiaStartAt)) && Number.isFinite(t(c.anesthesiaEndAt))) warnings.push('Не указано начало анестезии');
  return { anesthesia, surgery, sincePremed, warnings };
}

/** 65 → «1 ч 05 мин», 40 → «40 мин». */
export function fmtDuration(min: number): string {
  if (!Number.isFinite(min) || min < 0) return '—';
  const h = Math.floor(min / 60), m = Math.floor(min % 60);
  return h ? `${h} ч ${String(m).padStart(2, '0')} мин` : `${m} мин`;
}

/** Короткая строка для шапки: «Анестезия 1 ч 05 мин · Операция 40 мин». */
export function timelineSummary(tl: Timeline): string {
  const parts: string[] = [];
  if (tl.anesthesia) parts.push(`Анестезия ${fmtDuration(tl.anesthesia.minutes)}${tl.anesthesia.running ? '…' : ''}`);
  if (tl.surgery) parts.push(`Операция ${fmtDuration(tl.surgery.minutes)}${tl.surgery.running ? '…' : ''}`);
  return parts.join(' · ');
}

/** Компактно для верхней панели: «Анест. 1:15», «Опер. 0:55». */
export function timelineCompact(tl: Timeline): string[] {
  const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const out: string[] = [];
  if (tl.anesthesia) out.push(`Анест. ${hm(tl.anesthesia.minutes)}${tl.anesthesia.running ? '…' : ''}`);
  if (tl.surgery) out.push(`Опер. ${hm(tl.surgery.minutes)}${tl.surgery.running ? '…' : ''}`);
  return out;
}
