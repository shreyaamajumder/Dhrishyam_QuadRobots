// src/components/shared/Primitives.tsx
import React, { useState, useRef, useEffect } from 'react';
import { diffWords } from 'diff';
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  CheckCircle2,
  Clock,
  FileEdit,
  RotateCcw,
  ShieldCheck,
  Cpu,
  BookOpen,
  ExternalLink,
  X,
  AlertCircle,
  Hash,
} from 'lucide-react';
import {
  ConfidenceLevel,
  ContentStatus,
  FindingLabel,
  FindingSourceType,
  Severity,
} from '../../types/domain';

// 1. StatusBadge (Gruvbox Calibrated)
export const StatusBadge: React.FC<{ status: ContentStatus }> = ({ status }) => {
  const config: Record<
    ContentStatus,
    { label: string; classes: string; dot: string; icon: React.ReactNode }
  > = {
    draft: {
      label: 'Draft',
      classes:
        'bg-[#f0eee9] dark:bg-[#3c3836] text-[#504945] dark:text-[#d6d4ce] border-[#e2e0dc] dark:border-[#504945]',
      dot: 'bg-[#928374]',
      icon: <FileEdit className="w-3 h-3" aria-hidden="true" />,
    },
    checked: {
      label: 'Verified',
      classes:
        'bg-[#689d6a]/15 text-[#427b58] dark:text-[#8ec07c] border-[#689d6a]/30 dark:border-[#8ec07c]/30',
      dot: 'bg-[#689d6a] dark:bg-[#8ec07c]',
      icon: <CheckCircle2 className="w-3 h-3" aria-hidden="true" />,
    },
    in_review: {
      label: 'In Review',
      classes:
        'bg-[#458588]/15 text-[#076678] dark:text-[#83a598] border-[#458588]/30 dark:border-[#83a598]/30',
      dot: 'bg-[#458588] dark:bg-[#83a598] animate-pulse',
      icon: <Clock className="w-3 h-3" aria-hidden="true" />,
    },
    changes_requested: {
      label: 'Revision Required',
      classes:
        'bg-[#d65d0e]/15 text-[#af3a03] dark:text-[#fe8019] border-[#d65d0e]/30 dark:border-[#fe8019]/30',
      dot: 'bg-[#d65d0e] dark:bg-[#fe8019]',
      icon: <RotateCcw className="w-3 h-3" aria-hidden="true" />,
    },
    approved: {
      label: 'Certified',
      classes:
        'bg-[#98971a]/15 text-[#79740e] dark:text-[#b8bb26] border-[#98971a]/30 dark:border-[#b8bb26]/30',
      dot: 'bg-[#98971a] dark:bg-[#b8bb26]',
      icon: <CheckCircle2 className="w-3 h-3" aria-hidden="true" />,
    },
  };

  const current = config[status] || config.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border shadow-2xs transition-colors ${current.classes}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${current.dot}`} />
      <span>{current.label}</span>
    </span>
  );
};

// 2. SeverityTag (Gruvbox Calibrated)
export const SeverityTag: React.FC<{ severity: Severity }> = ({ severity }) => {
  const map: Record<
    Severity,
    { label: string; classes: string; icon: React.ReactNode }
  > = {
    high: {
      label: 'Critical',
      classes:
        'bg-[#cc241d]/15 text-[#9d0006] dark:text-[#fb4934] border-[#cc241d]/30 dark:border-[#fb4934]/30',
      icon: <AlertOctagon className="w-3 h-3 text-[#cc241d] dark:text-[#fb4934] shrink-0" aria-hidden="true" />,
    },
    medium: {
      label: 'Warning',
      classes:
        'bg-[#d65d0e]/15 text-[#af3a03] dark:text-[#fe8019] border-[#d65d0e]/30 dark:border-[#fe8019]/30',
      icon: <AlertTriangle className="w-3 h-3 text-[#d65d0e] dark:text-[#fe8019] shrink-0" aria-hidden="true" />,
    },
    low: {
      label: 'Advisory',
      classes:
        'bg-[#458588]/15 text-[#076678] dark:text-[#83a598] border-[#458588]/30 dark:border-[#83a598]/30',
      icon: <Info className="w-3 h-3 text-[#458588] dark:text-[#83a598] shrink-0" aria-hidden="true" />,
    },
  };

  const current = map[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${current.classes}`}
    >
      {current.icon}
      <span>{current.label}</span>
    </span>
  );
};

// 3. ProvenanceBadge (Gruvbox Calibrated)
export const ProvenanceBadge: React.FC<{
  sourceType: FindingSourceType;
  modelName?: string;
  confidence: ConfidenceLevel;
  label?: FindingLabel;
}> = ({ sourceType, modelName, confidence, label }) => {
  const needsHuman = confidence === 'low' || label === 'needs_human_check';
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 text-[11px]">
      {sourceType === 'rule_engine' ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f0eee9] dark:bg-[#3c3836] text-[#3c3836] dark:text-[#d6d4ce] border border-[#e2e0dc] dark:border-[#504945] font-medium">
          <Cpu className="w-3 h-3 text-[#7c6f64] dark:text-[#a89984]" aria-hidden="true" />
          <span>Deterministic Rule</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#458588]/15 dark:bg-[#83a598]/15 text-[#076678] dark:text-[#83a598] border border-[#458588]/30 dark:border-[#83a598]/30 font-medium">
          <ShieldCheck className="w-3 h-3 text-[#458588] dark:text-[#83a598]" aria-hidden="true" />
          <span>Semantic Grounding ({modelName || 'gemini-2.5-flash'})</span>
          <span className="opacity-80 text-[10px] capitalize">
            · {confidence}
          </span>
        </span>
      )}
      {needsHuman && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#d65d0e]/15 text-[#af3a03] dark:text-[#fe8019] border border-[#d65d0e]/30 dark:border-[#fe8019]/30 font-semibold text-[10px]">
          <AlertCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>Editor Review Required</span>
        </span>
      )}
    </div>
  );
};

// 4. CitationChip with Rule Popover
export const CitationChip: React.FC<{
  code: string;
  title: string;
  body: string;
  version: number;
  entryId: string;
  onOpenLibrary?: (code: string) => void;
}> = ({ code, title, body, version, entryId, onOpenLibrary }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div className="relative inline-block font-mono" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium bg-[#edeae1] dark:bg-[#32302f] text-[#3c3836] dark:text-[#ebdbb2] border border-[#ded9ce] dark:border-[#3c3836] hover:border-[#ded9ce] dark:hover:border-white/20 transition-colors cursor-pointer shadow-2xs"
        title={`View rule ${code} (v${version})`}
      >
        <Hash className="w-3 h-3 text-[#a89984]" aria-hidden="true" />
        <span className="font-bold">{code}</span>
        <span className="text-[10px] text-[#a89984]">v{version}</span>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-40 mt-1.5 w-80 p-4 rounded-xl bg-white dark:bg-[#12141c] text-[#282828] dark:text-[#fbf1c7] shadow-2xl border border-[#ded9ce] dark:border-[#3c3836] text-xs left-0 animate-in fade-in duration-100"
          role="dialog"
          aria-label={`Rule details for ${code}`}
        >
          <div className="flex items-start justify-between gap-2 border-b border-[#edeae1] dark:border-[#3c3836] pb-2 mb-2">
            <div>
              <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider block">
                Rule Citation [{code}] • v{version}
              </span>
              <h4 className="font-bold text-[#282828] dark:text-[#fbf1c7] mt-0.5">{title}</h4>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[#706860] hover:text-[#282828] dark:hover:text-slate-200 p-1"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[#504945] dark:text-[#d5c4a1] text-[11px] leading-relaxed line-clamp-4">
            {body}
          </p>
          {onOpenLibrary && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenLibrary(code);
              }}
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              <span>Inspect in Brand Library</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// 5. High-Contrast Side-by-Side or Inline DiffView
export const DiffView: React.FC<{
  before: string;
  after: string;
  mode?: 'inline' | 'split';
}> = ({ before, after, mode = 'inline' }) => {
  const parts = diffWords(before, after);

  if (mode === 'split') {
    return (
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <div className="p-3 rounded-lg bg-rose-500/5 dark:bg-rose-950/20 border border-rose-500/20 text-rose-950 dark:text-rose-200 leading-relaxed">
          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-1 border-b border-rose-500/20 pb-1">
            Original Text:
          </div>
          <span className="line-through decoration-rose-500/50">{before}</span>
        </div>
        <div className="p-3 rounded-lg bg-emerald-500/5 dark:bg-emerald-950/20 border border-emerald-500/20 text-emerald-950 dark:text-emerald-200 leading-relaxed">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1 border-b border-emerald-500/20 pb-1">
            Suggested Revision:
          </div>
          <span>{after}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg bg-[#edeae1]/60 dark:bg-[#1d2021] border border-[#ded9ce] dark:border-[#3c3836] text-xs font-mono leading-relaxed overflow-x-auto">
      {parts.map((part, index) => {
        if (part.added) {
          return (
            <ins
              key={index}
              className="bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 px-1 py-0.5 rounded no-underline font-semibold"
            >
              {part.value}
            </ins>
          );
        }
        if (part.removed) {
          return (
            <del
              key={index}
              className="bg-rose-500/20 text-rose-800 dark:text-rose-300 px-1 py-0.5 rounded line-through opacity-85"
            >
              {part.value}
            </del>
          );
        }
        return <span key={index} className="text-[#4a4440] dark:text-[#ebdbb2]">{part.value}</span>;
      })}
    </div>
  );
};

// 6. ConfirmDialog (Machine-grade Modal)
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  consequence: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  consequence,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="bg-white dark:bg-[#282828] rounded-2xl max-w-md w-full p-6 shadow-2xl border border-[#e2e0dc] dark:border-[#504945] animate-in zoom-in-95 duration-100">
        <h3 id="confirm-dialog-title" className="font-serif text-lg font-bold text-[#282828] dark:text-[#f5f5f4]">
          {title}
        </h3>
        <p className="mt-2 text-xs text-[#504945] dark:text-[#d6d4ce] leading-relaxed font-sans">
          {consequence}
        </p>

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 text-xs font-semibold text-[#504945] dark:text-[#d6d4ce] hover:bg-[#f0eee9] dark:hover:bg-[#3c3836] rounded-xl transition-colors cursor-pointer tap-interactive"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer active:translate-y-[1px] tap-interactive ${
              confirmVariant === 'danger'
                ? 'bg-[#cc241d] hover:bg-[#9d0006] dark:bg-[#fb4934] dark:hover:bg-[#cc241d] text-white dark:text-[#1d2021]'
                : 'bg-[#282828] dark:bg-[#ebdbb2] text-white dark:text-[#1d2021] hover:bg-[#3c3836] dark:hover:bg-[#f5f5f4]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// 7. InlineAlert (Gruvbox Calibrated)
export const InlineAlert: React.FC<{
  title: string;
  message: string;
  variant?: 'error' | 'warning' | 'info';
  onRetry?: () => void;
}> = ({ title, message, variant = 'error', onRetry }) => {
  const styles = {
    error: 'bg-[#cc241d]/10 border-[#cc241d]/25 text-[#9d0006] dark:text-[#fb4934]',
    warning: 'bg-[#d65d0e]/10 border-[#d65d0e]/25 text-[#af3a03] dark:text-[#fe8019]',
    info: 'bg-[#458588]/10 border-[#458588]/25 text-[#076678] dark:text-[#83a598]',
  }[variant];

  return (
    <div
      role="alert"
      className={`p-4 rounded-xl border flex items-start justify-between gap-3 text-xs leading-relaxed ${styles}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">{title}:</span> {message}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="underline font-semibold shrink-0 hover:opacity-80 cursor-pointer tap-interactive"
        >
          Retry
        </button>
      )}
    </div>
  );
};

// 8. EmptyState (Gruvbox Calibrated)
export const EmptyState: React.FC<{
  icon: React.ReactNode;
  explanation: string;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}> = ({
  icon,
  explanation,
  action,
  secondaryAction,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}) => {
  const primary = action || (actionLabel && onAction ? { label: actionLabel, onClick: onAction } : undefined);
  const secondary = secondaryAction || (secondaryActionLabel && onSecondaryAction ? { label: secondaryActionLabel, onClick: onSecondaryAction } : undefined);

  return (
    <div className="text-center py-14 px-4 bg-[#f0eee9]/60 dark:bg-[#32302f]/40 rounded-2xl border border-dashed border-[#e2e0dc] dark:border-[#504945] flex flex-col items-center justify-center">
      <div className="w-10 h-10 rounded-xl bg-[#f0eee9] dark:bg-[#3c3836] text-[#7c6f64] dark:text-[#a89984] flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="text-xs text-[#7c6f64] dark:text-[#a89984] max-w-sm mb-4 leading-relaxed font-medium">
        {explanation}
      </p>
      <div className="flex items-center gap-2">
        {primary && (
          <button
            type="button"
            onClick={primary.onClick}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#282828] dark:bg-[#ebdbb2] dark:text-[#1d2021] hover:bg-[#3c3836] dark:hover:bg-[#f5f5f4] transition-all cursor-pointer shadow-xs tap-interactive"
          >
            {primary.label}
          </button>
        )}
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#504945] dark:text-[#d6d4ce] bg-[#f0eee9] dark:bg-[#3c3836] border border-[#e2e0dc] dark:border-[#504945] hover:border-[#d6d4ce] transition-all cursor-pointer tap-interactive"
          >
            {secondary.label}
          </button>
        )}
      </div>
    </div>
  );
};

// 9. Skeleton (Gruvbox Calibrated)
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`animate-pulse bg-[#f0eee9] dark:bg-[#3c3836]/80 rounded-xl ${className}`}
    aria-hidden="true"
  />
);
