import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, meta, saveWithAudit, softDelete, type Drug, type RouteRu, type ThresholdRec, type WeightRuleRec } from '../db/db';
import { PARAM_RU, PARAMS, parseNum, fmt, type ConcUnit, type DoseUnit, type Species } from '../core/logic';
import { go, type SaveState } from './App';

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
  const [f, setF] = useState({ name: '', genericName: '', conc: '', concUnit: 'mg/ml' as ConcUnit, doseUnit: 'mg/kg' as DoseUnit, route: 'в/в' as RouteRu, controlled: false });
  const concN = num(f.conc);
  const canAdd = f.name.trim() !== '' && concN !== undefined && (concN == null || concN > 0);
  const save = async (fn: () => Promise<unknown>) => { onSaved('saving'); await fn(); onSaved('saved'); };
  const addDrug = () => save(async () => {
    const d: Drug = { ...meta(), name: f.name.trim(), genericName: f.genericName.trim(), defaultConcentration: concN ?? null, concentrationUnit: f.concUnit, doseUnit: f.doseUnit,
      defaultRoutes: [f.route], isControlled: f.controlled, isUserAdded: true, isActive: true };
    await saveWithAudit(db.drugs, 'Drug', d); setF({ ...f, name: '', genericName: '', conc: '', controlled: false });
  });
  const setTh = (t: ThresholdRec, k: 'low' | 'high', v: number | null) => save(() => saveWithAudit(db.thresholds, 'AlarmThreshold', { ...t, [k]: v, isDefaultFromPaperChart: false }));
  const setW = (w: WeightRuleRec, k: 'minKg' | 'maxKg', v: number | null) => save(() => saveWithAudit(db.weightRules, 'WeightSanityRule', { ...w, [k]: v }));
  const get = (s: Species, p: string) => th.find(t => t.species === s && t.parameter === p);

  return <><div className="main"><div className="cols" style={{ gridTemplateColumns: '1fr 1fr' }}>
    <div className="g">
      <section className="card"><div className="h">Добавить препарат в справочник</div><div className="g">
        <div className="g g2">
          <label className="field"><span className="fl">Название</span><input value={f.name} placeholder="напр. Медитин" onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span className="fl">Действующее вещество</span><input value={f.genericName} placeholder="необязательно" onChange={e => setF({ ...f, genericName: e.target.value })} /></label></div>
        <div className="g" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
          <label className={`field ${concN === undefined ? 'errb' : ''}`}><span className="fl">Концентрация</span><input inputMode="decimal" value={f.conc} placeholder="число" onChange={e => setF({ ...f, conc: e.target.value })} /></label>
          <div className="seg">{(Object.keys(CONC) as ConcUnit[]).map(k => <button key={k} className={f.concUnit === k ? 'on' : ''} onClick={() => setF({ ...f, concUnit: k })}>{CONC[k]}</button>)}</div></div>
        <div className="row"><span className="muted" style={{ width: 150 }}>Доза в</span><div className="seg" style={{ flex: 1 }}>{(Object.keys(DOSE) as DoseUnit[]).map(k => <button key={k} className={f.doseUnit === k ? 'on' : ''} onClick={() => setF({ ...f, doseUnit: k })}>{DOSE[k]}</button>)}</div></div>
        <div className="row"><span className="muted" style={{ width: 150 }}>Путь</span><div className="seg" style={{ flex: 1 }}>{ROUTES.map(r => <button key={r} className={f.route === r ? 'on' : ''} onClick={() => setF({ ...f, route: r })} style={{ fontSize: 15 }}>{r === 'ингаляционно' ? 'ингал.' : r}</button>)}</div></div>
        <div className="row"><span className="muted" style={{ width: 150 }}>Контролируемый</span><div className="seg" style={{ flex: 1 }}>
          <button className={!f.controlled ? 'on' : ''} onClick={() => setF({ ...f, controlled: false })}>Нет</button><button className={f.controlled ? 'on' : ''} onClick={() => setF({ ...f, controlled: true })}>Да</button></div></div>
        <button className="btn pri" disabled={!canAdd} onClick={addDrug}>+ Добавить препарат</button>
        <div className="muted small">Дозы приложение не подставляет. Концентрацию можно оставить пустой, но тогда мл не посчитаются.</div></div></section>
      <section className="card"><div className="h">Справочник препаратов<span className="r">{drugs.length}</span></div>
        {drugs.length === 0 && <div className="note">Пока пусто. Добавьте препараты своей клиники.</div>}
        <div className="g" style={{ gap: 8 }}>{drugs.map(d => <div key={d.id} className="row field" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <div style={{ flex: 1 }}><b style={{ fontSize: 18, opacity: d.isActive ? 1 : .45 }}>{d.name}</b> <span className="muted small">{d.genericName}</span>
            <div className="muted small">{d.defaultConcentration != null ? `${fmt(d.defaultConcentration, 3)} ${CONC[d.concentrationUnit]}` : 'концентрация не задана'} · доза в {DOSE[d.doseUnit]} · {d.defaultRoutes.join(', ')}</div></div>
          {d.isControlled && <span className="tag o">контролируемый</span>}
          <button className="btn sm sec" onClick={() => save(() => saveWithAudit(db.drugs, 'Drug', { ...d, isActive: !d.isActive }))}>{d.isActive ? 'Скрыть' : 'Показать'}</button>
          <button className="x" aria-label="Удалить" onClick={() => { if (confirm(`Удалить «${d.name}» из справочника?`)) void save(() => softDelete(db.drugs, 'Drug', d.id)); }}>✕</button></div>)}</div></section>
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
  </div></div>
  <div className="bar"><span className="muted">Изменения сохраняются сразу и попадают в историю правок</span><div style={{ flex: 1 }} /><button className="btn sec" onClick={() => go('/')}>Готово</button></div></>;
}
