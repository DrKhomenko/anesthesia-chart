// Таймеры карты: повтор препарата и однократные (блок, свободный). Интервалы задаёт клиника, ничего не выдумывается.
import { formatCountdown } from './reminder';
import { parseNum } from './logic';

export type TimerKind = 'repeat' | 'once';
export type TimerStatus = 'running' | 'due' | 'stopped';

export interface TimerFields {
  id: string;
  kind: TimerKind;
  title: string;
  drugId?: string | null;
  drugAdminId?: string | null;
  regionalBlockId?: string | null;
  intervalMin?: number | null;
  dueAt: string;
  startedAt: string;
  lastFiredAt?: string | null;
  status: TimerStatus;
  stoppedAt?: string | null;
  deletedAt?: string | null;
}

export const INTERVAL_PRESETS: { min: number; ru: string }[] = [
  { min: 15, ru: '15 мин' },
  { min: 30, ru: '30 мин' },
  { min: 45, ru: '45 мин' },
  { min: 60, ru: '1 ч' },
  { min: 90, ru: '1,5 ч' },
  { min: 120, ru: '2 ч' },
];

const MAX_INTERVAL_MIN = 24 * 60;

/** Интервал в минутах. Часы переводятся в минуты. Пусто/мусор — null, значения не подставляются. */
export function parseIntervalMin(value: string | number | null | undefined, unit: 'min' | 'h' = 'min'): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const n = typeof value === 'number' ? value : parseNum(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const min = unit === 'h' ? n * 60 : n;
  const r = Math.round(min);
  if (r < 1) return null;
  return Math.min(r, MAX_INTERVAL_MIN);
}

export function formatInterval(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '—';
  if (min % 60 === 0) return min === 60 ? '1 ч' : `${min / 60} ч`;
  if (min > 60 && min % 30 === 0) {
    const h = min / 60;
    return `${String(h).replace('.', ',')} ч`;
  }
  return `${min} мин`;
}

export function dueAtFrom(startIso: string, intervalMin: number): string {
  const min = parseIntervalMin(intervalMin) ?? 0;
  return new Date(new Date(startIso).getTime() + min * 60_000).toISOString();
}

export function msUntilDueAt(dueAt: string, now: Date): number {
  return new Date(dueAt).getTime() - now.getTime();
}

export function isTimerStopped(t: TimerFields): boolean {
  return t.status === 'stopped' || !!t.stoppedAt || !!t.deletedAt;
}

/** Сработал, если не остановлен и время уже наступило. */
export function isTimerDue(t: TimerFields, now: Date): boolean {
  if (isTimerStopped(t) || t.deletedAt) return false;
  return now.getTime() >= new Date(t.dueAt).getTime();
}

export function liveTimers<T extends TimerFields>(rows: T[]): T[] {
  return rows.filter(t => !t.deletedAt && !isTimerStopped(t))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function overdueMinutes(dueAt: string, now: Date): number {
  const late = now.getTime() - new Date(dueAt).getTime();
  if (late <= 0) return 0;
  return Math.max(1, Math.round(late / 60_000));
}

/** «12:40», «пора», «просрочено на 8 мин». */
export function formatTimerCountdown(dueAt: string, now: Date): string {
  const ms = msUntilDueAt(dueAt, now);
  if (ms > 0) return formatCountdown(ms);
  const late = now.getTime() - new Date(dueAt).getTime();
  if (late < 30_000) return 'пора';
  return `просрочено на ${overdueMinutes(dueAt, now)} мин`;
}

export function timerBannerTitle(t: TimerFields): string {
  if (t.kind === 'repeat') return `${t.title} — пора`;
  return t.title;
}

export function restartRepeat<T extends TimerFields>(t: T, nowIso: string, patch?: Partial<T>): T {
  const interval = parseIntervalMin(t.intervalMin);
  const dueAt = interval ? dueAtFrom(nowIso, interval) : t.dueAt;
  return { ...t, ...patch, dueAt, startedAt: nowIso, lastFiredAt: nowIso, status: 'running', stoppedAt: null };
}

export function snoozeTimer<T extends TimerFields>(t: T, nowIso: string, addMin = 5): T {
  const extra = parseIntervalMin(addMin) ?? 5;
  const base = new Date(nowIso).getTime() > new Date(t.dueAt).getTime() ? nowIso : t.dueAt;
  return { ...t, dueAt: dueAtFrom(base, extra), status: 'running', stoppedAt: null };
}

export function stopTimer<T extends TimerFields>(t: T, nowIso: string): T {
  return { ...t, status: 'stopped', stoppedAt: nowIso };
}

export function shouldStopOnAnesthesiaEnd(opts: { anesthesiaEndAt?: string | null; stage?: string | null }): boolean {
  return !!opts.anesthesiaEndAt || opts.stage === 'closed';
}

export function defaultBlockTimerTitle(blockName?: string | null): string {
  const n = (blockName ?? '').trim();
  return n ? `${n} — оценить блок` : 'Оценить блок';
}
