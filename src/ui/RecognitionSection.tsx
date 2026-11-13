import { useEffect, useRef, useState } from 'react';
import { getLocalSettings, saveLocalSettings, type LocalSettings, type RecognitionProvider } from '../db/db';
import {
  ALL_KNOWN_VISION_MODELS, OPENROUTER_BASE_URL, OPENROUTER_CREDITS_URL, OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_FREE_VISION_MODELS, OPENROUTER_KEYS_URL, OPENROUTER_PAID_FALLBACK_MODELS,
  OPENROUTER_PAID_VISION_MODELS, applyOpenRouterFreePreset, applyOpenRouterPaidPreset,
  isOpenRouterUrl, parseModelList, probeRecognition,
} from './visionClient';

const CUSTOM_MODEL = '__custom__';

function maskKey(k: string): string {
  const s = k.trim();
  if (s.length <= 8) return s ? '••••' : '';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function isPaidPreset(s: LocalSettings): boolean {
  return s.recognitionProvider === 'cloud' && isOpenRouterUrl(s.recognitionBaseUrl)
    && OPENROUTER_PAID_VISION_MODELS.some(m => m.id === s.recognitionModel);
}

function isFreePreset(s: LocalSettings): boolean {
  return s.recognitionProvider === 'cloud' && isOpenRouterUrl(s.recognitionBaseUrl)
    && OPENROUTER_FREE_VISION_MODELS.some(m => m.id === s.recognitionModel)
    && !isPaidPreset(s);
}

export function RecognitionSection({ onSaved }: { onSaved: (fn: () => Promise<unknown>) => void }) {
  const [s, setS] = useState<LocalSettings | null>(null);
  const [show, setShow] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyDirty, setKeyDirty] = useState(false);
  const [keyFocus, setKeyFocus] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [probe, setProbe] = useState<{ busy: boolean; text: string; ok: boolean | null }>({ busy: false, text: '', ok: null });
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sRef = useRef<LocalSettings | null>(null);
  const draftRef = useRef('');
  const dirtyRef = useRef(false);

  useEffect(() => { void getLocalSettings().then(v => {
    setS(v);
    setKeyDraft(v.recognitionApiKey);
    setCustomModel(!!v.recognitionModel && !ALL_KNOWN_VISION_MODELS.some(m => m.id === v.recognitionModel));
  }); }, []);
  useEffect(() => { sRef.current = s; }, [s]);
  useEffect(() => { draftRef.current = keyDraft; dirtyRef.current = keyDirty; }, [keyDraft, keyDirty]);
  useEffect(() => () => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
    if (dirtyRef.current && sRef.current) {
      const next = { ...sRef.current, recognitionApiKey: draftRef.current.trim() };
      void saveLocalSettings(next);
    }
  }, []);

  if (!s) return null;

  const patch = (p: Partial<LocalSettings>) => {
    const next = { ...s, ...p };
    setS(next);
    sRef.current = next;
    onSaved(() => saveLocalSettings(next));
  };
  const saveKey = (value = keyDraft) => {
    const trimmed = value.trim();
    if (keyTimer.current) { clearTimeout(keyTimer.current); keyTimer.current = null; }
    patch({ recognitionApiKey: trimmed });
    setKeyDirty(false);
    dirtyRef.current = false;
  };
  const onKeyChange = (value: string) => {
    setKeyDraft(value);
    setKeyDirty(true);
    dirtyRef.current = true;
    draftRef.current = value;
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => saveKey(value), 400);
  };

  const provider: RecognitionProvider = s.recognitionProvider === 'cloud' ? 'cloud' : 'on-device';
  const openRouterOn = provider === 'cloud' && isOpenRouterUrl(s.recognitionBaseUrl);
  const paidOn = isPaidPreset(s) || (openRouterOn && !isFreePreset(s) && !OPENROUTER_FREE_VISION_MODELS.some(m => m.id === s.recognitionModel));
  const freeOn = isFreePreset(s);
  const knownModel = ALL_KNOWN_VISION_MODELS.some(m => m.id === s.recognitionModel);
  const keySaved = !keyDirty && !!s.recognitionApiKey.trim();

  const applyPaid = () => {
    const preset = applyOpenRouterPaidPreset(s);
    setCustomModel(!ALL_KNOWN_VISION_MODELS.some(m => m.id === preset.recognitionModel));
    patch({ ...preset, recognitionApiKey: keyDirty ? keyDraft.trim() : s.recognitionApiKey });
    setKeyDirty(false);
  };
  const applyFree = () => {
    const preset = applyOpenRouterFreePreset(s);
    setCustomModel(!ALL_KNOWN_VISION_MODELS.some(m => m.id === preset.recognitionModel));
    patch({ ...preset, recognitionApiKey: keyDirty ? keyDraft.trim() : s.recognitionApiKey });
    setKeyDirty(false);
  };
  const onCloudClick = () => {
    if (!s.recognitionBaseUrl.trim()) applyPaid();
    else patch({ recognitionProvider: 'cloud' });
  };
  const onModelSelect = (value: string) => {
    if (value === CUSTOM_MODEL) {
      setCustomModel(true);
      return;
    }
    setCustomModel(false);
    patch({ recognitionModel: value });
  };
  const onProbe = async () => {
    if (keyDirty) saveKey();
    const settings = { ...(sRef.current ?? s), recognitionApiKey: (keyDirty ? keyDraft : s.recognitionApiKey).trim() };
    if (!settings.recognitionApiKey || !settings.recognitionBaseUrl.trim() || !settings.recognitionModel.trim()) {
      setProbe({ busy: false, text: 'Сначала вставьте ключ и выберите модель.', ok: false });
      return;
    }
    setProbe({ busy: true, text: 'Проверяю…', ok: null });
    const res = await probeRecognition({
      baseUrl: settings.recognitionBaseUrl, model: settings.recognitionModel, apiKey: settings.recognitionApiKey,
    });
    setProbe({ busy: false, text: res.ok ? res.detail : res.error, ok: res.ok });
  };

  return <section className="card" style={{ marginTop: 16 }} data-section="recognition">
    <div className="h">Распознавание</div>
    <div className="g">
      <div>
        <div className="muted small" style={{ marginBottom: 6 }}>Способ</div>
        <div className="seg">
          <button type="button" className={provider === 'on-device' ? 'on' : ''} onClick={() => patch({ recognitionProvider: 'on-device' })}>На устройстве (бесплатно, офлайн)</button>
          <button type="button" className={provider === 'cloud' ? 'on' : ''} onClick={onCloudClick}>Облако (ключ API)</button>
        </div>
      </div>
      <div>
        <div className="muted small" style={{ marginBottom: 6 }}>Готовый набор</div>
        <div className="seg">
          <button type="button" className={paidOn ? 'on' : ''} onClick={applyPaid}>OpenRouter</button>
          <button type="button" className={freeOn ? 'on' : ''} onClick={applyFree}>OpenRouter — бесплатно</button>
        </div>
      </div>
      {provider === 'on-device' && <div className="muted small">Цифры читает встроенный распознаватель прямо на iPad и iPhone, интернет не нужен. После первой загрузки с сетью (около 7 МБ) всё работает офлайн. Сначала отметьте углы экрана на фото, затем проверьте цифры на листе подтверждения. Для точного чтения экрана монитора включите набор «OpenRouter» (платная модель, около копейки за снимок).</div>}
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
              <optgroup label="Платные">
                {OPENROUTER_PAID_VISION_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </optgroup>
              <optgroup label="Бесплатные">
                {OPENROUTER_FREE_VISION_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </optgroup>
              <option value={CUSTOM_MODEL}>Другая модель…</option>
            </select>
          </label>
        </div>
        {(customModel || !knownModel) && <label className="field"><span className="fl">Идентификатор модели</span>
          <input value={s.recognitionModel} placeholder={OPENROUTER_DEFAULT_MODEL} autoComplete="off"
            onChange={e => patch({ recognitionModel: e.target.value })} /></label>}
        <label className="field"><span className="fl">Запасные модели (через запятую)</span>
          <input value={s.recognitionFallbackModels.join(', ')} autoComplete="off"
            placeholder={OPENROUTER_PAID_FALLBACK_MODELS.join(', ')}
            onChange={e => patch({ recognitionFallbackModels: parseModelList(e.target.value) })} /></label>
        <div className="row" style={{ alignItems: 'stretch' }}>
          <label className="field" style={{ flex: 1 }}><span className="fl">Ключ API</span>
            <input type={show ? 'text' : 'password'} value={keyDirty || keyFocus || show ? (keyDirty ? keyDraft : s.recognitionApiKey) : (maskKey(s.recognitionApiKey) || keyDraft)}
              placeholder="ключ остаётся только на этом устройстве" autoComplete="off"
              onFocus={() => { setKeyFocus(true); if (!keyDirty) setKeyDraft(s.recognitionApiKey); }}
              onChange={e => onKeyChange(e.target.value)}
              onBlur={() => { setKeyFocus(false); if (keyDirty) saveKey(); }} /></label>
          <button className="btn sm sec" onClick={() => setShow(v => !v)}>{show ? 'Скрыть' : 'Показать'}</button>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {keySaved
            ? <span className="muted small" style={{ color: 'var(--green)' }}>Ключ сохранён ✓</span>
            : keyDirty
              ? <span className="muted small">Ключ сохранится через мгновение…</span>
              : <span className="muted small">Ключ ещё не сохранён</span>}
          <button type="button" className="btn sm sec" disabled={probe.busy} onClick={() => void onProbe()}>Проверить подключение</button>
        </div>
        {probe.text && <div className={probe.ok ? 'note' : 'warn'} style={{ marginTop: 0 }}>{probe.text}{probe.text === 'Пополните баланс OpenRouter' ? <> · <a href={OPENROUTER_CREDITS_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>пополнить</a></> : null}</div>}
        {openRouterOn
          ? <div className="muted small">Ключ можно получить на <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', textDecoration: 'underline' }}>openrouter.ai/keys</a>. Он хранится только на этом устройстве. Набор «OpenRouter» использует платную модель Gemini 2.5 Flash: это примерно копейка за снимок, нужен баланс на счёте. Если модель не ответит, программа сама пробует запасные, затем распознаватель на устройстве. Без вашего подтверждения в карту ничего не записывается.</div>
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
