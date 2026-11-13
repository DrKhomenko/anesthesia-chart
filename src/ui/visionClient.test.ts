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
  const ok = { recognitionBaseUrl: 'https://x/v1', recognitionModel: 'm', recognitionApiKey: 'k' };
  it('нужны сеть, адрес, модель и ключ', () => {
    expect(hasRecognitionReady(ok, true)).toBe(true);
    expect(hasRecognitionReady(ok, false)).toBe(false);
    expect(hasRecognitionReady({ ...ok, recognitionApiKey: '' }, true)).toBe(false);
    expect(hasRecognitionReady({ ...ok, recognitionBaseUrl: '  ' }, true)).toBe(false);
    expect(hasRecognitionReady({ ...ok, recognitionModel: '' }, true)).toBe(false);
  });
});
