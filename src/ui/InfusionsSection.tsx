import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CLINIC_SETTINGS_ID, clinicInfusionUnits, db, meta, saveWithAudit, softDelete, uuid,
  type CaseRec, type Drug, type Infusion,
} from '../db/db';
import { fmtTime } from '../core/logic';
import {
  currentRateLabel, formatVolumeMl, infusionCatalogMatches, infusionChangesText, infusionFormDraft,
  infusionVolumeMl, isInfusionRunning, liveInfusions, ML_PER_HOUR, nextInfusionLine, sortedSegments, startedAtOf,
  type InfusionSegment,
} from '../core/infusions';
import { TimePicker, Field } from './pickers';
import type { SaveState } from './App';
import { Overlay } from './overlay';

export function InfusionsSection({ c, onSaved, compact }: { c: CaseRec; onSaved: (s: SaveState) => void; compact?: boolean }) {
  const rows = useLiveQuery(async () => {
    const all = await db.infusions.where('caseId').equals(c.id).toArray();
    return liveInfusions(all);
  }, [c.id]) ?? [];
  const drugs = useLiveQuery(() => db.drugs.filter(d => !d.deletedAt && d.isActive).sortBy('name'), []) ?? [];
  const clinic = useLiveQuery(() => db.clinicSettings.get(CLINIC_SETTINGS_ID), []);
  const units = clinicInfusionUnits(clinic);
  const [edit, setEdit] = useState<'new' | Infusion | null>(null);
  const [rateOf, setRateOf] = useState<Infusion | null>(null);
  const [stopOf, setStopOf] = useState<Infusion | null>(null);
  const persist = async (row: Infusion, reason?: string) => {
    onSaved('saving');
    await saveWithAudit(db.infusions, 'Infusion', row, { caseId: c.id, reason: reason ?? null });
    onSaved('saved');
  };
  const end = c.anesthesiaEndAt ? new Date(c.anesthesiaEndAt) : new Date();

  return <>
    <section className="card">
      <div className="h">Инфузии
        <button type="button" className="link" onClick={() => setEdit('new')}>+ Инфузия</button></div>
      {rows.length === 0 && <div className="muted small">Раствор или препарат, скорость, время начала и окончания. Единицы скорости задаются в Настройках, дозы не подставляются.</div>}
      <div className="g" style={{ gap: 8 }}>
        {rows.map(inf => {
          const running = isInfusionRunning(inf);
          const start = startedAtOf(inf);
          const vol = infusionVolumeMl(inf, end);
          return <div key={inf.id} className={`inf-row ${running ? 'on' : ''}`}>
            <div className="inf-main">
              <b>{inf.solutionName || 'Без названия'}</b>
              <span className="inf-rate">{currentRateLabel(inf)}</span>
            </div>
            <div className="muted small">
              {start ? `с ${fmtTime(new Date(start))}` : 'нет начала'}
              {inf.endedAt ? ` · до ${fmtTime(new Date(inf.endedAt))}` : running ? ' · идёт' : ''}
              {vol != null ? ` · ${formatVolumeMl(vol)} мл` : ''}
            </div>
            {!compact && inf.segments.length > 1 && <div className="muted small">{infusionChangesText(inf, iso => fmtTime(new Date(iso)))}</div>}
            <div className="row inf-actions">
              <button type="button" className="btn sm sec" onClick={() => setEdit(inf)}>Изменить</button>
              {running && <button type="button" className="btn sm sec" onClick={() => setRateOf(inf)}>Скорость</button>}
              {running && <button type="button" className="btn sm sec" onClick={() => setStopOf(inf)}>Остановить</button>}
              {!running && <button type="button" className="btn sm sec" onClick={() => setRateOf(inf)}>Продолжить</button>}
              <button type="button" className="x" aria-label="Удалить" onClick={() => {
                if (confirm(`Убрать инфузию «${inf.solutionName}» из карты?`)) {
                  onSaved('saving');
                  void softDelete(db.infusions, 'Infusion', inf.id).then(() => onSaved('saved'));
                }
              }}>✕</button>
            </div>
          </div>;
        })}
      </div>
    </section>
    {edit && <InfusionSheet
      key={edit === 'new' ? 'new' : edit.id}
      caseId={c.id}
      draft={edit === 'new' ? null : edit}
      drugs={drugs}
      units={units}
      defaultLine={nextInfusionLine(rows)}
      onCancel={() => setEdit(null)}
      onSave={async row => { await persist(row, edit === 'new' ? 'новая инфузия' : 'правка инфузии'); setEdit(null); }}
    />}
    {rateOf && <RateSheet
      inf={rateOf}
      units={units}
      onCancel={() => setRateOf(null)}
      onSave={async row => { await persist(row, 'изменение скорости'); setRateOf(null); }}
    />}
    {stopOf && <StopSheet
      inf={stopOf}
      onCancel={() => setStopOf(null)}
      onSave={async row => { await persist(row, 'остановка инфузии'); setStopOf(null); }}
    />}
  </>;
}

function InfusionSheet({ caseId, draft, drugs, units, defaultLine, onCancel, onSave }: {
  caseId: string; draft: Infusion | null; drugs: Drug[]; units: string[]; defaultLine: number;
  onCancel: () => void; onSave: (row: Infusion) => void;
}) {
  const first = draft ? sortedSegments(draft)[0] : undefined;
  const initial = infusionFormDraft(draft);
  const [name, setName] = useState(initial.name);
  const [drugId, setDrugId] = useState<string | null>(initial.drugId);
  const [rate, setRate] = useState(first?.rate ?? '');
  const [unit, setUnit] = useState(first?.rateUnit || units[0] || ML_PER_HOUR);
  const [from, setFrom] = useState(first?.from ?? new Date().toISOString());
  const [note, setNote] = useState(draft?.note ?? '');
  const [q, setQ] = useState('');
  const filtered = infusionCatalogMatches(drugs, q);
  const pick = (d: Drug) => { setName(d.name); setDrugId(d.id); setQ(''); };
  const commit = () => {
    const n = name.trim() || q.trim();
    if (!n) return;
    const seg: InfusionSegment = first
      ? { ...first, from, rate: rate.trim(), rateUnit: unit }
      : { id: uuid(), from, rate: rate.trim(), rateUnit: unit };
    const segments = draft ? [seg, ...sortedSegments(draft).slice(1)] : [seg];
    const rec: Infusion = draft
      ? { ...draft, solutionName: n, drugId, segments, note }
      : { ...meta(), caseId, line: defaultLine, solutionName: n, drugId, segments, note };
    onSave(rec);
  };
  return <Overlay className="ov center" onClick={onCancel}>
    <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Инфузия">
      <div className="grab" /><div className="sh">{draft ? 'Инфузия' : 'Новая инфузия'}</div>
      <div className="g" style={{ gap: 10 }}>
        <Field label="Препарат или раствор" value={name} name="infusion-solution-name" onChange={v => { setName(v); setDrugId(null); }} placeholder="название" />
        <label className="field"><span className="fl">Из справочника</span>
          <input value={q} placeholder="поиск" name="infusion-catalog-search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} onChange={e => setQ(e.target.value)} /></label>
        {filtered.length > 0 && <div className="chipbar">
          {filtered.slice(0, 12).map(d =>
            <button key={d.id} type="button" className={`chip ${drugId === d.id ? 'on' : ''}`} onClick={() => pick(d)}>{d.name}</button>)}
        </div>}
        <div className="g g2">
          <Field label="Скорость" value={rate} onChange={setRate} num />
          <TimePicker label="Начало" value={from} onChange={setFrom} />
        </div>
        <div className="chipbar">
          {units.map(u => <button key={u} type="button" className={`chip ${unit === u ? 'on' : ''}`} onClick={() => setUnit(u)}>{u}</button>)}
        </div>
        <Field label="Заметка" value={note} onChange={setNote} placeholder="по желанию" />
      </div>
      <div className="row sheet-actions">
        <button type="button" className="btn sec" onClick={onCancel}>Отмена</button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn pri" disabled={!name.trim() && !q.trim()} onClick={commit}>Сохранить</button>
      </div>
    </div>
  </Overlay>;
}

function RateSheet({ inf, units, onCancel, onSave }: {
  inf: Infusion; units: string[]; onCancel: () => void; onSave: (row: Infusion) => void;
}) {
  const segs = sortedSegments(inf); const cur = segs[segs.length - 1];
  const [rate, setRate] = useState('');
  const [unit, setUnit] = useState(cur?.rateUnit || units[0] || ML_PER_HOUR);
  const [at, setAt] = useState(new Date().toISOString());
  const commit = () => {
    const seg: InfusionSegment = { id: uuid(), from: at, rate: rate.trim(), rateUnit: unit };
    const endedAt = inf.endedAt && inf.endedAt <= at ? null : inf.endedAt;
    onSave({ ...inf, endedAt, segments: [...(inf.segments ?? []), seg] });
  };
  return <Overlay className="ov center" onClick={onCancel}>
    <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Скорость инфузии">
      <div className="grab" /><div className="sh">Скорость · {inf.solutionName}</div>
      <div className="muted small" style={{ marginBottom: 10 }}>Сейчас: {currentRateLabel(inf)}. Новая скорость начнётся с указанного времени.</div>
      <div className="g g2">
        <Field label="Новая скорость" value={rate} onChange={setRate} num />
        <TimePicker label="С времени" value={at} onChange={setAt} />
      </div>
      <div className="chipbar" style={{ marginTop: 10 }}>
        {units.map(u => <button key={u} type="button" className={`chip ${unit === u ? 'on' : ''}`} onClick={() => setUnit(u)}>{u}</button>)}
      </div>
      <div className="row sheet-actions">
        <button type="button" className="btn sec" onClick={onCancel}>Отмена</button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn pri" disabled={!rate.trim()} onClick={commit}>Записать</button>
      </div>
    </div>
  </Overlay>;
}

function StopSheet({ inf, onCancel, onSave }: {
  inf: Infusion; onCancel: () => void; onSave: (row: Infusion) => void;
}) {
  const [at, setAt] = useState(new Date().toISOString());
  return <Overlay className="ov center" onClick={onCancel}>
    <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Остановить инфузию">
      <div className="grab" /><div className="sh">Остановить · {inf.solutionName}</div>
      <TimePicker label="Окончание" value={at} onChange={setAt} />
      <div className="row sheet-actions">
        <button type="button" className="btn sec" onClick={onCancel}>Отмена</button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn pri" onClick={() => onSave({ ...inf, endedAt: at })}>Остановить</button>
      </div>
    </div>
  </Overlay>;
}
