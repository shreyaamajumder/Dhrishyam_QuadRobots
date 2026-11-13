// src/components/layout/ToastContainer.tsx
import React from 'react';
import { RotateCcw, X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none font-sans"
    >
      {toasts.map((toast) => {
        const icon =
          toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[#627520] dark:text-[#b8bb26] shrink-0 mt-0.5" />
          ) : toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-[#a8231b] dark:text-[#fb4934] shrink-0 mt-0.5" />
          ) : toast.type === 'warning' ? (
            <AlertTriangle className="w-4 h-4 text-[#af3a03] dark:text-[#fe8019] shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 text-[#35656d] dark:text-[#83a598] shrink-0 mt-0.5" />
          );

        return (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto bg-[#282828] text-[#fbf1c7] p-3.5 rounded-2xl shadow-xl flex items-start justify-between gap-3 text-xs border border-[#3c3836] animate-in fade-in slide-in-from-bottom-2 duration-100"
          >
            <div className="flex items-start gap-2.5">
              {icon}
              <div>
                <div className="font-sans font-bold text-xs text-[#fbf1c7]">
                  {toast.title}
                </div>
                {toast.description && (
                  <div className="text-[#ebdbb2] mt-0.5 leading-snug font-sans text-xs">
                    {toast.description}
                  </div>
                )}
                {toast.undoAction && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.undoAction?.();
                      dismissToast(toast.id);
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#8ec07c] hover:underline cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{toast.undoLabel || 'Undo'}</span>
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="text-[#a89984] hover:text-white p-1 rounded-lg cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
