import { addDrugToFormulary, db, newDrugAdmin, recalcAdmin, saveWithAudit, upsertVitalTick, type CaseRec, type Drug, type DrugPhase } from '../db/db';
import type { DictItem } from '../core/dictation';
import { casePatchFor, drugAdminNote, voiceValuesToTickPatch } from '../core/dictationApply';
import { patchOpenCase } from './useCase';

export interface DictationSave {
  c: CaseRec;
  items: DictItem[];
  at: string;
  phase: DrugPhase;
  /** Показатели из той же фразы (только если вызывающий экран сам их не пишет). */
  vitals?: { values: Record<string, string>; mapManual: boolean };
}

/** Записывает выбранное: поля карты — через черновик открытой карты, препараты — строками введений, показатели — минутой. */
export async function saveDictation(p: DictationSave): Promise<void> {
  const { c, items, at, phase } = p;
  const { patch } = casePatchFor(c, items, at);
  if (Object.keys(patch).length) {
    if (!patchOpenCase(cur => casePatchFor(cur, items, at).patch)) {
      const fresh = await db.cases.get(c.id);
      if (fresh) await saveWithAudit(db.cases, 'Case', { ...fresh, ...casePatchFor(fresh, items, at).patch }, { caseId: c.id });
    }
  }
  for (const it of items) {
    if (it.kind !== 'drug') continue;
    let drug: Drug | undefined = it.drugId ? await db.drugs.get(it.drugId) : undefined;
    if (!drug || drug.deletedAt) {
      // нового препарата заводим только с названием: ни концентрации, ни границ доз
      const res = await addDrugToFormulary({ name: it.name });
      drug = res.ok ? res.drug : res.drug;
    }
    if (!drug) continue;
    const base = newDrugAdmin(c, drug, { phase, givenAt: at });
    const row = {
      ...base,
      doseValue: it.doseValue ?? '',
      doseUnit: it.doseUnit ?? base.doseUnit,
      route: it.route ?? base.route,
      note: drugAdminNote(it),
      ...(it.volumeMl ? { manualOverride: true, overrideReason: 'назван голосом', volumeMl: Number(it.volumeMl.replace(',', '.')) } : {}),
    };
    await saveWithAudit(db.drugAdmins, 'DrugAdmin', recalcAdmin(row, c.weightKg), { caseId: c.id, reason: 'голосом' });
  }
  if (p.vitals && Object.keys(p.vitals.values).length) {
    await upsertVitalTick({ caseId: c.id, at, patch: voiceValuesToTickPatch(p.vitals.values, p.vitals.mapManual), reason: 'голосом' });
  }
}
