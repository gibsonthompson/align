import { CORS_PREFLIGHT, json } from '@/lib/oauth';
import { authServerMetadata } from '@/lib/oauth-metadata';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return json(authServerMetadata(req));
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_PREFLIGHT });
}
