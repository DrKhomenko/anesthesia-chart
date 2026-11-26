import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaseRec, DrugPhase, VitalFields } from '../db/db';
import {
  applyKeypad, copyAllPrevious, emptyDraft, entryDraftToPatch, effectiveFieldValue,
  formatPrevious, isEntryOutOfRange, syncDraftMap, withGasField,
  type EntryField, type FieldTouch,
} from '../core/quickEntry';
import { calcMap, fmt } from '../core/logic';
import type { GasId } from '../core/gas';
import { FIELD_TO_GAS, GAS_FIELD, GAS_RU } from '../core/gas';
import { DEFAULT_VENT_MODES, modesForPicker } from '../core/ventModes';
import { TimePicker } from './pickers';
import { parseVoiceInput, VOICE_HINT, VOICE_PLACEHOLDER } from '../core/voiceParse';
import { parseDictation, type DictDrugRef, type DictItem } from '../core/dictation';
import { defaultPhase } from '../core/dictationApply';
import { DictationReview } from './DictationReview';
import { Overlay } from './overlay';

export interface QuickEntryState {
  at: string;
  fields: EntryField[];
  previous?: VitalFields | null;
  mergeNote?: string | null;
  /** Выбранный газ минуты. null — сначала спросить, не оба поля. */
  gas?: GasId | null;
  startKey?: string;
  initialDraft?: Record<string, string>;
  mapManual?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'] as const;

/** Диктовка событий в той же строке «Голосом»: кличка, препараты, интубация… Показатели по-прежнему уходят в поля минуты. */
export interface QuickDictation {
  c: CaseRec;
  drugs: DictDrugRef[];
  save: (items: DictItem[], phase: DrugPhase, at: string) => Promise<void>;
}

export function QuickEntrySheet({ state, onCancel, onConfirm, onGasChange, dictation }: {
  state: QuickEntryState;
  onCancel: () => void;
  onConfirm: (patch: Partial<VitalFields>, at: string) => void;
  onGasChange?: (gas: GasId) => void;
  dictation?: QuickDictation;
}) {
  const [gas, setGas] = useState<GasId | null>(state.gas ?? null);
  const allFields = useMemo(() => gas ? withGasField(state.fields, gas) : state.fields.filter(f => !FIELD_TO_GAS[f.key]), [state.fields, gas]);
  // Режим выбирается чипами рядом с аппаратом, отдельным шагом клавиатуры не идёт.
  const fields = useMemo(() => allFields.filter(f => f.key !== 'ventMode'), [allFields]);
  const modeField = allFields.find(f => f.key === 'ventMode');
  const [at, setAt] = useState(state.at);
  const startIdx = Math.max(0, fields.findIndex(f => f.key === state.startKey));
  const [idx, setIdx] = useState(startIdx < 0 ? 0 : startIdx);
  const [draft, setDraft] = useState(() => ({ ...emptyDraft(entryFieldOrderSafe(state.fields)), ...(state.initialDraft ?? {}) }));
  const [touch, setTouch] = useState<Record<string, FieldTouch>>({});
  const [mapManual, setMapManual] = useState(!!state.mapManual);
  const [voiceText, setVoiceText] = useState('');
  const [voiceParsed, setVoiceParsed] = useState<{ values: Record<string, string>; unknown: string[] } | null>(null);
  const [voiceKeys, setVoiceKeys] = useState<Set<string>>(() => new Set());
  const lastParsedVoice = useRef('');
  const [dictItems, setDictItems] = useState<DictItem[]>([]);
  const [dictRemoved, setDictRemoved] = useState<Set<number>>(() => new Set());
  const [dictPhase, setDictPhase] = useState<DrugPhase>('maintenance');
  const [dictPhaseTouched, setDictPhaseTouched] = useState(false);
  const [dictAt, setDictAt] = useState(() => new Date().toISOString());
  const [dictRest, setDictRest] = useState('');
  const [dictSaving, setDictSaving] = useState(false);
  const dictStarted = useRef<string | null>(null);
  const needGas = !gas;
  const field = needGas ? null : (fields[idx] ?? fields[0]);
  const raw = field ? (draft[field.key] ?? '') : '';
  const prevText = field ? formatPrevious(state.previous, field.key) : '';
  const fieldTouch = field ? (touch[field.key] ?? 'untouched') : 'untouched';
  const effective = field ? effectiveFieldValue(draft, field.key, state.previous, fieldTouch) : '';
  const hasPrev = !!state.previous && allFields.some(f => formatPrevious(state.previous, f.key) !== '');
  const oor = field ? isEntryOutOfRange(field, effective) : false;
  const last = !needGas && idx >= fields.length - 1;
  const filled = useMemo(
    () => allFields.filter(f => effectiveFieldValue(draft, f.key, state.previous, touch[f.key]).trim() !== '').length,
    [draft, allFields, touch, state.previous],
  );
  const effSys = effectiveFieldValue(draft, 'nibpSys', state.previous, touch.nibpSys);
  const effDia = effectiveFieldValue(draft, 'nibpDia', state.previous, touch.nibpDia);
  const autoMap = field?.key === 'nibpMap' && !mapManual && fieldTouch !== 'edited' && calcMap(effSys, effDia) != null;

  const setRaw = (v: string, how?: FieldTouch) => {
    if (!field) return;
    const t: FieldTouch = how ?? (v.trim() === '' ? 'cleared' : 'edited');
    setTouch(s => ({ ...s, [field.key]: t }));
    if (field.key === 'nibpMap') setMapManual(t === 'edited' && v.trim() !== '');
    setDraft(s => {
      const next = { ...s, [field.key]: t === 'cleared' ? '' : v };
      if (field.key === 'nibpSys' || field.key === 'nibpDia') return syncDraftMap(next, mapManual);
      return next;
    });
  };
  const skip = () => setIdx(i => Math.min(fields.length - 1, i + 1));
  const commitWith = (d: Record<string, string>, t: Record<string, FieldTouch>, man: boolean) => {
    onConfirm(entryDraftToPatch(d, allFields, { mapManual: man, previous: state.previous, touch: t }), at);
  };
  const commit = () => commitWith(draft, touch, mapManual);
  const next = () => { if (last) commit(); else skip(); };
  const clearAndNext = () => {
    if (!field) return;
    const t = { ...touch, [field.key]: 'cleared' as const };
    const d = { ...draft, [field.key]: '' };
    let man = mapManual;
    if (field.key === 'nibpMap') man = false;
    setTouch(t); setDraft(d); if (field.key === 'nibpMap') setMapManual(false);
    if (last) commitWith(d, t, man); else skip();
  };
  const copyAll = () => setDraft(s => {
    const n = copyAllPrevious(s, allFields.map(f => f.key), state.previous);
    const t: Record<string, FieldTouch> = { ...touch };
    for (const f of allFields) if ((n[f.key] ?? '').trim() !== '') t[f.key] = 'edited';
    setTouch(t);
    const m = calcMap(n.nibpSys, n.nibpDia);
    const typed = (n.nibpMap ?? '').trim();
    const man = typed !== '' && (m == null || typed !== fmt(m, 0));
    setMapManual(man);
    return syncDraftMap(n, man);
  });
  const press = (k: string) => {
    if (!field) return;
    if (k === ',' && !field.allowDecimal) return;
    setRaw(applyKeypad(raw, k, field.allowDecimal), 'edited');
  };
  const switchGas = (g: GasId) => {
    setGas(g);
    onGasChange?.(g);
    setIdx(i => {
      const cur = fields[i];
      if (cur && FIELD_TO_GAS[cur.key]) {
        const nextFields = withGasField(state.fields, g);
        const j = nextFields.findIndex(f => f.key === GAS_FIELD[g]);
        return j >= 0 ? j : i;
      }
      return i;
    });
  };

  const modeVal = modeField ? effectiveFieldValue(draft, 'ventMode', state.previous, touch.ventMode) : '';
  const modeTouch = touch.ventMode ?? 'untouched';
  const modeOptions = modesForPicker(modeField?.enumValues ?? [...DEFAULT_VENT_MODES], modeVal || formatPrevious(state.previous, 'ventMode'));
  const setMode = (v: string, how: FieldTouch) => {
    setTouch(s => ({ ...s, ventMode: how }));
    setDraft(s => ({ ...s, ventMode: v }));
  };

  const allowedVoiceKeys = useMemo(() => allFields.map(f => f.key), [allFields]);
  const applyVoice = (text: string, force = false) => {
    const t = text.trim();
    if (!force && t === lastParsedVoice.current) return;
    lastParsedVoice.current = t;
    if (t === '') { setVoiceParsed(null); setDictItems([]); setDictRest(''); return; }
    const dict = dictation ? parseDictation(t, { drugs: dictation.drugs }) : null;
    if (dict) {
      setDictItems(dict.items); setDictRemoved(new Set()); setDictRest(dict.rest);
      if (!dictPhaseTouched) setDictPhase(defaultPhase(dictation!.c.stage, dict.items));
    }
    const result = parseVoiceInput(dict ? dict.rest : t, { allowedKeys: allowedVoiceKeys, ventModes: modeOptions });
    setVoiceParsed({ values: result.values, unknown: result.unknown });
    const gasHit: GasId | null = result.values.sevoPct != null ? 'sevo' : result.values.isoPct != null ? 'iso' : null;
    if (gasHit && gas !== gasHit) switchGas(gasHit);
    const keys = Object.keys(result.values);
    if (!keys.length) return;
    setDraft(s => {
      let next = { ...s, ...result.values };
      if ('nibpSys' in result.values || 'nibpDia' in result.values || result.mapManual) {
        next = syncDraftMap(next, result.mapManual);
      }
      return next;
    });
    setTouch(s => {
      const next = { ...s };
      for (const k of keys) next[k] = 'edited';
      return next;
    });
    if (result.mapManual) setMapManual(true);
    else if ('nibpSys' in result.values || 'nibpDia' in result.values) setMapManual(false);
    const highlight = new Set(keys);
    if (('nibpSys' in result.values || 'nibpDia' in result.values) && !result.mapManual) highlight.add('nibpMap');
    setVoiceKeys(highlight);
    const jump = fields.findIndex(f => highlight.has(f.key));
    if (jump >= 0) setIdx(jump);
  };

  useEffect(() => {
    if (voiceText.trim() && !dictStarted.current) { dictStarted.current = new Date().toISOString(); setDictAt(dictStarted.current); }
    const id = window.setTimeout(() => applyVoice(voiceText), 700);
    return () => window.clearTimeout(id);
  }, [voiceText]); // пауза после ввода; ключи и режимы берутся из текущего замыкания

  const dictKeep = dictItems.filter((_, k) => !dictRemoved.has(k));
  const saveDict = async () => {
    if (!dictation || dictSaving || dictKeep.length === 0) return;
    setDictSaving(true);
    try { await dictation.save(dictKeep, dictPhase, dictAt); } finally { setDictSaving(false); }
    // события записаны; в строке остаётся только то, что относится к показателям
    setDictItems([]); setDictRemoved(new Set()); dictStarted.current = null; setDictPhaseTouched(false);
    lastParsedVoice.current = dictRest.trim();
    setVoiceText(dictRest);
  };

  const ghost = !!field && fieldTouch === 'untouched' && raw === '' && prevText !== '' && !autoMap;
  const display = field ? (autoMap ? (fmt(calcMap(effSys, effDia) as number, 0) || effective || '—') : (effective || '—')) : '';

  return <Overlay className="ov center qe-ov" onClick={onCancel}>
    <div className="sheet wide qe-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Новая запись">
      <div className="shtitle">
        <div className="ttl">Новая запись {field && <span className="qe-step">{idx + 1}&nbsp;из&nbsp;{fields.length}</span>}</div>
        <TimePicker label="Время" value={at} onChange={setAt} />
      </div>
      {state.mergeNote && <div className="note" style={{ marginBottom: 8 }}>{state.mergeNote}</div>}
      <form className={`qe-voice ${(voiceParsed && (Object.keys(voiceParsed.values).length || voiceParsed.unknown.length)) || dictItems.length ? 'has-result' : ''}`} onSubmit={e => { e.preventDefault(); applyVoice(voiceText, true); }}>
        <label className="qe-voice-lab" htmlFor="qe-voice">Голосом</label>
        <div className="qe-voice-row">
          <input id="qe-voice" type="text" lang="ru" inputMode="text" enterKeyHint="done"
            autoFocus autoComplete="off" autoCorrect="on" autoCapitalize="sentences" spellCheck
            placeholder={VOICE_PLACEHOLDER} value={voiceText}
            onChange={e => setVoiceText(e.target.value)}
            aria-label="Голосом" />
          <button type="submit" className="btn sm sec">Разобрать</button>
        </div>
        <div className="muted small qe-voice-hint">{VOICE_HINT}</div>
        {dictation && dictItems.length > 0 && (
          <div className="qe-voice-review">
            <DictationReview c={dictation.c} items={dictItems} removed={dictRemoved} phase={dictPhase} at={dictAt}
              onPhase={p => { setDictPhase(p); setDictPhaseTouched(true); }}
              onToggle={k => setDictRemoved(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
            <button type="button" className="btn pri dc-save" disabled={dictSaving || dictKeep.length === 0} onClick={() => void saveDict()}>
              Записать в карту ({dictKeep.length})</button>
          </div>
        )}
        {voiceParsed && (Object.keys(voiceParsed.values).length > 0 || voiceParsed.unknown.length > 0) && (
          <div className="qe-voice-review">
            {Object.keys(voiceParsed.values).length > 0 && (
              <div className="qe-voice-hits">
                {allFields.filter(f => voiceParsed.values[f.key] != null).map(f =>
                  <span key={f.key} className="qe-voice-hit">{f.label} {voiceParsed.values[f.key]}{f.unit ? ` ${f.unit}` : ''}</span>)}
              </div>
            )}
            {voiceParsed.unknown.length > 0 && (
              <div className="qe-voice-unk">не понял: {voiceParsed.unknown.join('; ')}</div>
            )}
            <div className="muted small">проверьте и нажмите «Далее» — само не сохраняется</div>
          </div>
        )}
      </form>
      <div className="qe-gas">
        <span className="muted small">Газ</span>
        <div className="seg qe-gas-seg">
          <button type="button" className={gas === 'sevo' ? 'on' : ''} onClick={() => switchGas('sevo')}>Sevo</button>
          <button type="button" className={gas === 'iso' ? 'on' : ''} onClick={() => switchGas('iso')}>Iso</button>
        </div>
      </div>
      {modeField && <div className="qe-mode">
        <span className="muted small">Режим</span>
        <div className="chipbar qe-mode-chips">
          <button type="button" className={`chip ${modeTouch === 'cleared' || (modeTouch === 'edited' && modeVal === '') ? 'on' : ''}`}
            onClick={() => setMode('', 'cleared')}>—</button>
          {modeOptions.map(m =>
            <button key={m} type="button" className={`chip ${modeVal === m && modeTouch !== 'cleared' ? 'on' : ''} ${modeTouch === 'untouched' && modeVal === m ? 'ghost' : ''}`}
              onClick={() => setMode(m, 'edited')}>{m}</button>)}
        </div>
      </div>}
      {needGas && <div className="qe-body">
        <div className="qe-fl">Какой газ</div>
        <div className="muted small qe-hint">На индукции газ не выбран. Достаточно указать один — второй каждый раз спрашивать не будем.</div>
        <div className="qe-enums" style={{ marginTop: 12 }}>
          <button type="button" className="qe-enum" onClick={() => switchGas('sevo')}>Sevo</button>
          <button type="button" className="qe-enum" onClick={() => switchGas('iso')}>Iso</button>
        </div>
      </div>}
      {!needGas && field && <>
        {hasPrev && <div className="qe-all">
          <button type="button" className="btn sm sec" onClick={copyAll}>Все как прошлый</button>
          <span className="muted small">заполнит пустые поля</span>
        </div>}
        <div className="qe-body">
          <div className="qe-fl">{field.label}{field.unit ? ` · ${field.unit}` : ''}{FIELD_TO_GAS[field.key] ? ` · ${GAS_RU[FIELD_TO_GAS[field.key]]}` : ''}</div>
          <div className={`qe-val ${ghost ? 'ghost' : ''} ${!ghost && voiceKeys.has(field.key) ? 'voice' : ''} ${oor && effective ? 'warn' : ''}`} aria-live="polite">
            {display || '—'}
          </div>
          {oor && effective && <div className="lh w qe-hint">вне рамки {field.min ?? '…'}–{field.max ?? '…'}</div>}
          {field.key === 'nibpMap' && autoMap && <div className="muted small qe-hint">считается само из САД и ДАД · можно поправить</div>}
          {field.key === 'nibpMap' && mapManual && <div className="muted small qe-hint">вручную
            {' · '}<button type="button" className="link" onClick={() => { setMapManual(false); setTouch(s => ({ ...s, nibpMap: 'untouched' })); setDraft(s => syncDraftMap({ ...s, nibpMap: '' }, false)); }}>снова автоматически</button>
          </div>}
          {ghost && <div className="muted small qe-hint">прошлое значение · «Далее» сохранит его, «не измерялось» — не переносить</div>}
          {fieldTouch === 'cleared' && <div className="muted small qe-hint">не измерялось · прошлое не переносится</div>}
          {field.kind === 'enum' && field.enumValues
            ? <div className="qe-enums">
                <button type="button" className={`qe-enum ${fieldTouch === 'cleared' || (fieldTouch === 'edited' && raw === '') ? 'on' : ''}`} onClick={() => setRaw('', 'cleared')}>—</button>
                {field.enumValues.map(v =>
                  <button key={v} type="button" className={`qe-enum ${raw === v && fieldTouch !== 'cleared' ? 'on' : ''}`} onClick={() => setRaw(v, 'edited')}>{v}</button>)}
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
          <button type="button" className="btn sec" onClick={clearAndNext}>не измерялось</button>
          <button type="button" className="btn pri" onClick={next}>{last ? 'Готово' : 'Далее →'}</button>
        </div>
      </>}
      <div className="row sheet-actions qe-foot">
        <button type="button" className="btn sec" onClick={onCancel}>Отмена</button>
        <div className="muted small" style={{ flex: 1, textAlign: 'center' }}>{filled ? `заполнено ${filled}` : 'пока ничего не записано'}</div>
        <button type="button" className="btn pri" onClick={commit} disabled={needGas}>Готово</button>
      </div>
    </div>
  </Overlay>;
}

function entryFieldOrderSafe(fields: EntryField[]): EntryField[] {
  // черновик должен знать оба газовых ключа, чтобы смена газа не теряла введённое
  const keys = new Set(fields.map(f => f.key));
  const extra: EntryField[] = [];
  for (const g of ['sevo', 'iso'] as GasId[]) {
    const k = GAS_FIELD[g];
    if (!keys.has(k)) {
      const f = fields.find(x => x.key === k);
      if (!f) extra.push({ key: k, label: GAS_RU[g], unit: '%', kind: 'number', allowDecimal: true, source: 'manual' });
    }
  }
  return [...fields, ...extra];
}
