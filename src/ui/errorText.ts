/** Текст ошибки из любого thrown-значения: Error, DOMException, строка, событие воркера. */
export function errorText(e: unknown): string {
  if (e == null) return 'неизвестная ошибка';
  if (typeof e === 'string') {
    const s = e.trim();
    return s || 'неизвестная ошибка';
  }
  if (e instanceof Error) {
    const msg = (e.message || '').trim();
    return msg || e.name || 'неизвестная ошибка';
  }
  if (typeof e === 'object') {
    const o = e as { message?: unknown; name?: unknown; type?: unknown };
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
    if (typeof o.type === 'string' && o.type.trim()) return o.type.trim();
  }
  try {
    const s = String(e).trim();
    return s && s !== '[object Object]' ? s : 'неизвестная ошибка';
  } catch {
    return 'неизвестная ошибка';
  }
}

export function stepError(step: string, e: unknown): Error {
  const text = errorText(e);
  const err = new Error(text.startsWith(`${step}:`) ? text : `${step}: ${text}`);
  return err;
}

export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

export function releaseCanvas(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}
