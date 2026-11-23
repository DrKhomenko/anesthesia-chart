import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCaseDraft } from './useCase';
import { go, type SaveState } from './App';
import { TimePicker, Field } from './pickers';
import { PhaseDrugs } from './PhaseDrugs';
import { Seg, Labeled, Notes } from './formBits';
import { db, CLINIC_SETTINGS_ID, clinicVentModes, complicationLabelsOf, defaultGasOf, getLocalSettings, recoveryScaleOf, upsertVitalTick, type RecoveryData, type VitalTick } from '../db/db';
import { computeTimeline, fmtDuration } from '../core/timeline';
import { fmtTime } from '../core/logic';
import { entryFieldOrder, previousTick, previousWithInductionMode } from '../core/quickEntry';
import { resolveCaseGas } from '../core/gas';
import { resolveTickTime } from '../core/vision';
import { QuickEntrySheet, type QuickEntryState } from './QuickEntrySheet';
import { ReminderBar } from './ReminderBar';
import { InfusionsSection } from './InfusionsSection';
import { RegionalSection } from './RegionalSection';

export function RecoveryScreen({ id, onSaved }: { id: string; onSaved: (s: SaveState) => void }) {
  const { c, update, flush } = useCaseDraft(id, onSaved);
  const clinic = useLiveQuery(() => db.clinicSettings.get(CLINIC_SETTINGS_ID), []);
  const ticks = useLiveQuery(async () => {
    const rows = await db.vitals.where('caseId').equals(id).filter(t => !t.deletedAt).toArray();
    return rows.sort((a, b) => a.at.localeCompare(b.at));
  }, [id]) ?? [];
  const devices = useLiveQuery(() => db.devices.filter(d => !d.deletedAt && d.isActive).toArray(), []) ?? [];
  const [quick, setQuick] = useState<QuickEntryState | null>(null);
  const [monitorId, setMonitorId] = useState<string | null>(null);
  const [machineId, setMachineId] = useState<string | null>(null);
  useEffect(() => { void getLocalSettings().then(s => { setMonitorId(s.activeMonitorId); setMachineId(s.activeMachineId); }); }, []);
  if (!c) return <div className="main muted">Загрузка…</div>;
  const gas = resolveCaseGas({ maintenanceGas: c.maintenanceGas, inductionGas: c.induction?.gas, defaultGas: defaultGasOf(clinic) });
  const openQuickEntry = () => {
    const mon = devices.find(d => d.id === monitorId && d.type === 'monitor') ?? devices.find(d => d.type === 'monitor');
    const mach = devices.find(d => d.id === machineId && d.type === 'machine') ?? devices.find(d => d.type === 'machine');
    const merge = resolveTickTime({ deviceTimeRaw: null, now: new Date(), existingTicks: ticks, mergeWindowMin: 0 });
    const fields = entryFieldOrder({
      monitorFieldKeys: mon?.fieldKeys ?? null,
      machineFieldKeys: mach?.fieldKeys ?? null,
      gas,
      ventModes: clinicVentModes(clinic),
    });
    const prev = previousWithInductionMode(previousTick(ticks, merge.at.toISOString()), c.induction?.ventMode);
    setQuick({
      at: merge.at.toISOString(), fields, previous: prev, gas,
      mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : null,
    });
  };
  const saveQuickEntry = async (patch: Partial<VitalTick>, at: string) => {
    onSaved('saving');
    await upsertVitalTick({ caseId: c.id, at, patch, reason: 'ручной ввод' });
    onSaved('saved');
    setQuick(null);
  };
  const r = c.recovery ?? {};
  const u = (p: Partial<RecoveryData>) => update({ recovery: { ...r, ...p } });
  const labels = complicationLabelsOf(clinic);
  const scale = recoveryScaleOf(clinic);
  const chosen = r.complications ?? [];
  const extra = chosen.filter(x => !labels.includes(x));
  const toggle = (x: string) => u({ complications: chosen.includes(x) ? chosen.filter(y => y !== x) : [...chosen, x] });
  const tl = computeTimeline(c);

  return <><div className="main">
    <ReminderBar c={c} ticks={ticks} onAddEntry={openQuickEntry} />
    <div className="cols cols-eq">
    <div className="g">
      <section className="card">
        <div className="h">Окончание</div>
        <div className="g g2">
          <TimePicker label="Конец операции" value={c.surgeryEndAt} onChange={iso => update({ surgeryEndAt: iso })} />
          <TimePicker label="Конец анестезии (газ выкл.)" value={c.anesthesiaEndAt} onChange={iso => update({ anesthesiaEndAt: iso })} />
          <TimePicker label="Экстубация" value={r.extubatedAt} onChange={iso => u({ extubatedAt: iso })} />
          <Field label="T при экстубации, °C" value={r.tempAtExtubation ?? ''} onChange={v => u({ tempAtExtubation: v })} num />
        </div>
        <div className="row" style={{ marginTop: 12, gap: 18, flexWrap: 'wrap' }}>
          <span>Анестезия: <b>{tl.anesthesia ? fmtDuration(tl.anesthesia.minutes) : '—'}</b></span>
          <span>Операция: <b>{tl.surgery ? fmtDuration(tl.surgery.minutes) : '—'}</b></span>
        </div>
        {tl.warnings.map(w => <div key={w} className="note" style={{ marginTop: 8 }}>{w}</div>)}
      </section>
      <section className="card">
        <div className="h">Качество пробуждения</div>
        <div className="seg">{scale.map((l, i) => <button key={i} type="button" className={r.quality === i + 1 ? 'on' : ''}
          onClick={() => u({ quality: r.quality === i + 1 ? null : i + 1 })}>{i + 1}{l ? ` · ${l}` : ''}</button>)}</div>
        <div className="muted small" style={{ marginTop: 8 }}>Подписи шкалы задаются в Настройках.</div>
      </section>
      <section className="card">
        <div className="h">Осложнения</div>
        <div className="chipbar">
          {[...labels, ...extra].map(x => <button key={x} type="button" className={`chip ${chosen.includes(x) ? 'on' : ''}`} onClick={() => toggle(x)}>{x}</button>)}
        </div>
        {chosen.length === 0 && <div className="muted small" style={{ marginTop: 6 }}>Не отмечено. Список осложнений редактируется в Настройках.</div>}
        <div style={{ marginTop: 10 }}><Field label="Другое" value={r.otherComplication ?? ''} onChange={v => u({ otherComplication: v })} /></div>
      </section>
    </div>
    <div className="g">
      <PhaseDrugs c={c} phase="recovery" title="Обезболивание после операции" onSaved={onSaved} emptyText="Препараты из справочника клиники, доза выбирается вручную." />
      <InfusionsSection c={c} onSaved={onSaved} compact />
      <RegionalSection c={c} onSaved={onSaved} compact phase="recovery" />
      <section className="card">
        <div className="h">Перевод</div>
        <Seg value={r.transferTo} options={[{ v: 'ward', ru: 'Стационар' }, { v: 'icu', ru: 'ОРИТ' }, { v: 'home', ru: 'Домой' }]} onChange={v => u({ transferTo: v })} />
        <div style={{ marginTop: 12 }}><TimePicker label="Время перевода" value={r.transferAt} onChange={iso => u({ transferAt: iso })} /></div>
      </section>
      <section className="card"><Notes label="Заметки к пробуждению" value={r.notes ?? ''} onChange={v => u({ notes: v })} /></section>
      <section className="card">
        <div className="h">Подпись анестезиолога</div>
        <Labeled label={r.signedAt ? `Подписано в ${fmtTime(new Date(r.signedAt))}` : 'Не подписано'}>
          <div className="row">
            <div style={{ flex: 1 }}><Field label="ФИО" value={r.signedBy ?? c.anesthesiologist ?? ''} onChange={v => u({ signedBy: v, signedAt: null })} /></div>
            <button className="btn pri" disabled={!(r.signedBy ?? c.anesthesiologist ?? '').trim()}
              onClick={() => u({ signedBy: (r.signedBy ?? c.anesthesiologist).trim(), signedAt: new Date().toISOString() })}>{r.signedAt ? 'Подписать заново' : 'Подписать'}</button>
          </div>
        </Labeled>
      </section>
    </div>
  </div></div>
  <div className="bar">
    <button className="btn sec" onClick={async () => { await flush(); go(`/case/${c.id}/maintenance`); }}>← Поддержание</button>
    <div style={{ flex: 1 }} />
    <button className="btn pri" onClick={openQuickEntry}>+ Запись</button>
    <button className="btn sec" onClick={async () => { await flush(); go(`/case/${c.id}/print`); }}>Экспорт PDF</button>
    <button className="btn pri" onClick={async () => { update({ stage: c.stage === 'closed' ? 'recovery' : 'closed' }); await flush(); }}>{c.stage === 'closed' ? 'Открыть снова' : 'Закрыть карту'}</button>
  </div>
  {quick && <QuickEntrySheet state={quick} onCancel={() => setQuick(null)} onConfirm={(p, at) => void saveQuickEntry(p, at)}
    onGasChange={g => { update({ maintenanceGas: g }); setQuick(s => s ? { ...s, gas: g } : s); }} />}
  </>;
}
