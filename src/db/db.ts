import Dexie, { type Table } from 'dexie';
import type { Species, DoseUnit, ConcUnit, VitalParam, ExamLabParam } from '../core/logic';
import { defaultThresholds, EXAM_LAB_PARAMS, canAddCatalogItem, normalizeCatalogName, calcDose } from '../core/logic';
import { PRESET_DEVICES, PRESET_UMEC12_ID, PRESET_WATO_ID, type DeviceType, type FieldRegion } from '../core/devices';
import { findTickAtMinute, type ParsedValue } from '../core/vision';

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
  surgeryStartAt?: string | null; surgeryEndAt?: string | null;
  induction?: InductionData; recovery?: RecoveryData;
}
export type YesNo = '' | 'yes' | 'no';
export interface InductionData {
  maskInduction?: YesNo; ettSizeMm?: string; cuff?: YesNo; cuffNote?: string; attempts?: string; intubatedAt?: string;
  intubationComplications?: string; lidocaineSpray?: YesNo; connectedAt?: string;
  ventMode?: string; pinsp?: string; vt?: string; rr?: string; peep?: string;
  gas?: '' | 'sevo' | 'iso'; gasPct?: string; o2Flow?: string; notes?: string;
}
export interface RecoveryData {
  extubatedAt?: string; quality?: number | null; tempAtExtubation?: string;
  complications?: string[]; otherComplication?: string;
  transferTo?: '' | 'ward' | 'icu' | 'home'; transferAt?: string; notes?: string;
  signedBy?: string; signedAt?: string | null;
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
  clinicName?: string;
  /** Список осложнений пробуждения — только подписи, редактирует клиника. */
  complicationLabels?: string[];
  /** Подписи шкалы качества пробуждения 1–5; пустая подпись = только цифра. */
  recoveryScaleLabels?: string[];
}
export const DEFAULT_CLINIC_NAME = 'Крымский ветеринарный госпиталь';
export const DEFAULT_COMPLICATION_LABELS = ['рвота', 'апноэ', 'возбуждение', 'гипотермия'];
export function complicationLabelsOf(s: ClinicSettings | undefined | null): string[] {
  return Array.isArray(s?.complicationLabels) ? s!.complicationLabels!.filter(x => typeof x === 'string' && x.trim()) : [...DEFAULT_COMPLICATION_LABELS];
}
export function recoveryScaleOf(s: ClinicSettings | undefined | null): string[] {
  const src = Array.isArray(s?.recoveryScaleLabels) ? s!.recoveryScaleLabels! : [];
  return [0, 1, 2, 3, 4].map(i => (src[i] ?? '').trim());
}
export interface DeviceRec extends Syncable {
  type: DeviceType; name: string; fieldKeys: string[];
  regions: Record<string, FieldRegion>;
  isPreset: boolean; isUserAdded: boolean; isActive: boolean;
}
export const LOCAL_SETTINGS_ID = 'local';
export type RecognitionProvider = 'on-device' | 'cloud';
export interface LocalSettings {
  id: string;
  recognitionProvider: RecognitionProvider;
  recognitionBaseUrl: string;
  recognitionModel: string;
  recognitionApiKey: string;
  recognitionFallbackModels: string[];
  storePhotoThumbnail: boolean;
  activeMonitorId: string | null;
  activeMachineId: string | null;
  /** Синхронизация (по умолчанию выключена). Всё хранится только на этом устройстве. */
  syncEnabled?: boolean; syncUrl?: string; syncAnonKey?: string; syncEmail?: string;
  syncRefreshToken?: string; syncLastPulledAt?: string | null; syncLastOkAt?: string | null; syncLastError?: string | null;
}
export function defaultLocalSettings(): LocalSettings {
  return {
    id: LOCAL_SETTINGS_ID, recognitionProvider: 'on-device',
    recognitionBaseUrl: '', recognitionModel: '', recognitionApiKey: '',
    recognitionFallbackModels: [],
    storePhotoThumbnail: false, activeMonitorId: PRESET_UMEC12_ID, activeMachineId: PRESET_WATO_ID,
  };
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
export interface VitalFields {
  hr?: number | null; pr?: number | null; spo2?: number | null; etco2?: number | null; fico2?: number | null;
  rr?: number | null; t1?: number | null; t2?: number | null; tempC?: number | null;
  sys?: number | null; dia?: number | null; map?: number | null;
  ventMode?: string | null; setPinsp?: number | null; setRr?: number | null; setIE?: string | null;
  setTslope?: number | null; setPeep?: number | null; pPeak?: number | null; pPlat?: number | null;
  peep?: number | null; vtInsp?: number | null; vtExp?: number | null; tidalVolume?: number | null;
  mv?: number | null; rrMeas?: number | null; fio2?: number | null; raw?: number | null; compliance?: number | null;
  sevoPct?: number | null; isoPct?: number | null; o2Flow?: number | null;
  sourceMonitorId?: string | null; sourceMachineId?: string | null;
  thumbnailMonitor?: string | null; thumbnailMachine?: string | null;
}
export interface VitalTick extends Syncable, VitalFields { caseId: string; at: string }
export interface Infusion extends Syncable { caseId: string; line: number; [k: string]: unknown }
export interface EventRec extends Syncable { caseId: string; number: number; at: string; text: string }
export interface AlarmRec extends Syncable { caseId: string; at: string; parameter: VitalParam; value: number; message: string; acknowledgedAt?: string | null }

export class ChartDB extends Dexie {
  cases!: Table<CaseRec, string>; drugs!: Table<Drug, string>; thresholds!: Table<ThresholdRec, string>;
  weightRules!: Table<WeightRuleRec, string>; audit!: Table<AuditEntry, string>;
  drugAdmins!: Table<DrugAdmin, string>; vitals!: Table<VitalTick, string>; infusions!: Table<Infusion, string>;
  events!: Table<EventRec, string>; alarms!: Table<AlarmRec, string>;
  breeds!: Table<Breed, string>; examLabLimits!: Table<ExamLabLimitRec, string>; clinicSettings!: Table<ClinicSettings, string>;
  devices!: Table<DeviceRec, string>; localSettings!: Table<LocalSettings, string>;
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
    this.version(3).stores({
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
      devices: 'id, type, name, syncState, deletedAt',
      localSettings: 'id',
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
  await seedDevices(database);
  await ensurePresetRegions(database);
  if (!(await database.localSettings.get(LOCAL_SETTINGS_ID)))
    await database.localSettings.add(defaultLocalSettings());
}

/** Предустановленные uMEC12 и WATO, если их ещё нет (удалённые пользователем не воскрешаем). */
export async function seedDevices(database: ChartDB = db) {
  for (const p of PRESET_DEVICES) {
    if (await database.devices.get(p.id)) continue;
    const rec: DeviceRec = {
      ...meta(), id: p.id, type: p.type, name: p.name, fieldKeys: [...p.fieldKeys],
      regions: { ...p.regions }, isPreset: true, isUserAdded: false, isActive: true,
    };
    await database.devices.add(rec);
  }
}

/** Если у шаблона ещё нет рамок полей (старые установки) — заполняем, не затирая правки. */
export async function ensurePresetRegions(database: ChartDB = db) {
  for (const p of PRESET_DEVICES) {
    const prev = await database.devices.get(p.id);
    if (!prev || prev.deletedAt) continue;
    if (prev.regions && Object.keys(prev.regions).length > 0) continue;
    await database.devices.put({ ...prev, regions: { ...p.regions } });
  }
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

export function newDrugAdmin(c: CaseRec, d: Drug, opts: { repeatOfId?: string | null; givenAt?: string; phase?: DrugPhase } = {}): DrugAdmin {
  const row: DrugAdmin = {
    ...meta(), caseId: c.id, drugId: d.id, drugNameSnapshot: d.name, genericNameSnapshot: d.genericName,
    phase: opts.phase ?? 'premed', doseValue: '', doseUnit: d.doseUnit, weightKgUsed: c.weightKg,
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

const TICK_KEY: Record<string, keyof VitalFields> = { nibpSys: 'sys', nibpDia: 'dia', nibpMap: 'map' };

/** Перенос распознанных полей прибора в поля записи карты. Пустые значения пропускаем. */
export function valuesToTickPatch(values: Record<string, ParsedValue>, type: DeviceType): Partial<VitalFields> {
  const patch: Partial<VitalFields> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v == null || v === '') continue;
    const key = (TICK_KEY[k] ?? k) as keyof VitalFields;
    (patch as Record<string, unknown>)[key] = v;
  }
  if (type === 'monitor' && patch.t2 != null && patch.tempC == null) patch.tempC = typeof patch.t2 === 'number' ? patch.t2 : null;
  if (type === 'machine' && patch.vtInsp != null && patch.tidalVolume == null) patch.tidalVolume = typeof patch.vtInsp === 'number' ? patch.vtInsp : null;
  return patch;
}

export function tickToValues(tick: VitalFields, fieldKeys: string[]): Record<string, ParsedValue> {
  const out: Record<string, ParsedValue> = {};
  for (const k of fieldKeys) {
    const src = k === 'nibpSys' ? 'sys' : k === 'nibpDia' ? 'dia' : k === 'nibpMap' ? 'map' : k;
    const v = (tick as Record<string, unknown>)[src];
    out[k] = (v == null || v === '') ? null : v as ParsedValue;
  }
  return out;
}

/** Создать или дополнить запись той же минуты. Новые непустые поля дописываются, старые пустым не затираются. */
export async function upsertVitalTick(opts: {
  caseId: string; at: Date | string; patch: Partial<VitalFields>;
  database?: ChartDB; reason?: string | null;
}): Promise<VitalTick> {
  const d = opts.database ?? db;
  const atIso = typeof opts.at === 'string' ? opts.at : opts.at.toISOString();
  const ticks = await d.vitals.where('caseId').equals(opts.caseId).toArray();
  const existing = findTickAtMinute(ticks, atIso);
  const clean: Partial<VitalFields> = {};
  for (const [k, v] of Object.entries(opts.patch) as [keyof VitalFields, unknown][]) {
    if (v != null && v !== '') (clean as Record<string, unknown>)[k] = v;
  }
  if (existing) {
    return saveWithAudit(d.vitals, 'VitalTick', { ...existing, ...clean }, { caseId: opts.caseId, database: d, reason: opts.reason ?? null });
  }
  const rec: VitalTick = { ...meta(), caseId: opts.caseId, at: atIso, ...clean };
  return saveWithAudit(d.vitals, 'VitalTick', rec, { caseId: opts.caseId, database: d, reason: opts.reason ?? null });
}

export async function getLocalSettings(database: ChartDB = db): Promise<LocalSettings> {
  const cur = await database.localSettings.get(LOCAL_SETTINGS_ID);
  if (!cur) return defaultLocalSettings();
  const fallbacks = Array.isArray((cur as Partial<LocalSettings>).recognitionFallbackModels)
    ? (cur as LocalSettings).recognitionFallbackModels.filter(x => typeof x === 'string' && x.trim())
    : [];
  return { ...defaultLocalSettings(), ...cur, id: LOCAL_SETTINGS_ID, recognitionFallbackModels: fallbacks };
}

/** Ключ API не пишем в историю правок. */
export async function saveLocalSettings(next: LocalSettings, database: ChartDB = db): Promise<void> {
  await database.localSettings.put({ ...next, id: LOCAL_SETTINGS_ID });
}
