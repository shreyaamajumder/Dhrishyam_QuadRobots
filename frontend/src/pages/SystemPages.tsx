// src/pages/SystemPages.tsx
import React from 'react';
import { ShieldAlert, Compass, ArrowLeft, Home } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const ForbiddenPage: React.FC = () => {
  const { navigate, user } = useApp();
  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full bg-white/95 dark:bg-[#32302f]/95 backdrop-blur-md rounded-3xl p-8 border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm flex flex-col items-center text-center">
        <div className="relative mb-5">
          <div className="w-14 h-14 rounded-2xl bg-[#cc241d]/15 text-[#cc241d] dark:text-[#fb4934] flex items-center justify-center border border-[#cc241d]/30">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#cc241d] border-2 border-white dark:border-[#32302f]" />
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-serif font-bold uppercase tracking-wider bg-[#cc241d]/15 text-[#cc241d] dark:text-[#fb4934] border border-[#cc241d]/30 mb-2">
          Access Restricted · 403
        </div>

        <h2 className="text-2xl font-serif font-bold text-[#282828] dark:text-[#f5f5f4] tracking-tight">
          Editorial Clearance Required
        </h2>

        <p className="text-xs sm:text-sm text-[#7c6f64] dark:text-[#a89984] mt-2 mb-6 leading-relaxed max-w-xs font-serif">
          Your current role <span className="font-semibold capitalize text-[#282828] dark:text-[#ebdbb2]">({user?.role || 'Guest'})</span> does not have permissions to access this editorial partition.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full">
          <button
            type="button"
            onClick={() => navigate(user?.role === 'reviewer' ? 'review-queue' : 'my-content')}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-serif font-semibold text-white dark:text-[#1d2021] bg-[#282828] dark:bg-[#ebdbb2] hover:bg-[#3c3836] dark:hover:bg-[#f5f5f4] transition-all cursor-pointer shadow-sm"
          >
            <ArrowLeft className="w-4 h-4 text-[#458588] dark:text-[#83a598]" />
            <span>Return to Workspace</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const NotFoundPage: React.FC = () => {
  const { navigate } = useApp();
  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full bg-white/95 dark:bg-[#32302f]/95 backdrop-blur-md rounded-3xl p-8 border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm flex flex-col items-center text-center">
        <div className="relative mb-5">
          <div className="w-14 h-14 rounded-2xl bg-[#458588]/15 text-[#458588] dark:text-[#83a598] flex items-center justify-center border border-[#458588]/30">
            <Compass className="w-7 h-7" />
          </div>
          <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#458588] border-2 border-white dark:border-[#32302f]" />
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-serif font-bold uppercase tracking-wider bg-[#458588]/15 text-[#458588] dark:text-[#83a598] border border-[#458588]/30 mb-2">
          Page Not Found · 404
        </div>

        <h2 className="text-2xl font-serif font-bold text-[#282828] dark:text-[#f5f5f4] tracking-tight">
          Document or Page Not Found
        </h2>

        <p className="text-xs sm:text-sm text-[#7c6f64] dark:text-[#a89984] mt-2 mb-6 leading-relaxed max-w-xs font-serif">
          The requested document draft, version, or destination cannot be found in this workspace ledger.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full">
          <button
            type="button"
            onClick={() => navigate('my-content')}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-serif font-semibold text-white dark:text-[#1d2021] bg-[#282828] dark:bg-[#ebdbb2] hover:bg-[#3c3836] dark:hover:bg-[#f5f5f4] transition-all cursor-pointer shadow-sm"
          >
            <Home className="w-4 h-4 text-[#458588] dark:text-[#83a598]" />
            <span>Return to Content Ledger</span>
          </button>
        </div>
      </div>
    </div>
  );
};
