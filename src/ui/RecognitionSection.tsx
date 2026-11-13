import { useEffect, useState } from 'react';
import { getLocalSettings, saveLocalSettings, type LocalSettings, type RecognitionProvider } from '../db/db';
import {
  OPENROUTER_BASE_URL, OPENROUTER_DEFAULT_MODEL, OPENROUTER_FREE_VISION_MODELS, OPENROUTER_KEYS_URL,
  applyOpenRouterFreePreset, isOpenRouterUrl,
} from './visionClient';

const CUSTOM_MODEL = '__custom__';

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
  const [customModel, setCustomModel] = useState(false);
  useEffect(() => { void getLocalSettings().then(v => {
    setS(v);
    setKeyDraft(v.recognitionApiKey);
    const known = OPENROUTER_FREE_VISION_MODELS.some(m => m.id === v.recognitionModel);
    setCustomModel(!!v.recognitionModel && !known);
  }); }, []);
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
  const provider: RecognitionProvider = s.recognitionProvider === 'cloud' ? 'cloud' : 'on-device';
  const openRouterOn = provider === 'cloud' && isOpenRouterUrl(s.recognitionBaseUrl);
  const knownModel = OPENROUTER_FREE_VISION_MODELS.some(m => m.id === s.recognitionModel);
  const applyOpenRouter = () => {
    const preset = applyOpenRouterFreePreset(s);
    setCustomModel(!OPENROUTER_FREE_VISION_MODELS.some(m => m.id === preset.recognitionModel));
    patch(preset);
  };
  const onModelSelect = (value: string) => {
    if (value === CUSTOM_MODEL) {
      setCustomModel(true);
      return;
    }
    setCustomModel(false);
    patch({ recognitionModel: value });
  };
  return <section className="card" style={{ marginTop: 16 }} data-section="recognition">
    <div className="h">Распознавание</div>
    <div className="g">
      <div>
        <div className="muted small" style={{ marginBottom: 6 }}>Способ</div>
        <div className="seg">
          <button type="button" className={provider === 'on-device' ? 'on' : ''} onClick={() => patch({ recognitionProvider: 'on-device' })}>На устройстве (бесплатно, офлайн)</button>
          <button type="button" className={provider === 'cloud' ? 'on' : ''} onClick={() => patch({ recognitionProvider: 'cloud' })}>Облако (ключ API)</button>
        </div>
      </div>
      <div>
        <div className="muted small" style={{ marginBottom: 6 }}>Готовый набор</div>
        <div className="seg">
          <button type="button" className={openRouterOn ? 'on' : ''} onClick={applyOpenRouter}>OpenRouter — бесплатно</button>
        </div>
      </div>
      {provider === 'on-device' && <div className="muted small">Цифры читает встроенный распознаватель прямо на iPad и iPhone, интернет не нужен. После первой загрузки с сетью (около 7 МБ) всё работает офлайн. Сначала отметьте углы экрана на фото, затем проверьте цифры на листе подтверждения. Для более точного чтения экрана монитора можно включить «OpenRouter — бесплатно».</div>}
      {provider === 'cloud' && <>
        <div className="g g2">
          <label className="field"><span className="fl">Адрес сервера (OpenAI-совместимый)</span>
            <input value={s.recognitionBaseUrl} placeholder={OPENROUTER_BASE_URL} autoComplete="off"
              onChange={e => patch({ recognitionBaseUrl: e.target.value })} /></label>
          <label className="field"><span className="fl">Модель</span>
            <select
              value={customModel || !knownModel ? CUSTOM_MODEL : s.recognitionModel}
              onChange={e => onModelSelect(e.target.value)}
            >
              {OPENROUTER_FREE_VISION_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              <option value={CUSTOM_MODEL}>Другая модель…</option>
            </select>
          </label>
        </div>
        {(customModel || !knownModel) && <label className="field"><span className="fl">Идентификатор модели</span>
          <input value={s.recognitionModel} placeholder={OPENROUTER_DEFAULT_MODEL} autoComplete="off"
            onChange={e => patch({ recognitionModel: e.target.value })} /></label>}
        <div className="row" style={{ alignItems: 'stretch' }}>
          <label className="field" style={{ flex: 1 }}><span className="fl">Ключ API</span>
            <input type={show ? 'text' : 'password'} value={keyDirty ? keyDraft : (show ? s.recognitionApiKey : maskKey(s.recognitionApiKey) || keyDraft)}
              placeholder="ключ остаётся только на этом устройстве" autoComplete="off"
              onFocus={() => { if (!keyDirty) { setKeyDraft(s.recognitionApiKey); setKeyDirty(true); } }}
              onChange={e => { setKeyDraft(e.target.value); setKeyDirty(true); }}
              onBlur={saveKey} /></label>
          <button className="btn sm sec" onClick={() => setShow(v => !v)}>{show ? 'Скрыть' : 'Показать'}</button>
        </div>
        {openRouterOn
          ? <div className="muted small">Бесплатный ключ можно получить на <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>openrouter.ai/keys</a> (нужна регистрация). Ключ хранится только на этом устройстве. Если облако не ответит или закончится лимит, программа сама попробует распознаватель на устройстве и откроет лист подтверждения.</div>
          : <div className="muted small">Ключ хранится только на этом устройстве, в историю правок не попадает. Запрос идёт прямо с планшета, поэтому обычный api.openai.com из Safari не подойдёт: нужен адрес, который разрешает запросы из браузера (например OpenRouter), либо свой прокси.</div>}
      </>}
      <button type="button" className="toggle" onClick={() => patch({ storePhotoThumbnail: !s.storePhotoThumbnail })}>
        <span>Хранить уменьшенное фото снимка в карте</span>
        <span className={`knob ${s.storePhotoThumbnail ? 'on' : ''}`}><i /></span>
      </button>
      <div className="muted small">По умолчанию фото не сохраняется — в карту попадают только подтверждённые цифры.</div>
    </div>
  </section>;
}
