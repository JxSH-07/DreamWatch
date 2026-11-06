import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

const InvitesContext = createContext({ invites: [], reload: () => {} });

// parties has two links to profiles (host_id, playback_by), so name the one we mean.
const INVITE_COLUMNS = 'party_id, status, party:parties(id, name, status, match_id, created_at, host:profiles!parties_host_id_fkey(display_name, avatar_color), match:matches(title, mode))';

// Pending watch-party invites for the signed-in user, live-updated. A new invite
// arriving while the app is open shows a toast with a Join button.
export function InvitesProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [invites, setInvites] = useState([]);
  const known = useRef(new Set());

  const reload = useCallback(async () => {
    if (!user) {
      setInvites([]);
      return [];
    }
    const { data, error } = await supabase
      .from('party_members').select(INVITE_COLUMNS)
      .eq('user_id', user.id).eq('status', 'invited');
    if (error) {
      console.error('invites load failed', error.message);
      return [];
    }
    const list = (data ?? []).filter((r) => r.party && r.party.status !== 'ended')
      .sort((a, b) => b.party.created_at.localeCompare(a.party.created_at));
    setInvites(list);
    return list;
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    reload().then((list) => {
      if (active) known.current = new Set(list.map((i) => i.party_id));
    });
    const ch = supabase
      .channel(`invites:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_members', filter: `user_id=eq.${user.id}` }, async () => {
        const list = await reload();
        for (const inv of list) {
          if (known.current.has(inv.party_id)) continue;
          known.current.add(inv.party_id);
          toast(`${inv.party.host?.display_name ?? 'A friend'} invited you to ${inv.party.name}`, 'ok', {
            label: 'Join', onClick: () => navigate(`/invite/${inv.party_id}`),
          });
        }
      })
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [user, reload, toast, navigate]);

  return <InvitesContext.Provider value={{ invites, reload }}>{children}</InvitesContext.Provider>;
}

export const useInvites = () => useContext(InvitesContext);
