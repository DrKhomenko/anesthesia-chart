import { useLiveQuery } from 'dexie-react-hooks';
import { db, uuid, type CaseRec } from '../db/db';
import { checkWeight, fmt, parseNum, type Species } from '../core/logic';
import { useCaseDraft } from './useCase';
import { go, type SaveState } from './App';

const NUM = { inputMode: 'decimal' as const, autoComplete: 'off' };
function F({ label, value, onChange, placeholder, num, cls = '' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; num?: boolean; cls?: string }) {
  return <label className={`field ${cls}`}><span className="fl">{label}</span>
    <input value={value} placeholder={placeholder ?? '—'} onChange={e => onChange(e.target.value)} {...(num ? NUM : { autoComplete: 'off' })} /></label>;
}

export function HeaderScreen({ id, onSaved }: { id: string; onSaved: (s: SaveState) => void }) {
  const { c, update, flush } = useCaseDraft(id, onSaved);
  const limits = useLiveQuery(() => db.weightRules.toArray(), []) ?? [];
  if (!c) return <div className="main muted">Загрузка…</div>;
  const u = <K extends keyof CaseRec>(k: K) => (v: CaseRec[K]) => update({ [k]: v } as Partial<CaseRec>);
  const wc = checkWeight(c.species, c.weightKg, limits.map(l => ({ species: l.species, minKg: l.minKg, maxKg: l.maxKg })));
  const confirmed = !!c.weightConfirmedAt;
  const wcls = wc.state === 'ok' ? 'okb' : wc.state === 'invalid' ? 'errb' : wc.state === 'warn' && !confirmed ? 'warnb' : '';

  const fields: unknown[] = [c.patientName, c.weightKg, c.sex, c.ageText, c.breed || c.ownerName, c.diagnosis, c.operation, c.allergiesNotes,
    c.surgeon, c.assistant, c.anesthesiologist, c.anesthetist, c.asaClass, c.baselineVitals.tempC, c.baselineVitals.hr, c.baselineVitals.rr, c.baselineVitals.crtSec,
    c.preopLabs.hctPct, c.preopLabs.plateletsE9L, c.preopLabs.glucoseMmolL, c.preopLabs.potassiumMmolL, c.meds24hNone || c.meds24h.length ? 1 : ''];
  const filled = fields.filter(v => v !== '' && v != null).length;
  const weightBlock = wc.state === 'invalid' || wc.state === 'empty' || (wc.state === 'warn' && !confirmed);

  const bv = (k: keyof CaseRec['baselineVitals']) => (v: string) => update({ baselineVitals: { ...c.baselineVitals, [k]: v, at: c.baselineVitals.at ?? new Date().toISOString() } });
  const lab = (k: keyof CaseRec['preopLabs']) => (v: string) => update({ preopLabs: { ...c.preopLabs, [k]: v } });
  const bvAt = c.baselineVitals.at ? new Date(c.baselineVitals.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null;

  return <><div className="main"><div className="cols">
    <div className="g">
      <section className="card"><div className="h">Пациент<span className="r">Карта № {c.number} · {new Date(c.date).toLocaleDateString('ru-RU')}</span></div>
        <div className="g" style={{ gridTemplateColumns: '1fr 1.3fr 1.25fr .8fr' }}>
          <F label="Кличка" value={c.patientName} onChange={u('patientName')} />
          <div className="field"><span className="fl">Вид</span><div className="seg" style={{ background: 'transparent', padding: 0 }}>
            {(['dog', 'cat'] as Species[]).map(s => <button key={s} className={c.species === s ? 'on' : ''} onClick={() => update({ species: s, weightConfirmedAt: null })}>{s === 'dog' ? 'Собака' : 'Кошка'}</button>)}</div></div>
          <label className="field"><span className="fl">Пол</span><select value={c.sex} onChange={e => u('sex')(e.target.value as CaseRec['sex'])}>
            <option value="">—</option><option value="female">Самка</option><option value="femaleSpayed">Самка, стер.</option><option value="male">Самец</option><option value="maleNeutered">Самец, кастр.</option></select></label>
          <F label="Возраст" value={c.ageText} onChange={u('ageText')} placeholder="напр. 6 лет" />
        </div>
        <div className="g" style={{ gridTemplateColumns: '1fr 1.3fr 1.3fr', marginTop: 14 }}>
          <F label="Вес, кг" value={c.weightKg} onChange={v => update({ weightKg: v, weightConfirmedAt: null })} num cls={`big ${wcls}`} />
          <F label="Порода" value={c.breed} onChange={u('breed')} />
          <F label="Владелец" value={c.ownerName} onChange={u('ownerName')} />
        </div>
        {wc.state === 'warn' && !confirmed && <div className="warn" style={{ marginTop: 12 }}>
          <b>Проверьте вес:</b> {wc.message}. {wc.hint}
          <div className="row" style={{ marginTop: 10 }}>
            {wc.hint && <button className="btn sm sec" onClick={() => { const w = parseNum(c.weightKg); const m = wc.hint!.includes('лишний') ? w / 10 : w * 10; update({ weightKg: fmt(m) }); }}>Исправить</button>}
            <button className="btn sm ghost" onClick={() => update({ weightConfirmedAt: new Date().toISOString() })}>Вес верный</button></div></div>}
        {wc.state === 'warn' && confirmed && <div className="note" style={{ marginTop: 12 }}>Вес вне рамок подтверждён врачом в {new Date(c.weightConfirmedAt!).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.</div>}
        {wc.state === 'invalid' && <div className="warn" style={{ marginTop: 12 }}>{wc.message}</div>}
        {wc.state === 'not-configured' && <div className="note" style={{ marginTop: 12 }}>Рамки веса для этого вида не настроены, поэтому проверка опечаток не делается. <button className="link" onClick={() => go('/settings')}>Настроить</button></div>}
      </section>
      <section className="card"><div className="h">Диагноз и операция</div><div className="g">
        <F label="Диагноз" value={c.diagnosis} onChange={u('diagnosis')} /><F label="Операция" value={c.operation} onChange={u('operation')} /></div></section>
      <section className="card"><div className="h">Аллергии и особенности</div>
        <F label="Аллергии, особенности" value={c.allergiesNotes} onChange={u('allergiesNotes')} placeholder="Не выявлено" /></section>
      <section className="card"><div className="h">Бригада</div><div className="g g2">
        <F label="Хирург" value={c.surgeon} onChange={u('surgeon')} /><F label="Ассистент" value={c.assistant} onChange={u('assistant')} />
        <F label="Анестезиолог" value={c.anesthesiologist} onChange={u('anesthesiologist')} /><F label="Анестезист" value={c.anesthetist} onChange={u('anesthetist')} placeholder="можно указать позже" /></div></section>
    </div>
    <div className="g">
      <section className="card"><div className="h">Статус ASA</div>
        <div className="row"><div className="seg" style={{ flex: 5 }}>{[1, 2, 3, 4, 5].map(n => <button key={n} className={c.asaClass === n ? 'on' : ''} onClick={() => update({ asaClass: n })}>{n}</button>)}</div>
          <div className="seg" style={{ flex: 1 }}><button className={c.asaEmergency ? 'on' : ''} onClick={() => update({ asaEmergency: !c.asaEmergency })}>E</button></div></div>
        <div className="muted small" style={{ marginTop: 10 }}>E — экстренная операция</div></section>
      <section className="card"><div className="h">Исходные показатели{bvAt && ` · ${bvAt}`}</div><div className="bv">
        <F label="T °C" value={c.baselineVitals.tempC ?? ''} onChange={bv('tempC')} num />
        <F label="Пульс" value={c.baselineVitals.hr ?? ''} onChange={bv('hr')} num cls="hr" />
        <F label="ЧДД" value={c.baselineVitals.rr ?? ''} onChange={bv('rr')} num />
        <F label="СНК, с" value={c.baselineVitals.crtSec ?? ''} onChange={bv('crtSec')} num /></div></section>
      <section className="card"><div className="h">Анализы перед операцией</div><div className="g g4">
        <F label="НСТ, %" value={c.preopLabs.hctPct ?? ''} onChange={lab('hctPct')} num />
        <F label="TR, ×10⁹/л" value={c.preopLabs.plateletsE9L ?? ''} onChange={lab('plateletsE9L')} num />
        <F label="Глюкоза, ммоль/л" value={c.preopLabs.glucoseMmolL ?? ''} onChange={lab('glucoseMmolL')} num />
        <F label="K⁺, ммоль/л" value={c.preopLabs.potassiumMmolL ?? ''} onChange={lab('potassiumMmolL')} num /></div></section>
      <section className="card"><div className="h">Препараты за последние 24 ч
        <button className="link" onClick={() => update({ meds24h: [...c.meds24h, { id: uuid(), text: '' }], meds24hNone: false })}>+ Добавить</button></div>
        <div className="g" style={{ gap: 8 }}>
          {c.meds24h.map((m, i) => <div className="row" key={m.id}>
            <div className="field" style={{ flex: 1 }}><input value={m.text} placeholder="Препарат, доза, время" onChange={e => update({ meds24h: c.meds24h.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} /></div>
            <button className="x" aria-label="Удалить" onClick={() => update({ meds24h: c.meds24h.filter((_, j) => j !== i) })}>✕</button></div>)}
          {c.meds24h.length === 0 && <div className="seg"><button className={c.meds24hNone ? 'on' : ''} onClick={() => update({ meds24hNone: !c.meds24hNone })}>{c.meds24hNone ? `Не ${c.sex.startsWith('female') ? 'получала' : 'получал'}` : 'Отметить «не получал(а)»'}</button></div>}
        </div></section>
    </div>
  </div></div>
  <div className="bar"><span className="muted">Заполнено {filled} из {fields.length} полей · анестезиста можно указать позже</span><div style={{ flex: 1 }} />
    <button className="btn sec" onClick={async () => { await flush(); go('/'); }}>К списку</button>
    <button className="btn pri" disabled={weightBlock} title={weightBlock ? 'Сначала укажите и проверьте вес' : ''}
      onClick={async () => { update({ stage: c.stage === 'header' ? 'premed' : c.stage }); await flush(); go(`/case/${c.id}/premed`); }}>Начать премедикацию →</button></div></>;
}
