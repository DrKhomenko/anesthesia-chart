import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db, meta, now, repeatDrugAdmin, saveWithAudit, type CaseRec, type CaseTimer, type DrugAdmin,
} from '../db/db';
import {
  defaultBlockTimerTitle, dueAtFrom, formatInterval, formatTimerCountdown, INTERVAL_PRESETS,
  isTimerDue, liveTimers, parseIntervalMin, restartRepeat, shouldStopOnAnesthesiaEnd,
  snoozeTimer, stopTimer, timerBannerTitle,
} from '../core/timers';
import { holdWakeLock, playReminderChime, unlockReminderAudio } from './reminderAudio';
import { onTimerStartRequest, type TimerStartRequest } from './timerStart';
import type { SaveState } from './App';

export function TimerBar({ c, onSaved }: { c: CaseRec; onSaved: (s: SaveState) => void }) {
  const rows = useLiveQuery(async () => liveTimers(await db.caseTimers.where('caseId').equals(c.id).toArray()), [c.id]) ?? [];
  const [nowDt, setNowDt] = useState(() => new Date());
  const [flash, setFlash] = useState(false);
  const [draft, setDraft] = useState<TimerStartRequest | null>(null);
  const dueIds = useRef(new Set<string>());
  const stoppedForEnd = useRef(false);

  useEffect(() => {
    const i = window.setInterval(() => setNowDt(new Date()), 1000);
    return () => window.clearInterval(i);
  }, []);
  useEffect(() => onTimerStartRequest(req => {
    if (req.type === 'repeat' && parseIntervalMin(req.intervalMin) && !req.offer) {
      void startRepeat(req.admin, req.intervalMin!);
      return;
    }
    if (req.type === 'block' && parseIntervalMin(req.intervalMin)) {
      void startOnce(defaultBlockTimerTitle(req.block.blockName), req.intervalMin!, { regionalBlockId: req.block.id });
      return;
    }
    setDraft(req);
  }), [c.id, c.anesthesiologist, c.anesthetist, c.stage, c.weightKg]);

  const due = rows.filter(t => isTimerDue(t, nowDt));
  const upcoming = rows.filter(t => !isTimerDue(t, nowDt));

  useEffect(() => {
    if (rows.length === 0) return;
    return holdWakeLock();
  }, [rows.length]);

  useEffect(() => {
    const seen = dueIds.current;
    let became = false;
    const next = new Set<string>();
    for (const t of due) {
      next.add(t.id);
      if (!seen.has(t.id)) became = true;
    }
    dueIds.current = next;
    if (became) {
      setFlash(true);
      playReminderChime(0);
      const id = window.setTimeout(() => setFlash(false), 900);
      return () => window.clearTimeout(id);
    }
  }, [due.map(t => t.id).join(',')]);

  useEffect(() => {
    if (due.length === 0) return;
    const i = window.setInterval(() => playReminderChime(), 30_000);
    return () => window.clearInterval(i);
  }, [due.length]);

  useEffect(() => {
    if (!shouldStopOnAnesthesiaEnd({ anesthesiaEndAt: c.anesthesiaEndAt, stage: c.stage })) {
      stoppedForEnd.current = false;
      return;
    }
    if (stoppedForEnd.current || rows.length === 0) return;
    stoppedForEnd.current = true;
    void (async () => {
      const iso = now();
      for (const t of rows) await persist(stopTimer(t, iso));
    })();
  }, [c.anesthesiaEndAt, c.stage, rows.length]);

  const persist = async (row: CaseTimer) => {
    onSaved('saving');
    await saveWithAudit(db.caseTimers, 'CaseTimer', row, { caseId: c.id });
    onSaved('saved');
  };

  const startRepeat = async (admin: DrugAdmin, intervalMin: number, from = admin.givenAt) => {
    const interval = parseIntervalMin(intervalMin);
    if (!interval) return;
    const iso = now();
    const existing = liveTimers(await db.caseTimers.where('caseId').equals(c.id).toArray())
      .filter(t => t.kind === 'repeat' && t.drugId === admin.drugId);
    for (const t of existing) await persist(stopTimer(t, iso));
    const rec: CaseTimer = {
      ...meta(), caseId: c.id, kind: 'repeat', title: admin.drugNameSnapshot,
      drugId: admin.drugId, drugAdminId: admin.id, intervalMin: interval,
      dueAt: dueAtFrom(from || iso, interval), startedAt: from || iso, status: 'running',
    };
    await persist(rec);
    setDraft(null);
  };

  const startOnce = async (title: string, intervalMin: number, extra: Partial<CaseTimer> = {}) => {
    const interval = parseIntervalMin(intervalMin);
    if (!interval) return;
    const iso = now();
    const rec: CaseTimer = {
      ...meta(), caseId: c.id, kind: 'once', title: title.trim() || 'Напоминание',
      intervalMin: interval, dueAt: dueAtFrom(iso, interval), startedAt: iso, status: 'running',
      ...extra,
    };
    await persist(rec);
    setDraft(null);
  };

  const give = async (t: CaseTimer) => {
    unlockReminderAudio();
    if (t.kind !== 'repeat' || !t.drugAdminId && !t.drugId) {
      await persist(stopTimer(t, now()));
      return;
    }
    const prev = t.drugAdminId
      ? await db.drugAdmins.get(t.drugAdminId)
      : (await db.drugAdmins.where('caseId').equals(c.id).toArray())
        .filter(a => !a.deletedAt && a.drugId === t.drugId)
        .sort((a, b) => b.givenAt.localeCompare(a.givenAt))[0];
    if (!prev) return;
    const next = repeatDrugAdmin(c, prev);
    onSaved('saving');
    const saved = await saveWithAudit(db.drugAdmins, 'DrugAdmin', next, { caseId: c.id, reason: 'таймер: ввёл' });
    await persist(restartRepeat(t, saved.givenAt, { drugAdminId: saved.id }));
    onSaved('saved');
  };

  const plus5 = (t: CaseTimer) => { unlockReminderAudio(); void persist(snoozeTimer(t, now(), 5)); };
  const stop = (t: CaseTimer) => { unlockReminderAudio(); void persist(stopTimer(t, now())); };

  if (rows.length === 0 && !draft && !flash) return null;

  return <>
    {flash && <div className="remind-flash" aria-hidden="true" />}
    {rows.length > 0 && <div className={`tmr-bar ${due.length ? 'due' : ''}`}>
      <div className="tmr-chips">
        {rows.map(t => {
          const late = isTimerDue(t, nowDt);
          return <button key={t.id} type="button" className={`tmr-chip ${late ? 'due' : ''}`}
            onClick={() => { /* баннер уже виден, если due; иначе ничего */ }}>
            <b>{t.title}</b>
            <span>{formatTimerCountdown(t.dueAt, nowDt)}</span>
          </button>;
        })}
      </div>
      <button type="button" className="btn sm sec tmr-add" onClick={() => setDraft({ type: 'free' })}>+ Таймер</button>
    </div>}
    {due.map(t => <div key={t.id} className="remind-banner tmr-banner">
      <div>
        <b>{timerBannerTitle(t)}</b>
        <div className="muted small">{formatTimerCountdown(t.dueAt, nowDt)}{t.kind === 'repeat' && t.intervalMin ? ` · каждые ${formatInterval(t.intervalMin)}` : ''}</div>
      </div>
      <div className="row" style={{ gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        {t.kind === 'repeat' && <button type="button" className="btn sm pri" onClick={() => void give(t)}>Ввёл</button>}
        {t.kind === 'once' && <button type="button" className="btn sm pri" onClick={() => void stop(t)}>Ок</button>}
        <button type="button" className="btn sm sec" onClick={() => plus5(t)}>+5 мин</button>
        <button type="button" className="btn sm sec" onClick={() => stop(t)}>Остановить</button>
      </div>
    </div>)}
    {draft && <TimerSheet req={draft} onCancel={() => setDraft(null)}
      onRepeat={(admin, min) => void startRepeat(admin, min)}
      onOnce={(title, min, extra) => void startOnce(title, min, extra)} />}
  </>;
}

function TimerSheet({ req, onCancel, onRepeat, onOnce }: {
  req: TimerStartRequest;
  onCancel: () => void;
  onRepeat: (admin: DrugAdmin, min: number) => void;
  onOnce: (title: string, min: number, extra?: Partial<CaseTimer>) => void;
}) {
  const isRepeat = req.type === 'repeat';
  const isBlock = req.type === 'block';
  const defaultMin = parseIntervalMin(req.type === 'free' ? null : req.intervalMin);
  const [min, setMin] = useState(defaultMin);
  const [custom, setCustom] = useState(defaultMin != null && !INTERVAL_PRESETS.some(p => p.min === defaultMin) ? String(defaultMin) : '');
  const [unit, setUnit] = useState<'min' | 'h'>('min');
  const [title, setTitle] = useState(isBlock ? defaultBlockTimerTitle(req.block.blockName) : isRepeat ? req.admin.drugNameSnapshot : '');
  const chosen = parseIntervalMin(custom, unit) ?? min;
  const can = !!chosen && (isRepeat || isBlock || title.trim() !== '');
  const commit = () => {
    if (!chosen) return;
    if (isRepeat) onRepeat(req.admin, chosen);
    else if (isBlock) onOnce(title.trim() || defaultBlockTimerTitle(req.block.blockName), chosen, { regionalBlockId: req.block.id });
    else onOnce(title.trim(), chosen);
  };
  return <div className="ov center" onClick={onCancel} role="presentation">
    <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Таймер">
      <div className="grab" /><div className="sh">{isRepeat ? `Напомнить: ${req.admin.drugNameSnapshot}` : isBlock ? 'Оценить блок' : 'Таймер'}</div>
      {!isRepeat && <label className="field" style={{ marginBottom: 10 }}><span className="fl">Подпись</span>
        <input value={title} placeholder="например, оценить блок" onChange={e => setTitle(e.target.value)} /></label>}
      <div className="muted small" style={{ marginBottom: 8 }}>{isRepeat ? 'Отсчёт от времени введения' : 'Через сколько напомнить'}</div>
      <div className="chipbar">
        {INTERVAL_PRESETS.map(p =>
          <button key={p.min} type="button" className={`chip ${chosen === p.min && !custom.trim() ? 'on' : ''}`}
            onClick={() => { setMin(p.min); setCustom(''); setUnit('min'); }}>{p.ru}</button>)}
      </div>
      <div className="g g2" style={{ marginTop: 10 }}>
        <label className="field"><span className="fl">Свой интервал</span>
          <input inputMode="decimal" value={custom} placeholder="число" onChange={e => setCustom(e.target.value)} /></label>
        <div>
          <div className="fl" style={{ marginBottom: 6 }}>Единица</div>
          <div className="seg">
            <button type="button" className={unit === 'min' ? 'on' : ''} onClick={() => setUnit('min')}>мин</button>
            <button type="button" className={unit === 'h' ? 'on' : ''} onClick={() => setUnit('h')}>ч</button>
          </div>
        </div>
      </div>
      {req.type === 'repeat' && <div className="muted small" style={{ marginTop: 8 }}>Когда сработает, «Ввёл» запишет ту же дозу и путь и запустит таймер снова.</div>}
      <div className="row sheet-actions">
        <button type="button" className="btn sec" onClick={onCancel}>Отмена</button>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn pri" disabled={!can} onClick={commit}>Запустить</button>
      </div>
    </div>
  </div>;
}
