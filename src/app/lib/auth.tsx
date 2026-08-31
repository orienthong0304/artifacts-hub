/* eslint-disable react-refresh/only-export-components */
/**
 * 登录态上下文：启动时 GET /api/me 恢复会话
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authApi, type User } from '@/app/lib/api';

interface AuthContextValue {
  /** 当前用户；未登录为 null */
  user: User | null;
  /** 初始 /api/me 是否仍在加载 */
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, username: string) => Promise<User>;
  logout: () => Promise<void>;
  /** 重新拉取 /api/me */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await authApi.me();
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user } = await authApi.me();
        if (!cancelled) setUser(user);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await authApi.login({ email, password });
    setUser(user);
    return user;
  }, []);

  const register = useCallback(
    async (email: string, password: string, username: string) => {
      // agreeTerms 由注册页勾选校验后才提交（契约 §3.4）
      const { user } = await authApi.register({ email, password, username, agreeTerms: true });
      setUser(user);
      return user;
    },
    [],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}
