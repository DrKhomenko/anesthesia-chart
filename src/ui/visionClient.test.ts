import { describe, it, expect } from 'vitest';
import type { DeviceRec } from '../db/db';
import {
  OPENROUTER_BASE_URL, OPENROUTER_DEFAULT_MODEL, OPENROUTER_FALLBACK_MODELS, OPENROUTER_FREE_VISION_MODELS,
  OPENROUTER_RATE_LIMIT_MSG, OPENROUTER_TITLE, applyOpenRouterFreePreset, appSiteUrl, chatCompletionsUrl,
  asHeaderValue, cloudHttpError, hasRecognitionReady, isCloudRequestFailure, isOpenRouterUrl, openRouterHeaders, recognizeImage,
} from './visionClient';

describe('chatCompletionsUrl', () => {
  it('нормализует разные формы адреса', () => {
    expect(chatCompletionsUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(chatCompletionsUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(chatCompletionsUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1/chat/completions');
    expect(chatCompletionsUrl('https://proxy.clinic.local')).toBe('https://proxy.clinic.local/v1/chat/completions');
  });
});

describe('hasRecognitionReady', () => {
  const cloud = { recognitionProvider: 'cloud' as const, recognitionBaseUrl: 'https://x/v1', recognitionModel: 'm', recognitionApiKey: 'k' };
  it('на устройстве готово и без сети, и без ключа', () => {
    expect(hasRecognitionReady({ recognitionProvider: 'on-device', recognitionBaseUrl: '', recognitionModel: '', recognitionApiKey: '' }, false)).toBe(true);
    expect(hasRecognitionReady({ recognitionBaseUrl: '', recognitionModel: '', recognitionApiKey: '' }, false)).toBe(true);
  });
  it('облако: нужны сеть, адрес, модель и ключ', () => {
    expect(hasRecognitionReady(cloud, true)).toBe(true);
    expect(hasRecognitionReady(cloud, false)).toBe(false);
    expect(hasRecognitionReady({ ...cloud, recognitionApiKey: '' }, true)).toBe(false);
    expect(hasRecognitionReady({ ...cloud, recognitionBaseUrl: '  ' }, true)).toBe(false);
    expect(hasRecognitionReady({ ...cloud, recognitionModel: '' }, true)).toBe(false);
  });
});

describe('OpenRouter preset', () => {
  it('распознаёт адрес OpenRouter', () => {
    expect(isOpenRouterUrl('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouterUrl('https://openrouter.ai/api/v1/')).toBe(true);
    expect(isOpenRouterUrl('https://api.openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouterUrl('https://api.openai.com/v1')).toBe(false);
    expect(isOpenRouterUrl('')).toBe(false);
  });

  it('ставит облако, адрес и модель по умолчанию, но не затирает выбранную бесплатную модель', () => {
    expect(applyOpenRouterFreePreset({})).toEqual({
      recognitionProvider: 'cloud',
      recognitionBaseUrl: OPENROUTER_BASE_URL,
      recognitionModel: OPENROUTER_DEFAULT_MODEL,
    });
    expect(applyOpenRouterFreePreset({ recognitionModel: '  openai/gpt-4o  ' }).recognitionModel).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(applyOpenRouterFreePreset({ recognitionModel: OPENROUTER_FALLBACK_MODELS[0] }).recognitionModel).toBe(OPENROUTER_FALLBACK_MODELS[0]);
  });

  it('в списке есть модель по умолчанию и запасные, все с суффиксом :free', () => {
    const ids = OPENROUTER_FREE_VISION_MODELS.map(m => m.id);
    expect(ids[0]).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(ids).toContain(OPENROUTER_FALLBACK_MODELS[0]);
    expect(ids).toContain(OPENROUTER_FALLBACK_MODELS[1]);
    expect(ids.every(id => id.endsWith(':free'))).toBe(true);
  });

  it('добавляет заголовки HTTP-Referer и X-Title', () => {
    const h = openRouterHeaders('https://drkhomenko.github.io/anesthesia-chart/');
    expect(h['HTTP-Referer']).toBe('https://drkhomenko.github.io/anesthesia-chart/');
    expect(h['X-Title']).toBe(asHeaderValue(OPENROUTER_TITLE));
    expect(asHeaderValue(OPENROUTER_TITLE)).toBe(encodeURIComponent('Наркозная карта'));
    expect(asHeaderValue('Anesthesia Chart')).toBe('Anesthesia Chart');
    expect(appSiteUrl()).toMatch(/\/$/);
  });

  it('для 429 на OpenRouter показывает сообщение о бесплатном лимите', () => {
    expect(cloudHttpError(429, '{"error":{"message":"Rate limit"}}', OPENROUTER_BASE_URL)).toBe(OPENROUTER_RATE_LIMIT_MSG);
    expect(cloudHttpError(429, '', 'https://example.com/v1')).toBe('Превышен лимит запросов, попробуйте позже');
    expect(cloudHttpError(401, '{"error":"Unauthorized"}', OPENROUTER_BASE_URL)).toContain('401');
  });
});

const device = {
  id: 't', type: 'monitor', name: 'Test', fieldKeys: ['hr', 'spo2'],
  regions: {}, isPreset: false, isUserAdded: true, isActive: true,
} as DeviceRec;

describe('recognizeImage', () => {
  it('отправляет заголовки OpenRouter и разбирает JSON в заборе из markdown', async () => {
    let seen: RequestInit | undefined;
    const fetchFn: typeof fetch = async (_url, init) => {
      seen = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '```json\n{"hr": 88, "spo2": 97, "deviceTime": null}\n```' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const res = await recognizeImage({
      dataUrl: 'data:image/jpeg;base64,xxxx', device,
      baseUrl: OPENROUTER_BASE_URL, model: OPENROUTER_DEFAULT_MODEL, apiKey: 'sk-test',
      fetchFn, referer: 'https://drkhomenko.github.io/anesthesia-chart/',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reading.values.hr).toBe(88);
      expect(res.reading.values.spo2).toBe(97);
    }
    const headers = seen?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    expect(headers['HTTP-Referer']).toBe('https://drkhomenko.github.io/anesthesia-chart/');
    expect(headers['X-Title']).toBe(asHeaderValue(OPENROUTER_TITLE));
    const body = JSON.parse(String(seen?.body));
    expect(body.model).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(body.messages[0].content[1].type).toBe('image_url');
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,xxxx');
  });

  it('при 429 ставит requestFailed и текст про исчерпанный лимит', async () => {
    const fetchFn: typeof fetch = async () => new Response('{"error":{"message":"Rate limit exceeded"}}', { status: 429 });
    const res = await recognizeImage({
      dataUrl: 'data:image/jpeg;base64,xxxx', device,
      baseUrl: OPENROUTER_BASE_URL, model: OPENROUTER_DEFAULT_MODEL, apiKey: 'sk-test',
      fetchFn,
    });
    expect(res.ok).toBe(false);
    expect(isCloudRequestFailure(res)).toBe(true);
    if (!res.ok) expect(res.error).toBe(OPENROUTER_RATE_LIMIT_MSG);
  });

  it('сетевую ошибку считает сбоем запроса, а неразборчивый JSON — нет', async () => {
    const net = await recognizeImage({
      dataUrl: 'data:image/jpeg;base64,xxxx', device,
      baseUrl: OPENROUTER_BASE_URL, model: OPENROUTER_DEFAULT_MODEL, apiKey: 'sk-test',
      fetchFn: async () => { throw new TypeError('Failed to fetch'); },
    });
    expect(isCloudRequestFailure(net)).toBe(true);
    if (!net.ok) expect(net.error).toMatch(/CORS|сети/i);

    const parse = await recognizeImage({
      dataUrl: 'data:image/jpeg;base64,xxxx', device,
      baseUrl: OPENROUTER_BASE_URL, model: OPENROUTER_DEFAULT_MODEL, apiKey: 'sk-test',
      fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'не удалось прочитать' } }] }), { status: 200 }),
    });
    expect(parse.ok).toBe(false);
    expect(isCloudRequestFailure(parse)).toBe(false);
  });
});
