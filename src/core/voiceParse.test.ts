import { describe, it, expect } from 'vitest';
import {
  VOICE_DICT, consumeRuNumber, normalizeVoiceText, parseVoiceInput,
} from './voiceParse';
import { DEFAULT_ENTRY_KEYS } from './quickEntry';

const DEFAULT = { allowedKeys: [...DEFAULT_ENTRY_KEYS] };

function nums(s: string): number {
  const tokens = normalizeVoiceText(s).split(/\s+/).filter(Boolean);
  const got = consumeRuNumber(tokens, 0);
  if (!got || got.end !== tokens.length) throw new Error(`не разобралось: ${s} → ${JSON.stringify(got)}`);
  return got.value;
}

describe('normalizeVoiceText', () => {
  it('нижний регистр, ё, индексы, тире и концевая точка', () => {
    expect(normalizeVoiceText('Пульс СО₂ — сто.')).toBe('пульс со2 сто');
  });
  it('слитные переписывания iOS: эс пи о два, fi o 2', () => {
    expect(normalizeVoiceText('эс пи о два 98')).toContain('spo2');
    expect(normalizeVoiceText('fi o 2 40')).toContain('fio2');
  });
});

describe('consumeRuNumber', () => {
  it('цифры, запятая и точка', () => {
    expect(nums('120')).toBe(120);
    expect(nums('2,1')).toBe(2.1);
    expect(nums('2.1')).toBe(2.1);
    expect(nums('37,6')).toBe(37.6);
  });
  it('слова: десятки, сотни, тысячи', () => {
    expect(nums('сто двадцать')).toBe(120);
    expect(nums('девяносто восемь')).toBe(98);
    expect(nums('тридцать пять')).toBe(35);
    expect(nums('ноль')).toBe(0);
    expect(nums('одиннадцать')).toBe(11);
    expect(nums('двести восемьдесят')).toBe(280);
    expect(nums('тысяча двести')).toBe(1200);
    expect(nums('две тысячи')).toBe(2000);
  });
  it('дробная часть: и, запятая, точка, «два,1»', () => {
    expect(nums('два и один')).toBe(2.1);
    expect(nums('два запятая один')).toBe(2.1);
    expect(nums('два точка один')).toBe(2.1);
    expect(nums('тридцать семь и шесть')).toBe(37.6);
    expect(nums('два,1')).toBe(2.1);
  });
  it('«двадцать один» это 21, не 20,1', () => {
    expect(nums('двадцать один')).toBe(21);
  });
});

describe('parseVoiceInput — типичные фразы', () => {
  it('пример из подсказки: цифры и запятая', () => {
    const r = parseVoiceInput('пульс 120, сатурация 98, СО2 35, сево 2,1', DEFAULT);
    expect(r.values).toEqual({ hr: '120', spo2: '98', etco2: '35', sevoPct: '2,1' });
    expect(r.unknown).toEqual([]);
    expect(r.mapManual).toBe(false);
  });

  it('тот же пример словами', () => {
    const r = parseVoiceInput('пульс сто двадцать, сатурация девяносто восемь, со2 тридцать пять, сево два и один', DEFAULT);
    expect(r.values).toEqual({ hr: '120', spo2: '98', etco2: '35', sevoPct: '2,1' });
    expect(r.unknown).toEqual([]);
  });

  it('заглавные, точка, «процентов»', () => {
    const r = parseVoiceInput('Пульс сто двадцать. Сатурация девяносто восемь процентов.', DEFAULT);
    expect(r.values).toEqual({ hr: '120', spo2: '98' });
    expect(r.unknown).toEqual([]);
  });

  it('iOS: 2.1, два запятая один, СО₂', () => {
    expect(parseVoiceInput('сево 2.1', DEFAULT).values.sevoPct).toBe('2,1');
    expect(parseVoiceInput('сево два запятая один', DEFAULT).values.sevoPct).toBe('2,1');
    expect(parseVoiceInput('сатурация СО₂ 98', DEFAULT).values.spo2).toBe('98');
    expect(parseVoiceInput('спо2 98', DEFAULT).values.spo2).toBe('98');
    expect(parseVoiceInput('этсо2 35', DEFAULT).values.etco2).toBe('35');
  });

  it('эс пи о два и fi o 2 после переписывания', () => {
    const r = parseVoiceInput('эс пи о два девяносто восемь, fi o 2 сорок', DEFAULT);
    expect(r.values).toMatchObject({ spo2: '98', fio2: '40' });
  });
});

describe('parseVoiceInput — давление', () => {
  it('«давление сто двадцать на восемьдесят»', () => {
    const r = parseVoiceInput('давление сто двадцать на восемьдесят', DEFAULT);
    expect(r.values).toEqual({ nibpSys: '120', nibpDia: '80' });
    expect(r.values.nibpMap).toBeUndefined();
    expect(r.mapManual).toBe(false);
  });

  it('ад 110/70, голая пара 120 на 80', () => {
    expect(parseVoiceInput('ад 110 на 70', DEFAULT).values).toEqual({ nibpSys: '110', nibpDia: '70' });
    expect(parseVoiceInput('120 на 80', DEFAULT).values).toEqual({ nibpSys: '120', nibpDia: '80' });
    expect(parseVoiceInput('120/80', DEFAULT).values).toEqual({ nibpSys: '120', nibpDia: '80' });
  });

  it('сад и дад по отдельности, мад вручную', () => {
    const r = parseVoiceInput('сад 120 дад 80 мад 93', DEFAULT);
    expect(r.values).toEqual({ nibpSys: '120', nibpDia: '80', nibpMap: '93' });
    expect(r.mapManual).toBe(true);
  });

  it('одно слово «давление» без чисел не угадывает значение', () => {
    const r = parseVoiceInput('давление высокое', DEFAULT);
    expect(r.values).toEqual({});
    expect(r.unknown.join(' ')).toMatch(/давление/);
    expect(r.unknown.join(' ')).toMatch(/высокое/);
  });
});

describe('parseVoiceInput — остальные поля минуты', () => {
  it('чсс, чдд, температура, кислород, пик, дыхательный объём', () => {
    const r = parseVoiceInput('чсс 90, дыхание 12, температура тридцать семь и шесть, кислород 60, пик 15, дыхательный объём 280', DEFAULT);
    expect(r.values).toEqual({
      hr: '90', rr: '12', tempC: '37,6', fio2: '60', pPeak: '15', vtInsp: '280',
    });
  });

  it('изофлуран и синонимы газа', () => {
    expect(parseVoiceInput('изофлуран 1,2', DEFAULT).values.isoPct).toBe('1,2');
    expect(parseVoiceInput('изо 1,2', DEFAULT).values.isoPct).toBe('1,2');
    expect(parseVoiceInput('севофлуран два и один', DEFAULT).values.sevoPct).toBe('2,1');
  });

  it('режимы ИВЛ: чипы и слова', () => {
    expect(parseVoiceInput('режим pcv', DEFAULT).values.ventMode).toBe('PCV');
    expect(parseVoiceInput('по давлению', DEFAULT).values.ventMode).toBe('PCV');
    expect(parseVoiceInput('по объёму', DEFAULT).values.ventMode).toBe('VCV');
    expect(parseVoiceInput('вцв', DEFAULT).values.ventMode).toBe('VCV');
    expect(parseVoiceInput('симв', DEFAULT).values.ventMode).toBe('SIMV');
    expect(parseVoiceInput('psv', DEFAULT).values.ventMode).toBe('PSV');
    expect(parseVoiceInput('спонтанно', DEFAULT).values.ventMode).toBe('Спонтанно');
    expect(parseVoiceInput('сам дышит', DEFAULT).values.ventMode).toBe('Спонтанно');
  });

  it('кастомный режим из справочника клиники', () => {
    const r = parseVoiceInput('режим Manual', { allowedKeys: DEFAULT_ENTRY_KEYS, ventModes: ['Спонтанно', 'PCV', 'Manual'] });
    expect(r.values.ventMode).toBe('Manual');
  });
});

describe('parseVoiceInput — ограничения', () => {
  it('пустая строка и один мусор', () => {
    expect(parseVoiceInput('', DEFAULT)).toEqual({ values: {}, unknown: [], mapManual: false });
    const r = parseVoiceInput('все хорошо', DEFAULT);
    expect(r.values).toEqual({});
    expect(r.unknown).toEqual(['все хорошо']);
  });

  it('союз «и» между полями не становится дробью', () => {
    const r = parseVoiceInput('пульс сто и сатурация девяносто восемь', DEFAULT);
    expect(r.values).toEqual({ hr: '100', spo2: '98' });
  });

  it('неназванные поля не заполняются, рамки не придумываются', () => {
    const r = parseVoiceInput('пульс 120', DEFAULT);
    expect(r.values).toEqual({ hr: '120' });
    expect(r.values.spo2).toBeUndefined();
    expect(r.values.nibpMap).toBeUndefined();
  });

  it('поле не из текущей формы — в «не понял», не в чужой ключ', () => {
    const r = parseVoiceInput('пульс 120, пик 15', { allowedKeys: ['hr', 'spo2'] });
    expect(r.values).toEqual({ hr: '120' });
    expect(r.unknown.join(' ')).toMatch(/15/);
  });

  it('МАК в процент не переводим', () => {
    const one = parseVoiceInput('сево 1 мак', DEFAULT);
    expect(one.values.sevoPct).toBeUndefined();
    expect(one.unknown.join(' ')).toMatch(/мак/);
    const withPct = parseVoiceInput('сево 2,1 мак', DEFAULT);
    expect(withPct.values.sevoPct).toBeUndefined();
    expect(withPct.unknown.join(' ')).toMatch(/мак/);
  });

  it('голые числа без имени поля не раскладываются по местам', () => {
    const r = parseVoiceInput('120 98 35', DEFAULT);
    expect(r.values).toEqual({});
    expect(r.unknown.length).toBeGreaterThan(0);
  });

  it('вводные слова отбрасываются', () => {
    const r = parseVoiceInput('ну примерно пульс сто двадцать там сатурация около девяносто восемь', DEFAULT);
    expect(r.values).toEqual({ hr: '120', spo2: '98' });
    expect(r.unknown).toEqual([]);
  });
});

describe('справочник покрывает поля минуты', () => {
  it('у каждого ключа быстрой записи есть синонимы', () => {
    for (const key of DEFAULT_ENTRY_KEYS) {
      if (key === 'ventMode') {
        expect(Object.keys(VOICE_DICT.modes).length).toBeGreaterThan(0);
        expect(VOICE_DICT.fields.ventMode.length).toBeGreaterThan(0);
        continue;
      }
      expect(VOICE_DICT.fields[key as keyof typeof VOICE_DICT.fields], key).toBeTruthy();
    }
  });
});
