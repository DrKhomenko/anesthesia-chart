import Dexie, { type Table } from 'dexie';
import type { Species, DoseUnit, ConcUnit, VitalParam } from '../core/logic';
import { defaultThresholds } from '../core/logic';

export type SyncState = 'savedLocal' | 'pending' | 'synced' | 'conflict';
export interface Syncable { id: string; createdAt: string; updatedAt: string; deletedAt?: string | null; version: number; deviceId: string; syncState: SyncState }

export type Stage = 'header' | 'premed' | 'induction' | 'maintenance' | 'recovery' | 'closed';
export interface PreopLabs { hctPct?: string; plateletsE9L?: string; glucoseMmolL?: string; potassiumMmolL?: string; takenAt?: string }
export interface BaselineVitals { at?: string; tempC?: string; hr?: string; rr?: string; crtSec?: string }
export interface Med24h { id: string; text: string; at?: string }
export interface CaseRec extends Syncable {
  number: string; date: string;
  patientName: string; species: Species; breed: string; sex: '' | 'female' | 'male' | 'femaleSpayed' | 'maleNeutered';
  ageText: string; weightKg: string; weightConfirmedAt?: string | null; ownerName: string; allergiesNotes: string;
  diagnosis: string; operation: string;
  surgeon: string; assistant: string; anesthesiologist: string; anesthetist: string;
  asaClass: number | null; asaEmergency: boolean;
  meds24h: Med24h[]; meds24hNone: boolean; preopLabs: PreopLabs; baselineVitals: BaselineVitals;
  anesthesiaStartAt?: string | null; anesthesiaEndAt?: string | null; stage: Stage; isLocked: boolean;
}
export type RouteRu = 'в/в' | 'в/м' | 'п/к' | 'внутрь' | 'ингаляционно';
export interface Drug extends Syncable {
  name: string; genericName: string; defaultConcentration: number | null; concentrationUnit: ConcUnit;
  doseUnit: DoseUnit; defaultRoutes: RouteRu[]; isControlled: boolean; isUserAdded: boolean; isActive: boolean;
}
export interface ThresholdRec extends Syncable { species: Species; parameter: VitalParam; low: number | null; high: number | null; isDefaultFromPaperChart: boolean }
export interface WeightRuleRec extends Syncable { species: Species; minKg: number | null; maxKg: number | null }
export interface AuditEntry { id: string; caseId: string | null; entityType: string; entityId: string; field: string; oldValue: string | null; newValue: string | null; changedBy: string; changedAt: string; deviceId: string; reason?: string | null }
// Таблицы будущих этапов (схема заведена заранее, экраны — позже)
export interface DrugAdmin extends Syncable { caseId: string; drugId: string; drugNameSnapshot: string; phase: string; [k: string]: unknown }
export interface VitalTick extends Syncable { caseId: string; at: string; [k: string]: unknown }
export interface Infusion extends Syncable { caseId: string; line: number; [k: string]: unknown }
export interface EventRec extends Syncable { caseId: string; number: number; at: string; text: string }
export interface AlarmRec extends Syncable { caseId: string; at: string; parameter: VitalParam; value: number; message: string; acknowledgedAt?: string | null }

export class ChartDB extends Dexie {
  cases!: Table<CaseRec, string>; drugs!: Table<Drug, string>; thresholds!: Table<ThresholdRec, string>;
  weightRules!: Table<WeightRuleRec, string>; audit!: Table<AuditEntry, string>;
  drugAdmins!: Table<DrugAdmin, string>; vitals!: Table<VitalTick, string>; infusions!: Table<Infusion, string>;
  events!: Table<EventRec, string>; alarms!: Table<AlarmRec, string>;
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

/** Первичное заполнение: только пороги с бланка (МАД 60, T 36,5) и пустые рамки веса. Препаратов нет — клиника добавляет сама. */
export async function seed(database: ChartDB = db) {
  if ((await database.thresholds.count()) === 0)
    await database.thresholds.bulkAdd(defaultThresholds().map(t => ({ ...meta(), ...t, low: t.low ?? null, high: t.high ?? null, isDefaultFromPaperChart: !!t.isDefaultFromPaperChart })));
  if ((await database.weightRules.count()) === 0)
    await database.weightRules.bulkAdd((['dog', 'cat'] as Species[]).map(species => ({ ...meta(), species, minKg: null, maxKg: null })));
}

export function newCase(): CaseRec {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return { ...meta(), number: `${d.getFullYear()}-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`, date: d.toISOString(),
    patientName: '', species: 'dog', breed: '', sex: '', ageText: '', weightKg: '', weightConfirmedAt: null, ownerName: '', allergiesNotes: '',
    diagnosis: '', operation: '', surgeon: '', assistant: '', anesthesiologist: '', anesthetist: '', asaClass: null, asaEmergency: false,
    meds24h: [], meds24hNone: false, preopLabs: {}, baselineVitals: {}, stage: 'header', isLocked: false };
}

export async function requestPersist(): Promise<boolean | null> {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : null; } catch { return null; }
}
