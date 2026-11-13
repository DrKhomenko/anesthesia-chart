import type { DeviceRec, RecognitionProvider } from '../db/db';
import { fieldsFor } from '../core/devices';
import { buildVisionPrompt, emptyValues, parseModelOutput, type ParsedReading } from '../core/vision';
import { normalizedQuadToPixels, outputSizeForQuad, warpPerspective, type Pix, type Quad } from '../core/geom';
import { releaseCanvas, stepError } from './errorText';

export const MAX_IMAGE_SIDE = 1600;

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
  | { ok: true; raw: string; reading: ParsedReading }
  | { ok: false; error: string; reading: ParsedReading };

export async function recognizeImage(opts: {
  dataUrl: string; device: DeviceRec;
  baseUrl: string; model: string; apiKey: string;
  fetchFn?: typeof fetch; timeoutMs?: number;
}): Promise<RecognizeResult> {
  const fields = fieldsFor(opts.device.type, opts.device.fieldKeys);
  const empty: RecognizeResult = { ok: false, error: '', reading: { values: emptyValues(fields), deviceTimeRaw: null, ok: false } };
  const url = chatCompletionsUrl(opts.baseUrl);
  const prompt = buildVisionPrompt({ type: opts.device.type, name: opts.device.name, fields, regions: opts.device.regions });
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  try {
    const res = await (opts.fetchFn ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
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
      const corsHint = res.status === 0 ? ' Сервер отклонил запрос из браузера (CORS).' : '';
      return { ...empty, error: `Сервер ответил ${res.status}${corsHint} ${body.slice(0, 180)}`.trim() };
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = data?.choices?.[0]?.message?.content ?? '';
    const reading = parseModelOutput(raw, fields);
    if (!reading.ok) return { ok: false, error: reading.error ?? 'Не удалось разобрать ответ модели', reading };
    return { ok: true, raw, reading };
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const msg = e instanceof Error ? e.message : String(e);
    if (name === 'AbortError') return { ...empty, error: 'Время ожидания истекло' };
    const cors = /failed to fetch|networkerror|cors/i.test(msg)
      ? 'Нет ответа сервера. Проверьте сеть и что адрес разрешает запросы из браузера (CORS).'
      : msg;
    return { ...empty, error: cors };
  } finally {
    window.clearTimeout(t);
  }
}

export const MANUAL_OFFLINE_MSG = 'Нет сети или ключа — введите вручную';
