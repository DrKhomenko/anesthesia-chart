import { describe, it, expect } from 'vitest';
import type { DeviceRec } from '../db/db';
import {
  OPENROUTER_BASE_URL, OPENROUTER_CREDITS_MSG, OPENROUTER_DEFAULT_MODEL, OPENROUTER_FREE_DEFAULT_MODEL,
  OPENROUTER_FREE_FALLBACK_MODELS, OPENROUTER_FREE_LIMIT_MSG, OPENROUTER_FREE_VISION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODELS, OPENROUTER_PAID_VISION_MODELS, OPENROUTER_RATE_LIMIT_MSG, OPENROUTER_TITLE,
  applyOpenRouterFreePreset, applyOpenRouterPaidPreset, appSiteUrl, chatCompletionsUrl,
  asHeaderValue, cloudHttpError, cloudNotReadyReason, extractMessageContent, hasRecognitionReady,
  isCloudRequestFailure, isOpenRouterUrl, openRouterHeaders, parseModelList, probeRecognition,
  recognizeImage, recognizeWithFallback, uniqueModels,
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

  it('платный набор ставит Gemini 2.5 Flash и запасные модели', () => {
    const p = applyOpenRouterPaidPreset({});
    expect(p).toEqual({
      recognitionProvider: 'cloud',
      recognitionBaseUrl: OPENROUTER_BASE_URL,
      recognitionModel: OPENROUTER_DEFAULT_MODEL,
      recognitionFallbackModels: [...OPENROUTER_PAID_FALLBACK_MODELS],
    });
    expect(p.recognitionModel).toBe('google/gemini-2.5-flash');
    expect(p.recognitionFallbackModels[0]).toBe('openai/gpt-4o-mini');
    expect(applyOpenRouterPaidPreset({ recognitionModel: 'openai/gpt-4o-mini' }).recognitionModel).toBe('openai/gpt-4o-mini');
    expect(applyOpenRouterPaidPreset({ recognitionModel: 'google/gemma-4-31b-it:free' }).recognitionModel).toBe(OPENROUTER_DEFAULT_MODEL);
  });

  it('бесплатный набор не затирает выбранную бесплатную модель', () => {
    expect(applyOpenRouterFreePreset({}).recognitionModel).toBe(OPENROUTER_FREE_DEFAULT_MODEL);
    expect(applyOpenRouterFreePreset({ recognitionModel: '  openai/gpt-4o  ' }).recognitionModel).toBe(OPENROUTER_FREE_DEFAULT_MODEL);
    expect(applyOpenRouterFreePreset({ recognitionModel: OPENROUTER_FREE_FALLBACK_MODELS[0] }).recognitionModel).toBe(OPENROUTER_FREE_FALLBACK_MODELS[0]);
  });

  it('в платном списке есть модель по умолчанию, в бесплатном — только :free', () => {
    expect(OPENROUTER_PAID_VISION_MODELS.map(m => m.id)[0]).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(OPENROUTER_FREE_VISION_MODELS.map(m => m.id).every(id => id.endsWith(':free'))).toBe(true);
  });

  it('добавляет заголовки HTTP-Referer и X-Title', () => {
    const h = openRouterHeaders('https://drkhomenko.github.io/anesthesia-chart/');
    expect(h['HTTP-Referer']).toBe('https://drkhomenko.github.io/anesthesia-chart/');
    expect(h['X-Title']).toBe(asHeaderValue(OPENROUTER_TITLE));
    expect(asHeaderValue(OPENROUTER_TITLE)).toBe(encodeURIComponent('Наркозная карта'));
    expect(asHeaderValue('Anesthesia Chart')).toBe('Anesthesia Chart');
    expect(appSiteUrl()).toMatch(/\/$/);
  });

  it('для 429/402 показывает понятные сообщения', () => {
    expect(cloudHttpError(429, '{"error":{"message":"Rate limit"}}', OPENROUTER_BASE_URL)).toBe(OPENROUTER_RATE_LIMIT_MSG);
    expect(cloudHttpError(429, '', OPENROUTER_BASE_URL, 'google/gemma-4-31b-it:free')).toBe(OPENROUTER_FREE_LIMIT_MSG);
    expect(cloudHttpError(429, '', 'https://example.com/v1')).toBe('Превышен лимит запросов, попробуйте позже');
    expect(cloudHttpError(402, '{"error":{"message":"Insufficient credits"}}', OPENROUTER_BASE_URL)).toBe(OPENROUTER_CREDITS_MSG);
    expect(cloudHttpError(401, '{"error":"Unauthorized"}', OPENROUTER_BASE_URL)).toMatch(/ключ/i);
  });
});

describe('список моделей и готовность', () => {
  it('разбирает запасные модели', () => {
    expect(parseModelList('openai/gpt-4o-mini, nvidia/nemotron-3.5-super-vl:free')).toEqual([
      'openai/gpt-4o-mini', 'nvidia/nemotron-3.5-super-vl:free',
    ]);
    expect(uniqueModels('google/gemini-2.5-flash', ['google/gemini-2.5-flash', 'openai/gpt-4o-mini'])).toEqual([
      'google/gemini-2.5-flash', 'openai/gpt-4o-mini',
    ]);
  });
  it('объясняет, почему ключ не готов, и не путает это с сетью', () => {
    expect(cloudNotReadyReason({ recognitionBaseUrl: OPENROUTER_BASE_URL, recognitionModel: OPENROUTER_DEFAULT_MODEL, recognitionApiKey: '' }))
      .toMatch(/ключ/i);
    expect(cloudNotReadyReason({ recognitionBaseUrl: OPENROUTER_BASE_URL, recognitionModel: OPENROUTER_DEFAULT_MODEL, recognitionApiKey: 'sk-test' }))
      .toBeNull();
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
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content[1].type).toBe('image_url');
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,xxxx');
    expect(body.messages[0].content[1].image_url.detail).toBe('high');
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

describe('extractMessageContent', () => {
  it('забирает текст из строки и из массива частей', () => {
    expect(extractMessageContent({ choices: [{ message: { content: '{"hr":1}' } }] })).toBe('{"hr":1}');
    expect(extractMessageContent({ choices: [{ message: { content: [{ type: 'text', text: '{"hr":2}' }] } }] })).toBe('{"hr":2}');
  });
});

describe('recognizeWithFallback', () => {
  it('после 429 на первой модели берёт ответ второй', async () => {
    const calls: string[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const model = JSON.parse(String(init?.body)).model as string;
      calls.push(model);
      if (model === OPENROUTER_DEFAULT_MODEL) return new Response('{"error":{"message":"Rate limit"}}', { status: 429 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"hr": 77, "spo2": 96}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const res = await recognizeWithFallback({
      dataUrl: 'data:image/jpeg;base64,xxxx', device,
      baseUrl: OPENROUTER_BASE_URL, model: OPENROUTER_DEFAULT_MODEL, apiKey: 'sk-test',
      fallbackModels: [...OPENROUTER_PAID_FALLBACK_MODELS],
      fetchFn,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.reading.values.hr).toBe(77);
      expect(res.modelUsed).toBe('openai/gpt-4o-mini');
    }
    expect(calls[0]).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(calls[1]).toBe('openai/gpt-4o-mini');
  });

  it('при не-JSON пробует следующую модель', async () => {
    const fetchFn: typeof fetch = async (_url, init) => {
      const model = JSON.parse(String(init?.body)).model as string;
      const content = model === 'bad-model' ? 'не удалось прочитать' : '{"hr": 61, "spo2": 99}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    };
    const res = await recognizeWithFallback({
      dataUrl: 'data:image/jpeg;base64,xxxx', device,
      baseUrl: OPENROUTER_BASE_URL, model: 'bad-model', apiKey: 'sk-test',
      fallbackModels: [OPENROUTER_DEFAULT_MODEL],
      fetchFn,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.reading.values.hr).toBe(61);
  });

  it('на 401 не ходит по цепочке', async () => {
    let n = 0;
    const fetchFn: typeof fetch = async () => { n += 1; return new Response('{"error":"Unauthorized"}', { status: 401 }); };
    const res = await recognizeWithFallback({
      dataUrl: 'data:image/jpeg;base64,xxxx', device,
      baseUrl: OPENROUTER_BASE_URL, model: OPENROUTER_DEFAULT_MODEL, apiKey: 'sk-bad',
      fallbackModels: ['openai/gpt-4o-mini'],
      fetchFn,
    });
    expect(res.ok).toBe(false);
    expect(n).toBe(1);
    if (!res.ok) expect(res.error).toMatch(/ключ/i);
  });
});

describe('probeRecognition', () => {
  it('при 200 сообщает, что подключение в порядке', async () => {
    const res = await probeRecognition({
      baseUrl: OPENROUTER_BASE_URL, model: OPENROUTER_DEFAULT_MODEL, apiKey: 'sk-test',
      fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }), { status: 200 }),
    });
    expect(res).toEqual({ ok: true, detail: 'Подключение в порядке' });
  });
  it('при 402 просит пополнить баланс', async () => {
    const res = await probeRecognition({
      baseUrl: OPENROUTER_BASE_URL, model: OPENROUTER_DEFAULT_MODEL, apiKey: 'sk-test',
      fetchFn: async () => new Response('{"error":{"message":"Payment required"}}', { status: 402 }),
    });
    expect(res).toEqual({ ok: false, error: OPENROUTER_CREDITS_MSG });
  });
});

describe('response_format', () => {
  it('при 400 про response_format повторяет запрос без него', async () => {
    const formats: unknown[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      formats.push(body.response_format ?? null);
      if (body.response_format) return new Response('{"error":{"message":"response_format json_object is not supported"}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"hr": 50, "spo2": 98}' } }] }), { status: 200 });
    };
    const res = await recognizeImage({
      dataUrl: 'data:image/jpeg;base64,xxxx', device,
      baseUrl: OPENROUTER_BASE_URL, model: OPENROUTER_DEFAULT_MODEL, apiKey: 'sk-test',
      fetchFn,
    });
    expect(res.ok).toBe(true);
    expect(formats).toEqual([{ type: 'json_object' }, null]);
  });
});
