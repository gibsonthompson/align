import { CORS_PREFLIGHT, json, originOf, verifyAccess } from '@/lib/oauth';
import { INSTRUCTIONS, ToolError, TOOLS } from '@/lib/mcp/tools';

// The ChatGPT connection: an MCP server over streamable HTTP (plain JSON
// responses, no sessions). Every request needs a valid OAuth access token.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const VERSION = '1.0.0';

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const result = (id: Rpc['id'], r: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result: r });
const failure = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function unauthorized(origin: string) {
  return json(
    { error: 'invalid_token', error_description: 'Connect Align in ChatGPT to sign in.' },
    401,
    {
      'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="align"`,
      'Access-Control-Expose-Headers': 'WWW-Authenticate',
    },
  );
}

async function handle(msg: Rpc, origin: string): Promise<unknown | null> {
  // Notifications get no reply.
  if (msg.id === undefined || msg.id === null) return null;
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return result(msg.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'align', title: 'Align', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return result(msg.id, {});
    case 'tools/list':
      return result(msg.id, {
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
      });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return failure(msg.id, -32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const out = await tool.run(args, { origin });
        return result(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(out) }],
          structuredContent: out as Record<string, unknown>,
          isError: false,
        });
      } catch (e) {
        const message = e instanceof ToolError ? e.message : 'Align hit a problem running that. Try again.';
        if (!(e instanceof ToolError)) console.error('mcp tool error', name, e);
        return result(msg.id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return failure(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const origin = originOf(req);
  const auth = await verifyAccess(req.headers.get('authorization'), origin);
  if (!auth.ok) return unauthorized(origin);

  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return json(failure(null, -32700, 'Parse error'), 400);
  }

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, origin)))).filter((r) => r !== null);
    return out.length ? json(out) : new Response(null, { status: 202, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  const out = await handle(body, origin);
  return out === null ? new Response(null, { status: 202, headers: { 'Access-Control-Allow-Origin': '*' } }) : json(out);
}

// No server-to-client stream: everything is request and response.
export async function GET(req: Request) {
  const origin = originOf(req);
  const auth = await verifyAccess(req.headers.get('authorization'), origin);
  if (!auth.ok) return unauthorized(origin);
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Access-Control-Allow-Origin': '*' } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Access-Control-Allow-Origin': '*' } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_PREFLIGHT });
}
