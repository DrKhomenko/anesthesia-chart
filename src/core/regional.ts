// Регионарная анестезия: объём × концентрация, суммы и флаги. Дозы и максимумы не придумываются.
import { fmt, parseNum, normalizeCatalogName } from './logic';

export type BlockSide = '' | 'left' | 'right' | 'bilateral';
export type BlockGuidance = '' | 'ultrasound' | 'stimulator' | 'ultrasoundStimulator' | 'landmarks';

export const BLOCK_SIDE_RU: { v: BlockSide; ru: string }[] = [
  { v: '', ru: '—' },
  { v: 'left', ru: 'Левая' },
  { v: 'right', ru: 'Правая' },
  { v: 'bilateral', ru: 'Двусторонняя' },
];
export const BLOCK_GUIDANCE_RU: { v: BlockGuidance; ru: string }[] = [
  { v: 'ultrasound', ru: 'УЗИ' },
  { v: 'stimulator', ru: 'нейростимулятор' },
  { v: 'ultrasoundStimulator', ru: 'УЗИ+НС' },
  { v: 'landmarks', ru: 'по ориентирам' },
];

export interface LocalAnestheticCat { name: string; maxMgKg?: number | null }
/** Стартовый справочник местных анестетиков. Макс. доза пустая — клиника задаёт сама, если нужно. */
export const DEFAULT_LOCAL_ANESTHETICS: LocalAnestheticCat[] = [
  { name: 'Бупивакаин', maxMgKg: null },
  { name: 'Лидокаин', maxMgKg: null },
  { name: 'Ропивакаин', maxMgKg: null },
];

export function blockNamesOf(list?: string[] | null): string[] {
  return Array.isArray(list) ? list.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];
}

export function localAnestheticsOf(list?: LocalAnestheticCat[] | null): LocalAnestheticCat[] {
  if (!Array.isArray(list)) return DEFAULT_LOCAL_ANESTHETICS.map(x => ({ ...x }));
  return list
    .filter(x => x && typeof x.name === 'string' && x.name.trim())
    .map(x => ({ name: x.name.trim(), maxMgKg: x.maxMgKg ?? null }));
}

export function sideLabel(s?: BlockSide | null): string {
  return BLOCK_SIDE_RU.find(x => x.v === (s ?? ''))?.ru ?? '—';
}
export function guidanceLabel(s?: BlockGuidance | null): string {
  if (!s) return '—';
  return BLOCK_GUIDANCE_RU.find(x => x.v === s)?.ru ?? '—';
}

/** мг = % × 10 × мл (1% = 10 мг/мл). Пусто или не число → null. */
export function localAnestheticMg(concentrationPct: string | number | null | undefined, volumeMl: string | number | null | undefined): number | null {
  const p = parseNum(concentrationPct);
  const v = parseNum(volumeMl);
  if (!Number.isFinite(p) || !Number.isFinite(v)) return null;
  if (p < 0 || v < 0) return null;
  return Math.round(p * 10 * v * 1000) / 1000;
}

export function mgPerKg(mg: number | null, weightKg: string | number | null | undefined): number | null {
  if (mg == null) return null;
  const w = parseNum(weightKg);
  if (!Number.isFinite(w) || w <= 0) return null;
  return Math.round((mg / w) * 1000) / 1000;
}

export function formatMg(n: number | null): string { return n == null ? '—' : `${fmt(n, 3)} мг`; }
export function formatMgKg(n: number | null): string { return n == null ? '—' : `${fmt(n, 3)} мг/кг`; }

export interface AnestheticLine {
  name: string;
  concentrationPct: string;
  volumeMl: string;
}

export function sameAnestheticName(a: string, b: string): boolean {
  const na = normalizeCatalogName(a).toLowerCase();
  const nb = normalizeCatalogName(b).toLowerCase();
  return !!na && na === nb;
}

/** Макс. мг/кг: из справочника регионарки, иначе из формуляра (мг/кг или мкг/кг / 1000). Пусто = не задано. */
export function maxMgKgFor(
  name: string,
  catalog: LocalAnestheticCat[],
  drugs?: { name: string; genericName?: string; doseUnit?: string; maxDose?: number | null; deletedAt?: string | null }[],
): number | null {
  const hit = catalog.find(x => sameAnestheticName(x.name, name));
  if (hit && hit.maxMgKg != null && Number.isFinite(hit.maxMgKg)) return hit.maxMgKg;
  const n = normalizeCatalogName(name).toLowerCase();
  const d = (drugs ?? []).find(x => !x.deletedAt && (
    normalizeCatalogName(x.name).toLowerCase() === n
    || (x.genericName != null && normalizeCatalogName(x.genericName).toLowerCase() === n)
  ));
  if (!d || d.maxDose == null || !Number.isFinite(d.maxDose)) return null;
  if (d.doseUnit === 'mcg/kg') return d.maxDose / 1000;
  if (d.doseUnit === 'mg/kg' || !d.doseUnit) return d.maxDose;
  return null;
}

export interface DoseSource {
  name: string;
  mg: number | null;
  weightKg?: string | number | null;
}

/** Сумма мг и мг/кг по одному препарату из блокад и других введений. */
export function totalForAnesthetic(name: string, sources: DoseSource[]): { mg: number; mgKg: number | null } {
  let mg = 0;
  let mgKg: number | null = 0;
  let anyKg = false;
  for (const s of sources) {
    if (!sameAnestheticName(s.name, name)) continue;
    if (s.mg == null || !Number.isFinite(s.mg)) continue;
    mg += s.mg;
    const per = mgPerKg(s.mg, s.weightKg);
    if (per != null) { mgKg = (mgKg ?? 0) + per; anyKg = true; }
  }
  return { mg: Math.round(mg * 1000) / 1000, mgKg: anyKg ? Math.round((mgKg ?? 0) * 1000) / 1000 : null };
}

export function doseOverMax(totalMgKg: number | null, maxMgKg: number | null): boolean {
  if (totalMgKg == null || maxMgKg == null || !Number.isFinite(maxMgKg)) return false;
  return totalMgKg > maxMgKg;
}

export function doseWarnMessage(name: string, totalMgKg: number, maxMgKg: number): string {
  return `${name}: ${fmt(totalMgKg, 3)} мг/кг > ${fmt(maxMgKg, 3)} мг/кг (сумма по карте)`;
}

export function liveBlocks<T extends { deletedAt?: string | null; at?: string }>(rows: T[]): T[] {
  return rows.filter(r => !r.deletedAt).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
}

export function formatAnestheticLine(line: AnestheticLine, weightKg?: string | number | null): string {
  const bits: string[] = [];
  if (line.name.trim()) bits.push(line.name.trim());
  if (String(line.concentrationPct ?? '').trim()) bits.push(`${String(line.concentrationPct).trim()}%`);
  if (String(line.volumeMl ?? '').trim()) bits.push(`${String(line.volumeMl).trim()} мл`);
  const mg = localAnestheticMg(line.concentrationPct, line.volumeMl);
  if (mg != null) {
    bits.push(formatMg(mg));
    const per = mgPerKg(mg, weightKg);
    if (per != null) bits.push(formatMgKg(per));
  }
  return bits.join(' · ') || '—';
}

export function anestheticSourcesFromBlocks(
  blocks: { anesthetics?: AnestheticLine[]; deletedAt?: string | null }[],
  weightKg?: string | number | null,
): DoseSource[] {
  const out: DoseSource[] = [];
  for (const b of blocks) {
    if (b.deletedAt) continue;
    for (const a of b.anesthetics ?? []) {
      if (!a.name?.trim()) continue;
      out.push({ name: a.name, mg: localAnestheticMg(a.concentrationPct, a.volumeMl), weightKg });
    }
  }
  return out;
}

export function anestheticSourcesFromAdmins(
  admins: { drugNameSnapshot?: string; genericNameSnapshot?: string; totalMg?: number | null; weightKgUsed?: string | null; deletedAt?: string | null }[],
): DoseSource[] {
  const out: DoseSource[] = [];
  for (const a of admins) {
    if (a.deletedAt || a.totalMg == null || !Number.isFinite(a.totalMg)) continue;
    const name = (a.drugNameSnapshot ?? '').trim();
    const gen = (a.genericNameSnapshot ?? '').trim();
    if (name) out.push({ name, mg: a.totalMg, weightKg: a.weightKgUsed });
    if (gen && (!name || !sameAnestheticName(name, gen)))
      out.push({ name: gen, mg: a.totalMg, weightKg: a.weightKgUsed });
  }
  return out;
}

export function overMaxWarnings(
  names: string[],
  sources: DoseSource[],
  catalog: LocalAnestheticCat[],
  drugs?: Parameters<typeof maxMgKgFor>[2],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.trim();
    if (!key) continue;
    if ([...seen].some(s => sameAnestheticName(s, key))) continue;
    seen.add(key);
    const max = maxMgKgFor(key, catalog, drugs);
    const tot = totalForAnesthetic(key, sources);
    if (doseOverMax(tot.mgKg, max) && tot.mgKg != null && max != null)
      out.push(doseWarnMessage(key, tot.mgKg, max));
  }
  return out;
}
