// Перспектива экрана, обрезка полей, подготовка кропа для OCR. Работает с ImageData-совместимым Pix — и в браузере, и в Node.
import type { FieldRegion } from './devices';

export type Point = { x: number; y: number };
export type Quad = { tl: Point; tr: Point; br: Point; bl: Point };
export interface Pix { data: Uint8ClampedArray; width: number; height: number }

export function quadToArray(q: Quad): Point[] { return [q.tl, q.tr, q.br, q.bl]; }

export function defaultQuad(): Quad {
  const m = 0.08;
  return { tl: { x: m, y: m }, tr: { x: 1 - m, y: m }, br: { x: 1 - m, y: 1 - m }, bl: { x: m, y: 1 - m } };
}

export function normalizedQuadToPixels(q: Quad, w: number, h: number): Quad {
  const p = (pt: Point): Point => ({ x: pt.x * w, y: pt.y * h });
  return { tl: p(q.tl), tr: p(q.tr), br: p(q.br), bl: p(q.bl) };
}

export function clamp01(n: number): number { return Math.min(1, Math.max(0, n)); }

export function sanitizeQuad(q: Quad): Quad {
  const fix = (p: Point): Point => ({ x: clamp01(p.x), y: clamp01(p.y) });
  return { tl: fix(q.tl), tr: fix(q.tr), br: fix(q.br), bl: fix(q.bl) };
}

/** 3×3 построчно. src и dst — по 4 точки. */
export function findHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve8(A, b);
  return [...h, 1];
}

export function applyHomography(H: number[], p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) continue;
    if (piv !== col) { const t = M[col]; M[col] = M[piv]; M[piv] = t; }
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

function sampleBilinear(src: Pix, x: number, y: number): [number, number, number, number] {
  const { width: w, height: h, data } = src;
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(h - 1, Math.max(0, Math.round(y)));
    const i = (yi * w + xi) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1, y1 = y0 + 1;
  const wx = x - x0, wy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const v = data[i00 + c] * (1 - wx) * (1 - wy) + data[i10 + c] * wx * (1 - wy) + data[i01 + c] * (1 - wx) * wy + data[i11 + c] * wx * wy;
    out[c] = v;
  }
  return out;
}

/** quad — в пикселях исходного снимка, порядок tl,tr,br,bl. */
export function warpPerspective(src: Pix, quad: Quad, outW: number, outH: number): Pix {
  const dst: Point[] = [{ x: 0, y: 0 }, { x: outW - 1, y: 0 }, { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 }];
  const H = findHomography(dst, quadToArray(quad)); // dest px → src px
  const data = new Uint8ClampedArray(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyHomography(H, { x, y });
      const [r, g, b, a] = sampleBilinear(src, p.x, p.y);
      const i = (y * outW + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a || 255;
    }
  }
  return { data, width: outW, height: outH };
}

/** Шаблоны полей калиброваны на кадре 4:3 — всегда выравниваем к этому формату. */
export const SCREEN_ASPECT = 4 / 3;
export const MAX_WARP_SIDE = 1400;
export function outputSizeForQuad(_quadPx?: Quad, targetW = 1200, maxSide = MAX_WARP_SIDE): { width: number; height: number } {
  let width = targetW;
  let height = Math.round(targetW / SCREEN_ASPECT);
  const long = Math.max(width, height);
  if (long > maxSide) {
    const s = maxSide / long;
    width = Math.max(1, Math.round(width * s));
    height = Math.max(1, Math.round(height * s));
  }
  return { width, height };
}

export function cropRegion(src: Pix, r: FieldRegion, padFrac = 0.04): Pix {
  const padX = r.w * padFrac, padY = r.h * padFrac;
  const x0 = Math.min(src.width - 1, Math.max(0, Math.floor((r.x - padX) * src.width)));
  const y0 = Math.min(src.height - 1, Math.max(0, Math.floor((r.y - padY) * src.height)));
  const x1 = Math.min(src.width, Math.max(x0 + 1, Math.ceil((r.x + r.w + padX) * src.width)));
  const y1 = Math.min(src.height, Math.max(y0 + 1, Math.ceil((r.y + r.h + padY) * src.height)));
  const w = x1 - x0, h = y1 - y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcOff = ((y0 + y) * src.width + x0) * 4;
    data.set(src.data.subarray(srcOff, srcOff + w * 4), y * w * 4);
  }
  return { data, width: w, height: h };
}

export function resizeBilinear(src: Pix, outW: number, outH: number): Pix {
  const data = new Uint8ClampedArray(outW * outH * 4);
  const sx = src.width / outW, sy = src.height / outH;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [r, g, b, a] = sampleBilinear(src, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
      const i = (y * outW + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a || 255;
    }
  }
  return { data, width: outW, height: outH };
}

function addBorder(src: Pix, pad: number, fill = 255): Pix {
  const w = src.width + pad * 2, h = src.height + pad * 2;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = fill; data[i * 4 + 1] = fill; data[i * 4 + 2] = fill; data[i * 4 + 3] = 255; }
  for (let y = 0; y < src.height; y++) {
    const dst = ((y + pad) * w + pad) * 4;
    data.set(src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4), dst);
  }
  return { data, width: w, height: h };
}

function toMaxGray(src: Pix): Uint8Array {
  const g = new Uint8Array(src.width * src.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = Math.max(src.data[p], src.data[p + 1], src.data[p + 2]);
  return g;
}

function percentile(values: Uint8Array, p: number): number {
  const a = Array.from(values).sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return a[i];
}

function otsuThreshold(g: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; thr = t; }
  }
  return thr;
}

/** Яркие цифры на тёмном экране → тёмные на белом, увеличенные, с контрастом. */
export function preprocessCrop(src: Pix, opts?: { targetHeight?: number; threshold?: boolean }): Pix {
  const targetH = opts?.targetHeight ?? 80;
  const scale = Math.max(1, targetH / Math.max(1, src.height), 3 / Math.max(1, Math.min(src.width, src.height) / 10));
  const upW = Math.max(8, Math.round(src.width * scale));
  const upH = Math.max(8, Math.round(src.height * scale));
  const up = (upW === src.width && upH === src.height) ? src : resizeBilinear(src, upW, upH);
  const gray = toMaxGray(up);
  const lo = percentile(gray, 0.02);
  const hi = Math.max(lo + 8, percentile(gray, 0.98));
  const stretched = new Uint8Array(gray.length);
  let sum = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = Math.min(255, Math.max(0, Math.round((gray[i] - lo) * 255 / (hi - lo))));
    stretched[i] = v; sum += v;
  }
  const mean = sum / stretched.length;
  const inverted = mean < 128;
  const work = new Uint8Array(stretched.length);
  for (let i = 0; i < stretched.length; i++) work[i] = inverted ? 255 - stretched[i] : stretched[i];
  if (opts?.threshold !== false) {
    const thr = otsuThreshold(work);
    for (let i = 0; i < work.length; i++) work[i] = work[i] < thr ? 0 : 255;
  }
  const rgba = new Uint8ClampedArray(upW * upH * 4);
  for (let i = 0; i < work.length; i++) {
    const v = work[i];
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  return addBorder({ data: rgba, width: upW, height: upH }, Math.max(6, Math.round(targetH * 0.12)), 255);
}

export function hasInk(pix: Pix, darkMax = 80): boolean {
  let dark = 0;
  const n = pix.width * pix.height;
  for (let i = 0; i < n; i++) if (pix.data[i * 4] < darkMax) dark++;
  const f = dark / n;
  return f > 0.008 && f < 0.9;
}

function grayDown(src: Pix, outW: number, outH: number): Uint8Array {
  const g = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const sy0 = Math.floor(y * src.height / outH);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * src.height / outH));
    for (let x = 0; x < outW; x++) {
      const sx0 = Math.floor(x * src.width / outW);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * src.width / outW));
      let s = 0, c = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4;
          s += Math.max(src.data[i], src.data[i + 1], src.data[i + 2]);
          c++;
        }
      }
      g[y * outW + x] = c ? s / c : 0;
    }
  }
  return g;
}

interface Comp { pixels: number[]; minX: number; maxX: number; minY: number; maxY: number }

function connectedComponents(mask: Uint8Array, w: number, h: number): Comp[] {
  const seen = new Uint8Array(w * h);
  const out: Comp[] = [];
  const qx = new Int32Array(w * h), qy = new Int32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const startX = i % w, startY = (i / w) | 0;
    let qh = 0, qt = 0;
    qx[qt] = startX; qy[qt] = startY; qt++;
    seen[i] = 1;
    const pixels: number[] = [];
    let minX = startX, maxX = startX, minY = startY, maxY = startY;
    while (qh < qt) {
      const x = qx[qh], y = qy[qh]; qh++;
      pixels.push(y * w + x);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!mask[j] || seen[j]) continue;
        seen[j] = 1; qx[qt] = nx; qy[qt] = ny; qt++;
      }
    }
    out.push({ pixels, minX, maxX, minY, maxY });
  }
  return out;
}

function extremeQuad(pixels: number[], w: number, h: number): Quad {
  let tl = pixels[0], tr = pixels[0], br = pixels[0], bl = pixels[0];
  let tlS = Infinity, trS = Infinity, brS = -Infinity, blS = -Infinity;
  for (const i of pixels) {
    const x = i % w, y = (i / w) | 0;
    const s = x + y, d = y - x;
    if (s < tlS) { tlS = s; tl = i; }
    if (d < trS) { trS = d; tr = i; }
    if (s > brS) { brS = s; br = i; }
    if (d > blS) { blS = d; bl = i; }
  }
  const pt = (i: number): Point => ({ x: (i % w) / (w - 1), y: ((i / w) | 0) / (h - 1) });
  return { tl: pt(tl), tr: pt(tr), br: pt(br), bl: pt(bl) };
}

/** Ищет тёмный прямоугольник экрана. Если не уверен — null, дальше углы по умолчанию. */
export function detectScreenQuad(src: Pix): Quad | null {
  const maxW = 160;
  const scale = Math.min(1, maxW / src.width);
  const w = Math.max(24, Math.round(src.width * scale));
  const h = Math.max(18, Math.round(src.height * scale));
  const gray = grayDown(src, w, h);
  let best: { score: number; quad: Quad } | null = null;
  for (const thr of [45, 60, 75, 90, 110]) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) mask[i] = gray[i] < thr ? 1 : 0;
    const comps = connectedComponents(mask, w, h);
    for (const c of comps) {
      const area = c.pixels.length;
      const areaFrac = area / (w * h);
      if (areaFrac < 0.08 || areaFrac > 0.65) continue;
      const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
      if (bw < w * 0.28 || bh < h * 0.22) continue;
      const aspect = bw / bh;
      if (aspect < 0.9 || aspect > 2.2) continue;
      const touches = (c.minX <= 1 ? 1 : 0) + (c.minY <= 1 ? 1 : 0) + (c.maxX >= w - 2 ? 1 : 0) + (c.maxY >= h - 2 ? 1 : 0);
      if (touches >= 3) continue;
      const fill = area / (bw * bh);
      if (fill < 0.45) continue;
      const score = areaFrac * fill * (1 + (3 - touches) * 0.15);
      if (!best || score > best.score) best = { score, quad: sanitizeQuad(extremeQuad(c.pixels, w, h)) };
    }
  }
  return best && best.score >= 0.06 ? best.quad : null;
}

// ---------- Поиск цифр внутри рамки поля (устойчиво к сдвигу углов и бликам) ----------

function minMaxFilter(src: Float32Array, w: number, h: number, r: number, isMax: boolean): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const pick = isMax ? Math.max : Math.min;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x];
      const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
      for (let k = a; k <= b; k++) v = pick(v, src[y * w + k]);
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = a; k <= b; k++) v = pick(v, tmp[k * w + x]);
      out[y * w + x] = v;
    }
  }
  return out;
}

interface CompInfo { c: Comp; cw: number; ch: number; cx: number; cy: number; touches: boolean }

export interface GlyphCropOptions {
  /** Во сколько раз расширять рамку для поиска (доля ширины/высоты с каждой стороны). */
  expand?: number;
  /** Минимальная высота «соседних» знаков относительно самого крупного (для НИАД — ниже). */
  minRel?: number;
  /** Высота знака на выходе, px. */
  glyphHeight?: number;
}

export interface GlyphCrop { binary: Pix; gray: Pix; glyphs: number; heightPx: number; separators: { index: number; ch: '.' | ':' }[]; digitCount: number }

/**
 * Ищет группу крупных светлых знаков около центра рамки. Цифры на мониторах — яркие цветные на тёмном.
 * Яркость = max(R,G,B); фон с бликами убирается «цилиндром» (яркость минус морф. открытие).
 * Возвращает чёрные знаки на белом, масштабированные к ~glyphHeight. null — знаков нет (прочерк/пусто).
 */
export function locateGlyphs(screen: Pix, r: FieldRegion, opts?: GlyphCropOptions): GlyphCrop | null {
  const ex = opts?.expand ?? 0.3;
  const minRel = opts?.minRel ?? 0.6;
  const outH = opts?.glyphHeight ?? 48;
  const W = screen.width, H = screen.height;
  const x0 = Math.max(0, Math.floor((r.x - r.w * ex) * W));
  const y0 = Math.max(0, Math.floor((r.y - r.h * ex) * H));
  const x1 = Math.min(W, Math.ceil((r.x + r.w * (1 + ex)) * W));
  const y1 = Math.min(H, Math.ceil((r.y + r.h * (1 + ex)) * H));
  const w = x1 - x0, h = y1 - y0;
  if (w < 8 || h < 8) return null;
  const rh = r.h * H; // высота рамки, px
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = ((y0 + y) * W + x0 + x) * 4;
    v[y * w + x] = Math.max(screen.data[p], screen.data[p + 1], screen.data[p + 2]);
  }
  // лёгкое сглаживание против муара
  const sm = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
      s += v[yy * w + xx]; c++;
    }
    sm[y * w + x] = s / c;
  }
  const rad = Math.max(3, Math.round(rh * 0.12));
  const opened = minMaxFilter(minMaxFilter(sm, w, h, rad, false), w, h, rad, true);
  const top = new Uint8Array(w * h);
  let maxTop = 0;
  for (let i = 0; i < top.length; i++) { const t = Math.max(0, sm[i] - opened[i]); top[i] = Math.min(255, Math.round(t)); if (top[i] > maxTop) maxTop = top[i]; }
  if (maxTop < 30) return null;
  const thr = Math.max(25, otsuThreshold(top));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = top[i] >= thr ? 1 : 0;
  const hueSat = (i: number): [number, number] => {
    const y = (i / w) | 0, x = i % w, p = ((y0 + y) * W + x0 + x) * 4;
    const R = screen.data[p], G = screen.data[p + 1], B = screen.data[p + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
    if (!mx || !d) return [0, 0];
    let hh = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
    return [hh, d / mx];
  };
  let res = pickGroup(mask);
  if (!res) return null;
  // цветные цифры: отсекаем белые блики и пиксели другого цвета, затем ищем заново
  {
    let sx = 0, sy = 0, ss = 0, n = 0;
    for (const pI of res.seed.c.pixels) { const [hh, sa] = hueSat(pI); sx += Math.cos(hh * Math.PI / 180) * sa; sy += Math.sin(hh * Math.PI / 180) * sa; ss += sa; n++; }
    const sat = ss / n, hue = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
    if (sat > 0.35) {
      const m2 = new Uint8Array(w * h);
      for (let i = 0; i < m2.length; i++) {
        if (!mask[i]) continue;
        const [hh, sa] = hueSat(i);
        const dh = Math.min(Math.abs(hh - hue), 360 - Math.abs(hh - hue));
        if (sa >= sat * 0.45 && dh <= 35) m2[i] = 1;
      }
      const res2 = pickGroup(m2);
      if (res2) { res = res2; mask.set(m2); }
    }
  }
  const { group, sh, seps } = res;
  return render(group, sh, seps);

  function pickGroup(mask: Uint8Array) {
  const comps: CompInfo[] = connectedComponents(mask, w, h).map(c => ({
    c, cw: c.maxX - c.minX + 1, ch: c.maxY - c.minY + 1,
    cx: (c.minX + c.maxX) / 2, cy: (c.minY + c.maxY) / 2,
    touches: c.minX === 0 || c.minY === 0 || c.maxX === w - 1 || c.maxY === h - 1,
  }));
  const rx0 = r.x * W - x0, rx1 = rx0 + r.w * W, ry0 = r.y * H - y0, ry1 = ry0 + rh;
  const big = comps.filter(k => !k.touches && k.ch >= rh * 0.22 && k.ch <= rh * 1.3 && k.cw <= rh * 1.3
    && k.ch / k.cw <= 12 && k.c.pixels.length >= 12 && k.c.pixels.length / (k.cw * k.ch) < 0.97);
  const inside = big.filter(k => k.cx >= rx0 && k.cx <= rx1 && k.cy >= ry0 && k.cy <= ry1);
  if (!inside.length) return null;
  const cxm = (rx0 + rx1) / 2, cym = (ry0 + ry1) / 2;
  inside.sort((a, b) => (b.ch - a.ch) || (Math.hypot(a.cx - cxm, a.cy - cym) - Math.hypot(b.cx - cxm, b.cy - cym)));
  const seed = inside[0];
  const sh = seed.ch;
  const peers = big.filter(k => k.ch >= sh * minRel && k.ch <= sh * 1.3 && Math.abs(k.cy - seed.cy) <= sh * 0.35)
    .sort((a, b) => a.c.minX - b.c.minX);
  const group = [seed];
  let gx0 = seed.c.minX, gx1 = seed.c.maxX;
  let grew = true;
  while (grew) {
    grew = false;
    for (const k of peers) {
      if (group.includes(k)) continue;
      const gap = k.c.minX > gx1 ? k.c.minX - gx1 : (k.c.maxX < gx0 ? gx0 - k.c.maxX : 0);
      if (gap <= sh * 0.7) { group.push(k); gx0 = Math.min(gx0, k.c.minX); gx1 = Math.max(gx1, k.c.maxX); grew = true; }
    }
  }
  let gy0 = Math.min(...group.map(k => k.c.minY)), gy1 = Math.max(...group.map(k => k.c.maxY));
  // мелкие знаки (точка, двоеточие, косая) только между крупными
  for (const k of comps) {
    if (group.includes(k) || k.touches) continue;
    if (k.cx > gx0 && k.cx < gx1 && k.c.minY >= gy0 - sh * 0.1 && k.c.maxY <= gy1 + sh * 0.1 && k.ch < sh * minRel && k.c.pixels.length >= 4) group.push(k);
  }
  gy0 = Math.min(...group.map(k => k.c.minY)); gy1 = Math.max(...group.map(k => k.c.maxY));
  // разделители: точка (внизу) или двоеточие (две точки одна над другой); индекс = сколько цифр левее
  const bigs = group.filter(k => k.ch >= sh * minRel).sort((a, b) => a.c.minX - b.c.minX);
  const digitsIn = (k: { cw: number }) => Math.max(1, Math.round(k.cw / (sh * 0.62)));
  const smalls = group.filter(k => k.ch < sh * minRel && k.cw < sh * 0.35);
  const seps: { index: number; ch: '.' | ':' }[] = [];
  const used = new Set<unknown>();
  for (const k of smalls) {
    if (used.has(k)) continue;
    const twin = smalls.find(o => o !== k && !used.has(o) && Math.abs(o.cx - k.cx) < sh * 0.2 && Math.abs(o.cy - k.cy) > sh * 0.2);
    const index = bigs.filter(b => b.cx < k.cx).reduce((a, b) => a + digitsIn(b), 0);
    if (twin) { used.add(twin); used.add(k); seps.push({ index, ch: ':' }); }
    else if (k.cy > gy0 + (gy1 - gy0) * 0.6) { used.add(k); seps.push({ index, ch: '.' }); }
  }
  const totalDigits = bigs.reduce((a, b) => a + digitsIn(b), 0);
  return { group, sh, seed, seps: { list: seps, totalDigits } };
  }

  function render(group: CompInfo[], sh: number, seps: { list: { index: number; ch: '.' | ':' }[]; totalDigits: number }): GlyphCrop {
  const gx0 = Math.min(...group.map(k => k.c.minX)), gx1 = Math.max(...group.map(k => k.c.maxX));
  const gy0 = Math.min(...group.map(k => k.c.minY)), gy1 = Math.max(...group.map(k => k.c.maxY));
  const pad = Math.max(2, Math.round(sh * 0.15));
  const bx0 = Math.max(0, gx0 - pad), bx1 = Math.min(w - 1, gx1 + pad), by0 = Math.max(0, gy0 - pad), by1 = Math.min(h - 1, gy1 + pad);
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const keep = new Uint8Array(w * h);
  for (const k of group) for (const p of k.c.pixels) keep[p] = 1;
  const bin = new Uint8ClampedArray(bw * bh * 4), gry = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = (by0 + y) * w + bx0 + x, o = (y * bw + x) * 4;
    const b = keep[i] ? 0 : 255;
    const g = 255 - Math.min(255, Math.round(top[i] * 255 / maxTop));
    bin[o] = bin[o + 1] = bin[o + 2] = b; bin[o + 3] = 255;
    gry[o] = gry[o + 1] = gry[o + 2] = g; gry[o + 3] = 255;
  }
  // маска «своих» знаков с запасом в 1 px — для чистого бинарного варианта
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const o = (y * bw + x) * 4;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) {
      const yy = by0 + y + dy, xx = bx0 + x + dx;
      if (yy >= 0 && xx >= 0 && yy < h && xx < w && keep[yy * w + xx]) near = true;
    }
    const val = near ? gry[o] : 255;
    bin[o] = bin[o + 1] = bin[o + 2] = val;
  }
  const scale = outH / sh;
  const ow = Math.max(8, Math.round(bw * scale)), oh = Math.max(8, Math.round(bh * scale));
  const border = Math.round(outH * 0.4);
  const gthr = 255 - Math.round(thr * 255 / maxTop);
  const fin = (p: Pix, binarize: boolean) => {
    const s = resizeBilinear(p, ow, oh);
    if (binarize) for (let i = 0; i < s.data.length; i += 4) { const t = s.data[i] <= gthr ? 0 : 255; s.data[i] = s.data[i + 1] = s.data[i + 2] = t; }
    return addBorder(s, border, 255);
  };
  return { binary: fin({ data: bin, width: bw, height: bh }, false), gray: fin({ data: gry, width: bw, height: bh }, false), glyphs: group.length, heightPx: sh, separators: seps.list, digitCount: seps.totalDigits };
  }
}
