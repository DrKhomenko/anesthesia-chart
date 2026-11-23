import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CLINIC_SETTINGS_ID, clinicInfusionUnits, db, defaultGasOf, getLocalSettings, saveLocalSettings, saveWithAudit,
  type ClinicSettings, type LocalSettings,
} from '../db/db';
import { canAddCatalogItem } from '../core/logic';
import { normalizeReminderInterval } from '../core/reminder';
import type { DefaultGasSetting } from '../core/gas';

export function AnesthesiaSettingsSection({ onSaved }: { onSaved: (fn: () => Promise<unknown>) => void }) {
  const cs = useLiveQuery(() => db.clinicSettings.get(CLINIC_SETTINGS_ID), []);
  const [loc, setLoc] = useState<LocalSettings | null>(null);
  const [interval, setInterval] = useState('5');
  const [newUnit, setNewUnit] = useState('');
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
  </>;
}
