import { useRef, useState, type PointerEvent as PE } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveWithAudit, softDelete, meta, getLocalSettings, saveLocalSettings, LOCAL_SETTINGS_ID, type DeviceRec, defaultLocalSettings } from '../db/db';
import { DEVICE_TYPE_RU, FIELDS_BY_TYPE, PRESET_DEVICES, type DeviceType, type FieldRegion } from '../core/devices';

export function EquipmentSection({ onSaved }: { onSaved: (fn: () => Promise<unknown>) => void }) {
  const devices = useLiveQuery(() => db.devices.filter(d => !d.deletedAt).toArray(), []) ?? [];
  const loc = useLiveQuery(() => db.localSettings.get(LOCAL_SETTINGS_ID), []) ?? defaultLocalSettings();
  const [edit, setEdit] = useState<DeviceRec | 'new-monitor' | 'new-machine' | null>(null);

  const of = (t: DeviceType) => devices.filter(d => d.type === t).sort((a, b) => Number(b.isPreset) - Number(a.isPreset) || a.name.localeCompare(b.name, 'ru'));
  const setActive = (t: DeviceType, id: string) => onSaved(async () => {
    const cur = loc ?? await getLocalSettings();
    const next = { ...cur, [t === 'monitor' ? 'activeMonitorId' : 'activeMachineId']: id };
    await saveLocalSettings(next);
  });
  const restorePresets = () => onSaved(async () => {
    for (const p of PRESET_DEVICES) {
      const prev = await db.devices.get(p.id);
      if (!prev) {
        await saveWithAudit(db.devices, 'Device', { ...meta(), id: p.id, type: p.type, name: p.name, fieldKeys: [...p.fieldKeys], regions: { ...p.regions }, isPreset: true, isUserAdded: false, isActive: true });
      } else if (prev.deletedAt || !prev.isActive) {
        await saveWithAudit(db.devices, 'Device', { ...prev, deletedAt: null, isActive: true });
      }
    }
  });

  return <section className="card" style={{ marginTop: 16 }} data-section="equipment">
    <div className="h">Оборудование
      <button className="link" onClick={restorePresets}>Восстановить шаблоны</button></div>
    <div className="muted small" style={{ marginBottom: 14 }}>Монитор и наркозный аппарат — два разных прибора, каждый со своим шаблоном полей. Снимок разбирается по выбранному шаблону. Концентрацию Sevo и Iso модуль газов не читает — её вводят вручную.</div>
    <div className="g g2">
      {(['monitor', 'machine'] as DeviceType[]).map(t => {
        const list = of(t);
        const active = t === 'monitor' ? loc?.activeMonitorId : loc?.activeMachineId;
        return <div key={t} className="g" style={{ gap: 8 }}>
          <div className="row"><b style={{ flex: 1, fontSize: 16 }}>{DEVICE_TYPE_RU[t]}</b>
            <button className="btn sm pri" onClick={() => setEdit(t === 'monitor' ? 'new-monitor' : 'new-machine')}>+ Добавить</button></div>
          {list.length === 0 && <div className="note">Нет приборов. Добавьте свой или восстановите шаблоны.</div>}
          {list.map(d => <div key={d.id} className={`devcard ${d.id === active ? 'on' : ''}`}>
            <button className="devmain" onClick={() => setActive(t, d.id)}>
              <b style={{ opacity: d.isActive ? 1 : .45 }}>{d.name}</b>
              <div className="muted small">{d.fieldKeys.length} полей{d.isPreset ? ' · шаблон' : ''}{d.id === active ? ' · используется' : ''}</div>
            </button>
            <button className="btn sm sec" onClick={() => setEdit(d)}>Поля</button>
            <button className="btn sm sec" onClick={() => onSaved(() => saveWithAudit(db.devices, 'Device', { ...d, isActive: !d.isActive }))}>{d.isActive ? 'Скрыть' : 'Показать'}</button>
            <button className="x" aria-label="Удалить" onClick={() => { if (confirm(`Удалить «${d.name}»?`)) onSaved(() => softDelete(db.devices, 'Device', d.id)); }}>✕</button>
          </div>)}
        </div>;
      })}
    </div>
    {edit && <DeviceEditor initial={edit} onClose={() => setEdit(null)} onSaved={onSaved} />}
  </section>;
}

function blankDevice(type: DeviceType): DeviceRec {
  const keys = FIELDS_BY_TYPE[type].map(f => f.key);
  return { ...meta(), type, name: '', fieldKeys: keys, regions: {}, isPreset: false, isUserAdded: true, isActive: true };
}

function DeviceEditor({ initial, onClose, onSaved }: { initial: DeviceRec | 'new-monitor' | 'new-machine'; onClose: () => void; onSaved: (fn: () => Promise<unknown>) => void }) {
  const isNew = initial === 'new-monitor' || initial === 'new-machine';
  const [d, setD] = useState<DeviceRec>(() => isNew ? blankDevice(initial === 'new-monitor' ? 'monitor' : 'machine') : initial);
  const [photo, setPhoto] = useState<string | null>(null);
  const [markKey, setMarkKey] = useState<string>(d.fieldKeys[0] ?? '');
  const catalog = FIELDS_BY_TYPE[d.type];
  const toggle = (key: string) => setD(s => ({
    ...s,
    fieldKeys: s.fieldKeys.includes(key) ? s.fieldKeys.filter(k => k !== key) : [...s.fieldKeys, key],
  }));
  const save = () => onSaved(async () => {
    const name = d.name.trim();
    if (!name || d.fieldKeys.length === 0) return;
    await saveWithAudit(db.devices, 'Device', { ...d, name, isUserAdded: isNew || d.isUserAdded });
    onClose();
  });
  return <div className="ov center" onClick={onClose} role="presentation">
    <div className="sheet wide" onClick={e => e.stopPropagation()} role="dialog" aria-label="Прибор">
      <div className="grab" />
      <div className="sh">{isNew ? 'Новый прибор' : 'Шаблон прибора'}</div>
      <div className="g">
        <div className="g g2">
          <label className="field"><span className="fl">Название</span>
            <input value={d.name} placeholder="например, uMEC12 Vet" onChange={e => setD({ ...d, name: e.target.value })} /></label>
          <div><div className="muted small" style={{ marginBottom: 6 }}>Тип</div>
            <div className="seg">{(['monitor', 'machine'] as DeviceType[]).map(t =>
              <button key={t} className={d.type === t ? 'on' : ''} onClick={() => {
                if (t === d.type) return;
                setD({ ...d, type: t, fieldKeys: FIELDS_BY_TYPE[t].map(f => f.key), regions: {} });
                setMarkKey(FIELDS_BY_TYPE[t][0]?.key ?? '');
              }}>{DEVICE_TYPE_RU[t]}</button>)}</div></div>
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 8 }}>Поля, которые нужно считывать</div>
          <div className="chipbar">
            {catalog.map(f => <button key={f.key} type="button" className={`chip ${d.fieldKeys.includes(f.key) ? 'on' : ''}`} onClick={() => toggle(f.key)}>
              {d.fieldKeys.includes(f.key) ? '✓ ' : ''}{f.label}{f.unit ? ` ${f.unit}` : ''}
            </button>)}
          </div>
        </div>
        <div>
          <div className="muted small" style={{ marginBottom: 8 }}>Разметка полей на образце фото — необязательно. Выберите поле и обведите его на снимке.</div>
          {!photo && <label className="btn sec" style={{ display: 'inline-flex' }}>Загрузить образец экрана
            <input type="file" accept="image/*" hidden onChange={e => {
              const f = e.target.files?.[0]; if (!f) return;
              const r = new FileReader(); r.onload = () => setPhoto(String(r.result)); r.readAsDataURL(f);
            }} /></label>}
          {photo && <RegionEditor src={photo} fields={catalog.filter(f => d.fieldKeys.includes(f.key))} regions={d.regions}
            activeKey={markKey} onActive={setMarkKey}
            onChange={regions => setD(s => ({ ...s, regions }))} onClearPhoto={() => setPhoto(null)} />}
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn sec" onClick={onClose}>Отмена</button>
        <div style={{ flex: 1 }} />
        <button className="btn pri" disabled={!d.name.trim() || d.fieldKeys.length === 0} onClick={save}>Сохранить</button>
      </div>
    </div>
  </div>;
}

function RegionEditor({ src, fields, regions, activeKey, onActive, onChange, onClearPhoto }: {
  src: string; fields: { key: string; label: string }[]; regions: Record<string, FieldRegion>;
  activeKey: string; onActive: (k: string) => void;
  onChange: (r: Record<string, FieldRegion>) => void; onClearPhoto: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<FieldRegion | null>(null);
  const norm = (e: PE<HTMLDivElement>) => {
    const el = wrap.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return { x, y };
  };
  const down = (e: PE<HTMLDivElement>) => {
    if (!activeKey) return;
    const p = norm(e); if (!p) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    drag.current = p; setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const move = (e: PE<HTMLDivElement>) => {
    if (!drag.current) return;
    const p = norm(e); if (!p) return;
    const x = Math.min(drag.current.x, p.x), y = Math.min(drag.current.y, p.y);
    setDraft({ x, y, w: Math.abs(p.x - drag.current.x), h: Math.abs(p.y - drag.current.y) });
  };
  const up = () => {
    if (draft && activeKey && draft.w > 0.02 && draft.h > 0.02) onChange({ ...regions, [activeKey]: draft });
    drag.current = null; setDraft(null);
  };
  const boxes = { ...regions, ...(draft && activeKey ? { [activeKey]: draft } : {}) };
  return <div className="g" style={{ gap: 8 }}>
    <div className="chipbar">
      {fields.map(f => <button key={f.key} type="button" className={`chip ${f.key === activeKey ? 'on' : ''}`} onClick={() => onActive(f.key)}>
        {f.label}{regions[f.key] ? ' ✓' : ''}
      </button>)}
    </div>
    <div className="region" ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <img src={src} alt="Образец экрана" draggable={false} />
      {Object.entries(boxes).map(([k, b]) => {
        const lab = fields.find(f => f.key === k)?.label ?? k;
        return <div key={k} className={`bbox ${k === activeKey ? 'on' : ''}`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
          <span>{lab}</span>
        </div>;
      })}
    </div>
    <div className="row">
      <button className="btn sm sec" disabled={!activeKey || !regions[activeKey]} onClick={() => {
        if (!activeKey) return;
        const next = { ...regions }; delete next[activeKey]; onChange(next);
      }}>Удалить рамку поля</button>
      <button className="btn sm sec" onClick={onClearPhoto}>Убрать фото</button>
    </div>
  </div>;
}
