import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CLINIC_SETTINGS_ID, clinicVentModes, db, defaultGasOf, getLocalSettings, saveWithAudit, upsertVitalTick, valuesToTickPatch, type DeviceRec, type LocalSettings, type VitalTick } from '../db/db';
import { fmt, fmtTime, parseNum } from '../core/logic';
import { emptyValues, resolveTickTime, type ParsedValue } from '../core/vision';
import { cloudNotReadyReason, downscaleImage, makeThumbnail, shortCloudError, shouldFallbackToDevice, prepareCloudImage, recognitionProviderOf, recognizeWithFallback, warpPhoto } from './visionClient';
import { errorText } from './errorText';
import { ScreenAlign } from './ScreenAlign';
import type { Quad } from '../core/geom';
import type { OcrReason } from '../core/ocr';
import { ConfirmReading, type ConfirmState } from './ConfirmReading';
import { QuickEntrySheet, type QuickEntryState } from './QuickEntrySheet';
import { Field, TimePicker } from './pickers';
import { useCaseDraft } from './useCase';
import { saveDictation } from './dictationSave';
import { go, type SaveState } from './App';
import { fieldsFor, type DeviceType } from '../core/devices';
import { entryFieldOrder, previousTick, previousWithInductionMode } from '../core/quickEntry';
import { formatTickGas, gasColumnLabel, resolveCaseGas } from '../core/gas';
import { ReminderBar } from './ReminderBar';
import { InfusionsSection } from './InfusionsSection';
import { RegionalSection } from './RegionalSection';


const BASE_COLS: { key: string; label: string; get: (t: VitalTick) => string }[] = [
  { key: 'hr', label: 'ЧСС', get: t => n(t.hr) },
  { key: 'spo2', label: 'SpO₂', get: t => n(t.spo2) },
  { key: 'etco2', label: 'EtCO₂', get: t => n(t.etco2) },
  { key: 'tempC', label: 'T', get: t => n(t.tempC ?? t.t2, 1) },
  { key: 'bp', label: 'АД', get: t => bp(t) },
  { key: 'ventMode', label: 'Режим', get: t => t.ventMode || '—' },
  { key: 'vtInsp', label: 'VT', get: t => n(t.vtInsp) },
  { key: 'fio2', label: 'FiO₂', get: t => n(t.fio2) },
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
  const clinic = useLiveQuery(() => db.clinicSettings.get(CLINIC_SETTINGS_ID), []);
  const formulary = useLiveQuery(() => db.drugs.filter(d => !d.deletedAt && d.isActive).toArray(), []) ?? [];
  const formularyRefs = formulary.map(d => ({ id: d.id, name: d.name, genericName: d.genericName }));

  const [loc, setLoc] = useState<LocalSettings | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'monitor' | 'machine' | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [quick, setQuick] = useState<QuickEntryState | null>(null);
  const [align, setAlign] = useState<{ type: DeviceType; device: DeviceRec; dataUrl: string; initialQuad?: import('../core/geom').Quad } | null>(null);
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
    const raw = sessionStorage.getItem('demoAlign');
    if (!raw) return;
    sessionStorage.removeItem('demoAlign');
    try { setAlign(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    const raw = sessionStorage.getItem('demoQuickEntry');
    if (!raw) return;
    sessionStorage.removeItem('demoQuickEntry');
    try { setQuick(JSON.parse(raw) as QuickEntryState); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!selId && ticks.length) setSelId(ticks[ticks.length - 1].id);
    if (selId && ticks.length && !ticks.some(t => t.id === selId)) setSelId(ticks[ticks.length - 1]?.id ?? null);
  }, [ticks, selId]);

  if (!c) return <div className="main muted">Загрузка…</div>;
  const gas = resolveCaseGas({ maintenanceGas: c.maintenanceGas, inductionGas: c.induction?.gas, defaultGas: defaultGasOf(clinic) });
  const cols = [...BASE_COLS, { key: 'gas', label: gasColumnLabel(ticks, gas), get: (tick: VitalTick) => formatTickGas(tick, fmt) }];
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
    setBanner(null);
    try {
      const { dataUrl } = await downscaleImage(file);
      previewRef.current = dataUrl;
      setAlign({ type, device, dataUrl });
    } catch (e) {
      setBanner(`открытие снимка: ${errorText(e)}`);
    }
  };

  const afterAlign = async (quad: Quad) => {
    if (!align) return;
    const { type, device, dataUrl } = align;
    setAlign(null);
    setBusy(type);
    setBanner(null);
    const empty = emptyValues(fieldsFor(device.type, device.fieldKeys));
    const mergeNow = (deviceTimeRaw: string | null) =>
      resolveTickTime({ deviceTimeRaw, now: new Date(), existingTicks: ticks });
    let previewUrl = dataUrl;
    let warpedPix: import('../core/geom').Pix | null = null;
    try {
      const warped = await warpPhoto(dataUrl, quad);
      previewRef.current = warped.dataUrl;
      previewUrl = warped.dataUrl;
      warpedPix = warped.pix;
    } catch (e) {
      const reason = errorText(e);
      const tagged = reason.startsWith('выравнивание:') ? reason : `выравнивание: ${reason}`;
      const merge = mergeNow(null);
      setConfirm({
        type, device, values: empty, at: merge.at.toISOString(), previewUrl: dataUrl,
        notice: `Распознать не удалось (${tagged}) — введите вручную`,
        mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : null,
      });
      setBusy(null);
      return;
    }
    const openEmpty = (reason: string) => {
      const merge = mergeNow(null);
      setConfirm({
        type, device, values: empty, at: merge.at.toISOString(), previewUrl,
        notice: `Распознать не удалось (${reason}) — введите вручную`,
        mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : null,
      });
    };
    try {
      const settings = await getLocalSettings();
      setLoc(settings);
      const provider = recognitionProviderOf(settings);
      const notReady = provider === 'cloud' ? cloudNotReadyReason(settings) : null;
      if (notReady) {
        const merge = mergeNow(null);
        setConfirm({
          type, device, values: empty,
          at: merge.at.toISOString(), previewUrl, notice: notReady,
          mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : null,
        });
        return;
      }
      if (provider === 'on-device') {
        if (!warpedPix) { openEmpty('выравнивание: нет кадра'); return; }
        const { recognizeOnDevice } = await import('./onDeviceOcr');
        const res = await recognizeOnDevice({ screen: warpedPix, device });
        const merge = mergeNow(res.deviceTimeRaw);
        const flagged = Object.keys(res.flags).length;
        setConfirm({
          type, device, values: res.values, at: merge.at.toISOString(), previewUrl,
          flags: res.flags as Record<string, OcrReason>,
          notice: flagged ? 'Часть полей не распознана или вне рамки — проверьте и при необходимости впишите вручную.' : null,
          mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : (merge.usedDeviceTime ? 'Время взято с часов прибора.' : null),
        });
        return;
      }
      const cloudUrl = await prepareCloudImage(previewUrl);
      const res = await recognizeWithFallback({
        dataUrl: cloudUrl, device,
        baseUrl: settings.recognitionBaseUrl, model: settings.recognitionModel, apiKey: settings.recognitionApiKey,
        fallbackModels: settings.recognitionFallbackModels,
      });
      if (shouldFallbackToDevice(res) && warpedPix) {
        try {
          const { recognizeOnDevice } = await import('./onDeviceOcr');
          const local = await recognizeOnDevice({ screen: warpedPix, device });
          const merge = mergeNow(local.deviceTimeRaw);
          const flagged = Object.keys(local.flags).length;
          const localNote = flagged ? ' Часть полей не распознана или вне рамки — проверьте и при необходимости впишите вручную.' : '';
          setConfirm({
            type, device, values: local.values, at: merge.at.toISOString(), previewUrl,
            sentImageUrl: cloudUrl, rawAnswer: res.raw ?? null, modelUsed: res.modelUsed ?? settings.recognitionModel,
            flags: local.flags as Record<string, OcrReason>,
            notice: `Облако не сработало (${shortCloudError(res.error)}). Показаны результаты распознавания на устройстве — проверьте их.${localNote}`,
            mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : (merge.usedDeviceTime ? 'Время взято с часов прибора.' : null),
          });
          return;
        } catch (localErr) {
          openEmpty(`облако: ${shortCloudError(res.error)}; на устройстве: ${errorText(localErr)}`);
          return;
        }
      }
      const merge = mergeNow(res.reading.deviceTimeRaw);
      setConfirm({
        type, device, values: res.reading.values, at: merge.at.toISOString(), previewUrl,
        sentImageUrl: cloudUrl, rawAnswer: res.raw ?? null, modelUsed: res.modelUsed ?? settings.recognitionModel,
        notice: res.ok ? (res.modelUsed && res.modelUsed !== settings.recognitionModel ? `Распознала запасная модель ${res.modelUsed}.` : null) : `${res.error}. Проверьте и введите вручную.`,
        mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : (merge.usedDeviceTime ? 'Время взято с часов прибора.' : null),
      });
    } catch (e) {
      openEmpty(errorText(e));
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

  const openQuickEntry = () => {
    const mon = pickDevice('monitor');
    const mach = pickDevice('machine');
    const now = new Date();
    const merge = resolveTickTime({ deviceTimeRaw: null, now, existingTicks: ticks, mergeWindowMin: 0 });
    const fields = entryFieldOrder({
      monitorFieldKeys: mon?.fieldKeys ?? null,
      machineFieldKeys: mach?.fieldKeys ?? null,
      gas,
      ventModes: clinicVentModes(clinic),
    });
    const prev = previousWithInductionMode(previousTick(ticks, merge.at.toISOString()), c.induction?.ventMode);
    setQuick({
      at: merge.at.toISOString(),
      fields,
      previous: prev,
      mergeNote: merge.existing ? `На ${fmtTime(merge.at)} уже есть запись — значения дополнят её.` : null,
      gas,
    });
  };

  const saveQuickEntry = async (patch: Partial<VitalTick>, at: string) => {
    onSaved('saving');
    const saved = await upsertVitalTick({ caseId: c.id, at, patch, reason: 'ручной ввод' });
    if (c.stage === 'header' || c.stage === 'premed' || c.stage === 'induction') update({ stage: 'maintenance' });
    onSaved('saved');
    setSelId(saved.id);
    setQuick(null);
  };

  return <><div className="main"><div className="g">
    <ReminderBar c={c} ticks={ticks} onAddEntry={openQuickEntry} />
    {banner && <div className="warn">{banner}</div>}
    {busy && <div className="note">Распознаю снимок {busy === 'monitor' ? 'монитора' : 'НДА'}…</div>}
    <section className="card">
      <div className="h">Показания
        <span className="r">{ticks.length ? `${ticks.length} запис.` : 'пока пусто'}</span></div>
      {ticks.length === 0 && <div className="note">Нажмите «+ Запись», чтобы ввести минуту с клавиатуры. Можно снять монитор или НДА — цифры всё равно нужно подтвердить. Sevo и Iso вводятся вручную: модуля газов нет.</div>}
      {ticks.length > 0 && <div className="vtable-wrap"><table className="vtable">
        <thead><tr><th>Время</th>{cols.map(col => <th key={col.key}>{col.label}</th>)}</tr></thead>
        <tbody>{ticks.map(t => <tr key={t.id} className={t.id === selected?.id ? 'on' : ''} onClick={() => setSelId(t.id)}>
          <td className="l">{fmtTime(new Date(t.at))}</td>
          {cols.map(col => <td key={col.key}>{col.get(t)}</td>)}
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
        {(gas !== 'iso') && <Field label="Sevo, %" value={selected.sevoPct == null ? '' : fmt(selected.sevoPct, 2)} num
          onChange={v => { const n0 = parseNum(v); patchTick({ sevoPct: v.trim() === '' ? null : Number.isFinite(n0) ? n0 : selected.sevoPct }); }} />}
        {(gas !== 'sevo') && <Field label="Iso, %" value={selected.isoPct == null ? '' : fmt(selected.isoPct, 2)} num
          onChange={v => { const n0 = parseNum(v); patchTick({ isoPct: v.trim() === '' ? null : Number.isFinite(n0) ? n0 : selected.isoPct }); }} />}
      </div>
      {gas === 'sevo' && selected.isoPct != null && <div className="muted small" style={{ marginTop: 6 }}>В этой минуте также Iso {fmt(selected.isoPct, 1)}% — запись сохранена.</div>}
      {gas === 'iso' && selected.sevoPct != null && <div className="muted small" style={{ marginTop: 6 }}>В этой минуте также Sevo {fmt(selected.sevoPct, 1)}% — запись сохранена.</div>}
      {selected.mapManual && <div className="muted small" style={{ marginTop: 6 }}>МАД внесено вручную.</div>}
      <div className="muted small" style={{ marginTop: 8 }}>
        {pickDevice('monitor') ? `Монитор: ${pickDevice('monitor')!.name}` : 'Монитор не выбран'}
        {' · '}
        {pickDevice('machine') ? `НДА: ${pickDevice('machine')!.name}` : 'НДА не выбран'}
      </div>
    </section>}
    <InfusionsSection c={c} onSaved={onSaved} />
    <RegionalSection c={c} onSaved={onSaved} compact phase="maintenance" />
  </div></div>
  <div className="bar">
    <button className="btn sec" onClick={() => go(`/case/${c.id}/induction`)}>← К индукции</button>
    <div style={{ flex: 1 }} />
    <button className="btn pri" onClick={openQuickEntry}>+ Запись</button>
    <button className="btn photo" disabled={!!busy} onClick={() => fileMon.current?.click()}>📷 Монитор</button>
    <button className="btn photo" disabled={!!busy} onClick={() => fileNda.current?.click()}>📷 НДА</button>
    <button className="btn sec" onClick={() => { if (['header', 'premed', 'induction', 'maintenance'].includes(c.stage)) update({ stage: 'recovery' }); go(`/case/${c.id}/recovery`); }}>Пробуждение →</button>
  </div>
  <input ref={fileMon} type="file" accept="image/*" capture="environment" hidden
    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void onFile('monitor', f); }} />
  <input ref={fileNda} type="file" accept="image/*" capture="environment" hidden
    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void onFile('machine', f); }} />
  {align && <ScreenAlign src={align.dataUrl} initialQuad={align.initialQuad} onCancel={() => setAlign(null)} onConfirm={q => void afterAlign(q)} />}
  {confirm && <ConfirmReading state={confirm} onCancel={() => setConfirm(null)} onConfirm={(v, at) => void confirmSave(v, at)} />}
  {quick && <QuickEntrySheet state={quick} onCancel={() => setQuick(null)} onConfirm={(p, at) => void saveQuickEntry(p, at)}
    onGasChange={g => { update({ maintenanceGas: g }); setQuick(s => s ? { ...s, gas: g } : s); }}
    dictation={{ c, drugs: formularyRefs, save: async (items, phase, at) => { onSaved('saving'); await saveDictation({ c, items, phase, at }); onSaved('saved'); } }} />}
  </>;
}
