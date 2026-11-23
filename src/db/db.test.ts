import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ChartDB, saveWithAudit, seed, newCase, softDelete, addBreed, addDrugToFormulary, STARTER_BREEDS, CLINIC_SETTINGS_ID, LOCAL_SETTINGS_ID, upsertVitalTick, valuesToTickPatch, getLocalSettings, ensureRegionalDefaults, clinicBlockNames, clinicLocalAnesthetics, meta } from './db';
import { PRESET_UMEC12_ID, PRESET_WATO_ID } from '../core/devices';

describe('db', () => {
  it('seed: пороги с бланка, препаратов нет, короткий список пород, пустые лимиты', async () => {
    const d = new ChartDB('t1'); await seed(d);
    const set = (await d.thresholds.toArray()).filter(t => t.low != null || t.high != null);
    expect(set.length).toBe(4); expect(await d.drugs.count()).toBe(0); expect(await d.weightRules.count()).toBe(2);
    const breeds = (await d.breeds.toArray()).filter(b => !b.deletedAt);
    expect(breeds.length).toBe(STARTER_BREEDS.length);
    expect(breeds.filter(b => b.species === 'dog').map(b => b.name)).toContain('Метис');
    expect(breeds.filter(b => b.species === 'cat').map(b => b.name)).toContain('Беспородная');
    const limits = await d.examLabLimits.toArray();
    expect(limits.length).toBeGreaterThan(30);
    expect(limits.every(l => l.low == null && l.high == null)).toBe(true);
    const s = await d.clinicSettings.get(CLINIC_SETTINGS_ID);
    expect(s?.examLabLimitsApprovedBy).toBe('');
    expect(s?.examLabLimitsApprovedAt).toBeNull();
    expect(clinicBlockNames(s)).toEqual([]);
    expect(clinicLocalAnesthetics(s).map(x => x.name)).toEqual(['Бупивакаин', 'Лидокаин', 'Ропивакаин']);
    expect(clinicLocalAnesthetics(s).every(x => x.maxMgKg == null)).toBe(true);
  });
  it('старая клиника без справочника местных анестетиков получает стартовый набор один раз', async () => {
    const d = new ChartDB('t-reg-old');
    await d.clinicSettings.add({ ...meta(), id: CLINIC_SETTINGS_ID, examLabLimitsApprovedBy: '', examLabLimitsApprovedAt: null });
    await ensureRegionalDefaults(d);
    const s = await d.clinicSettings.get(CLINIC_SETTINGS_ID);
    expect(clinicLocalAnesthetics(s).map(x => x.name)).toEqual(['Бупивакаин', 'Лидокаин', 'Ропивакаин']);
    await d.clinicSettings.put({ ...s!, localAnesthetics: [] });
    await ensureRegionalDefaults(d);
    expect(clinicLocalAnesthetics(await d.clinicSettings.get(CLINIC_SETTINGS_ID))).toEqual([]);
  });
  it('правка пишет историю и поднимает version', async () => {
    const d = new ChartDB('t2'); const c = newCase();
    const r1 = await saveWithAudit(d.cases, 'Case', { ...c, weightKg: '3,3' }, { caseId: c.id, database: d });
    const r2 = await saveWithAudit(d.cases, 'Case', { ...r1, weightKg: '3,4' }, { caseId: c.id, database: d });
    expect(r2.version).toBe(2); expect(r2.syncState).toBe('pending');
    const a = (await d.audit.where('entityId').equals(c.id).toArray()).filter(x => x.field === 'weightKg');
    expect(a.map(x => `${x.oldValue}→${x.newValue}`).sort()).toEqual(['3,3→3,4', 'null→3,3']);
    await saveWithAudit(d.cases, 'Case', { ...r2 }, { database: d });
    expect((await d.cases.get(c.id))!.version).toBe(2); // без изменений — без новой версии
  });
  it('мягкое удаление', async () => {
    const d = new ChartDB('t3'); const c = newCase(); await saveWithAudit(d.cases, 'Case', c, { database: d });
    await softDelete(d.cases, 'Case', c.id, d); expect((await d.cases.get(c.id))!.deletedAt).toBeTruthy();
  });
  it('порода: добавление и дедупликация по виду', async () => {
    const d = new ChartDB('t4'); await seed(d);
    const a = await addBreed('dog', '  Джек-рассел  ', d);
    expect(a.ok && a.breed.name).toBe('Джек-рассел');
    const dup = await addBreed('dog', 'дже//'.replace('//', 'к-рассел'), d);
    expect(dup.ok).toBe(false);
    expect(!dup.ok && dup.reason).toBe('duplicate');
    const other = await addBreed('cat', 'Джек-рассел', d);
    expect(other.ok).toBe(true);
    const empty = await addBreed('dog', '  ', d);
    expect(empty.ok).toBe(false);
  });
  it('препарат в справочник: дедупликация, опиоиды не запрещены', async () => {
    const d = new ChartDB('t5'); await seed(d);
    const a = await addDrugToFormulary({ name: 'Фентанил', concentration: 50, concentrationUnit: 'mcg/ml', doseUnit: 'mcg/kg', isControlled: true }, d);
    expect(a.ok && a.drug.name).toBe('Фентанил'); expect(a.ok && a.drug.isControlled).toBe(true);
    const dup = await addDrugToFormulary({ name: 'фентанил' }, d);
    expect(dup.ok).toBe(false);
    expect(await d.drugs.filter(x => !x.deletedAt).count()).toBe(1);
  });
  it('реактивация скрытой породы вместо дубля', async () => {
    const d = new ChartDB('t6'); await seed(d);
    const added = await addBreed('dog', 'Хаски', d);
    expect(added.ok).toBe(true);
    if (added.ok) await softDelete(d.breeds, 'Breed', added.breed.id, d);
    const again = await addBreed('dog', 'хаски', d);
    expect(again.ok && again.breed.deletedAt == null).toBe(true);
    expect(await d.breeds.filter(b => b.species === 'dog' && normalizeLive(b.name, 'Хаски')).count()).toBe(1);
  });
  it('seed: два предустановленных прибора и настройки распознавания', async () => {
    const d = new ChartDB('t7'); await seed(d);
    const devs = await d.devices.toArray();
    expect(devs.map(x => x.id).sort()).toEqual([PRESET_UMEC12_ID, PRESET_WATO_ID].sort());
    expect(devs.every(x => x.isPreset && x.isActive)).toBe(true);
    const loc = await getLocalSettings(d);
    expect(loc.id).toBe(LOCAL_SETTINGS_ID);
    expect(loc.storePhotoThumbnail).toBe(false);
    expect(loc.recognitionApiKey).toBe('');
    expect(loc.recognitionProvider).toBe('on-device');
    expect(loc.activeMonitorId).toBe(PRESET_UMEC12_ID);
    expect(devs.every(x => Object.keys(x.regions).length > 0)).toBe(true);
  });
  it('два частичных снимка сливаются в одну минуту карты', async () => {
    const d = new ChartDB('t8'); await seed(d);
    const c = newCase(); await saveWithAudit(d.cases, 'Case', c, { database: d });
    const at = new Date(2026, 10, 13, 12, 47, 47);
    const mon = valuesToTickPatch({ hr: 142, spo2: 100, t2: 38.2, nibpSys: null }, 'monitor');
    const a = await upsertVitalTick({ caseId: c.id, at, patch: { ...mon, sourceMonitorId: PRESET_UMEC12_ID }, database: d });
    expect(a.hr).toBe(142); expect(a.tempC).toBeCloseTo(38.2); expect(a.sys).toBeUndefined();
    const wato = valuesToTickPatch({ ventMode: 'PCV', vtInsp: 45, fio2: 72, hr: null }, 'machine');
    const b = await upsertVitalTick({ caseId: c.id, at: new Date(2026, 10, 13, 12, 47, 10), patch: { ...wato, sourceMachineId: PRESET_WATO_ID }, database: d });
    expect(b.id).toBe(a.id);
    expect(b.hr).toBe(142);
    expect(b.ventMode).toBe('PCV');
    expect(b.vtInsp).toBe(45);
    expect(b.fio2).toBe(72);
    expect(b.sourceMonitorId).toBe(PRESET_UMEC12_ID);
    expect(b.sourceMachineId).toBe(PRESET_WATO_ID);
    expect(await d.vitals.where('caseId').equals(c.id).count()).toBe(1);
  });
});

function normalizeLive(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }
