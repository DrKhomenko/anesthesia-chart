import { getLocalSettings, updateLocalSettings, type LocalSettings } from '../db/db';
import { httpClient, refreshSession, signIn, type Session } from './client';
import { syncOnce, type SyncResult } from './engine';
import { normalizeUrl } from './core';

let session: Session | null = null;
let running: Promise<SyncResult | null> | null = null;
let runningId = 0;
const SYNC_STUCK_MS = 30_000;
const listeners = new Set<() => void>();
export const onSyncChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const emit = () => listeners.forEach(f => f());

export function syncConfigured(s: LocalSettings): boolean {
  return syncSkipReason(s, true) === null;
}

/** Почему ручная синхронизация не пойдёт. online=false — «нет сети». Пароль не используем и не храним. */
export function syncSkipReason(s: LocalSettings, online: boolean): string | null {
  if (!online) return 'нет сети';
  if (!s.syncEnabled) return 'синхронизация выключена';
  if (!s.syncUrl?.trim() || !s.syncAnonKey?.trim()) return 'нет адреса проекта — вставьте URL и ключ';
  if (!s.syncRefreshToken?.trim()) return 'нет входа — войдите заново';
  return null;
}

/** Вход общей учёткой клиники. Пароль не хранится — только токен обновления. */
export async function syncSignIn(url: string, anonKey: string, email: string, password: string): Promise<void> {
  const s = await signIn(url, anonKey, email, password);
  session = s;
  await updateLocalSettings({
    syncUrl: normalizeUrl(url),
    syncAnonKey: anonKey.trim(),
    syncEmail: email.trim(),
    syncRefreshToken: s.refreshToken,
    syncEnabled: true,
    syncLastError: null,
  });
  emit();
}
export async function syncSignOut(): Promise<void> {
  session = null;
  await updateLocalSettings({ syncRefreshToken: '', syncEnabled: false, syncLastError: null });
  emit();
}

export interface RunSyncOpts { manual?: boolean }

/** Один проход синхронизации, если она включена и есть вход. Ошибки не ломают работу карты — пишутся в статус. */
export function runSync(opts: RunSyncOpts = {}): Promise<SyncResult | null> {
  if (running) return running;
  const id = ++runningId;
  const manual = !!opts.manual;
  running = (async () => {
    const st = await getLocalSettings();
    const skip = syncSkipReason(st, navigator.onLine);
    if (skip) {
      if (manual) await updateLocalSettings({ syncLastError: skip });
      return null;
    }
    try {
      if (!session || session.expiresAt - Date.now() < 60_000) {
        session = await refreshSession(st.syncUrl!, st.syncAnonKey!, st.syncRefreshToken!);
      }
      const r = await syncOnce(httpClient(st.syncUrl!, st.syncAnonKey!, session.accessToken), st.syncLastPulledAt);
      await updateLocalSettings({
        syncRefreshToken: session.refreshToken,
        syncLastPulledAt: JSON.stringify(r.cursor),
        syncLastOkAt: new Date().toISOString(),
        syncLastError: null,
      });
      return r;
    } catch (e) {
      await updateLocalSettings({ syncLastError: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      if (runningId === id) running = null;
      emit();
    }
  })();
  globalThis.setTimeout(() => { if (runningId === id) running = null; }, SYNC_STUCK_MS);
  return running;
}
