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
  Sparkles,
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
      className={`rounded-xl border transition-all duration-150 ${
        isSelected
          ? 'border-indigo-600 bg-white ring-2 ring-indigo-500/20 shadow-md'
          : 'border-slate-200 bg-white hover:border-slate-300 shadow-xs'
      } ${finding.is_stale ? 'opacity-70 bg-slate-50' : ''}`}
    >
      {/* Card Header (always visible) */}
      <div className="p-4 cursor-pointer">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityTag severity={finding.severity} />
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider capitalize">
              {finding.category.replace('_', ' ')}
            </span>
            {latestDecision && (
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  latestDecision.action === 'accepted'
                    ? 'bg-emerald-100 text-emerald-800'
                    : latestDecision.action === 'edited'
                    ? 'bg-sky-100 text-sky-800'
                    : latestDecision.action === 'dismissed'
                    ? 'bg-slate-100 text-slate-700 line-through'
                    : latestDecision.action === 'overridden'
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-indigo-100 text-indigo-900'
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
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
            aria-label={isExpanded ? 'Collapse finding' : 'Expand finding'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Snippet & One-line reason */}
        <div className="text-sm font-medium text-slate-900 line-clamp-1 mb-1">
          &ldquo;{finding.span_text}&rdquo;
        </div>
        <div className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
          {finding.explanation}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3.5 text-xs text-slate-700">
          {/* Stale Finding Warning */}
          {finding.is_stale && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 flex items-center justify-between gap-2">
              <span>This suggestion no longer matches the edited text.</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRerunCheck();
                }}
                className="px-2.5 py-1 text-xs font-semibold bg-white border border-amber-400 rounded-md hover:bg-amber-100 shrink-0"
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
          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 leading-relaxed text-slate-700">
            <span className="font-semibold text-slate-900 block mb-0.5">Policy basis:</span>
            {finding.explanation}
          </div>

          {/* Suggestion Diff or Inline Edit */}
          {isEditing ? (
            <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-indigo-200">
              <label className="block text-xs font-semibold text-slate-900">
                Edit replacement text:
              </label>
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={2}
                className="w-full text-xs p-2 rounded border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSaveEdit}
                  className="px-3 py-1 text-xs rounded font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Save & Apply
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Suggested Replacement:
              </div>
              <DiffView before={finding.span_text} after={finding.suggestion_text} mode="inline" />
            </div>
          )}

          {/* Dismissal Reason Form */}
          {isDismissing && (
            <div className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <label className="block text-xs font-semibold text-slate-900">
                Dismissal reason {finding.severity === 'high' ? '(Mandatory for High severity)' : '(Optional)'}:
              </label>
              <input
                type="text"
                placeholder="e.g. Quoting an external benchmark or partner announcement"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                className="w-full text-xs p-2 rounded border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsDismissing(false)}
                  className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSaveDismiss}
                  className="px-3 py-1 text-xs rounded font-medium bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  Confirm Dismissal
                </button>
              </div>
            </div>
          )}

          {/* Override Reason Form (Reviewer) */}
          {isOverriding && (
            <div className="space-y-2 bg-amber-50 p-3 rounded-lg border border-amber-200">
              <label className="block text-xs font-semibold text-amber-950">
                Reviewer Override Reason:
              </label>
              <input
                type="text"
                placeholder="e.g. Accepted exception for verified customer quote"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full text-xs p-2 rounded border border-amber-300 bg-white focus:ring-2 focus:ring-amber-600 focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOverriding(false)}
                  className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSaveOverride}
                  className="px-3 py-1 text-xs rounded font-medium bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  Save Override
                </button>
              </div>
            </div>
          )}

          {/* Validation error feedback */}
          {validationError && (
            <div className="text-xs text-rose-600 font-medium p-2 bg-rose-50 rounded border border-rose-200">
              {validationError}
            </div>
          )}

          {/* Actions toolbar */}
          {!finding.is_stale && !isEditing && !isDismissing && !isOverriding && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              {/* Creator Actions */}
              {canCreatorDecide && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleAccept}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs"
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
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setIsDismissing(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
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
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-xs"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Confirm</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setIsOverriding(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-amber-800 border border-amber-300 hover:bg-amber-50 transition-colors"
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
                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 ml-auto"
                >
                  <History className="w-3 h-3" />
                  <span>{finding.decisions.length} decision{finding.decisions.length > 1 ? 's' : ''}</span>
                </button>
              )}
            </div>
          )}

          {/* Decision history view */}
          {showHistory && (
            <div className="mt-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-[11px] space-y-1.5">
              <div className="font-semibold text-slate-700">Audit trail for this finding:</div>
              {finding.decisions.map((dec) => (
                <div key={dec.id} className="flex items-start justify-between gap-2 border-b border-slate-200/60 pb-1 last:border-0 last:pb-0">
                  <div>
                    <span className="font-medium text-slate-900">{dec.actor_name}</span> ({dec.actor_role}):{' '}
                    <span className="font-semibold uppercase">{dec.action}</span>
                    {dec.reason && <p className="italic text-slate-600 mt-0.5">&ldquo;{dec.reason}&rdquo;</p>}
                  </div>
                  <span className="text-slate-400 shrink-0 font-mono text-[10px]">
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
