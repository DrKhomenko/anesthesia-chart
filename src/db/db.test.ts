import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ChartDB, saveWithAudit, seed, newCase, softDelete } from './db';

describe('db', () => {
  it('seed: только пороги с бланка, препаратов нет', async () => {
    const d = new ChartDB('t1'); await seed(d);
    const set = (await d.thresholds.toArray()).filter(t => t.low != null || t.high != null);
    expect(set.length).toBe(4); expect(await d.drugs.count()).toBe(0); expect(await d.weightRules.count()).toBe(2);
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
});
