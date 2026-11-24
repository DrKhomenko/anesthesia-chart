import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveWithAudit, softDelete, newDrugAdmin, recalcAdmin, type CaseRec, type Drug, type DrugAdmin, type DrugPhase } from '../db/db';
import { fmt, parseNum } from '../core/logic';
import { TimePicker, DosePicker, Field } from './pickers';
import { AdminRow, CalcCard, AddDrugForm, CONC, DOSE, ROUTES, ROUTE_CHIP } from './PremedScreen';
import type { SaveState } from './App';
import { requestTimerStart } from './timerStart';
import { formatInterval, parseIntervalMin } from '../core/timers';

/** Препараты одного этапа (индукция, пробуждение…) — те же строки, расчёт мг/мл и список доз, что в премедикации. */
export function PhaseDrugs({ c, phase, title, onSaved, emptyText }: { c: CaseRec; phase: DrugPhase; title: string; onSaved: (s: SaveState) => void; emptyText?: string }) {
  const drugs = useLiveQuery(() => db.drugs.filter(d => !d.deletedAt && d.isActive).sortBy('name'), []) ?? [];
  const admins = useLiveQuery(async () => {
    const rows = await db.drugAdmins.where('caseId').equals(c.id).filter(a => !a.deletedAt && a.phase === phase).toArray();
    return rows.sort((a, b) => a.givenAt.localeCompare(b.givenAt) || a.createdAt.localeCompare(b.createdAt));
  }, [c.id, phase]) ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ admin: DrugAdmin; intervalMin: number } | null>(null);
  useEffect(() => {
    if (selId && !admins.some(a => a.id === selId)) setSelId(null);
  }, [admins, selId]);
  const selected = admins.find(a => a.id === selId) ?? null;
  const formulary = selected ? drugs.find(d => d.id === selected.drugId) : undefined;
  const persist = async (row: DrugAdmin, reason?: string | null) => {
    onSaved('saving');
    const saved = await saveWithAudit(db.drugAdmins, 'DrugAdmin', row, { caseId: c.id, reason: reason ?? null });
    onSaved('saved');
    return saved;
  };
  const patch = (row: DrugAdmin, p: Partial<DrugAdmin>, reason?: string | null) => persist(recalcAdmin({ ...row, ...p }, c.weightKg), reason);
  const addDrug = async (d: Drug) => {
    const row = newDrugAdmin(c, d, { phase });
    await persist(row);
    setSelId(row.id); setPick(false); setQ(''); setAdding(null);
    const iv = parseIntervalMin(d.repeatIntervalMin);
    setOffer(iv ? { admin: row, intervalMin: iv } : null);
  };
  const nq = q.trim().toLowerCase();
  const filtered = drugs.filter(d => !nq || d.name.toLowerCase().includes(nq) || d.genericName.toLowerCase().includes(nq));
  const canAddName = q.trim() && !drugs.some(d => d.name.toLowerCase() === q.trim().toLowerCase());
  const recentFor = (drugId: string) => [...new Set(admins.filter(a => a.drugId === drugId && parseNum(a.doseValue) > 0).map(a => parseNum(a.doseValue)))];

  return <>
    <section className="card" style={{ paddingBottom: 12 }}>
      <div className="h">{title}
        <button className="link" onClick={() => { setPick(true); setAdding(null); }}>+ Препарат</button></div>
      {admins.length > 0 && <div className="phead">
        <span>Препарат</span><span>мг/кг</span><span>Всего, мг</span><span>мг/мл</span><span>мл</span>
        <span>Путь</span><span>Время</span><span className="hid">Кто</span></div>}
      <div className="g" style={{ gap: 8 }}>
        {admins.map(a => <AdminRow key={a.id} a={a} on={a.id === selected?.id} onSelect={() => setSelId(a.id === selId ? null : a.id)} onTimer={() => requestTimerStart({ type: 'repeat', admin: a, intervalMin: drugs.find(d => d.id === a.drugId)?.repeatIntervalMin })} />)}
        {admins.length === 0 && <div className="muted small">{emptyText ?? 'Пока нет препаратов.'}</div>}
        {offer && <div className="tmr-offer">Напомнить каждые {formatInterval(offer.intervalMin)}?
          <button type="button" className="btn sm pri" onClick={() => { requestTimerStart({ type: 'repeat', admin: offer.admin, intervalMin: offer.intervalMin }); setOffer(null); }}>Запустить</button>
          <button type="button" className="btn sm sec" onClick={() => setOffer(null)}>Нет</button></div>}
        <div className="chipbar">
          {drugs.map(d => <button key={d.id} className="chip" onClick={() => void addDrug(d)}>{d.name}</button>)}
          <button className="chip add" onClick={() => { setPick(true); setAdding(''); }}>+ Новый в справочник</button>
        </div>
      </div>
    </section>
    {selected && <section className="card">
      <div className="h">{selected.drugNameSnapshot}
        <button type="button" className="link" onClick={() => requestTimerStart({ type: 'repeat', admin: selected, intervalMin: formulary?.repeatIntervalMin })}>⏱ Таймер</button>
        <button className="link" onClick={() => { if (confirm(`Убрать «${selected.drugNameSnapshot}» из карты?`)) void (async () => { onSaved('saving'); await softDelete(db.drugAdmins, 'DrugAdmin', selected.id); onSaved('saved'); })(); }}>Удалить</button></div>
      <div className="seg">{ROUTES.map(r => <button key={r} className={selected.route === r ? 'on' : ''} onClick={() => void patch(selected, { route: r })}>{ROUTE_CHIP[r]} · {r}</button>)}</div>
      <div className="g g3" style={{ marginTop: 14 }}>
        <TimePicker label="Время введения" value={selected.givenAt} onChange={iso => void patch(selected, { givenAt: iso })} />
        <DosePicker label={`Доза, ${DOSE[selected.doseUnit]}`} value={selected.doseValue} unit={selected.doseUnit}
          onChange={v => void patch(selected, { doseValue: v })} onUnit={u => void patch(selected, { doseUnit: u })}
          min={formulary?.minDose} max={formulary?.maxDose} recent={recentFor(selected.drugId)} />
        <Field label="Ввёл" value={selected.givenBy} onChange={v => void patch(selected, { givenBy: v })} placeholder="фамилия" />
      </div>
    </section>}
    {selected && <CalcCard a={selected} weightKg={c.weightKg} onPatch={(p, reason) => void patch(selected, p, reason)} />}
    {pick && <div className="ov" onClick={() => { setPick(false); setAdding(null); }} role="presentation">
      <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Препарат">
        <div className="grab" /><div className="sh">Выбрать препарат</div>
        <label className="field" style={{ marginBottom: 10 }}><span className="fl">Поиск или новое название</span>
          <input autoFocus value={q} placeholder="название" onChange={e => setQ(e.target.value)} /></label>
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
