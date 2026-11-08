// src/pages/SystemPages.tsx
import React from 'react';
import { ShieldAlert, Compass, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const ForbiddenPage: React.FC = () => {
  const { navigate, user } = useApp();
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
        <ShieldAlert className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-bold text-slate-900 tracking-tight">Access Restricted (403)</h2>
      <p className="text-xs text-slate-600 max-w-sm mt-1 mb-6 leading-relaxed">
        You don&apos;t have permissions to access this screen with your current role ({user?.role.toUpperCase()}).
      </p>
      <button
        type="button"
        onClick={() => navigate(user?.role === 'reviewer' ? 'review-queue' : 'my-content')}
        className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700"
      >
        Return to My Workspace
      </button>
    </div>
  );
};

export const NotFoundPage: React.FC = () => {
  const { navigate } = useApp();
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
        <Compass className="w-8 h-8" />
      </div>
      <h2 className="text-xl font-bold text-slate-900 tracking-tight">Page Not Found (404)</h2>
      <p className="text-xs text-slate-600 max-w-sm mt-1 mb-6 leading-relaxed">
        We can&apos;t find the resource or screen you requested. It may have been moved or removed.
      </p>
      <button
        type="button"
        onClick={() => navigate('my-content')}
        className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700"
      >
        Go to Home
      </button>
    </div>
  );
};
