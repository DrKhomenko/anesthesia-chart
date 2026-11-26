import { describe, it, expect } from 'vitest';
import { DICTATION_DICT, buildDrugEntries, consumeDoseNumber, itemFlags, itemTitle, parseDictation, type DictItem } from './dictation';
import { parseVoiceInput } from './voiceParse';
import { DEFAULT_ENTRY_KEYS } from './quickEntry';

const BARSIK = 'на столе Барсик, семь лет, поступил на удаление новообразования. Я ввёл цефтриаксон, дал залетил, интубировал трубкой 6.0';
const drugs = (items: DictItem[]) => items.filter((i): i is Extract<DictItem, { kind: 'drug' }> => i.kind === 'drug');
const patient = (items: DictItem[], field: string) => items.find(i => i.kind === 'patient' && i.field === field) as Extract<DictItem, { kind: 'patient' }> | undefined;

describe('диктовка: пример с Барсиком', () => {
  const r = parseDictation(BARSIK);
  it('поля пациента: кличка, возраст, операция', () => {
    expect(patient(r.items, 'patientName')?.value).toBe('Барсик');
    expect(patient(r.items, 'ageText')?.value).toBe('7 лет');
    expect(patient(r.items, 'operation')?.value).toBe('Удаление новообразования');
  });
  it('препараты по порядку: цефтриаксон, золетил (залетил → Золетил)', () => {
    expect(drugs(r.items).map(d => d.name)).toEqual(['Цефтриаксон', 'Золетил']);
  });
  it('дозы нет — её нет в записи, стоит пометка', () => {
    for (const d of drugs(r.items)) {
      expect(d.doseValue).toBeUndefined();
      expect(d.volumeMl).toBeUndefined();
      expect(d.route).toBeUndefined();
      expect(itemFlags(d)).toContain('доза не указана');
    }
  });
  it('интубация с трубкой 6,0', () => {
    const i = r.items.find(x => x.kind === 'intubation');
    expect(i).toMatchObject({ kind: 'intubation', ettMm: '6,0' });
  });
  it('ничего лишнего не уходит в «не понял» и в показатели', () => {
    expect(r.rest).toBe('');
  });
  it('то же без знаков препинания и со словами вместо цифр', () => {
    const r2 = parseDictation('на столе лежит барсик семь лет поступил на удаление новообразования я ввел цефтриаксон дал залетил интубировал трубкой шесть ноль');
    expect(patient(r2.items, 'patientName')?.value).toBe('Барсик');
    expect(patient(r2.items, 'operation')?.value).toBe('Удаление новообразования');
    expect(drugs(r2.items).map(d => d.name)).toEqual(['Цефтриаксон', 'Золетил']);
    expect(r2.items.find(x => x.kind === 'intubation')).toMatchObject({ ettMm: '6,0' });
    expect(r2.rest).toBe('');
  });
});

describe('диктовка: пациент', () => {
  it('«ё» в кличке сохраняется, вид и возраст «два с половиной года»', () => {
    const r = parseDictation('на столе Фёкла, собака, два с половиной года');
    expect(patient(r.items, 'patientName')?.value).toBe('Фёкла');
    expect(patient(r.items, 'species')?.value).toBe('dog');
    expect(patient(r.items, 'ageText')?.value).toBe('2,5 года');
  });
  it('«пациентка Мурка кошка 1 год 3 месяца, поступила на стерилизацию»', () => {
    const r = parseDictation('пациентка Мурка кошка 1 год 3 месяца, поступила на стерилизацию');
    expect(patient(r.items, 'patientName')?.value).toBe('Мурка');
    expect(patient(r.items, 'species')?.value).toBe('cat');
    expect(patient(r.items, 'ageText')?.value).toBe('1 год 3 мес.');
    expect(patient(r.items, 'operation')?.value).toBe('Стерилизацию');
  });
  it('возраст в месяцах и склонение лет/года', () => {
    expect(patient(parseDictation('8 месяцев').items, 'ageText')?.value).toBe('8 мес.');
    expect(patient(parseDictation('три года').items, 'ageText')?.value).toBe('3 года');
    expect(patient(parseDictation('двенадцать лет').items, 'ageText')?.value).toBe('12 лет');
    expect(patient(parseDictation('полтора года').items, 'ageText')?.value).toBe('1,5 года');
  });
  it('операция из «кличка …, операция …» и до «я ввёл»', () => {
    const r = parseDictation('кличка Тоша операция овариогистерэктомия я ввёл атропин');
    expect(patient(r.items, 'patientName')?.value).toBe('Тоша');
    expect(patient(r.items, 'operation')?.value).toBe('Овариогистерэктомия');
    expect(drugs(r.items).map(d => d.name)).toEqual(['Атропин']);
  });
  it('без триггера кличку не угадываем: слово уходит в «не понял»', () => {
    const r = parseDictation('Барсик 7 лет');
    expect(patient(r.items, 'patientName')).toBeUndefined();
    expect(patient(r.items, 'ageText')?.value).toBe('7 лет');
    expect(r.rest).toBe('барсик');
  });
});

describe('диктовка: препараты, доза и путь только если сказаны', () => {
  it('мг/кг и путь', () => {
    const [d] = drugs(parseDictation('залетил 5 миллиграмм на килограмм внутривенно').items);
    expect(d).toMatchObject({ name: 'Золетил', doseValue: '5', doseUnit: 'mg/kg', route: 'в/в' });
    expect(itemFlags(d)).not.toContain('доза не указана');
  });
  it('мкг/кг словами, «ноль пять» = 0,5, а не 5', () => {
    const [d] = drugs(parseDictation('дал дексдомитор ноль пять мкг на кг в мышцу').items);
    expect(d).toMatchObject({ name: 'Дексдомитор', doseValue: '0,5', doseUnit: 'mcg/kg', route: 'в/м' });
  });
  it('объём в мл не превращается в мг/кг', () => {
    const [d] = drugs(parseDictation('залетил 0,5 мл подкожно').items);
    expect(d.volumeMl).toBe('0,5');
    expect(d.doseValue).toBeUndefined();
    expect(itemFlags(d)).toContain('доза не указана в мг/кг');
  });
  it('мг «всего» не пересчитывается в мг/кг', () => {
    const [d] = drugs(parseDictation('пропофол двадцать мг').items);
    expect(d.doseValue).toBeUndefined();
    expect(d.spokenOther).toBe('20 мг (всего)');
    expect(itemFlags(d)[0]).toBe('доза не указана в мг/кг');
  });
  it('число без единицы дозой не считается — уходит в «не понял»', () => {
    const r = parseDictation('ввёл цефтриаксон 500');
    expect(drugs(r.items)[0].doseValue).toBeUndefined();
    expect(r.rest).toBe('500');
  });
  it('доза перед названием и путь перед глаголом', () => {
    const [d] = drugs(parseDictation('внутривенно ввёл 20 мг на кг цефтриаксона').items);
    expect(d).toMatchObject({ name: 'Цефтриаксон', doseValue: '20', route: 'в/в' });
  });
  it('два препарата подряд, у каждого своя доза', () => {
    const ds = drugs(parseDictation('ввёл залетил 5 мг на кг, потом цефтриаксон 20 мг на кг в/в').items);
    expect(ds.map(d => [d.name, d.doseValue, d.route])).toEqual([['Золетил', '5', undefined], ['Цефтриаксон', '20', 'в/в']]);
  });
  it('окончания: цефтриаксона, золетилом, залетила', () => {
    expect(drugs(parseDictation('ввёл цефтриаксона').items)[0].name).toBe('Цефтриаксон');
    expect(drugs(parseDictation('дали золетилом').items)[0].name).toBe('Золетил');
    expect(drugs(parseDictation('дала залетила').items)[0].name).toBe('Золетил');
  });
  it('синонимы: дексмедетомидин → Дексдомитор, маропитант → Церения', () => {
    expect(drugs(parseDictation('дексмедетомидин').items)[0].name).toBe('Дексдомитор');
    expect(drugs(parseDictation('маропитант').items)[0].name).toBe('Церения');
  });
  it('отрицание, аллергия и планы не записываются', () => {
    for (const s of ['аллергия на цефтриаксон', 'не ввёл цефтриаксон', 'будем вводить залетил', 'нужно ввести атропин']) {
      const r = parseDictation(s);
      expect(r.items, s).toEqual([]);
      expect(r.rest.length, s).toBeGreaterThan(0);
    }
  });
  it('отрицание не «протекает» через запятую в следующий препарат', () => {
    const r = parseDictation('аллергии нет, ввёл цефтриаксон');
    expect(drugs(r.items).map(d => d.name)).toEqual(['Цефтриаксон']);
  });
});

describe('диктовка: справочник препаратов приложения', () => {
  const formulary = [
    { id: 'd1', name: 'Золетил 100', genericName: '' },
    { id: 'd2', name: 'Эфир-Х', genericName: 'ксилазин' },
  ];
  it('препарат из справочника подхватывается по id, а не как новый', () => {
    const [d] = drugs(parseDictation('дал залетил', { drugs: formulary }).items);
    expect(d).toMatchObject({ name: 'Золетил 100', drugId: 'd1', isNew: false });
    expect(itemFlags(d)).not.toContain('новый в справочнике, без доз');
  });
  it('препарата нет в справочнике — помечен «новый», без доз и границ', () => {
    const [d] = drugs(parseDictation('ввёл цефтриаксон').items);
    expect(d).toMatchObject({ drugId: null, isNew: true });
    expect(itemFlags(d)).toContain('новый в справочнике, без доз');
  });
  it('собственный препарат клиники находится по названию и по действующему веществу', () => {
    expect(drugs(parseDictation('ввёл эфир-х', { drugs: formulary }).items)[0]).toMatchObject({ drugId: 'd2' });
    expect(drugs(parseDictation('ввёл ксилазин', { drugs: formulary }).items)[0]).toMatchObject({ drugId: 'd2' });
  });
  it('препарат со словом из показателей не путается с показателем', () => {
    const r = parseDictation('сево два', { drugs: [{ id: 'x', name: 'Сево', genericName: '' }] });
    expect(drugs(r.items)).toEqual([]);
    expect(r.rest).toBe('сево два');
  });
  it('в словаре нет опиоидов и кетамина', () => {
    const all = DICTATION_DICT.drugs.flatMap(d => [d.name, ...d.words]).join(' ').toLowerCase();
    for (const bad of ['кетамин', 'морфин', 'фентанил', 'трамадол', 'бутор', 'бупренорфин', 'метадон', 'ketamine', 'fentanyl', 'morphine']) expect(all).not.toContain(bad);
    expect(buildDrugEntries([]).map(e => e.name)).not.toContain('Кетамин');
  });
});

describe('диктовка: интубация и размер трубки', () => {
  const ett = (s: string) => (parseDictation(s).items.find(i => i.kind === 'intubation') as { ettMm?: string } | undefined)?.ettMm;
  it('разные способы сказать 6.0', () => {
    expect(ett('интубировал трубкой 6.0')).toBe('6,0');
    expect(ett('интубировал трубкой 6,0')).toBe('6,0');
    expect(ett('интубировал трубкой шесть ноль')).toBe('6,0');
    expect(ett('интубировал трубкой шесть')).toBe('6,0');
    expect(ett('интубировал шестёркой')).toBe('6,0');
    expect(ett('я интубировал, трубка шесть')).toBe('6,0');
    expect(ett('трубкой 6.0 интубировал')).toBe('6,0');
  });
  it('половинные размеры', () => {
    expect(ett('интубировал трубкой шесть пять')).toBe('6,5');
    expect(ett('интубировал трубкой шесть с половиной')).toBe('6,5');
    expect(ett('интубировал трубкой 7,5')).toBe('7,5');
    expect(ett('интубация трубка размер четыре и пять')).toBe('4,5');
  });
  it('размер не придумывается: сказали «интубировал» — события без размера', () => {
    const i = parseDictation('интубировал').items[0];
    expect(i).toEqual({ kind: 'intubation', raw: 'интубировал' });
    expect(itemTitle(i)).toBe('Интубация');
  });
  it('«шесть, семь лет» — это не 6,7', () => {
    const r = parseDictation('интубировал трубкой шесть семь лет');
    expect(r.items.find(i => i.kind === 'intubation')).toMatchObject({ ettMm: '6,0' });
    expect(patient(r.items, 'ageText')?.value).toBe('7 лет');
  });
  it('«будем интубировать» и «не интубировал» — не событие', () => {
    expect(parseDictation('будем интубировать').items).toEqual([]);
    expect(parseDictation('не интубировал').items).toEqual([]);
  });
  it('трубка без глагола — только размер, время интубации не ставится', () => {
    const r = parseDictation('трубка 7.0');
    expect(r.items).toEqual([{ kind: 'intubation', ettMm: '7,0', sizeOnly: true, raw: 'трубка 7.0' }]);
  });
});

describe('диктовка: события времени', () => {
  const ev = (s: string) => parseDictation(s).items.filter(i => i.kind === 'time').map(i => (i as { event: string }).event);
  it('экстубация, начало и конец операции, конец наркоза, индукция, катетер', () => {
    expect(ev('экстубировал')).toEqual(['extubation']);
    expect(ev('начали операцию')).toEqual(['surgeryStart']);
    expect(ev('сделал разрез')).toEqual(['surgeryStart']);
    expect(ev('операция закончена')).toEqual(['surgeryEnd']);
    expect(ev('конец операции')).toEqual(['surgeryEnd']);
    expect(ev('выключил газ')).toEqual(['anesthesiaEnd']);
    expect(ev('конец наркоза')).toEqual(['anesthesiaEnd']);
    expect(ev('ввели в наркоз')).toEqual(['induction']);
    expect(ev('поставил катетер')).toEqual(['catheter']);
    expect(ev('катетер в вену')).toEqual(['catheter']);
  });
  it('«поступил на операцию» — это не начало операции', () => {
    const r = parseDictation('поступил на удаление новообразования');
    expect(r.items.filter(i => i.kind === 'time')).toEqual([]);
  });
  it('«после индукции» не событие; «катетер» без глагола не событие', () => {
    expect(ev('после индукции')).toEqual([]);
    expect(ev('катетер')).toEqual([]);
  });
  it('несколько событий подряд сохраняют порядок речи', () => {
    expect(ev('начали операцию, выключил газ, экстубировал')).toEqual(['surgeryStart', 'anesthesiaEnd', 'extubation']);
  });
});

describe('диктовка вместе с показателями', () => {
  it('события забираются, показатели остаются для голосовой строки', () => {
    const r = parseDictation('пульс сто двадцать, ввёл цефтриаксон, сатурация девяносто восемь, сево два и один');
    expect(drugs(r.items).map(d => d.name)).toEqual(['Цефтриаксон']);
    const v = parseVoiceInput(r.rest, { allowedKeys: DEFAULT_ENTRY_KEYS });
    expect(v.values).toMatchObject({ hr: '120', spo2: '98', sevoPct: '2,1' });
    expect(v.unknown).toEqual([]);
  });
  it('интубировал и сразу показатели', () => {
    const r = parseDictation('интубировал трубкой 6.0, СО2 тридцать пять, пульс 90');
    expect(r.items.find(i => i.kind === 'intubation')).toMatchObject({ ettMm: '6,0' });
    const v = parseVoiceInput(r.rest, { allowedKeys: DEFAULT_ENTRY_KEYS });
    expect(v.values).toMatchObject({ etco2: '35', hr: '90' });
  });
  it('пустая и мусорная фраза', () => {
    expect(parseDictation('')).toEqual({ items: [], rest: '' });
    expect(parseDictation('что-то непонятное').items).toEqual([]);
    expect(parseDictation('что-то непонятное').rest).toBe('что-то непонятное');
  });
});

describe('consumeDoseNumber', () => {
  const n = (s: string) => consumeDoseNumber(s.split(' '), 0)?.value;
  it('«ноль пять» = 0,5, «пять» = 5, «два с половиной» = 2,5, «пять целых две десятых»', () => {
    expect(n('ноль пять')).toBe(0.5);
    expect(n('ноль запятая пять')).toBe(0.5);
    expect(n('пять')).toBe(5);
    expect(n('два с половиной')).toBe(2.5);
    expect(n('пять целых две десятых')).toBeCloseTo(5.2);
    expect(n('0,5')).toBe(0.5);
  });
});
