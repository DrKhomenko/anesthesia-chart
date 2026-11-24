import { describe, it, expect } from 'vitest';
import {
  defaultBlockTimerTitle, dueAtFrom, formatInterval, formatTimerCountdown, isTimerDue,
  liveTimers, overdueMinutes, parseIntervalMin, restartRepeat, shouldStopOnAnesthesiaEnd,
  snoozeTimer, stopTimer, timerBannerTitle,
} from './timers';

const t0 = '2026-11-24T12:00:00.000Z';

function timer(p: Partial<Parameters<typeof isTimerDue>[0]> = {}) {
  return {
    id: 't1', kind: 'repeat' as const, title: 'Цефазолин', intervalMin: 45,
    dueAt: dueAtFrom(t0, 45), startedAt: t0, status: 'running' as const, ...p,
  };
}

describe('parseIntervalMin', () => {
  it('минуты и часы, пустое — null, не выдумывает', () => {
    expect(parseIntervalMin('45')).toBe(45);
    expect(parseIntervalMin('1,5', 'h')).toBe(90);
    expect(parseIntervalMin(1.5, 'h')).toBe(90);
    expect(parseIntervalMin('')).toBeNull();
    expect(parseIntervalMin(null)).toBeNull();
    expect(parseIntervalMin(0)).toBeNull();
    expect(parseIntervalMin('-10')).toBeNull();
  });
  it('подписи интервалов', () => {
    expect(formatInterval(45)).toBe('45 мин');
    expect(formatInterval(60)).toBe('1 ч');
    expect(formatInterval(90)).toBe('1,5 ч');
    expect(formatInterval(null)).toBe('—');
  });
});

describe('due and overdue', () => {
  it('отсчёт от времени введения: due через интервал', () => {
    expect(dueAtFrom(t0, 45)).toBe('2026-11-24T12:45:00.000Z');
    const t = timer();
    expect(isTimerDue(t, new Date('2026-11-24T12:44:59.000Z'))).toBe(false);
    expect(isTimerDue(t, new Date('2026-11-24T12:45:00.000Z'))).toBe(true);
  });
  it('если страница была закрыта и время вышло — сразу просрочено', () => {
    const t = timer();
    const now = new Date('2026-11-24T12:53:00.000Z');
    expect(isTimerDue(t, now)).toBe(true);
    expect(overdueMinutes(t.dueAt, now)).toBe(8);
    expect(formatTimerCountdown(t.dueAt, now)).toBe('просрочено на 8 мин');
    expect(formatTimerCountdown(t.dueAt, new Date('2026-11-24T12:45:10.000Z'))).toBe('пора');
    expect(formatTimerCountdown(t.dueAt, new Date('2026-11-24T12:40:00.000Z'))).toBe('5:00');
  });
  it('остановленный не срабатывает', () => {
    const t = stopTimer(timer(), '2026-11-24T12:10:00.000Z');
    expect(isTimerDue(t, new Date('2026-11-24T13:00:00.000Z'))).toBe(false);
    expect(liveTimers([t, timer({ id: 't2' })]).map(x => x.id)).toEqual(['t2']);
  });
});

describe('restart, snooze, stop', () => {
  it('перезапуск после «Ввёл» считает новый интервал от сейчас', () => {
    const now = '2026-11-24T13:00:00.000Z';
    const next = restartRepeat(timer(), now, { drugAdminId: 'a2' });
    expect(next.dueAt).toBe('2026-11-24T13:45:00.000Z');
    expect(next.status).toBe('running');
    expect(next.drugAdminId).toBe('a2');
    expect(isTimerDue(next, new Date(now))).toBe(false);
  });
  it('+5 мин отсчитывает от сейчас, если уже просрочен', () => {
    const now = '2026-11-24T13:00:00.000Z';
    const next = snoozeTimer(timer(), now, 5);
    expect(next.dueAt).toBe('2026-11-24T13:05:00.000Z');
    expect(next.status).toBe('running');
  });
  it('остановка и конец анестезии', () => {
    const t = stopTimer(timer(), t0);
    expect(t.status).toBe('stopped');
    expect(t.stoppedAt).toBe(t0);
    expect(shouldStopOnAnesthesiaEnd({ anesthesiaEndAt: t0 })).toBe(true);
    expect(shouldStopOnAnesthesiaEnd({ stage: 'closed' })).toBe(true);
    expect(shouldStopOnAnesthesiaEnd({ stage: 'maintenance', anesthesiaEndAt: null })).toBe(false);
  });
});

describe('titles', () => {
  it('баннер препарата и блокады', () => {
    expect(timerBannerTitle(timer())).toBe('Цефазолин — пора');
    expect(timerBannerTitle(timer({ kind: 'once', title: 'TAP — оценить блок' }))).toBe('TAP — оценить блок');
    expect(defaultBlockTimerTitle('TAP')).toBe('TAP — оценить блок');
    expect(defaultBlockTimerTitle('')).toBe('Оценить блок');
  });
});
