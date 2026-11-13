import { useLiveQuery } from 'dexie-react-hooks';
import { db, uuid, addBreed, type CaseRec } from '../db/db';
import { checkWeight, checkLimit, fmt, parseNum, type Species, type ExamLabLimit } from '../core/logic';
import { useCaseDraft } from './useCase';
import { go, type SaveState } from './App';
import { CatalogPick, LimitedField, TimePicker, Field } from './pickers';

export function HeaderScreen({ id, onSaved }: { id: string; onSaved: (s: SaveState) => void }) {
  const { c, update, flush } = useCaseDraft(id, onSaved);
  const limits = useLiveQuery(() => db.weightRules.toArray(), []) ?? [];
  const breeds = useLiveQuery(() => db.breeds.filter(b => !b.deletedAt && b.isActive).toArray(), []) ?? [];
  const examLimits = (useLiveQuery(() => db.examLabLimits.toArray(), []) ?? []) as ExamLabLimit[];
  if (!c) return <div className="main muted">Загрузка…</div>;
  const u = <K extends keyof CaseRec>(k: K) => (v: CaseRec[K]) => update({ [k]: v } as Partial<CaseRec>);
  const wc = checkWeight(c.species, c.weightKg, limits.map(l => ({ species: l.species, minKg: l.minKg, maxKg: l.maxKg })));
  const wClin = checkLimit(c.species, 'weightKg', c.weightKg, examLimits);
  const confirmed = !!c.weightConfirmedAt;
  const wcls = wc.state === 'ok' ? 'okb' : wc.state === 'invalid' ? 'errb' : wc.state === 'warn' && !confirmed ? 'warnb' : wClin.state === 'warn' && !confirmed ? 'warnb' : '';

  const fields: unknown[] = [c.patientName, c.weightKg, c.sex, c.ageText, c.breed || c.ownerName, c.diagnosis, c.operation, c.allergiesNotes,
    c.surgeon, c.assistant, c.anesthesiologist, c.anesthetist, c.asaClass, c.baselineVitals.tempC, c.baselineVitals.hr, c.baselineVitals.rr, c.baselineVitals.crtSec,
    c.baselineVitals.spo2, c.baselineVitals.sys, c.baselineVitals.map,
    c.preopLabs.hctPct, c.preopLabs.plateletsE9L, c.preopLabs.glucoseMmolL, c.preopLabs.potassiumMmolL,
    c.preopLabs.totalProteinGl, c.preopLabs.albuminGl, c.preopLabs.creatinineUmolL, c.preopLabs.wbcE9L,
    c.meds24hNone || c.meds24h.length ? 1 : ''];
  const filled = fields.filter(v => v !== '' && v != null).length;
  const weightBlock = wc.state === 'invalid' || wc.state === 'empty' || (wc.state === 'warn' && !confirmed);

  const bv = (k: keyof CaseRec['baselineVitals']) => (v: string) => update({ baselineVitals: { ...c.baselineVitals, [k]: v, at: c.baselineVitals.at ?? new Date().toISOString() } });
  const lab = (k: keyof CaseRec['preopLabs']) => (v: string) => update({ preopLabs: { ...c.preopLabs, [k]: v } });
  const L = (label: string, param: Parameters<typeof LimitedField>[0]['param'], value: string, onChange: (v: string) => void, cls = '') =>
    <LimitedField label={label} param={param} value={value} onChange={onChange} species={c.species} limits={examLimits} cls={cls} />;

  const breedItems = breeds.filter(b => b.species === c.species).map(b => ({ id: b.id, name: b.name }));

  return <><div className="main"><div className="cols">
    <div className="g">
      <section className="card"><div className="h">Пациент<span className="r">Карта № {c.number} · {new Date(c.date).toLocaleDateString('ru-RU')}</span></div>
        <div className="g g-id">
          <Field label="Кличка" value={c.patientName} onChange={u('patientName')} />
          <div className="field"><span className="fl">Вид</span><div className="seg" style={{ background: 'transparent', padding: 0 }}>
            {(['dog', 'cat'] as Species[]).map(s => <button key={s} className={c.species === s ? 'on' : ''} onClick={() => update({ species: s, weightConfirmedAt: null })}>{s === 'dog' ? 'Собака' : 'Кошка'}</button>)}</div></div>
          <label className="field"><span className="fl">Пол</span><select value={c.sex} onChange={e => u('sex')(e.target.value as CaseRec['sex'])}>
            <option value="">—</option><option value="female">Самка</option><option value="femaleSpayed">Самка, стер.</option><option value="male">Самец</option><option value="maleNeutered">Самец, кастр.</option></select></label>
          <Field label="Возраст" value={c.ageText} onChange={u('ageText')} placeholder="напр. 6 лет" />
        </div>
        <div className="g g-weight" style={{ marginTop: 14 }}>
          <label className={`field big ${wcls}`}><span className="fl">Вес, кг</span>
            <input inputMode="decimal" autoComplete="off" value={c.weightKg} placeholder="—" onChange={e => update({ weightKg: e.target.value, weightConfirmedAt: null })} />
            {wClin.state === 'warn' && (wc.state === 'ok' || wc.state === 'not-configured') && <span className="lh w">{wClin.message}</span>}
            {wClin.state === 'not-configured' && c.weightKg && wc.state !== 'warn' && wc.state !== 'invalid' && <span className="lh">не настроено</span>}
          </label>
          <CatalogPick label="Порода" value={c.breed} onChange={u('breed')} items={breedItems} placeholder="начните вводить"
            onAdd={async name => { const r = await addBreed(c.species, name); if (r.ok || r.breed) update({ breed: r.ok ? r.breed.name : (r.breed?.name ?? name) }); }} />
          <Field label="Владелец" value={c.ownerName} onChange={u('ownerName')} />
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
        <Field label="Диагноз" value={c.diagnosis} onChange={u('diagnosis')} /><Field label="Операция" value={c.operation} onChange={u('operation')} /></div></section>
      <section className="card"><div className="h">Аллергии и особенности</div>
        <Field label="Аллергии, особенности" value={c.allergiesNotes} onChange={u('allergiesNotes')} placeholder="Не выявлено" /></section>
      <section className="card"><div className="h">Бригада</div><div className="g g2">
        <Field label="Хирург" value={c.surgeon} onChange={u('surgeon')} /><Field label="Ассистент" value={c.assistant} onChange={u('assistant')} />
        <Field label="Анестезиолог" value={c.anesthesiologist} onChange={u('anesthesiologist')} /><Field label="Анестезист" value={c.anesthetist} onChange={u('anesthetist')} placeholder="можно указать позже" /></div></section>
    </div>
    <div className="g">
      <section className="card"><div className="h">Статус ASA</div>
        <div className="row"><div className="seg" style={{ flex: 5 }}>{[1, 2, 3, 4, 5].map(n => <button key={n} className={c.asaClass === n ? 'on' : ''} onClick={() => update({ asaClass: n })}>{n}</button>)}</div>
          <div className="seg" style={{ flex: 1 }}><button className={c.asaEmergency ? 'on' : ''} onClick={() => update({ asaEmergency: !c.asaEmergency })}>E</button></div></div>
        <div className="muted small" style={{ marginTop: 10 }}>E — экстренная операция</div></section>
      <section className="card"><div className="h">Исходные показатели
        <TimePicker label="" value={c.baselineVitals.at} onChange={iso => update({ baselineVitals: { ...c.baselineVitals, at: iso } })} cls="mini" /></div>
        <div className="bv8">
          {L('T °C', 'tempC', c.baselineVitals.tempC ?? '', bv('tempC'))}
          {L('ЧСС', 'hr', c.baselineVitals.hr ?? '', bv('hr'), 'hr')}
          {L('ЧДД', 'rr', c.baselineVitals.rr ?? '', bv('rr'))}
          {L('СРК, с', 'crtSec', c.baselineVitals.crtSec ?? '', bv('crtSec'))}
          {L('SpO₂, %', 'spo2', c.baselineVitals.spo2 ?? '', bv('spo2'))}
          {L('САД', 'sys', c.baselineVitals.sys ?? '', bv('sys'))}
          {L('ДАД', 'dia', c.baselineVitals.dia ?? '', bv('dia'))}
          {L('МАД', 'map', c.baselineVitals.map ?? '', bv('map'))}
        </div></section>
      <section className="card"><div className="h">Анализы перед операцией
        <TimePicker label="" value={c.preopLabs.takenAt} onChange={iso => update({ preopLabs: { ...c.preopLabs, takenAt: iso } })} /></div>
        <div className="g g4">
          {L('Ht (НСТ), %', 'hctPct', c.preopLabs.hctPct ?? '', lab('hctPct'))}
          {L('Тромбоциты, ×10⁹/л', 'plateletsE9L', c.preopLabs.plateletsE9L ?? '', lab('plateletsE9L'))}
          {L('Глюкоза, ммоль/л', 'glucoseMmolL', c.preopLabs.glucoseMmolL ?? '', lab('glucoseMmolL'))}
          {L('K⁺, ммоль/л', 'potassiumMmolL', c.preopLabs.potassiumMmolL ?? '', lab('potassiumMmolL'))}
          {L('Общий белок, г/л', 'totalProteinGl', c.preopLabs.totalProteinGl ?? '', lab('totalProteinGl'))}
          {L('Альбумин, г/л', 'albuminGl', c.preopLabs.albuminGl ?? '', lab('albuminGl'))}
          {L('Лактат, ммоль/л', 'lactateMmolL', c.preopLabs.lactateMmolL ?? '', lab('lactateMmolL'))}
          {L('Креатинин, мкмоль/л', 'creatinineUmolL', c.preopLabs.creatinineUmolL ?? '', lab('creatinineUmolL'))}
          {L('Мочевина, ммоль/л', 'ureaMmolL', c.preopLabs.ureaMmolL ?? '', lab('ureaMmolL'))}
          {L('Na⁺, ммоль/л', 'sodiumMmolL', c.preopLabs.sodiumMmolL ?? '', lab('sodiumMmolL'))}
          {L('iCa, ммоль/л', 'icaMmolL', c.preopLabs.icaMmolL ?? '', lab('icaMmolL'))}
          {L('Лейкоциты, ×10⁹/л', 'wbcE9L', c.preopLabs.wbcE9L ?? '', lab('wbcE9L'))}
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>Вне заданных лимитов поле подсвечивается. Если лимит не задан — «не настроено». Значения назначает клиника в «Настройках».</div>
      </section>
      <section className="card"><div className="h">Препараты за последние 24 ч
        <button className="link" onClick={() => update({ meds24h: [...c.meds24h, { id: uuid(), text: '' }], meds24hNone: false })}>+ Добавить</button></div>
        <div className="g" style={{ gap: 8 }}>
          {c.meds24h.map((m, i) => <div className="row" key={m.id}>
            <div className="field" style={{ flex: 1 }}><input value={m.text} placeholder="Препарат, доза" onChange={e => update({ meds24h: c.meds24h.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} /></div>
            <div style={{ width: 130 }}><TimePicker label="Время" value={m.at} onChange={iso => update({ meds24h: c.meds24h.map((x, j) => j === i ? { ...x, at: iso } : x) })} /></div>
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
