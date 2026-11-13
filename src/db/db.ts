import Dexie, { type Table } from 'dexie';
import type { Species, DoseUnit, ConcUnit, VitalParam, ExamLabParam } from '../core/logic';
import { defaultThresholds, EXAM_LAB_PARAMS, canAddCatalogItem, normalizeCatalogName, calcDose } from '../core/logic';

export type SyncState = 'savedLocal' | 'pending' | 'synced' | 'conflict';
export interface Syncable { id: string; createdAt: string; updatedAt: string; deletedAt?: string | null; version: number; deviceId: string; syncState: SyncState }

export type Stage = 'header' | 'premed' | 'induction' | 'maintenance' | 'recovery' | 'closed';
export interface PreopLabs {
  hctPct?: string; plateletsE9L?: string; glucoseMmolL?: string; potassiumMmolL?: string;
  totalProteinGl?: string; albuminGl?: string; lactateMmolL?: string; creatinineUmolL?: string;
  ureaMmolL?: string; sodiumMmolL?: string; icaMmolL?: string; wbcE9L?: string; takenAt?: string;
}
export interface BaselineVitals {
  at?: string; tempC?: string; hr?: string; rr?: string; crtSec?: string;
  spo2?: string; sys?: string; dia?: string; map?: string;
}
export interface PreInductionVitals {
  at?: string; hr?: string; rr?: string; spo2?: string; tempC?: string;
  sys?: string; dia?: string; map?: string;
}
export interface Med24h { id: string; text: string; at?: string }
export interface CaseRec extends Syncable {
  number: string; date: string;
  patientName: string; species: Species; breed: string; sex: '' | 'female' | 'male' | 'femaleSpayed' | 'maleNeutered';
  ageText: string; weightKg: string; weightConfirmedAt?: string | null; ownerName: string; allergiesNotes: string;
  diagnosis: string; operation: string;
  surgeon: string; assistant: string; anesthesiologist: string; anesthetist: string;
  asaClass: number | null; asaEmergency: boolean;
  meds24h: Med24h[]; meds24hNone: boolean; preopLabs: PreopLabs; baselineVitals: BaselineVitals;
  preInductionVitals?: PreInductionVitals; premedNotes?: string;
  anesthesiaStartAt?: string | null; anesthesiaEndAt?: string | null; stage: Stage; isLocked: boolean;
}
export type RouteRu = 'в/в' | 'в/м' | 'п/к' | 'внутрь' | 'ингаляционно';
export interface Drug extends Syncable {
  name: string; genericName: string; defaultConcentration: number | null; concentrationUnit: ConcUnit;
  doseUnit: DoseUnit; minDose: number | null; maxDose: number | null;
  defaultRoutes: RouteRu[]; isControlled: boolean; isUserAdded: boolean; isActive: boolean;
}
export interface ThresholdRec extends Syncable { species: Species; parameter: VitalParam; low: number | null; high: number | null; isDefaultFromPaperChart: boolean }
export interface WeightRuleRec extends Syncable { species: Species; minKg: number | null; maxKg: number | null }
export interface Breed extends Syncable { species: Species; name: string; isUserAdded: boolean; isActive: boolean }
export interface ExamLabLimitRec extends Syncable { species: Species; parameter: ExamLabParam; low: number | null; high: number | null }
export const CLINIC_SETTINGS_ID = 'clinic';
export interface ClinicSettings extends Syncable {
  examLabLimitsApprovedBy: string; examLabLimitsApprovedAt: string | null;
}
export interface AuditEntry { id: string; caseId: string | null; entityType: string; entityId: string; field: string; oldValue: string | null; newValue: string | null; changedBy: string; changedAt: string; deviceId: string; reason?: string | null }
export type DrugPhase = 'premed' | 'induction' | 'maintenance' | 'recovery' | 'cpr';
export interface DrugAdmin extends Syncable {
  caseId: string; drugId: string; drugNameSnapshot: string; genericNameSnapshot: string;
  phase: DrugPhase; doseValue: string; doseUnit: DoseUnit; weightKgUsed: string;
  concentration: number | null; concentrationUnit: ConcUnit;
  totalMg: number | null; volumeMl: number | null;
  manualOverride: boolean; overrideReason: string | null;
  route: RouteRu; givenAt: string; givenBy: string; note: string;
  repeatOfId: string | null; nextDueAt: string | null;
}
export interface VitalTick extends Syncable { caseId: string; at: string; [k: string]: unknown }
export interface Infusion extends Syncable { caseId: string; line: number; [k: string]: unknown }
export interface EventRec extends Syncable { caseId: string; number: number; at: string; text: string }
export interface AlarmRec extends Syncable { caseId: string; at: string; parameter: VitalParam; value: number; message: string; acknowledgedAt?: string | null }

export class ChartDB extends Dexie {
  cases!: Table<CaseRec, string>; drugs!: Table<Drug, string>; thresholds!: Table<ThresholdRec, string>;
  weightRules!: Table<WeightRuleRec, string>; audit!: Table<AuditEntry, string>;
  drugAdmins!: Table<DrugAdmin, string>; vitals!: Table<VitalTick, string>; infusions!: Table<Infusion, string>;
  events!: Table<EventRec, string>; alarms!: Table<AlarmRec, string>;
  breeds!: Table<Breed, string>; examLabLimits!: Table<ExamLabLimitRec, string>; clinicSettings!: Table<ClinicSettings, string>;
  constructor(name = 'anesthesia-chart') {
    super(name);
    this.version(1).stores({
      cases: 'id, updatedAt, date, syncState, deletedAt',
      drugs: 'id, name, syncState, deletedAt',
      thresholds: 'id, [species+parameter], syncState',
      weightRules: 'id, &species, syncState',
      audit: 'id, caseId, entityId, changedAt',
      drugAdmins: 'id, caseId, phase, syncState', vitals: 'id, caseId, at, syncState',
      infusions: 'id, caseId, syncState', events: 'id, caseId, at, syncState', alarms: 'id, caseId, at, syncState',
    });
    this.version(2).stores({
      cases: 'id, updatedAt, date, syncState, deletedAt',
      drugs: 'id, name, syncState, deletedAt',
      thresholds: 'id, [species+parameter], syncState',
      weightRules: 'id, &species, syncState',
      audit: 'id, caseId, entityId, changedAt',
      drugAdmins: 'id, caseId, phase, syncState', vitals: 'id, caseId, at, syncState',
      infusions: 'id, caseId, syncState', events: 'id, caseId, at, syncState', alarms: 'id, caseId, at, syncState',
      breeds: 'id, species, name, syncState, deletedAt',
      examLabLimits: 'id, [species+parameter], syncState',
      clinicSettings: 'id',
    });
  }
}
export const db = new ChartDB();

export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function deviceId(): string {
  try { let d = localStorage.getItem('deviceId'); if (!d) { d = uuid(); localStorage.setItem('deviceId', d); } return d; } catch { return 'test-device'; }
}
export function meta(): Syncable { const t = now(); return { id: uuid(), createdAt: t, updatedAt: t, deletedAt: null, version: 1, deviceId: deviceId(), syncState: 'pending' }; }

const str = (v: unknown) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
const SKIP = new Set(['updatedAt', 'version', 'syncState', 'deviceId']);

/** Единая точка записи: сохраняет, поднимает version, ставит «ждёт отправки», пишет историю правок по каждому полю. */
export async function saveWithAudit<T extends Syncable>(table: Table<T, string>, entityType: string, next: T, opts: { caseId?: string | null; by?: string; reason?: string | null; database?: ChartDB } = {}) {
  const d = opts.database ?? db;
  return d.transaction('rw', table, d.audit, async () => {
    const prev = await table.get(next.id);
    const rec = { ...next, updatedAt: now(), version: (prev?.version ?? 0) + 1, syncState: 'pending' as SyncState, deviceId: deviceId() };
    const entries: AuditEntry[] = [];
    const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
    for (const k of keys) {
      if (SKIP.has(k)) continue;
      const o = str((prev as any)?.[k]), n = str((next as any)[k]);
      if (o !== n && (prev || n != null && n !== '' && n !== '[]' && n !== '{}' && n !== 'false'))
        entries.push({ id: uuid(), caseId: opts.caseId ?? null, entityType, entityId: next.id, field: k, oldValue: prev ? o : null, newValue: n, changedBy: opts.by ?? 'на планшете', changedAt: rec.updatedAt, deviceId: rec.deviceId, reason: opts.reason ?? null });
    }
    if (prev && entries.length === 0) return prev;
    await table.put(rec as T);
    if (entries.length) await d.audit.bulkAdd(entries);
    return rec as T;
  });
}

export async function softDelete<T extends Syncable>(table: Table<T, string>, entityType: string, id: string, database: ChartDB = db) {
  const prev = await table.get(id); if (!prev) return;
  await saveWithAudit(table, entityType, { ...prev, deletedAt: now() }, { database });
}

export const STARTER_BREEDS: { species: Species; name: string }[] = [
  ...(['Метис', 'Лабрадор', 'Немецкая овчарка', 'Йоркширский терьер', 'Такса', 'Французский бульдог', 'Шпиц'] as const).map(name => ({ species: 'dog' as const, name })),
  ...(['Беспородная', 'Британская', 'Шотландская', 'Мейн-кун', 'Сиамская', 'Сфинкс', 'Персидская'] as const).map(name => ({ species: 'cat' as const, name })),
];

/** Первичное заполнение: пороги с бланка, пустые рамки веса и лимитов, короткий список пород. Препаратов нет. */
export async function seed(database: ChartDB = db) {
  if ((await database.thresholds.count()) === 0)
    await database.thresholds.bulkAdd(defaultThresholds().map(t => ({ ...meta(), ...t, low: t.low ?? null, high: t.high ?? null, isDefaultFromPaperChart: !!t.isDefaultFromPaperChart })));
  if ((await database.weightRules.count()) === 0)
    await database.weightRules.bulkAdd((['dog', 'cat'] as Species[]).map(species => ({ ...meta(), species, minKg: null, maxKg: null })));
  if ((await database.breeds.count()) === 0)
    await database.breeds.bulkAdd(STARTER_BREEDS.map(b => ({ ...meta(), ...b, isUserAdded: false, isActive: true })));
  if ((await database.examLabLimits.count()) === 0)
    await database.examLabLimits.bulkAdd((['dog', 'cat'] as Species[]).flatMap(species =>
      EXAM_LAB_PARAMS.map(p => ({ ...meta(), species, parameter: p.key, low: null, high: null }))));
  if (!(await database.clinicSettings.get(CLINIC_SETTINGS_ID)))
    await database.clinicSettings.add({ ...meta(), id: CLINIC_SETTINGS_ID, examLabLimitsApprovedBy: '', examLabLimitsApprovedAt: null });
}

export function newCase(): CaseRec {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return { ...meta(), number: `${d.getFullYear()}-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`, date: d.toISOString(),
    patientName: '', species: 'dog', breed: '', sex: '', ageText: '', weightKg: '', weightConfirmedAt: null, ownerName: '', allergiesNotes: '',
    diagnosis: '', operation: '', surgeon: '', assistant: '', anesthesiologist: '', anesthetist: '', asaClass: null, asaEmergency: false,
    meds24h: [], meds24hNone: false, preopLabs: {}, baselineVitals: {}, preInductionVitals: {}, premedNotes: '',
    stage: 'header', isLocked: false };
}

export async function requestPersist(): Promise<boolean | null> {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : null; } catch { return null; }
}

export function recalcAdmin(row: DrugAdmin, weightKg: string): DrugAdmin {
  const r = calcDose({ weightKg, dose: row.doseValue, doseUnit: row.doseUnit, concentration: row.concentration, concUnit: row.concentrationUnit });
  const totalMg = r.ok ? r.totalMg : null;
  const volumeMl = r.ok && !row.manualOverride ? r.volumeMl : row.manualOverride ? row.volumeMl : null;
  return { ...row, weightKgUsed: weightKg, totalMg, volumeMl };
}

export function newDrugAdmin(c: CaseRec, d: Drug, opts: { repeatOfId?: string | null; givenAt?: string } = {}): DrugAdmin {
  const row: DrugAdmin = {
    ...meta(), caseId: c.id, drugId: d.id, drugNameSnapshot: d.name, genericNameSnapshot: d.genericName,
    phase: 'premed', doseValue: '', doseUnit: d.doseUnit, weightKgUsed: c.weightKg,
    concentration: d.defaultConcentration, concentrationUnit: d.concentrationUnit,
    totalMg: null, volumeMl: null, manualOverride: false, overrideReason: null,
    route: d.defaultRoutes[0] ?? 'в/в', givenAt: opts.givenAt ?? now(), givenBy: c.anesthesiologist || c.anesthetist || '',
    note: '', repeatOfId: opts.repeatOfId ?? null, nextDueAt: null,
  };
  return recalcAdmin(row, c.weightKg);
}

/** Добавить породу (с дедупликацией по виду, реактивация скрытой). */
export async function addBreed(species: Species, rawName: string, database: ChartDB = db): Promise<{ ok: true; breed: Breed } | { ok: false; reason: 'empty' | 'duplicate'; existingName?: string; breed?: Breed }> {
  const all = await database.breeds.where('species').equals(species).toArray();
  const live = all.filter(b => !b.deletedAt);
  const check = canAddCatalogItem(rawName, live);
  if (!check.ok) {
    const existing = live.find(b => normalizeCatalogName(b.name).toLowerCase() === normalizeCatalogName(rawName).toLowerCase());
    return { ok: false, reason: check.reason, existingName: check.existingName, breed: existing };
  }
  const hidden = all.find(b => b.deletedAt && normalizeCatalogName(b.name).toLowerCase() === check.name.toLowerCase());
  if (hidden) {
    const breed = await saveWithAudit(database.breeds, 'Breed', { ...hidden, deletedAt: null, isActive: true, name: check.name }, { database });
    return { ok: true, breed };
  }
  const breed: Breed = { ...meta(), species, name: check.name, isUserAdded: true, isActive: true };
  await saveWithAudit(database.breeds, 'Breed', breed, { database });
  return { ok: true, breed };
}

export async function addDrugToFormulary(p: { name: string; genericName?: string; concentration?: number | null; concentrationUnit?: ConcUnit; doseUnit?: DoseUnit; minDose?: number | null; maxDose?: number | null; route?: RouteRu; isControlled?: boolean }, database: ChartDB = db): Promise<{ ok: true; drug: Drug } | { ok: false; reason: 'empty' | 'duplicate'; existingName?: string; drug?: Drug }> {
  const all = await database.drugs.filter(d => !d.deletedAt).toArray();
  const check = canAddCatalogItem(p.name, all);
  if (!check.ok) {
    const existing = all.find(d => normalizeCatalogName(d.name).toLowerCase() === normalizeCatalogName(p.name).toLowerCase());
    return { ok: false, reason: check.reason, existingName: check.existingName, drug: existing };
  }
  const drug: Drug = {
    ...meta(), name: check.name, genericName: (p.genericName ?? '').trim(),
    defaultConcentration: p.concentration ?? null, concentrationUnit: p.concentrationUnit ?? 'mg/ml',
    doseUnit: p.doseUnit ?? 'mg/kg', minDose: p.minDose ?? null, maxDose: p.maxDose ?? null,
    defaultRoutes: [p.route ?? 'в/в'], isControlled: !!p.isControlled, isUserAdded: true, isActive: true,
  };
  await saveWithAudit(database.drugs, 'Drug', drug, { database });
  return { ok: true, drug };
}
