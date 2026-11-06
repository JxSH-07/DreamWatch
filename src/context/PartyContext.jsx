import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { invokeStatus, supabase } from '../lib/supabase.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

const PartyContext = createContext(null);

const MEMBER_COLUMNS = 'party_id, user_id, role, status, muted, team_supported, joined_at, profile:profiles(id, display_name, avatar_color, is_subscribed)';
const GAFFER_TIMEOUT_MS = 20_000;

// One realtime channel per party (`party:{id}`): postgres changes, broadcast and presence.
export function PartyProvider({ partyId, children }) {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [party, setParty] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [polls, setPolls] = useState([]);
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [online, setOnline] = useState(() => new Set());
  const [typing, setTyping] = useState({});
  const [thinking, setThinking] = useState({});
  const [reactions, setReactions] = useState([]);
  const channelRef = useRef(null);
  const subscribedRef = useRef(false);

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase.from('party_members').select(MEMBER_COLUMNS).eq('party_id', partyId);
    if (!error) setMembers(data ?? []);
    return data ?? [];
  }, [partyId]);

  const reloadParty = useCallback(async () => {
    const { data } = await supabase.from('parties').select('*').eq('id', partyId).maybeSingle();
    if (data) setParty(data);
  }, [partyId]);

  const addMessage = useCallback((m) => {
    if (m.author_type === 'gaffer' && m.meta?.reply_to) {
      setThinking((t) => {
        if (!t[m.meta.reply_to]) return t;
        const next = { ...t };
        delete next[m.meta.reply_to];
        return next;
      });
    }
    setMessages((prev) => (prev.some((x) => x.id === m.id)
      ? prev.map((x) => (x.id === m.id ? { ...m, pending: false } : x))
      : [...prev, m].slice(-300)));
  }, []);

  const upsertPoll = useCallback((p) => {
    setPolls((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]));
  }, []);

  const pushReaction = useCallback(({ emoji, userId }) => {
    const r = {
      id: `${Date.now()}-${Math.random()}`, emoji, userId,
      left: Math.round(45 + Math.random() * 45), dx: Math.round(Math.random() * 60 - 30), dur: +(2.3 + Math.random() * 0.7).toFixed(2),
    };
    setReactions((prev) => [...prev.slice(-30), r]);
    setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== r.id)), 3300);
  }, []);

  // ---------- Initial load ----------
  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase.from('parties').select('*').eq('id', partyId).maybeSingle();
      if (!active) return;
      if (!p) {
        // Removed members can no longer read the party, but can read their own row.
        const { data: mine } = await supabase.from('party_members').select('status').eq('party_id', partyId).eq('user_id', user.id).maybeSingle();
        if (!active) return;
        setLoadError(mine?.status === 'removed' ? 'removed' : 'not_found');
        setLoading(false);
        return;
      }
      setParty(p);
      const [, msgRes, pollRes] = await Promise.all([
        loadMembers(),
        supabase.from('messages').select('*').eq('party_id', partyId).order('created_at', { ascending: false }).limit(100),
        supabase.from('polls').select('*').eq('party_id', partyId).order('created_at'),
      ]);
      if (!active) return;
      setMessages((msgRes.data ?? []).reverse());
      const pollRows = pollRes.data ?? [];
      setPolls(pollRows);
      if (pollRows.length) {
        const { data: v } = await supabase.from('poll_votes').select('*').in('poll_id', pollRows.map((x) => x.id));
        if (active) setVotes(v ?? []);
      }
      setLoadError(null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [partyId, user, loadMembers]);

  // ---------- Realtime ----------
  useEffect(() => {
    if (!user) return undefined;
    const filter = `party_id=eq.${partyId}`;
    const ch = supabase.channel(`party:${partyId}`, {
      config: { presence: { key: user.id }, broadcast: { self: false } },
    });
    ch
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parties', filter: `id=eq.${partyId}` },
        ({ new: row }) => setParty((prev) => ({ ...prev, ...row })))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_members', filter }, () => loadMembers())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, ({ new: row }) => addMessage(row))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, ({ new: row }) => addMessage(row))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'polls', filter }, ({ new: row }) => row?.id && upsertPoll(row))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'poll_votes' }, ({ new: row }) => {
        setVotes((prev) => (prev.some((v) => v.poll_id === row.poll_id && v.user_id === row.user_id) ? prev : [...prev, row]));
      })
      .on('broadcast', { event: 'reaction' }, ({ payload }) => pushReaction(payload))
      .on('broadcast', { event: 'typing' }, ({ payload }) => setTyping((t) => ({ ...t, [payload.userId]: Date.now() })))
      .on('broadcast', { event: 'gaffer_thinking' }, ({ payload }) => {
        setThinking((t) => ({ ...t, [payload.requestId]: { question: payload.question, at: Date.now(), failed: false } }));
      })
      .on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(ch.presenceState()))))
      .subscribe((status) => {
        subscribedRef.current = status === 'SUBSCRIBED';
      });
    channelRef.current = ch;
    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [partyId, user, loadMembers, addMessage, upsertPoll, pushReaction]);

  const me = members.find((m) => m.user_id === user?.id) ?? null;

  // Track presence once subscribed, and again when our team changes.
  useEffect(() => {
    if (!user || !profile) return undefined;
    const meta = { userId: user.id, displayName: profile.display_name, avatarColor: profile.avatar_color, team: me?.team_supported ?? null };
    let tries = 0;
    const id = setInterval(() => {
      if (subscribedRef.current && channelRef.current) {
        channelRef.current.track(meta);
        clearInterval(id);
      } else if (++tries > 40) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [user, profile, me?.team_supported, partyId]);

  // Expire typing indicators (3 s) and stuck Gaffer requests (20 s).
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setTyping((t) => {
        const keys = Object.keys(t).filter((k) => now - t[k] < 3000);
        return keys.length === Object.keys(t).length ? t : Object.fromEntries(keys.map((k) => [k, t[k]]));
      });
      setThinking((t) => {
        let changed = false;
        const next = {};
        for (const [k, v] of Object.entries(t)) {
          if (v.failed && now - v.at > GAFFER_TIMEOUT_MS + 8000) { changed = true; continue; }
          if (!v.failed && now - v.at > GAFFER_TIMEOUT_MS) { changed = true; next[k] = { ...v, failed: true }; continue; }
          next[k] = v;
        }
        return changed ? next : t;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ---------- Actions ----------
  const broadcast = useCallback((event, payload) => {
    channelRef.current?.send({ type: 'broadcast', event, payload });
  }, []);

  const updateParty = useCallback(async (patch) => {
    if (!patch) return false;
    setParty((prev) => ({ ...prev, ...patch }));
    const { error } = await supabase.from('parties').update(patch).eq('id', partyId);
    if (error) {
      console.error('party update failed', error.message);
      toast("Couldn't update the party — try again", 'warn');
      reloadParty();
      return false;
    }
    return true;
  }, [partyId, toast, reloadParty]);

  // Any member's playback change (pause, seek, go live…). The server bumps the
  // version, records who did it and writes the chat log line.
  const playbackAction = useCallback(async (action, patch, label) => {
    if (!patch) return false;
    setParty((prev) => ({ ...prev, ...patch, playback_by: user.id }));
    const { error } = await supabase.rpc('playback_action', {
      p_party: partyId, p_action: action, p_patch: patch, p_label: label ?? null,
    });
    if (error) {
      console.error('playback_action failed', error.message);
      toast(/host controls/.test(error.message) ? 'The host has turned off shared controls' : "Couldn't change playback — try again", 'warn');
      reloadParty();
      return false;
    }
    return true;
  }, [partyId, user, toast, reloadParty]);

  const updateMember = useCallback(async (userId, patch) => {
    setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, ...patch } : m)));
    const { error } = await supabase.from('party_members').update(patch).eq('party_id', partyId).eq('user_id', userId);
    if (error) {
      toast("Couldn't update that member", 'warn');
      loadMembers();
      return false;
    }
    return true;
  }, [partyId, toast, loadMembers]);

  const react = useCallback((emoji) => {
    const payload = { emoji, userId: user.id };
    pushReaction(payload);
    broadcast('reaction', payload);
  }, [user, broadcast, pushReaction]);

  const sendTyping = useCallback(() => broadcast('typing', { userId: user.id }), [broadcast, user]);

  const askGaffer = useCallback(async (messageId, question) => {
    setThinking((t) => ({ ...t, [messageId]: { question, at: Date.now(), failed: false } }));
    broadcast('gaffer_thinking', { requestId: messageId, question });
    const { error } = await supabase.functions.invoke('gaffer', { body: { party_id: partyId, message_id: messageId } });
    if (error) {
      if (invokeStatus(error) === 429) toast('Gaffer needs a breather — try again in a few seconds.', 'warn');
      setThinking((t) => (t[messageId] ? { ...t, [messageId]: { ...t[messageId], failed: true, at: Date.now() - GAFFER_TIMEOUT_MS } } : t));
    }
  }, [broadcast, partyId, toast]);

  const sendMessage = useCallback(async ({ body, eventId = null, replyTo = null, videoTime = null }) => {
    const text = body.trim().slice(0, 1000);
    if (!text) return false;
    const id = crypto.randomUUID();
    const row = {
      id, party_id: partyId, user_id: user.id, author_type: 'user', body: text,
      event_id: eventId, reply_to: replyTo, video_time: videoTime,
    };
    addMessage({ ...row, meta: {}, flagged: false, created_at: new Date().toISOString(), pending: true });
    const { error } = await supabase.from('messages').insert(row);
    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      toast(me?.muted ? 'The host has muted you in chat.' : "Message didn't send — try again", 'warn');
      return false;
    }
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, pending: false } : m)));
    if (/@gaffer\b/i.test(text)) askGaffer(id, text);
    if (party?.settings?.ai_moderation) {
      supabase.functions.invoke('moderate-message', { body: { message_id: id } }).catch(() => {});
    }
    return true;
  }, [partyId, user, addMessage, toast, me?.muted, askGaffer, party?.settings?.ai_moderation]);

  const vote = useCallback(async (pollId, optionId) => {
    const row = { poll_id: pollId, user_id: user.id, option_id: optionId };
    setVotes((prev) => [...prev, { ...row, created_at: new Date().toISOString() }]);
    const { error } = await supabase.from('poll_votes').insert(row);
    if (error) {
      setVotes((prev) => prev.filter((v) => !(v.poll_id === pollId && v.user_id === user.id)));
      toast('Voting has closed on that poll', 'warn');
    }
  }, [user, toast]);

  const rpc = useCallback(async (fn, args, failText) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      console.error(fn, error.message);
      if (failText) toast(failText, 'warn');
    }
    return { data, error };
  }, [toast]);

  const memberMap = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m])), [members]);

  const value = {
    partyId, party, members, memberMap, me, isHost: !!party && party.host_id === user?.id,
    messages, polls, votes, online, typing, thinking, reactions, loading, loadError,
    updateParty, playbackAction, updateMember, react, sendTyping, sendMessage, vote, rpc, setThinking,
  };
  return <PartyContext.Provider value={value}>{children}</PartyContext.Provider>;
}

export const useParty = () => useContext(PartyContext);
