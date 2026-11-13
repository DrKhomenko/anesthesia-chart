import { describe, it, expect } from 'vitest';
import { errorText, stepError, withTimeout } from './errorText';

describe('errorText', () => {
  it('берёт message у Error', () => {
    expect(errorText(new Error('нет canvas'))).toBe('нет canvas');
  });
  it('строку оставляет как есть — как worker.onerror у tesseract.js', () => {
    expect(errorText('Script error.')).toBe('Script error.');
  });
  it('объект с message (отклонение воркера, не Error)', () => {
    expect(errorText({ message: 'Network error while fetching x' })).toBe('Network error while fetching x');
  });
  it('DOMException-подобный объект без прототипа Error', () => {
    expect(errorText({ name: 'QuotaExceededError', message: 'The quota has been exceeded.' }))
      .toBe('The quota has been exceeded.');
  });
  it('пустые и неизвестные значения', () => {
    expect(errorText(null)).toBe('неизвестная ошибка');
    expect(errorText({})).toBe('неизвестная ошибка');
  });
});

describe('stepError', () => {
  it('добавляет имя шага', () => {
    expect(stepError('выравнивание', 'нет canvas').message).toBe('выравнивание: нет canvas');
  });
  it('не дублирует шаг', () => {
    expect(stepError('распознавание', new Error('распознавание: таймаут')).message)
      .toBe('распознавание: таймаут');
  });
});

describe('withTimeout', () => {
  it('отклоняет по таймеру', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, 'превышено время ожидания'))
      .rejects.toThrow('превышено время ожидания');
  });
  it('пропускает успех', async () => {
    await expect(withTimeout(Promise.resolve(7), 50, 't')).resolves.toBe(7);
  });
});
