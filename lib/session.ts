// The PIN session: a signed cookie that expires after a stretch of inactivity.
// Uses Web Crypto so it runs the same in the proxy and on the server.
// The signing key comes from the server key plus the PIN, so changing the PIN
// in Vercel signs every device out.

export const SESSION_COOKIE = 'align_session';
export const LOCK_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // locks after a week without use
export const MAX_SESSION_MS = 60 * 24 * 60 * 60 * 1000; // a PIN entry is never good for longer than 60 days

const enc = new TextEncoder();
let cachedKey: { material: string; key: CryptoKey } | null = null;

async function signingKey(): Promise<CryptoKey | null> {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pin = process.env.ALIGN_PIN;
  if (!service || !pin) return null;
  const material = `${service}|${pin}|align-session-v1`;
  if (cachedKey?.material === material) return cachedKey.key;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(material));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cachedKey = { material, key };
  return key;
}

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function createSession(issuedAt = Date.now()): Promise<string | null> {
  return signSession(issuedAt, Math.min(Date.now() + LOCK_AFTER_MS, issuedAt + MAX_SESSION_MS));
}

async function signSession(issuedAt: number, expiresAt: number): Promise<string | null> {
  const key = await signingKey();
  if (!key) return null;
  const payload = `v1.${issuedAt}.${expiresAt}`;
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(
  value: string | undefined | null,
): Promise<{ valid: false } | { valid: true; refreshed: string | null }> {
  if (!value) return { valid: false };
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return { valid: false };
  const issuedAt = Number(parts[1]);
  const expiresAt = Number(parts[2]);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return { valid: false };
  const key = await signingKey();
  if (!key) return { valid: false };
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', key, fromB64url(parts[3]), enc.encode(`v1.${issuedAt}.${expiresAt}`));
  } catch {
    ok = false;
  }
  const now = Date.now();
  if (!ok || now >= expiresAt || now - issuedAt >= MAX_SESSION_MS || issuedAt > now + 60_000) return { valid: false };
  const nextExpiry = Math.min(now + LOCK_AFTER_MS, issuedAt + MAX_SESSION_MS);
  // Re-sign at most about once an hour, to keep responses light.
  const refreshed = nextExpiry - expiresAt > 60 * 60 * 1000 ? await signSession(issuedAt, nextExpiry) : null;
  return { valid: true, refreshed };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(MAX_SESSION_MS / 1000),
  };
}
