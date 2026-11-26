import { useEffect, useRef, useState } from 'react';
import { getLocalSettings, updateLocalSettings, type CaseRec, type LocalSettings } from '../db/db';
import {
  formatCountdown, isReminderDue, lastVitalsAt, msUntilDue, normalizeReminderInterval,
  reminderActive, snoozeUntil,
} from '../core/reminder';
import { holdWakeLock, playReminderChime, reminderAudioReady, unlockReminderAudio } from './reminderAudio';

export function ReminderBar({ c, ticks, onAddEntry }: {
  c: CaseRec;
  ticks: { at: string; deletedAt?: string | null }[];
  onAddEntry: () => void;
}) {
  const [loc, setLoc] = useState<LocalSettings | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [snooze, setSnooze] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const openedAt = useRef(new Date().toISOString());
  const wasDue = useRef(false);

  useEffect(() => { void getLocalSettings().then(s => { setLoc(s); setSoundOn(reminderAudioReady()); }); }, []);
  useEffect(() => {
    const i = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(i);
  }, []);

  const enabled = loc ? loc.reminderEnabled !== false : true;
  const interval = normalizeReminderInterval(loc?.reminderIntervalMin);
  const active = reminderActive({
    enabled, stage: c.stage, anesthesiaStartAt: c.anesthesiaStartAt,
    anesthesiaEndAt: c.anesthesiaEndAt, isLocked: c.isLocked,
  });
  const last = lastVitalsAt(ticks);
  const due = active && isReminderDue({
    now, lastVitalsAt: last, anesthesiaStartAt: c.anesthesiaStartAt,
    fallbackAt: openedAt.current, intervalMin: interval, snoozeUntil: snooze,
  });
  const left = msUntilDue({
    now, lastVitalsAt: last, anesthesiaStartAt: c.anesthesiaStartAt,
    fallbackAt: openedAt.current, intervalMin: interval, snoozeUntil: snooze,
  });

  useEffect(() => { setSnooze(null); }, [last]);

  useEffect(() => {
    if (!active) return;
    return holdWakeLock();
  }, [active]);

  useEffect(() => {
    if (due && !wasDue.current) {
      setFlash(true);
      playReminderChime(0);
      const t = window.setTimeout(() => setFlash(false), 900);
      wasDue.current = true;
      return () => window.clearTimeout(t);
    }
    if (!due) wasDue.current = false;
  }, [due]);

  useEffect(() => {
    if (!due || !active) return;
    const i = window.setInterval(() => playReminderChime(), 30_000);
    return () => window.clearInterval(i);
  }, [due, active]);

  const persist = async (patch: Partial<LocalSettings>, unlock = false) => {
    if (unlock) {
      unlockReminderAudio();
      setSoundOn(reminderAudioReady());
      window.setTimeout(() => setSoundOn(reminderAudioReady()), 200);
    }
    const next = await updateLocalSettings(patch);
    setLoc(next);
  };

  const toggle = () => {
    void persist({ reminderEnabled: !enabled }, true);
  };
  const later = () => {
    unlockReminderAudio();
    setSnooze(snoozeUntil(new Date(), interval));
    setFlash(false);
  };
  const add = () => {
    unlockReminderAudio();
    setSoundOn(reminderAudioReady());
    onAddEntry();
  };

  return <>
    {flash && <div className="remind-flash" aria-hidden="true" />}
    <section className={`card remind-card ${due ? 'due' : ''}`}>
      <div className="remind-row">
        <button type="button" className="toggle remind-tog" onClick={toggle} aria-pressed={enabled}>
          <span>Напоминать каждые {interval} мин</span>
          <span className={`knob ${enabled ? 'on' : ''}`}><i /></span>
        </button>
      </div>
      {active && !due && <div className="muted small" style={{ marginTop: 8 }}>
        Следующая запись через {formatCountdown(left)}
        {last ? '' : c.anesthesiaStartAt ? ' · отсчёт от начала анестезии' : ''}
      </div>}
      {due && <div className="remind-banner">
        <div>
          <b>Пора внести показатели</b>
          <div className="muted small">Прошло больше {interval} мин с последней записи</div>
        </div>
        <div className="row" style={{ gap: 8, flexShrink: 0 }}>
          <button type="button" className="btn sm sec" onClick={later}>Позже</button>
          <button type="button" className="btn sm pri" onClick={add}>+ Запись</button>
        </div>
      </div>}
      {active && due && !soundOn && <button type="button" className="link" style={{ marginTop: 8 }} onClick={() => { unlockReminderAudio(); setSoundOn(true); playReminderChime(0); }}>
        Коснитесь, чтобы включить звук
      </button>}
      {!active && enabled && (c.anesthesiaEndAt || c.stage === 'closed') && <div className="muted small" style={{ marginTop: 8 }}>Напоминания выключены: анестезия окончена.</div>}
    </section>
  </>;
}
