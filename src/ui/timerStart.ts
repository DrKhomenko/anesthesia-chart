import type { DrugAdmin, RegionalBlock } from '../db/db';

export type TimerStartRequest =
  | { type: 'repeat'; admin: DrugAdmin; intervalMin?: number | null; offer?: boolean }
  | { type: 'block'; block: RegionalBlock; intervalMin?: number | null }
  | { type: 'free' };

type Listener = (req: TimerStartRequest) => void;
let listener: Listener | null = null;

export function requestTimerStart(req: TimerStartRequest): void {
  listener?.(req);
}

export function onTimerStartRequest(fn: Listener): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}
