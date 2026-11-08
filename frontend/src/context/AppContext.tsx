// src/context/AppContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Role, UserProfile } from '../types/domain';
import { api } from '../services/api';
import { supabase } from '../services/supabase';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  type: 'success' | 'info' | 'warning' | 'error';
  undoAction?: () => void;
  undoLabel?: string;
}

interface AppContextValue {
  user: UserProfile | null;
  login: (email: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  loginAsRole?: (role: Role) => void;
  logout: () => void;
  switchRole?: (role: Role) => void;
  toasts: ToastMessage[];
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  isDisclosureOpen: boolean;
  setDisclosureOpen: (open: boolean) => void;
  isOffline: boolean;
  /** False until a saved Supabase session has been checked on page load. */
  isAuthReady: boolean;
  isSessionExpired: boolean;
  setSessionExpired: (expired: boolean) => void;
  currentRoute: string;
  navigate: (route: string) => void;
  libraryVersion: number;
  incrementLibraryVersion: () => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(() => {
    // With real sign-in, the saved Supabase session decides who is signed in (checked below).
    if (supabase) return null;
    try {
      const stored = localStorage.getItem('dhrishyam_user');
      return stored ? (JSON.parse(stored) as UserProfile) : null;
    } catch {
      return null;
    }
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isDisclosureOpen, setDisclosureOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSessionExpired, setSessionExpired] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<string>('my-content');
  const [libraryVersion, setLibraryVersion] = useState<number>(14);
  const [isAuthReady, setAuthReady] = useState<boolean>(!supabase);

  // Sync route from URL hash if available
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '');
      if (hash) {
        setCurrentRoute(hash);
      }
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (route: string) => {
    window.location.hash = route;
    setCurrentRoute(route);
  };

  const homeFor = (role: Role) =>
    role === 'creator' ? 'my-content' : role === 'reviewer' ? 'review-queue' : 'insights';

  // Real sign-in: restore a saved session on page load, and react when Supabase signs out
  // (for example when the refresh token has expired).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    api.restoreSession().then((restored) => {
      if (cancelled) return;
      setUser(restored);
      setAuthReady(true);
      if (restored) {
        const hash = window.location.hash.replace(/^#\/?/, '');
        if (!hash || hash === 'login') navigate(homeFor(restored.role));
      }
    });
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        try {
          localStorage.removeItem('dhrishyam_user');
        } catch {
          // Ignore
        }
      }
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const pushToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = `tst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const login = async (email: string, password?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const loggedUser = await api.login(email, password);
      setUser(loggedUser);
      setSessionExpired(false);
      try {
        localStorage.setItem('dhrishyam_user', JSON.stringify(loggedUser));
      } catch {
        // Ignore localStorage quota
      }
      pushToast({
        title: 'Signed in successfully',
        description: `Welcome back, ${loggedUser.display_name}`,
        type: 'success',
      });
      navigate(homeFor(loggedUser.role));
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid credentials';
      return { success: false, error: message };
    }
  };

  const loginAsRole = (role: Role) => {
    const selected = api.getDemoUsers()[role];
    setUser({ ...selected });
    setSessionExpired(false);
    try {
      localStorage.setItem('dhrishyam_user', JSON.stringify(selected));
    } catch {
      // Ignore
    }
    if (role === 'creator') navigate('my-content');
    else if (role === 'reviewer') navigate('review-queue');
    else navigate('insights');
  };

  const switchRole = (role: Role) => {
    const selected = api.getDemoUsers()[role];
    setUser({ ...selected });
    try {
      localStorage.setItem('dhrishyam_user', JSON.stringify(selected));
    } catch {
      // Ignore
    }
    pushToast({
      title: `Switched role to ${role.toUpperCase()}`,
      description: `Signed in as ${selected.display_name} (${selected.email})`,
      type: 'info',
    });
    if (role === 'reviewer' && currentRoute === 'my-content') {
      navigate('review-queue');
    } else if (role === 'creator' && (currentRoute === 'review-queue' || currentRoute === 'team' || currentRoute === 'audit-log')) {
      navigate('my-content');
    }
  };

  const logout = () => {
    setUser(null);
    api.logout().catch(() => {
      // Signing out locally still happens if Supabase cannot be reached.
    });
    navigate('login');
  };

  const incrementLibraryVersion = () => {
    setLibraryVersion((v) => v + 1);
  };

  return (
    <AppContext.Provider
      value={{
        user,
        login,
        loginAsRole,
        logout,
        switchRole,
        toasts,
        pushToast,
        dismissToast,
        isDisclosureOpen,
        setDisclosureOpen,
        isOffline,
        isAuthReady,
        isSessionExpired,
        setSessionExpired,
        currentRoute,
        navigate,
        libraryVersion,
        incrementLibraryVersion,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextValue => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
};
