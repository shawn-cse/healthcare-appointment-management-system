import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/api.ts';
import type { User } from '../types/index.ts';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string, portal?: 'patient' | 'staff') => Promise<User>;
  register: (payload: Record<string, string>) => Promise<User>;
  refreshMe: () => Promise<User | null>;
  setUserState: (u: User | null) => void;
  logout: () => 'patient' | 'staff';
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = localStorage.getItem('gh_user');
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState<boolean>(true);

  const setUserState = useCallback((u: User | null) => {
    setUser(u);
    if (u) {
      localStorage.setItem('gh_user', JSON.stringify(u));
    } else {
      localStorage.removeItem('gh_user');
    }
  }, []);

  const refreshMe = useCallback(async () => {
    const token = localStorage.getItem('gh_token');
    if (!token) {
      setUserState(null);
      return null;
    }
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      setUserState(res.data.user);
      return res.data.user;
    } catch {
      localStorage.removeItem('gh_token');
      setUserState(null);
      return null;
    }
  }, [setUserState]);

  useEffect(() => {
    refreshMe().finally(() => setLoading(false));
    const onUnauth = () => {
      setUser(null);
    };
    const onFocus = () => {
      if (localStorage.getItem('gh_token')) {
        void refreshMe();
      }
    };
    window.addEventListener('gh:unauthorized', onUnauth);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('gh:unauthorized', onUnauth);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshMe]);

  const login = async (
    identifier: string,
    password: string,
    portal?: 'patient' | 'staff'
  ): Promise<User> => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', {
      identifier,
      password,
      portal,
    });
    localStorage.setItem('gh_token', res.data.token);
    setUserState(res.data.user);
    return res.data.user;
  };

  const register = async (payload: Record<string, string>): Promise<User> => {
    const res = await api.post<{ token: string; user: User }>('/auth/register', payload);
    localStorage.setItem('gh_token', res.data.token);
    setUserState(res.data.user);
    return res.data.user;
  };

  const logout = (): 'patient' | 'staff' => {
    const prevRole = user?.role;
    localStorage.removeItem('gh_token');
    setUserState(null);
    return prevRole === 'patient' ? 'patient' : 'staff';
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, refreshMe, setUserState, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
