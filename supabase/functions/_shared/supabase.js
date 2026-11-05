import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL');

// Projects on the new API keys expose SUPABASE_SECRET_KEYS ({"default": "sb_secret_…"});
// older ones SUPABASE_SERVICE_ROLE_KEY. Use whichever is present.
function serverKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

export const adminClient = createClient(url, serverKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Identify the caller from the request's access token. Returns { user } or null.
export async function getCaller(req) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data?.user) return null;
  return { user: data.user };
}

// Sliding one-minute rate limit on ai_requests. Records the request when allowed.
export async function rateLimit({ userId, partyId, kind, perUser, perParty }) {
  const since = new Date(Date.now() - 60_000).toISOString();
  if (perUser != null) {
    const { count } = await adminClient.from('ai_requests').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('kind', kind).gte('created_at', since);
    if ((count ?? 0) >= perUser) return false;
  }
  if (perParty != null && partyId) {
    const { count } = await adminClient.from('ai_requests').select('id', { count: 'exact', head: true })
      .eq('party_id', partyId).eq('kind', kind).gte('created_at', since);
    if ((count ?? 0) >= perParty) return false;
  }
  await adminClient.from('ai_requests').insert({ user_id: userId, party_id: partyId ?? null, kind });
  return true;
}
