import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CLINIC_SETTINGS_ID, clinicBlockNames, clinicLocalAnesthetics, db, meta, saveWithAudit, softDelete,
  type CaseRec, type Drug, type DrugAdmin, type DrugPhase, type RegionalAnestheticLine, type RegionalBlock,
} from '../db/db';
import { canAddCatalogItem, fmtTime } from '../core/logic';
import {
  BLOCK_GUIDANCE_RU, BLOCK_SIDE_RU, formatAnestheticLine, guidanceLabel, liveBlocks,
  localAnestheticMg, mgPerKg, formatMg, formatMgKg, overMaxWarnings, sideLabel,
  anestheticSourcesFromAdmins, anestheticSourcesFromBlocks, type BlockGuidance, type BlockSide,
} from '../core/regional';
import { applyKeypad } from '../core/quickEntry';
import { TimePicker, Field } from './pickers';
import type { SaveState } from './App';
import { requestTimerStart } from './timerStart';
import { parseIntervalMin } from '../core/timers';
import { Overlay } from './overlay';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'] as const;
const EMPTY_LINE = (): RegionalAnestheticLine => ({ name: '', concentrationPct: '', volumeMl: '' });

export function RegionalSection({ c, onSaved, compact, phase }: {
  c: CaseRec; onSaved: (s: SaveState) => void; compact?: boolean; phase: Extract<DrugPhase, 'induction' | 'maintenance' | 'recovery'>;
}) {
  const rows = useLiveQuery(async () => liveBlocks(await db.regionalBlocks.where('caseId').equals(c.id).toArray()), [c.id]) ?? [];
  const clinic = useLiveQuery(() => db.clinicSettings.get(CLINIC_SETTINGS_ID), []);
  const drugs = useLiveQuery(() => db.drugs.filter(d => !d.deletedAt).toArray(), []) ?? [];
  const admins = useLiveQuery(async () => (await db.drugAdmins.where('caseId').equals(c.id).toArray()).filter(a => !a.deletedAt), [c.id]) ?? [];
  const catalog = clinicLocalAnesthetics(clinic);
  const names = clinicBlockNames(clinic);
  const [edit, setEdit] = useState<'new' | RegionalBlock | null>(null);
  const sources = useMemo(() => [
    ...anestheticSourcesFromBlocks(rows, c.weightKg),
    ...anestheticSourcesFromAdmins(admins),
  ], [rows, admins, c.weightKg]);
  const warnNames = useMemo(() => {
    const n: string[] = [];
    for (const b of rows) for (const a of b.anesthetics ?? []) if (a.name) n.push(a.name);
    return n;
  }, [rows]);
  const warns = overMaxWarnings(warnNames, sources, catalog, drugs);
  const persist = async (row: RegionalBlock) => {
    onSaved('saving');
    await saveWithAudit(db.regionalBlocks, 'RegionalBlock', row, { caseId: c.id });
    onSaved('saved');
  };

  return <>
    <section className="card">
      <div className="h">Регионарная анестезия
        <button type="button" className="link" onClick={() => setEdit('new')}>+ Блокада</button></div>
      {rows.length === 0 && <div className="muted small">Какая блокада сделана, местный анестетик, объём и способ наведения. Названия блокад задаются в Настройках или вводятся здесь.</div>}
      <div className="g" style={{ gap: 8 }}>
        {rows.map(b => (
          <div key={b.id} className="inf-row">
            <div className="inf-main">
              <b>{b.blockName || 'Без названия'}</b>
              <span className="inf-rate">{fmtTime(new Date(b.at))}{b.side ? ` · ${sideLabel(b.side)}` : ''}</span>
            </div>
            {(b.anesthetics ?? []).filter(a => a.name || a.volumeMl || a.concentrationPct).map((a, i) =>
              <div key={i} className="muted small">{formatAnestheticLine(a, c.weightKg)}</div>)}
            {!compact && (b.adjuvant || b.guidance || b.note) && (
              <div className="muted small">
                {[b.guidance ? guidanceLabel(b.guidance) : '', b.adjuvant ? `адъювант: ${b.adjuvant}` : '', b.note].filter(Boolean).join(' · ')}
              </div>
            )}
            <div className="row inf-actions">
              <button type="button" className="btn sm sec" onClick={() => setEdit(b)}>Изменить</button>
              <button type="button" className="btn sm sec" onClick={() => requestTimerStart({ type: 'block', block: b, intervalMin: parseIntervalMin(clinic?.blockCheckMin) })}>⏱</button>
              <button type="button" className="x" aria-label="Удалить" onClick={() => {
                if (confirm(`Убрать блокаду «${b.blockName || 'без названия'}» из карты?`)) {
                  onSaved('saving');
                  void softDelete(db.regionalBlocks, 'RegionalBlock', b.id).then(() => onSaved('saved'));
                }
              }}>✕</button>
            </div>
          </div>
        ))}
      </div>
      {warns.length > 0 && <div className="lh w" style={{ marginTop: 10 }}>{warns.join(' · ')}</div>}
    </section>
    {edit && <BlockSheet
      c={c} phase={phase}
      draft={edit === 'new' ? null : edit}
      names={names} catalog={catalog} drugs={drugs} admins={admins} others={rows}
      onCancel={() => setEdit(null)}
      onSave={async (row, extra) => {
        await persist(row);
        if (extra.blockName) await addCatalogName('block', extra.blockName);
        for (const n of extra.anesthetics) await addCatalogName('anest', n);
        setEdit(null);
      }}
    />}
  </>;
}

async function addCatalogName(kind: 'block' | 'anest', raw: string) {
  const cs = await db.clinicSettings.get(CLINIC_SETTINGS_ID);
  if (!cs) return;
  if (kind === 'block') {
    const list = clinicBlockNames(cs);
    const check = canAddCatalogItem(raw, list.map((name, i) => ({ id: String(i), name })));
    if (check.ok) await saveWithAudit(db.clinicSettings, 'ClinicSettings', { ...cs, blockNames: [...list, check.name] });
  } else {
    const list = clinicLocalAnesthetics(cs);
    const check = canAddCatalogItem(raw, list.map((x, i) => ({ id: String(i), name: x.name })));
    if (check.ok) await saveWithAudit(db.clinicSettings, 'ClinicSettings', {
      ...cs, localAnesthetics: [...list, { name: check.name, maxMgKg: null }],
    });
  }
}

function BlockSheet({ c, draft, phase, names, catalog, drugs, admins, others, onCancel, onSave }: {
  c: CaseRec; draft: RegionalBlock | null; phase: Extract<DrugPhase, 'induction' | 'maintenance' | 'recovery'>;
  names: string[]; catalog: { name: string; maxMgKg?: number | null }[]; drugs: Drug[]; admins: DrugAdmin[];
  others: RegionalBlock[];
  onCancel: () => void;
  onSave: (row: RegionalBlock, extra: { blockName?: string; anesthetics: string[] }) => void;
}) {
  const [blockName, setBlockName] = useState(draft?.blockName ?? '');
  const [side, setSide] = useState<BlockSide>(draft?.side ?? '');
  const [lines, setLines] = useState<RegionalAnestheticLine[]>(
    draft?.anesthetics?.length ? draft.anesthetics.map(a => ({ ...a })) : [EMPTY_LINE()],
  );
  const [adjuvant, setAdjuvant] = useState(draft?.adjuvant ?? '');
  const [guidance, setGuidance] = useState<BlockGuidance>(draft?.guidance ?? '');
  const [at, setAt] = useState(draft?.at ?? new Date().toISOString());
  const [note, setNote] = useState(draft?.note ?? '');
  const [pad, setPad] = useState<{ i: number; field: 'concentrationPct' | 'volumeMl' } | null>(null);
  const [nameQ, setNameQ] = useState('');

  const setLine = (i: number, p: Partial<RegionalAnestheticLine>) =>
    setLines(xs => xs.map((x, j) => j === i ? { ...x, ...p } : x));

  const preview = others.map(b => b.id === draft?.id
    ? { ...b, anesthetics: lines, deletedAt: null }
    : b);
  if (!draft) preview.push({ anesthetics: lines } as RegionalBlock);
  const sources = [
    ...anestheticSourcesFromBlocks(preview, c.weightKg),
    ...anestheticSourcesFromAdmins(admins),
  ];
  const warns = overMaxWarnings(lines.map(l => l.name), sources, catalog, drugs);
  const canSave = blockName.trim() !== '' || lines.some(l => l.name.trim());

  const commit = () => {
    if (!canSave) return;
    const anesthetics = lines
      .map(l => ({ name: l.name.trim(), drugId: l.drugId ?? null, concentrationPct: l.concentrationPct.trim(), volumeMl: l.volumeMl.trim() }))
      .filter(l => l.name || l.concentrationPct || l.volumeMl);
    const rec: RegionalBlock = draft
      ? { ...draft, blockName: blockName.trim(), side, anesthetics, adjuvant: adjuvant.trim(), guidance, at, note: note.trim(), phase }
      : { ...meta(), caseId: c.id, at, phase, blockName: blockName.trim(), side, anesthetics, adjuvant: adjuvant.trim(), guidance, note: note.trim() };
    const newAnest = anesthetics.map(a => a.name).filter(n => n && !catalog.some(x => x.name.toLowerCase() === n.toLowerCase()));
    const newBlock = blockName.trim() && !names.some(n => n.toLowerCase() === blockName.trim().toLowerCase()) ? blockName.trim() : undefined;
    onSave(rec, { blockName: newBlock, anesthetics: newAnest });
  };

  const filteredNames = names.filter(n => !nameQ.trim() || n.toLowerCase().includes(nameQ.trim().toLowerCase()));
  const showAddName = nameQ.trim() && canAddCatalogItem(nameQ, names.map((n, i) => ({ id: String(i), name: n }))).ok;

  return <Overlay className="ov center" onClick={onCancel}>
    <div className="sheet wide" onClick={e => e.stopPropagation()} role="dialog" aria-label="Регионарная анестезия">
      <div className="grab" /><div className="sh">{draft ? 'Блокада' : 'Новая блокада'}</div>
      <div className="sheet-body g" style={{ gap: 10 }}>
        <Field label="Название блокады" value={blockName} onChange={v => { setBlockName(v); setNameQ(v); }} placeholder="введите или выберите" />
        {(names.length > 0 || nameQ) && <div className="chipbar">
          {filteredNames.map(n =>
            <button key={n} type="button" className={`chip ${blockName === n ? 'on' : ''}`} onClick={() => { setBlockName(n); setNameQ(''); }}>{n}</button>)}
          {showAddName && <button type="button" className="chip" onClick={() => { setBlockName(nameQ.trim()); setNameQ(''); }}>+ в справочник «{nameQ.trim()}»</button>}
        </div>}
        {names.length === 0 && !nameQ && <div className="muted small">Справочник названий пока пуст — введите название вручную, оно попадёт в Настройки.</div>}
        <div>
          <div className="fl" style={{ marginBottom: 6 }}>Сторона</div>
          <div className="chipbar">{BLOCK_SIDE_RU.map(s =>
            <button key={s.v || 'none'} type="button" className={`chip ${side === s.v ? 'on' : ''}`} onClick={() => setSide(s.v)}>{s.ru}</button>)}</div>
        </div>
        {lines.map((line, i) => {
          const mg = localAnestheticMg(line.concentrationPct, line.volumeMl);
          const per = mgPerKg(mg, c.weightKg);
          return <div key={i} className="reg-anest">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="fl">{lines.length > 1 ? `Анестетик ${i + 1}` : 'Местный анестетик'}</div>
              {lines.length > 1 && <button type="button" className="link" onClick={() => { setLines(xs => xs.filter((_, j) => j !== i)); setPad(null); }}>убрать</button>}
            </div>
            <Field label="Препарат" value={line.name} onChange={v => setLine(i, { name: v, drugId: null })} placeholder="бупивакаин, лидокаин…" />
            <div className="chipbar">
              {catalog.map(a =>
                <button key={a.name} type="button" className={`chip ${line.name === a.name ? 'on' : ''}`} onClick={() => setLine(i, { name: a.name })}>{a.name}</button>)}
            </div>
            <div className="g g2">
              <NumPadField label="Концентрация, %" value={line.concentrationPct} active={pad?.i === i && pad.field === 'concentrationPct'}
                onFocus={() => setPad({ i, field: 'concentrationPct' })} />
              <NumPadField label="Объём, мл" value={line.volumeMl} active={pad?.i === i && pad.field === 'volumeMl'}
                onFocus={() => setPad({ i, field: 'volumeMl' })} />
            </div>
            <div className="muted small">{mg != null ? `${formatMg(mg)}${per != null ? ` · ${formatMgKg(per)}` : c.weightKg ? '' : ' · вес не указан'}` : 'мг посчитаются из % и мл'}</div>
          </div>;
        })}
        {lines.length < 2 && <button type="button" className="btn sm sec" onClick={() => setLines(xs => [...xs, EMPTY_LINE()])}>+ Второй анестетик (смесь)</button>}
        <Field label="Адъювант" value={adjuvant} onChange={setAdjuvant} placeholder="по желанию" />
        <div>
          <div className="fl" style={{ marginBottom: 6 }}>Способ наведения</div>
          <div className="chipbar">{BLOCK_GUIDANCE_RU.map(s =>
            <button key={s.v} type="button" className={`chip ${guidance === s.v ? 'on' : ''}`} onClick={() => setGuidance(guidance === s.v ? '' : s.v)}>{s.ru}</button>)}</div>
        </div>
        <TimePicker label="Время" value={at} onChange={setAt} />
        <Field label="Примечание" value={note} onChange={setNote} placeholder="по желанию" />
        {warns.length > 0 && <div className="lh w">{warns.join(' · ')}</div>}
      </div>
      {pad && <div className="qe-keys reg-keys">
        {KEYS.map(k =>
          <button key={k} type="button" className={`qe-key ${k === '⌫' ? 'back' : ''}`}
            onClick={() => setLine(pad.i, { [pad.field]: applyKeypad(lines[pad.i][pad.field], k, true) })}>{k}</button>)}
      </div>}
      <div className="row sheet-actions">
        <button type="button" className="btn sec" onClick={onCancel}>Отмена</button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn pri" disabled={!canSave} onClick={commit}>Сохранить</button>
      </div>
    </div>
  </Overlay>;
}

function NumPadField({ label, value, active, onFocus }: { label: string; value: string; active: boolean; onFocus: () => void }) {
  return <button type="button" className={`field reg-num ${active ? 'on' : ''}`} onClick={e => {
    const el = e.currentTarget;
    onFocus();
    requestAnimationFrame(() => el?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }}>
    <span className="fl">{label}</span>
    <span className="reg-num-v">{value || '—'}</span>
  </button>;
}
