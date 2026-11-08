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
  Sparkles,
  Cpu,
  BookOpen,
  ExternalLink,
  X,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  ConfidenceLevel,
  ContentStatus,
  FindingLabel,
  FindingSourceType,
  Severity,
} from '../../types/domain';

// 1. StatusBadge (Icon + Text label, never color alone)
export const StatusBadge: React.FC<{ status: ContentStatus }> = ({ status }) => {
  const config: Record<
    ContentStatus,
    { label: string; classes: string; icon: React.ReactNode }
  > = {
    draft: {
      label: 'Draft',
      classes: 'bg-slate-100 text-slate-700 border-slate-300',
      icon: <FileEdit className="w-3.5 h-3.5" aria-hidden="true" />,
    },
    checked: {
      label: 'Checked',
      classes: 'bg-sky-50 text-sky-800 border-sky-300',
      icon: <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />,
    },
    in_review: {
      label: 'In review',
      classes: 'bg-indigo-50 text-indigo-800 border-indigo-300',
      icon: <Clock className="w-3.5 h-3.5" aria-hidden="true" />,
    },
    changes_requested: {
      label: 'Changes requested',
      classes: 'bg-amber-50 text-amber-900 border-amber-300',
      icon: <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />,
    },
    approved: {
      label: 'Approved',
      classes: 'bg-emerald-50 text-emerald-800 border-emerald-300',
      icon: <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />,
    },
  };

  const current = config[status] || config.draft;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${current.classes}`}
    >
      {current.icon}
      <span>{current.label}</span>
    </span>
  );
};

// 2. SeverityTag (Icon + Label + Colour — never colour alone)
export const SeverityTag: React.FC<{ severity: Severity }> = ({ severity }) => {
  const map: Record<
    Severity,
    { label: string; classes: string; icon: React.ReactNode }
  > = {
    high: {
      label: 'High',
      classes: 'bg-rose-50 text-rose-800 border-rose-300',
      icon: <AlertOctagon className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />,
    },
    medium: {
      label: 'Medium',
      classes: 'bg-amber-50 text-amber-900 border-amber-300',
      icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />,
    },
    low: {
      label: 'Low',
      classes: 'bg-sky-50 text-sky-900 border-sky-300',
      icon: <Info className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />,
    },
  };
  const item = map[severity] || map.low;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${item.classes}`}
    >
      {item.icon}
      <span>{item.label}</span>
    </span>
  );
};

// 3. ProvenanceBadge
export const ProvenanceBadge: React.FC<{
  sourceType: FindingSourceType;
  modelName?: string;
  confidence: ConfidenceLevel;
  label?: FindingLabel;
}> = ({ sourceType, modelName, confidence, label }) => {
  const needsHuman = confidence === 'low' || label === 'needs_human_check';
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      {sourceType === 'rule_engine' ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
          <Cpu className="w-3 h-3 text-slate-500" aria-hidden="true" />
          <span>Rule engine</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-800 border border-purple-200">
          <Sparkles className="w-3 h-3 text-purple-600" aria-hidden="true" />
          <span>AI · {modelName || 'gemini-2.5-flash'}</span>
          <span className="text-purple-600">({confidence} confidence)</span>
        </span>
      )}
      {needsHuman && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
          Needs human check
        </span>
      )}
      {label === 'unsupported_claim' && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
          Needs evidence or an approved fact
        </span>
      )}
      {label === 'guideline_conflict' && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-orange-50 text-orange-900 border border-orange-300">
          Guideline conflict
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
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100 transition-colors"
        title={`View rule ${code} (v${version})`}
      >
        <BookOpen className="w-3 h-3 text-indigo-600" aria-hidden="true" />
        <span>{code}</span>
        <span className="text-[10px] text-indigo-600 font-semibold">v{version}</span>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-40 left-0 mt-1.5 w-80 p-3.5 bg-white rounded-lg shadow-xl border border-slate-200 text-left"
          role="dialog"
          aria-label={`Rule details for ${code}`}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div>
              <span className="font-mono text-xs font-bold text-indigo-700">{code}</span>
              <span className="ml-2 text-xs text-slate-500">Version {version}</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600 p-0.5"
              aria-label="Close rule popover"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <h4 className="text-xs font-semibold text-slate-900 mb-1">{title}</h4>
          <p className="text-xs text-slate-600 leading-relaxed mb-2.5">{body}</p>
          {onOpenLibrary ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenLibrary(code);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              <span>View in Brand Library</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          ) : (
            <a
              href={`#library`}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              <span>View in Brand Library</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
};

// 5. DiffView (Inline before/after for suggestions; Side-by-side for versions)
export const DiffView: React.FC<{
  before: string;
  after: string;
  mode?: 'inline' | 'side-by-side';
}> = ({ before, after, mode = 'inline' }) => {
  const parts = diffWords(before, after);

  if (mode === 'side-by-side') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
        <div className="p-3 rounded-lg bg-rose-50/40 border border-rose-200">
          <div className="text-[11px] font-sans font-semibold text-rose-800 uppercase tracking-wider mb-1.5">
            Previous Version
          </div>
          <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
            {parts.map((part, idx) =>
              part.added ? null : (
                <span
                  key={idx}
                  className={
                    part.removed
                      ? 'bg-rose-200/80 text-rose-950 line-through px-0.5 rounded'
                      : ''
                  }
                >
                  {part.value}
                </span>
              )
            )}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-emerald-50/40 border border-emerald-200">
          <div className="text-[11px] font-sans font-semibold text-emerald-800 uppercase tracking-wider mb-1.5">
            Compared Version
          </div>
          <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
            {parts.map((part, idx) =>
              part.removed ? null : (
                <span
                  key={idx}
                  className={
                    part.added
                      ? 'bg-emerald-200/80 text-emerald-950 font-medium px-0.5 rounded'
                      : ''
                  }
                >
                  {part.value}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 text-xs leading-relaxed">
      {parts.map((part, i) => {
        if (part.removed) {
          return (
            <del
              key={i}
              className="bg-rose-100 text-rose-900 line-through px-1 py-0.5 rounded mr-0.5"
            >
              {part.value}
            </del>
          );
        }
        if (part.added) {
          return (
            <ins
              key={i}
              className="bg-emerald-100 text-emerald-900 no-underline font-medium px-1 py-0.5 rounded mr-0.5"
            >
              {part.value}
            </ins>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </div>
  );
};

// 6. ConfirmDialog
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200">
        <h3 id="confirm-dialog-title" className="text-base font-semibold text-slate-900 mb-2">
          {title}
        </h3>
        <p className="text-sm text-slate-600 mb-6 leading-relaxed">{consequence}</p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
              confirmVariant === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// 7. InlineAlert (persists until resolved; includes optional details expander and retry)
export const InlineAlert: React.FC<{
  title: string;
  message: string;
  requestId?: string;
  variant?: 'error' | 'warning' | 'info';
  onRetry?: () => void;
}> = ({ title, message, requestId, variant = 'error', onRetry }) => {
  const [showDetails, setShowDetails] = useState(false);
  const styles = {
    error: 'bg-rose-50 border-rose-300 text-rose-900',
    warning: 'bg-amber-50 border-amber-300 text-amber-900',
    info: 'bg-sky-50 border-sky-300 text-sky-900',
  }[variant];

  return (
    <div className={`p-4 rounded-lg border ${styles}`} role="alert">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h4 className="text-sm font-semibold">{title}</h4>
            <p className="text-xs mt-0.5 leading-relaxed">{message}</p>
            {requestId && (
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() => setShowDetails((s) => !s)}
                  className="text-xs underline font-medium cursor-pointer"
                >
                  {showDetails ? 'Hide details' : 'Details'}
                </button>
                {showDetails && (
                  <p className="mt-1 font-mono text-[11px] opacity-80 select-all">
                    Request ID: {requestId}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-white border border-current hover:opacity-90 shrink-0 cursor-pointer transition-opacity"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
};

// 8. EmptyState
export const EmptyState: React.FC<{
  icon: React.ReactNode;
  explanation: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}> = ({
  icon,
  explanation,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}) => (
  <div className="flex flex-col items-center justify-center text-center py-12 px-4 bg-white rounded-xl border border-dashed border-slate-300">
    <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center mb-3">
      {icon}
    </div>
    <p className="text-sm text-slate-600 max-w-md mb-5 leading-relaxed">{explanation}</p>
    <div className="flex items-center gap-3">
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-xs"
        >
          {actionLabel}
        </button>
      )}
      {secondaryActionLabel && onSecondaryAction && (
        <button
          type="button"
          onClick={onSecondaryAction}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors"
        >
          {secondaryActionLabel}
        </button>
      )}
    </div>
  </div>
);

// 9. Skeleton
export const Skeleton: React.FC<{ className?: string }> = ({ className = 'h-4 w-full' }) => (
  <div className={`animate-pulse bg-slate-200 rounded ${className}`} aria-hidden="true" />
);
