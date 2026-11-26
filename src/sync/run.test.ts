import { describe, it, expect } from 'vitest';
import { syncConfigured, syncSkipReason } from './run';
import type { LocalSettings } from '../db/db';

const signedIn: LocalSettings = {
  id: 'local',
  recognitionProvider: 'on-device',
  recognitionBaseUrl: '',
  recognitionModel: '',
  recognitionApiKey: '',
  recognitionFallbackModels: [],
  storePhotoThumbnail: false,
  activeMonitorId: null,
  activeMachineId: null,
  syncEnabled: true,
  syncUrl: 'https://zaunkcdfafctqmyqmnhv.supabase.co',
  syncAnonKey: 'eyJ-anon',
  syncEmail: 'clinic@example.com',
  syncRefreshToken: 'refresh-token',
};

describe('syncSkipReason', () => {
  it('ручная синхронизация называет причину, а не молчит', () => {
    expect(syncSkipReason(signedIn, false)).toBe('нет сети');
    expect(syncSkipReason({ ...signedIn, syncEnabled: false }, true)).toBe('синхронизация выключена');
    expect(syncSkipReason({ ...signedIn, syncUrl: '', syncAnonKey: '' }, true)).toBe('нет адреса проекта — вставьте URL и ключ');
    expect(syncSkipReason({ ...signedIn, syncRefreshToken: '' }, true)).toBe('нет входа — войдите заново');
    expect(syncSkipReason({ ...signedIn, syncRefreshToken: undefined }, true)).toBe('нет входа — войдите заново');
    expect(syncSkipReason(signedIn, true)).toBeNull();
    expect(syncConfigured(signedIn)).toBe(true);
    expect(syncConfigured({ ...signedIn, syncRefreshToken: '' })).toBe(false);
  });
});
