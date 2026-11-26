import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CaseRec, type DrugPhase } from '../db/db';
import { parseDictation, type DictItem } from '../core/dictation';
import { defaultPhase } from '../core/dictationApply';
import { parseVoiceInput } from '../core/voiceParse';
import { DEFAULT_ENTRY_KEYS, entryFieldOrder } from '../core/quickEntry';
import { DEFAULT_VENT_MODES } from '../core/ventModes';
import { DictationReview } from './DictationReview';
import { saveDictation } from './dictationSave';
import type { SaveState } from './App';
import { Overlay } from './overlay';

export const DICTATION_HINT = 'Нажмите 🎤 на клавиатуре и говорите по ходу: «на столе Барсик, семь лет, поступил на удаление новообразования, ввёл цефтриаксон, дал золетил, интубировал трубкой 6.0, пульс 120»';
export const DICTATION_PLACEHOLDER = 'на столе Барсик, 7 лет, ввёл цефтриаксон, интубировал трубкой 6.0';

/** Открывается кнопкой 🎤 в верхней панели на любом этапе: кличка, возраст, операция, препараты, интубация, показатели. */
export function DictationSheet({ c, onClose, onSaved }: { c: CaseRec; onClose: () => void; onSaved: (s: SaveState) => void }) {
  const formulary = useLiveQuery(() => db.drugs.filter(d => !d.deletedAt && d.isActive).toArray(), []) ?? [];
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ items: DictItem[]; values: Record<string, string>; unknown: string[]; mapManual: boolean } | null>(null);
  const [removed, setRemoved] = useState<Set<number>>(() => new Set());
  const [phase, setPhase] = useState<DrugPhase>('maintenance');
  const [phaseTouched, setPhaseTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const startedAt = useRef<string | null>(null);
  const [at, setAt] = useState(() => new Date().toISOString());
  const last = useRef('');
  const labels = useMemo(() => entryFieldOrder({ monitorFieldKeys: null, machineFieldKeys: null, gas: 'both', ventModes: [...DEFAULT_VENT_MODES] }), []);

  const parse = (raw: string, force = false) => {
    const t = raw.trim();
    if (!force && t === last.current) return;
    last.current = t;
    if (!t) { setParsed(null); setRemoved(new Set()); return; }
    const d = parseDictation(t, { drugs: formulary.map(f => ({ id: f.id, name: f.name, genericName: f.genericName })) });
    const v = parseVoiceInput(d.rest, { allowedKeys: DEFAULT_ENTRY_KEYS, ventModes: [...DEFAULT_VENT_MODES] });
    setParsed({ items: d.items, values: v.values, unknown: v.unknown, mapManual: v.mapManual });
    setRemoved(new Set());
    if (!phaseTouched) setPhase(defaultPhase(c.stage, d.items));
  };
  useEffect(() => {
    if (text.trim() && !startedAt.current) { startedAt.current = new Date().toISOString(); setAt(startedAt.current); }
    const id = window.setTimeout(() => parse(text), 700);
    return () => window.clearTimeout(id);
  }, [text, formulary.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const keep = parsed ? parsed.items.filter((_, k) => !removed.has(k)) : [];
  const vitalKeys = parsed ? Object.keys(parsed.values) : [];
  const nothing = !parsed || (parsed.items.length === 0 && vitalKeys.length === 0);

  const save = async () => {
    if (!parsed || saving) return;
    setSaving(true); onSaved('saving');
    try {
      await saveDictation({ c, items: keep, at, phase, vitals: vitalKeys.length ? { values: parsed.values, mapManual: parsed.mapManual } : undefined });
    } finally { onSaved('saved'); setSaving(false); }
    onClose();
  };

  return <Overlay className="ov center qe-ov" onClick={onClose}>
    <div className="sheet wide dc-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Диктовка">
      <div className="shtitle"><div className="ttl">Диктовка</div></div>
      <form className={`qe-voice ${parsed ? 'has-result' : ''}`} onSubmit={e => { e.preventDefault(); parse(text, true); }}>
        <label className="qe-voice-lab" htmlFor="dc-text">Голосом</label>
        <div className="qe-voice-row">
          <input id="dc-text" type="text" lang="ru" inputMode="text" enterKeyHint="done" autoFocus autoComplete="off" autoCorrect="on"
            autoCapitalize="sentences" spellCheck placeholder={DICTATION_PLACEHOLDER} value={text}
            onChange={e => setText(e.target.value)} aria-label="Голосом" />
          <button type="submit" className="btn sm sec">Разобрать</button>
        </div>
        <div className="muted small qe-voice-hint">{DICTATION_HINT}</div>
      </form>
      <div className="sheet-body dc-body">
        {parsed && !nothing && <div className="qe-voice-review">
          {parsed.items.length > 0 && <DictationReview c={c} items={parsed.items} removed={removed} phase={phase} at={at}
            onPhase={p => { setPhase(p); setPhaseTouched(true); }}
            onToggle={k => setRemoved(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />}
          {vitalKeys.length > 0 && <div className="qe-voice-hits">
            {labels.filter(f => parsed.values[f.key] != null).map(f =>
              <span key={f.key} className="qe-voice-hit">{f.label} {parsed.values[f.key]}{f.unit ? ` ${f.unit}` : ''}</span>)}
          </div>}
        </div>}
        {parsed && parsed.unknown.length > 0 && <div className="qe-voice-unk">не понял: {parsed.unknown.join('; ')}</div>}
        {parsed && nothing && parsed.unknown.length === 0 && <div className="muted small">Ничего не распознано.</div>}
      </div>
      <div className="sheet-actions dc-actions">
        <span className="muted small dc-note">{parsed && !nothing ? 'Само не сохраняется — проверьте и нажмите «Записать»' : ''}</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn sec" onClick={onClose}>Отмена</button>
        <button type="button" className="btn pri" disabled={saving || nothing || (keep.length === 0 && vitalKeys.length === 0)} onClick={() => void save()}>
          Записать{keep.length + vitalKeys.length > 0 ? ` (${keep.length + vitalKeys.length})` : ''}</button>
      </div>
    </div>
  </Overlay>;
}
