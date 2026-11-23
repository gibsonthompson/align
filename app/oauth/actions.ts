'use server';

import { createHash, timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { CODE_TTL_S, getClient, sha256, token } from '@/lib/oauth';

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
  resource: string;
  scope: string;
}

function sameSecret(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

function withParams(uri: string, params: Record<string, string>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

// Gibson approves the connection with his PIN. Same lockout as the app's own lock screen.
export async function approveConnection(p: AuthorizeParams, pin: string): Promise<{ ok: true; redirect: string } | { ok: false; error: string }> {
  const client = await getClient(p.client_id);
  if (!client || !client.redirect_uris.includes(p.redirect_uri)) return { ok: false, error: 'This connection request is not valid. Start again from ChatGPT.' };
  if (!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) return { ok: false, error: 'This connection request is not valid. Start again from ChatGPT.' };
  if (!process.env.ALIGN_PIN) return { ok: false, error: 'ALIGN_PIN is not set in Vercel.' };

  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 64);
  const { data: gate, error } = await db().rpc('align_pin_try', { p_ip: ip });
  if (error || !gate) return { ok: false, error: 'Could not check the PIN right now. Try again in a moment.' };
  const g = gate as { allowed: boolean; until?: string; attempt_id?: number };
  if (!g.allowed) return { ok: false, error: 'Too many wrong PINs. Try again later.' };
  const clean = String(pin ?? '').replace(/\D/g, '').slice(0, 12);
  if (!clean || !sameSecret(clean, process.env.ALIGN_PIN)) return { ok: false, error: 'Wrong PIN.' };
  if (g.attempt_id) await db().rpc('align_pin_succeeded', { p_id: g.attempt_id });

  const code = token();
  const { error: insertError } = await db().from('align_oauth_codes').insert({
    code_hash: sha256(code),
    client_id: client.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    resource: p.resource || null,
    scope: p.scope || 'align',
    used: false,
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  });
  if (insertError) return { ok: false, error: 'Could not finish connecting. Try again.' };
  // Clear out old codes.
  await db().from('align_oauth_codes').delete().lt('expires_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  return { ok: true, redirect: withParams(p.redirect_uri, { code, state: p.state }) };
}

export async function denyConnection(p: AuthorizeParams): Promise<{ redirect: string | null }> {
  const client = await getClient(p.client_id);
  if (!client || !client.redirect_uris.includes(p.redirect_uri)) return { redirect: null };
  return { redirect: withParams(p.redirect_uri, { error: 'access_denied', state: p.state }) };
}
