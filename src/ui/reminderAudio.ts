// Звук напоминаний и таймеров. На iOS контекст и <audio> разблокируются только жестом.
type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', fn: () => void) => void;
};

type AudioSessionNavigator = Navigator & {
  audioSession?: { type: string };
  wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> };
};

let ctx: AudioContext | null = null;
let lastChime = 0;
let wake: WakeLockSentinel | null = null;
let element: HTMLAudioElement | null = null;
let chimeUrl: string | null = null;
let unlocked = false;
let installed = false;

function AC(): typeof AudioContext | undefined {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext || w.webkitAudioContext;
}

function preferPlaybackSession(): void {
  try {
    const sess = (navigator as AudioSessionNavigator).audioSession;
    if (sess && sess.type !== 'playback') sess.type = 'playback';
  } catch { /* старые iOS без audioSession */ }
}

/** Короткий резкий сигнал ~1,6 с: несколько тонов, достаточно громко для операционной. */
export function buildChimeWav(sampleRate = 22050): Blob {
  const duration = 1.62;
  const n = Math.floor(sampleRate * duration);
  const data = new Int16Array(n);
  const beeps: { f: number; a0: number; a1: number; amp: number }[] = [
    { f: 880, a0: 0.00, a1: 0.16, amp: 0.62 },
    { f: 1175, a0: 0.22, a1: 0.40, amp: 0.68 },
    { f: 1480, a0: 0.46, a1: 0.66, amp: 0.72 },
    { f: 988, a0: 0.86, a1: 1.04, amp: 0.64 },
    { f: 1319, a0: 1.12, a1: 1.42, amp: 0.74 },
  ];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (const b of beeps) {
      if (t < b.a0 || t > b.a1) continue;
      const pos = (t - b.a0) / (b.a1 - b.a0);
      const env = pos < 0.08 ? pos / 0.08 : pos > 0.75 ? (1 - pos) / 0.25 : 1;
      // чуть острее синуса — лёгкая «пилообразность»
      const phase = 2 * Math.PI * b.f * t;
      s += b.amp * env * (Math.sin(phase) + 0.28 * Math.sin(phase * 2));
    }
    data[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  }
  const bytes = new ArrayBuffer(44 + n * 2);
  const v = new DataView(bytes);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  new Uint8Array(bytes, 44).set(new Uint8Array(data.buffer));
  return new Blob([bytes], { type: 'audio/wav' });
}

function ensureElement(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!chimeUrl) chimeUrl = URL.createObjectURL(buildChimeWav());
  if (!element) {
    element = new Audio(chimeUrl);
    element.preload = 'auto';
    element.setAttribute('playsinline', 'true');
    (element as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  }
  return element;
}

async function playSilentBuffer(c: AudioContext): Promise<void> {
  try {
    const buf = c.createBuffer(1, 1, c.sampleRate || 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch { /* ignore */ }
}

export function reminderAudioReady(): boolean {
  const elOk = !!element && unlocked;
  return elOk || (!!ctx && ctx.state === 'running');
}

/** Вызывать из жеста: Safari не даёт звук без касания. Повторно — после ухода вкладки в фон. */
export function unlockReminderAudio(): void {
  void unlockReminderAudioAsync();
}

export async function unlockReminderAudioAsync(): Promise<boolean> {
  preferPlaybackSession();
  const Ctor = AC();
  try {
    if (Ctor) {
      if (!ctx) {
        ctx = new Ctor();
        ctx.addEventListener('statechange', () => {
          if (ctx && (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted')) unlocked = false;
        });
      }
      if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') await ctx.resume();
      await playSilentBuffer(ctx);
    }
  } catch { /* Web Audio недоступен — остаётся <audio> */ }

  const el = ensureElement();
  if (el) {
    try {
      el.muted = true;
      el.volume = 0;
      el.currentTime = 0;
      const p = el.play();
      if (p) await p.catch(() => undefined);
      el.pause();
      el.currentTime = 0;
      el.muted = false;
      el.volume = 1;
    } catch { /* понадобится следующий жест */ }
  }
  unlocked = (!!ctx && ctx.state === 'running') || !!el;
  return unlocked;
}

function playWebChime(c: AudioContext): void {
  const t0 = c.currentTime;
  const beep = (freq: number, start: number, dur: number, gain = 0.42) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(c.destination);
    o.start(start); o.stop(start + dur + 0.03);
  };
  beep(880, t0, 0.16, 0.4);
  beep(1175, t0 + 0.22, 0.18, 0.46);
  beep(1480, t0 + 0.46, 0.2, 0.5);
  beep(988, t0 + 0.86, 0.18, 0.44);
  beep(1319, t0 + 1.12, 0.3, 0.52);
}

export function playReminderChime(minIntervalMs = 25_000): void {
  const now = performance.now();
  if (minIntervalMs > 0 && now - lastChime < minIntervalMs) return;
  lastChime = now;
  preferPlaybackSession();
  if (ctx && ctx.state === 'running') {
    try { playWebChime(ctx); } catch { /* fallback ниже */ }
  }
  const el = ensureElement();
  if (el) {
    try {
      el.muted = false;
      el.volume = 1;
      el.currentTime = 0;
      void el.play()?.catch(() => { if (ctx?.state !== 'running') unlockReminderAudio(); });
    } catch { /* ignore */ }
  }
}

/** Первое любое касание страницы разблокирует звук; после возврата на вкладку — повторная попытка. */
export function installReminderAudioUnlock(): () => void {
  if (installed) return () => undefined;
  installed = true;
  const onGesture = () => { void unlockReminderAudioAsync(); };
  const onVis = () => {
    if (document.visibilityState !== 'visible') return;
    preferPlaybackSession();
    if (ctx && ctx.state !== 'running') void unlockReminderAudioAsync();
    else if (ctx && ctx.state === 'running') void playSilentBuffer(ctx);
  };
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('touchend', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pageshow', onVis);
  return () => {
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('touchend', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pageshow', onVis);
    installed = false;
  };
}

export async function requestWakeLock(): Promise<void> {
  try {
    const nav = navigator as AudioSessionNavigator;
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
