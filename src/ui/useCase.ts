import { useEffect, useRef, useState } from 'react';
import { db, saveWithAudit, type CaseRec } from '../db/db';

/** Карта в памяти + автосохранение в IndexedDB через 400 мс после правки. */
export function useCaseDraft(id: string, onSaved: (state: 'saving' | 'saved') => void) {
  const [c, setC] = useState<CaseRec | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<CaseRec | null>(null);
  useEffect(() => { db.cases.get(id).then(r => { if (r) { latest.current = r; setC(r); } }); }, [id]);
  const flush = async () => {
    window.clearTimeout(timer.current); timer.current = undefined;
    if (!latest.current) return;
    const saved = await saveWithAudit(db.cases, 'Case', latest.current, { caseId: latest.current.id });
    latest.current = { ...latest.current, version: saved.version, updatedAt: saved.updatedAt, syncState: saved.syncState };
    onSaved('saved');
  };
  useEffect(() => () => { if (timer.current) void flush(); }, []);
  const update = (patch: Partial<CaseRec>) => {
    if (!latest.current) return;
    latest.current = { ...latest.current, ...patch }; setC(latest.current); onSaved('saving');
    window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, 400);
  };
  return { c, update, flush };
}
