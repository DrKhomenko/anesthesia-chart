import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getLocalSettings, updateLocalSettings } from '../db/db';
import { runSync, syncSignIn, syncSignOut } from '../sync/run';
import { validSupabaseUrl } from '../sync/core';

/** Синхронизация между устройствами через Supabase. По умолчанию выключена; без неё карта работает полностью. */
export function SyncSection() {
  const s = useLiveQuery(() => getLocalSettings(), []) ?? null;
  const [f, setF] = useState({ url: '', key: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!s || filled) return;
    setF(v => ({ ...v, url: s.syncUrl ?? '', key: s.syncAnonKey ?? '', email: s.syncEmail ?? '' }));
    setFilled(true);
  }, [s, filled]);
  if (!s) return null;
  const on = !!s.syncEnabled;
  const signedIn = !!s.syncRefreshToken?.trim();
  const toggle = async () => {
    const next = await updateLocalSettings({ syncEnabled: !on });
    if (!on && next.syncRefreshToken) void runSync({ manual: true });
  };
  const doSignIn = async () => {
    setBusy(true); setMsg(null);
    try {
      await syncSignIn(f.url, f.key, f.email, f.password);
      setF(v => ({ ...v, password: '' }));
      const r = await runSync({ manual: true });
      const cur = await getLocalSettings();
      setMsg(r ? syncOkMsg(r) : (cur.syncLastError ?? 'Вход выполнен, синхронизация не выполнена'));
    } catch (e) { setMsg(`Не удалось войти: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  const doSyncNow = async () => {
    setBusy(true); setMsg(null);
    const r = await runSync({ manual: true });
    const cur = await getLocalSettings();
    setBusy(false);
    setMsg(r ? syncOkMsg(r) : (cur.syncLastError ?? 'Синхронизация не выполнена'));
  };
  const canSignIn = validSupabaseUrl(f.url) && f.key.trim().length > 20 && f.email.includes('@') && f.password.length > 0;
  return <section className="card" style={{ marginTop: 16 }}>
    <div className="h">Синхронизация ({on ? 'вкл' : 'выкл'})
      <button className="link" onClick={() => void toggle()}>{on ? 'Выключить' : 'Включить'}</button></div>
    <div className="muted small" style={{ marginBottom: 10 }}>Карты сохраняются на этом устройстве всегда. Синхронизация — по желанию: копия в вашем бесплатном проекте Supabase, чтобы открыть те же карты на iPad, iPhone и компьютере. Инструкция — у вас в чате.</div>
    {on && <div className="g">
      <div className="g g2">
        <label className="field"><span className="fl">Project URL</span><input value={f.url} placeholder="https://xxxx.supabase.co" autoComplete="off" autoCapitalize="off" onChange={e => setF({ ...f, url: e.target.value })} /></label>
        <label className="field"><span className="fl">anon public key</span><input value={f.key} placeholder="eyJ…" autoComplete="off" autoCapitalize="off" onChange={e => setF({ ...f, key: e.target.value })} /></label>
      </div>
      {!signedIn ? <>
        <div className="g g2">
          <label className="field"><span className="fl">Email клиники</span><input value={f.email} inputMode="email" autoCapitalize="off" autoComplete="username" onChange={e => setF({ ...f, email: e.target.value })} /></label>
          <label className="field"><span className="fl">Пароль</span><input type="password" value={f.password} autoComplete="current-password" onChange={e => setF({ ...f, password: e.target.value })} /></label>
        </div>
        <button className="btn pri" disabled={!canSignIn || busy} onClick={() => void doSignIn()}>{busy ? 'Вхожу…' : 'Войти'}</button>
        <div className="muted small">Пароль не сохраняется — только ключ входа на этом устройстве.</div>
      </> : <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>Вход: <b>{s.syncEmail}</b></span>
        <button className="btn sm pri" disabled={busy} onClick={() => void doSyncNow()}>{busy ? 'Синхронизирую…' : 'Синхронизировать сейчас'}</button>
        <button className="btn sm sec" onClick={() => void syncSignOut()}>Выйти</button>
      </div>}
      <div className="muted small">
        {s.syncLastOkAt ? `Последняя синхронизация: ${new Date(s.syncLastOkAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}` : 'Ещё не синхронизировалось'}
        {s.syncLastError ? ` · ошибка: ${s.syncLastError}` : ''}
      </div>
      {msg && <div className="note">{msg}</div>}
    </div>}
  </section>;
}

function syncOkMsg(r: { pushed: number; pulled: number; conflicts: number }): string {
  return `Отправлено ${r.pushed}, получено ${r.pulled}${r.conflicts ? `, конфликтов ${r.conflicts} (старые версии в истории правок)` : ''}`;
}
