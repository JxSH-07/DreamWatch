import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  realtime: { params: { eventsPerSecond: 20 } },
});

// Status code of a failed functions.invoke call (FunctionsHttpError carries the Response).
export function invokeStatus(error) {
  return error?.context?.status ?? null;
}
