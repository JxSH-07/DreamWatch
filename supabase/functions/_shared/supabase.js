import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL');

export const adminClient = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

// Identify the caller from the request's JWT. Returns { user, userClient } or null.
export async function getCaller(req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) return null;
  return { user: data.user, userClient };
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
