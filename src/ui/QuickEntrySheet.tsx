import { useMemo, useState } from 'react';
import type { VitalFields } from '../db/db';
import {
  applyKeypad, copyAllPrevious, copyPreviousValue, emptyDraft, entryDraftToPatch,
  formatPrevious, isEntryOutOfRange, type EntryField,
} from '../core/quickEntry';
import { TimePicker } from './pickers';

export interface QuickEntryState {
  at: string;
  fields: EntryField[];
  previous?: VitalFields | null;
  mergeNote?: string | null;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'] as const;

export function QuickEntrySheet({ state, onCancel, onConfirm }: {
  state: QuickEntryState;
  onCancel: () => void;
  onConfirm: (patch: Partial<VitalFields>, at: string) => void;
}) {
  const fields = state.fields;
  const [at, setAt] = useState(state.at);
  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState(() => emptyDraft(fields));
  const field = fields[idx] ?? fields[0];
  const raw = field ? (draft[field.key] ?? '') : '';
  const prevText = field ? formatPrevious(state.previous, field.key) : '';
  const hasPrev = !!state.previous && fields.some(f => formatPrevious(state.previous, f.key) !== '');
  const oor = field ? isEntryOutOfRange(field, raw) : false;
  const last = idx >= fields.length - 1;
  const filled = useMemo(() => fields.filter(f => (draft[f.key] ?? '').trim() !== '').length, [draft, fields]);

  if (!field) return null;

  const setRaw = (v: string) => setDraft(s => ({ ...s, [field.key]: v }));
  const skip = () => setIdx(i => Math.min(fields.length - 1, i + 1));
  const next = () => { if (last) commit(); else skip(); };
  const copyOne = () => {
    setDraft(s => copyPreviousValue(s, field.key, state.previous));
  };
  const copyAll = () => setDraft(s => copyAllPrevious(s, fields.map(f => f.key), state.previous));
  const commit = () => onConfirm(entryDraftToPatch(draft, fields), at);
  const press = (k: string) => {
    if (k === ',' && !field.allowDecimal) return;
    setRaw(applyKeypad(raw, k, field.allowDecimal));
  };

  const display = raw || prevText;
  const ghost = raw === '' && prevText !== '';

  return <div className="ov center qe-ov" onClick={onCancel} role="presentation">
    <div className="sheet wide qe-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Новая запись">
      <div className="shtitle">
        <div className="ttl">Новая запись <span className="qe-step">{idx + 1}&nbsp;из&nbsp;{fields.length}</span></div>
        <TimePicker label="Время" value={at} onChange={setAt} />
      </div>
      {state.mergeNote && <div className="note" style={{ marginBottom: 8 }}>{state.mergeNote}</div>}
      {hasPrev && <div className="qe-all">
        <button type="button" className="btn sm sec" onClick={copyAll}>Все как прошлый</button>
        <span className="muted small">заполнит пустые поля</span>
      </div>}
      <div className="qe-body">
        <div className="qe-fl">{field.label}{field.unit ? ` · ${field.unit}` : ''}</div>
        <div className={`qe-val ${ghost ? 'ghost' : ''} ${oor && !ghost ? 'warn' : ''}`} aria-live="polite">
          {display || '—'}
        </div>
        {oor && !ghost && <div className="lh w qe-hint">вне рамки {field.min ?? '…'}–{field.max ?? '…'}</div>}
        {ghost && <div className="muted small qe-hint">прошлое значение · введите новое или нажмите «Как прошлый»</div>}
        {field.kind === 'enum' && field.enumValues
          ? <div className="qe-enums">
              <button type="button" className={`qe-enum ${raw === '' ? 'on' : ''}`} onClick={() => setRaw('')}>—</button>
              {field.enumValues.map(v =>
                <button key={v} type="button" className={`qe-enum ${raw === v ? 'on' : ''}`} onClick={() => setRaw(v)}>{v}</button>)}
            </div>
          : <div className="qe-keys">
              {KEYS.map(k => {
                const off = k === ',' && !field.allowDecimal;
                return <button key={k} type="button" className={`qe-key ${k === '⌫' ? 'back' : ''} ${off ? 'off' : ''}`}
                  disabled={off} onClick={() => press(k)}>{k}</button>;
              })}
            </div>}
      </div>
      <div className="qe-nav">
        <button type="button" className="btn sec" onClick={skip} disabled={last}>Пропустить</button>
        <button type="button" className="btn sec" onClick={copyOne} disabled={!prevText}>Как прошлый</button>
        <button type="button" className="btn pri" onClick={next}>{last ? 'Готово' : 'Далее →'}</button>
      </div>
      <div className="row sheet-actions qe-foot">
        <button type="button" className="btn sec" onClick={onCancel}>Отмена</button>
        <div className="muted small" style={{ flex: 1, textAlign: 'center' }}>{filled ? `заполнено ${filled}` : 'пока ничего не записано'}</div>
        <button type="button" className="btn pri" onClick={commit}>Готово</button>
      </div>
    </div>
  </div>;
}
