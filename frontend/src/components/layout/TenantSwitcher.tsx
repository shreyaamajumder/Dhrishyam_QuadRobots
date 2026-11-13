// src/components/layout/TenantSwitcher.tsx
import React, { useState, useRef, useEffect } from 'react';
import { ChevronsUpDown, Check, Plus, Building2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface TenantSwitcherProps {
  collapsed?: boolean;
}

export const TenantSwitcher: React.FC<TenantSwitcherProps> = ({ collapsed = false }) => {
  const { user, availableTenants, switchTenant, navigate } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!user) return null;

  const tenants =
    availableTenants && availableTenants.length > 0
      ? availableTenants
      : [{ id: user.org_id, org_id: user.org_id, name: user.org_name, org_name: user.org_name, role: user.role }];

  const activeTenantName = user.org_name || 'Active Workspace';

  const handleSelectTenant = (orgId: string) => {
    setIsOpen(false);
    if (orgId !== user.org_id && switchTenant) {
      switchTenant(orgId);
    }
  };

  const handleRegisterAnotherBrand = () => {
    setIsOpen(false);
    navigate('register');
  };

  return (
    <div
      className={`relative border-t border-[#e2e0dc] dark:border-[#3c3836] bg-transparent transition-all ${
        collapsed ? 'p-2 flex justify-center' : 'p-2.5'
      }`}
      ref={dropdownRef}
    >
      {/* Upward-Opening Popover Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label="Accessible brand workspaces"
          className={`absolute bottom-full mb-2 bg-white dark:bg-[#32302f] rounded-xl shadow-xl border border-[#e2e0dc] dark:border-[#504945] p-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-100 ${
            collapsed ? 'left-2 w-64' : 'left-2.5 right-2.5'
          }`}
        >
          <div className="px-2.5 py-1.5 text-xs font-medium text-[#7c6f64] dark:text-[#a89984] flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-[#689d6a] dark:text-[#8ec07c]" />
              <span>Switch Workspace</span>
            </span>
            <span className="text-[11px] font-sans">{tenants.length} available</span>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-1 py-1">
            {tenants.map((t) => {
              const tId = t.id || t.org_id || '';
              const tName = t.name || t.org_name || 'Workspace';
              const isActive = tId === user.org_id;
              return (
                <button
                  key={tId}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => handleSelectTenant(tId)}
                  className={`w-full flex items-center justify-between p-2 rounded-lg text-xs transition-all cursor-pointer text-left ${
                    isActive
                      ? 'bg-[#f0eee9] dark:bg-[#3c3836] text-[#282828] dark:text-[#f5f5f4] font-semibold border border-[#e2e0dc] dark:border-[#504945]'
                      : 'text-[#504945] dark:text-[#d6d4ce] hover:bg-[#f0eee9]/80 dark:hover:bg-[#3c3836]/60 hover:text-[#282828] dark:hover:text-[#f5f5f4]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        isActive
                          ? 'bg-[#282828] dark:bg-[#f5f5f4] text-[#f5f5f4] dark:text-[#282828]'
                          : 'bg-[#e7e5e0] dark:bg-[#504945] text-[#3c3836] dark:text-[#ebdbb2]'
                      }`}
                    >
                      {tName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="truncate">
                      <p className="font-medium truncate">{tName}</p>
                      <p className="text-[10px] text-[#7c6f64] dark:text-[#a89984] capitalize">{t.role || 'Member'}</p>
                    </div>
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 text-[#689d6a] dark:text-[#8ec07c] shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>

          <div className="pt-1.5 mt-1.5 border-t border-[#e2e0dc] dark:border-[#504945]">
            <button
              type="button"
              onClick={handleRegisterAnotherBrand}
              className="w-full flex items-center gap-2 p-2 rounded-lg text-xs font-semibold text-[#504945] dark:text-[#d6d4ce] hover:bg-[#f0eee9] dark:hover:bg-[#3c3836] transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#689d6a] dark:text-[#8ec07c]" />
              <span>Register New Brand</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Switcher Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        title={`Active Organization: ${activeTenantName} (${user.role})`}
        className={
          collapsed
            ? 'w-10 h-10 rounded-xl bg-[#f0eee9] dark:bg-[#3c3836] text-[#282828] dark:text-[#f5f5f4] flex items-center justify-center text-xs font-bold shadow-2xs hover:scale-105 active:scale-95 transition-all cursor-pointer border border-[#e2e0dc] dark:border-[#504945]'
            : 'w-full flex items-center justify-between p-2 rounded-xl bg-white dark:bg-[#32302f] border border-[#e2e0dc] dark:border-[#3c3836] hover:border-[#d6d4ce] dark:hover:border-[#504945] transition-all cursor-pointer text-left shadow-2xs active:translate-y-[1px]'
        }
      >
        {collapsed ? (
          activeTenantName.slice(0, 2).toUpperCase()
        ) : (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-[#282828] dark:bg-[#e7e5e0] text-[#f5f5f4] dark:text-[#282828] flex items-center justify-center text-[10px] font-bold shrink-0">
                {activeTenantName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 truncate">
                <p className="text-xs font-semibold text-[#282828] dark:text-[#f5f5f4] truncate leading-tight">
                  {activeTenantName}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#689d6a] dark:bg-[#8ec07c]" />
                  <span className="text-[11px] text-[#7c6f64] dark:text-[#a89984] capitalize leading-tight">
                    {user.role}
                  </span>
                </div>
              </div>
            </div>
            <ChevronsUpDown className="w-3.5 h-3.5 text-[#7c6f64] dark:text-[#a89984] shrink-0 ml-1.5" />
          </>
        )}
      </button>
    </div>
  );
};
