/**
 * Свободная диктовка по ходу наркоза: «на столе Барсик, семь лет, поступил на удаление новообразования.
 * Ввёл цефтриаксон, дал залетил, интубировал трубкой 6.0».
 * Правила и словарь, без облака и моделей. Дозы, пути и границы не придумываются:
 * чего не прозвучало — того в записи нет, а у препарата без дозы стоит пометка «доза не указана».
 */

import { consumeRuNumber, normalizeVoiceText, tokenize, VOICE_DICT } from './voiceParse';
import { fmt } from './logic';

export type DictRoute = 'в/в' | 'в/м' | 'п/к' | 'внутрь';
export type DictSpecies = 'dog' | 'cat';
export type DictTimeKind = 'induction' | 'intubation' | 'extubation' | 'surgeryStart' | 'surgeryEnd' | 'anesthesiaEnd' | 'catheter';

export interface DictDrugRef { id: string; name: string; genericName?: string }

/** Словарь. Править здесь. Слово — начало слова (окончания «залетила», «цефтриаксона» подхватываются до 4 букв). Опиоидов и кетамина в клинике нет, их здесь нет. */
export const DICTATION_DICT = {
  drugs: [
    { name: 'Золетил', words: ['золетил', 'залетил', 'залетел', 'золетел', 'зелетил', 'золотил', 'золитил', 'zoletil'] },
    { name: 'Цефтриаксон', words: ['цефтриаксон', 'цефтриоксон', 'цефтриаксан', 'цефтриаксин', 'цефтреаксон', 'ceftriaxone'] },
    { name: 'Цефазолин', words: ['цефазолин', 'цефозолин', 'cefazolin'] },
    { name: 'Пропофол', words: ['пропофол', 'пропафол', 'propofol'] },
    { name: 'Дексдомитор', words: ['дексдомитор', 'дексмедетомидин', 'дексдометор', 'dexdomitor'] },
    { name: 'Антиседан', words: ['антиседан', 'атипамезол', 'antisedan'] },
    { name: 'Атропин', words: ['атропин', 'atropine'] },
    { name: 'Дексаметазон', words: ['дексаметазон', 'dexamethasone'] },
    { name: 'Мелоксикам', words: ['мелоксикам', 'метакам', 'meloxicam'] },
    { name: 'Церения', words: ['церения', 'маропитант', 'cerenia'] },
    { name: 'Ондансетрон', words: ['ондансетрон', 'ondansetron'] },
  ] as { name: string; words: string[] }[],
  species: {
    cat: ['кот', 'кошка', 'кошку', 'кота', 'кошки', 'котик', 'котенок', 'котенка', 'кошечка', 'кошечку'],
    dog: ['собака', 'собаку', 'собаки', 'пес', 'пса', 'песик', 'кобель', 'кобеля', 'сука', 'суку', 'щенок', 'щенка'],
  } as Record<DictSpecies, string[]>,
  /** Куда ставится кличка: «на столе Барсик», «пациент Барсик», «кличка Барсик», «зовут Барсик». */
  nameTriggers: ['на столе', 'пациент*', 'кличка', 'зовут', 'по кличке'],
  nameSkip: ['лежит', 'лежат', 'у', 'нас', 'наш', 'наша', 'наше', 'пациент', 'пациентка', 'пациента', 'сегодня', 'стоит', 'сидит', 'вот', 'это', 'такой', 'такая'],
  /** Начало фразы про операцию: «поступил на …», «пришла на …». */
  operationVerbs: ['поступил*', 'пришел', 'пришла', 'привезли', 'привели', 'записан*', 'госпитализирован*'],
  operationSkip: ['к', 'нам', 'сегодня', 'вчера', 'плановый', 'плановая', 'плановое', 'планово', 'экстренный', 'экстренная', 'экстренно', 'срочно', 'срочный', 'утром', 'ранее'],
  operationPreps: ['на', 'для'],
  /** «операция кастрация», «процедура …» */
  operationNouns: ['операция', 'процедура', 'манипуляция'],
  ageUnits: {
    year: ['год', 'года', 'лет', 'годик', 'годика', 'годов'],
    month: ['месяц*', 'мес'],
    week: ['недел*', 'нед'],
  } as Record<'year' | 'month' | 'week', string[]>,
  /** Глаголы введения перед препаратом: «ввёл», «дал», «сделал укол». Съедаются вместе с препаратом. */
  giveVerbs: ['ввел*', 'введ*', 'вводи*', 'ввож*', 'дал', 'дала', 'дали', 'дае*', 'давал*', 'укол*', 'коло*', 'колю', 'сделал', 'сделала', 'сделали', 'капнул', 'струйно'],
  /** Слова, которые не мешают и не попадают в «не понял». */
  noise: ['я', 'мы', 'ему', 'ей', 'им', 'нам', 'потом', 'затем', 'также', 'еще', 'уже', 'дополнительно', 'пациенту', 'пациентке', 'пациент', 'пациентка', 'пациента', 'вот', 'ну', 'так', 'значит', 'эээ', 'эм', 'и', 'а', 'тоже', 'далее', 'после', 'этого'],
  /** Если рядом такое слово, действие не записываем (отрицание, планы, аллергия): оно уйдёт в «не понял». */
  negation: ['не', 'нет', 'без', 'аллерг*', 'планир*', 'будем', 'будет', 'буду', 'хочу', 'хотим', 'надо', 'нужно', 'нужен', 'нужна', 'готов*', 'приготов*', 'подготов*', 'собира*', 'можно', 'нельзя', 'противопоказ*', 'отмен*', 'отказ*', 'если', 'чтобы', 'возможно', 'вдруг'],
  /** Для событий-времён: «после индукции», «перед интубацией» — не событие. */
  notNow: ['после', 'перед', 'до', 'при', 'во', 'время'],
  tubeWords: ['трубкой', 'трубка', 'трубку', 'трубки', 'ett', 'этт', 'эндотрахеальной', 'интубационной'],
  tubeFiller: ['номер', 'номером', 'размер', 'размером', '№', 'на', 'диаметром', 'внутренним', 'мм', 'миллиметров'],
  tubeSlang: {
    двойка: 2, двойкой: 2, двойку: 2, тройка: 3, тройкой: 3, тройку: 3, четверка: 4, четверкой: 4, четверку: 4,
    пятерка: 5, пятеркой: 5, пятерку: 5, шестерка: 6, шестеркой: 6, шестерку: 6, семерка: 7, семеркой: 7, семерку: 7,
    восьмерка: 8, восьмеркой: 8, восьмерку: 8, девятка: 9, девяткой: 9, девятку: 9,
  } as Record<string, number>,
  events: [
    { kind: 'intubation', phrases: ['интубир*', 'интубац*', 'заинтубир*'] },
    { kind: 'extubation', phrases: ['экстубир*', 'экстубац*'] },
    { kind: 'induction', phrases: ['индукц*', 'ввели в наркоз', 'ввел в наркоз', 'начало наркоза', 'начали наркоз', 'начало анестезии', 'начали анестезию', 'начинаем наркоз', 'начинаем анестезию'] },
    { kind: 'surgeryStart', phrases: ['начало операции', 'начали операцию', 'начинаем операцию', 'операция началась', 'операция началась', 'разрез', 'начали разрез', 'сделали разрез', 'сделал разрез'] },
    { kind: 'surgeryEnd', phrases: ['конец операции', 'окончание операции', 'закончили операцию', 'закончил операцию', 'операция закончена', 'операция закончилась', 'операция окончена', 'последний шов'] },
    { kind: 'anesthesiaEnd', phrases: ['конец наркоза', 'конец анестезии', 'окончание наркоза', 'выключил газ', 'выключили газ', 'газ выключил*', 'газ выкл*', 'закончили наркоз', 'наркоз закончен', 'наркоз окончен'] },
    { kind: 'catheter', phrases: ['катетер*'] },
  ] as { kind: DictTimeKind; phrases: string[] }[],
  catheterVerbs: ['постав*', 'устан*', 'вста*', 'катетериз*', 'установ*'],
  doseUnits: {
    'mg/kg': ['мг / кг', 'мг на кг', 'мг кг', 'мг на килограмм', 'миллиграмм на килограмм', 'миллиграмма на килограмм', 'миллиграммов на килограмм', 'миллиграмм на кг', 'миллиграмм кг', 'мг на кило', 'миллиграмм на кило', 'мг/кг'],
    'mcg/kg': ['мкг / кг', 'мкг на кг', 'мкг кг', 'мкг на килограмм', 'микрограмм на килограмм', 'микрограмма на килограмм', 'микрограммов на килограмм', 'микрограмм на кг', 'мкг на кило', 'микрограмм на кило', 'мкг/кг'],
    mg: ['мг', 'миллиграмм', 'миллиграмма', 'миллиграммов', 'миллиграмов'],
    ml: ['мл', 'миллилитр', 'миллилитра', 'миллилитров', 'кубик', 'кубика', 'кубиков', 'куб'],
    u: ['ед', 'единица', 'единицы', 'единиц'],
  } as Record<'mg/kg' | 'mcg/kg' | 'mg' | 'ml' | 'u', string[]>,
  doseFillers: ['в', 'дозе', 'дозу', 'доза', 'по', 'примерно', 'около', 'порядка', 'по поводу'],
  routes: {
    'в/в': ['внутривенно', 'в вену', 'в / в', 'ив'],
    'в/м': ['внутримышечно', 'в мышцу', 'в / м', 'вм'],
    'п/к': ['подкожно', 'п / к', 'под кожу', 'пк'],
    'внутрь': ['внутрь', 'перорально', 'per os', 'через рот'],
  } as Record<DictRoute, string[]>,
} as const;

export const NOT_SPOKEN_DOSE = 'доза не указана';

/* ───────────── элементы разбора ───────────── */

export type DictItem =
  | { kind: 'patient'; field: 'patientName' | 'ageText' | 'operation' | 'species'; value: string; raw: string }
  | { kind: 'drug'; name: string; drugId: string | null; isNew: boolean;
      doseValue?: string; doseUnit?: 'mg/kg' | 'mcg/kg'; volumeMl?: string; spokenOther?: string; route?: DictRoute; raw: string }
  | { kind: 'intubation'; ettMm?: string; sizeOnly?: boolean; raw: string }
  | { kind: 'time'; event: Exclude<DictTimeKind, 'intubation'>; raw: string };

export interface DictationParse {
  items: DictItem[];
  /** Всё, что не разобрали как события — это уходит в разбор показателей (voiceParse). */
  rest: string;
}

/* ───────────── вспомогательное ───────────── */

const isWordTok = (t: string) => /^[a-zа-я][a-zа-я-]*$/.test(t);
const norm1 = (w: string) => normalizeVoiceText(w);

function wordMatches(tok: string, pat: string): boolean {
  if (pat.endsWith('*')) return tok.startsWith(pat.slice(0, -1));
  return tok === pat;
}
function inList(tok: string, list: readonly string[]): boolean {
  return list.some(p => wordMatches(tok, norm1(p)));
}
function patTokens(phrase: string): string[] { return tokenize(normalizeVoiceText(phrase.replace(/\*/g, '§'))).map(t => t.replace(/§/g, '*')); }
function matchSeq(tokens: string[], i: number, pat: string[]): number {
  if (!pat.length || i + pat.length > tokens.length) return 0;
  for (let k = 0; k < pat.length; k++) if (!wordMatches(tokens[i + k], pat[k])) return 0;
  return pat.length;
}
function matchAny(tokens: string[], i: number, phrases: readonly string[]): number {
  let best = 0;
  for (const p of phrases) best = Math.max(best, matchSeq(tokens, i, patTokens(p)));
  return best;
}
/** «дал» — слово целиком, «дае*» — начало. Без «*» префиксом не считаем. */
const STEM_EXTRA = 4;
function stemMatch(tok: string, stem: string): boolean {
  return tok.startsWith(stem) && tok.length - stem.length <= STEM_EXTRA;
}
const capitalize = (w: string) => w.split('-').map(p => p ? p[0].toUpperCase() + p.slice(1) : p).join('-');

const VITALS_FIRST = (() => {
  const set = new Set<string>();
  for (const aliases of Object.values(VOICE_DICT.fields)) for (const a of aliases) { const t = tokenize(normalizeVoiceText(a))[0]; if (t) set.add(t); }
  for (const a of VOICE_DICT.bloodPressure) { const t = tokenize(normalizeVoiceText(a))[0]; if (t) set.add(t); }
  for (const t of ['режим', 'ивл']) set.add(t);
  return set;
})();

/* ───────────── числа ───────────── */

/** Число с «ноль пять» = 0,5 (consumeRuNumber читает такое как 5 — для доз это опасно). */
export function consumeDoseNumber(tokens: string[], i: number): { value: number; end: number } | null {
  if (i >= tokens.length) return null;
  const first = tokens[i];
  if ((first === 'ноль' || first === 'нуль') && i + 1 < tokens.length) {
    const nx = tokens[i + 1];
    const d = consumeRuNumber(tokens, i + 1);
    if (d && nx !== 'запятая' && nx !== 'точка' && nx !== 'и' && Number.isInteger(d.value) && d.value >= 0 && d.value < 100) {
      const digits = String(d.value);
      return { value: Number(`0.${digits}`), end: d.end };
    }
  }
  const n = consumeRuNumber(tokens, i);
  if (!n) return null;
  let { value, end } = n;
  // «пять целых две десятых», «два с половиной»
  if (Number.isInteger(value)) {
    if (tokens[end] === 'с' && tokens[end + 1]?.startsWith('половин')) { value += 0.5; end += 2; }
    else if (tokens[end]?.startsWith('цел')) {
      const f = consumeRuNumber(tokens, end + 1);
      const unit = f ? tokens[f.end] : '';
      if (f && Number.isInteger(f.value) && (unit?.startsWith('десят') || unit?.startsWith('сот'))) {
        value += f.value / (unit.startsWith('десят') ? 10 : 100); end = f.end + 1;
      }
    }
  }
  return { value, end };
}

const fmtNum = (n: number) => Number.isInteger(n) ? String(n) : fmt(n, 3);

function ettFromNumber(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value.toFixed(1).replace('.', ',');
}

/** Размер трубки после слова «трубкой»: «6.0», «6,5», «шесть ноль», «шесть пять», «шесть с половиной». */
function consumeEtt(tokens: string[], i: number): { mm: string; end: number } | null {
  let j = i;
  while (j < tokens.length && inList(tokens[j], DICTATION_DICT.tubeFiller)) j += 1;
  if (j >= tokens.length) return null;
  const n = consumeRuNumber(tokens, j);
  if (!n) return null;
  let value = n.value; let end = n.end;
  if (Number.isInteger(value)) {
    const nx = tokens[end];
    if (nx === 'с' && tokens[end + 1]?.startsWith('половин')) { value += 0.5; end += 2; }
    else if (nx && /^\d$/.test(nx) && !(tokens[end + 1] && ageUnitKind(tokens[end + 1]))) { value += Number(nx) / 10; end += 1; }
    else if (nx === 'ноль' || nx === 'нуль') { end += 1; }
    else if (nx) {
      const d = consumeRuNumber(tokens, end);
      const afterUnit = tokens[end + 1] ? ageUnitKind(tokens[end + 1]) : null;
      if (d && !afterUnit && Number.isInteger(d.value) && d.value >= 1 && d.value <= 9 && isOnesWord(tokens[end])) { value += d.value / 10; end = d.end; }
    }
  }
  const mm = ettFromNumber(value);
  return mm ? { mm, end } : null;
}
function isOnesWord(t: string): boolean {
  return ['один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'].includes(t);
}

/* ───────────── словарь препаратов + справочник приложения ───────────── */

interface DrugEntry { name: string; drugId: string | null; isNew: boolean; stems: string[][] }

function firstAlpha(name: string): string[] {
  return tokenize(normalizeVoiceText(name)).filter(isWordTok);
}
function stemOf(word: string): string {
  const s = word.replace(/[аяуюыиеоьй]+$/, '');
  return s.length >= 4 ? s : word;
}

export function buildDrugEntries(formulary: readonly DictDrugRef[] = []): DrugEntry[] {
  const entries: DrugEntry[] = [];
  const used = new Set<string>();
  for (const d of formulary) {
    const stems: string[][] = [];
    for (const nm of [d.name, d.genericName ?? '']) {
      const words = firstAlpha(nm);
      if (words.length && words[0].length >= 4) stems.push(words.map(stemOf));
    }
    if (!stems.length) continue;
    entries.push({ name: d.name, drugId: d.id, isNew: false, stems });
  }
  for (const dd of DICTATION_DICT.drugs) {
    const canon = stemOf(firstAlpha(dd.name)[0]);
    const inForm = entries.find(e => e.stems.some(s => s[0] === canon || s[0].startsWith(canon) || canon.startsWith(s[0])));
    const syn = dd.words.map(w => [stemOf(norm1(w))]);
    if (inForm) { inForm.stems.push(...syn); used.add(dd.name); continue; }
    entries.push({ name: dd.name, drugId: null, isNew: true, stems: [[canon], ...syn] });
  }
  // «Золетил» в справочнике — подхватить и синонимы-ошибки распознавания
  return entries;
}

function matchDrug(tokens: string[], i: number, entries: DrugEntry[]): { entry: DrugEntry; len: number } | null {
  const t0 = tokens[i];
  if (!isWordTok(t0) || VITALS_FIRST.has(t0)) return null;
  let best: { entry: DrugEntry; len: number } | null = null;
  for (const e of entries) {
    for (const stem of e.stems) {
      let ok = true;
      for (let k = 0; k < stem.length; k++) {
        const t = tokens[i + k];
        if (t == null || !stemMatch(t, stem[k])) { ok = false; break; }
      }
      if (ok && (!best || stem.length > best.len)) best = { entry: e, len: stem.length };
    }
  }
  return best;
}

/* ───────────── дозы и пути ───────────── */

type DoseKind = 'mg/kg' | 'mcg/kg' | 'mg' | 'ml' | 'u';
interface Dose { value: number; kind: DoseKind; end: number }

const DOSE_UNIT_PATS: { kind: DoseKind; pat: string[] }[] = (() => {
  const out: { kind: DoseKind; pat: string[] }[] = [];
  for (const [kind, list] of Object.entries(DICTATION_DICT.doseUnits)) for (const p of list) out.push({ kind: kind as DoseKind, pat: tokenize(normalizeVoiceText(p)) });
  return out.sort((a, b) => b.pat.length - a.pat.length);
})();

function consumeDoseUnit(tokens: string[], i: number): { kind: DoseKind; end: number } | null {
  for (const { kind, pat } of DOSE_UNIT_PATS) {
    if (i + pat.length > tokens.length) continue;
    if (pat.every((w, k) => tokens[i + k] === w)) return { kind, end: i + pat.length };
  }
  return null;
}

/** Число + единица. Число без единицы дозой не считаем. */
function parseDoseAt(tokens: string[], i: number, used: boolean[]): Dose | null {
  let j = i;
  while (j < tokens.length && !used[j] && inList(tokens[j], DICTATION_DICT.doseFillers)) j += 1;
  const n = consumeDoseNumber(tokens, j);
  if (!n) return null;
  for (let k = j; k < n.end; k++) if (used[k]) return null;
  const u = consumeDoseUnit(tokens, n.end);
  if (!u) return null;
  return { value: n.value, kind: u.kind, end: u.end };
}

function routeAt(tokens: string[], i: number): { route: DictRoute; end: number } | null {
  for (const [route, list] of Object.entries(DICTATION_DICT.routes)) {
    for (const p of list) {
      const pat = tokenize(normalizeVoiceText(p));
      if (i + pat.length <= tokens.length && pat.every((w, k) => tokens[i + k] === w)) return { route: route as DictRoute, end: i + pat.length };
    }
  }
  return null;
}
function routeEndingAt(tokens: string[], endExclusive: number): { route: DictRoute; start: number } | null {
  for (let len = 3; len >= 1; len--) {
    const s = endExclusive - len;
    if (s < 0) continue;
    const r = routeAt(tokens, s);
    if (r && r.end === endExclusive) return { route: r.route, start: s };
  }
  return null;
}

/* ───────────── возраст ───────────── */

function plural(n: number, one: string, few: string, many: string): string {
  if (!Number.isInteger(n)) return few;
  const a = n % 100, b = n % 10;
  if (a > 10 && a < 15) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
function ageUnitKind(tok: string): 'year' | 'month' | 'week' | null {
  for (const [k, list] of Object.entries(DICTATION_DICT.ageUnits)) if (inList(tok, list)) return k as 'year' | 'month' | 'week';
  return null;
}
function consumeAgePart(tokens: string[], i: number): { text: string; kind: 'year' | 'month' | 'week'; end: number } | null {
  if (tokens[i] === 'полтора' || tokens[i] === 'полторы') {
    const k = tokens[i + 1] ? ageUnitKind(tokens[i + 1]) : null;
    if (k) return { text: k === 'year' ? '1,5 года' : k === 'month' ? '1,5 мес.' : '1,5 нед.', kind: k, end: i + 2 };
    return null;
  }
  const n = consumeDoseNumber(tokens, i);
  if (!n || n.value <= 0) return null;
  const k = tokens[n.end] ? ageUnitKind(tokens[n.end]) : null;
  if (!k) return null;
  const v = fmtNum(n.value);
  const text = k === 'year' ? `${v} ${plural(n.value, 'год', 'года', 'лет')}` : k === 'month' ? `${v} мес.` : `${v} нед.`;
  return { text, kind: k, end: n.end + 1 };
}

/* ───────────── главный разбор ───────────── */

export function parseDictation(input: string, opts: { drugs?: readonly DictDrugRef[] } = {}): DictationParse {
  const raw = String(input ?? '').replace(/[.,;!?]+/g, (m, off: number, str: string) => /\d/.test(str[off - 1] ?? '') && /\d/.test(str[off + m.length] ?? '') ? m : ' | ');
  const tokens = tokenize(normalizeVoiceText(raw));
  const entries = buildDrugEntries(opts.drugs ?? []);
  // «ё» нормализация съедает; для кличек и текста операции возвращаем её из исходной фразы
  const yo = new Map<string, string>();
  for (const w of raw.toLowerCase().match(/[а-яё-]*ё[а-яё-]*/g) ?? []) yo.set(w.replace(/ё/g, 'е'), w);
  const withYo = (v: string) => v.split(' ').map(w => yo.get(w.toLowerCase()) ?? w).join(' ');
  const used = new Array<boolean>(tokens.length).fill(false);
  const items: { at: number; item: DictItem }[] = [];
  const mark = (a: number, b: number) => { for (let k = a; k < b; k++) used[k] = true; };
  const push = (at: number, item: DictItem) => items.push({ at, item });
  const text = (a: number, b: number) => tokens.slice(a, b).filter(t => t !== '|').join(' ');

  const negated = (i: number, back = 4): boolean => {
    for (let k = i - 1; k >= Math.max(0, i - back); k--) {
      if (tokens[k] === '|') break;
      if (inList(tokens[k], DICTATION_DICT.negation)) return true;
    }
    return false;
  };
  const notNow = (i: number): boolean => i > 0 && tokens[i - 1] !== '|' && inList(tokens[i - 1], DICTATION_DICT.notNow);
  const isInfinitive = (t: string) => /(ть|ться|ти)$/.test(t) && t.length > 5;

  // 1. размеры трубки: «трубкой 6.0»
  const tubes: { at: number; end: number; mm: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!inList(tokens[i], DICTATION_DICT.tubeWords)) continue;
    const e = consumeEtt(tokens, i + 1);
    if (e) { tubes.push({ at: i, end: e.end, mm: e.mm }); }
  }
  const tubeUsed = new Set<number>();
  const slangAt = (i: number): string | null => {
    const v = DICTATION_DICT.tubeSlang[tokens[i]];
    return v ? ettFromNumber(v) : null;
  };

  const nameStop = (t: string): boolean =>
    !isWordTok(t) || t.length < 2 || VITALS_FIRST.has(t) || inList(t, DICTATION_DICT.giveVerbs) || inList(t, DICTATION_DICT.noise) ||
    inList(t, DICTATION_DICT.operationVerbs) || inList(t, DICTATION_DICT.negation) || !!ageUnitKind(t) ||
    !!consumeRuNumber([t], 0) || DICTATION_DICT.events.some(ev => inList(t, ev.phrases.map(p => p.split(' ')[0])));
  const isSpecies = (t: string): DictSpecies | null => {
    for (const [sp, list] of Object.entries(DICTATION_DICT.species)) if (list.includes(t)) return sp as DictSpecies;
    return null;
  };

  const opStop = (i: number): boolean => {
    const t = tokens[i];
    if (t === '|') return true;
    if (inList(t, DICTATION_DICT.noise) && t !== 'и' && t !== 'а' && t !== 'так' && t !== 'вот') return true;
    if (VITALS_FIRST.has(t) || inList(t, DICTATION_DICT.giveVerbs)) return true;
    if (matchDrug(tokens, i, entries)) return true;
    if (matchEvent(i)) return true;
    if (consumeAgePart(tokens, i)) return true;
    return false;
  };
  const matchEvent = (i: number): { kind: DictTimeKind; len: number } | null => {
    for (const ev of DICTATION_DICT.events) {
      const len = matchAny(tokens, i, ev.phrases);
      if (len) return { kind: ev.kind, len };
    }
    return null;
  };

  let i = 0;
  while (i < tokens.length) {
    if (used[i]) { i += 1; continue; }
    const t = tokens[i];
    if (t === '|') { i += 1; continue; }

    // 2. кличка (+ вид)
    const trig = matchAny(tokens, i, DICTATION_DICT.nameTriggers);
    if (trig) {
      let j = i + trig;
      let sp: DictSpecies | null = null;
      for (;;) {
        if (j < tokens.length && tokens[j] !== '|' && inList(tokens[j], DICTATION_DICT.nameSkip)) { j += 1; continue; }
        const s = j < tokens.length ? isSpecies(tokens[j]) : null;
        if (s) { sp = s; j += 1; continue; }
        break;
      }
      if (j < tokens.length && !nameStop(tokens[j]) && !isSpecies(tokens[j]) && !matchDrug(tokens, j, entries)) {
        if (sp) push(i, { kind: 'patient', field: 'species', value: sp, raw: text(i, j) });
        push(i, { kind: 'patient', field: 'patientName', value: capitalize(withYo(tokens[j])), raw: text(i, j + 1) });
        mark(i, j + 1);
        i = j + 1; continue;
      }
      if (sp) { push(i, { kind: 'patient', field: 'species', value: sp, raw: text(i, j) }); mark(i, j); i = j; continue; }
    }

    // вид сам по себе
    const spOnly = isSpecies(t);
    if (spOnly) { push(i, { kind: 'patient', field: 'species', value: spOnly, raw: t }); mark(i, i + 1); i += 1; continue; }

    // 3. возраст
    {
      const a = consumeAgePart(tokens, i);
      if (a) {
        let text1 = a.text; let end = a.end;
        // «1 год 3 месяца»
        const skipI = tokens[end] === 'и' ? end + 1 : end;
        const b = a.kind === 'year' ? consumeAgePart(tokens, skipI) : null;
        if (b && b.kind === 'month') { text1 = `${text1} ${b.text}`; end = b.end; }
        push(i, { kind: 'patient', field: 'ageText', value: text1, raw: text(i, end) });
        mark(i, end); i = end; continue;
      }
    }

    // 4. операция: «поступил на …»
    {
      const ov = matchAny(tokens, i, DICTATION_DICT.operationVerbs);
      if (ov) {
        let j = i + ov;
        while (j < tokens.length && tokens[j] !== '|' && inList(tokens[j], DICTATION_DICT.operationSkip)) j += 1;
        if (j < tokens.length && inList(tokens[j], DICTATION_DICT.operationPreps)) {
          let k = j + 1;
          const startK = k;
          while (k < tokens.length && k - startK < 9 && !opStop(k)) k += 1;
          if (k > startK) {
            const val = withYo(tokens.slice(startK, k).join(' '));
            push(i, { kind: 'patient', field: 'operation', value: val[0].toUpperCase() + val.slice(1), raw: text(i, k) });
            mark(i, k); i = k; continue;
          }
        }
        // «поступил» без «на …» — просто глагол, не мешаем
        mark(i, i + ov); i += ov; continue;
      }
    }

    // 5. события: интубация, экстубация, индукция, операция, газ, катетер
    {
      const ev = matchEvent(i);
      if (ev) {
        const end = i + ev.len;
        const first = tokens[i];
        const blocked = negated(i) || notNow(i) || isInfinitive(first);
        if (ev.kind === 'catheter') {
          // «поставил катетер» — глагол рядом
          let hasVerb = false;
          for (let k = Math.max(0, i - 3); k < Math.min(tokens.length, end + 3); k++) {
            if (tokens[k] === '|' || k === i) continue;
            if (inList(tokens[k], DICTATION_DICT.catheterVerbs) && !isInfinitive(tokens[k])) hasVerb = true;
          }
          const veinNext = tokens[end] === 'в' && (tokens[end + 1] === 'вену' || tokens[end + 1] === 'вене');
          if ((hasVerb || veinNext) && !blocked) {
            let s = i; while (s > 0 && !used[s - 1] && tokens[s - 1] !== '|' && (inList(tokens[s - 1], DICTATION_DICT.catheterVerbs) || inList(tokens[s - 1], DICTATION_DICT.noise))) s -= 1;
            let e = end; while (e < tokens.length && inList(tokens[e], DICTATION_DICT.catheterVerbs) && !isInfinitive(tokens[e])) e += 1;
            if (veinNext && e === end) e = end + 2;
            push(i, { kind: 'time', event: 'catheter', raw: text(s, e) });
            mark(s, e); i = e; continue;
          }
        } else if (!blocked) {
          if (ev.kind === 'intubation') {
            // размер трубки: ближайший не занятый кандидат в пределах 8 слов
            let bestMm: string | null = null; let bestFrom = -1; let bestTo = -1; let bestIdx = -1; let bestD = 99;
            for (let ti = 0; ti < tubes.length; ti++) {
              if (tubeUsed.has(ti)) continue;
              const tb = tubes[ti];
              const d = tb.at >= end ? tb.at - end : i - tb.end;
              if (d < 0 || d > 8 || d >= bestD) continue;
              bestD = d; bestMm = tb.mm; bestFrom = tb.at; bestTo = tb.end; bestIdx = ti;
            }
            if (bestMm == null) {
              for (let k = Math.max(0, i - 4); k < Math.min(tokens.length, end + 8); k++) {
                if (used[k]) continue;
                const sm = slangAt(k);
                if (sm) { bestMm = sm; bestFrom = k; bestTo = k + 1; break; }
              }
            }
            if (bestMm == null) {
              // «интубировал 6.0», «интубировал на шесть»
              const e2 = consumeEtt(tokens, end);
              if (e2 && tokens.slice(end, e2.end).some(x => /\d|ноль|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять/.test(x))) {
                bestMm = e2.mm; bestFrom = end; bestTo = e2.end;
              }
            }
            const rawFrom = bestMm != null ? Math.min(i, bestFrom) : i;
            const e = bestMm != null ? Math.max(end, bestTo) : end;
            if (bestMm != null) { if (bestIdx >= 0) tubeUsed.add(bestIdx); mark(bestFrom, bestTo); }
            // слова между (напр. «трубкой») уже в tubes; прилегающие «успешно» не трогаем
            push(i, { kind: 'intubation', ...(bestMm != null ? { ettMm: bestMm } : {}), raw: text(rawFrom, e) });
            mark(i, end); i = Math.max(end, i + 1); continue;
          }
          push(i, { kind: 'time', event: ev.kind as Exclude<DictTimeKind, 'intubation'>, raw: text(i, end) });
          mark(i, end); i = end; continue;
        }
      }
    }

    // 6. препарат: [доза] препарат [доза] [путь]
    {
      let dosePre: Dose | null = null;
      let drugAt = i;
      const pre = parseDoseAt(tokens, i, used);
      if (pre) { const dm = matchDrug(tokens, pre.end, entries); if (dm) { dosePre = pre; drugAt = pre.end; } }
      const dm = matchDrug(tokens, drugAt, entries);
      if (dm) {
        const drugEnd = drugAt + dm.len;
        // назад: глаголы введения и «я/ему…» + путь
        let s = i;
        while (s > 0 && !used[s - 1] && tokens[s - 1] !== '|' && i - s < 4 &&
          (inList(tokens[s - 1], DICTATION_DICT.giveVerbs) || inList(tokens[s - 1], DICTATION_DICT.noise))) s -= 1;
        const preRoute = routeEndingAt(tokens, s);
        const gateIdx = s;
        if (negated(gateIdx, 4) || negated(i, 4)) {
          // отрицание/план: ничего не записываем; слова остаются для «не понял»
          i = drugEnd; continue;
        }
        let route: DictRoute | undefined; let routeStart = -1;
        if (preRoute && !used[preRoute.start]) { route = preRoute.route; routeStart = preRoute.start; }
        let end = drugEnd;
        let dose: Dose | null = dosePre;
        if (!dose) {
          const d = parseDoseAt(tokens, end, used);
          if (d) { dose = d; end = d.end; }
        } else end = Math.max(end, dose.end);
        if (!route) {
          let j = end;
          while (j < tokens.length && tokens[j] !== '|' && inList(tokens[j], DICTATION_DICT.doseFillers) && j - end < 2) j += 1;
          const r = routeAt(tokens, j) ?? routeAt(tokens, end);
          if (r && !used.slice(end, r.end).some(Boolean)) { route = r.route; end = r.end; }
        }
        const item: DictItem = { kind: 'drug', name: dm.entry.name, drugId: dm.entry.drugId, isNew: dm.entry.isNew, raw: text(Math.min(s, routeStart >= 0 ? routeStart : s), end) };
        if (route) item.route = route;
        if (dose) {
          if (dose.kind === 'mg/kg' || dose.kind === 'mcg/kg') { item.doseValue = fmtNum(dose.value); item.doseUnit = dose.kind; }
          else if (dose.kind === 'ml') item.volumeMl = fmtNum(dose.value);
          else item.spokenOther = `${fmtNum(dose.value)} ${dose.kind === 'mg' ? 'мг (всего)' : 'ед.'}`;
        }
        push(s, item);
        mark(Math.min(s, routeStart >= 0 ? routeStart : s), end);
        i = end; continue;
      }
    }

    // 7. «операция кастрация»
    if (inList(t, DICTATION_DICT.operationNouns) && !negated(i)) {
      let k = i + 1;
      while (k < tokens.length && k - i <= 9 && !opStop(k)) k += 1;
      if (k > i + 1) {
        const val = withYo(tokens.slice(i + 1, k).join(' '));
        push(i, { kind: 'patient', field: 'operation', value: val[0].toUpperCase() + val.slice(1), raw: text(i, k) });
        mark(i, k); i = k; continue;
      }
    }

    // размер трубки без глагола: «трубка 6.0»
    const tb = tubes.findIndex((x, idx) => !tubeUsed.has(idx) && x.at === i);
    if (tb >= 0) {
      // если дальше по фразе есть «интубировал» — размер уйдёт к нему
      let verbAhead = false;
      for (let k = tubes[tb].end; k < Math.min(tokens.length, tubes[tb].end + 9); k++) {
        const ev = matchEvent(k);
        if (ev && ev.kind === 'intubation' && !used[k] && !negated(k) && !notNow(k) && !isInfinitive(tokens[k])) { verbAhead = true; break; }
      }
      if (verbAhead) { i += 1; continue; }
      tubeUsed.add(tb);
      push(i, { kind: 'intubation', ettMm: tubes[tb].mm, sizeOnly: true, raw: text(i, tubes[tb].end) });
      mark(i, tubes[tb].end); i = tubes[tb].end; continue;
    }
    i += 1;
  }

  const keepForVitals = new Set(VOICE_DICT.fillers.map(f => norm1(f)));
  const rest = tokens.filter((t, k) => !used[k] && t !== '|' && !(inList(t, DICTATION_DICT.noise) && !keepForVitals.has(t))).join(' ');
  items.sort((a, b) => a.at - b.at);
  return { items: items.map(x => x.item), rest };
}

/* ───────────── подписи ───────────── */

export const ROUTE_LABEL: Record<DictRoute, string> = { 'в/в': 'в/в', 'в/м': 'в/м', 'п/к': 'п/к', 'внутрь': 'внутрь' };
export const SPECIES_LABEL: Record<DictSpecies, string> = { dog: 'Собака', cat: 'Кошка' };
export const TIME_EVENT_LABEL: Record<Exclude<DictTimeKind, 'intubation'>, string> = {
  induction: 'Начало анестезии (индукция)', extubation: 'Экстубация', surgeryStart: 'Начало операции',
  surgeryEnd: 'Конец операции', anesthesiaEnd: 'Конец анестезии (газ выкл.)', catheter: 'Катетер установлен',
};
export const PATIENT_FIELD_LABEL: Record<'patientName' | 'ageText' | 'operation' | 'species', string> = {
  patientName: 'Кличка', ageText: 'Возраст', operation: 'Операция', species: 'Вид',
};

export function itemTitle(it: DictItem): string {
  switch (it.kind) {
    case 'patient': return `${PATIENT_FIELD_LABEL[it.field]}: ${it.field === 'species' ? SPECIES_LABEL[it.value as DictSpecies] : it.value}`;
    case 'drug': {
      const dose = it.doseValue ? `${it.doseValue} ${it.doseUnit === 'mcg/kg' ? 'мкг/кг' : 'мг/кг'}` : it.volumeMl ? `${it.volumeMl} мл` : it.spokenOther ?? '';
      return `${it.name}${dose ? ` · ${dose}` : ''}${it.route ? ` · ${ROUTE_LABEL[it.route]}` : ''}`;
    }
    case 'intubation': return it.sizeOnly ? `Трубка ${it.ettMm} мм` : `Интубация${it.ettMm ? ` · трубка ${it.ettMm} мм` : ''}`;
    case 'time': return TIME_EVENT_LABEL[it.event];
  }
}

/** Что показать оранжевым меткой: доза не прозвучала, нового препарата не было в справочнике. */
export function itemFlags(it: DictItem): string[] {
  if (it.kind !== 'drug') return [];
  const f: string[] = [];
  if (!it.doseValue) f.push(it.volumeMl || it.spokenOther ? `${NOT_SPOKEN_DOSE} в мг/кг` : NOT_SPOKEN_DOSE);
  if (!it.route) f.push('путь не указан');
  if (it.isNew) f.push('новый в справочнике, без доз');
  return f;
}
