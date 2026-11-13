// Ленивая загрузка tesseract.js. Воркер, ядро и traineddata — с нашего origin, офлайн после первого визита.
import type { DeviceRec } from '../db/db';
import { fieldsFor } from '../core/devices';
import { recognizeFields, OCR_DIGIT_WHITELIST, OCR_TEXT_WHITELIST, type OcrFn, type RecognizeFieldsResult } from '../core/ocr';
import type { Pix } from '../core/geom';
import type { PSM } from 'tesseract.js';

function ocrDir(): string {
  const base = import.meta.env.BASE_URL || '/';
  return new URL(`${base}ocr/`, window.location.href).href;
}

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;
let lastKind: 'digits' | 'text' | null = null;

async function getWorker(): Promise<import('tesseract.js').Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      const dir = ocrDir();
      return createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${dir}worker.min.js`,
        corePath: `${dir}tesseract-core-lstm.wasm.js`,
        langPath: dir.replace(/\/$/, ''),
        workerBlobURL: false,
        gzip: true,
        cacheMethod: 'none',
      });
    })();
  }
  return workerPromise;
}

export const browserOcr: OcrFn = async (pix, kind) => {
  const worker = await getWorker();
  const { PSM } = await import('tesseract.js');
  if (lastKind !== kind) {
    await worker.setParameters({
      tessedit_char_whitelist: kind === 'digits' ? OCR_DIGIT_WHITELIST : OCR_TEXT_WHITELIST,
      tessedit_pageseg_mode: String(PSM.SINGLE_LINE) as unknown as PSM,
    });
    lastKind = kind;
  }
  const image = new ImageData(new Uint8ClampedArray(pix.data), pix.width, pix.height);
  const { data } = await worker.recognize(image);
  return { text: (data.text ?? '').trim(), confidence: data.confidence ?? 0 };
};

export async function recognizeOnDevice(opts: { screen: Pix; device: DeviceRec }): Promise<RecognizeFieldsResult> {
  const fields = fieldsFor(opts.device.type, opts.device.fieldKeys);
  return recognizeFields({ screen: opts.screen, fields, regions: opts.device.regions ?? {}, ocr: browserOcr });
}

export function prefetchOnDeviceOcr(): void {
  void getWorker().catch(() => { workerPromise = null; });
}
