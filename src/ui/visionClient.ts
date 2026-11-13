import type { DeviceRec, RecognitionProvider } from '../db/db';
import { fieldsFor } from '../core/devices';
import { buildVisionPrompt, emptyValues, parseModelOutput, type ParsedReading } from '../core/vision';
import { normalizedQuadToPixels, outputSizeForQuad, warpPerspective, type Pix, type Quad } from '../core/geom';
import { releaseCanvas, stepError } from './errorText';

export const MAX_IMAGE_SIDE = 1600;
export const CLOUD_MAX_SIDE = 1400;
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_TITLE = 'Наркозная карта';
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys';
export const OPENROUTER_DEFAULT_MODEL = 'google/gemma-4-31b-it:free';
export const OPENROUTER_FALLBACK_MODELS = [
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-26b-a4b-it:free',
] as const;
/** Бесплатные модели OpenRouter с входом image, по состоянию на 13.11.2026. */
export const OPENROUTER_FREE_VISION_MODELS: { id: string; label: string }[] = [
  { id: 'google/gemma-4-31b-it:free', label: 'Google Gemma 4 31B (рекомендуется)' },
  { id: 'nvidia/nemotron-3.5-super-vl:free', label: 'NVIDIA Nemotron 3.5 Super VL' },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Google Gemma 4 26B' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'NVIDIA Nemotron 3 Nano Omni' },
  { id: 'thinkingmachines/inkling-2-small:free', label: 'Thinking Machines Inkling 2 Small' },
  { id: 'dots-studio/dots-3-note-preview:free', label: 'Dots3-Note Preview' },
  { id: 'particle-ai/particle-1:free', label: 'Particle-1' },
];
export const OPENROUTER_RATE_LIMIT_MSG = 'Бесплатный лимит OpenRouter исчерпан, попробуйте позже';

export function isOpenRouterUrl(baseUrl: string): boolean {
  const raw = baseUrl.trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch {
    return /openrouter\.ai/i.test(raw);
  }
}

export function appSiteUrl(): string {
  const fallback = 'https://drkhomenko.github.io/anesthesia-chart/';
  if (typeof window === 'undefined' || !window.location?.origin) return fallback;
  const origin = window.location.origin;
  const base = (import.meta.env?.BASE_URL as string | undefined) || '/';
  if (/^https?:\/\//i.test(base)) return base.endsWith('/') ? base : `${base}/`;
  const path = `${origin}${base.startsWith('/') ? base : `/${base}`}`;
  return path.endsWith('/') ? path : `${path}/`;
}

/** Браузерный fetch принимает только Latin-1 в значении заголовка, поэтому кириллицу кодируем. */
export function asHeaderValue(value: string): string {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 255) return encodeURIComponent(value);
  }
  return value;
}

export function openRouterHeaders(referer?: string): Record<string, string> {
  return {
    'HTTP-Referer': referer ?? appSiteUrl(),
    'X-Title': asHeaderValue(OPENROUTER_TITLE),
  };
}

export function applyOpenRouterFreePreset(s: { recognitionModel?: string }): {
  recognitionProvider: 'cloud';
  recognitionBaseUrl: string;
  recognitionModel: string;
} {
  const current = s.recognitionModel?.trim() ?? '';
  const keep = OPENROUTER_FREE_VISION_MODELS.some(m => m.id === current);
  return {
    recognitionProvider: 'cloud',
    recognitionBaseUrl: OPENROUTER_BASE_URL,
    recognitionModel: keep ? current : OPENROUTER_DEFAULT_MODEL,
  };
}

export function cloudHttpError(status: number, body: string, baseUrl: string): string {
  if (status === 429 && isOpenRouterUrl(baseUrl)) return OPENROUTER_RATE_LIMIT_MSG;
  if (status === 429) return 'Превышен лимит запросов, попробуйте позже';
  const corsHint = status === 0 ? ' Сервер отклонил запрос из браузера (CORS).' : '';
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 180);
  return `Сервер ответил ${status}${corsHint}${snippet ? ` ${snippet}` : ''}`.trim();
}

export async function prepareCloudImage(dataUrl: string, maxSide = CLOUD_MAX_SIDE, quality = 0.85): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return (await downscaleImage(blob, maxSide, quality)).dataUrl;
}

export function recognitionProviderOf(s: { recognitionProvider?: string }): RecognitionProvider {
  return s.recognitionProvider === 'cloud' ? 'cloud' : 'on-device';
}

export function hasRecognitionReady(s: { recognitionProvider?: string; recognitionBaseUrl: string; recognitionModel: string; recognitionApiKey: string }, online: boolean): boolean {
  if (recognitionProviderOf(s) === 'on-device') return true;
  return online && !!s.recognitionApiKey.trim() && !!s.recognitionBaseUrl.trim() && !!s.recognitionModel.trim();
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось открыть снимок'));
    img.src = dataUrl;
  });
}

export async function pixFromDataUrl(dataUrl: string, maxSide = MAX_IMAGE_SIDE): Promise<Pix> {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  try {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Нет canvas');
    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    // Копия буфера, чтобы можно было сразу освободить canvas на iOS.
    return { data: new Uint8ClampedArray(imgData.data), width, height };
  } finally {
    releaseCanvas(c);
    img.src = '';
  }
}

export function dataUrlFromPix(pix: Pix, type = 'image/jpeg', quality = 0.92): string {
  const c = document.createElement('canvas');
  try {
    c.width = pix.width; c.height = pix.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Нет canvas');
    const img = ctx.createImageData(pix.width, pix.height);
    img.data.set(pix.data);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL(type, quality);
  } finally {
    releaseCanvas(c);
  }
}

export async function warpPhoto(dataUrl: string, quadNorm: Quad): Promise<{ pix: Pix; dataUrl: string }> {
  try {
    const src = await pixFromDataUrl(dataUrl);
    const quadPx = normalizedQuadToPixels(quadNorm, src.width, src.height);
    const size = outputSizeForQuad(quadPx);
    const pix = warpPerspective(src, quadPx, size.width, size.height);
    return { pix, dataUrl: dataUrlFromPix(pix) };
  } catch (e) {
    throw stepError('выравнивание', e);
  }
}

export function chatCompletionsUrl(baseUrl: string): string {
  const u = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v1$/i.test(u)) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

export async function downscaleImage(file: Blob, maxSide = MAX_IMAGE_SIDE, quality = 0.85): Promise<{ dataUrl: string; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    try {
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Нет canvas');
      ctx.drawImage(bmp, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      return { dataUrl, width, height };
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    bmp.close();
  }
}

export async function makeThumbnail(dataUrl: string, maxSide = 400, quality = 0.6): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return (await downscaleImage(blob, maxSide, quality)).dataUrl;
}

export type RecognizeResult =
  | { ok: true; raw: string; reading: ParsedReading; requestFailed?: false }
  | { ok: false; error: string; reading: ParsedReading; requestFailed: boolean };

export function isCloudRequestFailure(res: RecognizeResult): res is { ok: false; error: string; reading: ParsedReading; requestFailed: true } {
  return !res.ok && res.requestFailed === true;
}

export async function recognizeImage(opts: {
  dataUrl: string; device: DeviceRec;
  baseUrl: string; model: string; apiKey: string;
  fetchFn?: typeof fetch; timeoutMs?: number; referer?: string;
}): Promise<RecognizeResult> {
  const fields = fieldsFor(opts.device.type, opts.device.fieldKeys);
  const empty: RecognizeResult = { ok: false, error: '', reading: { values: emptyValues(fields), deviceTimeRaw: null, ok: false }, requestFailed: true };
  const url = chatCompletionsUrl(opts.baseUrl);
  const prompt = buildVisionPrompt({ type: opts.device.type, name: opts.device.name, fields, regions: opts.device.regions });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` };
  if (isOpenRouterUrl(opts.baseUrl)) Object.assign(headers, openRouterHeaders(opts.referer));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const res = await (opts.fetchFn ?? fetch)(url, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: opts.dataUrl } },
          ],
        }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ...empty, error: cloudHttpError(res.status, body, opts.baseUrl), requestFailed: true };
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = data?.choices?.[0]?.message?.content ?? '';
    const reading = parseModelOutput(raw, fields);
    if (!reading.ok) return { ok: false, error: reading.error ?? 'Не удалось разобрать ответ модели', reading, requestFailed: false };
    return { ok: true, raw, reading };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const msg = e instanceof Error ? e.message : String(e);
    if (name === 'AbortError') return { ...empty, error: 'Время ожидания истекло', requestFailed: true };
    const cors = /failed to fetch|networkerror|cors/i.test(msg)
      ? 'Нет ответа сервера. Проверьте сеть и что адрес разрешает запросы из браузера (CORS).'
      : msg;
    return { ...empty, error: cors, requestFailed: true };
  } finally {
    clearTimeout(t);
  }
}

export const MANUAL_OFFLINE_MSG = 'Нет сети или ключа — введите вручную';
