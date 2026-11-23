import { db } from '@/lib/db';
import { CORS_PREFLIGHT, json, redirectAllowed, token } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

// RFC 7591 dynamic client registration. Only ChatGPT redirect addresses are accepted.
export async function POST(req: Request) {
  let body: { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON.' }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string').slice(0, 10) : [];
  if (!uris.length) return json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required.' }, 400);
  if (!uris.every(redirectAllowed)) return json({ error: 'invalid_redirect_uri', error_description: 'Only ChatGPT can connect to Align.' }, 400);

  const clientId = `align_${token(18)}`;
  const name = typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : 'ChatGPT';
  const { error } = await db().from('align_oauth_clients').insert({ client_id: clientId, client_name: name, redirect_uris: uris });
  if (error) return json({ error: 'server_error' }, 500);

  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_PREFLIGHT });
}
