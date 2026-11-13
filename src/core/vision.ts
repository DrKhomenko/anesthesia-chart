// Разбор ответа модели, проверка рамок, слияние двух снимков в одну минуту, выбор времени.
import { type DeviceField, type DeviceType, type FieldRegion, FIELD_BY_KEY, fieldsFor, VENT_MODES } from './devices';

export type ParsedValue = number | string | null;
export interface ParsedReading {
  values: Record<string, ParsedValue>;
  deviceTimeRaw: string | null;
  ok: boolean;
  error?: string;
}

const BLANK = /^(null|none|n\/?a|nan|undefined|измерение|измеряется|ид[её]т измерение|measuring|in\s*progress)$/i;
const PLACEHOLDER = /^(?:[.\-–—_*x×]{1,8}|\/{1,3})$/;

export function isBlankToken(input: unknown): boolean {
  if (input == null) return true;
  const s = String(input).trim();
  if (s === '') return true;
  if (BLANK.test(s)) return true;
  if (PLACEHOLDER.test(s)) return true;
  // «---/---», «--/--/--», «-/-/-»
  if (/^(?:[.\-–—_*]+\/){1,3}[.\-–—_*]+$/.test(s)) return true;
  return false;
}

/** Число из «38,2», «72%», «0.5 л/мин». Пусто/мусор → null. */
export function parseLooseNumber(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'boolean') return null;
  if (input == null) return null;
  const s = String(input).trim();
  if (isBlankToken(s)) return null;
  const m = s.replace(/,/g, '.').match(/[-+]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function parseNibp(input: unknown): { sys: number | null; dia: number | null; map: number | null } {
  if (input == null || isBlankToken(input)) return { sys: null, dia: null, map: null };
  if (typeof input === 'object' && !Array.isArray(input)) {
    const o = input as Record<string, unknown>;
    return { sys: parseLooseNumber(o.sys ?? o.nibpSys ?? o.SYS), dia: parseLooseNumber(o.dia ?? o.nibpDia ?? o.DIA), map: parseLooseNumber(o.map ?? o.nibpMap ?? o.MAP) };
  }
  const s = String(input).trim();
  const parts = s.split(/[/]/).map(p => p.trim());
  const num = (p: string | undefined) => (p == null || p === '' || isBlankToken(p) ? null : parseLooseNumber(p));
  return { sys: num(parts[0]), dia: num(parts[1]), map: num(parts[2]) };
}

export function extractJsonText(text: string): string | null {
  if (!text) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fence ? fence[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
}

export function parseJsonRelaxed(text: string): unknown | null {
  const src = extractJsonText(text);
  if (!src) return null;
  try { return JSON.parse(src); } catch { /* trailing commas */ }
  try { return JSON.parse(src.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}

function lookup(obj: Record<string, unknown>, field: DeviceField): unknown {
  if (field.key in obj) return obj[field.key];
  for (const a of field.aliases ?? []) if (a in obj) return obj[a];
  return undefined;
}

function coerce(raw: unknown, field: DeviceField): ParsedValue {
  if (raw == null || isBlankToken(raw)) return null;
  if (field.kind === 'number') return parseLooseNumber(raw);
  const s = String(raw).trim();
  if (isBlankToken(s)) return null;
  if (field.key === 'setIE') return s.replace(/\s+/g, '').replace('/', ':');
  if (field.kind === 'enum' && field.enumValues) {
    const hit = field.enumValues.find(v => v.toLowerCase() === s.toLowerCase());
    if (hit) return hit;
    if (/^manual|man|ручн/i.test(s)) return 'Manual';
    return s;
  }
  return s;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** Разбор ответа модели по шаблону прибора. Мусор → ok: false и пустые значения. */
export function parseModelOutput(text: string, fields: DeviceField[]): ParsedReading {
  const empty: Record<string, ParsedValue> = {};
  for (const f of fields) empty[f.key] = null;
  const data = parseJsonRelaxed(text);
  const obj = asRecord(data);
  if (!obj) return { values: empty, deviceTimeRaw: null, ok: false, error: 'Модель вернула не JSON' };

  const values = { ...empty };
  const nibpFields = fields.filter(f => f.key === 'nibpSys' || f.key === 'nibpDia' || f.key === 'nibpMap');
  const nibpRaw = obj.nibp ?? obj.NIBP ?? obj.nibpValue;
  if (nibpFields.length && nibpRaw != null) {
    const n = parseNibp(nibpRaw);
    if (values.nibpSys === null && fields.some(f => f.key === 'nibpSys')) values.nibpSys = n.sys;
    if (values.nibpDia === null && fields.some(f => f.key === 'nibpDia')) values.nibpDia = n.dia;
    if (values.nibpMap === null && fields.some(f => f.key === 'nibpMap')) values.nibpMap = n.map;
  }
  for (const f of fields) {
    const raw = lookup(obj, f);
    if (raw === undefined) continue;
    const v = coerce(raw, f);
    // составной НИАД не затирает уже разобранное, если поле пустое-null из «---», это ок
    values[f.key] = v;
  }

  const rawTime = obj.deviceTime ?? obj.deviceClock ?? obj.clock ?? obj.time ?? obj.Time ?? null;
  const deviceTimeRaw = rawTime == null || isBlankToken(rawTime) ? null : String(rawTime).trim();
  return { values, deviceTimeRaw, ok: true };
}

export function isOutOfRange(field: DeviceField, value: ParsedValue): boolean {
  if (value == null || field.kind !== 'number') return false;
  const n = typeof value === 'number' ? value : parseLooseNumber(value);
  if (n == null) return false;
  if (field.min != null && n < field.min) return true;
  if (field.max != null && n > field.max) return true;
  return false;
}

export function rangeFlags(fields: DeviceField[], values: Record<string, ParsedValue>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const f of fields) out[f.key] = isOutOfRange(f, values[f.key] ?? null);
  return out;
}

const DATE_RE = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;
const TIME_RE = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/;

function yearOf(y: number): number { return y < 100 ? 2000 + y : y; }

/** Разбор часов прибора: «12:47:47», «12:47», «12:47:47 13-11-2026», ISO. Без даты — берём день из now. */
export function parseDeviceTime(raw: string | null | undefined, now: Date): Date | null {
  if (raw == null || isBlankToken(raw)) return null;
  const s = String(raw).trim();
  const iso = ISO_RE.exec(s);
  if (iso) {
    const d = new Date(now.getTime());
    d.setFullYear(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    d.setHours(Number(iso[4]), Number(iso[5]), Number(iso[6] ?? 0), 0);
    return d;
  }
  const time = TIME_RE.exec(s);
  if (!time) return null;
  const date = DATE_RE.exec(s);
  const d = new Date(now.getTime());
  if (date) {
    const a = Number(date[1]), b = Number(date[2]), y = yearOf(Number(date[3]));
    // ДД-ММ-ГГГГ, если первое число > 12; иначе если второе > 12 — ММ-ДД; иначе ДД-ММ (европейский)
    if (a > 12) d.setFullYear(y, b - 1, a);
    else if (b > 12) d.setFullYear(y, a - 1, b);
    else d.setFullYear(y, b - 1, a);
  }
  d.setHours(Number(time[1]), Number(time[2]), Number(time[3] ?? 0), 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const DEVICE_TIME_WINDOW_MIN = 10;

/** Часы прибора, если они есть и отличаются от «сейчас» не больше чем на 10 минут; иначе now. */
export function chooseTickTime(deviceTimeRaw: string | null | undefined, now: Date, windowMin = DEVICE_TIME_WINDOW_MIN): { at: Date; usedDeviceTime: boolean } {
  const d = parseDeviceTime(deviceTimeRaw, now);
  if (!d) return { at: new Date(now.getTime()), usedDeviceTime: false };
  if (Math.abs(d.getTime() - now.getTime()) <= windowMin * 60_000) return { at: d, usedDeviceTime: true };
  return { at: new Date(now.getTime()), usedDeviceTime: false };
}

export function minuteKey(at: string | Date): number {
  const d = new Date(typeof at === 'string' ? at : at.getTime());
  d.setSeconds(0, 0);
  return d.getTime();
}

export function mergeValues(base: Record<string, ParsedValue>, incoming: Record<string, ParsedValue>): Record<string, ParsedValue> {
  const out = { ...base };
  for (const [k, v] of Object.entries(incoming)) if (v != null && v !== '') out[k] = v;
  return out;
}

export function findTickAtMinute<T extends { at: string; deletedAt?: string | null }>(ticks: T[], at: string | Date): T | undefined {
  const k = minuteKey(at);
  return ticks.find(t => !t.deletedAt && minuteKey(t.at) === k);
}

/** Если рядом уже есть запись (по умолчанию ±2 мин), предлагаем её минуту, чтобы монитор и НДА легли вместе. */
export function suggestMergeTime<T extends { at: string; deletedAt?: string | null }>(ticks: T[], proposed: Date, windowMin = 2): { at: Date; existing: T | undefined } {
  let best: { t: T; dist: number } | undefined;
  for (const t of ticks) {
    if (t.deletedAt) continue;
    const dist = Math.abs(new Date(t.at).getTime() - proposed.getTime());
    if (dist <= windowMin * 60_000 && (!best || dist < best.dist)) best = { t, dist };
  }
  if (!best) return { at: proposed, existing: undefined };
  const snapped = new Date(best.t.at);
  // сохраняем секунды существующей записи, чтобы не плодить расхождения; для ключа важна минута
  return { at: snapped, existing: best.t };
}

export function resolveTickTime<T extends { at: string; deletedAt?: string | null }>(opts: {
  deviceTimeRaw: string | null | undefined; now: Date; existingTicks: T[];
  deviceWindowMin?: number; mergeWindowMin?: number;
}): { at: Date; usedDeviceTime: boolean; existing: T | undefined } {
  const chosen = chooseTickTime(opts.deviceTimeRaw, opts.now, opts.deviceWindowMin);
  const merge = suggestMergeTime(opts.existingTicks, chosen.at, opts.mergeWindowMin);
  return { at: merge.at, usedDeviceTime: chosen.usedDeviceTime && !merge.existing, existing: merge.existing };
}

export function emptyValues(fields: DeviceField[]): Record<string, ParsedValue> {
  const v: Record<string, ParsedValue> = {};
  for (const f of fields) v[f.key] = null;
  return v;
}

export interface PromptDevice {
  type: DeviceType;
  name: string;
  fields: DeviceField[];
  regions?: Record<string, FieldRegion>;
}

export function buildVisionPrompt(device: PromptDevice): string {
  const typeRu = device.type === 'monitor' ? 'a veterinary patient monitor' : 'a veterinary anesthesia machine (ventilator)';
  const lines = device.fields.map(f => {
    const range = f.kind === 'number' && (f.min != null || f.max != null)
      ? `, plausible range ${f.min ?? '…'}–${f.max ?? '…'}` : '';
    const en = f.enumValues ? `, one of: ${f.enumValues.join(', ')}` : '';
    const region = device.regions?.[f.key];
    const loc = region ? `, approx. region x=${region.x.toFixed(2)} y=${region.y.toFixed(2)} w=${region.w.toFixed(2)} h=${region.h.toFixed(2)} (normalized 0–1)` : '';
    return `- ${f.key}: ${f.label}${f.unit ? ' (' + f.unit + ')' : ''}${range}${en}${loc}`;
  });
  return [
    `You are reading a photo of ${typeRu} named "${device.name}".`,
    'Extract the on-screen values. Return ONLY a JSON object with the keys listed below, plus "deviceTime".',
    'If a value is missing, unreadable, blank, still measuring, or shown as ---, --, — or similar, return null for that key.',
    'Use a dot as the decimal separator. Do not invent or guess values. Do not include extra keys besides those requested.',
    'NIBP (non-invasive blood pressure) may appear as SYS/DIA/MAP or as ---/---. If you see a combined reading, you may also set "nibp" to that string (e.g. "110/65/80" or "---/---") in addition to nibpSys, nibpDia, nibpMap.',
    'deviceTime is the clock shown on the device: "YYYY-MM-DDTHH:MM:SS" if the date is visible, otherwise "HH:MM:SS" or "HH:MM".',
    'This machine has no anesthetic gas module: do not invent Sevo or Iso percentages.',
    '',
    'Fields:',
    ...lines,
    '- deviceTime: clock on the device screen',
  ].join('\n');
}

export function promptForDevice(type: DeviceType, name: string, fieldKeys: string[], regions?: Record<string, FieldRegion>): string {
  return buildVisionPrompt({ type, name, fields: fieldsFor(type, fieldKeys), regions });
}

export { FIELD_BY_KEY, VENT_MODES, fieldsFor };
