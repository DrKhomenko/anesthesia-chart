import { useEffect, useRef, useState, type PointerEvent as PE } from 'react';
import { defaultQuad, detectScreenQuad, sanitizeQuad, type Point, type Pix, type Quad } from '../core/geom';
import { releaseCanvas } from './errorText';

function imageToPix(img: HTMLImageElement): Pix {
  const c = document.createElement('canvas');
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Нет canvas');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const pix = ctx.getImageData(0, 0, c.width, c.height);
  const copy: Pix = { data: new Uint8ClampedArray(pix.data), width: c.width, height: c.height };
  releaseCanvas(c);
  return copy;
}

const LABELS: { key: keyof Quad; ru: string }[] = [
  { key: 'tl', ru: 'ЛВ' }, { key: 'tr', ru: 'ПВ' }, { key: 'br', ru: 'ПН' }, { key: 'bl', ru: 'ЛН' },
];

export function ScreenAlign({ src, onCancel, onConfirm, initialQuad }: {
  src: string; onCancel: () => void; onConfirm: (quad: Quad) => void; initialQuad?: Quad;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [quad, setQuad] = useState<Quad>(initialQuad ?? defaultQuad);
  const [ready, setReady] = useState(!!initialQuad);
  const drag = useRef<keyof Quad | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (initialQuad) { setReady(true); return; }
    const run = () => {
      try {
        const pix = imageToPix(img);
        const det = detectScreenQuad(pix);
        setQuad(det ?? defaultQuad());
      } catch { setQuad(defaultQuad()); }
      setReady(true);
    };
    if (img.complete && img.naturalWidth) run();
    else img.addEventListener('load', run, { once: true });
  }, [src]);

  const norm = (e: PE<HTMLElement>): Point | null => {
    const el = wrap.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const down = (key: keyof Quad) => (e: PE<HTMLButtonElement>) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = key;
  };
  const move = (e: PE<HTMLElement>) => {
    if (!drag.current) return;
    const p = norm(e); if (!p) return;
    const key = drag.current;
    setQuad(q => sanitizeQuad({ ...q, [key]: p }));
  };
  const up = () => { drag.current = null; };

  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  const poly = pts.map(p => `${p.x * 100}%,${p.y * 100}%`).join(' ');

  return <div className="ov center" onClick={onCancel} role="presentation">
    <div className="sheet wide" onClick={e => e.stopPropagation()} role="dialog" aria-label="Углы экрана">
      <div className="shtitle"><div className="ttl">Углы экрана прибора</div></div>
      <div className="muted small" style={{ marginBottom: 12 }}>
        Перетащите жёлтые точки на четыре угла экрана (не рамки корпуса), затем нажмите «Распознать».
        {!ready && ' Ищу экран на снимке…'}
      </div>
      <div className="align-wrap" ref={wrap} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <img ref={imgRef} src={src} alt="Снимок" draggable={false} />
        <svg className="align-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polygon points={poly} />
        </svg>
        {LABELS.map(({ key, ru }) => (
          <button key={key} type="button" className={`align-h ${key}`}
            style={{ left: `${quad[key].x * 100}%`, top: `${quad[key].y * 100}%` }}
            aria-label={`Угол ${ru}`}
            onPointerDown={down(key)} />
        ))}
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn sec" onClick={onCancel}>Отмена</button>
        <div style={{ flex: 1 }} />
        <button className="btn pri" onClick={() => onConfirm(sanitizeQuad(quad))}>Распознать</button>
      </div>
    </div>
  </div>;
}
