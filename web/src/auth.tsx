import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api';
import { disablePush, syncPush } from './push';
import type { User } from './types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  isManager: boolean; // Trưởng phòng / quản trị
  canAssign: boolean; // Trưởng phòng / Phó phòng / quản trị
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  const clear = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  /** Đăng xuất: gỡ thiết bị khỏi danh sách nhận thông báo của tài khoản rồi mới xoá phiên */
  const logout = useCallback(async () => {
    await disablePush();
    clear();
  }, [clear]);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) return;
    try {
      setUser(await api.get<User>('/auth/me'));
    } catch {
      clear();
    } finally {
      setLoading(false);
    }
  }, [clear]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    void refresh();
  }, [clear, refresh]);

  // Mỗi lần có người đăng nhập: đồng bộ đăng ký thông báo của thiết bị (nếu đã cho phép)
  useEffect(() => {
    if (!user?.id) return;
    void syncPush();
    // Ứng dụng trên điện thoại thường chỉ ẩn/hiện chứ không mở lại → đồng bộ lại khi quay về (tối đa 10 phút/lần)
    let last = Date.now();
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 10 * 60_000) {
        last = Date.now();
        void syncPush();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [user?.id]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ token: string; user: User }>('/auth/login', { username, password });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      login,
      logout,
      refresh,
      isManager: user?.role === 'ADMIN' || user?.role === 'HEAD',
      canAssign: !!user && user.role !== 'STAFF',
    }),
    [user, loading, login, logout, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth ngoài AuthProvider');
  return c;
}
