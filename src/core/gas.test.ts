import { describe, it, expect } from 'vitest';
import { formatTickGas, gasColumnLabel, normalizeDefaultGas, resolveCaseGas } from './gas';

describe('resolveCaseGas', () => {
  it('сначала смена в карте, затем индукция, затем настройка', () => {
    expect(resolveCaseGas({ inductionGas: 'sevo', defaultGas: 'iso' })).toBe('sevo');
    expect(resolveCaseGas({ inductionGas: 'iso', defaultGas: 'sevo' })).toBe('iso');
    expect(resolveCaseGas({ maintenanceGas: 'iso', inductionGas: 'sevo', defaultGas: 'sevo' })).toBe('iso');
    expect(resolveCaseGas({ inductionGas: '', defaultGas: 'iso' })).toBe('iso');
    expect(resolveCaseGas({ inductionGas: '', defaultGas: 'ask' })).toBeNull();
    expect(resolveCaseGas({})).toBeNull();
    expect(normalizeDefaultGas('sevo')).toBe('sevo');
    expect(normalizeDefaultGas('нет')).toBe('ask');
  });
});

describe('format and column', () => {
  const fmt = (n: number, d = 0) => n.toFixed(d).replace('.', ',');
  it('старая запись с обоими газами не теряется', () => {
    expect(formatTickGas({ sevoPct: 2.2, isoPct: 1.5 }, fmt)).toBe('Sevo 2,2 / Iso 1,5');
    expect(formatTickGas({ sevoPct: 2.2 }, fmt)).toBe('Sevo 2,2');
    expect(formatTickGas({}, fmt)).toBe('—');
  });
  it('заголовок колонки: один газ или «Газ», если в истории оба', () => {
    expect(gasColumnLabel([{ sevoPct: 2.2 }, { sevoPct: 2.0 }], 'sevo')).toBe('Sevo');
    expect(gasColumnLabel([{ sevoPct: 2.2 }, { isoPct: 1 }], 'sevo')).toBe('Газ');
    expect(gasColumnLabel([], 'iso')).toBe('Iso');
    expect(gasColumnLabel([], null)).toBe('Газ');
  });
});
