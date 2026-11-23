// Звук напоминания — Web Audio, без файлов из сети. На iOS контекст запускается только после жеста.
type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', fn: () => void) => void;
};

let ctx: AudioContext | null = null;
let lastChime = 0;
let wake: WakeLockSentinel | null = null;

function AC(): typeof AudioContext | undefined {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext || w.webkitAudioContext;
}

export function reminderAudioReady(): boolean {
  return !!ctx && ctx.state === 'running';
}

/** Вызывать из клика/переключателя: Safari не даёт звук без жеста. */
export function unlockReminderAudio(): void {
  const Ctor = AC();
  if (!Ctor) return;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
}

export function playReminderChime(minIntervalMs = 25_000): void {
  if (!ctx || ctx.state !== 'running') return;
  const now = performance.now();
  if (now - lastChime < minIntervalMs) return;
  lastChime = now;
  const t0 = ctx.currentTime;
  const beep = (freq: number, start: number, dur: number) => {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(start); o.stop(start + dur + 0.02);
  };
  beep(880, t0, 0.14);
  beep(1175, t0 + 0.18, 0.2);
}

export async function requestWakeLock(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return;
    if (wake && !wake.released) return;
    wake = await nav.wakeLock.request('screen');
    wake.addEventListener?.('release', () => { if (wake?.released) wake = null; });
  } catch {
    /* iOS или отказ — молча без блокировки сна */
  }
}

export async function releaseWakeLock(): Promise<void> {
  try { await wake?.release(); } catch { /* ignore */ }
  wake = null;
}

/** Держать экран, пока вкладка видима. Возвращает очистку. */
export function holdWakeLock(): () => void {
  const onVis = () => { if (document.visibilityState === 'visible') void requestWakeLock(); };
  void requestWakeLock();
  document.addEventListener('visibilitychange', onVis);
  return () => { document.removeEventListener('visibilitychange', onVis); void releaseWakeLock(); };
}
