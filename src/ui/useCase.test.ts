import { describe, it, expect, beforeEach } from 'vitest';
import { flushOpenCase, setCaseFlusher } from './useCase';

describe('flushOpenCase', () => {
  beforeEach(() => setCaseFlusher(null));

  it('без открытой карты ничего не делает', async () => {
    await expect(flushOpenCase()).resolves.toBeUndefined();
  });

  it('вызывает зарегистрированный сброс черновика', async () => {
    const calls: string[] = [];
    setCaseFlusher(async () => { calls.push('flush'); });
    await flushOpenCase();
    expect(calls).toEqual(['flush']);
  });

  it('после снятия регистратора больше не вызывает', async () => {
    let n = 0;
    setCaseFlusher(async () => { n += 1; });
    setCaseFlusher(null);
    await flushOpenCase();
    expect(n).toBe(0);
  });
});
