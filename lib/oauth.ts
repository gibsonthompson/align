import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';

// OAuth 2.1 for the ChatGPT connection: dynamic client registration, PKCE (S256),
// short-lived access tokens with refresh tokens. Gibson approves with his PIN.

export const ACCESS_TTL_S = 60 * 60; // 1 hour
export const REFRESH_TTL_S = 90 * 24 * 60 * 60; // 90 days, rotated on every use
export const CODE_TTL_S = 5 * 60;
export const SCOPE = 'align';

export function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

export function token(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// The public origin this deploy answers on, from the request itself.
export function originOf(req: Request): string {
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
}

export function resourceUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

// Only ChatGPT (and OpenAI) may register as a client, so nobody else can even
// reach the PIN screen with a working redirect.
const ALLOWED_REDIRECT_HOSTS = ['chatgpt.com', 'chat.openai.com', 'openai.com', 'platform.openai.com'];

export function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_REDIRECT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const hashed = createHash('sha256').update(verifier).digest('base64url');
  return safeEqual(hashed, challenge);
}

export async function getClient(clientId: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) return null;
  const { data } = await db().from('align_oauth_clients').select('client_id, client_name, redirect_uris').eq('client_id', clientId).maybeSingle();
  return (data as { client_id: string; client_name: string; redirect_uris: string[] } | null) ?? null;
}

export async function issueTokens(clientId: string, resource: string | null) {
  const access = token();
  const refresh = token(48);
  const now = Date.now();
  const { error } = await db()
    .from('align_oauth_tokens')
    .insert([
      { token_hash: sha256(access), kind: 'access', client_id: clientId, resource, scope: SCOPE, revoked: false, expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
      { token_hash: sha256(refresh), kind: 'refresh', client_id: clientId, resource, scope: SCOPE, revoked: false, expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
    ]);
  if (error) throw new Error('Could not issue tokens');
  await db().from('align_oauth_clients').update({ last_used_at: new Date().toISOString() }).eq('client_id', clientId);
  // Keep the table small: drop expired and revoked tokens.
  await db().from('align_oauth_tokens').delete().lt('expires_at', new Date().toISOString());
  await db().from('align_oauth_tokens').delete().eq('revoked', true).lt('created_at', new Date(Date.now() - 60 * 1000).toISOString());
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
}

// Checks a bearer token for the MCP endpoint.
export async function verifyAccess(header: string | null, origin: string): Promise<{ ok: true; clientId: string } | { ok: false }> {
  const m = header?.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/);
  if (!m) return { ok: false };
  const { data } = await db()
    .from('align_oauth_tokens')
    .select('client_id, expires_at, revoked, resource, kind')
    .eq('token_hash', sha256(m[1]))
    .maybeSingle();
  if (!data || data.kind !== 'access' || data.revoked || new Date(data.expires_at as string).getTime() < Date.now()) return { ok: false };
  // A token minted for another resource is not good here.
  if (data.resource && data.resource !== resourceUrl(origin)) return { ok: false };
  return { ok: true, clientId: data.client_id as string };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...headers },
  });
}

export const CORS_PREFLIGHT = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};
