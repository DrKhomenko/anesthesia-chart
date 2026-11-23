import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REMINDER_INTERVAL_MIN, formatCountdown, isReminderDue, lastVitalsAt,
  msUntilDue, nextDueAt, normalizeReminderInterval, reminderActive, reminderAnchor, snoozeUntil,
} from './reminder';

const t = (iso: string) => new Date(iso);

describe('normalizeReminderInterval', () => {
  it('по умолчанию 5 минут, рамка 1–60', () => {
    expect(normalizeReminderInterval(undefined)).toBe(DEFAULT_REMINDER_INTERVAL_MIN);
    expect(normalizeReminderInterval('')).toBe(5);
    expect(normalizeReminderInterval(5)).toBe(5);
    expect(normalizeReminderInterval('7,4')).toBe(7);
    expect(normalizeReminderInterval(0)).toBe(1);
    expect(normalizeReminderInterval(99)).toBe(60);
  });
});

describe('reminderActive', () => {
  const base = { enabled: true, stage: 'maintenance' as const, anesthesiaStartAt: '2026-11-23T10:00:00.000Z' };
  it('включено на поддержании и пробуждении, пока анестезия не окончена', () => {
    expect(reminderActive(base)).toBe(true);
    expect(reminderActive({ ...base, stage: 'recovery' })).toBe(true);
    expect(reminderActive({ ...base, stage: 'induction' })).toBe(false);
    expect(reminderActive({ ...base, enabled: false })).toBe(false);
    expect(reminderActive({ ...base, stage: 'closed' })).toBe(false);
    expect(reminderActive({ ...base, isLocked: true })).toBe(false);
    expect(reminderActive({ ...base, anesthesiaEndAt: '2026-11-23T11:00:00.000Z' })).toBe(false);
  });
});

describe('anchor and due', () => {
  const last = '2026-11-23T10:00:00.000Z';
  it('отсчёт от последней записи, иначе от начала анестезии', () => {
    expect(reminderAnchor({ lastVitalsAt: last, anesthesiaStartAt: '2026-11-23T09:00:00.000Z' })).toBe(last);
    expect(reminderAnchor({ lastVitalsAt: null, anesthesiaStartAt: '2026-11-23T09:00:00.000Z' })).toBe('2026-11-23T09:00:00.000Z');
    expect(reminderAnchor({ lastVitalsAt: null, fallbackAt: '2026-11-23T10:05:00.000Z' })).toBe('2026-11-23T10:05:00.000Z');
    expect(lastVitalsAt([
      { at: '2026-11-23T10:00:00.000Z' },
      { at: '2026-11-23T10:10:00.000Z', deletedAt: 'x' },
      { at: '2026-11-23T10:05:00.000Z' },
    ])).toBe('2026-11-23T10:05:00.000Z');
  });
  it('через 5 минут после записи — пора, раньше — нет', () => {
    expect(nextDueAt(last, 5)).toBe('2026-11-23T10:05:00.000Z');
    expect(isReminderDue({ now: t('2026-11-23T10:04:59.000Z'), lastVitalsAt: last, intervalMin: 5 })).toBe(false);
    expect(isReminderDue({ now: t('2026-11-23T10:05:00.000Z'), lastVitalsAt: last, intervalMin: 5 })).toBe(true);
    expect(isReminderDue({ now: t('2026-11-23T10:12:00.000Z'), lastVitalsAt: last, intervalMin: 5 })).toBe(true);
    expect(msUntilDue({ now: t('2026-11-23T10:03:00.000Z'), lastVitalsAt: last, intervalMin: 5 })).toBe(2 * 60_000);
    expect(formatCountdown(135_000)).toBe('2:15');
    expect(formatCountdown(0)).toBe('пора');
    expect(formatCountdown(-1)).toBe('пора');
  });
  it('без записей отсчёт от начала анестезии', () => {
    expect(isReminderDue({
      now: t('2026-11-23T10:05:00.000Z'), lastVitalsAt: null,
      anesthesiaStartAt: '2026-11-23T10:00:00.000Z', intervalMin: 5,
    })).toBe(true);
    expect(isReminderDue({
      now: t('2026-11-23T10:04:00.000Z'), lastVitalsAt: null,
      anesthesiaStartAt: '2026-11-23T10:00:00.000Z', intervalMin: 5,
    })).toBe(false);
  });
  it('«позже» откладывает на тот же интервал', () => {
    const until = snoozeUntil(t('2026-11-23T10:06:00.000Z'), 5);
    expect(until).toBe('2026-11-23T10:11:00.000Z');
    expect(isReminderDue({ now: t('2026-11-23T10:10:00.000Z'), lastVitalsAt: last, intervalMin: 5, snoozeUntil: until })).toBe(false);
    expect(isReminderDue({ now: t('2026-11-23T10:11:00.000Z'), lastVitalsAt: last, intervalMin: 5, snoozeUntil: until })).toBe(true);
  });
});
