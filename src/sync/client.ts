import { normalizeUrl, type RemoteRow, type RemoteTable } from './core';

export interface Session { accessToken: string; refreshToken: string; expiresAt: number }
export interface SyncClient {
  /** Возвращает «tbl:id» строк, которые сервер отклонил, потому что у него версия позже. */
  push(rows: RemoteRow[]): Promise<string[]>;
  pull(table: RemoteTable, since: string | null, limit: number): Promise<RemoteRow[]>;
}
export class SyncHttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function j(res: Response) {
  const text = await res.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const m = body?.error_description || body?.msg || body?.message || body?.error || `HTTP ${res.status}`;
    throw new SyncHttpError(res.status, String(m));
  }
  return body;
}

/** Вход общей учётной записью клиники (Supabase Auth, email + пароль). Пароль не сохраняется. */
export async function signIn(url: string, anonKey: string, email: string, password: string): Promise<Session> {
  const res = await fetch(`${normalizeUrl(url)}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  return toSession(await j(res));
}
export async function refreshSession(url: string, anonKey: string, refreshToken: string): Promise<Session> {
  const res = await fetch(`${normalizeUrl(url)}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return toSession(await j(res));
}
function toSession(b: any): Session {
  return { accessToken: b.access_token, refreshToken: b.refresh_token, expiresAt: Date.now() + (Number(b.expires_in) || 3600) * 1000 };
}

export function httpClient(url: string, anonKey: string, accessToken: string): SyncClient {
  const base = normalizeUrl(url);
  const h = { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  return {
    async push(rows) {
      if (!rows.length) return [];
      const res = await j(await fetch(`${base}/rest/v1/rpc/sync_push`, { method: 'POST', headers: h, body: JSON.stringify({ p_rows: rows }) }));
      return Array.isArray(res) ? res.map(String) : [];
    },
    async pull(table, since, limit) {
      const q = new URLSearchParams({ select: '*', order: 'server_updated_at.asc', limit: String(limit) });
      if (since) q.set('server_updated_at', `gt.${since}`);
      const rows = await j(await fetch(`${base}/rest/v1/${table}?${q}`, { headers: h }));
      return (rows as any[]).map(r => ({ ...r, tbl: table === 'cases' ? 'cases' : r.tbl }));
    },
  };
}
