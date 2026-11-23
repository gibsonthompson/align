import { headers } from 'next/headers';
import { Plug } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { timeAgo } from '@/lib/format';
import TopBar from '@/components/TopBar';
import EmptyState from '@/components/EmptyState';
import { CopyField, DisconnectButton } from '@/components/ConnectionsUI';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  await requireSession();
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0];
  const mcpUrl = `${proto}://${host}/api/mcp`;

  const [{ data: clients }, { data: tokens }, { count: viaCount }] = await Promise.all([
    db().from('align_oauth_clients').select('client_id, client_name, created_at, last_used_at').order('created_at', { ascending: false }),
    db().from('align_oauth_tokens').select('client_id, kind, revoked, expires_at').eq('kind', 'refresh').eq('revoked', false),
    db().from('align_activity').select('id', { count: 'exact', head: true }).eq('via', 'chatgpt'),
  ]);
  const live = new Set(
    ((tokens ?? []) as { client_id: string; expires_at: string }[]).filter((t) => new Date(t.expires_at).getTime() > Date.now()).map((t) => t.client_id),
  );
  const connected = ((clients ?? []) as { client_id: string; client_name: string; created_at: string; last_used_at: string | null }[]).filter((c) => live.has(c.client_id));

  return (
    <>
      <TopBar title="Connections" />
      <div className="content narrow">
        <div className="page-head">
          <div>
            <h1>Connections</h1>
            <p>Let ChatGPT read and write your life map, with everything it already knows about you behind it.</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Connect ChatGPT</h2>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <CopyField label="Server URL" value={mcpUrl} />
              <ol className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8, fontSize: 13.5 }}>
                <li>In ChatGPT on the web, turn on Developer mode (Settings, Apps, Advanced settings).</li>
                <li>Create an app (or add a custom MCP server from Plugins), name it Align, paste the server URL above and choose OAuth.</li>
                <li>ChatGPT sends you to an Align page. Enter your PIN and press Connect.</li>
                <li>In a chat, turn Align on from the + menu and ask it to work on your goals.</li>
              </ol>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">
                Connected <span className="count">{connected.length}</span>
              </h2>
              <span className="panel-note">{viaCount ?? 0} changes made through ChatGPT</span>
            </div>
            {connected.length ? (
              <div className="rows">
                {connected.map((c) => (
                  <div key={c.client_id} className="row">
                    <span className="row-icon">
                      <Plug size={15} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">{c.client_name || 'ChatGPT'}</span>
                      <span className="row-sub">
                        Connected {timeAgo(c.created_at)}
                        {c.last_used_at ? `, last signed in ${timeAgo(c.last_used_at)}` : ''}
                      </span>
                    </span>
                    <DisconnectButton clientId={c.client_id} name={c.client_name || 'ChatGPT'} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState Icon={Plug} title="Nothing Connected" body="Once ChatGPT is connected it shows here, and you can disconnect it any time." />
            )}
          </section>
        </div>
      </div>
    </>
  );
}
