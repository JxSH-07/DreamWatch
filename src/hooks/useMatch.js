import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { normalizeEvents } from '../lib/matchTime.js';

const cache = new Map();

async function fetchMatch(matchId) {
  if (cache.has(matchId)) return cache.get(matchId);
  const promise = (async () => {
    const { data: match, error } = await supabase.from('matches').select('*').eq('id', matchId).maybeSingle();
    if (error) throw error;
    if (!match) return null;
    const { data: events, error: evErr } = await supabase
      .from('match_events').select('*').eq('match_id', matchId).order('video_time').order('seq');
    if (evErr) throw evErr;
    const all = normalizeEvents(match.config, events ?? []);
    return { match, events: all, keyEvents: all.filter((e) => e.importance === 'key') };
  })();
  cache.set(matchId, promise);
  promise.catch(() => cache.delete(matchId));
  return promise;
}

export function useMatches() {
  const [state, setState] = useState({ matches: [], loading: true, error: null });
  useEffect(() => {
    let active = true;
    supabase.from('matches').select('*').order('sort_order').then(({ data, error }) => {
      if (active) setState({ matches: data ?? [], loading: false, error });
    });
    return () => { active = false; };
  }, []);
  return state;
}

// Loads a match row and all its events (normalized video times). Cached in memory.
export function useMatch(matchId) {
  const [state, setState] = useState({ match: null, events: [], keyEvents: [], loading: !!matchId, error: null });
  useEffect(() => {
    if (!matchId) return undefined;
    let active = true;
    setState((s) => ({ ...s, loading: true }));
    fetchMatch(matchId)
      .then((res) => active && setState({ ...(res ?? { match: null, events: [], keyEvents: [] }), loading: false, error: res ? null : 'not_found' }))
      .catch((error) => active && setState({ match: null, events: [], keyEvents: [], loading: false, error }));
    return () => { active = false; };
  }, [matchId]);
  return state;
}
