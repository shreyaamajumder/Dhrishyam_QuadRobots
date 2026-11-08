// src/components/workspace/SubmitApprovalModal.tsx
import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, AlertOctagon, UserCheck } from 'lucide-react';
import { ContentItem, UserProfile } from '../../types/domain';
import { api } from '../../services/api';

interface SubmitApprovalModalProps {
  open: boolean;
  content: ContentItem;
  currentUser: UserProfile;
  onClose: () => void;
  onSubmit: (reviewerId: string, note?: string) => Promise<void>;
  onSelectFinding: (findingId: string) => void;
}

export const SubmitApprovalModal: React.FC<SubmitApprovalModalProps> = ({
  open,
  content,
  currentUser,
  onClose,
  onSubmit,
  onSelectFinding,
}) => {
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [selectedReviewerId, setSelectedReviewerId] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      api.getMembers().then((list) => {
        // Reviewers must have reviewer or admin role, and cannot be the creator
        const eligible = list.filter(
          (m) => (m.role === 'reviewer' || m.role === 'admin') && m.id !== currentUser.id
        );
        setMembers(eligible);
        if (eligible.length > 0) {
          setSelectedReviewerId(eligible[0].id);
        }
      });
    }
  }, [open, currentUser.id]);

  if (!open) return null;

  const findings = content.latest_check?.findings || [];
  const highFindings = findings.filter((f) => f.severity === 'high');
  const decidedHigh = highFindings.filter((f) => f.decisions.length > 0);
  const undecidedHigh = highFindings.filter((f) => f.decisions.length === 0);
  const canSubmit = undecidedHigh.length === 0 && Boolean(selectedReviewerId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onSubmit(selectedReviewerId, note);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-modal-title"
    >
      <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 id="submit-modal-title" className="text-base font-semibold text-slate-900">
              Submit &ldquo;{content.title}&rdquo; for Approval
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Version {content.current_version_no}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Reviewer select */}
          <div>
            <label htmlFor="reviewer-select" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Assign Reviewer <span className="text-rose-600">*</span>
            </label>
            {members.length > 0 ? (
              <select
                id="reviewer-select"
                value={selectedReviewerId}
                onChange={(e) => setSelectedReviewerId(e.target.value)}
                className="w-full text-sm p-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-600 focus:outline-none"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name} ({m.role.toUpperCase()}) — {m.email}
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                No eligible reviewers found. An Admin must assign the Reviewer role to another member.
              </div>
            )}
          </div>

          {/* Submission checklist guard */}
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
            <div className="text-xs font-semibold text-slate-800">Governance Pre-Flight Guard:</div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-700">
                {undecidedHigh.length === 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertOctagon className="w-4 h-4 text-rose-600" />
                )}
                All High severity findings decided:
              </span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {decidedHigh.length} of {highFindings.length}
              </span>
            </div>

            {undecidedHigh.length > 0 && (
              <div className="pt-1">
                <p className="text-[11px] text-rose-700 leading-relaxed">
                  Every High severity finding must have a decision (accepted, edited, or dismissed with reason) before submitting.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSelectFinding(undecidedHigh[0].id);
                  }}
                  className="mt-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
                >
                  Jump to first undecided High finding ({undecidedHigh[0].entry_code})
                </button>
              </div>
            )}
          </div>

          {/* Submission note */}
          <div>
            <label htmlFor="submit-note" className="block text-xs font-semibold text-slate-700 mb-1">
              Note for Reviewer (Optional):
            </label>
            <textarea
              id="submit-note"
              rows={2}
              placeholder="e.g. Verified with product team; please double-check supported languages list."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-600 focus:outline-none leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit || isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-xs"
            >
              <UserCheck className="w-4 h-4" />
              <span>{isSubmitting ? 'Submitting...' : 'Submit for Review'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
