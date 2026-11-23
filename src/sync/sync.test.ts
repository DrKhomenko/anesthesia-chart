import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ChartDB, newCase, saveWithAudit } from '../db/db';
import { decideMerge, newer, toRemote, fromRemote, parseCursor, type RemoteRow } from './core';
import { syncOnce } from './engine';
import type { SyncClient } from './client';

/** Сервер в памяти с теми же правилами, что SQL sync_push: пишет только более позднюю версию. */
function fakeServer() {
  const rows = new Map<string, RemoteRow>(); let clock = 0;
  const key = (r: RemoteRow) => (r.tbl === 'cases' ? `cases:${r.id}` : `records:${r.tbl}:${r.id}`);
  const client: SyncClient = {
    async push(batch) {
      const rejected: string[] = [];
      for (const r of batch) {
        const prev = rows.get(key(r));
        const cmp = prev ? newer({ updatedAt: r.updated_at, version: r.version, deviceId: r.device_id }, { updatedAt: prev.updated_at, version: prev.version, deviceId: prev.device_id }) : 1;
        if (cmp < 0) rejected.push(`${r.tbl}:${r.id}`);
        if (cmp <= 0) continue;
        rows.set(key(r), { ...r, server_updated_at: new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString() });
      }
      return rejected;
    },
    async pull(table, since, limit) {
      return [...rows.values()].filter(r => (table === 'cases') === (r.tbl === 'cases') && (!since || r.server_updated_at! > since))
        .sort((a, b) => a.server_updated_at!.localeCompare(b.server_updated_at!)).slice(0, limit);
    },
  };
  return { rows, client };
}

describe('sync core', () => {
  const base = { updatedAt: '2026-11-23T10:00:00.000Z', version: 2, deviceId: 'a' };
  it('newer: time, then version, then device', () => {
    expect(newer({ ...base, updatedAt: '2026-11-23T10:00:01.000Z' }, base)).toBe(1);
    expect(newer({ ...base, version: 3 }, base)).toBe(1);
    expect(newer({ ...base, deviceId: 'b' }, base)).toBe(1);
    expect(newer(base, base)).toBe(0);
  });
  it('decideMerge', () => {
    const later = { ...base, updatedAt: '2026-11-23T11:00:00.000Z' };
    expect(decideMerge(undefined, base)).toBe('insert');
    expect(decideMerge({ id: 'x', ...base, syncState: 'synced' }, later)).toBe('apply');
    expect(decideMerge({ id: 'x', ...base, syncState: 'pending' }, later)).toBe('applyConflict');
    expect(decideMerge({ id: 'x', ...later, syncState: 'pending' }, base)).toBe('keepLocal');
    expect(decideMerge({ id: 'x', ...base }, base)).toBe('same');
  });
  it('round-trip strips local-only fields and thumbnails', () => {
    const r = toRemote('vitals', { id: 'v', caseId: 'c', updatedAt: base.updatedAt, version: 1, deviceId: 'a', syncState: 'pending', hr: 80, thumbnailMonitor: 'data:...' });
    expect(r.case_id).toBe('c'); expect(r.data.syncState).toBeUndefined(); expect(r.data.thumbnailMonitor).toBeUndefined();
    expect(fromRemote(r)).toMatchObject({ id: 'v', hr: 80, syncState: 'synced' });
  });
  it('parseCursor tolerates junk', () => {
    expect(parseCursor(null)).toEqual({ cases: null, records: null });
    expect(parseCursor('{"cases":"x"}')).toEqual({ cases: 'x', records: null });
  });
});

describe('sync engine', () => {
  it('pushes queue, pulls to other device, LWW with conflict kept in history', async () => {
    const srv = fakeServer();
    const A = new ChartDB('sa'), B = new ChartDB('sb');
    const c = newCase();
    await saveWithAudit(A.cases, 'Case', { ...c, patientName: 'Бакс' }, { database: A });
    const r1 = await syncOnce(srv.client, null, A);
    expect(r1.pushed).toBe(1);
    expect((await A.cases.get(c.id))!.syncState).toBe('synced');

    const r2 = await syncOnce(srv.client, null, B);
    expect(r2.pulled).toBe(1);
    expect((await B.cases.get(c.id))!.patientName).toBe('Бакс');

    // Офлайн-правки на обоих: B позже — побеждает B, правка A уходит в историю A.
    const a = (await A.cases.get(c.id))!; const b = (await B.cases.get(c.id))!;
    await A.cases.put({ ...a, patientName: 'A-правка', updatedAt: '2030-01-01T10:00:00.000Z', version: a.version + 1, syncState: 'pending' });
    await B.cases.put({ ...b, patientName: 'B-правка', updatedAt: '2030-01-01T10:05:00.000Z', version: b.version + 1, syncState: 'pending' });
    const rb = await syncOnce(srv.client, r2.cursor ? JSON.stringify(r2.cursor) : null, B);
    expect(rb.pushed).toBe(1);
    const ra = await syncOnce(srv.client, JSON.stringify(r1.cursor), A);
    // A отправил свою (сервер отклонил — она старее), затем забрал B-версию.
    expect((await A.cases.get(c.id))!.patientName).toBe('B-правка');
    expect(srv.rows.get(`cases:${c.id}`)!.data.patientName).toBe('B-правка');
    expect(ra.conflicts).toBe(1);
    const hist = await A.audit.filter(e => e.changedBy === 'синхронизация').toArray();
    expect(hist).toHaveLength(1);
    expect(hist[0].oldValue).toContain('A-правка');
    expect((await A.cases.get(c.id))!.syncState).toBe('synced');
  });
  it('local newer than server is kept and re-pushed', async () => {
    const srv = fakeServer();
    const A = new ChartDB('sc');
    const c = newCase();
    await saveWithAudit(A.cases, 'Case', c, { database: A });
    await syncOnce(srv.client, null, A);
    const cur = (await A.cases.get(c.id))!;
    await A.cases.put({ ...cur, patientName: 'новое', updatedAt: '2031-01-01T00:00:00.000Z', version: cur.version + 1, syncState: 'pending' });
    await syncOnce(srv.client, null, A);
    expect((await A.cases.get(c.id))!.patientName).toBe('новое');
    expect(srv.rows.get(`cases:${c.id}`)!.data.patientName).toBe('новое');
  });
});
