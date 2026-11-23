import { useEffect, useRef, useState } from 'react';
import { db, saveWithAudit, type CaseRec } from '../db/db';

/** Текущий сброс черновика открытой карты — чтобы уйти к списку, не потеряв правку за последние 400 мс. */
let flusher: (() => Promise<void>) | null = null;
export function setCaseFlusher(fn: (() => Promise<void>) | null): void {
  flusher = fn;
}
export async function flushOpenCase(): Promise<void> {
  if (flusher) await flusher();
}

/** Карта в памяти + автосохранение в IndexedDB через 400 мс после правки. */
export function useCaseDraft(id: string, onSaved: (state: 'saving' | 'saved') => void) {
  const [c, setC] = useState<CaseRec | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<CaseRec | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  useEffect(() => { db.cases.get(id).then(r => { if (r) { latest.current = r; setC(r); } }); }, [id]);
  const flush = async () => {
    window.clearTimeout(timer.current); timer.current = undefined;
    if (!latest.current) return;
    const saved = await saveWithAudit(db.cases, 'Case', latest.current, { caseId: latest.current.id });
    latest.current = { ...latest.current, version: saved.version, updatedAt: saved.updatedAt, syncState: saved.syncState };
    onSavedRef.current('saved');
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const run = () => flushRef.current();
    setCaseFlusher(run);
    return () => {
      setCaseFlusher(null);
      if (timer.current) void run();
    };
  }, [id]);
  const update = (patch: Partial<CaseRec>) => {
    if (!latest.current) return;
    latest.current = { ...latest.current, ...patch }; setC(latest.current); onSaved('saving');
    window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { void flushRef.current(); }, 400);
  };
  return { c, update, flush };
}
