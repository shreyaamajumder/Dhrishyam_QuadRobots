// src/context/AppContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Role, UserProfile } from '../types/domain';
import { api } from '../services/api';

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
      if (loggedUser.role === 'creator') navigate('my-content');
      else if (loggedUser.role === 'reviewer') navigate('review-queue');
      else navigate('insights');
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
    try {
      localStorage.removeItem('dhrishyam_user');
    } catch {
      // Ignore
    }
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
