import { useEffect, useState } from 'react';
import { getLocalSettings } from '../db/db';
import { onSyncChange, runSync, syncConfigured } from '../sync/run';

/** Фоновая синхронизация: раз в минуту и при появлении сети. Возвращает короткий статус для шапки ('' если выключена). */
export function useSyncLoop(online: boolean): string {
  const [status, setStatus] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const s = await getLocalSettings();
      if (!alive) return;
      setStatus(!syncConfigured(s) ? '' : s.syncLastError ? 'синхр. ошибка' : s.syncLastOkAt ? 'синхр. ✓' : 'синхр. …');
    };
    const off = onSyncChange(() => void refresh());
    void refresh();
    const tick = () => { void runSync(); };
    if (online) tick();
    const i = setInterval(tick, 60_000);
    return () => { alive = false; off(); clearInterval(i); };
  }, [online]);
  return status;
}
