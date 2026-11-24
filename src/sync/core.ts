/** Логика синхронизации без сети и без базы: какие таблицы, как сравнивать версии (последняя запись побеждает). */
export const SYNC_TABLES = ['cases', 'drugs', 'thresholds', 'weightRules', 'drugAdmins', 'vitals', 'infusions', 'events', 'alarms', 'breeds', 'examLabLimits', 'clinicSettings', 'devices', 'regionalBlocks', 'caseTimers'] as const;
export type SyncTable = typeof SYNC_TABLES[number];
export type RemoteTable = 'cases' | 'records';
export const remoteTableOf = (t: SyncTable): RemoteTable => (t === 'cases' ? 'cases' : 'records');

export interface LocalRow { id: string; updatedAt: string; version: number; deviceId: string; deletedAt?: string | null; syncState?: string; [k: string]: unknown }
export interface RemoteRow {
  tbl: SyncTable; id: string; case_id: string | null; data: Record<string, unknown>;
  updated_at: string; version: number; device_id: string; deleted_at: string | null; server_updated_at?: string;
}

/** Ключ сравнения: время правки, затем номер версии, затем id устройства — детерминированно на всех устройствах. */
export function newer(a: { updatedAt: string; version: number; deviceId: string }, b: { updatedAt: string; version: number; deviceId: string }): number {
  const ta = Date.parse(a.updatedAt), tb = Date.parse(b.updatedAt);
  if (ta !== tb) return ta > tb ? 1 : -1;
  if (a.version !== b.version) return a.version > b.version ? 1 : -1;
  return a.deviceId === b.deviceId ? 0 : a.deviceId > b.deviceId ? 1 : -1;
}

export type MergeDecision = 'insert' | 'apply' | 'applyConflict' | 'keepLocal' | 'same';
/** Что делать с пришедшей с сервера строкой. applyConflict — локальная неотправленная правка старее серверной: берём серверную, локальную кладём в историю. */
export function decideMerge(local: LocalRow | undefined, remote: { updatedAt: string; version: number; deviceId: string }): MergeDecision {
  if (!local) return 'insert';
  const cmp = newer(remote, local);
  if (cmp === 0) return 'same';
  if (cmp < 0) return 'keepLocal';
  return local.syncState === 'pending' ? 'applyConflict' : 'apply';
}

const LOCAL_ONLY = new Set(['syncState']);
export function toRemote(tbl: SyncTable, rec: LocalRow): RemoteRow {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) if (!LOCAL_ONLY.has(k)) data[k] = v;
  // Снимки фото не отправляем — тяжело и не нужно на других устройствах.
  if (tbl === 'vitals') { delete data.thumbnailMonitor; delete data.thumbnailMachine; }
  return {
    tbl, id: rec.id, case_id: tbl === 'cases' ? rec.id : typeof rec.caseId === 'string' ? rec.caseId : null, data,
    updated_at: rec.updatedAt, version: rec.version ?? 1, device_id: rec.deviceId ?? '', deleted_at: rec.deletedAt ?? null,
  };
}
export function fromRemote(r: RemoteRow): LocalRow {
  return { ...(r.data as LocalRow), id: r.id, updatedAt: r.updated_at, version: r.version, deviceId: r.device_id, deletedAt: r.deleted_at, syncState: 'synced' };
}

/** Курсор забора: отдельно для cases и records. */
export interface Cursor { cases: string | null; records: string | null }
export function parseCursor(s: string | null | undefined): Cursor {
  try { const c = JSON.parse(s ?? ''); return { cases: c?.cases ?? null, records: c?.records ?? null }; } catch { return { cases: null, records: null }; }
}

export function normalizeUrl(u: string): string { return u.trim().replace(/\/+$/, ''); }
export function validSupabaseUrl(u: string): boolean { return /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(normalizeUrl(u)) || /^https:\/\/[^\s/]+$/i.test(normalizeUrl(u)); }
