// Быстрый ручной ввод минуты. Порядок полей — из шаблонов приборов, дозы и пороги не придумываются.
import { FIELD_BY_KEY, MACHINE_FIELDS, MONITOR_FIELDS, type DeviceField, type FieldKind } from './devices';
import { fmt, parseNum } from './logic';
import { isOutOfRange, type ParsedValue } from './vision';
import type { VitalFields } from '../db/db';

export interface EntryField {
  key: string;
  label: string;
  unit: string;
  kind: FieldKind;
  enumValues?: string[];
  allowDecimal: boolean;
  min?: number | null;
  max?: number | null;
  source: 'monitor' | 'machine' | 'manual';
}

/** ЧСС, SpO₂, EtCO₂, ЧДД, T, АД сист/диаст/ср, Sevo/Iso %, FiO₂, Pпик, VT */
export const DEFAULT_ENTRY_KEYS: readonly string[] = [
  'hr', 'spo2', 'etco2', 'rr', 'tempC',
  'nibpSys', 'nibpDia', 'nibpMap',
  'sevoPct', 'isoPct',
  'fio2', 'pPeak', 'vtInsp',
];

export const MANUAL_ENTRY_KEYS: readonly string[] = ['sevoPct', 'isoPct'];

const DEFAULT_MONITOR_KEYS = ['hr', 'spo2', 'etco2', 'rr', 'tempC', 'nibpSys', 'nibpDia', 'nibpMap'];
const DEFAULT_MACHINE_KEYS = ['fio2', 'pPeak', 'vtInsp'];

const DECIMAL_KEYS = new Set([
  'tempC', 't1', 't2', 'sevoPct', 'isoPct', 'setTslope', 'mv', 'raw', 'compliance',
]);

const ENTRY_TO_TICK: Record<string, keyof VitalFields> = {
  nibpSys: 'sys', nibpDia: 'dia', nibpMap: 'map', tempC: 'tempC',
};

const OVERRIDE: Record<string, Partial<EntryField> & { label: string; source: EntryField['source'] }> = {
  tempC: { label: 'T', unit: '°C', kind: 'number', allowDecimal: true, min: 15, max: 45, source: 'monitor' },
  sevoPct: { label: 'Sevo', unit: '%', kind: 'number', allowDecimal: true, source: 'manual' },
  isoPct: { label: 'Iso', unit: '%', kind: 'number', allowDecimal: true, source: 'manual' },
  nibpSys: { label: 'АД сист', source: 'monitor' },
  nibpDia: { label: 'АД диаст', source: 'monitor' },
  nibpMap: { label: 'АД ср', source: 'monitor' },
  vtInsp: { label: 'VT', source: 'machine' },
};

function unique(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function allowDecimalOf(key: string, field?: DeviceField): boolean {
  if (DECIMAL_KEYS.has(key)) return true;
  if (!field || field.kind !== 'number') return false;
  const nonInt = (n: number | null | undefined) => n != null && !Number.isInteger(n);
  return nonInt(field.min) || nonInt(field.max);
}

export function entryFieldByKey(key: string): EntryField | undefined {
  const over = OVERRIDE[key];
  const dev = FIELD_BY_KEY[key];
  if (!over && !dev) return undefined;
  const source: EntryField['source'] = over?.source
    ?? (MONITOR_FIELDS.some(f => f.key === key) ? 'monitor' : 'machine');
  const kind: FieldKind = over?.kind ?? dev?.kind ?? 'number';
  return {
    key,
    label: over?.label ?? dev?.label ?? key,
    unit: over?.unit ?? dev?.unit ?? '',
    kind,
    enumValues: over?.enumValues ?? dev?.enumValues,
    allowDecimal: over?.allowDecimal ?? allowDecimalOf(key, dev),
    min: over?.min !== undefined ? over.min : dev?.min,
    max: over?.max !== undefined ? over.max : dev?.max,
    source,
  };
}

/** Ключи монитора для ввода: t2 (или t1, если t2 нет) становится полем T. */
export function monitorEntryKeys(fieldKeys?: string[] | null): string[] {
  const src = fieldKeys == null ? DEFAULT_MONITOR_KEYS : fieldKeys;
  const hasT2 = src.includes('t2');
  const out: string[] = [];
  for (const k of src) {
    if (k === 't2') out.push('tempC');
    else if (k === 't1') out.push(hasT2 ? 't1' : 'tempC');
    else out.push(k);
  }
  return unique(out);
}

export function machineEntryKeys(fieldKeys?: string[] | null): string[] {
  return unique(fieldKeys == null ? [...DEFAULT_MACHINE_KEYS] : [...fieldKeys]);
}

/**
 * Порядок ввода минуты: ЧСС…VT. Список короткий, чтобы запись занимала секунды.
 * Шаблон прибора в Настройках включает и выключает поля (монитор, затем НДА).
 * Sevo и Iso всегда в списке — модуля газов нет. Лишние поля шаблона в минуту не добавляются.
 */
export function entryFieldOrder(opts: {
  monitorFieldKeys?: string[] | null;
  machineFieldKeys?: string[] | null;
} = {}): EntryField[] {
  const mon = new Set(monitorEntryKeys(opts.monitorFieldKeys));
  const mach = new Set(machineEntryKeys(opts.machineFieldKeys));
  const keys = DEFAULT_ENTRY_KEYS.filter(k => {
    if ((MANUAL_ENTRY_KEYS as readonly string[]).includes(k)) return true;
    const src = entryFieldByKey(k)?.source;
    if (src === 'monitor') return mon.has(k);
    if (src === 'machine') return mach.has(k);
    return true;
  });
  return keys.map(entryFieldByKey).filter((f): f is EntryField => !!f);
}

export function previousValueForKey(tick: VitalFields | null | undefined, key: string): ParsedValue {
  if (!tick) return null;
  if (key === 'nibpSys') return tick.sys ?? null;
  if (key === 'nibpDia') return tick.dia ?? null;
  if (key === 'nibpMap') return tick.map ?? null;
  if (key === 'tempC') {
    const v = tick.tempC ?? tick.t2 ?? null;
    return v == null ? null : v;
  }
  const v = (tick as Record<string, unknown>)[key];
  if (v == null || v === '') return null;
  return v as ParsedValue;
}

export function formatPrevious(tick: VitalFields | null | undefined, key: string): string {
  const v = previousValueForKey(tick, key);
  if (v == null) return '';
  return typeof v === 'number' ? fmt(v, 3) : String(v);
}

export function copyPreviousValue(
  draft: Record<string, string>,
  key: string,
  prev: VitalFields | null | undefined,
): Record<string, string> {
  const s = formatPrevious(prev, key);
  if (s === '') return draft;
  return { ...draft, [key]: s };
}

/** Заполняет только пустые («неизменённые») поля значениями прошлой записи. */
export function copyAllPrevious(
  draft: Record<string, string>,
  keys: string[],
  prev: VitalFields | null | undefined,
): Record<string, string> {
  let next = { ...draft };
  for (const k of keys) {
    if ((next[k] ?? '').trim() !== '') continue;
    next = copyPreviousValue(next, k, prev);
  }
  return next;
}

export function previousTick<T extends { at: string; deletedAt?: string | null }>(
  ticks: T[],
  at: string,
): T | undefined {
  const live = ticks.filter(t => !t.deletedAt).sort((a, b) => a.at.localeCompare(b.at));
  const before = live.filter(t => t.at <= at);
  return before.length ? before[before.length - 1] : undefined;
}

const MAX_DIGITS = 8;

/** Клавиша цифровой клавиатуры. Точка и запятая — десятичный разделитель. */
export function applyKeypad(current: string, key: string, allowDecimal: boolean): string {
  if (key === '⌫' || key === 'Backspace' || key === 'backspace') return current.slice(0, -1);
  if (key === '.' || key === ',') {
    if (!allowDecimal) return current;
    if (current.includes(',')) return current;
    return current === '' ? '0,' : `${current},`;
  }
  if (!/^\d$/.test(key)) return current;
  if (current === '0') return key;
  const digits = current.replace(',', '').length;
  if (digits >= MAX_DIGITS) return current;
  return current + key;
}

export function parseEntryValue(raw: string, field: EntryField): ParsedValue {
  const s = raw.trim();
  if (s === '') return null;
  if (field.kind === 'number') {
    const n = parseNum(s);
    return Number.isFinite(n) ? n : null;
  }
  return s;
}

export function isEntryOutOfRange(field: EntryField, raw: string): boolean {
  if (field.kind !== 'number') return false;
  const v = parseEntryValue(raw, field);
  return isOutOfRange(field, v);
}

export function emptyDraft(fields: EntryField[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const f of fields) o[f.key] = '';
  return o;
}

export function entryDraftToValues(draft: Record<string, string>, fields: EntryField[]): Record<string, ParsedValue> {
  const out: Record<string, ParsedValue> = {};
  for (const f of fields) out[f.key] = parseEntryValue(draft[f.key] ?? '', f);
  return out;
}

/** Пустые поля не попадают в запись — ими ничего не затирается. */
export function entryDraftToPatch(draft: Record<string, string>, fields: EntryField[]): Partial<VitalFields> {
  const patch: Partial<VitalFields> = {};
  for (const f of fields) {
    const v = parseEntryValue(draft[f.key] ?? '', f);
    if (v == null || v === '') continue;
    const tickKey = ENTRY_TO_TICK[f.key] ?? (f.key as keyof VitalFields);
    (patch as Record<string, unknown>)[tickKey] = v;
  }
  if (patch.tempC != null && patch.t2 == null) patch.t2 = patch.tempC;
  if (patch.vtInsp != null && patch.tidalVolume == null) patch.tidalVolume = patch.vtInsp;
  return patch;
}

export { MACHINE_FIELDS, MONITOR_FIELDS };
