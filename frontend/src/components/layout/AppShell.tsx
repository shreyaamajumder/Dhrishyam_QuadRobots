// src/components/layout/AppShell.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  PlusCircle,
  Inbox,
  BookOpen,
  BarChart3,
  Users,
  Shield,
  Bell,
  LogOut,
  WifiOff,
  X,
  Menu,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { DisclosureInfo, NotificationItem, Role } from '../../types/domain';
import { TenantSwitcher } from './TenantSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { DhrishyamLogo } from '../shared/DhrishyamLogo';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const {
    user,
    logout,
    isDisclosureOpen,
    setDisclosureOpen,
    isOffline,
    currentRoute,
    navigate,
    libraryVersion,
  } = useApp();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [disclosureData, setDisclosureData] = useState<DisclosureInfo | null>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dhrishyam_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('dhrishyam_sidebar_collapsed', next ? 'true' : 'false');
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const notifRef = useRef<HTMLDivElement>(null);

  // Load notifications and disclosure info
  useEffect(() => {
    if (user) {
      api.getNotifications(user.id).then(setNotifications).catch(() => {});
    }
    api.getDisclosure().then(setDisclosureData).catch(() => {});
  }, [user]);

  // Click outside notifications popover
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    if (isNotifOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isNotifOpen]);

  const unreadNotifs = notifications.filter((n) => !n.read_at);

  const handleMarkAllRead = async () => {
    if (!user) return;
    await api.markAllNotificationsRead(user.id);
    const updated = await api.getNotifications(user.id);
    setNotifications(updated);
  };

  const navItems = [
    {
      id: 'my-content',
      label: 'Content Ledger',
      icon: <FileText className="w-4 h-4" />,
      roles: ['creator', 'admin'] as Role[],
    },
    {
      id: 'new-review',
      label: 'New Manuscript',
      icon: <PlusCircle className="w-4 h-4" />,
      roles: ['creator', 'admin'] as Role[],
    },
    {
      id: 'review-queue',
      label: 'Approval Gateway',
      icon: <Inbox className="w-4 h-4" />,
      roles: ['reviewer', 'admin'] as Role[],
    },
    {
      id: 'library',
      label: 'Brand Codex',
      icon: <BookOpen className="w-4 h-4" />,
      roles: ['creator', 'reviewer', 'admin'] as Role[],
    },
    {
      id: 'insights',
      label: 'Editorial Analytics',
      icon: <BarChart3 className="w-4 h-4" />,
      roles: ['reviewer', 'admin'] as Role[],
    },
    {
      id: 'team',
      label: 'Team & Roles',
      icon: <Users className="w-4 h-4" />,
      roles: ['admin'] as Role[],
    },
    {
      id: 'audit-log',
      label: 'Audit Trail',
      icon: <Shield className="w-4 h-4" />,
      roles: ['admin'] as Role[],
    },
  ];

  const visibleNav = navItems.filter((item) => user && item.roles.includes(user.role));

  if (!user) {
    return (
      <div className="min-h-screen text-[#282828] dark:text-[#ebdbb2] relative">
        <div className="relative z-10">{children}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 h-screen h-[100dvh] w-screen overflow-hidden flex flex-col text-[#282828] dark:text-[#ebdbb2] font-sans transition-colors duration-150 selection:bg-[#458588]/25 selection:text-[#282828] dark:selection:bg-[#83a598]/30 dark:selection:text-white">
      {/* Offline Banner */}
      {isOffline && (
        <div
          role="status"
          className="shrink-0 bg-[#af3a03] text-white px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 z-50 shadow-sm"
        >
          <WifiOff className="w-4 h-4" />
          <span>Offline mode active · Local storage sync enabled.</span>
        </div>
      )}

      {/* Main App Container */}
      <div className="flex-1 flex min-h-0 h-full overflow-hidden relative z-10">
        {/* Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 bg-white/95 dark:bg-[#282828]/95 backdrop-blur-xl border-r border-[#e2e0dc] dark:border-[#3c3836] flex flex-col h-full shrink-0 transition-all duration-300 ease-in-out lg:relative lg:translate-x-0 shadow-lg lg:shadow-none ${
            isMobileNavOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'
          } ${isSidebarCollapsed ? 'lg:w-[72px]' : 'lg:w-64'}`}
        >
          {/* Brand Header */}
          <div
            className={`shrink-0 border-b border-[#e2ded5] dark:border-[#3c3836] flex items-center transition-all ${
              isSidebarCollapsed
                ? 'p-3 flex-col gap-2 justify-center items-center'
                : 'p-4 justify-between'
            }`}
          >
            <DhrishyamLogo
              size={isSidebarCollapsed ? 'sm' : 'md'}
              showWordmark={!isSidebarCollapsed}
            />
            {/* Desktop collapse toggle */}
            <button
              type="button"
              onClick={toggleSidebar}
              title={isSidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
              className="hidden lg:flex p-1.5 rounded-lg text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white hover:bg-[#edeae1] dark:hover:bg-[#3c3836] transition-colors cursor-pointer"
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>

            {/* Mobile close button */}
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white hover:bg-[#edeae1] dark:hover:bg-[#3c3836] transition-colors cursor-pointer"
              aria-label="Close navigation menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav
            className={`flex-1 min-h-0 space-y-1.5 overflow-y-auto overscroll-contain ${
              isSidebarCollapsed ? 'p-2' : 'p-2.5'
            }`}
          >
            {visibleNav.map((item) => {
              const isActive = currentRoute === item.id || currentRoute.startsWith(`${item.id}/`);
              return (
                <button
                  key={item.id}
                  type="button"
                  title={isSidebarCollapsed ? item.label : undefined}
                  onClick={() => {
                    navigate(item.id);
                    setIsMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center rounded-xl text-xs font-medium transition-all cursor-pointer relative group tap-interactive ${
                    isSidebarCollapsed ? 'justify-center p-2.5' : 'px-3 py-2.5 gap-2.5'
                  } ${
                    isActive
                      ? 'bg-[#282828] text-white dark:bg-[#f0eee9] dark:text-[#1d2021] font-semibold shadow-xs'
                      : 'text-[#504945] dark:text-[#d6d4ce] hover:text-[#282828] dark:hover:text-white hover:bg-[#f0eee9]/60 dark:hover:bg-[#32302f]/80'
                  }`}
                >
                  {/* Professional Teal warm indicator when active in collapsed mode */}
                  {isActive && isSidebarCollapsed && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r bg-[#1d6f7a] dark:bg-[#4ea8a0] shadow-[0_0_8px_rgba(29,111,122,0.5)]" />
                  )}
                  <span
                    className={
                      isActive
                        ? 'text-[#1d6f7a] dark:text-[#4ea8a0]'
                        : 'text-[#7c6f64] dark:text-[#a89984] group-hover:text-[#282828] dark:group-hover:text-white'
                    }
                  >
                    {item.icon}
                  </span>
                  {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Tenant Switcher footer (pinned bottom-left account button) */}
          <div className="shrink-0 mt-auto">
            <TenantSwitcher collapsed={isSidebarCollapsed} />
          </div>
        </aside>

        {/* Mobile backdrop */}
        {isMobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs lg:hidden"
            onClick={() => setIsMobileNavOpen(false)}
          />
        )}

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
          {/* Top Bar (Pinned) */}
          <header className="sticky top-0 h-14 bg-white/95 dark:bg-[#242728]/95 backdrop-blur-md border-b border-[#e2ded5] dark:border-[#32302f] px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 z-20 transition-colors">
            {/* Left: Mobile hamburger (Single side panel button on mobile) + Desktop Sidebar Toggle + Breadcrumb */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(true)}
                className="lg:hidden text-[#4a4440] dark:text-[#ebdbb2] hover:text-[#282828] dark:hover:text-white p-2 rounded-lg hover:bg-[#edeae1] dark:hover:bg-[#32302f] cursor-pointer"
                aria-label="Open navigation menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={toggleSidebar}
                title={isSidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
                className="hidden lg:flex text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white p-1.5 rounded-lg hover:bg-[#edeae1] dark:hover:bg-[#32302f] transition-colors cursor-pointer"
                aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {isSidebarCollapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
              <div className="flex items-center gap-1.5 text-xs text-[#706860] dark:text-[#a89984]">
                <span className="hidden sm:inline font-medium">Console</span>
                <span className="hidden sm:inline text-[#b8b2a2] dark:text-[#504945]">/</span>
                <span className="font-semibold text-[#282828] dark:text-[#fbf1c7] capitalize">
                  {currentRoute.split('/')[0].replace('-', ' ')}
                </span>
              </div>
            </div>

            {/* Right: Theme Toggle + Guardrails + Notifications + User Identity */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Theme Toggle Button */}
              <ThemeToggle />

              {/* Guardrails Policy Pill in Professional Teal */}
              <button
                type="button"
                onClick={() => setDisclosureOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-sans font-medium bg-[#1d6f7a]/10 dark:bg-[#4ea8a0]/15 text-[#1d6f7a] dark:text-[#4ea8a0] border border-[#1d6f7a]/25 dark:border-[#4ea8a0]/30 hover:bg-[#1d6f7a]/20 transition-all cursor-pointer shadow-2xs tap-interactive"
                title="View active policy models and guardrail specifications"
              >
                <span className="w-2 h-2 rounded-full bg-[#1d6f7a] dark:bg-[#4ea8a0] animate-pulse" />
                <span className="hidden sm:inline">Guardrails</span>
                <span className="text-[10px] font-semibold opacity-90">Active</span>
              </button>

              {/* Notifications Popover */}
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => setIsNotifOpen((v) => !v)}
                  className="relative p-2 text-[#7c6f64] dark:text-[#a89984] hover:text-[#282828] dark:hover:text-white rounded-xl hover:bg-[#f0eee9] dark:hover:bg-[#3c3836] transition-colors cursor-pointer tap-interactive"
                  aria-label="View notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadNotifs.length > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#d65d0e] dark:bg-[#fe8019] ring-2 ring-white dark:ring-[#282828]" />
                  )}
                </button>

                {isNotifOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#32302f] rounded-2xl shadow-xl border border-[#e2e0dc] dark:border-[#504945] p-3.5 z-50 animate-in fade-in duration-100">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#e2e0dc] dark:border-[#3c3836]">
                      <span className="text-xs font-semibold text-[#282828] dark:text-white">
                        Notifications ({unreadNotifs.length})
                      </span>
                      {unreadNotifs.length > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-[11px] text-[#458588] dark:text-[#83a598] hover:underline cursor-pointer font-medium"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-1.5">
                      {notifications.length === 0 ? (
                        <div className="text-center py-6 text-xs text-[#7c6f64] dark:text-[#a89984]">
                          No unread notifications
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className={`p-2.5 rounded-xl text-xs transition-colors ${
                              n.read_at
                                ? 'bg-transparent text-[#7c6f64] dark:text-[#a89984]'
                                : 'bg-[#f0eee9]/80 dark:bg-[#3c3836]/80 text-[#282828] dark:text-white border border-[#e2e0dc] dark:border-[#504945]'
                            }`}
                          >
                            <div className="font-semibold">{n.content_title}</div>
                            <div className="text-[11px] text-[#504945] dark:text-[#d6d4ce] mt-0.5">{n.message}</div>
                            <div className="text-[10px] text-[#7c6f64] dark:text-[#a89984] mt-1 font-mono">
                              {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* User Identity Display */}
              <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-[#e2e0dc] dark:border-[#3c3836]">
                <div
                  className="w-7 h-7 rounded-lg bg-[#282828] dark:bg-[#f0eee9] text-white dark:text-[#282828] font-bold flex items-center justify-center text-xs shrink-0"
                  title={user.display_name}
                >
                  {user.display_name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase() || 'U'}
                </div>
                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-xs font-semibold text-[#282828] dark:text-white leading-tight">
                    {user.display_name}
                  </span>
                  <span className="text-[10px] text-[#7c6f64] dark:text-[#a89984] capitalize">
                    {user.role}
                  </span>
                </div>
              </div>

              {/* Sign out */}
              <button
                type="button"
                onClick={logout}
                className="p-1.5 text-[#7c6f64] hover:text-[#cc241d] dark:text-[#a89984] dark:hover:text-[#fb4934] rounded-lg hover:bg-[#f0eee9] dark:hover:bg-[#3c3836] transition-colors cursor-pointer tap-interactive"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Main Body Viewport (Single side panel button in top bar, zero mobile navigation conflicts) */}
          <main className="flex-1 min-h-0 h-full overflow-y-auto overscroll-contain relative pb-0">{children}</main>
        </div>
      </div>

      {/* S14 AI Disclosure & Guardrails Modal */}
      {isDisclosureOpen && disclosureData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-100"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disclosure-title"
        >
          <div className="bg-white dark:bg-[#282828] rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-[#e2e0dc] dark:border-[#504945] max-h-[85vh] overflow-y-auto space-y-4 animate-in zoom-in-95 duration-100">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#e2e0dc] dark:border-[#3c3836]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#689d6a]/15 dark:bg-[#8ec07c]/15 text-[#689d6a] dark:text-[#8ec07c] flex items-center justify-center border border-[#689d6a]/30 dark:border-[#8ec07c]/30 shadow-2xs">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="disclosure-title" className="font-serif text-lg font-medium text-[#282828] dark:text-white">
                    AI Policy & Guardrail Architecture
                  </h3>
                  <p className="text-xs text-[#7c6f64] dark:text-[#a89984]">Institutional Grounding & Safeguards</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDisclosureOpen(false)}
                className="text-[#7c6f64] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white p-1.5 rounded-lg transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-[#3c3836] dark:text-[#ebdbb2] leading-relaxed">
              <div className="p-3.5 bg-[#f0eee9]/80 dark:bg-[#32302f]/80 rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] space-y-1.5 text-[11px]">
                <div className="font-bold text-[#282828] dark:text-white uppercase tracking-wider text-[11px] font-sans">
                  Inference Model Specifications
                </div>
                <div className="text-[#504945] dark:text-[#d6d4ce]">Provider: <span className="text-[#282828] dark:text-white font-semibold">{disclosureData.provider}</span></div>
                <div className="text-[#504945] dark:text-[#d6d4ce]">Inference Engine: <span className="text-[#282828] dark:text-white font-semibold">{disclosureData.model}</span></div>
                <div className="text-[#504945] dark:text-[#d6d4ce]">Prompt Hash: <span className="text-[#282828] dark:text-white font-mono">{disclosureData.prompt_version}</span></div>
              </div>

              <div className="p-3.5 bg-[#d65d0e]/10 dark:bg-[#fe8019]/10 rounded-xl border border-[#d65d0e]/25 dark:border-[#fe8019]/25 text-xs">
                <div className="font-semibold mb-1 text-xs text-[#af3a03] dark:text-[#fe8019]">Data Privacy Guarantee</div>
                {disclosureData.data_use_note}
              </div>

              <div className="p-3.5 bg-[#458588]/10 dark:bg-[#83a598]/10 rounded-xl border border-[#458588]/25 dark:border-[#83a598]/25 text-xs">
                <div className="font-semibold mb-1 text-xs text-[#076678] dark:text-[#83a598]">Human Control Guarantee</div>
                {disclosureData.human_control_guarantee}
              </div>

              <div>
                <div className="font-semibold text-[#282828] dark:text-white mb-1 text-xs">
                  Scope of Transmitted Data:
                </div>
                <p className="text-[#504945] dark:text-[#d6d4ce]">{disclosureData.sent_data_scope}</p>
              </div>

              <div>
                <div className="font-semibold text-[#282828] dark:text-white mb-1 text-xs">
                  Known Limitations:
                </div>
                <ul className="list-disc pl-5 space-y-1 text-[#504945] dark:text-[#d6d4ce]">
                  {disclosureData.known_limitations.map((lim, idx) => (
                    <li key={idx}>{lim}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-[#e2e0dc] dark:border-[#3c3836]">
              <button
                type="button"
                onClick={() => setDisclosureOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#282828] dark:bg-[#f0eee9] text-white dark:text-[#1d2021] hover:bg-[#3c3836] dark:hover:bg-[#f5f5f4] transition-colors cursor-pointer tap-interactive"
              >
                Acknowledge Safeguards
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
