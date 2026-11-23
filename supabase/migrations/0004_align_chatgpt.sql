-- Align: the ChatGPT connection. ChatGPT signs in with OAuth (Gibson approves
-- with his PIN), then reads and writes Align through the MCP endpoint.
-- Every secret is stored only as a SHA-256 hash.

create table if not exists public.align_oauth_clients (
  client_id text primary key,
  client_name text not null default '',
  redirect_uris text[] not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.align_oauth_codes (
  code_hash text primary key,
  client_id text not null references public.align_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  resource text,
  scope text not null default '',
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.align_oauth_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('access', 'refresh')),
  client_id text not null references public.align_oauth_clients(client_id) on delete cascade,
  resource text,
  scope text not null default '',
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists align_oauth_tokens_client_idx on public.align_oauth_tokens (client_id, kind);

-- Where a change came from, so history can show "via ChatGPT".
alter table public.align_activity add column if not exists via text;

do $$
declare t text;
begin
  foreach t in array array['align_oauth_clients', 'align_oauth_codes', 'align_oauth_tokens']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists align_deny_public on public.%I', t);
    execute format('create policy align_deny_public on public.%I for all to anon, authenticated using (false) with check (false)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
