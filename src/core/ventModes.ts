/** Режимы ИВЛ для ручного ввода. Список правит клиника, дозы не придумываются. */
export const DEFAULT_VENT_MODES = ['Спонтанно', 'PCV', 'VCV', 'SIMV', 'PSV'] as const;

export function ventModesOf(list?: string[] | null): string[] {
  if (!Array.isArray(list)) return [...DEFAULT_VENT_MODES];
  return list.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
}

/** Если текущее/прошлое значение не из справочника (старая карта, фото НДА) — показать его первым чипом. */
export function modesForPicker(catalog: string[], current?: string | null): string[] {
  const c = (current ?? '').trim();
  if (c && !catalog.some(x => x === c)) return [c, ...catalog];
  return catalog;
}
