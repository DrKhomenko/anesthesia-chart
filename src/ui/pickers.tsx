import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { canAddCatalogItem, checkLimit, dosePresets, fmt, fmtTime, generateTimeList, parseNum, parseTimeInput, type DoseUnit, type ExamLabLimit, type ExamLabParam, type Species } from '../core/logic';

const NUM = { inputMode: 'decimal' as const, autoComplete: 'off' as const };

export function TimePicker({ label, value, onChange, cls = '' }: { label?: string; value: string | null | undefined; onChange: (iso: string) => void; cls?: string }) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState('');
  const now = new Date();
  const selected = value ? new Date(value) : null;
  const list = useMemo(() => generateTimeList(now, { selected: selected ?? undefined }), [open]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setManual(selected ? fmtTime(selected) : '');
    const id = window.setTimeout(() => {
      const el = listRef.current?.querySelector<HTMLElement>('.on') ?? listRef.current?.querySelector<HTMLElement>('[data-now]');
      el?.scrollIntoView({ block: 'center' });
    }, 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', onKey);
    return () => { clearTimeout(id); removeEventListener('keydown', onKey); };
  }, [open]);
  const pick = (d: Date) => { onChange(d.toISOString()); setOpen(false); };
  const applyManual = () => {
    const d = parseTimeInput(manual, selected ?? now);
    if (d) pick(d);
  };
  const display = selected ? fmtTime(selected) : '—';
  return <>
    <button type="button" className={`field tpbtn ${cls}`} onClick={() => setOpen(true)}>
      {label && <span className="fl">{label}</span>}
      <span className="tpval">{display}</span>
    </button>
    {open && <div className="ov" onClick={() => setOpen(false)} role="presentation">
      <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={label ?? 'Время'}>
        <div className="grab" />
        <div className="sh">{label ?? 'Время'}</div>
        <button className="btn pri" style={{ width: '100%', marginBottom: 12 }} onClick={() => pick(new Date())}>Сейчас · {fmtTime(now)}</button>
        <div className="timelist" ref={listRef}>
          {list.map(s => {
            const on = selected ? fmtTime(selected) === s.label : !!s.isNow;
            return <button key={s.date.getTime()} data-now={s.isNow || undefined} className={on ? 'on' : ''} onClick={() => pick(s.date)}>
              {s.label}{s.isNow ? <span className="muted small"> · сейчас</span> : null}
            </button>;
          })}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field" style={{ flex: 1 }}><span className="fl">Вручную, чч:мм</span>
            <input value={manual} inputMode="numeric" placeholder="14:05" onChange={e => setManual(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyManual(); }} /></label>
          <button className="btn sm sec" onClick={applyManual} disabled={!parseTimeInput(manual, now)}>ОК</button>
        </div>
      </div>
    </div>}
  </>;
}

export function DosePicker({ label, value, unit, onChange, onUnit, min, max, recent }: {
  label?: string; value: string; unit: DoseUnit; onChange: (v: string) => void; onUnit?: (u: DoseUnit) => void;
  min?: number | null; max?: number | null; recent?: number[];
}) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(value);
  const presets = useMemo(() => dosePresets({ min, max, recent }), [min, max, (recent ?? []).join(',')]);
  const unitRu = unit === 'mcg/kg' ? 'мкг/кг' : 'мг/кг';
  useEffect(() => { if (open) setManual(value); }, [open, value]);
  const apply = (v: string) => { onChange(v); setOpen(false); };
  const n = parseNum(manual);
  return <>
    <button type="button" className="field tpbtn" onClick={() => setOpen(true)}>
      {label && <span className="fl">{label}</span>}
      <span className="tpval">{value ? `${value} ${unitRu}` : '—'}</span>
    </button>
    {open && <div className="ov" onClick={() => setOpen(false)} role="presentation">
      <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={label ?? 'Доза'}>
        <div className="grab" />
        <div className="sh">{label ?? 'Доза'}</div>
        {onUnit && <div className="seg" style={{ marginBottom: 12 }}>
          <button className={unit === 'mg/kg' ? 'on' : ''} onClick={() => onUnit('mg/kg')}>мг/кг</button>
          <button className={unit === 'mcg/kg' ? 'on' : ''} onClick={() => onUnit('mcg/kg')}>мкг/кг</button>
        </div>}
        <div className="timelist">
          {presets.length === 0 && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>Нет предустановок — введите дозу вручную. Рамки дозы можно задать в справочнике.</div>}
          {presets.map(p => {
            const s = fmt(p, 4);
            const on = value.replace('.', ',') === s || parseNum(value) === p;
            return <button key={p} className={on ? 'on' : ''} onClick={() => apply(s)}>{s} <span className="muted small">{unitRu}</span></button>;
          })}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field" style={{ flex: 1 }}><span className="fl">Своё значение, {unitRu}</span>
            <input value={manual} {...NUM} placeholder="число" onChange={e => setManual(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && Number.isFinite(n) && n > 0) apply(manual.trim()); }} /></label>
          <button className="btn sm pri" disabled={!(Number.isFinite(n) && n > 0)} onClick={() => apply(manual.trim())}>ОК</button>
        </div>
      </div>
    </div>}
  </>;
}

export function CatalogPick({ label, value, onChange, items, onAdd, placeholder, cls = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  items: { id: string; name: string }[]; onAdd?: (name: string) => void | Promise<void>;
  placeholder?: string; cls?: string;
}) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLLabelElement>(null);
  useEffect(() => { setQ(value); }, [value]);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', f);
    return () => removeEventListener('mousedown', f);
  }, []);
  const nq = q.trim().toLowerCase();
  const filtered = items.filter(i => !nq || i.name.toLowerCase().includes(nq)).slice(0, 12);
  const check = canAddCatalogItem(q, items);
  const commit = (name: string) => { onChange(name); setQ(name); setOpen(false); };
  return <label className={`field ${cls}`} ref={box} style={{ position: 'relative' }}>
    <span className="fl">{label}</span>
    <input value={q} placeholder={placeholder ?? '—'} autoComplete="off"
      onChange={e => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)} />
    {open && (filtered.length > 0 || check.ok) && <div className="dd">
      {filtered.map(i => <button type="button" key={i.id} className={i.name === value ? 'on' : ''} onMouseDown={e => e.preventDefault()} onClick={() => commit(i.name)}>{i.name}</button>)}
      {check.ok && onAdd && <button type="button" className="add" onMouseDown={e => e.preventDefault()} onClick={async () => { await onAdd(check.name); commit(check.name); }}>+ Добавить «{check.name}» в справочник</button>}
    </div>}
  </label>;
}

export function LimitedField({ label, value, onChange, param, species, limits, cls = '', big }: {
  label: string; value: string; onChange: (v: string) => void;
  param: ExamLabParam; species: Species; limits: ExamLabLimit[]; cls?: string; big?: boolean;
}) {
  const r = checkLimit(species, param, value, limits);
  const extra = r.state === 'warn' ? 'warnb' : r.state === 'invalid' ? 'errb' : '';
  return <label className={`field ${cls} ${extra} ${big ? 'big' : ''}`}>
    <span className="fl">{label}</span>
    <input value={value} placeholder="—" {...NUM} onChange={e => onChange(e.target.value)} />
    {r.state === 'not-configured' && value.trim() !== '' && <span className="lh">не настроено</span>}
    {(r.state === 'warn' || r.state === 'invalid') && <span className={`lh ${r.state === 'warn' ? 'w' : 'e'}`}>{r.message}</span>}
  </label>;
}

export function Field({ label, value, onChange, placeholder, num, cls = '', children }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; num?: boolean; cls?: string; children?: ReactNode;
}) {
  return <label className={`field ${cls}`}><span className="fl">{label}</span>
    <input value={value} placeholder={placeholder ?? '—'} onChange={e => onChange(e.target.value)} {...(num ? NUM : { autoComplete: 'off' })} />
    {children}</label>;
}
