import type { Table } from 'dexie';
import { db as defaultDb, uuid, type ChartDB, type AuditEntry } from '../db/db';
import { SYNC_TABLES, decideMerge, fromRemote, toRemote, parseCursor, type Cursor, type LocalRow, type RemoteTable, type SyncTable } from './core';
import type { SyncClient } from './client';

export interface SyncResult { pushed: number; pulled: number; conflicts: number; cursor: Cursor }
const BATCH = 200;
const tableOf = (d: ChartDB, t: SyncTable) => (d as unknown as Record<string, Table<LocalRow, string>>)[t];

/** Один проход: отправить всё «ждёт отправки», затем забрать новое с сервера. Очередь — это сами записи с syncState = pending. */
export async function syncOnce(client: SyncClient, cursorStr: string | null | undefined, d: ChartDB = defaultDb): Promise<SyncResult> {
  let pushed = 0, pulled = 0, conflicts = 0;
  for (const t of SYNC_TABLES) {
    const pending = await tableOf(d, t).filter(r => r.syncState === 'pending').toArray();
    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      const rejected = new Set(await client.push(chunk.map(r => toRemote(t, r))));
      await d.transaction('rw', tableOf(d, t), async () => {
        for (const r of chunk) {
          // Отклонённая сервером (там правка позже) остаётся pending — при заборе станет конфликтом и попадёт в историю.
          if (rejected.has(`${t}:${r.id}`)) continue;
          const cur = await tableOf(d, t).get(r.id);
          // Пока шла отправка, запись могла измениться — тогда она остаётся в очереди.
          if (cur && cur.updatedAt === r.updatedAt && cur.version === r.version) await tableOf(d, t).update(r.id, { syncState: 'synced' } as never);
        }
      });
      pushed += chunk.length;
    }
  }
  const cursor = parseCursor(cursorStr);
  for (const rt of ['cases', 'records'] as RemoteTable[]) {
    for (;;) {
      const rows = await client.pull(rt, cursor[rt], 500);
      if (!rows.length) break;
      for (const row of rows) {
        if (!(SYNC_TABLES as readonly string[]).includes(row.tbl)) continue;
        const tbl = tableOf(d, row.tbl);
        await d.transaction('rw', tbl, d.audit, async () => {
          const local = await tbl.get(row.id);
          const remote = fromRemote(row);
          const dec = decideMerge(local, remote);
          if (dec === 'insert' || dec === 'apply' || dec === 'applyConflict') {
            // Фото-снимки живут только на своём устройстве — не затираем.
            if (row.tbl === 'vitals' && local) { remote.thumbnailMonitor = local.thumbnailMonitor ?? null; remote.thumbnailMachine = local.thumbnailMachine ?? null; }
            await tbl.put(remote);
            if (dec === 'applyConflict') {
              conflicts++;
              const entry: AuditEntry = { id: uuid(), caseId: (row.case_id ?? null), entityType: row.tbl, entityId: row.id, field: '*',
                oldValue: JSON.stringify(local), newValue: JSON.stringify(row.data), changedBy: 'синхронизация', changedAt: new Date().toISOString(),
                deviceId: row.device_id, reason: 'Конфликт: на другом устройстве правка позже — взята она, локальная версия сохранена здесь' };
              await d.audit.add(entry);
            }
            pulled++;
          } else if (dec === 'same' && local?.syncState === 'pending') {
            await tbl.update(row.id, { syncState: 'synced' } as never);
          }
        });
        cursor[rt] = row.server_updated_at ?? cursor[rt];
      }
      if (rows.length < 500) break;
    }
  }
  return { pushed, pulled, conflicts, cursor };
}
