import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveWithAudit, softDelete, addBreed, addDrugToFormulary, CLINIC_SETTINGS_ID, type Drug, type RouteRu, type ThresholdRec, type WeightRuleRec, type ExamLabLimitRec, type Breed } from '../db/db';
import { PARAM_RU, PARAMS, parseNum, fmt, EXAM_LAB_PARAMS, type ConcUnit, type DoseUnit, type Species } from '../core/logic';
import { go, type SaveState } from './App';
import { EquipmentSection } from './EquipmentSection';
import { RecognitionSection } from './RecognitionSection';

const ROUTES: RouteRu[] = ['в/в', 'в/м', 'п/к', 'внутрь', 'ингаляционно'];
const CONC: Record<ConcUnit, string> = { 'mg/ml': 'мг/мл', 'mcg/ml': 'мкг/мл', percent: '%' };
const DOSE: Record<DoseUnit, string> = { 'mg/kg': 'мг/кг', 'mcg/kg': 'мкг/кг' };
const num = (v: string) => { const n = parseNum(v); return v.trim() === '' ? null : Number.isFinite(n) ? n : undefined; };

function NumCell({ value, onSave }: { value: number | null; onSave: (v: number | null) => void }) {
  const [t, setT] = useState(value == null ? '' : fmt(value, 3)); const n = num(t);
  return <input className="tin" inputMode="decimal" value={t} placeholder="не задано" style={n === undefined ? { boxShadow: 'inset 0 0 0 2px #ff453a' } : undefined}
    onChange={e => setT(e.target.value)} onBlur={() => { if (n !== undefined && n !== value) onSave(n); }} />;
}

export function SettingsScreen({ onSaved }: { onSaved: (s: SaveState) => void }) {
  const drugs = useLiveQuery(() => db.drugs.filter(d => !d.deletedAt).sortBy('name'), []) ?? [];
  const th = useLiveQuery(() => db.thresholds.toArray(), []) ?? [];
  const wr = useLiveQuery(() => db.weightRules.toArray(), []) ?? [];
  const breeds = useLiveQuery(() => db.breeds.filter(b => !b.deletedAt).sortBy('name'), []) ?? [];
  const limits = useLiveQuery(() => db.examLabLimits.toArray(), []) ?? [];
  const stamp = useLiveQuery(() => db.clinicSettings.get(CLINIC_SETTINGS_ID), []);
  const [f, setF] = useState({ name: '', genericName: '', conc: '', concUnit: 'mg/ml' as ConcUnit, doseUnit: 'mg/kg' as DoseUnit, route: 'в/в' as RouteRu, controlled: false, minDose: '', maxDose: '' });
  const [bn, setBn] = useState({ dog: '', cat: '' });
  const [by, setBy] = useState('');
  const concN = num(f.conc);
  const minN = num(f.minDose); const maxN = num(f.maxDose);
  const canAdd = f.name.trim() !== '' && concN !== undefined && (concN == null || concN > 0) && minN !== undefined && maxN !== undefined;
  const save = async (fn: () => Promise<unknown>) => { onSaved('saving'); await fn(); onSaved('saved'); };
  const addDrug = () => save(async () => {
    await addDrugToFormulary({ name: f.name, genericName: f.genericName, concentration: concN ?? null, concentrationUnit: f.concUnit, doseUnit: f.doseUnit, minDose: minN ?? null, maxDose: maxN ?? null, route: f.route, isControlled: f.controlled });
    setF({ ...f, name: '', genericName: '', conc: '', controlled: false, minDose: '', maxDose: '' });
  });
  const setTh = (t: ThresholdRec, k: 'low' | 'high', v: number | null) => save(() => saveWithAudit(db.thresholds, 'AlarmThreshold', { ...t, [k]: v, isDefaultFromPaperChart: false }));
  const setW = (w: WeightRuleRec, k: 'minKg' | 'maxKg', v: number | null) => save(() => saveWithAudit(db.weightRules, 'WeightSanityRule', { ...w, [k]: v }));
  const setLim = (t: ExamLabLimitRec, k: 'low' | 'high', v: number | null) => save(async () => {
    await saveWithAudit(db.examLabLimits, 'ExamLabLimit', { ...t, [k]: v });
    const cur = await db.clinicSettings.get(CLINIC_SETTINGS_ID);
    if (cur?.examLabLimitsApprovedAt) await saveWithAudit(db.clinicSettings, 'ClinicSettings', { ...cur, examLabLimitsApprovedAt: null });
  });
  const approve = () => save(async () => {
    const name = (by || stamp?.examLabLimitsApprovedBy || '').trim();
    if (!name) return;
    const cur = stamp ?? { ...(await db.clinicSettings.get(CLINIC_SETTINGS_ID))! };
    await saveWithAudit(db.clinicSettings, 'ClinicSettings', { ...cur, examLabLimitsApprovedBy: name, examLabLimitsApprovedAt: new Date().toISOString() });
    setBy('');
  });
  const get = (s: Species, p: string) => th.find(t => t.species === s && t.parameter === p);
  const getL = (s: Species, p: string) => limits.find(t => t.species === s && t.parameter === p);
  const setDrugNum = (d: Drug, k: 'minDose' | 'maxDose' | 'defaultConcentration', v: number | null) => save(() => saveWithAudit(db.drugs, 'Drug', { ...d, [k]: v }));

  return <><div className="main"><div className="cols cols-eq">
    <div className="g">
      <section className="card"><div className="h">Добавить препарат в справочник</div><div className="g">
        <div className="g g2">
          <label className="field"><span className="fl">Название</span><input value={f.name} placeholder="напр. Медитин" onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span className="fl">Действующее вещество</span><input value={f.genericName} placeholder="необязательно" onChange={e => setF({ ...f, genericName: e.target.value })} /></label></div>
        <div className="g g-conc">
          <label className={`field ${concN === undefined ? 'errb' : ''}`}><span className="fl">Концентрация</span><input inputMode="decimal" value={f.conc} placeholder="число" onChange={e => setF({ ...f, conc: e.target.value })} /></label>
          <div className="seg">{(Object.keys(CONC) as ConcUnit[]).map(k => <button key={k} className={f.concUnit === k ? 'on' : ''} onClick={() => setF({ ...f, concUnit: k })}>{CONC[k]}</button>)}</div></div>
        <div className="row"><span className="muted" style={{ width: 150 }}>Доза в</span><div className="seg" style={{ flex: 1 }}>{(Object.keys(DOSE) as DoseUnit[]).map(k => <button key={k} className={f.doseUnit === k ? 'on' : ''} onClick={() => setF({ ...f, doseUnit: k })}>{DOSE[k]}</button>)}</div></div>
        <div className="g g2">
          <label className={`field ${minN === undefined ? 'errb' : ''}`}><span className="fl">Доза мин (для списка)</span><input inputMode="decimal" value={f.minDose} placeholder="необязательно" onChange={e => setF({ ...f, minDose: e.target.value })} /></label>
          <label className={`field ${maxN === undefined ? 'errb' : ''}`}><span className="fl">Доза макс (для списка)</span><input inputMode="decimal" value={f.maxDose} placeholder="необязательно" onChange={e => setF({ ...f, maxDose: e.target.value })} /></label>
        </div>
        <div className="row"><span className="muted" style={{ width: 150 }}>Путь</span><div className="seg" style={{ flex: 1 }}>{ROUTES.map(r => <button key={r} className={f.route === r ? 'on' : ''} onClick={() => setF({ ...f, route: r })} style={{ fontSize: 15 }}>{r === 'ингаляционно' ? 'ингал.' : r}</button>)}</div></div>
        <div className="row"><span className="muted" style={{ width: 150 }}>Контролируемый</span><div className="seg" style={{ flex: 1 }}>
          <button className={!f.controlled ? 'on' : ''} onClick={() => setF({ ...f, controlled: false })}>Нет</button><button className={f.controlled ? 'on' : ''} onClick={() => setF({ ...f, controlled: true })}>Да</button></div></div>
        <button className="btn pri" disabled={!canAdd} onClick={addDrug}>+ Добавить препарат</button>
        <div className="muted small">Дозы приложение не подставляет. Концентрацию можно оставить пустой, но тогда мл не посчитаются. Опиоиды и фентанил добавлять можно.</div></div></section>
      <section className="card"><div className="h">Справочник препаратов<span className="r">{drugs.length}</span></div>
        {drugs.length === 0 && <div className="note">Пока пусто. Добавьте препараты своей клиники.</div>}
        <div className="g" style={{ gap: 8 }}>{drugs.map(d => <div key={d.id} className="g" style={{ background: 'var(--field)', borderRadius: 14, padding: 10 }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1 }}><b style={{ fontSize: 18, opacity: d.isActive ? 1 : .45 }}>{d.name}</b> <span className="muted small">{d.genericName}</span>
              <div className="muted small">{d.defaultConcentration != null ? `${fmt(d.defaultConcentration, 3)} ${CONC[d.concentrationUnit]}` : 'концентрация не задана'} · доза в {DOSE[d.doseUnit]} · {d.defaultRoutes.join(', ')}</div></div>
            {d.isControlled && <span className="tag o">контролируемый</span>}
            <button className="btn sm sec" onClick={() => save(() => saveWithAudit(db.drugs, 'Drug', { ...d, isActive: !d.isActive }))}>{d.isActive ? 'Скрыть' : 'Показать'}</button>
            <button className="x" aria-label="Удалить" onClick={() => { if (confirm(`Удалить «${d.name}» из справочника?`)) void save(() => softDelete(db.drugs, 'Drug', d.id)); }}>✕</button>
          </div>
          <div className="g g3">
            <div><div className="muted small">Конц.</div><NumCell value={d.defaultConcentration} onSave={v => setDrugNum(d, 'defaultConcentration', v)} /></div>
            <div><div className="muted small">Мин. доза</div><NumCell value={d.minDose ?? null} onSave={v => setDrugNum(d, 'minDose', v)} /></div>
            <div><div className="muted small">Макс. доза</div><NumCell value={d.maxDose ?? null} onSave={v => setDrugNum(d, 'maxDose', v)} /></div>
          </div>
        </div>)}</div></section>
      <section className="card"><div className="h">Породы</div>
        <div className="g g2">
          {(['dog', 'cat'] as Species[]).map(s => <div key={s} className="g" style={{ gap: 8 }}>
            <div className="muted" style={{ fontWeight: 600 }}>{s === 'dog' ? 'Собака' : 'Кошка'}</div>
            {breeds.filter(b => b.species === s).map(b => <BreedRow key={b.id} b={b} onSave={fn => void save(fn)} />)}
            <div className="row">
              <label className="field" style={{ flex: 1 }}><span className="fl">Новая порода</span>
                <input value={bn[s]} placeholder="название" onChange={e => setBn({ ...bn, [s]: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' && bn[s].trim()) void save(async () => { const r = await addBreed(s, bn[s]); if (r.ok) setBn({ ...bn, [s]: '' }); }); }} /></label>
              <button className="btn sm pri" disabled={!bn[s].trim()} onClick={() => void save(async () => { const r = await addBreed(s, bn[s]); if (r.ok) setBn({ ...bn, [s]: '' }); })}>+</button>
            </div>
          </div>)}
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>Короткий стартовый список можно дополнять. Породу также можно добавить прямо из шапки карты.</div>
      </section>
    </div>
    <div className="g">
      <section className="card"><div className="h">Рамки веса (проверка опечаток)</div>
        <table className="t"><thead><tr><th></th><th>мин, кг</th><th>макс, кг</th></tr></thead><tbody>
          {(['dog', 'cat'] as Species[]).map(s => { const w = wr.find(x => x.species === s); return w && <tr key={s}><td className="l">{s === 'dog' ? 'Собака' : 'Кошка'}</td>
            <td><NumCell value={w.minKg} onSave={v => setW(w, 'minKg', v)} /></td><td><NumCell value={w.maxKg} onSave={v => setW(w, 'maxKg', v)} /></td></tr>; })}</tbody></table>
        <div className="muted small" style={{ marginTop: 6 }}>Пусто = проверка не делается. Значения вписываете вы.</div></section>
      <section className="card"><div className="h">Пороги тревог</div>
        <table className="t"><thead><tr><th>Показатель</th><th>Собака мин</th><th>Собака макс</th><th>Кошка мин</th><th>Кошка макс</th></tr></thead><tbody>
          {PARAMS.map(p => <tr key={p}><td className="l">{PARAM_RU[p].label} <span className="muted small">{PARAM_RU[p].unit}</span></td>
            {(['dog', 'cat'] as Species[]).flatMap(s => { const t = get(s, p); return t ? [<td key={s + 'l'}><NumCell value={t.low} onSave={v => setTh(t, 'low', v)} /></td>, <td key={s + 'h'}><NumCell value={t.high} onSave={v => setTh(t, 'high', v)} /></td>] : []; })}</tr>)}</tbody></table>
        <div className="muted small" style={{ marginTop: 6 }}>С бумажного бланка заданы только МАД &lt; 60 и T &lt; 36,5 °C. Остальные пороги назначаете вы.</div></section>
    </div>
  </div>
  <section className="card" style={{ marginTop: 16 }}>
    <div className="h">Лимиты физикальных и лабораторных показателей</div>
    <div className="stamp g" style={{ marginBottom: 14 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: 1, minWidth: 220 }}><span className="fl">Утверждено: ФИО</span>
          <input value={by || stamp?.examLabLimitsApprovedBy || ''} placeholder="фамилия, инициалы" onChange={e => setBy(e.target.value)} /></label>
        <button className="btn sm pri" disabled={!(by || stamp?.examLabLimitsApprovedBy || '').trim()} onClick={approve}>Утвердить сегодня</button>
      </div>
      {stamp?.examLabLimitsApprovedAt
        ? <div className="note">Утверждено: {stamp.examLabLimitsApprovedBy} · {new Date(stamp.examLabLimitsApprovedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. После правки лимитов утверждение нужно повторить.</div>
        : <div className="muted small">Лимиты ещё не утверждены. Поля оставляйте пустыми, пока клиника не назначит свои рамки — приложение значения не подставляет.</div>}
    </div>
    {(['physical', 'lab'] as const).map(group => <div key={group} style={{ marginBottom: 16 }}>
      <div className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>{group === 'physical' ? 'Физикальные показатели' : 'Лабораторные показатели'}</div>
      <table className="t"><thead><tr><th>Показатель</th><th>Собака мин</th><th>Собака макс</th><th>Кошка мин</th><th>Кошка макс</th></tr></thead><tbody>
        {EXAM_LAB_PARAMS.filter(p => p.group === group).map(p => <tr key={p.key}><td className="l">{p.label} <span className="muted small">{p.unit}</span></td>
          {(['dog', 'cat'] as Species[]).flatMap(s => { const t = getL(s, p.key); return t ? [<td key={s + 'l'}><NumCell value={t.low} onSave={v => setLim(t, 'low', v)} /></td>, <td key={s + 'h'}><NumCell value={t.high} onSave={v => setLim(t, 'high', v)} /></td>] : []; })}
        </tr>)}</tbody></table>
    </div>)}
    <div className="muted small">Пусто = «не настроено»: в шапке карты значение не блокируется, только подписывается. Лимит веса здесь — клинический; отдельно выше задаются рамки для ловли опечаток.</div>
  </section>
  <EquipmentSection onSaved={fn => void save(fn)} />
  <RecognitionSection onSaved={fn => void save(fn)} />
  </div>
  <div className="bar"><span className="muted">Изменения сохраняются сразу и попадают в историю правок</span><div style={{ flex: 1 }} /><button className="btn sec" onClick={() => go('/')}>Готово</button></div></>;
}

function BreedRow({ b, onSave }: { b: Breed; onSave: (fn: () => Promise<unknown>) => void }) {
  return <div className="row field" style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}>
    <b style={{ flex: 1, fontSize: 16, opacity: b.isActive ? 1 : .45 }}>{b.name}</b>
    {b.isUserAdded && <span className="tag">своя</span>}
    <button className="btn sm sec" onClick={() => onSave(() => saveWithAudit(db.breeds, 'Breed', { ...b, isActive: !b.isActive }))}>{b.isActive ? 'Скрыть' : 'Показать'}</button>
    <button className="x" aria-label="Удалить" onClick={() => { if (confirm(`Удалить породу «${b.name}»?`)) onSave(() => softDelete(db.breeds, 'Breed', b.id)); }}>✕</button>
  </div>;
}
