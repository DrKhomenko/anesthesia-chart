/** Куда ложатся распознанные события: поля карты (чистая функция), заметка к препарату. Ничего не придумывает. */

import type { CaseRec, DrugAdmin, DrugPhase, VitalFields } from '../db/db';
import { fmtTime } from './logic';
import { NOT_SPOKEN_DOSE, SPECIES_LABEL, type DictItem, type DictSpecies } from './dictation';

export interface CasePatch { patch: Partial<CaseRec>; /** индекс элемента → что было в карте (заменится) */ replaces: Record<number, string> }

const hhmm = (iso?: string | null) => (iso ? fmtTime(new Date(iso)) : '');

/** Поля карты из выбранных элементов. Препараты сюда не входят — это отдельные строки введений. */
export function casePatchFor(c: CaseRec, items: readonly DictItem[], at: string): CasePatch {
  const patch: Partial<CaseRec> = {};
  const replaces: Record<number, string> = {};
  let induction = { ...(c.induction ?? {}) };
  let inductionTouched = false;
  let recovery = { ...(c.recovery ?? {}) };
  let recoveryTouched = false;
  items.forEach((it, idx) => {
    if (it.kind === 'patient') {
      if (it.field === 'species') {
        if (c.species !== it.value) replaces[idx] = SPECIES_LABEL[c.species];
        patch.species = it.value as DictSpecies;
      } else {
        const cur = ((patch as Record<string, unknown>)[it.field] ?? c[it.field]) as string;
        if (cur && cur.trim() && cur.trim() !== it.value) replaces[idx] = cur;
        (patch as Record<string, unknown>)[it.field] = it.value;
      }
    } else if (it.kind === 'intubation') {
      if (it.ettMm) {
        const cur = induction.ettSizeMm;
        if (cur && cur.trim() && cur.trim() !== it.ettMm) replaces[idx] = `трубка ${cur}`;
        induction.ettSizeMm = it.ettMm; inductionTouched = true;
      }
      if (!it.sizeOnly) {
        if (induction.intubatedAt) replaces[idx] = `${replaces[idx] ? replaces[idx] + ', ' : ''}интубация ${hhmm(induction.intubatedAt)}`;
        induction.intubatedAt = at; inductionTouched = true;
      }
    } else if (it.kind === 'time') {
      switch (it.event) {
        case 'induction':
          if (c.anesthesiaStartAt) replaces[idx] = hhmm(c.anesthesiaStartAt);
          patch.anesthesiaStartAt = at; break;
        case 'surgeryStart':
          if (c.surgeryStartAt) replaces[idx] = hhmm(c.surgeryStartAt);
          patch.surgeryStartAt = at; break;
        case 'surgeryEnd':
          if (c.surgeryEndAt) replaces[idx] = hhmm(c.surgeryEndAt);
          patch.surgeryEndAt = at; break;
        case 'anesthesiaEnd':
          if (c.anesthesiaEndAt) replaces[idx] = hhmm(c.anesthesiaEndAt);
          patch.anesthesiaEndAt = at; break;
        case 'extubation':
          if (recovery.extubatedAt) replaces[idx] = hhmm(recovery.extubatedAt);
          recovery.extubatedAt = at; recoveryTouched = true; break;
        case 'catheter': {
          const line = `${hhmm(at)} — катетер установлен`;
          induction = { ...induction, notes: induction.notes?.trim() ? `${induction.notes.trim()}\n${line}` : line };
          inductionTouched = true; break;
        }
      }
    }
  });
  if (inductionTouched) patch.induction = induction;
  if (recoveryTouched) patch.recovery = recovery;
  return { patch, replaces };
}

/** Фаза введения по ходу диктовки: интубация/индукция рядом → индукция, экстубация → пробуждение, иначе по этапу карты. */
export function defaultPhase(stage: CaseRec['stage'], items: readonly DictItem[]): DrugPhase {
  if (items.some(i => (i.kind === 'intubation' && !i.sizeOnly) || (i.kind === 'time' && i.event === 'induction'))) return 'induction';
  if (items.some(i => i.kind === 'time' && i.event === 'extubation')) return 'recovery';
  if (stage === 'induction') return 'induction';
  if (stage === 'maintenance') return 'maintenance';
  if (stage === 'recovery' || stage === 'closed') return 'recovery';
  return 'premed';
}

/** Заметка к строке введения. «доза не указана» превращается в оранжевую метку в таблице препаратов. */
export function drugAdminNote(it: Extract<DictItem, { kind: 'drug' }>): string {
  const parts: string[] = [];
  if (!it.doseValue) {
    const said = it.volumeMl ? `назван объём ${it.volumeMl} мл` : it.spokenOther ? `названо ${it.spokenOther}` : '';
    parts.push(said ? `${NOT_SPOKEN_DOSE} в мг/кг (${said})` : NOT_SPOKEN_DOSE);
  }
  if (!it.route) parts.push('путь не указан');
  return parts.length ? `${parts.join('; ')} (голосом)` : 'голосом';
}

export function hasNoDoseFlag(a: Pick<DrugAdmin, 'doseValue' | 'note'>): boolean {
  return !a.doseValue && (a.note ?? '').startsWith(NOT_SPOKEN_DOSE);
}

/** Показатели из голосового разбора → поля записи минуты. Названия полей формы → поля VitalFields. */
const TICK_KEY: Record<string, keyof VitalFields> = { nibpSys: 'sys', nibpDia: 'dia', nibpMap: 'map' };
export function voiceValuesToTickPatch(values: Record<string, string>, mapManual: boolean): Partial<VitalFields> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const key = TICK_KEY[k] ?? k;
    if (key === 'ventMode') { if (v) patch.ventMode = v; continue; }
    const n = Number(String(v).replace(',', '.'));
    if (Number.isFinite(n)) patch[key] = n;
  }
  if (mapManual && patch.map != null) patch.mapManual = true;
  return patch as Partial<VitalFields>;
}
