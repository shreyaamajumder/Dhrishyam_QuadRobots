// src/components/layout/TenantSwitcher.tsx
import React, { useState, useRef, useEffect } from 'react';
import { ChevronsUpDown, Check, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const TenantSwitcher: React.FC = () => {
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

  // Use availableTenants from context or default to active organization
  const tenants = availableTenants && availableTenants.length > 0
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
    <div className="relative p-2.5 border-t border-slate-200 bg-slate-50/80" ref={dropdownRef}>
      {/* Upward-Opening Popover Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label="Accessible brand workspaces"
          className="absolute bottom-full mb-2 left-2.5 right-2.5 bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
            <span>Workspaces</span>
            <span className="text-[9px] font-normal lowercase">({tenants.length} available)</span>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5 py-1">
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
                  className={`w-full flex items-center justify-between p-2 rounded-lg text-xs transition-colors cursor-pointer text-left ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-900 font-semibold'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {tName.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="truncate">
                      <div className="truncate leading-tight">{tName}</div>
                      <span className="text-[10px] font-normal text-slate-500 capitalize">
                        {t.role}
                      </span>
                    </div>
                  </div>
                  {isActive && <Check className="w-4 h-4 text-indigo-600 shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>

          {/* Action: Register another brand */}
          <div className="pt-1.5 mt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={handleRegisterAnotherBrand}
              className="w-full flex items-center gap-2 p-2 rounded-lg text-xs font-semibold text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800 transition-colors cursor-pointer text-left"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>Register another brand...</span>
            </button>
          </div>
        </div>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Switch organization workspace"
        className="w-full flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 transition-all text-left shadow-xs cursor-pointer group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold flex items-center justify-center text-xs shadow-xs shrink-0 group-hover:bg-indigo-700 transition-colors">
            {activeTenantName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {activeTenantName}
            </div>
            <div className="text-[10px] text-slate-500 truncate flex items-center gap-1.5 mt-0.5">
              <span className="truncate">{user.display_name}</span>
              <span>•</span>
              <span className="capitalize font-medium text-indigo-600 shrink-0">{user.role}</span>
            </div>
          </div>
        </div>
        <ChevronsUpDown className="w-4 h-4 text-slate-400 group-hover:text-slate-600 shrink-0 ml-1" />
      </button>
    </div>
  );
};
