import { describe, it, expect } from 'vitest';
import { newCase } from '../db/db';
import { parseDictation } from './dictation';
import { casePatchFor, defaultPhase, drugAdminNote, hasNoDoseFlag, voiceValuesToTickPatch } from './dictationApply';

const AT = '2026-11-26T10:42:00.000Z';
const BARSIK = 'на столе Барсик, семь лет, поступил на удаление новообразования. Я ввёл цефтриаксон, дал залетил, интубировал трубкой 6.0';

describe('casePatchFor', () => {
  it('Барсик: кличка, возраст, операция, интубация со временем и трубкой', () => {
    const c = newCase();
    const { patch, replaces } = casePatchFor(c, parseDictation(BARSIK).items, AT);
    expect(patch).toMatchObject({ patientName: 'Барсик', ageText: '7 лет', operation: 'Удаление новообразования' });
    expect(patch.induction).toMatchObject({ ettSizeMm: '6,0', intubatedAt: AT });
    expect(replaces).toEqual({});
  });
  it('препараты в поля карты не попадают, вес и владелец не трогаются', () => {
    const c = newCase();
    const { patch } = casePatchFor(c, parseDictation('ввёл залетил').items, AT);
    expect(patch).toEqual({});
    const full = casePatchFor(c, parseDictation(BARSIK).items, AT).patch;
    expect(Object.keys(full).sort()).toEqual(['ageText', 'induction', 'operation', 'patientName']);
  });
  it('уже заполненное помечается «заменит», пустое — нет', () => {
    const c = { ...newCase(), patientName: 'Мурка', ageText: '' };
    const items = parseDictation('на столе Барсик, 7 лет').items;
    const { replaces } = casePatchFor(c, items, AT);
    expect(replaces[0]).toBe('Мурка');
    expect(replaces[1]).toBeUndefined();
  });
  it('та же кличка — не замена', () => {
    const c = { ...newCase(), patientName: 'Барсик' };
    expect(casePatchFor(c, parseDictation('на столе Барсик').items, AT).replaces).toEqual({});
  });
  it('повторная интубация: помечается время прежней', () => {
    const c = { ...newCase(), induction: { intubatedAt: '2026-11-26T09:00:00.000Z' } };
    const { replaces } = casePatchFor(c, parseDictation('интубировал').items, AT);
    expect(replaces[0]).toMatch(/интубация \d\d:\d\d/);
  });
  it('события времени ложатся в свои поля', () => {
    const c = newCase();
    const { patch } = casePatchFor(c, parseDictation('ввели в наркоз, начали операцию, операция закончена, выключил газ, экстубировал').items, AT);
    expect(patch).toMatchObject({ anesthesiaStartAt: AT, surgeryStartAt: AT, surgeryEndAt: AT, anesthesiaEndAt: AT });
    expect(patch.recovery?.extubatedAt).toBe(AT);
  });
  it('катетер дописывается в заметки к индукции, не затирая прежние', () => {
    const c = { ...newCase(), induction: { notes: 'мордочка чистая' } };
    const { patch } = casePatchFor(c, parseDictation('поставил катетер').items, AT);
    expect(patch.induction?.notes).toMatch(/^мордочка чистая\n\d\d:\d\d — катетер установлен$/);
  });
  it('исходная карта не меняется', () => {
    const c = newCase();
    const before = JSON.stringify(c);
    casePatchFor(c, parseDictation(BARSIK).items, AT);
    expect(JSON.stringify(c)).toBe(before);
  });
  it('вид: кошка → cat', () => {
    expect(casePatchFor(newCase(), parseDictation('на столе кошка Мурка').items, AT).patch).toMatchObject({ species: 'cat', patientName: 'Мурка' });
  });
});

describe('defaultPhase', () => {
  it('интубация в той же фразе → индукция, экстубация → пробуждение, иначе по этапу', () => {
    expect(defaultPhase('maintenance', parseDictation('залетил, интубировал').items)).toBe('induction');
    expect(defaultPhase('maintenance', parseDictation('атропин, экстубировал').items)).toBe('recovery');
    expect(defaultPhase('maintenance', parseDictation('атропин').items)).toBe('maintenance');
    expect(defaultPhase('header', parseDictation('атропин').items)).toBe('premed');
    expect(defaultPhase('induction', [])).toBe('induction');
  });
});

describe('drugAdminNote / метка «доза не указана»', () => {
  const d = (s: string) => parseDictation(s).items.find(i => i.kind === 'drug') as Extract<ReturnType<typeof parseDictation>['items'][number], { kind: 'drug' }>;
  it('без дозы — метка; с дозой и путём — нет', () => {
    const n1 = drugAdminNote(d('ввёл цефтриаксон'));
    expect(n1).toBe('доза не указана; путь не указан (голосом)');
    expect(hasNoDoseFlag({ doseValue: '', note: n1 })).toBe(true);
    expect(hasNoDoseFlag({ doseValue: '20', note: n1 })).toBe(false);
    const n2 = drugAdminNote(d('ввёл цефтриаксон 20 мг на кг в/в'));
    expect(n2).toBe('голосом');
    expect(hasNoDoseFlag({ doseValue: '20', note: n2 })).toBe(false);
  });
  it('назван объём — пишется, что доза в мг/кг не указана', () => {
    expect(drugAdminNote(d('залетил 0,5 мл в/м'))).toBe('доза не указана в мг/кг (назван объём 0,5 мл) (голосом)');
  });
});

describe('voiceValuesToTickPatch', () => {
  it('поля формы → поля записи минуты, числа с запятой', () => {
    expect(voiceValuesToTickPatch({ hr: '120', nibpSys: '120', nibpDia: '80', sevoPct: '2,1', ventMode: 'PCV' }, false))
      .toEqual({ hr: 120, sys: 120, dia: 80, sevoPct: 2.1, ventMode: 'PCV' });
  });
  it('МАД только если назвали явно', () => {
    expect(voiceValuesToTickPatch({ nibpMap: '90' }, true)).toEqual({ map: 90, mapManual: true });
  });
});
