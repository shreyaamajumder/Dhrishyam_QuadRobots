// src/components/workspace/FindingCard.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Check,
  Edit3,
  XCircle,
  ShieldCheck,
  History,
  RotateCcw,
} from 'lucide-react';
import { Finding, FindingDecisionAction, Role } from '../../types/domain';
import {
  CitationChip,
  DiffView,
  ProvenanceBadge,
  SeverityTag,
} from '../shared/Primitives';

interface FindingCardProps {
  finding: Finding;
  isSelected: boolean;
  onSelect: () => void;
  userRole: Role;
  canCreatorDecide: boolean;
  canReviewerOverride: boolean;
  onDecision: (
    findingId: string,
    action: FindingDecisionAction,
    reason?: string,
    editedText?: string
  ) => Promise<void>;
  onRerunCheck: () => void;
  onOpenLibrary?: (code: string) => void;
}

export const FindingCard: React.FC<FindingCardProps> = ({
  finding,
  isSelected,
  onSelect,
  userRole,
  canCreatorDecide,
  canReviewerOverride,
  onDecision,
  onRerunCheck,
  onOpenLibrary,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(isSelected);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedText, setEditedText] = useState<string>(finding.suggestion_text);
  const [isDismissing, setIsDismissing] = useState<boolean>(false);
  const [dismissReason, setDismissReason] = useState<string>('');
  const [isOverriding, setIsOverriding] = useState<boolean>(false);
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);

  // Sync expanded state with selection
  useEffect(() => {
    if (isSelected) {
      setIsExpanded(true);
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);

  const latestDecision = finding.decisions[finding.decisions.length - 1];

  const handleAccept = async () => {
    setIsSubmitting(true);
    setValidationError(null);
    try {
      await onDecision(finding.id, 'accepted');
    } catch (err: unknown) {
      setValidationError(err instanceof Error ? err.message : 'Failed to apply suggestion');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editedText.trim()) {
      setValidationError('Replacement text cannot be empty');
      return;
    }
    setIsSubmitting(true);
    setValidationError(null);
    try {
      await onDecision(finding.id, 'edited', undefined, editedText.trim());
      setIsEditing(false);
    } catch (err: unknown) {
      setValidationError(err instanceof Error ? err.message : 'Failed to save edit');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDismiss = async () => {
    if (finding.severity === 'high' && !dismissReason.trim()) {
      setValidationError('A dismissal reason is mandatory for High severity findings.');
      return;
    }
    setIsSubmitting(true);
    setValidationError(null);
    try {
      await onDecision(finding.id, 'dismissed', dismissReason.trim());
      setIsDismissing(false);
    } catch (err: unknown) {
      setValidationError(err instanceof Error ? err.message : 'Failed to dismiss');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveOverride = async () => {
    setIsSubmitting(true);
    setValidationError(null);
    try {
      await onDecision(finding.id, 'overridden', overrideReason.trim());
      setIsOverriding(false);
    } catch (err: unknown) {
      setValidationError(err instanceof Error ? err.message : 'Failed to override');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDecision = async () => {
    setIsSubmitting(true);
    setValidationError(null);
    try {
      await onDecision(finding.id, 'confirmed');
    } catch (err: unknown) {
      setValidationError(err instanceof Error ? err.message : 'Failed to confirm');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      ref={cardRef}
      id={`finding-card-${finding.id}`}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isExpanded) {
          setIsExpanded(true);
        }
      }}
      className={`rounded-xl border transition-all duration-200 backdrop-blur-md overflow-hidden ${
        isSelected
          ? 'border-[#36755a] dark:border-[#8ec07c] bg-white dark:bg-[#282828] ring-2 ring-[#36755a]/25 dark:ring-[#8ec07c]/30 shadow-lg -translate-y-0.5'
          : 'border-[#e2ded5] dark:border-[#3c3836] bg-white dark:bg-[#282828] hover:border-[#b8b2a2] dark:hover:border-[#504945] hover:-translate-y-0.5 hover:shadow-md shadow-2xs'
      } ${finding.is_stale ? 'opacity-50 bg-[#edeae1]/60 dark:bg-[#1d2021]' : ''}`}
    >
      {/* Card Header (always visible) */}
      <div className="p-3.5 cursor-pointer">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityTag severity={finding.severity} />
            <span className="text-[10px] font-mono font-bold text-[#706860] dark:text-[#a89984] uppercase tracking-wider">
              {finding.category.replace('_', ' ')}
            </span>
            {latestDecision && (
              <span
                className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                  latestDecision.action === 'accepted'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
                    : latestDecision.action === 'edited'
                    ? 'bg-sky-500/10 text-[#36755a] dark:text-[#8ec07c] border-sky-500/20'
                    : latestDecision.action === 'dismissed'
                    ? 'bg-[#edeae1] dark:bg-[#32302f] text-[#706860] line-through border-[#ded9ce] dark:border-[#3c3836]'
                    : latestDecision.action === 'overridden'
                    ? 'bg-[#d65d0e]/10 text-[#af3a03] dark:text-[#fe8019] border-[#d65d0e]/25'
                    : 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20'
                }`}
              >
                {latestDecision.action}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((v) => !v);
            }}
            className="text-[#706860] hover:text-[#282828] dark:hover:text-slate-200 p-1 rounded-lg hover:bg-[#edeae1] dark:hover:bg-[#32302f] cursor-pointer"
            aria-label={isExpanded ? 'Collapse finding' : 'Expand finding'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Snippet & One-line reason */}
        <div className="text-xs font-serif font-bold text-[#282828] dark:text-[#fbf1c7] line-clamp-1 mb-1">
          &ldquo;{finding.span_text}&rdquo;
        </div>
        <div className="text-xs text-[#504945] dark:text-[#d5c4a1] line-clamp-2 leading-relaxed">
          {finding.explanation}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-[#edeae1] dark:border-[#3c3836] space-y-3.5 text-xs text-[#4a4440] dark:text-[#ebdbb2]">
          {/* Stale Finding Warning */}
          {finding.is_stale && (
            <div className="p-3 rounded-xl bg-[#d65d0e]/10 dark:bg-[#fe8019]/15 border border-[#d65d0e]/30 dark:border-[#fe8019]/30 text-[#af3a03] dark:text-[#fe8019] flex items-center justify-between gap-2 shadow-2xs">
              <span className="font-medium">This suggestion no longer matches the edited text.</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRerunCheck();
                }}
                className="px-3 py-1 text-xs font-bold bg-white dark:bg-[#282828] border border-[#d65d0e]/40 dark:border-[#fe8019]/40 text-[#af3a03] dark:text-[#fe8019] rounded-lg hover:bg-[#d65d0e]/15 dark:hover:bg-[#fe8019]/20 shrink-0 cursor-pointer"
              >
                Re-run check
              </button>
            </div>
          )}

          {/* Provenance & Citations */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <ProvenanceBadge
              sourceType={finding.source_type}
              modelName={finding.model_name}
              confidence={finding.confidence}
              label={finding.label}
            />
            <CitationChip
              code={finding.entry_code}
              title={finding.entry_title}
              body={finding.entry_body}
              version={finding.entry_version}
              entryId={finding.entry_id}
              onOpenLibrary={onOpenLibrary}
            />
            {finding.secondary_entry_code && (
              <CitationChip
                code={finding.secondary_entry_code}
                title={finding.secondary_entry_title || ''}
                body={finding.secondary_entry_body || ''}
                version={1}
                entryId={finding.secondary_entry_id || ''}
                onOpenLibrary={onOpenLibrary}
              />
            )}
          </div>

          {/* Full Explanation */}
          <div className="bg-[#edeae1]/60 dark:bg-[#1d2021] p-3.5 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] leading-relaxed text-[#4a4440] dark:text-[#ebdbb2]">
            <span className="font-bold text-[#282828] dark:text-[#fbf1c7] block mb-1 font-mono text-[11px] uppercase tracking-wider text-[#36755a] dark:text-[#8ec07c]">Policy Basis:</span>
            <div className="font-serif text-[13px] leading-relaxed text-[#3c3836] dark:text-[#ebdbb2]">{finding.explanation}</div>
          </div>

          {/* Suggestion Diff or Inline Edit */}
          {isEditing ? (
            <div className="space-y-2.5 bg-[#edeae1]/60 dark:bg-[#1d2021] p-3 rounded-lg border border-[#ded9ce] dark:border-[#3c3836] shadow-2xs font-mono">
              <label className="block text-xs font-bold text-[#282828] dark:text-[#fbf1c7] uppercase">
                Edit replacement text:
              </label>
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={2}
                className="w-full text-xs font-mono p-2 rounded-lg border border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-black/50 text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a]"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-2.5 py-1 text-xs font-semibold rounded border border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-white/[0.04] text-[#4a4440] dark:text-[#ebdbb2] hover:bg-[#edeae1]/60 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSaveEdit}
                  className="px-3 py-1 text-xs font-bold rounded bg-[#282828] dark:bg-[#edeae1] text-white dark:text-[#282828] hover:bg-black disabled:opacity-50 cursor-pointer shadow-xs active:translate-y-[1px]"
                >
                  Save & Apply
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[10px] font-mono font-bold text-[#a89984] uppercase tracking-wider mb-1">
                Suggested Replacement:
              </div>
              <DiffView before={finding.span_text} after={finding.suggestion_text} mode="inline" />
            </div>
          )}

          {/* Dismissal Reason Form */}
          {isDismissing && (
            <div className="space-y-2.5 bg-[#edeae1]/60 dark:bg-[#1d2021] p-3 rounded-lg border border-[#ded9ce] dark:border-[#3c3836] shadow-2xs font-mono">
              <label className="block text-xs font-bold text-[#282828] dark:text-[#fbf1c7] uppercase">
                Dismissal reason {finding.severity === 'high' ? '(Mandatory for High severity)' : '(Optional)'}:
              </label>
              <input
                type="text"
                placeholder="e.g. Quoting an external benchmark or partner announcement"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                className="w-full text-xs font-mono p-2 rounded-lg border border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-black/50 text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a]"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsDismissing(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-[#32302f] text-[#4a4440] dark:text-[#ebdbb2] hover:bg-[#edeae1]/60 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSaveDismiss}
                  className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-[#282828] dark:bg-[#edeae1] text-white dark:text-[#282828] hover:bg-[#32302f] dark:hover:bg-[#edeae1] disabled:opacity-50 cursor-pointer shadow-xs active:scale-95"
                >
                  Confirm Dismissal
                </button>
              </div>
            </div>
          )}

          {/* Override Reason Form (Reviewer) */}
          {isOverriding && (
            <div className="space-y-2.5 bg-[#d65d0e]/10 dark:bg-[#fe8019]/10 p-3.5 rounded-xl border border-[#d65d0e]/25 dark:border-[#fe8019]/25 shadow-2xs">
              <label className="block text-xs font-bold text-[#af3a03] dark:text-[#fe8019]">
                Reviewer Override Reason:
              </label>
              <input
                type="text"
                placeholder="e.g. Accepted exception for verified customer quote"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-[#d65d0e]/30 dark:border-[#fe8019]/30 bg-white dark:bg-[#282828] text-[#282828] dark:text-[#f5f5f4] focus:ring-2 focus:ring-[#d65d0e] focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOverriding(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#e2e0dc] dark:border-[#504945] bg-white dark:bg-[#32302f] text-[#504945] dark:text-[#d6d4ce] hover:bg-[#f0eee9] dark:hover:bg-[#3c3836] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSaveOverride}
                  className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-[#d65d0e] hover:bg-[#af3a03] text-white disabled:opacity-50 cursor-pointer shadow-xs active:scale-95"
                >
                  Save Override
                </button>
              </div>
            </div>
          )}

          {/* Validation error feedback */}
          {validationError && (
            <div className="text-xs text-rose-600 dark:text-rose-400 font-semibold p-2.5 bg-rose-50 dark:bg-rose-950/50 rounded-xl border border-rose-200 dark:border-rose-900/60">
              {validationError}
            </div>
          )}

          {/* Actions toolbar */}
          {!finding.is_stale && !isEditing && !isDismissing && !isOverriding && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#edeae1] dark:border-[#3c3836]">
              {/* Creator Actions */}
              {canCreatorDecide && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleAccept}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white transition-all shadow-xs cursor-pointer active:scale-95"
                    title="Apply suggestion directly to draft"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Accept</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      setIsEditing(true);
                      setEditedText(finding.suggestion_text);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-[#32302f] text-[#4a4440] dark:text-slate-200 border border-[#ded9ce] dark:border-[#3c3836] hover:bg-[#edeae1]/60 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setIsDismissing(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#706860] dark:text-[#a89984] hover:text-[#282828] dark:hover:text-white hover:bg-[#edeae1] dark:hover:bg-[#32302f] transition-colors cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Dismiss</span>
                  </button>
                </div>
              )}

              {/* Reviewer Actions */}
              {canReviewerOverride && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleConfirmDecision}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-[#282828] dark:bg-[#edeae1] text-white dark:text-[#282828] hover:bg-[#32302f] dark:hover:bg-[#edeae1] transition-all cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                    <span>Confirm</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setIsOverriding(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium bg-transparent text-[#d65d0e] dark:text-[#fe8019] border border-[#d65d0e]/30 hover:bg-[#d65d0e]/10 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Override</span>
                  </button>
                </div>
              )}

              {/* Decision history toggle */}
              {finding.decisions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory((h) => !h)}
                  className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-[#706860] dark:text-[#a89984] hover:text-[#3c3836] dark:hover:text-slate-200 ml-auto cursor-pointer"
                >
                  <History className="w-3 h-3" />
                  <span>{finding.decisions.length} RECORD{finding.decisions.length > 1 ? 'S' : ''}</span>
                </button>
              )}
            </div>
          )}

          {/* Decision history view */}
          {showHistory && (
            <div className="mt-2.5 p-3 bg-[#edeae1]/60 dark:bg-[#08090d] rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] font-mono space-y-2">
              <div className="text-[10px] uppercase font-bold tracking-wider text-[#706860] dark:text-[#a89984]">FINDING LEDGER TRAIL:</div>
              {finding.decisions.map((dec) => (
                <div key={dec.id} className="flex items-start justify-between gap-2 border-b border-slate-200/60 dark:border-slate-800/80 pb-1.5 last:border-0 last:pb-0">
                  <div>
                    <span className="font-bold text-[#282828] dark:text-[#fbf1c7]">{dec.actor_name}</span> ({dec.actor_role}):{' '}
                    <span className="font-mono font-bold uppercase text-blue-600 dark:text-blue-400">{dec.action}</span>
                    {dec.reason && <p className="italic text-[#706860] dark:text-[#a89984] mt-0.5">&ldquo;{dec.reason}&rdquo;</p>}
                  </div>
                  <span className="text-[#a89984] dark:text-[#706860] shrink-0 font-mono text-[10px]">
                    {new Date(dec.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
