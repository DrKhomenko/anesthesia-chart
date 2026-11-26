/** Разбор диктовки клавиатуры (iOS 🎤) в поля минуты. Без Web Speech API и моделей; значения и рамки не придумываются. */

import { fmt } from './logic';

/** Справочник синонимов. Править здесь, не в UI. Более длинная фраза важнее короткой. */
export const VOICE_DICT = {
  fields: {
    hr: ['чсс', 'пульс', 'частота сердечных сокращений', 'частота сердечных', 'сердцебиение', 'сердце', 'heart rate', 'hr'],
    pr: ['пульс spo2', 'пульс спо2', 'пульс спо', 'пульс оксиметра', 'pulse rate', 'pr'],
    spo2: ['сатурация кислорода', 'сатурация со2', 'сатурация spo2', 'сатурация', 'насыщение кислородом', 'насыщение', 'спо2', 'spo2', 'spo 2', 'sp o 2', 'эс пи о два', 'эс пи о 2'],
    etco2: ['капнография', 'капно', 'энд тайдал', 'выдыхаемый со2', 'етсо2', 'этсо2', 'etco2', 'et co2', 'et co 2', 'со2', 'цо2', 'co2'],
    rr: ['частота дыхательных движений', 'частота дыхания', 'чдд', 'чд', 'дыхание', 'resp rate', 'rr'],
    tempC: ['температура', 'темпа', 'тэ', 'градусы', 't1', 't2', 'temp'],
    nibpSys: ['сад', 'систола', 'систолическое давление', 'систолическое', 'ад сист', 'верхнее давление', 'верхнее'],
    nibpDia: ['дад', 'диастола', 'диастолическое давление', 'диастолическое', 'ад диаст', 'нижнее давление', 'нижнее'],
    nibpMap: ['мад', 'среднее давление', 'среднее ад', 'ад ср', 'среднее'],
    sevoPct: ['севофлуран', 'севофлюран', 'сево', 'sevoflurane', 'sevo'],
    isoPct: ['изофлуран', 'изофлюран', 'изо', 'isoflurane', 'iso'],
    fio2: ['кислород', 'кислорода', 'доля кислорода', 'fio2', 'fi o2', 'fi o 2', 'фио2', 'фи о 2', 'o2', 'о2'],
    pPeak: ['пиковое давление', 'давление пик', 'pпик', 'рпик', 'пипик', 'ppeak', 'p peak', 'pip', 'пик'],
    vtInsp: ['дыхательный объем', 'дыхательный объём', 'объем вдоха', 'объём вдоха', 'tidal volume', 'vt', 'вт'],
    ventMode: ['режим вентиляции', 'режим ивл', 'режим'],
    peep: ['peep'],
    fico2: ['фисо2', 'fico2', 'fi co2'],
  },
  /** Пара «N на M» / «N/M» — САД и ДАД. Одно число после этих слов не угадываем. */
  bloodPressure: [
    'артериальное давление', 'кровяное давление', 'давление',
    'ниад', 'ад', 'bp', 'ашд',
  ],
  modes: {
    'PCV': ['pcv', 'пцв', 'пкв', 'пи си ви', 'пи-си-ви', 'по давлению'],
    'VCV': ['vcv', 'вцв', 'вкв', 'ви си ви', 'ви-си-ви', 'по объему', 'по объёму'],
    'SIMV': ['simv', 'симв', 'сим ви', 'си м в'],
    'PSV': ['psv', 'псв', 'пи эс ви', 'пи-эс-ви', 'поддержка давлением', 'поддержка'],
    'Спонтанно': ['спонтанно', 'спонтанное дыхание', 'спонтанное', 'сам дышит', 'spontaneous', 'spont'],
  },
  fillers: [
    'эээ', 'эм', 'ну', 'там', 'это', 'вот', 'так', 'да', 'пожалуйста',
    'примерно', 'около', 'где-то', 'где то', 'сейчас', 'тогда', 'еще', 'ещё',
    'и', 'а', 'в', 'во', 'с', 'со', 'на', 'по', 'из', 'к', 'у', 'же', 'ли', 'бы',
    'мм', 'значение', 'показатель', 'равен', 'равна', 'равно',
  ],
  units: [
    'процентов', 'процента', 'процент', '%',
    'миллиметров', 'миллиметра', 'миллиметр',
    'ртутного', 'ртутного столба', 'рт', 'ст', 'столба',
    'градусов', 'градуса', 'градус',
    'ударов', 'удара', 'удар', 'уд',
    'в минуту', 'в мин', 'минуту', 'мин',
    'миллилитров', 'миллилитра', 'миллилитр', 'мл',
    'сантиметров', 'сантиметра', 'сантиметр', 'см',
    'водного', 'вод', 'h2o',
    'литров', 'литра', 'литр',
  ],
  decimalWords: ['запятая', 'точка'],
  bpJoin: ['на', '/'],
  /** Слова, которые не переводим в процент и не подставляем в поле газа. */
  macWords: ['мак', 'маков', 'mac'],
  rewrites: [
    ['эс пи о два', 'spo2'],
    ['эс пи о 2', 'spo2'],
    ['sp o 2', 'spo2'],
    ['spo 2', 'spo2'],
    ['et co 2', 'etco2'],
    ['et co2', 'etco2'],
    ['ет си о два', 'etco2'],
    ['ет си о 2', 'etco2'],
    ['fi o 2', 'fio2'],
    ['fi o2', 'fio2'],
    ['фи о 2', 'fio2'],
    ['фи о два', 'fio2'],
  ],
} as const;

export type VoiceFieldKey = keyof typeof VOICE_DICT.fields;

export interface VoiceParseOptions {
  /** Если задано — распознанные, но отсутствующие в форме поля уходят в «не понял». */
  allowedKeys?: Iterable<string>;
  ventModes?: Iterable<string>;
}

export interface VoiceParseResult {
  values: Record<string, string>;
  unknown: string[];
  /** true только если МАД назвали явно. Иначе лист сам посчитает из САД и ДАД. */
  mapManual: boolean;
}

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

const ONES: Record<string, number> = {
  ноль: 0, нуль: 0,
  один: 1, одна: 1, одно: 1, одни: 1,
  два: 2, две: 2, двое: 2,
  три: 3, трое: 3,
  четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
};

const TEENS: Record<string, number> = {
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14,
  пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
};

const TENS: Record<string, number> = {
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50,
  шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
};

const HUNDREDS: Record<string, number> = {
  сто: 100, двести: 200, триста: 300, четыреста: 400,
  пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};

const THOUSAND = new Set(['тысяча', 'тысячи', 'тысяч']);

type Tok =
  | { kind: 'num'; n: number; raw: string }
  | { kind: 'word'; w: string; raw: string };

interface Phrase {
  words: string[];
  key: string;
  sort: number;
}

function subDigits(s: string): string {
  return s.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => String(SUBSCRIPT_DIGITS.indexOf(ch)));
}

/** Нижний регистр, «ё»→«е», индексы, тире и мусор пунктуации. */
export function normalizeVoiceText(text: string): string {
  let s = subDigits(String(text ?? '')).toLowerCase().replace(/ё/g, 'е');
  s = s.replace(/[−–—‐]/g, ' ');
  s = s.replace(/[«»„“”"'`]/g, ' ');
  s = s.replace(/[;:!?()[\]{}]/g, ' ');
  s = s.replace(/\s*\/\s*/g, ' / ');
  s = s.replace(/([а-яa-z]),\s*(\d)/g, '$1 запятая $2');
  // Запятая и точка — десятичный знак только между цифрами, иначе пробел.
  s = s.replace(/(\d),\s*(\d)/g, '$1COMMA$2');
  s = s.replace(/(\d)\.\s*(\d)/g, '$1DOT$2');
  s = s.replace(/[,.]+/g, ' ');
  s = s.replace(/COMMA/g, ',');
  s = s.replace(/DOT/g, '.');
  for (const [from, to] of VOICE_DICT.rewrites) {
    s = s.split(from).join(to);
  }
  return s.replace(/\s+/g, ' ').trim();
}

function isNumericLiteral(t: string): boolean {
  return /^[-+]?\d+([.,]\d+)?$/.test(t);
}

function parseLiteral(t: string): number {
  return Number(t.replace(',', '.'));
}

function numWordVal(w: string): { group: 'ones' | 'teens' | 'tens' | 'hundreds' | 'thousand'; n: number } | null {
  if (ONES[w] != null) return { group: 'ones', n: ONES[w] };
  if (TEENS[w] != null) return { group: 'teens', n: TEENS[w] };
  if (TENS[w] != null) return { group: 'tens', n: TENS[w] };
  if (HUNDREDS[w] != null) return { group: 'hundreds', n: HUNDREDS[w] };
  if (THOUSAND.has(w)) return { group: 'thousand', n: 1000 };
  return null;
}

function formatVoiceNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return fmt(n, 3);
}

function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  return normalized.split(/[\s]+/).map(t => t.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean);
}

/** Склеивает слова числительных в одно число, включая «два и один» и «два запятая один». */
export function consumeRuNumber(tokens: string[], start: number): { value: number; end: number } | null {
  if (start >= tokens.length) return null;
  const first = tokens[start];
  if (isNumericLiteral(first)) {
    let value = parseLiteral(first);
    let end = start + 1;
    if (!first.includes(',') && !first.includes('.')) {
      const dec = consumeDecimal(tokens, end, true);
      if (dec) { value = Math.trunc(value) + dec.frac; end = dec.end; }
    }
    return { value, end };
  }
  if (!numWordVal(first)) return null;

  let total = 0;
  let current = 0;
  let i = start;
  let took = false;
  while (i < tokens.length) {
    const w = tokens[i];
    const info = numWordVal(w);
    if (!info) break;
    if (info.group === 'thousand') {
      total += (current || 1) * 1000;
      current = 0;
      took = true;
      i += 1;
      continue;
    }
    if (info.group === 'hundreds') {
      if (current % 1000 !== 0) break;
      current += info.n;
      took = true;
      i += 1;
      continue;
    }
    if (info.group === 'tens') {
      if (current % 100 !== 0) break;
      current += info.n;
      took = true;
      i += 1;
      continue;
    }
    if (info.group === 'teens') {
      if (current % 100 !== 0) break;
      current += info.n;
      took = true;
      i += 1;
      continue;
    }
    // ones: «двадцать один» = 21, «сто восемь» = 108
    if (current % 10 !== 0) break;
    current += info.n;
    took = true;
    i += 1;
  }
  if (!took) return null;
  let value = total + current;
  const dec = consumeDecimal(tokens, i, true);
  if (dec) { value = Math.trunc(value) + dec.frac; i = dec.end; }
  return { value, end: i };
}

function consumeDecimal(tokens: string[], i: number, allowI: boolean): { frac: number; end: number } | null {
  if (i >= tokens.length) return null;
  const w = tokens[i];
  const isWord = (VOICE_DICT.decimalWords as readonly string[]).includes(w);
  const isI = allowI && w === 'и';
  if (!isWord && !isI) return null;
  if (i + 1 >= tokens.length) return null;
  const next = tokens[i + 1];
  let digits: string | null = null;
  if (isNumericLiteral(next) && !next.includes(',') && !next.includes('.')) {
    digits = next;
  } else if (ONES[next] != null) {
    digits = String(ONES[next]);
  } else if (!isI && TEENS[next] != null) {
    digits = String(TEENS[next]);
  } else if (!isI && TENS[next] != null) {
    digits = String(TENS[next]);
  }
  if (digits == null) return null;
  if (isI && (digits.length > 1 || Number(digits) > 9)) return null;
  const frac = Number(`0.${digits}`);
  if (!Number.isFinite(frac)) return null;
  return { frac, end: i + 2 };
}

function buildPhrases(ventModes: string[]): Phrase[] {
  const out: Phrase[] = [];
  const add = (phrase: string, key: string) => {
    const words = tokenize(normalizeVoiceText(phrase));
    if (!words.length) return;
    out.push({ words, key, sort: words.length * 100 + words.join(' ').length });
  };
  for (const [key, aliases] of Object.entries(VOICE_DICT.fields)) {
    for (const a of aliases) add(a, `field:${key}`);
  }
  for (const a of VOICE_DICT.bloodPressure) add(a, 'bp');
  for (const [mode, aliases] of Object.entries(VOICE_DICT.modes)) {
    for (const a of aliases) add(a, `mode:${mode}`);
    add(mode, `mode:${mode}`);
  }
  for (const mode of ventModes) add(mode, `mode:${mode}`);
  out.sort((a, b) => b.sort - a.sort);
  return out;
}

function matchPhrase(tokens: string[], i: number, phrases: Phrase[]): Phrase | null {
  for (const p of phrases) {
    if (i + p.words.length > tokens.length) continue;
    let ok = true;
    for (let k = 0; k < p.words.length; k++) {
      if (tokens[i + k] !== p.words[k]) { ok = false; break; }
    }
    if (ok) return p;
  }
  return null;
}

function isFiller(tokens: string[], i: number): number {
  const units = VOICE_DICT.units as readonly string[];
  const fillers = VOICE_DICT.fillers as readonly string[];
  for (const list of [units, fillers]) {
    for (const phrase of [...list].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length)) {
      const words = tokenize(normalizeVoiceText(phrase));
      if (!words.length || i + words.length > tokens.length) continue;
      if (words.every((w, k) => tokens[i + k] === w)) return words.length;
    }
  }
  return 0;
}

function isMac(tokens: string[], i: number): boolean {
  return i < tokens.length && (VOICE_DICT.macWords as readonly string[]).includes(tokens[i]);
}

function isBpJoin(t: string): boolean {
  return (VOICE_DICT.bpJoin as readonly string[]).includes(t);
}

function consumeBpPair(tokens: string[], i: number): { sys: number; dia: number; end: number } | null {
  const a = consumeRuNumber(tokens, i);
  if (!a) return null;
  let j = a.end;
  if (j < tokens.length && isBpJoin(tokens[j])) j += 1;
  else return null;
  const b = consumeRuNumber(tokens, j);
  if (!b) return null;
  return { sys: a.value, dia: b.value, end: b.end };
}

function skipUnits(tokens: string[], i: number): number {
  let j = i;
  for (;;) {
    const n = isFiller(tokens, j);
    // после числа пропускаем только единицы, не союзы вроде «и»
    if (n === 0) break;
    const words = tokens.slice(j, j + n).join(' ');
    const isUnit = (VOICE_DICT.units as readonly string[]).some(u => normalizeVoiceText(u) === words);
    if (!isUnit) break;
    j += n;
  }
  return j;
}

/** Пропуск вводных и единиц между именем поля и числом («сатурация примерно 98»). */
function skipNoise(tokens: string[], i: number): number {
  let j = i;
  for (;;) {
    if (j < tokens.length && (tokens[j] === 'на' || tokens[j] === '/')) break;
    const n = isFiller(tokens, j);
    if (n === 0) break;
    j += n;
  }
  return j;
}

function flushUnknown(buf: string[], into: string[]) {
  const s = buf.join(' ').trim();
  buf.length = 0;
  if (s) into.push(s);
}

/**
 * Разбирает фразу диктовки в значения полей. Неназванные поля не заполняет.
 * Обрывки без известного имени поля попадают в unknown, без догадок.
 */
export function parseVoiceInput(text: string, opts: VoiceParseOptions = {}): VoiceParseResult {
  const allowed = opts.allowedKeys ? new Set([...opts.allowedKeys]) : null;
  const ventModes = [...(opts.ventModes ?? Object.keys(VOICE_DICT.modes))];
  const phrases = buildPhrases(ventModes);
  const tokens = tokenize(normalizeVoiceText(text));
  const values: Record<string, string> = {};
  const unknown: string[] = [];
  let mapManual = false;
  const pending: string[] = [];

  const allow = (key: string) => !allowed || allowed.has(key);

  const setNum = (key: string, n: number, raw: string) => {
    if (!allow(key)) { unknown.push(raw); return false; }
    const s = formatVoiceNumber(n);
    if (s === '') { unknown.push(raw); return false; }
    values[key] = s;
    if (key === 'nibpMap') mapManual = true;
    return true;
  };

  const setMode = (mode: string, raw: string) => {
    if (!allow('ventMode')) { unknown.push(raw); return; }
    values.ventMode = mode;
  };

  const setBp = (sys: number, dia: number, raw: string) => {
    const okS = allow('nibpSys');
    const okD = allow('nibpDia');
    if (!okS && !okD) { unknown.push(raw); return; }
    if (okS) values.nibpSys = formatVoiceNumber(sys);
    if (okD) values.nibpDia = formatVoiceNumber(dia);
    // МАД не пишем — его посчитает лист, если пользователь его не назвал.
  };

  let i = 0;
  while (i < tokens.length) {
    const phrase = matchPhrase(tokens, i, phrases);
    if (phrase) {
      const start = i;
      i += phrase.words.length;
      const rawFrom = (end: number) => tokens.slice(start, end).join(' ');

      if (phrase.key === 'bp') {
        i = skipNoise(tokens, i);
        const pair = consumeBpPair(tokens, i);
        if (pair) {
          flushUnknown(pending, unknown);
          i = skipUnits(tokens, pair.end);
          setBp(pair.sys, pair.dia, rawFrom(i));
          continue;
        }
        pending.push(...tokens.slice(start, i));
        continue;
      }

      if (phrase.key.startsWith('mode:')) {
        flushUnknown(pending, unknown);
        setMode(phrase.key.slice(5), rawFrom(i));
        continue;
      }

      const key = phrase.key.slice('field:'.length);
      if (key === 'ventMode') {
        i = skipNoise(tokens, i);
        const modePhrase = matchPhrase(tokens, i, phrases.filter(p => p.key.startsWith('mode:')));
        if (modePhrase) {
          flushUnknown(pending, unknown);
          i += modePhrase.words.length;
          setMode(modePhrase.key.slice(5), rawFrom(i));
          continue;
        }
        pending.push(...tokens.slice(start, i));
        continue;
      }

      if (key === 'nibpSys' || key === 'nibpDia' || key === 'nibpMap') {
        i = skipNoise(tokens, i);
        const pair = consumeBpPair(tokens, i);
        if (pair && (key === 'nibpSys' || key === 'nibpDia')) {
          // «сад 120 на 80» всё равно пара
          flushUnknown(pending, unknown);
          i = skipUnits(tokens, pair.end);
          setBp(pair.sys, pair.dia, rawFrom(i));
          continue;
        }
      }

      i = skipNoise(tokens, i);
      const num = consumeRuNumber(tokens, i);
      if (num) {
        let end = skipUnits(tokens, num.end);
        // «сево 1 мак» — не переводим МАК в проценты
        if (isMac(tokens, end)) {
          const macEnd = end + 1;
          pending.push(tokens.slice(start, macEnd).join(' '));
          i = macEnd;
          continue;
        }
        flushUnknown(pending, unknown);
        i = end;
        setNum(key, num.value, rawFrom(i));
        continue;
      }
      pending.push(...tokens.slice(start, i));
      continue;
    }

    const pair = consumeBpPair(tokens, i);
    if (pair) {
      flushUnknown(pending, unknown);
      const from = i;
      i = skipUnits(tokens, pair.end);
      setBp(pair.sys, pair.dia, tokens.slice(from, i).join(' '));
      continue;
    }

    const fill = isFiller(tokens, i);
    if (fill && tokens[i] !== 'на' && tokens[i] !== '/') {
      i += fill;
      continue;
    }

    i += 1;
    pending.push(tokens[i - 1]);
  }
  flushUnknown(pending, unknown);
  return { values, unknown, mapManual };
}

export const VOICE_HINT = 'Нажмите 🎤 на клавиатуре и продиктуйте: пульс 120, сатурация 98, СО2 35, сево 2,1';
export const VOICE_PLACEHOLDER = 'пульс 120, сатурация 98, СО2 35, сево 2,1';
