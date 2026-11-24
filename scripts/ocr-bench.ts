/** Замер точности OCR на реальных фото + «дрожание» углов (имитация ручной расстановки). Запуск из каталога web: npx vite-node scripts/ocr-bench.ts */
import { readFileSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { MONITOR_FIELDS, MACHINE_FIELDS, UMEC12_REGIONS, WATO35_REGIONS, type DeviceField, type FieldRegion } from '../src/core/devices.ts';
import { normalizedQuadToPixels, outputSizeForQuad, resizeBilinear, warpPerspective, type Pix, type Quad } from '../src/core/geom.ts';
import * as OCR from '../src/core/ocr.ts';

const DIR = process.env.BENCH_PHOTOS ?? '/workspace/anesthesia-chart/ocr-bench/photos';
const JITTER = Number(process.env.BENCH_JITTER ?? 6);
const q = (a: number[]): Quad => ({ tl: { x: a[0] / 1600, y: a[1] / 1200 }, tr: { x: a[2] / 1600, y: a[3] / 1200 }, br: { x: a[4] / 1600, y: a[5] / 1200 }, bl: { x: a[6] / 1600, y: a[7] / 1200 } });
const jobs: { name: string; photo: string; quad: Quad; fields: DeviceField[]; regions: Record<string, FieldRegion>; truth: Record<string, number | string | null> }[] = [
  { name: 'uMEC12', photo: `${DIR}/umec-1.jpg`, quad: q([338, 438, 1098, 424, 1112, 938, 328, 948]), fields: MONITOR_FIELDS, regions: UMEC12_REGIONS,
    truth: { hr: 142, pr: 142, spo2: 100, etco2: 38, fico2: 0, rr: 12, t1: 23.3, t2: 38.2, nibpSys: null, nibpDia: null, nibpMap: null } },
  { name: 'WATO', photo: `${DIR}/wato-1.jpg`, quad: q([198, 178, 1238, 168, 1245, 932, 192, 940]), fields: MACHINE_FIELDS, regions: WATO35_REGIONS,
    truth: { ventMode: 'PCV', setPinsp: 10, setRr: 12, setIE: '1:2', setTslope: 0.1, setPeep: 3, pPeak: 10, pPlat: 10, peep: 3, vtInsp: 45, vtExp: 37, mv: 0.5, rrMeas: 12, fio2: 72, raw: 60, compliance: 6 } },
];

function loadJpeg(path: string): Pix {
  const raw = jpeg.decode(readFileSync(path), { useTArray: true, maxMemoryUsageInMB: 512 });
  let pix: Pix = { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
  const s = Math.min(1, 1600 / Math.max(pix.width, pix.height));
  if (s < 0.999) pix = resizeBilinear(pix, Math.round(pix.width * s), Math.round(pix.height * s));
  return pix;
}
const png = (pix: Pix) => { const p = new PNG({ width: pix.width, height: pix.height }); p.data.set(pix.data); return PNG.sync.write(p); };
function eq(got: unknown, truth: number | string | null): boolean {
  if (truth == null) return got == null || got === '';
  if (got == null || got === '') return false;
  if (typeof truth === 'number') return typeof got === 'number' && Math.abs(got - truth) < 0.051;
  return String(got).replace(/\s/g, '') === String(truth).replace(/\s/g, '');
}
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
function jitter(qd: Quad, amt: number): Quad {
  const j = (p: { x: number; y: number }) => ({ x: p.x + (rnd() * 2 - 1) * amt, y: p.y + (rnd() * 2 - 1) * amt });
  return { tl: j(qd.tl), tr: j(qd.tr), br: j(qd.br), bl: j(qd.bl) };
}

async function main() {
  const worker = await createWorker('eng', OEM.LSTM_ONLY, { langPath: process.cwd() + '/public/ocr', gzip: true, cacheMethod: 'none' });
  let calls = 0;
  // Ровно как browserOcr в приложении: whitelist по виду, PSM по запросу (по умолчанию строка).
  const W = OCR as unknown as Record<string, unknown>;
  const ocr = async (pix: Pix, kind: string, opts?: { psm?: 'line' | 'word'; whitelist?: string }) => {
    calls++;
    const wl = opts?.whitelist ?? (typeof W.whitelistFor === 'function' ? (W.whitelistFor as (k: string) => string)(kind) : (kind === 'text' ? OCR.OCR_TEXT_WHITELIST : OCR.OCR_DIGIT_WHITELIST));
    await worker.setParameters({ tessedit_char_whitelist: wl, tessedit_pageseg_mode: String(opts?.psm === 'word' ? PSM.SINGLE_WORD : PSM.SINGLE_LINE) as never });
    const { data } = await worker.recognize(png(pix));
    return { text: (data.text ?? '').trim(), confidence: data.confidence ?? 0 };
  };
  const tot = { exact: [0, 0], jit: [0, 0], exactNN: [0, 0], jitNN: [0, 0] };
  const t0 = Date.now();
  let images = 0;
  for (const job of jobs) {
    const src = loadJpeg(job.photo);
    const variants: Quad[] = [job.quad];
    for (let i = 0; i < JITTER; i++) variants.push(jitter(job.quad, 0.012));
    for (let vi = 0; vi < variants.length; vi++) {
      const qp = normalizedQuadToPixels(variants[vi], src.width, src.height);
      const sz = outputSizeForQuad(qp);
      const screen = warpPerspective(src, qp, sz.width, sz.height);
      if (vi === 0 && process.env.BENCH_SAVE) writeFileSync(`/tmp/bench-${job.name}.png`, png(screen));
      images++;
      const res = await OCR.recognizeFields({ screen, fields: job.fields, regions: job.regions, ocr: ocr as never });
      const line: string[] = [];
      for (const [k, t] of Object.entries(job.truth)) {
        const got = res.values[k] ?? null;
        const ok = eq(got, t);
        const b = vi === 0 ? tot.exact : tot.jit; b[1]++; if (ok) b[0]++;
        if (t != null) { const c = vi === 0 ? tot.exactNN : tot.jitNN; c[1]++; if (ok) c[0]++; }
        if (vi === 0 || !ok) line.push(`${ok ? 'ok' : 'XX'} ${k}=${JSON.stringify(got)}${ok ? '' : `(${JSON.stringify(t)}) raw="${res.details.find(d => d.key === k)?.raw ?? ''}"`}`);
      }
      console.log(`${job.name}#${vi}: ${line.join(' | ')}`);
    }
  }
  const ms = Date.now() - t0;
  const pct = (a: number[]) => `${a[0]}/${a[1]} (${Math.round(a[0] * 100 / a[1])}%)`;
  console.log(`\nТочный кадр: все поля ${pct(tot.exact)}, поля со значением ${pct(tot.exactNN)}`);
  console.log(`Дрожание углов ±1.2% ×${JITTER}: все поля ${pct(tot.jit)}, поля со значением ${pct(tot.jitNN)}`);
  console.log(`Время: ${(ms / images).toFixed(0)} мс на снимок, ${(calls / images).toFixed(1)} вызовов OCR на снимок`);
  await worker.terminate();
}
main().catch(e => { console.error(e); process.exit(1); });
