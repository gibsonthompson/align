import { db } from '@/lib/db';
import { CORS_PREFLIGHT, getClient, issueTokens, json, pkceMatches, sha256 } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

async function readForm(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? '')]));
  }
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text));
}

const bad = (error: string, error_description: string) => json({ error, error_description }, 400);

export async function POST(req: Request) {
  const f = await readForm(req);
  const client = await getClient(f.client_id || '');
  if (!client) return json({ error: 'invalid_client' }, 401);

  if (f.grant_type === 'authorization_code') {
    const { data: code } = await db()
      .from('align_oauth_codes')
      .select('client_id, redirect_uri, code_challenge, resource, expires_at, used')
      .eq('code_hash', sha256(f.code || ''))
      .maybeSingle();
    if (!code || code.used || code.client_id !== client.client_id || new Date(code.expires_at as string).getTime() < Date.now())
      return bad('invalid_grant', 'The code is invalid or expired.');
    if (f.redirect_uri && f.redirect_uri !== code.redirect_uri) return bad('invalid_grant', 'redirect_uri does not match.');
    if (!pkceMatches(f.code_verifier || '', code.code_challenge as string)) return bad('invalid_grant', 'PKCE check failed.');
    // One use only.
    const { data: claimed } = await db().from('align_oauth_codes').update({ used: true }).eq('code_hash', sha256(f.code)).eq('used', false).select('code_hash');
    if (!claimed?.length) return bad('invalid_grant', 'The code was already used.');
    return json(await issueTokens(client.client_id, (code.resource as string) ?? null));
  }

  if (f.grant_type === 'refresh_token') {
    const hash = sha256(f.refresh_token || '');
    const { data: rt } = await db().from('align_oauth_tokens').select('client_id, kind, expires_at, revoked, resource').eq('token_hash', hash).maybeSingle();
    if (!rt || rt.kind !== 'refresh' || rt.revoked || rt.client_id !== client.client_id || new Date(rt.expires_at as string).getTime() < Date.now())
      return bad('invalid_grant', 'The refresh token is invalid or expired.');
    // Rotate: the old refresh token stops working.
    await db().from('align_oauth_tokens').update({ revoked: true }).eq('token_hash', hash);
    return json(await issueTokens(client.client_id, (rt.resource as string) ?? null));
  }

  return bad('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_PREFLIGHT });
}
