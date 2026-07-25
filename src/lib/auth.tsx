import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, onUnauthorized } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.get<{ user: User | null }>('/auth/me');
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // A session that expires mid-visit drops straight back to the login screen.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: me } = await api.post<{ user: User }>('/auth/login', { email, password });
    setUser(me);
    return me;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signIn,
      signOut,
      refresh,
      can: (permission) => Boolean(user?.effectivePermissions?.includes(permission)),
    }),
    [user, loading, signIn, signOut, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
