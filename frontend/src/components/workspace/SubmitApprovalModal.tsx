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
      }).catch(() => {});
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-modal-title"
    >
      <div className="bg-white dark:bg-[#282828] rounded-2xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-[#e2ded5] dark:border-[#3c3836] animate-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-3 mb-5 pb-3 border-b border-[#e2ded5] dark:border-[#3c3836]">
          <div>
            <div className="text-[11px] font-medium text-[#706860] dark:text-[#a89984] mb-1">Editorial Approval Dispatch</div>
            <h3 id="submit-modal-title" className="font-serif text-lg font-medium tracking-tight text-[#282828] dark:text-[#fbf1c7]">
              Submit &ldquo;{content.title}&rdquo; for Review
            </h3>
            <p className="text-xs text-[#706860] dark:text-[#a89984] font-mono mt-0.5">Version: v{content.current_version_no}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#706860] hover:text-[#282828] dark:hover:text-[#fbf1c7] p-1.5 rounded-lg hover:bg-[#edeae1] dark:hover:bg-[#3c3836] cursor-pointer transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs font-mono text-rose-800 dark:text-rose-300">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Reviewer select */}
          <div>
            <label htmlFor="reviewer-select" className="block text-[11px] font-mono font-semibold tracking-wider text-[#706860] dark:text-[#a89984] uppercase mb-1.5">
              Assigned Reviewer <span className="text-rose-500">*</span>
            </label>
            {members.length > 0 ? (
              <select
                id="reviewer-select"
                value={selectedReviewerId}
                onChange={(e) => setSelectedReviewerId(e.target.value)}
                className="w-full text-xs font-mono p-3 rounded-lg border border-[#e2ded5] dark:border-[#3c3836] bg-white dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] focus:ring-1 focus:ring-[#36755a] focus:border-[#36755a] focus:outline-none"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name} [{m.role.toUpperCase()}] — {m.email}
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-3 bg-[#d65d0e]/10 border border-[#d65d0e]/30 rounded-lg text-xs font-mono text-[#af3a03] dark:text-[#fe8019]">
                No eligible reviewers found. An Admin must assign the Reviewer role to an active member.
              </div>
            )}
          </div>

          {/* Submission checklist guard */}
          <div className="p-4 rounded-xl bg-[#edeae1]/60 dark:bg-[#1d2021] border border-[#e2ded5] dark:border-[#3c3836] space-y-2.5">
            <div className="text-xs font-semibold text-[#4a4440] dark:text-[#ebdbb2]">Pre-flight Editorial Gate</div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-[#4a4440] dark:text-[#ebdbb2]">
                {undecidedHigh.length === 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertOctagon className="w-4 h-4 text-rose-500" />
                )}
                High Severity Finding Resolution:
              </span>
              <span className="font-mono font-bold text-[#282828] dark:text-[#fbf1c7] tabular-nums">
                {decidedHigh.length} / {highFindings.length} resolved
              </span>
            </div>

            {undecidedHigh.length > 0 && (
              <div className="pt-1">
                <p className="text-xs text-rose-700 dark:text-rose-400 leading-relaxed">
                  Gate locked: all high severity findings must be confirmed, edited, or dismissed prior to reviewer dispatch.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSelectFinding(undecidedHigh[0].id);
                  }}
                  className="mt-1.5 text-xs font-semibold text-blue-600 dark:text-sky-400 hover:underline cursor-pointer"
                >
                  &rarr; Inspect unresolved item: {undecidedHigh[0].entry_code}
                </button>
              </div>
            )}
          </div>

          {/* Submission note */}
          <div>
            <label htmlFor="submit-note" className="block text-xs font-semibold text-[#4a4440] dark:text-[#ebdbb2] uppercase tracking-wider mb-1.5 font-mono">
              Reviewer Dispatch Note (Optional)
            </label>
            <textarea
              id="submit-note"
              rows={2}
              placeholder="e.g. Cross-checked with product matrix; verified multi-region SLA terms."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full text-xs sm:text-sm p-3 rounded-xl border border-[#e2ded5] dark:border-[#3c3836] bg-white dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] placeholder:text-[#706860] dark:placeholder:text-[#a89984] focus:ring-2 focus:ring-[#36755a]/25 focus:border-[#36755a] focus:outline-none leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e2ded5] dark:border-[#3c3836]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#4a4440] dark:text-[#ebdbb2] bg-[#edeae1] dark:bg-[#32302f] border border-[#ded9ce] dark:border-[#3c3836] hover:bg-[#ded9ce] dark:hover:bg-[#504945] transition-colors cursor-pointer tap-interactive"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit || isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-[#282828] dark:bg-[#edeae1] text-white dark:text-[#282828] hover:bg-black dark:hover:bg-white disabled:opacity-40 transition-all cursor-pointer shadow-xs tap-interactive"
            >
              <UserCheck className="w-4 h-4 text-blue-500" />
              <span>{isSubmitting ? 'Dispatching...' : 'Dispatch to Reviewer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
