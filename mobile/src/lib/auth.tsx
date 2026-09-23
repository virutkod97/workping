import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, loadSession, setToken, setUnauthorizedHandler } from './api';
import { registerForPush, unregisterPush } from './push';
import type { User } from './types';

interface AuthCtx {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  canAssign: boolean;
  isManager: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const clear = useCallback(async () => {
    await setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    setUser(await api.get<User>('/auth/me'));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void clear());
    (async () => {
      const s = await loadSession();
      if (s.token) {
        try {
          await refresh();
        } catch {
          await clear();
        }
      }
      setReady(true);
    })();
  }, [clear, refresh]);

  // Đăng ký FCM token mỗi khi có người dùng đăng nhập
  useEffect(() => {
    if (!user) return;
    let unsub: (() => void) | undefined;
    registerForPush().then((u) => (unsub = u));
    return () => unsub?.();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ token: string; user: User }>('/auth/login', { username, password });
    await setToken(r.token);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await unregisterPush();
    await clear();
  }, [clear]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      ready,
      login,
      logout,
      refresh,
      canAssign: !!user && user.role !== 'STAFF',
      isManager: user?.role === 'HEAD' || user?.role === 'ADMIN',
    }),
    [user, ready, login, logout, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth ngoài AuthProvider');
  return c;
}
