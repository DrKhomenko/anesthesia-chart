// Какой газ спрашивать в поддержании: выбранный на индукции, иначе настройка клиники.
export type GasId = 'sevo' | 'iso';
export type DefaultGasSetting = GasId | 'ask';

export const GAS_RU: Record<GasId, string> = { sevo: 'Sevo', iso: 'Iso' };
export const GAS_FIELD: Record<GasId, 'sevoPct' | 'isoPct'> = { sevo: 'sevoPct', iso: 'isoPct' };
export const FIELD_TO_GAS: Record<string, GasId> = { sevoPct: 'sevo', isoPct: 'iso' };

export function normalizeDefaultGas(v: unknown): DefaultGasSetting {
  return v === 'sevo' || v === 'iso' || v === 'ask' ? v : 'ask';
}

export function gasFromInduction(v: unknown): GasId | null {
  return v === 'sevo' || v === 'iso' ? v : null;
}

/**
 * Порядок: смена газа в карте (переключатель) → газ индукции → настройка клиники.
 * null значит «спросить один раз», не оба поля каждый раз.
 */
export function resolveCaseGas(opts: {
  maintenanceGas?: string | null;
  inductionGas?: string | null;
  defaultGas?: unknown;
}): GasId | null {
  const over = gasFromInduction(opts.maintenanceGas);
  if (over) return over;
  const ind = gasFromInduction(opts.inductionGas);
  if (ind) return ind;
  const def = normalizeDefaultGas(opts.defaultGas);
  return def === 'ask' ? null : def;
}

export function otherGas(g: GasId): GasId { return g === 'sevo' ? 'iso' : 'sevo'; }

/** Подпись ячейки таблицы/PDF: «Sevo 2,2», при двух газах в старой записи — оба. */
export function formatTickGas(tick: { sevoPct?: number | null; isoPct?: number | null }, fmt: (n: number, d?: number) => string): string {
  const parts: string[] = [];
  if (tick.sevoPct != null) parts.push(`Sevo ${fmt(tick.sevoPct, 1)}`);
  if (tick.isoPct != null) parts.push(`Iso ${fmt(tick.isoPct, 1)}`);
  return parts.length ? parts.join(' / ') : '—';
}

/** Колонка «Газ»: если во всех живых записях только один газ (или записей нет) — его имя, иначе «Газ». */
export function gasColumnLabel(ticks: { sevoPct?: number | null; isoPct?: number | null }[], preferred: GasId | null): string {
  const hasS = ticks.some(t => t.sevoPct != null);
  const hasI = ticks.some(t => t.isoPct != null);
  if (hasS && hasI) return 'Газ';
  if (hasS) return 'Sevo';
  if (hasI) return 'Iso';
  return preferred ? GAS_RU[preferred] : 'Газ';
}
