import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_color, is_subscribed')
    .eq('id', userId)
    .maybeSingle();
  if (error) console.error('profile load failed', error.message);
  return data ?? null;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileFor, setProfileFor] = useState(undefined); // user id the profile was loaded for

  const userId = session?.user?.id ?? null;
  // Supabase re-announces the session on every token refresh and whenever a tab
  // regains focus. Keep `user` the same object for the same person, so effects
  // keyed on it (party channels, the video player) don't restart.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const user = useMemo(() => session?.user ?? null, [userId]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession((prev) => (prev?.access_token === next?.access_token && prev?.user?.id === next?.user?.id ? prev : next));
      setSessionReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load the profile only when the signed-in person changes, not on token refreshes.
  useEffect(() => {
    if (!sessionReady) return undefined;
    if (!userId) {
      setProfile(null);
      setProfileFor(null);
      return undefined;
    }
    let active = true;
    fetchProfile(userId).then((p) => {
      if (!active) return;
      setProfile(p);
      setProfileFor(userId);
    });
    return () => { active = false; };
  }, [sessionReady, userId]);

  const refreshProfile = useCallback(async () => {
    if (!userId) return null;
    const p = await fetchProfile(userId);
    setProfile(p);
    return p;
  }, [userId]);

  const loading = !sessionReady || profileFor !== userId;

  const value = useMemo(() => ({
    session,
    user,
    profile,
    loading,
    isSubscribed: !!profile?.is_subscribed,
    refreshProfile,
    signOut: () => supabase.auth.signOut(),
  }), [session, user, profile, loading, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
