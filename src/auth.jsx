import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase.js';

const AuthContext = createContext(null);

// Keeps the Supabase session and whether that user is Nata staff (nata.admins, via am_i_admin).
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  useEffect(() => {
    if (!supabase) return;
    if (!userId) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase.rpc('am_i_admin').then(({ data, error }) => {
      setIsAdmin(!error && data === true);
      setLoading(false);
    });
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const value = useMemo(() => ({ session, isAdmin, loading, signOut }), [session, isAdmin, loading, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
