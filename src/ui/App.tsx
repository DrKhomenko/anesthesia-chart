import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, newCase, saveWithAudit, type CaseRec, type Stage } from '../db/db';
import { SPECIES_RU, parseNum, fmt } from '../core/logic';
import { HeaderScreen } from './HeaderScreen';
import { SettingsScreen } from './SettingsScreen';

export const STAGES: { key: Stage; ru: string }[] = [
  { key: 'header', ru: 'Шапка' }, { key: 'premed', ru: 'Премедикация' }, { key: 'induction', ru: 'Индукция' },
  { key: 'maintenance', ru: 'Поддержание' }, { key: 'recovery', ru: 'Пробуждение' }];
const SEX_RU: Record<string, string> = { female: 'самка', male: 'самец', femaleSpayed: 'самка стер.', maleNeutered: 'самец кастр.' };
export type SaveState = 'saving' | 'saved';
type Route = { v: 'list' } | { v: 'settings' } | { v: 'case'; id: string; stage: Stage };

function parseHash(): Route {
  const [a, b, c] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'settings') return { v: 'settings' };
  if (a === 'case' && b) return { v: 'case', id: b, stage: (c as Stage) || 'header' };
  return { v: 'list' };
}
export const go = (h: string) => { location.hash = h; };

function useClock() { const [t, setT] = useState(new Date()); useEffect(() => { const i = setInterval(() => setT(new Date()), 10_000); return () => clearInterval(i); }, []); return t; }
function useOnline() { const [o, setO] = useState(navigator.onLine); useEffect(() => { const f = () => setO(navigator.onLine); addEventListener('online', f); addEventListener('offline', f); return () => { removeEventListener('online', f); removeEventListener('offline', f); }; }, []); return o; }
const hhmm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function subtitle(c: CaseRec) {
  const w = parseNum(c.weightKg);
  return [Number.isFinite(w) ? `${fmt(w)} кг` : null, c.ageText || null, SEX_RU[c.sex] ?? null, c.asaClass ? `ASA ${c.asaClass}${c.asaEmergency ? 'E' : ''}` : null].filter(Boolean).join(' · ') || 'Новая карта';
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash());
  const [save, setSave] = useState<SaveState>('saved');
  const online = useOnline(); const now = useClock();
  useEffect(() => { const f = () => setRoute(parseHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const cur = useLiveQuery(() => (route.v === 'case' ? db.cases.get(route.id) : undefined), [route.v === 'case' ? route.id : '']);
  const stageIdx = cur ? STAGES.findIndex(s => s.key === cur.stage) : -1;

  const title = route.v === 'case' ? (cur ? `${cur.patientName || 'Без клички'} · ${SPECIES_RU[cur.species].toLowerCase()}` : '…') : route.v === 'settings' ? 'Настройки клиники' : 'Анестезиологические карты';
  const sub = route.v === 'case' && cur ? subtitle(cur) : 'Крымский ветеринарный госпиталь';

  return <div className="app">
    <div className="top">
      <button className="pt" style={{ textAlign: 'left' }} onClick={() => go('/')} aria-label="К списку карт"><b>{title}</b><span>{sub}</span></button>
      {route.v === 'case' ? <nav className="steps">{STAGES.map((s, i) =>
        <button key={s.key} className={s.key === route.stage ? 'on' : i < stageIdx ? 'done' : ''} onClick={() => go(`/case/${route.id}/${s.key}`)}>{s.ru}</button>)}</nav>
        : <div style={{ marginLeft: 'auto' }} />}
      <div className={`pill ${save === 'saving' ? 'wait' : 'ok'}`}><i />{save === 'saving' ? 'Сохраняю…' : 'Сохранено на планшете'}</div>
      <div className="net">{online ? 'Сеть есть' : 'Нет сети'}</div>
      <div className="clock"><span>Сейчас</span><b>{hhmm(now)}</b></div>
    </div>
    {route.v === 'list' && <CaseList />}
    {route.v === 'settings' && <SettingsScreen onSaved={setSave} />}
    {route.v === 'case' && (route.stage === 'header'
      ? <HeaderScreen key={route.id} id={route.id} onSaved={setSave} />
      : <Placeholder id={route.id} stage={route.stage} />)}
  </div>;
}

function CaseList() {
  const cases = useLiveQuery(() => db.cases.orderBy('updatedAt').reverse().filter(c => !c.deletedAt).toArray(), []);
  const create = async () => { const c = newCase(); await saveWithAudit(db.cases, 'Case', c, { caseId: c.id }); go(`/case/${c.id}/header`); };
  return <><div className="main">
    {cases && cases.length === 0 && <div className="ph"><b>Карт пока нет</b><span className="muted">Нажмите «Новая карта», чтобы начать наркоз. Всё хранится на этом iPad.</span></div>}
    <div className="list">{cases?.map(c => <button key={c.id} className="card casecard" onClick={() => go(`/case/${c.id}/${c.stage === 'closed' ? 'recovery' : c.stage}`)}>
      <span className="muted small">№ {c.number} · {new Date(c.date).toLocaleDateString('ru-RU')}</span>
      <b>{c.patientName || 'Без клички'} · {SPECIES_RU[c.species].toLowerCase()}</b>
      <span className="muted">{subtitle(c)}</span>
      <span className="small" style={{ color: '#c7c7cc' }}>{c.operation || 'Операция не указана'} · этап: {STAGES.find(s => s.key === c.stage)?.ru ?? 'закрыта'}</span>
    </button>)}</div>
  </div>
  <div className="bar"><span className="muted">{cases ? `Карт: ${cases.length}` : ''}</span><div style={{ flex: 1 }} />
    <button className="btn sec" onClick={() => go('/settings')}>Настройки</button>
    <button className="btn pri" onClick={create}>+ Новая карта</button></div></>;
}

function Placeholder({ id, stage }: { id: string; stage: Stage }) {
  const s = STAGES.find(x => x.key === stage)!;
  return <><div className="main"><div className="ph"><b>{s.ru}</b><span className="muted">Этот экран будет в следующем шаге. Шапка карты уже сохраняется на планшете.</span></div></div>
    <div className="bar"><div style={{ flex: 1 }} /><button className="btn sec" onClick={() => go(`/case/${id}/header`)}>← К шапке</button></div></>;
}
