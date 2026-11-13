import { useMemo, useState } from 'react';
import type { DeviceRec } from '../db/db';
import { fieldsFor, type DeviceType } from '../core/devices';
import { fmt, parseNum } from '../core/logic';
import { isOutOfRange, type ParsedValue } from '../core/vision';
import { FLAG_HINT, type OcrReason } from '../core/ocr';
import { TimePicker } from './pickers';

export interface ConfirmState {
  type: DeviceType;
  device: DeviceRec;
  values: Record<string, ParsedValue>;
  at: string;
  previewUrl?: string | null;
  notice?: string | null;
  mergeNote?: string | null;
  flags?: Record<string, OcrReason>;
}

function toInput(v: ParsedValue): string {
  if (v == null || v === '') return '';
  return typeof v === 'number' ? fmt(v, 3) : String(v);
}

export function ConfirmReading({ state, onCancel, onConfirm }: {
  state: ConfirmState; onCancel: () => void;
  onConfirm: (values: Record<string, ParsedValue>, at: string) => void;
}) {
  const fields = useMemo(() => fieldsFor(state.device.type, state.device.fieldKeys), [state.device]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const f of fields) o[f.key] = toInput(state.values[f.key] ?? null);
    return o;
  });
  const [at, setAt] = useState(state.at);
  const set = (key: string, v: string) => setValues(s => ({ ...s, [key]: v }));

  const commit = () => {
    const out: Record<string, ParsedValue> = {};
    for (const f of fields) {
      const raw = (values[f.key] ?? '').trim();
      if (raw === '') { out[f.key] = null; continue; }
      out[f.key] = f.kind === 'number' ? (Number.isFinite(parseNum(raw)) ? parseNum(raw) : raw) : raw;
    }
    onConfirm(out, at);
  };

  const title = state.type === 'monitor' ? 'Показания монитора' : 'Показания НДА';

  return <div className="ov center" onClick={onCancel} role="presentation">
    <div className="sheet wide" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
      <div className="shtitle">
        <div className="ttl">{title} · {state.device.name}</div>
        <TimePicker label="Время записи" value={at} onChange={setAt} />
      </div>
      {state.notice && <div className="warn" style={{ marginBottom: 12 }}>{state.notice}</div>}
      {state.mergeNote && <div className="note" style={{ marginBottom: 12 }}>{state.mergeNote}</div>}
      {state.previewUrl && <img className="previmg" src={state.previewUrl} alt="Снимок" />}
      <div className="cv">
        {fields.map(f => {
          const raw = values[f.key] ?? '';
          const n = f.kind === 'number' ? parseNum(raw) : NaN;
          const parsed: ParsedValue = f.kind === 'number' ? (raw.trim() === '' ? null : Number.isFinite(n) ? n : raw) : (raw.trim() || null);
          const badNum = f.kind === 'number' && raw.trim() !== '' && !Number.isFinite(n);
          const flag = state.flags?.[f.key];
          const oor = !badNum && (isOutOfRange(f, parsed) || flag === 'out-of-range');
          const flagged = !!flag && flag !== 'ok';
          return <label key={f.key} className={`field ${oor || badNum || flagged ? 'warnb' : ''}`}>
            <span className="fl">{f.label}{f.unit ? ` · ${f.unit}` : ''}</span>
            {f.kind === 'enum' && f.enumValues
              ? <select value={raw} onChange={e => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {f.enumValues.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              : <input value={raw} placeholder="—" inputMode={f.kind === 'number' ? 'decimal' : undefined} autoComplete="off"
                  onChange={e => set(f.key, e.target.value)} />}
            {oor && <span className="lh w">вне рамки {f.min ?? '…'}–{f.max ?? '…'}</span>}
            {badNum && <span className="lh e">не число</span>}
            {!oor && !badNum && flagged && <span className="lh w">{FLAG_HINT[flag!] || 'проверьте'}</span>}
          </label>;
        })}
      </div>
      <div className="muted small" style={{ marginTop: 10 }}>Проверьте цифры и нажмите «Подтвердить». Без подтверждения в карту ничего не записывается. Sevo и Iso вводятся вручную на экране поддержания.</div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn sec" onClick={onCancel}>Отмена</button>
        <div style={{ flex: 1 }} />
        <button className="btn pri" onClick={commit}>Подтвердить</button>
      </div>
    </div>
  </div>;
}
