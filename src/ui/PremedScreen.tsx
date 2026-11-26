import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveWithAudit, softDelete, newDrugAdmin, addDrugToFormulary, recalcAdmin, type CaseRec, type Drug, type DrugAdmin, type RouteRu } from '../db/db';
import { applyBpChange, calcDose, fmt, parseNum, type DoseUnit, type ConcUnit } from '../core/logic';
import { useCaseDraft } from './useCase';
import { go, type SaveState } from './App';
import { requestTimerStart } from './timerStart';
import { formatInterval, parseIntervalMin } from '../core/timers';
import { TimePicker, DosePicker, Field } from './pickers';
import { hasNoDoseFlag } from '../core/dictationApply';

export const ROUTES: RouteRu[] = ['в/в', 'в/м', 'п/к', 'внутрь'];
export const CONC: Record<ConcUnit, string> = { 'mg/ml': 'мг/мл', 'mcg/ml': 'мкг/мл', percent: '%' };
export const DOSE: Record<DoseUnit, string> = { 'mg/kg': 'мг/кг', 'mcg/kg': 'мкг/кг' };
export const ROUTE_CHIP: Record<string, string> = { 'в/в': 'IV', 'в/м': 'IM', 'п/к': 'SC', 'внутрь': 'PO', 'ингаляционно': 'INH' };

export function PremedScreen({ id, onSaved }: { id: string; onSaved: (s: SaveState) => void }) {
  const { c, update, flush } = useCaseDraft(id, onSaved);
  const drugs = useLiveQuery(() => db.drugs.filter(d => !d.deletedAt && d.isActive).sortBy('name'), []) ?? [];
  const admins = useLiveQuery(async () => {
    const rows = await db.drugAdmins.where('caseId').equals(id).filter(a => !a.deletedAt && a.phase === 'premed').toArray();
    return rows.sort((a, b) => a.givenAt.localeCompare(b.givenAt) || a.createdAt.localeCompare(b.createdAt));
  }, [id]) ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ admin: DrugAdmin; intervalMin: number } | null>(null);
  const pv = c?.preInductionVitals ?? {};

  useEffect(() => {
    if (!selId && admins.length) setSelId(admins[admins.length - 1].id);
    if (selId && admins.length && !admins.some(a => a.id === selId)) setSelId(admins[admins.length - 1]?.id ?? null);
  }, [admins, selId]);

  if (!c) return <div className="main muted">Загрузка…</div>;

  const selected = admins.find(a => a.id === selId) ?? null;
  const firstAt = admins[0] ? new Date(admins[0].givenAt) : null;
  const lastAt = admins.length ? new Date(admins[admins.length - 1].givenAt) : null;
  const mins = firstAt ? Math.max(0, Math.floor((Date.now() - firstAt.getTime()) / 60_000)) : null;

  const persist = async (row: DrugAdmin, reason?: string | null) => {
    onSaved('saving');
    const saved = await saveWithAudit(db.drugAdmins, 'DrugAdmin', row, { caseId: c.id, reason: reason ?? null });
    onSaved('saved');
    return saved;
  };
  const patch = (row: DrugAdmin, p: Partial<DrugAdmin>, reason?: string | null) => persist(recalcAdmin({ ...row, ...p }, c.weightKg), reason);
  const addDrug = async (d: Drug) => {
    const row = newDrugAdmin(c, d);
    await persist(row);
    setSelId(row.id); setPick(false); setQ(''); setAdding(null);
    const iv = parseIntervalMin(d.repeatIntervalMin);
    setOffer(iv ? { admin: row, intervalMin: iv } : null);
  };
  const repeat = async (row: DrugAdmin) => {
    const src = drugs.find(d => d.id === row.drugId);
    const next = newDrugAdmin(c, src ?? { ...row, name: row.drugNameSnapshot, genericName: row.genericNameSnapshot, defaultConcentration: row.concentration, defaultRoutes: [row.route], isControlled: false, isUserAdded: true, isActive: true, minDose: null, maxDose: null } as Drug, { repeatOfId: row.repeatOfId ?? row.id });
    const saved = await persist(recalcAdmin({ ...next, doseValue: row.doseValue, doseUnit: row.doseUnit, concentration: row.concentration, concentrationUnit: row.concentrationUnit, route: row.route, givenBy: row.givenBy || next.givenBy }, c.weightKg));
    setSelId(saved.id);
  };

  const nq = q.trim().toLowerCase();
  const filtered = drugs.filter(d => !nq || d.name.toLowerCase().includes(nq) || d.genericName.toLowerCase().includes(nq));
  const canAddName = q.trim() && !drugs.some(d => d.name.toLowerCase() === q.trim().toLowerCase());

  const recentFor = (drugId: string) => {
    const vals = admins.filter(a => a.drugId === drugId && parseNum(a.doseValue) > 0).map(a => parseNum(a.doseValue));
    return [...new Set(vals)];
  };
  const formulary = selected ? drugs.find(d => d.id === selected.drugId) : undefined;

  const uPv = (k: keyof NonNullable<CaseRec['preInductionVitals']>) => (v: string) =>
    update({ preInductionVitals: { ...pv, [k]: v, at: pv.at ?? new Date().toISOString() } });
  const setPvBp = (field: 'sys' | 'dia' | 'map', v: string) => {
    const next = applyBpChange(pv, field, v);
    update({ preInductionVitals: { ...pv, ...next, at: pv.at ?? new Date().toISOString() } });
  };

  return <><div className="main"><div className="cols cols-premed">
    <div className="g">
      <section className="card" style={{ paddingBottom: 12 }}>
        <div className="h">Препараты премедикации
          <button className="link" onClick={() => { setPick(true); setAdding(null); }}>+ Добавить препарат</button></div>
        {admins.length > 0 && <div className="phead">
          <span>Препарат</span><span>мг/кг</span><span>Всего, мг</span><span>мг/мл</span><span>мл</span>
          <span>Путь</span><span>Время</span><span className="hid">Кто</span></div>}
        <div className="g" style={{ gap: 8 }}>
          {admins.map(a => <AdminRow key={a.id} a={a} on={a.id === selected?.id} onSelect={() => setSelId(a.id)} onTimer={() => requestTimerStart({ type: 'repeat', admin: a, intervalMin: drugs.find(d => d.id === a.drugId)?.repeatIntervalMin })} />)}
          <button className="addrow" onClick={() => { setPick(true); setAdding(null); }}>+ Новая строка · выбрать из справочника</button>
        </div>
        {offer && <div className="tmr-offer">Напомнить каждые {formatInterval(offer.intervalMin)}?
          <button type="button" className="btn sm pri" onClick={() => { requestTimerStart({ type: 'repeat', admin: offer.admin, intervalMin: offer.intervalMin }); setOffer(null); }}>Запустить</button>
          <button type="button" className="btn sm sec" onClick={() => setOffer(null)}>Нет</button></div>}
      </section>

      {selected && <section className="card">
        <div className="h">Путь введения · {selected.drugNameSnapshot}
          {selected.repeatOfId && <span className="tag">повтор</span>}
          <button className="link" onClick={() => { if (confirm(`Убрать «${selected.drugNameSnapshot}» из карты?`)) void (async () => { onSaved('saving'); await softDelete(db.drugAdmins, 'DrugAdmin', selected.id); onSaved('saved'); })(); }}>Удалить</button></div>
        <div className="seg">{ROUTES.map(r => <button key={r} className={selected.route === r ? 'on' : ''} onClick={() => void patch(selected, { route: r })}>{ROUTE_CHIP[r]} · {r}</button>)}</div>
        <div className="g g3" style={{ marginTop: 14 }}>
          <TimePicker label="Время введения" value={selected.givenAt} onChange={iso => void patch(selected, { givenAt: iso })} />
          <Field label="Ввёл" value={selected.givenBy} onChange={v => void patch(selected, { givenBy: v })} placeholder="фамилия" />
          <button type="button" className="field tpbtn" onClick={() => void repeat(selected)}>
            <span className="fl">Повтор</span>
            <span className="tpval" style={{ color: 'var(--blue)' }}>Повторить эту дозу</span>
          </button>
        </div>
        <div style={{ marginTop: 12 }}><DosePicker label={`Доза, ${DOSE[selected.doseUnit]}`} value={selected.doseValue} unit={selected.doseUnit}
          onChange={v => void patch(selected, { doseValue: v })} onUnit={u => void patch(selected, { doseUnit: u })}
          min={formulary?.minDose} max={formulary?.maxDose} recent={recentFor(selected.drugId)} /></div>
      </section>}

      <section className="card">
        <div className="h">Справочник препаратов клиники · {drugs.length}
          <button className="link" onClick={() => go('/settings')}>Открыть справочник</button></div>
        <div className="chipbar">
          {drugs.map(d => <button key={d.id} className="chip" onClick={() => void addDrug(d)}>{d.name}</button>)}
          <button className="chip add" onClick={() => { setPick(true); setAdding(''); }}>+ Добавить препарат</button>
        </div>
        {drugs.length === 0 && <div className="note" style={{ marginTop: 10 }}>Справочник пуст. Добавьте препараты клиники — из этой строки или в «Настройках». Дозы приложение не подставляет.</div>}
        {drugs.length > 0 && <div className="muted small" style={{ marginTop: 8 }}>Нажмите на препарат, чтобы добавить строку. Список редактирует клиника.</div>}
      </section>
    </div>

    <div className="g">
      {selected ? <CalcCard a={selected} weightKg={c.weightKg} onPatch={(p, reason) => void patch(selected, p, reason)} />
        : <section className="card"><div className="h">Расчёт дозы</div><div className="muted">Выберите препарат — здесь появится расчёт мг и мл по весу из шапки.</div></section>}
      <section className="card">
        <div className="h">С момента премедикации</div>
        {mins != null && firstAt
          ? <div className="row" style={{ alignItems: 'baseline' }}><span className="mins">{mins}</span><span className="muted" style={{ fontSize: 20, marginLeft: 6 }}>мин</span>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 15 }}>{admins[0].drugNameSnapshot} {ROUTE_CHIP[admins[0].route] ?? admins[0].route} в {new Date(admins[0].givenAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></div>
          : <div className="muted">Пока нет введений</div>}
      </section>
      <section className="card">
        <div className="h">Показатели до индукции
          <TimePicker value={pv.at} onChange={iso => update({ preInductionVitals: { ...pv, at: iso } })} /></div>
        <div className="bv8">
          <Field label="ЧСС" value={pv.hr ?? ''} onChange={uPv('hr')} num cls="hr" />
          <Field label="ЧДД" value={pv.rr ?? ''} onChange={uPv('rr')} num />
          <Field label="SpO₂, %" value={pv.spo2 ?? ''} onChange={uPv('spo2')} num />
          <Field label="T °C" value={pv.tempC ?? ''} onChange={uPv('tempC')} num />
          <Field label="САД" value={pv.sys ?? ''} onChange={v => setPvBp('sys', v)} num />
          <Field label="ДАД" value={pv.dia ?? ''} onChange={v => setPvBp('dia', v)} num />
          <Field label="МАД" value={pv.map ?? ''} onChange={v => setPvBp('map', v)} num>
            {pv.mapManual ? <span className="muted small">вручную</span> : (pv.sys && pv.dia ? <span className="muted small">считается из САД и ДАД</span> : null)}
          </Field>
        </div>
      </section>
      <section className="card">
        <div className="h">Заметки</div>
        <label className="field"><span className="fl">Заметки к премедикации</span>
          <textarea rows={2} value={c.premedNotes ?? ''} placeholder="по желанию" onChange={e => update({ premedNotes: e.target.value })} /></label>
      </section>
    </div>
  </div></div>

  <div className="bar">
    <button className="btn sec" onClick={async () => { await flush(); go(`/case/${c.id}/header`); }}>← Шапка</button>
    <span className="muted">{admins.length ? `${admins.length} ${ruCount(admins.length, 'препарат', 'препарата', 'препаратов')}${lastAt ? ` · последний в ${lastAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}` : 'Препаратов пока нет'}</span>
    <div style={{ flex: 1 }} />
    <button className="btn pri" onClick={async () => { if (c.stage === 'header' || c.stage === 'premed') update({ stage: 'induction' }); await flush(); go(`/case/${c.id}/induction`); }}>Перейти к индукции →</button>
  </div>

  {pick && <div className="ov" onClick={() => { setPick(false); setAdding(null); }} role="presentation">
    <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Препарат">
      <div className="grab" /><div className="sh">Выбрать препарат</div>
      <label className="field" style={{ marginBottom: 10 }}><span className="fl">Поиск или новое название</span>
        <input autoFocus value={q} placeholder="напр. Медитин" onChange={e => setQ(e.target.value)} /></label>
      <div className="timelist" style={{ maxHeight: '36vh' }}>
        {filtered.map(d => <button key={d.id} onClick={() => void addDrug(d)}>{d.name} <span className="muted small">{d.genericName}{d.defaultConcentration != null ? ` · ${fmt(d.defaultConcentration, 3)} ${CONC[d.concentrationUnit]}` : ''}</span></button>)}
        {filtered.length === 0 && !canAddName && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>Справочник пуст или ничего не найдено.</div>}
      </div>
      {canAddName && <button className="btn pri" style={{ width: '100%', marginTop: 12 }} onClick={() => setAdding(q.trim())}>+ Добавить «{q.trim()}» в справочник</button>}
      {adding != null && <AddDrugForm name={adding} onCancel={() => setAdding(null)} onSaved={d => void addDrug(d)} />}
    </div>
  </div>}
  </>;
}

export function AdminRow({ a, on, onSelect, onTimer }: { a: DrugAdmin; on: boolean; onSelect: () => void; onTimer?: () => void }) {
  const unitDose = a.doseUnit === 'mcg/kg' ? 'мкг/кг' : 'мг/кг';
  return <div className={`prow-wrap ${on ? 'on' : ''}`}>
    <button type="button" className={`prow ${on ? 'on' : ''}`} onClick={onSelect}>
    <div style={{ paddingLeft: 6 }}><div className="pn">{a.drugNameSnapshot}{a.repeatOfId ? <span className="tag" style={{ marginLeft: 6 }}>повтор</span> : null}{hasNoDoseFlag(a) ? <span className="tag o" style={{ marginLeft: 6 }}>доза не указана</span> : null}</div>
      <div className="pg">{a.genericNameSnapshot || unitDose}</div></div>
    <div className="pv" data-u="мг/кг">{a.doseValue || '—'}</div>
    <div className="pv" data-u="всего, мг">{a.totalMg != null ? fmt(a.totalMg, 3) : '—'}</div>
    <div className="pv muted" data-u="мг/мл">{a.concentration != null ? fmt(a.concentration, 3) : '—'}</div>
    <div className="pvl" data-u="мл">{a.volumeMl != null ? fmt(a.volumeMl) : '—'}</div>
    <div data-u="путь"><span className="chip" style={{ margin: 0, background: '#2c2c2e', color: '#fff', height: 40, minHeight: 40 }}>{ROUTE_CHIP[a.route] ?? a.route}</span></div>
    <div className="pv" data-u="время">{new Date(a.givenAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
    <div className="pv hid" style={{ fontSize: 15, color: '#c7c7cc' }}>{a.givenBy || '—'}</div>
    </button>
    {onTimer && <button type="button" className="btn sm sec tmr-hit" aria-label="Таймер" onClick={onTimer}>⏱</button>}
  </div>;
}

export function CalcCard({ a, weightKg, onPatch }: { a: DrugAdmin; weightKg: string; onPatch: (p: Partial<DrugAdmin>, reason?: string | null) => void }) {
  const r = calcDose({ weightKg, dose: a.doseValue, doseUnit: a.doseUnit, concentration: a.concentration, concUnit: a.concentrationUnit });
  const [vol, setVol] = useState(a.volumeMl != null ? fmt(a.volumeMl) : '');
  const [reason, setReason] = useState(a.overrideReason ?? '');
  useEffect(() => { setVol(a.volumeMl != null ? fmt(a.volumeMl) : ''); setReason(a.overrideReason ?? ''); }, [a.id, a.volumeMl, a.overrideReason, a.updatedAt]);
  return <section className="card" style={{ border: '1px solid var(--blue)' }}>
    <div className="h">Расчёт дозы · {a.drugNameSnapshot}</div>
    {r.ok ? <div className="formula">{r.formula.replace(' = ', ' = ').split(' = ').length
      ? <>{weightKg || '—'} кг × {a.doseValue || '—'} {a.doseUnit === 'mcg/kg' ? 'мкг/кг' : 'мг/кг'} = <b>{fmt(r.totalMg, 3)} мг</b><br />{fmt(r.totalMg, 3)} мг ÷ {a.concentration} {a.concentrationUnit === 'mcg/ml' ? 'мкг/мл' : a.concentrationUnit === 'percent' ? '%' : 'мг/мл'} = <b>{fmt(r.volumeMl)} мл</b></>
      : r.formula}</div>
      : <div className="muted">{r.error}. Вес берётся из шапки, концентрация — из справочника (можно поправить ниже).</div>}
    <div className="volrow">
      <span className="vol">{a.volumeMl != null ? fmt(a.volumeMl) : '—'}</span><span className="vunit">мл</span>
    </div>
    <div className="muted small" style={{ marginTop: 4 }}>Вес взят из шапки карты · концентрация из справочника</div>
    <div className="g g2" style={{ marginTop: 12 }}>
      <label className="field"><span className="fl">Концентрация, {CONC[a.concentrationUnit]}</span>
        <input inputMode="decimal" defaultValue={a.concentration != null ? fmt(a.concentration, 3) : ''} key={a.id + String(a.concentration)}
          onBlur={e => { const n = parseNum(e.target.value); void onPatch({ concentration: e.target.value.trim() === '' ? null : Number.isFinite(n) ? n : a.concentration }); }} /></label>
    </div>
    <button type="button" className="toggle" style={{ marginTop: 12 }} onClick={() => void onPatch({ manualOverride: !a.manualOverride, overrideReason: !a.manualOverride ? reason : a.overrideReason }, a.manualOverride ? 'снята ручная правка объёма' : 'ручная правка объёма')}>
      <span>Ручная правка объёма</span>
      <span className={`knob ${a.manualOverride ? 'on' : ''}`}><i /></span>
    </button>
    {a.manualOverride && <div className="g g2" style={{ marginTop: 10 }}>
      <label className="field"><span className="fl">Объём, мл</span>
        <input inputMode="decimal" value={vol} onChange={e => setVol(e.target.value)}
          onBlur={() => { const n = parseNum(vol); if (Number.isFinite(n) && n >= 0) void onPatch({ volumeMl: n, manualOverride: true, overrideReason: reason || a.overrideReason }, 'ручная правка объёма'); }} /></label>
      <label className="field"><span className="fl">Причина правки</span>
        <input value={reason} placeholder="по желанию" onChange={e => setReason(e.target.value)}
          onBlur={() => { if (reason !== (a.overrideReason ?? '')) void onPatch({ overrideReason: reason, manualOverride: true }, 'ручная правка объёма'); }} /></label>
    </div>}
  </section>;
}

export function AddDrugForm({ name, onCancel, onSaved }: { name: string; onCancel: () => void; onSaved: (d: Drug) => void }) {
  const [f, setF] = useState({ name, genericName: '', conc: '', concUnit: 'mg/ml' as ConcUnit, doseUnit: 'mg/kg' as DoseUnit, route: 'в/в' as RouteRu, controlled: false });
  const n = parseNum(f.conc);
  const concOk = f.conc.trim() === '' || (Number.isFinite(n) && n > 0);
  return <div className="g" style={{ marginTop: 14 }}>
    <div className="muted small">Новый препарат попадёт в справочник клиники и в эту карту. Дозу вы укажете в строке.</div>
    <div className="g g2">
      <label className="field"><span className="fl">Название</span><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span className="fl">Действующее вещество</span><input value={f.genericName} placeholder="необязательно" onChange={e => setF({ ...f, genericName: e.target.value })} /></label>
    </div>
    <div className="row">
      <label className={`field ${!concOk ? 'errb' : ''}`} style={{ flex: 1 }}><span className="fl">Концентрация</span>
        <input inputMode="decimal" value={f.conc} placeholder="можно пусто" onChange={e => setF({ ...f, conc: e.target.value })} /></label>
      <div className="seg" style={{ flex: 1 }}>{(Object.keys(CONC) as ConcUnit[]).map(k => <button key={k} className={f.concUnit === k ? 'on' : ''} onClick={() => setF({ ...f, concUnit: k })}>{CONC[k]}</button>)}</div>
    </div>
    <div className="row"><div className="seg" style={{ flex: 1 }}>{(Object.keys(DOSE) as DoseUnit[]).map(k => <button key={k} className={f.doseUnit === k ? 'on' : ''} onClick={() => setF({ ...f, doseUnit: k })}>{DOSE[k]}</button>)}</div>
      <div className="seg" style={{ flex: 1 }}>{ROUTES.map(r => <button key={r} className={f.route === r ? 'on' : ''} onClick={() => setF({ ...f, route: r })}>{r}</button>)}</div></div>
    <div className="row">
      <button className="btn sec" onClick={onCancel}>Отмена</button>
      <button className="btn pri" disabled={!f.name.trim() || !concOk} onClick={async () => {
        const r = await addDrugToFormulary({ name: f.name, genericName: f.genericName, concentration: f.conc.trim() === '' ? null : n, concentrationUnit: f.concUnit, doseUnit: f.doseUnit, route: f.route, isControlled: f.controlled });
        if (r.ok) onSaved(r.drug);
        else if (r.drug) onSaved(r.drug);
      }}>+ Сохранить в справочник</button>
    </div>
  </div>;
}

export function ruCount(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

