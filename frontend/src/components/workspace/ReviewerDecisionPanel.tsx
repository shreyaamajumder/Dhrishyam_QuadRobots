// src/components/workspace/ReviewerDecisionPanel.tsx
import React, { useState } from 'react';
import { CheckCircle2, RotateCcw, MessageSquare, AlertCircle } from 'lucide-react';
import { ContentItem, UserProfile } from '../../types/domain';
import { ConfirmDialog } from '../shared/Primitives';

interface ReviewerDecisionPanelProps {
  content: ContentItem;
  currentUser: UserProfile;
  selectedText?: string;
  onDecision: (decision: 'approved' | 'changes_requested', comment: string) => Promise<void>;
  onAddComment: (comment: string, anchorText?: string) => Promise<void>;
}

export const ReviewerDecisionPanel: React.FC<ReviewerDecisionPanelProps> = ({
  content,
  currentUser,
  selectedText,
  onDecision,
  onAddComment,
}) => {
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isCreatorOfContent = content.creator_id === currentUser.id;
  const isChangesRequestedDisabled = !comment.trim() || isSubmitting;
  const isApproveDisabled = isCreatorOfContent || isSubmitting;

  const handleRequestChanges = async () => {
    if (!comment.trim()) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onDecision('changes_requested', comment.trim());
      setComment('');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveConfirm = async () => {
    setShowApproveConfirm(false);
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onDecision('approved', comment.trim());
      setComment('');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePostGeneralComment = async () => {
    if (!comment.trim()) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onAddComment(comment.trim(), selectedText);
      setComment('');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border-t border-[#e2ded5] dark:border-[#32302f] bg-white dark:bg-[#282828] p-4 sticky bottom-0 z-20 space-y-3 shadow-md">
      {errorMsg && (
        <div className="p-3 rounded-xl bg-[#a8231b]/10 border border-[#a8231b]/25 text-xs text-[#a8231b] dark:text-[#fb4934] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-[#a8231b] dark:text-[#fb4934]" />
          <span className="font-sans">{errorMsg}</span>
        </div>
      )}

      {/* Anchor note if user selected text */}
      {selectedText && (
        <div className="text-[11px] p-2.5 bg-[#35656d]/10 border border-[#35656d]/25 rounded-xl text-[#35656d] dark:text-[#83a598] line-clamp-1 font-sans">
          <span className="font-bold">Referenced Context:</span> &ldquo;{selectedText}&rdquo;
        </div>
      )}

      {/* Comment box */}
      <div>
        <label htmlFor="reviewer-comment" className="block text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1] uppercase tracking-wider mb-1.5">
          Reviewer Comment & Feedback
        </label>
        <textarea
          id="reviewer-comment"
          rows={2}
          placeholder="Required when requesting changes. Comments are permanently recorded in the audit trail."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full text-xs sm:text-sm p-3 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] placeholder:text-[#706860] dark:placeholder:text-[#a89984] focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] focus:outline-none leading-relaxed"
        />
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={!comment.trim() || isSubmitting}
          onClick={handlePostGeneralComment}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-sans font-medium text-[#4a4440] dark:text-[#ebdbb2] bg-[#edeae1] dark:bg-[#32302f] border border-[#ded9ce] dark:border-[#3c3836] rounded-xl hover:bg-[#ded9ce] dark:hover:bg-[#3c3836] disabled:opacity-40 transition-colors cursor-pointer tap-interactive"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Post Note</span>
        </button>

        <div className="flex items-center gap-2 ml-auto">
          {/* Request changes */}
          <button
            type="button"
            disabled={isChangesRequestedDisabled}
            onClick={handleRequestChanges}
            title={!comment.trim() ? 'A comment is required when requesting changes' : ''}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-sans font-semibold bg-[#af3a03]/10 text-[#af3a03] dark:text-[#fe8019] border border-[#af3a03]/30 hover:bg-[#af3a03]/20 disabled:opacity-40 transition-all cursor-pointer tap-interactive"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Request Revision</span>
          </button>

          {/* Approve */}
          <div className="relative group">
            <button
              type="button"
              disabled={isApproveDisabled}
              onClick={() => setShowApproveConfirm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-sans font-semibold bg-[#36755a] hover:bg-[#2e634c] text-white dark:bg-[#8ec07c] dark:hover:bg-[#a9d19a] dark:text-[#1d2021] disabled:opacity-40 transition-all shadow-xs cursor-pointer tap-interactive"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Approve Copy</span>
            </button>

            {isCreatorOfContent && (
              <span className="absolute bottom-full right-0 mb-2 hidden group-hover:block w-52 p-2 text-xs bg-[#282828] text-[#ebdbb2] rounded-lg shadow-xl text-center border border-[#3c3836]">
                Creators cannot approve their own submissions.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation modal for Approve */}
      <ConfirmDialog
        open={showApproveConfirm}
        title={`Approve "${content.title}" (v${content.current_version_no})?`}
        consequence="Content will be certified as Brand Approved. Any subsequent text modifications will automatically clear the approval status."
        confirmLabel="Approve Content"
        confirmVariant="primary"
        onConfirm={handleApproveConfirm}
        onCancel={() => setShowApproveConfirm(false)}
      />
    </div>
  );
};
