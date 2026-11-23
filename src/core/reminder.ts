// Напоминание внести показатели. Чистая логика, без UI и звука.
export const DEFAULT_REMINDER_INTERVAL_MIN = 5;
export const MIN_REMINDER_INTERVAL_MIN = 1;
export const MAX_REMINDER_INTERVAL_MIN = 60;

export function normalizeReminderInterval(value: unknown): number {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return DEFAULT_REMINDER_INTERVAL_MIN;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(String(value).trim().replace(',', '.')) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_REMINDER_INTERVAL_MIN;
  const i = Math.round(n);
  if (i < MIN_REMINDER_INTERVAL_MIN) return MIN_REMINDER_INTERVAL_MIN;
  if (i > MAX_REMINDER_INTERVAL_MIN) return MAX_REMINDER_INTERVAL_MIN;
  return i;
}

export type ReminderStage = 'header' | 'premed' | 'induction' | 'maintenance' | 'recovery' | 'closed';

/** Напоминание только на поддержании и пробуждении, пока анестезия идёт. */
export function reminderActive(opts: {
  enabled: boolean;
  stage: ReminderStage;
  anesthesiaStartAt?: string | null;
  anesthesiaEndAt?: string | null;
  isLocked?: boolean;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.isLocked || opts.stage === 'closed') return false;
  if (opts.stage !== 'maintenance' && opts.stage !== 'recovery') return false;
  if (opts.anesthesiaEndAt) return false;
  return true;
}

export function lastVitalsAt(ticks: { at: string; deletedAt?: string | null }[]): string | null {
  const live = ticks.filter(t => !t.deletedAt).sort((a, b) => a.at.localeCompare(b.at));
  return live.length ? live[live.length - 1].at : null;
}

/** Отсчёт от последней записи показателей; если записей нет — от начала анестезии, иначе от запасной точки (вкл. напоминания). */
export function reminderAnchor(opts: {
  lastVitalsAt: string | null;
  anesthesiaStartAt?: string | null;
  fallbackAt?: string | null;
}): string | null {
  return opts.lastVitalsAt ?? opts.anesthesiaStartAt ?? opts.fallbackAt ?? null;
}

export function nextDueAt(anchorIso: string, intervalMin: number): string {
  const ms = normalizeReminderInterval(intervalMin) * 60_000;
  return new Date(new Date(anchorIso).getTime() + ms).toISOString();
}

export function isReminderDue(opts: {
  now: Date;
  lastVitalsAt: string | null;
  anesthesiaStartAt?: string | null;
  fallbackAt?: string | null;
  intervalMin: number;
  snoozeUntil?: string | null;
}): boolean {
  if (opts.snoozeUntil && opts.now.getTime() < new Date(opts.snoozeUntil).getTime()) return false;
  const anchor = reminderAnchor(opts);
  if (!anchor) return false;
  return opts.now.getTime() >= new Date(nextDueAt(anchor, opts.intervalMin)).getTime();
}

export function msUntilDue(opts: {
  now: Date;
  lastVitalsAt: string | null;
  anesthesiaStartAt?: string | null;
  fallbackAt?: string | null;
  intervalMin: number;
  snoozeUntil?: string | null;
}): number | null {
  if (opts.snoozeUntil) {
    const s = new Date(opts.snoozeUntil).getTime() - opts.now.getTime();
    if (s > 0) return s;
  }
  const anchor = reminderAnchor(opts);
  if (!anchor) return null;
  return new Date(nextDueAt(anchor, opts.intervalMin)).getTime() - opts.now.getTime();
}

/** «2:15», «0:08», «пора». */
export function formatCountdown(ms: number | null): string {
  if (ms == null) return '—';
  if (ms <= 0) return 'пора';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function snoozeUntil(now: Date, intervalMin: number): string {
  return new Date(now.getTime() + normalizeReminderInterval(intervalMin) * 60_000).toISOString();
}
