import { describe, it, expect } from 'vitest';
import { chatCompletionsUrl, hasRecognitionReady } from './visionClient';

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
