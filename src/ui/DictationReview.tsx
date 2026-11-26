import type { DrugPhase, CaseRec } from '../db/db';
import { itemFlags, itemTitle, type DictItem } from '../core/dictation';
import { casePatchFor } from '../core/dictationApply';
import { fmtTime } from '../core/logic';

const PHASES: { key: DrugPhase; ru: string }[] = [
  { key: 'premed', ru: 'Премед' }, { key: 'induction', ru: 'Индукция' }, { key: 'maintenance', ru: 'Поддерж.' }, { key: 'recovery', ru: 'Пробужд.' }];

/** Предпросмотр распознанного: голубым — что запишется, оранжевым — на что обратить внимание. Ничего не сохраняет. */
export function DictationReview({ c, items, removed, onToggle, phase, onPhase, at }: {
  c: CaseRec; items: DictItem[]; removed: Set<number>; onToggle: (idx: number) => void;
  phase: DrugPhase; onPhase: (p: DrugPhase) => void; at: string;
}) {
  const { replaces } = casePatchFor(c, items, at);
  const hasDrug = items.some((i, k) => i.kind === 'drug' && !removed.has(k));
  return <div className="dc-review">
    <div className="dc-time muted small">В карту — время {fmtTime(new Date(at))}</div>
    <div className="dc-items">
      {items.map((it, k) => {
        const off = removed.has(k);
        const flags = itemFlags(it);
        return <div key={k} className={`dc-item ${off ? 'off' : ''}`}>
          <div className="dc-main">
            <span className="qe-voice-hit dc-hit">{itemTitle(it)}</span>
            {!off && flags.map(f => <span key={f} className={`tag dc-flag ${f.startsWith('доза') ? 'o' : ''}`}>{f}</span>)}
            {!off && replaces[k] != null && <span className="tag o dc-flag">заменит: {replaces[k]}</span>}
          </div>
          <button type="button" className="dc-x" aria-label={off ? 'Вернуть' : 'Убрать'} onClick={() => onToggle(k)}>{off ? '↺' : '✕'}</button>
        </div>;
      })}
    </div>
    {hasDrug && <div className="dc-phase"><span className="muted small">Препараты — этап</span>
      <div className="seg dc-seg">{PHASES.map(p => <button key={p.key} type="button" className={phase === p.key ? 'on' : ''} onClick={() => onPhase(p.key)}>{p.ru}</button>)}</div></div>}
  </div>;
}
