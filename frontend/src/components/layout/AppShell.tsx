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
  Sparkles,
  LogOut,
  WifiOff,
  X,
  ChevronDown,
  Check,
  RotateCcw,
  ExternalLink,
  Menu,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { DisclosureInfo, NotificationItem, Role } from '../../types/domain';
import { TenantSwitcher } from './TenantSwitcher';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const {
    user,
    logout,
    toasts,
    dismissToast,
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
      label: 'My Content',
      icon: <FileText className="w-4 h-4" />,
      roles: ['creator', 'admin'] as Role[],
    },
    {
      id: 'new-review',
      label: 'New Review',
      icon: <PlusCircle className="w-4 h-4" />,
      roles: ['creator', 'admin'] as Role[],
    },
    {
      id: 'review-queue',
      label: 'Review Queue',
      icon: <Inbox className="w-4 h-4" />,
      roles: ['reviewer', 'admin'] as Role[],
    },
    {
      id: 'library',
      label: 'Brand Library',
      icon: <BookOpen className="w-4 h-4" />,
      roles: ['creator', 'reviewer', 'admin'] as Role[],
    },
    {
      id: 'insights',
      label: 'Insights',
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
      label: 'Audit Log',
      icon: <Shield className="w-4 h-4" />,
      roles: ['admin'] as Role[],
    },
  ];

  const visibleNav = navItems.filter((item) => user && item.roles.includes(user.role));

  if (!user) {
    return <div className="min-h-screen bg-slate-50">{children}</div>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans">
      {/* S15 Offline Banner */}
      {isOffline && (
        <div
          role="status"
          className="bg-amber-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-center gap-2"
        >
          <WifiOff className="w-4 h-4" />
          <span>You&apos;re offline. Any edits will not be saved to the server until connection is restored.</span>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
            isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {/* Brand Wordmark & Library Version */}
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
                  Dh
                </div>
                <span className="font-bold text-base tracking-tight text-slate-900">
                  Dhrishyam
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Pre-Publication Governance</p>
            </div>
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200"
              title="Current organisation brand library version"
            >
              Lib v{libraryVersion}
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {visibleNav.map((item) => {
              const isActive = currentRoute === item.id || currentRoute.startsWith(`${item.id}/`);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    navigate(item.id);
                    setIsMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <span className={isActive ? 'text-indigo-600' : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Tenant Switcher footer */}
          <TenantSwitcher />
        </aside>

        {/* Mobile backdrop */}
        {isMobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
            onClick={() => setIsMobileNavOpen(false)}
          />
        )}

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Top Bar */}
          <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between gap-4 shrink-0 z-20">
            {/* Left: Mobile hamburger + Breadcrumb */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(true)}
                className="lg:hidden text-slate-600 hover:text-slate-900 p-1"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-slate-900 capitalize">
                  {currentRoute.split('/')[0].replace('-', ' ')}
                </span>
              </div>
            </div>

            {/* Right: AI Disclosure Chip + Notifications + Role Switcher */}
            <div className="flex items-center gap-2.5">
              {/* Persistent AI Disclosure Chip */}
              <button
                type="button"
                onClick={() => setDisclosureOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-800 border border-purple-200 hover:bg-purple-100 transition-colors cursor-pointer"
                title="View AI provider, models, and grounding gate guarantees"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span className="hidden sm:inline">AI Disclosure & Guardrails</span>
                <span className="sm:hidden">AI Info</span>
              </button>

              {/* S11 Notifications Popover */}
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => setIsNotifOpen((v) => !v)}
                  className="relative p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
                  aria-label="View notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadNotifs.length > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
                  )}
                </button>

                {isNotifOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 p-3 z-50">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                      <span className="text-xs font-semibold text-slate-900">Notifications</span>
                      {unreadNotifs.length > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {notifications.length === 0 ? (
                        <div className="text-center py-4 text-xs text-slate-400">
                          You&apos;re all caught up.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            onClick={() => {
                              setIsNotifOpen(false);
                              navigate(`workspace/${n.content_id}`);
                            }}
                            className={`p-2 rounded-lg text-xs cursor-pointer transition-colors ${
                              n.read_at ? 'bg-white hover:bg-slate-50' : 'bg-indigo-50/50 hover:bg-indigo-50'
                            }`}
                          >
                            <p className="text-slate-800 leading-snug">{n.message}</p>
                            <span className="text-[10px] text-slate-400 font-mono mt-1 block">
                              {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* User Identity Display */}
              <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
                <div
                  className="w-7 h-7 rounded-full bg-slate-900 text-white font-semibold flex items-center justify-center text-xs shadow-xs shrink-0"
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
                  <span className="text-xs font-semibold text-slate-900 leading-tight">
                    {user.display_name}
                  </span>
                  <span className="text-[10px] text-slate-500 font-medium capitalize">
                    {user.role}
                  </span>
                </div>
                <span
                  className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    user.role === 'admin'
                      ? 'bg-purple-50 text-purple-700 border border-purple-200'
                      : user.role === 'reviewer'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  }`}
                >
                  {user.role}
                </span>
              </div>

              {/* Sign out */}
              <button
                type="button"
                onClick={logout}
                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors ml-1 cursor-pointer"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Main Body Viewport */}
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>

      {/* S14 AI Disclosure & Limitations Modal */}
      {isDisclosureOpen && disclosureData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disclosure-title"
        >
          <div className="bg-white rounded-xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 max-h-[85vh] overflow-y-auto space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <h3 id="disclosure-title" className="text-base font-semibold text-slate-900">
                  AI Governance & Responsible Design Disclosure
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDisclosureOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="font-semibold text-slate-900 mb-1">Provider & Model Architecture</div>
                <div><strong>Primary:</strong> {disclosureData.provider}</div>
                <div><strong>Model:</strong> {disclosureData.model}</div>
                <div><strong>Prompt Version:</strong> {disclosureData.prompt_version}</div>
              </div>

              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-950">
                <div className="font-semibold mb-1">Free-Tier Data Terms & Privacy Note</div>
                {disclosureData.data_use_note}
              </div>

              <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-200 text-indigo-950">
                <div className="font-semibold mb-1">Human Control Guarantee (No Auto-Apply)</div>
                {disclosureData.human_control_guarantee}
              </div>

              <div>
                <div className="font-semibold text-slate-900 mb-1">What Data is Sent to External Providers:</div>
                <p>{disclosureData.sent_data_scope}</p>
              </div>

              <div>
                <div className="font-semibold text-slate-900 mb-1">Known Limitations:</div>
                <ul className="list-disc pl-5 space-y-1 text-slate-600">
                  {disclosureData.known_limitations.map((lim, idx) => (
                    <li key={idx}>{lim}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDisclosureOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Queue with Undo */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto bg-slate-900 text-white p-3.5 rounded-xl shadow-xl flex items-start justify-between gap-3 text-xs border border-slate-700 animate-in fade-in slide-in-from-bottom-2 duration-150"
          >
            <div>
              <div className="font-semibold">{toast.title}</div>
              {toast.description && <div className="text-slate-300 mt-0.5">{toast.description}</div>}
              {toast.undoAction && (
                <button
                  type="button"
                  onClick={() => {
                    toast.undoAction?.();
                    dismissToast(toast.id);
                  }}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300 underline"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{toast.undoLabel || 'Undo'}</span>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="text-slate-400 hover:text-white p-0.5"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
