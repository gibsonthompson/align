import type { Metadata } from 'next';
import { getClient } from '@/lib/oauth';
import LogoMark from '@/components/LogoMark';
import ConnectApprove from '@/components/ConnectApprove';

export const metadata: Metadata = { title: 'Connect To Align' };
export const dynamic = 'force-dynamic';

type Q = Record<string, string | undefined>;

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const client = q.client_id ? await getClient(q.client_id) : null;
  const problem = !client
    ? 'This app is not registered with Align. Start the connection again from ChatGPT.'
    : q.response_type !== 'code'
      ? 'Unsupported request type.'
      : !q.redirect_uri || !client.redirect_uris.includes(q.redirect_uri)
        ? 'The return address does not match. Start the connection again from ChatGPT.'
        : q.code_challenge_method !== 'S256' || !q.code_challenge
          ? 'This request is missing its security check. Start the connection again from ChatGPT.'
          : null;

  return (
    <main className="lock">
      <div className="logo-mark" aria-hidden>
        <LogoMark size={34} />
      </div>
      <div className="lock-body" style={{ maxWidth: 380 }}>
        <h1>Connect {client?.client_name || 'ChatGPT'} To Align</h1>
        {problem ? (
          <div className="form-error" role="alert" style={{ marginTop: 18 }}>
            {problem}
          </div>
        ) : (
          <ConnectApprove
            clientName={client!.client_name || 'ChatGPT'}
            params={{
              client_id: q.client_id!,
              redirect_uri: q.redirect_uri!,
              code_challenge: q.code_challenge!,
              state: q.state ?? '',
              resource: q.resource ?? '',
              scope: q.scope ?? 'align',
            }}
          />
        )}
      </div>
    </main>
  );
}
