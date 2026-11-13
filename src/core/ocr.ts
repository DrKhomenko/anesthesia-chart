// Разбор текста OCR, проверка уверенности и рамок, обход полей шаблона. Сам движок (tesseract) подключается снаружи.
import type { DeviceField, FieldRegion } from './devices';
import { cropRegion, hasInk, preprocessCrop, type Pix } from './geom';
import {
  emptyValues, isBlankToken, isOutOfRange, parseDeviceTime, parseLooseNumber, parseNibp,
  type ParsedReading, type ParsedValue,
} from './vision';

export const DEVICE_TIME_REGION_KEY = '_deviceTime';
export const NIBP_REGION_KEY = 'nibp';
export const MIN_OCR_CONFIDENCE = 30;
export const OCR_DIGIT_WHITELIST = '0123456789.,/:-';
export const OCR_TEXT_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-';

export type OcrKind = 'digits' | 'text';
export type OcrReason = 'ok' | 'unreadable' | 'low-confidence' | 'out-of-range' | 'no-region';
export type OcrFn = (pix: Pix, kind: OcrKind) => Promise<{ text: string; confidence: number }>;

export interface FieldOcrResult {
  key: string;
  raw: string;
  value: ParsedValue;
  confidence: number;
  reason: OcrReason;
}

export interface RecognizeFieldsResult extends ParsedReading {
  flags: Record<string, OcrReason>;
  details: FieldOcrResult[];
}

function looksLikeIE(s: string): string | null {
  const t = s.trim().replace(/\s+/g, '').replace('/', ':');
  if (/^\d+:\d+$/.test(t)) return t;
  // двоеточие часто читается как точка: «1.2» при I:E 1:2
  const m = /^(\d+)[.,](\d+)$/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 4 && Number(m[2]) >= 1 && Number(m[2]) <= 8) return `${m[1]}:${m[2]}`;
  return null;
}

/** Текст по сути одно число (допустимы подписи вроде «ЧДД 12»). */
export function isCleanNumericText(raw: string, n: number): boolean {
  const nums = raw.replace(/,/g, '.').match(/[-+]?\d+(?:[.,]\d+)?/g) ?? [];
  if (nums.length !== 1) return false;
  const parsed = parseLooseNumber(nums[0]);
  return parsed != null && Math.abs(parsed - n) < 1e-6;
}

/** Среди чисел в тексте берём самое «полное» в рамке поля («1 37» → 37). */
export function bestNumberInText(raw: string, field: DeviceField): number | null {
  const nums = (raw.replace(/,/g, '.').match(/[-+]?\d+(?:\.\d+)?/g) ?? [])
    .map(s => parseLooseNumber(s))
    .filter((n): n is number => n != null);
  if (!nums.length) return null;
  const inRange = nums.filter(n => !isOutOfRange(field, n));
  const pool = inRange.length ? inRange : nums;
  pool.sort((a, b) => String(b).replace('.', '').length - String(a).replace('.', '').length);
  return pool[0];
}

function digitLen(n: number): number { return String(n).replace('.', '').length; }

export function acceptOcrValue(field: DeviceField, rawText: string, confidence: number, minConf = MIN_OCR_CONFIDENCE): FieldOcrResult {
  const raw = (rawText ?? '').replace(/\s+/g, ' ').trim();
  const base = { key: field.key, raw, confidence, value: null as ParsedValue, reason: 'unreadable' as OcrReason };
  if (!raw || isBlankToken(raw)) return { ...base, reason: 'unreadable' };

  if (field.key === 'setIE') {
    if (confidence < 15 && !looksLikeIE(raw)) return { ...base, reason: 'low-confidence' };
    const ie = looksLikeIE(raw);
    if (!ie) return { ...base, reason: 'unreadable' };
    return { ...base, value: ie, reason: 'ok' };
  }

  if (field.kind === 'number') {
    const n = bestNumberInText(raw, field);
    if (n == null) return { ...base, reason: 'unreadable' };
    if (isOutOfRange(field, n)) return { ...base, value: n, reason: 'out-of-range' };
    // однозначный фрагмент («1» вместо «12») при низкой уверенности не принимаем
    if (digitLen(n) === 1 && confidence < 25) return { ...base, reason: 'low-confidence' };
    if (confidence < minConf && !isCleanNumericText(raw, n)) return { ...base, reason: 'low-confidence' };
    return { ...base, value: n, reason: 'ok' };
  }

  if (field.kind === 'enum' && field.enumValues) {
    const compact = raw.replace(/\s+/g, '');
    const hit = field.enumValues.find(v => v.toLowerCase() === compact.toLowerCase() || compact.toLowerCase().includes(v.toLowerCase()));
    if (hit) return { ...base, value: hit, reason: 'ok' };
    if (/^manual|man|ручн/i.test(compact)) return { ...base, value: 'Manual', reason: 'ok' };
    return { ...base, reason: 'unreadable' };
  }

  if (isBlankToken(raw)) return { ...base, reason: 'unreadable' };
  return { ...base, value: raw, reason: 'ok' };
}

export function acceptNibp(rawText: string, confidence: number, minConf = MIN_OCR_CONFIDENCE): { sys: number | null; dia: number | null; map: number | null; reason: OcrReason; raw: string } {
  const raw = (rawText ?? '').replace(/\s+/g, '').trim();
  if (!raw || isBlankToken(raw) || /^(?:[.\-–—_*]+\/){1,3}[.\-–—_*]+$/.test(raw))
    return { sys: null, dia: null, map: null, reason: 'unreadable', raw };
  if (confidence < minConf) return { sys: null, dia: null, map: null, reason: 'low-confidence', raw };
  const n = parseNibp(raw);
  if (n.sys == null && n.dia == null && n.map == null) return { ...n, reason: 'unreadable', raw };
  return { ...n, reason: 'ok', raw };
}

function pickOcrCandidate(cands: { text: string; confidence: number }[], field?: DeviceField): { text: string; confidence: number; empty: boolean } {
  const scored = cands
    .map(c => {
      const text = (c.text ?? '').trim();
      if (!text) return { text, confidence: c.confidence, empty: true, inRange: false, digits: 0, score: -1 };
      let inRange = false, digits = text.length, score = c.confidence;
      if (field?.kind === 'number') {
        const n = bestNumberInText(text, field);
        if (n != null) {
          digits = digitLen(n);
          inRange = !isOutOfRange(field, n);
          score = (inRange ? 200 : 0) + digits * 40 + c.confidence;
        } else score = c.confidence * 0.2;
      } else if (field?.kind === 'enum' && field.enumValues?.some(v => text.toLowerCase().includes(v.toLowerCase()))) {
        inRange = true; score = 200 + c.confidence;
      } else if (field?.key === 'setIE' && looksLikeIE(text)) {
        inRange = true; score = 200 + c.confidence;
      }
      return { text, confidence: c.confidence, empty: false, inRange, digits, score };
    })
    .filter(c => !c.empty);
  if (!scored.length) return { text: '', confidence: 0, empty: true };
  scored.sort((a, b) => b.score - a.score);
  const w = scored[0];
  return { text: w.text, confidence: w.confidence, empty: false };
}

async function ocrRegion(screen: Pix, region: FieldRegion, kind: OcrKind, ocr: OcrFn, field?: DeviceField): Promise<{ text: string; confidence: number; empty: boolean }> {
  const rawCrop = cropRegion(screen, region);
  const cands: { text: string; confidence: number }[] = [];
  for (const threshold of [false, true]) {
    const crop = preprocessCrop(rawCrop, { threshold });
    if (!hasInk(crop)) continue;
    cands.push(await ocr(crop, kind));
  }
  return pickOcrCandidate(cands, field);
}

export async function recognizeFields(opts: {
  screen: Pix;
  fields: DeviceField[];
  regions: Record<string, FieldRegion>;
  ocr: OcrFn;
  minConfidence?: number;
  now?: Date;
}): Promise<RecognizeFieldsResult> {
  const { screen, fields, regions, ocr } = opts;
  const minConf = opts.minConfidence ?? MIN_OCR_CONFIDENCE;
  const values = emptyValues(fields);
  const flags: Record<string, OcrReason> = {};
  const details: FieldOcrResult[] = [];
  let deviceTimeRaw: string | null = null;

  if (regions[DEVICE_TIME_REGION_KEY]) {
    const r = await ocrRegion(screen, regions[DEVICE_TIME_REGION_KEY], 'digits', ocr);
    if (!r.empty) {
      const parsed = parseDeviceTime(r.text, opts.now ?? new Date());
      if (parsed) deviceTimeRaw = r.text.replace(/\s+/g, ' ').trim();
    }
  }

  const nibpFields = fields.filter(f => f.key === 'nibpSys' || f.key === 'nibpDia' || f.key === 'nibpMap');
  if (nibpFields.length && regions[NIBP_REGION_KEY]) {
    const r = await ocrRegion(screen, regions[NIBP_REGION_KEY], 'digits', ocr);
    const acc = acceptNibp(r.empty ? '' : r.text, r.confidence, minConf);
    if (values.nibpSys !== undefined) values.nibpSys = acc.sys;
    if (values.nibpDia !== undefined) values.nibpDia = acc.dia;
    if (values.nibpMap !== undefined) values.nibpMap = acc.map;
    for (const f of nibpFields) {
      const one: FieldOcrResult = { key: f.key, raw: acc.raw, value: values[f.key] ?? null, confidence: r.confidence, reason: acc.reason };
      details.push(one);
      if (acc.reason !== 'ok') flags[f.key] = acc.reason;
    }
  }

  for (const f of fields) {
    if (nibpFields.includes(f) && regions[NIBP_REGION_KEY]) continue;
    const region = regions[f.key];
    if (!region) {
      const d: FieldOcrResult = { key: f.key, raw: '', value: null, confidence: 0, reason: 'no-region' };
      details.push(d); flags[f.key] = 'no-region';
      continue;
    }
    const kind: OcrKind = f.kind === 'enum' ? 'text' : 'digits';
    const r = await ocrRegion(screen, region, kind, ocr, f);
    const acc = acceptOcrValue(f, r.empty ? '' : r.text, r.confidence, minConf);
    values[f.key] = acc.reason === 'out-of-range' ? acc.value : (acc.reason === 'ok' ? acc.value : null);
    // вне рамки показываем прочитанное, но помечаем; низкая уверенность — пусто
    if (acc.reason === 'out-of-range') values[f.key] = acc.value;
    details.push(acc);
    if (acc.reason !== 'ok') flags[f.key] = acc.reason;
  }

  return { values, deviceTimeRaw, ok: true, flags, details };
}

export const FLAG_HINT: Record<OcrReason, string> = {
  ok: '',
  unreadable: 'не распознано',
  'low-confidence': 'низкая уверенность — проверьте',
  'out-of-range': 'вне рамки',
  'no-region': 'нет рамки в шаблоне',
};
