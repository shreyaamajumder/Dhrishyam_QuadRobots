// src/context/AppContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Role, UserProfile, TenantSummary, RegisterBrandPayload } from '../types/domain';
import { api, SEEDED_ACME_WORKSPACE } from '../services/api';
import { supabase } from '../services/supabase';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  type: 'success' | 'info' | 'warning' | 'error';
  undoAction?: () => void;
  undoLabel?: string;
}

export { SEEDED_ACME_WORKSPACE };

interface AppContextValue {
  user: UserProfile | null;
  availableTenants: TenantSummary[];
  login: (email: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  loginAsRole?: (role: Role) => void;
  logout: () => Promise<void> | void;
  switchRole?: (role: Role) => void;
  registerBrand: (payload: RegisterBrandPayload) => Promise<{ success: boolean; error?: string }>;
  switchTenant: (tenantId: string) => void;
  /** False until a saved Supabase session has been checked on page load. */
  isAuthReady: boolean;
  refreshWorkspaces?: () => Promise<TenantSummary[]>;
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
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
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

  const [availableTenants, setAvailableTenants] = useState<TenantSummary[]>(() => {
    if (supabase) return [];
    try {
      const stored = localStorage.getItem('dhrishyam_tenants');
      if (stored) {
        const parsed = JSON.parse(stored) as TenantSummary[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Ignore parse failure
    }
    // Fallback: If user is stored, seed user's tenant + Acme Cloud
    try {
      const storedUser = localStorage.getItem('dhrishyam_user');
      if (storedUser) {
        const u = JSON.parse(storedUser) as UserProfile;
        const uTenant: TenantSummary = {
          id: u.org_id,
          org_id: u.org_id,
          name: u.org_name,
          org_name: u.org_name,
          role: u.role,
          library_version: u.library_version ?? 1,
        };
        return u.org_id === SEEDED_ACME_WORKSPACE.id ? [SEEDED_ACME_WORKSPACE] : [uTenant, SEEDED_ACME_WORKSPACE];
      }
    } catch {
      // Ignore
    }
    return [SEEDED_ACME_WORKSPACE];
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isDisclosureOpen, setDisclosureOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSessionExpired, setSessionExpired] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<string>('my-content');
  const [libraryVersion, setLibraryVersion] = useState<number>(14);
  const [isAuthReady, setAuthReady] = useState<boolean>(!supabase);

  // Theme Management (Light vs Night / Dark theme)
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem('dhrishyam_theme');
      if (stored === 'dark' || stored === 'light') return stored;
      if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {}
    return 'dark'; // Default to sleek night theme for Dhrishyam
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('dhrishyam_theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const setTheme = (newTheme: 'light' | 'dark') => {
    setThemeState(newTheme);
  };

  // Sync route from URL hash if available
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '');
      setCurrentRoute(hash || 'my-content');
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Multi-tab storage synchronization
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'dhrishyam_user') {
        if (e.newValue) {
          try {
            setUser(JSON.parse(e.newValue) as UserProfile);
          } catch {
            // Ignore
          }
        } else {
          setUser(null);
        }
      } else if (e.key === 'dhrishyam_token' && !e.newValue) {
        setUser(null);
      } else if (e.key === 'dhrishyam_tenants' && e.newValue) {
        try {
          const list = JSON.parse(e.newValue) as TenantSummary[];
          if (Array.isArray(list)) setAvailableTenants(list);
        } catch {
          // Ignore
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
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

  // Synchronize available workspaces from backend or offline store
  const refreshWorkspaces = async (): Promise<TenantSummary[]> => {
    try {
      const workspaces = await api.getWorkspaces(user ?? undefined);
      if (Array.isArray(workspaces) && workspaces.length > 0) {
        const hasAcme = workspaces.some(
          (w) => (w.id && w.id === SEEDED_ACME_WORKSPACE.id) || (w.org_id && w.org_id === SEEDED_ACME_WORKSPACE.id)
        );
        const list = hasAcme || supabase ? workspaces : [...workspaces, SEEDED_ACME_WORKSPACE];
        setAvailableTenants(list);
        try {
          localStorage.setItem('dhrishyam_tenants', JSON.stringify(list));
        } catch {
          // Ignore
        }
        return list;
      }
    } catch {
      // Fallback: keep existing tenants
    }
    return availableTenants;
  };

  useEffect(() => {
    if (user) {
      refreshWorkspaces();
    }
  }, [user?.id, user?.org_id]);

  const homeFor = (role: Role) =>
    role === 'creator' ? 'my-content' : role === 'reviewer' ? 'review-queue' : 'insights';

  // Real sign-in: restore a saved Supabase session on page load, and react when Supabase
  // signs the user out (for example when the refresh token has expired).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    api.restoreSession().then((restored) => {
      if (cancelled) return;
      setUser(restored);
      if (restored) {
        setAvailableTenants(restored.organizations ?? []);
        const hash = window.location.hash.replace(/^#\/?/, '');
        if (!hash || hash === 'login' || hash === 'register') navigate(homeFor(restored.role));
      }
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setAvailableTenants([]);
      }
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setToasts([]);
      const loggedUser = await api.login(email, password);
      setUser(loggedUser);
      setSessionExpired(false);
      try {
        localStorage.setItem('dhrishyam_user', JSON.stringify(loggedUser));
      } catch {
        // Ignore localStorage quota
      }

      // Populate workspaces
      try {
        const workspaces = await api.getWorkspaces(loggedUser);
        const hasAcme = workspaces.some(
          (w) => (w.id && w.id === SEEDED_ACME_WORKSPACE.id) || (w.org_id && w.org_id === SEEDED_ACME_WORKSPACE.id)
        );
        const list = hasAcme || supabase ? workspaces : [...workspaces, SEEDED_ACME_WORKSPACE];
        setAvailableTenants(list);
        try {
          localStorage.setItem('dhrishyam_tenants', JSON.stringify(list));
        } catch {}
      } catch {
        const fallbackList: TenantSummary[] = [
          {
            id: loggedUser.org_id,
            org_id: loggedUser.org_id,
            name: loggedUser.org_name,
            org_name: loggedUser.org_name,
            role: loggedUser.role,
            library_version: loggedUser.library_version ?? 1,
          },
        ];
        if (!supabase && loggedUser.org_id !== SEEDED_ACME_WORKSPACE.id) {
          fallbackList.push(SEEDED_ACME_WORKSPACE);
        }
        setAvailableTenants(fallbackList);
      }

      setToasts([]);
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

  const registerBrand = async (
    payload: RegisterBrandPayload
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setToasts([]);
      const newUser = await api.registerBrand(payload);
      setUser(newUser);
      setSessionExpired(false);

      try {
        localStorage.setItem('dhrishyam_user', JSON.stringify(newUser));
      } catch {
        // Ignore quota
      }

      // Refresh workspaces
      try {
        const workspaces = await api.getWorkspaces(newUser);
        const hasAcme = workspaces.some(
          (w) => (w.id && w.id === SEEDED_ACME_WORKSPACE.id) || (w.org_id && w.org_id === SEEDED_ACME_WORKSPACE.id)
        );
        const list = hasAcme || supabase ? workspaces : [...workspaces, SEEDED_ACME_WORKSPACE];
        setAvailableTenants(list);
        try {
          localStorage.setItem('dhrishyam_tenants', JSON.stringify(list));
        } catch {}
      } catch {
        const newTenant: TenantSummary = {
          id: newUser.org_id,
          org_id: newUser.org_id,
          name: newUser.org_name,
          org_name: newUser.org_name,
          role: newUser.role,
          library_version: newUser.library_version ?? 1,
        };
        setAvailableTenants((prev) => {
          const filtered = prev.filter((t) => (t.id || t.org_id) !== newUser.org_id);
          const list = [newTenant, ...filtered];
          try {
            localStorage.setItem('dhrishyam_tenants', JSON.stringify(list));
          } catch {}
          return list;
        });
      }

      // Reset cache version to cause fresh queries in all components
      setLibraryVersion((v) => v + 1);

      pushToast({
        title: 'Brand Registered Successfully',
        description: `Welcome to ${newUser.org_name}! You are logged in as Administrator.`,
        type: 'success',
      });

      navigate('insights');
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Brand registration failed. Please try again.';
      return { success: false, error: message };
    }
  };

  const switchTenant = (tenantId: string) => {
    const target = availableTenants.find(
      (t) => (t.id && t.id === tenantId) || (t.org_id && t.org_id === tenantId)
    );
    if (!target) {
      pushToast({
        title: 'Workspace switch failed',
        description: `Workspace '${tenantId}' not found.`,
        type: 'error',
      });
      return;
    }

    const targetId = target.id || target.org_id || tenantId;
    const targetName = target.name || target.org_name || 'Workspace';
    const targetRole = target.role || 'creator';

    const updatedUser: UserProfile = {
      ...(user || {
        id: 'usr_default',
        email: 'user@workspace.io',
        display_name: 'Workspace User',
        library_version: 1,
        last_active: new Date().toISOString(),
      }),
      org_id: targetId,
      org_name: targetName,
      role: targetRole,
      library_version: target.library_version ?? 1,
    };

    // If switching to seeded demo workspace and using demo tokens, synchronize token role
    if (targetId === SEEDED_ACME_WORKSPACE.id) {
      try {
        const currentToken = localStorage.getItem('dhrishyam_token');
        if (!currentToken || currentToken.startsWith('demo-')) {
          localStorage.setItem('dhrishyam_token', `demo-${targetRole}-token`);
        }
      } catch {}
    }

    setUser(updatedUser);

    try {
      localStorage.setItem('dhrishyam_user', JSON.stringify(updatedUser));
      localStorage.setItem('dhrishyam_active_org', targetId);
    } catch {
      // Ignore quota
    }

    // Invalidate caches across stores and components
    setLibraryVersion((v) => v + 1);

    // Route guard transition reconciliation
    const cleanRoute = currentRoute.split('?')[0];
    const base = cleanRoute.split('/')[0];
    let shouldRedirect = false;
    let nextRoute = currentRoute;

    // Content specific pages cannot persist across tenants
    if (base === 'workspace' || base === 'new-review') {
      shouldRedirect = true;
    } else if ((base === 'team' || base === 'audit-log') && targetRole !== 'admin') {
      shouldRedirect = true;
    } else if (base === 'review-queue' && targetRole === 'creator') {
      shouldRedirect = true;
    } else if (base === 'insights' && targetRole === 'creator') {
      shouldRedirect = true;
    }

    if (shouldRedirect) {
      if (targetRole === 'creator') nextRoute = 'my-content';
      else if (targetRole === 'reviewer') nextRoute = 'review-queue';
      else nextRoute = 'insights';
      navigate(nextRoute);
    }

    pushToast({
      title: `Switched to ${targetName}`,
      description: `Active role: ${targetRole.toUpperCase()}`,
      type: 'info',
    });
  };

  const loginAsRole = (role: Role) => {
    if (supabase) return; // demo accounts only exist without real sign-in
    setToasts([]);
    const selected = api.getDemoUsers()[role];
    setUser({ ...selected });
    setSessionExpired(false);
    setAvailableTenants([SEEDED_ACME_WORKSPACE]);
    try {
      localStorage.setItem('dhrishyam_token', `demo-${role}-token`);
      localStorage.setItem('dhrishyam_user', JSON.stringify(selected));
      localStorage.setItem('dhrishyam_tenants', JSON.stringify([SEEDED_ACME_WORKSPACE]));
    } catch {
      // Ignore
    }
    pushToast({
      title: 'Signed in successfully',
      description: `Welcome, ${selected.display_name} (${selected.role.toUpperCase()})`,
      type: 'success',
    });
    if (role === 'creator') navigate('my-content');
    else if (role === 'reviewer') navigate('review-queue');
    else navigate('insights');
  };

  const switchRole = (role: Role) => {
    const selected = api.getDemoUsers()[role];
    setUser({ ...selected });
    try {
      localStorage.setItem('dhrishyam_token', `demo-${role}-token`);
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

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Silently catch network errors during logout
    } finally {
      setUser(null);
      setToasts([]);
      try {
        localStorage.removeItem('dhrishyam_token');
        localStorage.removeItem('dhrishyam_user');
        localStorage.removeItem('dhrishyam_tenants');
      } catch {
        // Ignore
      }
      pushToast({
        title: 'Signed out',
        description: 'You have been securely logged out.',
        type: 'info',
      });
      navigate('login');
    }
  };

  const incrementLibraryVersion = () => {
    setLibraryVersion((v) => v + 1);
  };

  return (
    <AppContext.Provider
      value={{
        user,
        availableTenants,
        login,
        loginAsRole,
        logout,
        switchRole,
        registerBrand,
        switchTenant,
        isAuthReady,
        refreshWorkspaces,
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
        theme,
        toggleTheme,
        setTheme,
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
