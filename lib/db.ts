import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-only database access with the service key. The browser never gets
// this key and never talks to the database; every request passes the PIN gate first.
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Database is not configured');
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return client;
}
