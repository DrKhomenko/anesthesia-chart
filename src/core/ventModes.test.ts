import { describe, it, expect } from 'vitest';
import { DEFAULT_VENT_MODES, modesForPicker, ventModesOf } from './ventModes';
import { carryPreviousIntoDraft, entryDraftToPatch, entryFieldByKey, entryFieldOrder, previousWithInductionMode } from './quickEntry';

describe('ventModes catalog', () => {
  it('по умолчанию — Спонтанно, PCV, VCV, SIMV, PSV, без выдуманных доз', () => {
    expect(ventModesOf(undefined)).toEqual(['Спонтанно', 'PCV', 'VCV', 'SIMV', 'PSV']);
    expect([...DEFAULT_VENT_MODES]).toEqual(ventModesOf(undefined));
    expect(ventModesOf([])).toEqual([]);
    expect(ventModesOf(['  PCV  ', 'VCV'])).toEqual(['PCV', 'VCV']);
  });
  it('значение не из списка остаётся доступным в выборе', () => {
    expect(modesForPicker(['PCV', 'VCV'], 'Спонт.')).toEqual(['Спонт.', 'PCV', 'VCV']);
    expect(modesForPicker(['PCV'], 'PCV')).toEqual(['PCV']);
    expect(modesForPicker(['PCV'], '')).toEqual(['PCV']);
  });
});

describe('ventMode in quick entry', () => {
  it('режим всегда в списке минуты, рядом с параметрами аппарата, как enum', () => {
    const keys = entryFieldOrder({ gas: 'sevo' }).map(f => f.key);
    expect(keys).toContain('ventMode');
    expect(keys.indexOf('ventMode')).toBeLessThan(keys.indexOf('fio2'));
    const f = entryFieldOrder({ ventModes: ['Спонтанно', 'PCV'] }).find(x => x.key === 'ventMode')!;
    expect(f.kind).toBe('enum');
    expect(f.enumValues).toEqual(['Спонтанно', 'PCV']);
    expect(entryFieldByKey('ventMode')?.label).toBe('Режим');
  });

  it('нетронутый режим переносится из прошлой записи; очистка не переносит', () => {
    const fields = [entryFieldByKey('hr')!, { ...entryFieldByKey('ventMode')!, enumValues: ['PCV', 'VCV'] }];
    const prev = { hr: 90, ventMode: 'PCV' };
    const patch = entryDraftToPatch({ hr: '', ventMode: '' }, fields, { previous: prev, touch: {} });
    expect(patch).toMatchObject({ hr: 90, ventMode: 'PCV' });
    const cleared = entryDraftToPatch({ hr: '', ventMode: '' }, fields, {
      previous: prev, touch: { ventMode: 'cleared' },
    });
    expect(cleared.ventMode).toBeUndefined();
    expect(cleared.hr).toBe(90);
  });

  it('первая запись без прошлого тика берёт режим из индукции', () => {
    const prev = previousWithInductionMode(null, 'PCV');
    expect(prev).toEqual({ ventMode: 'PCV' });
    const fields = entryFieldOrder({ gas: 'sevo', ventModes: [...DEFAULT_VENT_MODES] });
    const patch = entryDraftToPatch({}, fields, { previous: prev, touch: {} });
    expect(patch.ventMode).toBe('PCV');
    expect(previousWithInductionMode(null, '  ')).toBeNull();
  });

  it('если в прошлой минуте режим пуст — подставляется режим индукции, остальные поля не затираются', () => {
    const prev = previousWithInductionMode({ hr: 88, spo2: 97, ventMode: null }, 'VCV');
    expect(prev).toMatchObject({ hr: 88, spo2: 97, ventMode: 'VCV' });
    const kept = previousWithInductionMode({ hr: 88, ventMode: 'SIMV' }, 'PCV');
    expect(kept).toMatchObject({ hr: 88, ventMode: 'SIMV' });
  });

  it('carryPreviousIntoDraft заполняет ventMode', () => {
    const fields = [{ ...entryFieldByKey('ventMode')!, enumValues: ['PCV'] }];
    expect(carryPreviousIntoDraft({ ventMode: '' }, fields, { ventMode: 'Спонтанно' }, {})).toEqual({ ventMode: 'Спонтанно' });
  });
});
