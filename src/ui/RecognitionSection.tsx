import { useEffect, useState } from 'react';
import { getLocalSettings, saveLocalSettings, type LocalSettings } from '../db/db';

function maskKey(k: string): string {
  const s = k.trim();
  if (s.length <= 8) return s ? '••••' : '';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function RecognitionSection({ onSaved }: { onSaved: (fn: () => Promise<unknown>) => void }) {
  const [s, setS] = useState<LocalSettings | null>(null);
  const [show, setShow] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);
  useEffect(() => { void getLocalSettings().then(v => { setS(v); setKeyDraft(v.recognitionApiKey); }); }, []);
  if (!s) return null;
  const patch = (p: Partial<LocalSettings>) => {
    const next = { ...s, ...p };
    setS(next);
    onSaved(() => saveLocalSettings(next));
  };
  const saveKey = () => {
    if (!keyDirty) return;
    patch({ recognitionApiKey: keyDraft.trim() });
    setKeyDirty(false);
  };
  return <section className="card" style={{ marginTop: 16 }} data-section="recognition">
    <div className="h">Распознавание</div>
    <div className="g">
      <div className="g g2">
        <label className="field"><span className="fl">Адрес сервера (OpenAI-совместимый)</span>
          <input value={s.recognitionBaseUrl} placeholder="https://openrouter.ai/api/v1" autoComplete="off"
            onChange={e => patch({ recognitionBaseUrl: e.target.value })} /></label>
        <label className="field"><span className="fl">Модель</span>
          <input value={s.recognitionModel} placeholder="openai/gpt-4o" autoComplete="off"
            onChange={e => patch({ recognitionModel: e.target.value })} /></label>
      </div>
      <div className="row" style={{ alignItems: 'stretch' }}>
        <label className="field" style={{ flex: 1 }}><span className="fl">Ключ API</span>
          <input type={show ? 'text' : 'password'} value={keyDirty ? keyDraft : (show ? s.recognitionApiKey : maskKey(s.recognitionApiKey) || keyDraft)}
            placeholder="ключ остаётся только на этом iPad" autoComplete="off"
            onFocus={() => { if (!keyDirty) { setKeyDraft(s.recognitionApiKey); setKeyDirty(true); } }}
            onChange={e => { setKeyDraft(e.target.value); setKeyDirty(true); }}
            onBlur={saveKey} /></label>
        <button className="btn sm sec" onClick={() => setShow(v => !v)}>{show ? 'Скрыть' : 'Показать'}</button>
      </div>
      <button type="button" className="toggle" onClick={() => patch({ storePhotoThumbnail: !s.storePhotoThumbnail })}>
        <span>Хранить уменьшенное фото снимка в карте</span>
        <span className={`knob ${s.storePhotoThumbnail ? 'on' : ''}`}><i /></span>
      </button>
      <div className="muted small">Ключ хранится только на этом планшете, в историю правок не попадает. По умолчанию фото не сохраняется — в карту попадают только подтверждённые цифры. Запрос идёт прямо с iPad, поэтому обычный api.openai.com из Safari не подойдёт: нужен адрес, который разрешает запросы из браузера (например OpenRouter), либо свой прокси.</div>
    </div>
  </section>;
}
