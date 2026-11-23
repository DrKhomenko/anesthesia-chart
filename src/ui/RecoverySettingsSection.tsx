import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveWithAudit, CLINIC_SETTINGS_ID, DEFAULT_CLINIC_NAME, complicationLabelsOf, recoveryScaleOf, type ClinicSettings } from '../db/db';
import { canAddCatalogItem } from '../core/logic';

/** Название клиники для PDF, список осложнений и подписи шкалы пробуждения — только подписи, без клинических значений. */
export function RecoverySettingsSection({ onSaved }: { onSaved: (fn: () => Promise<unknown>) => void }) {
  const cs = useLiveQuery(() => db.clinicSettings.get(CLINIC_SETTINGS_ID), []);
  const [newC, setNewC] = useState('');
  if (!cs) return null;
  const labels = complicationLabelsOf(cs);
  const scale = recoveryScaleOf(cs);
  const put = (p: Partial<ClinicSettings>) => onSaved(() => saveWithAudit(db.clinicSettings, 'ClinicSettings', { ...cs, ...p }));
  const check = canAddCatalogItem(newC, labels.map((name, i) => ({ id: String(i), name })));
  return <section className="card" style={{ marginTop: 16 }}>
    <div className="h">Карта: клиника и пробуждение</div>
    <div className="g">
      <TextSave label="Название клиники (в PDF)" value={cs.clinicName ?? ''} placeholder={DEFAULT_CLINIC_NAME} onSave={v => put({ clinicName: v })} />
      <div className="muted" style={{ fontWeight: 600 }}>Осложнения пробуждения (галочки)</div>
      <div className="chipbar">{labels.map(l => <span key={l} className="chip">{l}
        <button className="x" aria-label={`Убрать ${l}`} style={{ marginLeft: 6 }} onClick={() => put({ complicationLabels: labels.filter(x => x !== l) })}>✕</button></span>)}</div>
      <div className="row">
        <label className="field" style={{ flex: 1 }}><span className="fl">Новое осложнение</span>
          <input value={newC} placeholder="название" onChange={e => setNewC(e.target.value)} /></label>
        <button className="btn sm pri" disabled={!check.ok} onClick={() => { if (check.ok) { put({ complicationLabels: [...labels, check.name] }); setNewC(''); } }}>Добавить</button>
      </div>
      <div className="muted" style={{ fontWeight: 600 }}>Шкала качества пробуждения 1–5</div>
      <div className="g g5">{scale.map((l, i) => <TextSave key={i} label={`${i + 1}`} value={l} placeholder="подпись" onSave={v => { const next = [...scale]; next[i] = v.trim(); put({ recoveryScaleLabels: next }); }} />)}</div>
      <div className="muted small">Подписи шкалы задаёт клиника; пусто — показывается только цифра.</div>
    </div>
  </section>;
}

function TextSave({ label, value, placeholder, onSave }: { label: string; value: string; placeholder?: string; onSave: (v: string) => void }) {
  const [t, setT] = useState(value);
  return <label className="field"><span className="fl">{label}</span>
    <input value={t} placeholder={placeholder} onChange={e => setT(e.target.value)} onBlur={() => { if (t !== value) onSave(t); }} /></label>;
}
