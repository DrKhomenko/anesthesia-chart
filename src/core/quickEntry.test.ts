import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENTRY_KEYS, applyKeypad, copyAllPrevious, copyPreviousValue,
  emptyDraft, entryDraftToPatch, entryFieldByKey, entryFieldOrder,
  formatPrevious, isEntryOutOfRange, machineEntryKeys, monitorEntryKeys,
  previousTick, previousValueForKey, syncDraftMap, withGasField,
} from './quickEntry';
import { MONITOR_FIELDS, MACHINE_FIELDS } from './devices';

describe('entryFieldOrder', () => {
  it('по умолчанию: ЧСС, SpO₂, EtCO₂, ЧДД, T, АД сист/диаст/ср, Sevo/Iso, FiO₂, Pпик, VT', () => {
    expect(entryFieldOrder().map(f => f.key)).toEqual([...DEFAULT_ENTRY_KEYS]);
    expect(entryFieldOrder().map(f => f.label)).toEqual([
      'ЧСС', 'SpO₂', 'EtCO₂', 'ЧДД', 'T',
      'АД сист', 'АД диаст', 'АД ср',
      'Sevo', 'Iso',
      'FiO₂', 'Pпик', 'VT',
    ]);
  });

  it('шаблон включает и выключает поля минуты; лишние поля шаблона не добавляются', () => {
    const keys = entryFieldOrder({
      monitorFieldKeys: ['spo2', 'hr', 'pr', 'etco2'],
      machineFieldKeys: ['pPeak', 'ventMode', 'fio2'],
    }).map(f => f.key);
    expect(keys).toEqual(['hr', 'spo2', 'etco2', 'sevoPct', 'isoPct', 'fio2', 'pPeak']);
    expect(keys).not.toContain('pr');
    expect(keys).not.toContain('ventMode');
  });

  it('выключенное в шаблоне поле не попадает в список, Sevo и Iso всегда есть', () => {
    const keys = entryFieldOrder({
      monitorFieldKeys: ['hr', 'spo2'],
      machineFieldKeys: ['vtInsp'],
    }).map(f => f.key);
    expect(keys).toEqual(['hr', 'spo2', 'sevoPct', 'isoPct', 'vtInsp']);
    expect(keys).not.toContain('etco2');
    expect(keys).not.toContain('fio2');
  });

  it('t2 из шаблона монитора становится полем T; одного датчика достаточно', () => {
    const onlyT2 = entryFieldOrder({ monitorFieldKeys: ['hr', 't2'], machineFieldKeys: [] }).map(f => f.key);
    expect(onlyT2).toEqual(['hr', 'tempC', 'sevoPct', 'isoPct']);
    const both = entryFieldOrder({ monitorFieldKeys: ['t1', 't2', 'hr'], machineFieldKeys: [] }).map(f => f.key);
    expect(both).toEqual(['hr', 'tempC', 'sevoPct', 'isoPct']);
    const onlyT1 = monitorEntryKeys(['t1', 'hr']);
    expect(onlyT1).toEqual(['tempC', 'hr']);
    const noTemp = entryFieldOrder({ monitorFieldKeys: ['hr'], machineFieldKeys: [] }).map(f => f.key);
    expect(noTemp).not.toContain('tempC');
  });

  it('machineEntryKeys без шаблона — FiO₂, Pпик, VT', () => {
    expect(machineEntryKeys()).toEqual(['fio2', 'pPeak', 'vtInsp']);
  });
});

describe('copy-previous', () => {
  const prev = { hr: 142, spo2: 98, etco2: 38, sys: 110, dia: 70, map: 85, tempC: 37.6, sevoPct: 2.5, fio2: 72 };

  it('как прошлый: одно поле, АД и T берутся из sys/tempC', () => {
    expect(previousValueForKey(prev, 'hr')).toBe(142);
    expect(previousValueForKey(prev, 'nibpSys')).toBe(110);
    expect(previousValueForKey(prev, 'tempC')).toBe(37.6);
    expect(formatPrevious({ t2: 38.2 }, 'tempC')).toBe('38,2');
    const draft = copyPreviousValue({ hr: '' }, 'hr', prev);
    expect(draft.hr).toBe('142');
  });

  it('все как прошлый заполняет только пустые поля', () => {
    const keys = ['hr', 'spo2', 'etco2', 'sevoPct'];
    const next = copyAllPrevious({ hr: '150', spo2: '', etco2: '  ', sevoPct: '' }, keys, prev);
    expect(next).toEqual({ hr: '150', spo2: '98', etco2: '38', sevoPct: '2,5' });
  });

  it('нет прошлого значения — черновик не меняется', () => {
    expect(copyPreviousValue({ hr: '' }, 'hr', {})).toEqual({ hr: '' });
    expect(copyAllPrevious({ hr: '' }, ['hr'], null)).toEqual({ hr: '' });
  });

  it('previousTick: ближайшая запись не позже выбранного времени', () => {
    const ticks = [
      { id: 'a', at: '2026-11-23T10:00:00.000Z' },
      { id: 'b', at: '2026-11-23T10:05:00.000Z' },
      { id: 'c', at: '2026-11-23T10:10:00.000Z', deletedAt: 'x' },
    ];
    expect(previousTick(ticks, '2026-11-23T10:07:00.000Z')?.id).toBe('b');
    expect(previousTick(ticks, '2026-11-23T10:05:00.000Z')?.id).toBe('b');
    expect(previousTick(ticks, '2026-11-23T10:20:00.000Z')?.id).toBe('b');
    expect(previousTick(ticks, '2026-11-23T09:00:00.000Z')).toBeUndefined();
    expect(previousTick([], '2026-11-23T10:00:00.000Z')).toBeUndefined();
  });
});

describe('keypad', () => {
  it('цифры, забой, запятая, без второго разделителя', () => {
    expect(applyKeypad('', '3', false)).toBe('3');
    expect(applyKeypad('3', '8', false)).toBe('38');
    expect(applyKeypad('38', '⌫', false)).toBe('3');
    expect(applyKeypad('3', ',', true)).toBe('3,');
    expect(applyKeypad('3,', '2', true)).toBe('3,2');
    expect(applyKeypad('3,2', '.', true)).toBe('3,2');
    expect(applyKeypad('', ',', true)).toBe('0,');
    expect(applyKeypad('5', ',', false)).toBe('5');
  });
  it('ведущий ноль заменяется, 0,5 сохраняется', () => {
    expect(applyKeypad('0', '5', false)).toBe('5');
    expect(applyKeypad('0,', '5', true)).toBe('0,5');
  });
});

describe('save patch', () => {
  const fields = entryFieldOrder();

  it('переносит АД в sys/dia/map, T в tempC и t2, VT ещё и в tidalVolume', () => {
    const draft = {
      ...emptyDraft(fields),
      hr: '142', spo2: '98', nibpSys: '110', nibpDia: '70', nibpMap: '83',
      tempC: '37,6', sevoPct: '2,5', vtInsp: '45', fio2: '72',
    };
    const patch = entryDraftToPatch(draft, fields);
    expect(patch).toMatchObject({
      hr: 142, spo2: 98, sys: 110, dia: 70, map: 83, mapManual: false,
      tempC: 37.6, t2: 37.6, sevoPct: 2.5, vtInsp: 45, tidalVolume: 45, fio2: 72,
    });
    expect(patch).not.toHaveProperty('nibpSys');
    expect(patch.etco2).toBeUndefined();
    expect(patch.isoPct).toBeUndefined();
  });

  it('пустой черновик не даёт полей — до Готово писать нечего', () => {
    expect(entryDraftToPatch(emptyDraft(fields), fields)).toEqual({});
  });

  it('значение вне рамки подсвечивается, но в патч всё равно попадает', () => {
    const spo2 = entryFieldByKey('spo2')!;
    expect(isEntryOutOfRange(spo2, '40')).toBe(true);
    expect(isEntryOutOfRange(spo2, '98')).toBe(false);
    expect(isEntryOutOfRange(spo2, '')).toBe(false);
    const patch = entryDraftToPatch({ spo2: '40' }, [spo2]);
    expect(patch.spo2).toBe(40);
  });
});

describe('catalog coverage', () => {
  it('для каждого ключа шаблонов есть описание поля ввода', () => {
    for (const f of [...MONITOR_FIELDS, ...MACHINE_FIELDS]) {
      expect(entryFieldByKey(f.key)?.key, f.key).toBe(f.key);
    }
  });
});

describe('auto MAP in draft', () => {
  it('пустые САД+ДАД заполняют МАД, ручной не трогает', () => {
    const a = syncDraftMap({ nibpSys: '110', nibpDia: '70', nibpMap: '' }, false);
    expect(a.nibpMap).toBe('83');
    const kept = syncDraftMap({ nibpSys: '110', nibpDia: '70', nibpMap: '85' }, true);
    expect(kept.nibpMap).toBe('85');
    const cleared = syncDraftMap({ nibpSys: '110', nibpDia: '', nibpMap: '83' }, false);
    expect(cleared.nibpMap).toBe('');
  });
  it('патч без введённого МАД всё равно пишет расчёт; ручной сохраняет число монитора', () => {
    const fields = [entryFieldByKey('nibpSys')!, entryFieldByKey('nibpDia')!, entryFieldByKey('nibpMap')!];
    const auto = entryDraftToPatch({ nibpSys: '110', nibpDia: '70', nibpMap: '' }, fields, { mapManual: false });
    expect(auto).toMatchObject({ sys: 110, dia: 70, map: 83, mapManual: false });
    const man = entryDraftToPatch({ nibpSys: '110', nibpDia: '70', nibpMap: '85' }, fields, { mapManual: true });
    expect(man).toMatchObject({ sys: 110, dia: 70, map: 85, mapManual: true });
  });
  it('рамка МАД работает на расчётном значении', () => {
    const f = entryFieldByKey('nibpMap')!;
    const raw = syncDraftMap({ nibpSys: '80', nibpDia: '40', nibpMap: '' }, false).nibpMap;
    expect(raw).toBe('53');
    // рамки поля с шаблона прибора: если заданы, флаг сработает
    expect(isEntryOutOfRange({ ...f, min: 60, max: null }, raw)).toBe(true);
    expect(isEntryOutOfRange({ ...f, min: 60, max: null }, '83')).toBe(false);
  });
});

describe('один газ в минуте', () => {
  it('по газу индукции в списке только Sevo или только Iso, оба — в режиме both', () => {
    expect(entryFieldOrder({ gas: 'sevo' }).map(f => f.key)).toEqual([
      'hr', 'spo2', 'etco2', 'rr', 'tempC', 'nibpSys', 'nibpDia', 'nibpMap', 'sevoPct', 'fio2', 'pPeak', 'vtInsp',
    ]);
    expect(entryFieldOrder({ gas: 'iso' }).map(f => f.key)).toContain('isoPct');
    expect(entryFieldOrder({ gas: 'iso' }).map(f => f.key)).not.toContain('sevoPct');
    expect(entryFieldOrder({ gas: null }).map(f => f.key)).not.toContain('sevoPct');
    expect(entryFieldOrder({ gas: null }).map(f => f.key)).not.toContain('isoPct');
    expect(entryFieldOrder().map(f => f.key)).toContain('sevoPct');
    expect(entryFieldOrder().map(f => f.key)).toContain('isoPct');
  });
  it('withGasField меняет поле газа, остальные на месте', () => {
    const sevo = entryFieldOrder({ gas: 'sevo' });
    const iso = withGasField(sevo, 'iso');
    expect(iso.map(f => f.key)).toContain('isoPct');
    expect(iso.map(f => f.key)).not.toContain('sevoPct');
    expect(iso.map(f => f.key).filter(k => k !== 'isoPct')).toEqual(sevo.map(f => f.key).filter(k => k !== 'sevoPct'));
  });
});
