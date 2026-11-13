/** Прогон реального OCR-контура на фото монитора и НДА. Запуск: npm run ocr:accuracy */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { MONITOR_FIELDS, MACHINE_FIELDS, UMEC12_REGIONS, WATO35_REGIONS, type DeviceField, type FieldRegion } from '../src/core/devices.ts';
import { cropRegion, hasInk, normalizedQuadToPixels, outputSizeForQuad, preprocessCrop, resizeBilinear, warpPerspective, type Pix, type Quad } from '../src/core/geom.ts';
import { OCR_DIGIT_WHITELIST, OCR_TEXT_WHITELIST, recognizeFields, type OcrFn } from '../src/core/ocr.ts';

const root = dirname(fileURLToPath(import.meta.url));
const web = join(root, '..');
const outDir = join(web, '..', 'ocr-accuracy');

const UMEC_PHOTO = '/tmp/mon-photos/umec-orig.jpg';
const WATO_PHOTO = '/tmp/mon-photos/wato-orig.jpg';

// Углы экрана в долях снимка (калибровка по 1600×1200 превью, та же пропорция).
const UMEC_QUAD: Quad = {
  tl: { x: 338 / 1600, y: 438 / 1200 },
  tr: { x: 1098 / 1600, y: 424 / 1200 },
  br: { x: 1112 / 1600, y: 938 / 1200 },
  bl: { x: 328 / 1600, y: 948 / 1200 },
};
const WATO_QUAD: Quad = {
  tl: { x: 198 / 1600, y: 178 / 1200 },
  tr: { x: 1238 / 1600, y: 168 / 1200 },
  br: { x: 1245 / 1600, y: 932 / 1200 },
  bl: { x: 192 / 1600, y: 940 / 1200 },
};

const MONITOR_TRUTH: Record<string, number | string | null> = {
  hr: 142, pr: 142, spo2: 100, etco2: 38, fico2: 0, rr: 12, t1: 23.3, t2: 38.2,
  nibpSys: null, nibpDia: null, nibpMap: null,
};
const WATO_TRUTH: Record<string, number | string | null> = {
  ventMode: 'PCV', setPinsp: 10, setRr: 12, setIE: '1:2', setTslope: 0.1, setPeep: 3,
  pPeak: 10, pPlat: 10, peep: 3, vtInsp: 45, vtExp: 37, mv: 0.5, rrMeas: 12, fio2: 72, raw: 60, compliance: 6,
};

function loadJpeg(path: string): Pix {
  const raw = jpeg.decode(readFileSync(path), { useTArray: true, maxMemoryUsageInMB: 512 });
  return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
}

function downscale(pix: Pix, maxSide = 1600): Pix {
  const scale = Math.min(1, maxSide / Math.max(pix.width, pix.height));
  if (scale >= 0.999) return pix;
  return resizeBilinear(pix, Math.max(1, Math.round(pix.width * scale)), Math.max(1, Math.round(pix.height * scale)));
}

function savePng(pix: Pix, path: string) {
  const png = new PNG({ width: pix.width, height: pix.height });
  png.data.set(pix.data);
  writeFileSync(path, PNG.sync.write(png));
}

function pixToPngBuf(pix: Pix): Buffer {
  const png = new PNG({ width: pix.width, height: pix.height });
  png.data.set(pix.data);
  return PNG.sync.write(png);
}

function eq(got: unknown, truth: number | string | null): boolean {
  if (truth == null) return got == null || got === '';
  if (got == null || got === '') return false;
  if (typeof truth === 'number') return typeof got === 'number' && Math.abs(got - truth) < 0.051;
  return String(got).replace(/\s/g, '') === String(truth).replace(/\s/g, '');
}

type Verdict = 'correct' | 'wrong' | 'empty';
function verdict(got: unknown, truth: number | string | null): Verdict {
  if (eq(got, truth)) return 'correct';
  if (got == null || got === '') return truth == null ? 'correct' : 'empty';
  return 'wrong';
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const langPath = join(web, 'public/ocr');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none' });
  let lastKind: 'digits' | 'text' | null = null;

  const ocr: OcrFn = async (pix, kind) => {
    if (lastKind !== kind) {
      await worker.setParameters({
        tessedit_char_whitelist: kind === 'digits' ? OCR_DIGIT_WHITELIST : OCR_TEXT_WHITELIST,
        tessedit_pageseg_mode: String(PSM.SINGLE_LINE) as unknown as typeof PSM[keyof typeof PSM],
      });
      lastKind = kind;
    }
    const first = await worker.recognize(pixToPngBuf(pix));
    let text = (first.data.text ?? '').trim();
    let confidence = first.data.confidence ?? 0;
    if (!text || confidence < 50) {
      await worker.setParameters({ tessedit_pageseg_mode: String(PSM.SINGLE_WORD) as unknown as typeof PSM[keyof typeof PSM] });
      lastKind = null;
      const second = await worker.recognize(pixToPngBuf(pix));
      const t2 = (second.data.text ?? '').trim();
      const c2 = second.data.confidence ?? 0;
      if (c2 > confidence || (t2 && !text)) { text = t2; confidence = c2; }
    }
    return { text, confidence };
  };

  const jobs: { name: string; photo: string; quad: Quad; fields: DeviceField[]; regions: Record<string, FieldRegion>; truth: Record<string, number | string | null> }[] = [
    { name: 'uMEC12', photo: UMEC_PHOTO, quad: UMEC_QUAD, fields: MONITOR_FIELDS, regions: UMEC12_REGIONS, truth: MONITOR_TRUTH },
    { name: 'WATO', photo: WATO_PHOTO, quad: WATO_QUAD, fields: MACHINE_FIELDS, regions: WATO35_REGIONS, truth: WATO_TRUTH },
  ];

  const report: Record<string, unknown> = {};
  for (const job of jobs) {
    console.log(`\n=== ${job.name} ===`);
    const src = downscale(loadJpeg(job.photo), 1600);
    const quadPx = normalizedQuadToPixels(job.quad, src.width, src.height);
    const size = outputSizeForQuad(quadPx);
    const screen = warpPerspective(src, quadPx, size.width, size.height);
    savePng(screen, join(outDir, `${job.name}-warped.png`));
    // сохранить препроцессированные кропы
    for (const [key, region] of Object.entries(job.regions)) {
      const crop = preprocessCrop(cropRegion(screen, region));
      savePng(crop, join(outDir, `${job.name}-${key}.png`));
      void hasInk;
    }
    const res = await recognizeFields({ screen, fields: job.fields, regions: job.regions, ocr });
    const rows: { key: string; truth: unknown; got: unknown; raw: string; conf: number; verdict: Verdict; reason: string }[] = [];
    for (const key of Object.keys(job.truth)) {
      const d = res.details.find(x => x.key === key);
      const got = res.values[key] ?? null;
      const v = verdict(got, job.truth[key]);
      rows.push({
        key, truth: job.truth[key], got, raw: d?.raw ?? '', conf: d?.confidence ?? 0,
        verdict: v, reason: d?.reason ?? '',
      });
    }
    const counts = { correct: 0, wrong: 0, empty: 0 };
    for (const r of rows) counts[r.verdict]++;
    console.log(`deviceTime: ${res.deviceTimeRaw ?? '—'}  |  ${counts.correct} верно, ${counts.wrong} неверно, ${counts.empty} пусто`);
    for (const r of rows) {
      const mark = r.verdict === 'correct' ? 'OK' : r.verdict === 'wrong' ? 'WRONG' : 'EMPTY';
      console.log(`  ${mark.padEnd(6)} ${r.key.padEnd(12)} truth=${String(r.truth).padEnd(8)} got=${String(r.got ?? '—').padEnd(8)} raw=${JSON.stringify(r.raw)} conf=${r.conf.toFixed(0)} ${r.reason}`);
    }
    report[job.name] = { deviceTimeRaw: res.deviceTimeRaw, counts, rows };
  }

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await worker.terminate();
  console.log(`\nОтчёт: ${join(outDir, 'report.json')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
