import type { YesNo } from '../db/db';

export function Seg<T extends string>({ value, options, onChange, allowClear = true }: { value: T | '' | undefined; options: { v: T; ru: string }[]; onChange: (v: T | '') => void; allowClear?: boolean }) {
  return <div className="seg">{options.map(o => <button key={o.v} type="button" className={value === o.v ? 'on' : ''}
    onClick={() => onChange(value === o.v && allowClear ? '' : o.v)}>{o.ru}</button>)}</div>;
}
export function YesNoSeg({ value, onChange }: { value: YesNo | undefined; onChange: (v: YesNo) => void }) {
  return <Seg<'yes' | 'no'> value={value} options={[{ v: 'yes', ru: 'Да' }, { v: 'no', ru: 'Нет' }]} onChange={v => onChange(v)} />;
}
export function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="g" style={{ gap: 6 }}><span className="muted small">{label}</span>{children}</div>;
}
export function Notes({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="field"><span className="fl">{label}</span>
    <textarea rows={3} value={value} placeholder="по желанию" onChange={e => onChange(e.target.value)} /></label>;
}
