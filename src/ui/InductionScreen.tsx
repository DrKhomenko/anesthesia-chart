import { useCaseDraft } from './useCase';
import { go, type SaveState } from './App';
import { TimePicker, Field } from './pickers';
import { PhaseDrugs } from './PhaseDrugs';
import { InfusionsSection } from './InfusionsSection';
import { RegionalSection } from './RegionalSection';
import { Seg, YesNoSeg, Labeled, Notes } from './formBits';
import type { InductionData } from '../db/db';

/** Размеры трубок — стандартный ряд маркировки ЭТТ (внутр. диаметр, мм), не клиническая рекомендация. */
const ETT_SIZES = ['2,0', '2,5', '3,0', '3,5', '4,0', '4,5', '5,0', '5,5', '6,0', '6,5', '7,0', '7,5', '8,0', '8,5', '9,0', '9,5', '10,0', '11,0', '12,0'];
export const VENT_MODES = ['Спонт.', 'Ручная', 'PCV', 'VCV', 'SIMV', 'PSV'];

export function InductionScreen({ id, onSaved }: { id: string; onSaved: (s: SaveState) => void }) {
  const { c, update, flush } = useCaseDraft(id, onSaved);
  if (!c) return <div className="main muted">Загрузка…</div>;
  const ind = c.induction ?? {};
  const u = (p: Partial<InductionData>) => update({ induction: { ...ind, ...p } });
  const uf = (k: keyof InductionData) => (v: string) => u({ [k]: v } as Partial<InductionData>);

  return <><div className="main"><div className="cols cols-premed">
    <div className="g">
      <section className="card">
        <div className="h">Начало анестезии</div>
        <div className="g g2">
          <TimePicker label="Индукция, время" value={c.anesthesiaStartAt} onChange={iso => update({ anesthesiaStartAt: iso })} />
          <TimePicker label="Подключение к НДА" value={ind.connectedAt} onChange={iso => u({ connectedAt: iso })} />
        </div>
      </section>
      <PhaseDrugs c={c} phase="induction" title="Препараты индукции" onSaved={onSaved}
        emptyText="Выберите препарат из справочника клиники. Дозу выбираете вы, мг и мл посчитаются по весу и концентрации." />
      <InfusionsSection c={c} onSaved={onSaved} compact />
      <RegionalSection c={c} onSaved={onSaved} phase="induction" />
      <section className="card">
        <div className="h">Начальные настройки ИВЛ</div>
        <Seg value={ind.ventMode as string} options={VENT_MODES.map(v => ({ v, ru: v }))} onChange={v => u({ ventMode: v })} />
        <div className="g g2" style={{ marginTop: 12 }}>
          <Field label="Pinsp, см H₂O" value={ind.pinsp ?? ''} onChange={uf('pinsp')} num />
          <Field label="VT, мл" value={ind.vt ?? ''} onChange={uf('vt')} num />
          <Field label="ЧД, /мин" value={ind.rr ?? ''} onChange={uf('rr')} num />
          <Field label="PEEP, см H₂O" value={ind.peep ?? ''} onChange={uf('peep')} num />
        </div>
      </section>
    </div>
    <div className="g">
      <section className="card">
        <div className="h">Интубация</div>
        <div className="g">
          <Labeled label="Маска до интубации"><YesNoSeg value={ind.maskInduction} onChange={v => u({ maskInduction: v })} /></Labeled>
          <Labeled label="ЭТТ, мм">
            <div className="chipbar">{ETT_SIZES.map(s => <button key={s} type="button" className={`chip ${ind.ettSizeMm === s ? 'on' : ''}`} onClick={() => u({ ettSizeMm: ind.ettSizeMm === s ? '' : s })}>{s}</button>)}</div>
          </Labeled>
          <div className="g g2">
            <Field label="ЭТТ вручную, мм" value={ind.ettSizeMm ?? ''} onChange={uf('ettSizeMm')} num />
            <TimePicker label="Время интубации" value={ind.intubatedAt} onChange={iso => u({ intubatedAt: iso })} />
          </div>
          <Labeled label="Манжета раздута"><YesNoSeg value={ind.cuff} onChange={v => u({ cuff: v })} /></Labeled>
          <Labeled label="Попыток">
            <Seg value={ind.attempts} options={['1', '2', '3', '4+'].map(v => ({ v, ru: v }))} onChange={v => u({ attempts: v })} />
          </Labeled>
          <Labeled label="Лидокаин-спрей на гортань"><YesNoSeg value={ind.lidocaineSpray} onChange={v => u({ lidocaineSpray: v })} /></Labeled>
          <Notes label="Осложнения интубации" value={ind.intubationComplications ?? ''} onChange={uf('intubationComplications')} />
        </div>
      </section>
      <section className="card">
        <div className="h">Ингаляционный анестетик</div>
        <Seg value={ind.gas} options={[{ v: 'sevo', ru: 'Севофлуран' }, { v: 'iso', ru: 'Изофлуран' }]} onChange={v => u({ gas: v })} />
        <div className="g g2" style={{ marginTop: 12 }}>
          <Field label="На испарителе, %" value={ind.gasPct ?? ''} onChange={uf('gasPct')} num />
          <Field label="Поток O₂, л/мин" value={ind.o2Flow ?? ''} onChange={uf('o2Flow')} num />
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>Газового модуля нет — вводится вручную.</div>
      </section>
      <section className="card">
        <div className="h">Операция</div>
        <TimePicker label="Начало операции (разрез)" value={c.surgeryStartAt} onChange={iso => update({ surgeryStartAt: iso })} />
      </section>
      <section className="card"><Notes label="Заметки к индукции" value={ind.notes ?? ''} onChange={uf('notes')} /></section>
    </div>
  </div></div>
  <div className="bar">
    <button className="btn sec" onClick={async () => { await flush(); go(`/case/${c.id}/premed`); }}>← Премедикация</button>
    <div style={{ flex: 1 }} />
    <button className="btn pri" onClick={async () => {
      if (['header', 'premed', 'induction'].includes(c.stage)) update({ stage: 'maintenance' });
      await flush(); go(`/case/${c.id}/maintenance`);
    }}>К поддержанию →</button>
  </div></>;
}
