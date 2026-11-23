import { getLocalSettings, saveLocalSettings, type LocalSettings } from '../db/db';
import { httpClient, refreshSession, signIn, type Session } from './client';
import { syncOnce, type SyncResult } from './engine';
import { normalizeUrl } from './core';

let session: Session | null = null;
let running: Promise<SyncResult | null> | null = null;
const listeners = new Set<() => void>();
export const onSyncChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const emit = () => listeners.forEach(f => f());

export function syncConfigured(s: LocalSettings): boolean {
  return !!(s.syncEnabled && s.syncUrl && s.syncAnonKey && s.syncRefreshToken);
}

/** Вход общей учёткой клиники. Пароль не хранится — только токен обновления. */
export async function syncSignIn(url: string, anonKey: string, email: string, password: string): Promise<void> {
  const s = await signIn(url, anonKey, email, password);
  session = s;
  const cur = await getLocalSettings();
  await saveLocalSettings({ ...cur, syncUrl: normalizeUrl(url), syncAnonKey: anonKey.trim(), syncEmail: email.trim(), syncRefreshToken: s.refreshToken, syncLastError: null });
  emit();
}
export async function syncSignOut(): Promise<void> {
  session = null;
  const cur = await getLocalSettings();
  await saveLocalSettings({ ...cur, syncRefreshToken: '', syncEnabled: false });
  emit();
}

/** Один проход синхронизации, если она включена и есть вход. Ошибки не ломают работу карты — пишутся в статус. */
export function runSync(): Promise<SyncResult | null> {
  if (running) return running;
  running = (async () => {
    const st = await getLocalSettings();
    if (!syncConfigured(st) || !navigator.onLine) return null;
    try {
      if (!session || session.expiresAt - Date.now() < 60_000) {
        session = await refreshSession(st.syncUrl!, st.syncAnonKey!, st.syncRefreshToken!);
      }
      const r = await syncOnce(httpClient(st.syncUrl!, st.syncAnonKey!, session.accessToken), st.syncLastPulledAt);
      const cur = await getLocalSettings();
      await saveLocalSettings({ ...cur, syncRefreshToken: session.refreshToken, syncLastPulledAt: JSON.stringify(r.cursor), syncLastOkAt: new Date().toISOString(), syncLastError: null });
      return r;
    } catch (e) {
      const cur = await getLocalSettings();
      await saveLocalSettings({ ...cur, syncLastError: e instanceof Error ? e.message : String(e) });
      return null;
    } finally { running = null; emit(); }
  })();
  return running;
}
