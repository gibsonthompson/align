import { CORS_PREFLIGHT, json, originOf, resourceUrl, SCOPE } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

// RFC 9728: tells ChatGPT the MCP endpoint is protected and where to sign in.
export function GET(req: Request) {
  const origin = originOf(req);
  return json({
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Align',
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_PREFLIGHT });
}
