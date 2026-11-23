import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CLINIC_SETTINGS_ID, clinicBlockNames, clinicInfusionUnits, clinicLocalAnesthetics, clinicVentModes, db, defaultGasOf, getLocalSettings, saveLocalSettings, saveWithAudit,
  type ClinicSettings, type LocalSettings,
} from '../db/db';
import { canAddCatalogItem, parseNum } from '../core/logic';
import { normalizeReminderInterval } from '../core/reminder';
import type { DefaultGasSetting } from '../core/gas';

export function AnesthesiaSettingsSection({ onSaved }: { onSaved: (fn: () => Promise<unknown>) => void }) {
  const cs = useLiveQuery(() => db.clinicSettings.get(CLINIC_SETTINGS_ID), []);
  const [loc, setLoc] = useState<LocalSettings | null>(null);
  const [interval, setInterval] = useState('5');
  const [newUnit, setNewUnit] = useState('');
  const [newBlock, setNewBlock] = useState('');
  const [newAnest, setNewAnest] = useState('');
  const [newVent, setNewVent] = useState('');
  useEffect(() => {
    void getLocalSettings().then(s => {
      setLoc(s);
      setInterval(String(normalizeReminderInterval(s.reminderIntervalMin)));
    });
  }, []);
  if (!cs || !loc) return null;
  const putClinic = (p: Partial<ClinicSettings>) => onSaved(() => saveWithAudit(db.clinicSettings, 'ClinicSettings', { ...cs, ...p }));
  const putLoc = (p: Partial<LocalSettings>) => onSaved(async () => {
    const next = { ...loc, ...p };
    setLoc(next);
    await saveLocalSettings(next);
  });
  const units = clinicInfusionUnits(cs);
  const gas = defaultGasOf(cs);
  const check = canAddCatalogItem(newUnit, units.map((name, i) => ({ id: String(i), name })));
  const blocks = clinicBlockNames(cs);
  const anests = clinicLocalAnesthetics(cs);
  const blockCheck = canAddCatalogItem(newBlock, blocks.map((name, i) => ({ id: String(i), name })));
  const anestCheck = canAddCatalogItem(newAnest, anests.map((x, i) => ({ id: String(i), name: x.name })));
  const vents = clinicVentModes(cs);
  const ventCheck = canAddCatalogItem(newVent, vents.map((name, i) => ({ id: String(i), name })));
  return <>
    <section className="card" style={{ marginTop: 16 }}>
      <div className="h">Напоминания о записи показателей</div>
      <div className="g">
        <label className="field"><span className="fl">Интервал, мин</span>
          <input inputMode="numeric" value={interval} onChange={e => setInterval(e.target.value)}
            onBlur={() => {
              const n = normalizeReminderInterval(interval);
              setInterval(String(n));
              if (n !== loc.reminderIntervalMin) void putLoc({ reminderIntervalMin: n });
            }} /></label>
        <div className="muted small">По умолчанию 5 минут. Включается и выключается переключателем на экране поддержания и пробуждения. Работает, только пока карта открыта.</div>
      </div>
    </section>
    <section className="card" style={{ marginTop: 16 }}>
      <div className="h">Газ по умолчанию</div>
      <div className="seg">
        {([
          ['sevo', 'Sevo'],
          ['iso', 'Iso'],
          ['ask', 'Спрашивать'],
        ] as [DefaultGasSetting, string][]).map(([v, ru]) =>
          <button key={v} type="button" className={gas === v ? 'on' : ''} onClick={() => putClinic({ defaultGas: v })}>{ru}</button>)}
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>Если на индукции газ уже выбран, в поддержании спрашивается только он. Эта настройка нужна, когда на индукции газ не указали. «Спрашивать» — один раз, не оба поля каждый раз.</div>
    </section>
    <section className="card" style={{ marginTop: 16 }}>
      <div className="h">Режимы вентиляции</div>
      <div className="chipbar">{vents.map(n => <span key={n} className="chip">{n}
        <button className="x" aria-label={`Убрать ${n}`} style={{ marginLeft: 6 }} onClick={() => putClinic({ ventModes: vents.filter(x => x !== n) })}>✕</button></span>)}</div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="field" style={{ flex: 1 }}><span className="fl">Новый режим</span>
          <input value={newVent} placeholder="например PCV-VG" onChange={e => setNewVent(e.target.value)} /></label>
        <button className="btn sm pri" disabled={!ventCheck.ok} onClick={() => { if (ventCheck.ok) { putClinic({ ventModes: [...vents, ventCheck.name] }); setNewVent(''); } }}>Добавить</button>
      </div>
      <div className="muted small">Стартовый набор: Спонтанно, PCV, VCV, SIMV, PSV (WATO EX-35Vet). Список правит клиника. Выбор — одним касанием в быстрой записи.</div>
    </section>
    <section className="card" style={{ marginTop: 16 }}>
      <div className="h">Единицы скорости инфузий</div>
      <div className="chipbar">{units.map(u => <span key={u} className="chip">{u}
        <button className="x" aria-label={`Убрать ${u}`} style={{ marginLeft: 6 }} onClick={() => putClinic({ infusionRateUnits: units.filter(x => x !== u) })}>✕</button></span>)}</div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="field" style={{ flex: 1 }}><span className="fl">Новая единица</span>
          <input value={newUnit} placeholder="например мл/ч" onChange={e => setNewUnit(e.target.value)} /></label>
        <button className="btn sm pri" disabled={!check.ok} onClick={() => { if (check.ok) { putClinic({ infusionRateUnits: [...units, check.name] }); setNewUnit(''); } }}>Добавить</button>
      </div>
      <div className="muted small">Только подписи единиц, без доз и пересчётов. Список задаёт клиника.</div>
    </section>
    <section className="card" style={{ marginTop: 16 }}>
      <div className="h">Названия блокад</div>
      <div className="chipbar">{blocks.map(n => <span key={n} className="chip">{n}
        <button className="x" aria-label={`Убрать ${n}`} style={{ marginLeft: 6 }} onClick={() => putClinic({ blockNames: blocks.filter(x => x !== n) })}>✕</button></span>)}</div>
      {blocks.length === 0 && <div className="muted small">Список изначально пустой. Клиника добавляет свои названия, например «эпидуральная» или «TAP».</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <label className="field" style={{ flex: 1 }}><span className="fl">Новое название</span>
          <input value={newBlock} placeholder="например TAP" onChange={e => setNewBlock(e.target.value)} /></label>
        <button className="btn sm pri" disabled={!blockCheck.ok} onClick={() => { if (blockCheck.ok) { putClinic({ blockNames: [...blocks, blockCheck.name] }); setNewBlock(''); } }}>Добавить</button>
      </div>
    </section>
    <section className="card" style={{ marginTop: 16 }}>
      <div className="h">Местные анестетики</div>
      <div className="g" style={{ gap: 8 }}>
        {anests.map((a, i) => <div key={a.name} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }} className="muted">{a.name}</div>
          <label className="field" style={{ width: 140 }}><span className="fl">макс. мг/кг</span>
            <input inputMode="decimal" value={a.maxMgKg == null ? '' : String(a.maxMgKg).replace('.', ',')}
              placeholder="не задан"
              onChange={e => {
                const raw = e.target.value.trim();
                const n = raw === '' ? null : parseNum(raw);
                const next = anests.map((x, j) => j === i ? { ...x, maxMgKg: n } : x);
                putClinic({ localAnesthetics: next });
              }} /></label>
          <button className="x" aria-label={`Убрать ${a.name}`} onClick={() => putClinic({ localAnesthetics: anests.filter((_, j) => j !== i) })}>✕</button>
        </div>)}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="field" style={{ flex: 1 }}><span className="fl">Новый анестетик</span>
          <input value={newAnest} placeholder="название" onChange={e => setNewAnest(e.target.value)} /></label>
        <button className="btn sm pri" disabled={!anestCheck.ok} onClick={() => { if (anestCheck.ok) { putClinic({ localAnesthetics: [...anests, { name: anestCheck.name, maxMgKg: null }] }); setNewAnest(''); } }}>Добавить</button>
      </div>
      <div className="muted small">Стартовый набор: бупивакаин, лидокаин, ропивакаин. Максимальная доза пустая, пока клиника её не укажет. Тогда при превышении суммы по карте появится оранжевый флаг, сохранение не блокируется.</div>
    </section>
  </>;
}
