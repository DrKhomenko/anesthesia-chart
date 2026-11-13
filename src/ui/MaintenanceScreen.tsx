import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getLocalSettings, saveWithAudit, upsertVitalTick, valuesToTickPatch, type DeviceRec, type LocalSettings, type VitalTick } from '../db/db';
import { fmt, fmtTime, parseNum } from '../core/logic';
import { emptyValues, resolveTickTime, type ParsedValue } from '../core/vision';
import { downscaleImage, hasRecognitionReady, makeThumbnail, MANUAL_OFFLINE_MSG, recognizeImage } from './visionClient';
import { ConfirmReading, type ConfirmState } from './ConfirmReading';
import { Field, TimePicker } from './pickers';
import { useCaseDraft } from './useCase';
import { go, type SaveState } from './App';
import { fieldsFor, type DeviceType } from '../core/devices';

const COLS: { key: string; label: string; get: (t: VitalTick) => string }[] = [
  { key: 'hr', label: 'ЧСС', get: t => n(t.hr) },
  { key: 'spo2', label: 'SpO₂', get: t => n(t.spo2) },
  { key: 'etco2', label: 'EtCO₂', get: t => n(t.etco2) },
  { key: 'tempC', label: 'T', get: t => n(t.tempC ?? t.t2, 1) },
  { key: 'bp', label: 'АД', get: t => bp(t) },
  { key: 'ventMode', label: 'Режим', get: t => t.ventMode || '—' },
  { key: 'vtInsp', label: 'VT', get: t => n(t.vtInsp) },
  { key: 'fio2', label: 'FiO₂', get: t => n(t.fio2) },
  { key: 'sevo', label: 'Sevo', get: t => n(t.sevoPct, 1) },
  { key: 'iso', label: 'Iso', get: t => n(t.isoPct, 1) },
];
function n(v: number | null | undefined, d = 0): string { return v == null ? '—' : fmt(v, d); }
function bp(t: VitalTick): string {
  if (t.sys == null && t.dia == null && t.map == null) return '—';
  return `${n(t.sys)}/${n(t.dia)}/${n(t.map)}`;
}

export function MaintenanceScreen({ id, onSaved }: { id: string; onSaved: (s: SaveState) => void }) {
  const { c, update } = useCaseDraft(id, onSaved);
  const ticks = useLiveQuery(async () => {
    const rows = await db.vitals.where('caseId').equals(id).filter(t => !t.deletedAt).toArray();
    return rows.sort((a, b) => a.at.localeCompare(b.at));
  }, [id]) ?? [];
  const devices = useLiveQuery(() => db.devices.filter(d => !d.deletedAt && d.isActive).toArray(), []) ?? [];
  const [loc, setLoc] = useState<LocalSettings | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'monitor' | 'machine' | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const fileMon = useRef<HTMLInputElement>(null);
  const fileNda = useRef<HTMLInputElement>(null);

  useEffect(() => { void getLocalSettings().then(setLoc); }, []);
  useEffect(() => {
    const raw = sessionStorage.getItem('demoConfirm');
    if (!raw) return;
    sessionStorage.removeItem('demoConfirm');
    try { setConfirm(JSON.parse(raw) as ConfirmState); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!selId && ticks.length) setSelId(ticks[ticks.length - 1].id);
    if (selId && ticks.length && !ticks.some(t => t.id === selId)) setSelId(ticks[ticks.length - 1]?.id ?? null);
  }, [ticks, selId]);

  if (!c) return <div className="main muted">Загрузка…</div>;
  const selected = ticks.find(t => t.id === selId) ?? ticks[ticks.length - 1] ?? null;
  const pickDevice = (type: DeviceType): DeviceRec | undefined => {
    const id = type === 'monitor' ? loc?.activeMonitorId : loc?.activeMachineId;
    return devices.find(d => d.id === id && d.type === type) ?? devices.find(d => d.type === type);
  };

  const openManual = (type: DeviceType, notice: string | null) => {
    const device = pickDevice(type);
    if (!device) { setBanner('Сначала выберите прибор в Настройках → Оборудование'); return; }
    const now = new Date();
    const merge = resolveTickTime({ deviceTimeRaw: null, now, existingTicks: ticks });
    setConfirm({
      type, device, values: emptyValues(fieldsFor(device.type, device.fieldKeys)),
      at: merge.at.toISOString(), previewUrl: null, notice,
      mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : null,
    });
  };

  const onFile = async (type: DeviceType, file: File | undefined) => {
    const device = pickDevice(type);
    if (!device) { setBanner('Сначала выберите прибор в Настройках → Оборудование'); return; }
    if (!file) return;
    setBanner(null); setBusy(type);
    try {
      const { dataUrl } = await downscaleImage(file);
      previewRef.current = dataUrl;
      const settings = loc ?? await getLocalSettings();
      const online = navigator.onLine;
      const ready = hasRecognitionReady(settings, online);
      if (!ready) {
        const now = new Date();
        const merge = resolveTickTime({ deviceTimeRaw: null, now, existingTicks: ticks });
        setConfirm({
          type, device, values: emptyValues(fieldsFor(device.type, device.fieldKeys)),
          at: merge.at.toISOString(), previewUrl: dataUrl, notice: MANUAL_OFFLINE_MSG,
          mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : null,
        });
        return;
      }
      const res = await recognizeImage({
        dataUrl, device,
        baseUrl: settings.recognitionBaseUrl, model: settings.recognitionModel, apiKey: settings.recognitionApiKey,
      });
      const now = new Date();
      const merge = resolveTickTime({ deviceTimeRaw: res.reading.deviceTimeRaw, now, existingTicks: ticks });
      setConfirm({
        type, device, values: res.reading.values, at: merge.at.toISOString(), previewUrl: dataUrl,
        notice: res.ok ? null : `${res.error}. Проверьте и введите вручную.`,
        mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : (merge.usedDeviceTime ? 'Время взято с часов прибора.' : null),
      });
    } catch (e) {
      setBanner(e instanceof Error ? e.message : 'Не удалось обработать снимок');
    } finally {
      setBusy(null);
    }
  };

  const confirmSave = async (values: Record<string, ParsedValue>, at: string) => {
    if (!confirm) return;
    onSaved('saving');
    const patch = valuesToTickPatch(values, confirm.type);
    if (confirm.type === 'monitor') patch.sourceMonitorId = confirm.device.id;
    else patch.sourceMachineId = confirm.device.id;
    const settings = loc ?? await getLocalSettings();
    if (settings.storePhotoThumbnail && confirm.previewUrl) {
      try {
        const thumb = await makeThumbnail(confirm.previewUrl);
        if (confirm.type === 'monitor') patch.thumbnailMonitor = thumb;
        else patch.thumbnailMachine = thumb;
      } catch { /* превью не критично */ }
    }
    const saved = await upsertVitalTick({ caseId: c.id, at, patch, reason: 'фото/подтверждение' });
    if (c.stage === 'header' || c.stage === 'premed' || c.stage === 'induction') update({ stage: 'maintenance' });
    onSaved('saved');
    setSelId(saved.id);
    setConfirm(null);
    previewRef.current = null;
  };

  const patchTick = (p: Partial<VitalTick>) => {
    if (!selected) return;
    onSaved('saving');
    void upsertVitalTick({ caseId: c.id, at: selected.at, patch: p }).then(() => onSaved('saved'));
  };

  const addManualTick = () => {
    const now = new Date();
    const merge = resolveTickTime({ deviceTimeRaw: null, now, existingTicks: ticks, mergeWindowMin: 0 });
    onSaved('saving');
    void upsertVitalTick({ caseId: c.id, at: merge.at, patch: {} }).then(s => { onSaved('saved'); setSelId(s.id); });
  };

  return <><div className="main"><div className="g">
    {banner && <div className="warn">{banner}</div>}
    {busy && <div className="note">Распознаю снимок {busy === 'monitor' ? 'монитора' : 'НДА'}…</div>}
    <section className="card">
      <div className="h">Показания
        <span className="r">{ticks.length ? `${ticks.length} запис.` : 'пока пусто'}</span></div>
      {ticks.length === 0 && <div className="note">Снимите монитор или НДА — или добавьте минуту вручную. Подтверждённые цифры попадут на график. Sevo и Iso вводятся здесь вручную: модуля газов нет.</div>}
      {ticks.length > 0 && <div className="vtable-wrap"><table className="vtable">
        <thead><tr><th>Время</th>{COLS.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>{ticks.map(t => <tr key={t.id} className={t.id === selected?.id ? 'on' : ''} onClick={() => setSelId(t.id)}>
          <td className="l">{fmtTime(new Date(t.at))}</td>
          {COLS.map(c => <td key={c.key}>{c.get(t)}</td>)}
        </tr>)}</tbody>
      </table></div>}
    </section>
    {selected && <section className="card">
      <div className="h">Минута
        <TimePicker label="Время" value={selected.at} onChange={iso => {
          onSaved('saving');
          void (async () => {
            const row = await db.vitals.get(selected.id);
            if (row) await saveWithAudit(db.vitals, 'VitalTick', { ...row, at: iso }, { caseId: c.id });
            onSaved('saved');
          })();
        }} />
      </div>
      <div className="bv8" style={{ marginBottom: 14 }}>
        <div className="field"><span className="fl">ЧСС</span><b className="mins" style={{ color: 'var(--red)' }}>{n(selected.hr)}</b></div>
        <div className="field"><span className="fl">SpO₂</span><b className="mins">{n(selected.spo2)}</b></div>
        <div className="field"><span className="fl">EtCO₂</span><b className="mins">{n(selected.etco2)}</b></div>
        <div className="field"><span className="fl">T, °C</span><b className="mins">{n(selected.tempC ?? selected.t2, 1)}</b></div>
      </div>
      <div className="g g5">
        <div className="field"><span className="fl">АД</span><span className="tpval">{bp(selected)}</span></div>
        <div className="field"><span className="fl">Режим</span><span className="tpval">{selected.ventMode || '—'}</span></div>
        <div className="field"><span className="fl">VT вдох, мл</span><span className="tpval">{n(selected.vtInsp)}</span></div>
        <div className="field"><span className="fl">FiO₂, %</span><span className="tpval">{n(selected.fio2)}</span></div>
        <div className="field"><span className="fl">ЧД</span><span className="tpval">{n(selected.rr ?? selected.rrMeas)}</span></div>
      </div>
      <div className="g g2" style={{ marginTop: 14 }}>
        <Field label="Sevo, %" value={selected.sevoPct == null ? '' : fmt(selected.sevoPct, 2)} num
          onChange={v => { const n0 = parseNum(v); patchTick({ sevoPct: v.trim() === '' ? null : Number.isFinite(n0) ? n0 : selected.sevoPct }); }} />
        <Field label="Iso, %" value={selected.isoPct == null ? '' : fmt(selected.isoPct, 2)} num
          onChange={v => { const n0 = parseNum(v); patchTick({ isoPct: v.trim() === '' ? null : Number.isFinite(n0) ? n0 : selected.isoPct }); }} />
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>
        {pickDevice('monitor') ? `Монитор: ${pickDevice('monitor')!.name}` : 'Монитор не выбран'}
        {' · '}
        {pickDevice('machine') ? `НДА: ${pickDevice('machine')!.name}` : 'НДА не выбран'}
      </div>
    </section>}
  </div></div>
  <div className="bar">
    <button className="btn sec" onClick={() => go(`/case/${c.id}/induction`)}>← К индукции</button>
    <div style={{ flex: 1 }} />
    <button className="btn sec" onClick={addManualTick}>+ Минута вручную</button>
    <button className="btn pri" disabled={!!busy} onClick={() => fileMon.current?.click()}>📷 Монитор</button>
    <button className="btn pri" disabled={!!busy} onClick={() => fileNda.current?.click()}>📷 НДА</button>
  </div>
  <input ref={fileMon} type="file" accept="image/*" capture="environment" hidden
    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void onFile('monitor', f); }} />
  <input ref={fileNda} type="file" accept="image/*" capture="environment" hidden
    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void onFile('machine', f); }} />
  {confirm && <ConfirmReading state={confirm} onCancel={() => setConfirm(null)} onConfirm={(v, at) => void confirmSave(v, at)} />}
  </>;
}
