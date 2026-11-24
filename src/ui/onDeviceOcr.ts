// Ленивая загрузка tesseract.js. Воркер, ядро и traineddata — с нашего origin, офлайн после первого визита.
// В tesseract.js нет поддержки ImageData: loadImage делает new Uint8Array(imageData) → пустой буфер.
// Поэтому в распознаватель передаём PNG-blob.
import type { DeviceRec } from '../db/db';
import { fieldsFor } from '../core/devices';
import { recognizeFields, whitelistFor, type OcrFn, type RecognizeFieldsResult } from '../core/ocr';
import type { Pix } from '../core/geom';
import type { PSM } from 'tesseract.js';
import { errorText, releaseCanvas, stepError, withTimeout } from './errorText';

export const OCR_TIMEOUT_MS = 45_000;

function ocrDir(): string {
  const base = import.meta.env.BASE_URL || '/';
  return new URL(`${base}ocr/`, window.location.href).href;
}

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;
let lastKind: string | null = null;

function pixToImageSource(pix: Pix): Promise<Blob | string> {
  const c = document.createElement('canvas');
  c.width = pix.width;
  c.height = pix.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Нет canvas');
  const img = ctx.createImageData(pix.width, pix.height);
  img.data.set(pix.data);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => {
    const finish = (src: Blob | string) => {
      releaseCanvas(c);
      resolve(src);
    };
    try {
      if (typeof c.toBlob === 'function') {
        c.toBlob(b => {
          if (b) finish(b);
          else finish(c.toDataURL('image/png'));
        }, 'image/png');
      } else {
        finish(c.toDataURL('image/png'));
      }
    } catch (e) {
      releaseCanvas(c);
      reject(e);
    }
  });
}

async function getWorker(): Promise<import('tesseract.js').Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      const dir = ocrDir();
      // corePath — каталог: воркер сам выберет lstm / simd / relaxedsimd. Все три варианта лежат в /ocr/.
      return withTimeout(
        createWorker('eng', OEM.LSTM_ONLY, {
          workerPath: `${dir}worker.min.js`,
          corePath: dir,
          langPath: dir.replace(/\/$/, ''),
          workerBlobURL: false,
          gzip: true,
          cacheMethod: 'none',
          errorHandler: (err: unknown) => {
            // иначе tesseract.js делает throw Error(data) вне промиса
            console.warn('tesseract:', errorText(err));
          },
        }),
        OCR_TIMEOUT_MS,
        'превышено время ожидания (45 с)',
      );
    })().catch(e => {
      workerPromise = null;
      lastKind = null;
      throw stepError('загрузка распознавателя', e);
    });
  }
  return workerPromise;
}

export const browserOcr: OcrFn = async (pix, kind, opts) => {
  const worker = await getWorker();
  const { PSM } = await import('tesseract.js');
  const psm = opts?.psm === 'word' ? PSM.SINGLE_WORD : PSM.SINGLE_LINE;
  const key = `${kind}|${psm}`;
  if (lastKind !== key) {
    await worker.setParameters({
      tessedit_char_whitelist: whitelistFor(kind),
      tessedit_pageseg_mode: String(psm) as unknown as PSM,
    });
    lastKind = key;
  }
  const image = await pixToImageSource(pix);
  const { data } = await withTimeout(
    worker.recognize(image),
    OCR_TIMEOUT_MS,
    'превышено время ожидания (45 с)',
  );
  return { text: (data.text ?? '').trim(), confidence: data.confidence ?? 0 };
};

export async function recognizeOnDevice(opts: { screen: Pix; device: DeviceRec }): Promise<RecognizeFieldsResult> {
  const fields = fieldsFor(opts.device.type, opts.device.fieldKeys);
  try {
    await getWorker();
  } catch (e) {
    throw stepError('загрузка распознавателя', e);
  }
  try {
    return await withTimeout(
      recognizeFields({ screen: opts.screen, fields, regions: opts.device.regions ?? {}, ocr: browserOcr }),
      120_000,
      'превышено время ожидания',
    );
  } catch (e) {
    const text = errorText(e);
    if (text.startsWith('загрузка распознавателя:')) throw e instanceof Error ? e : stepError('загрузка распознавателя', e);
    throw stepError('распознавание', e);
  }
}

export function prefetchOnDeviceOcr(): void {
  void getWorker().catch(() => { workerPromise = null; });
}
