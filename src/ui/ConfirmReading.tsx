import { useMemo, useState } from 'react';
import type { DeviceRec } from '../db/db';
import { fieldsFor, type DeviceType } from '../core/devices';
import { calcMap, fmt, parseNum } from '../core/logic';
import { isOutOfRange, type ParsedValue } from '../core/vision';
import { FLAG_HINT, type OcrReason } from '../core/ocr';
import { TimePicker } from './pickers';
import { Overlay } from './overlay';

export interface ConfirmState {
  type: DeviceType;
  device: DeviceRec;
  values: Record<string, ParsedValue>;
  at: string;
  previewUrl?: string | null;
  sentImageUrl?: string | null;
  rawAnswer?: string | null;
  modelUsed?: string | null;
  notice?: string | null;
  mergeNote?: string | null;
  flags?: Record<string, OcrReason>;
}

function toInput(v: ParsedValue): string {
  if (v == null || v === '') return '';
  return typeof v === 'number' ? fmt(v, 3) : String(v);
}

function truncateRaw(raw: string, max = 2000): string {
  const s = raw.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…`;
}

export function ConfirmReading({ state, onCancel, onConfirm }: {
  state: ConfirmState; onCancel: () => void;
  onConfirm: (values: Record<string, ParsedValue>, at: string) => void;
}) {
  const fields = useMemo(() => fieldsFor(state.device.type, state.device.fieldKeys), [state.device]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const f of fields) o[f.key] = toInput(state.values[f.key] ?? null);
    const m = calcMap(o.nibpSys, o.nibpDia);
    if (m != null && !(o.nibpMap ?? '').trim()) o.nibpMap = fmt(m, 0);
    return o;
  });
  const [at, setAt] = useState(state.at);
  const [seenOpen, setSeenOpen] = useState(false);
  const [mapManual, setMapManual] = useState(() => {
    const m = calcMap(state.values.nibpSys as number | null, state.values.nibpDia as number | null);
    const given = state.values.nibpMap;
    return given != null && given !== '' && (m == null || given !== m);
  });
  const set = (key: string, v: string) => {
    if (key === 'nibpMap') setMapManual(v.trim() !== '');
    setValues(s => {
      const next = { ...s, [key]: v };
      if ((key === 'nibpSys' || key === 'nibpDia') && !mapManual) {
        const m = calcMap(key === 'nibpSys' ? v : s.nibpSys, key === 'nibpDia' ? v : s.nibpDia);
        next.nibpMap = m == null ? '' : fmt(m, 0);
      }
      return next;
    });
  };

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
  const seenImage = state.sentImageUrl || state.previewUrl;
  const hasSeen = !!(seenImage || state.rawAnswer || state.modelUsed);

  return <Overlay className="ov center" onClick={onCancel}>
    <div className="sheet wide" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
      <div className="shtitle">
        <div className="ttl">{title} · {state.device.name}</div>
        <TimePicker label="Время записи" value={at} onChange={setAt} />
      </div>
      <div className="sheet-body">
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
              {f.key === 'nibpMap' && !oor && !badNum && (mapManual
                ? <span className="lh">вручную</span>
                : (values.nibpSys && values.nibpDia ? <span className="lh">считается из САД и ДАД</span> : null))}
            </label>;
          })}
        </div>
        {hasSeen && <div className="seen">
          <button type="button" className="seen-toggle" aria-expanded={seenOpen} onClick={() => setSeenOpen(v => !v)}>
            {seenOpen ? '▾' : '▸'} Что видела программа
          </button>
          {seenOpen && <div className="seen-body">
            {state.modelUsed && <div className="muted small">Модель: {state.modelUsed}</div>}
            {seenImage && <img className="previmg" src={seenImage} alt="Изображение, отправленное модели" />}
            {state.rawAnswer
              ? <pre className="seen-raw">{truncateRaw(state.rawAnswer)}</pre>
              : <div className="muted small">Сырого ответа модели нет.</div>}
          </div>}
        </div>}
        <div className="muted small" style={{ marginTop: 10 }}>Проверьте цифры и нажмите «Подтвердить». Без подтверждения в карту ничего не записывается. Sevo и Iso вводятся вручную на экране поддержания.</div>
      </div>
      <div className="row sheet-actions">
        <button className="btn sec" onClick={onCancel}>Отмена</button>
        <div style={{ flex: 1 }} />
        <button className="btn pri" onClick={commit}>Подтвердить</button>
      </div>
    </div>
  </Overlay>;
}
