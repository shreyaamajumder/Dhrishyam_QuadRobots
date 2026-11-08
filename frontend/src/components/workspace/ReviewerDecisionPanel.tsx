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
    <div className="border-t border-slate-200 bg-slate-50 p-4 sticky bottom-0 z-20 space-y-3">
      {errorMsg && (
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Anchor note if user selected text */}
      {selectedText && (
        <div className="text-[11px] p-2 bg-indigo-50 border border-indigo-200 rounded text-indigo-900 line-clamp-1">
          <span className="font-semibold">Anchoring to text:</span> &ldquo;{selectedText}&rdquo;
        </div>
      )}

      {/* Comment box */}
      <div>
        <label htmlFor="reviewer-comment" className="block text-xs font-semibold text-slate-700 mb-1">
          Reviewer Comment / Feedback:
        </label>
        <textarea
          id="reviewer-comment"
          rows={2}
          placeholder="Required when requesting changes. Comments are preserved in timeline."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-indigo-600 focus:outline-none leading-relaxed"
        />
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={!comment.trim() || isSubmitting}
          onClick={handlePostGeneralComment}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Post comment only</span>
        </button>

        <div className="flex items-center gap-2 ml-auto">
          {/* Request changes */}
          <button
            type="button"
            disabled={isChangesRequestedDisabled}
            onClick={handleRequestChanges}
            title={!comment.trim() ? 'A comment is required when requesting changes' : ''}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Request changes</span>
          </button>

          {/* Approve */}
          <div className="relative group">
            <button
              type="button"
              disabled={isApproveDisabled}
              onClick={() => setShowApproveConfirm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Approve</span>
            </button>

            {isCreatorOfContent && (
              <span className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block w-48 p-1.5 text-[11px] bg-slate-900 text-white rounded shadow-md text-center">
                You can&apos;t approve your own content.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation modal for Approve */}
      <ConfirmDialog
        open={showApproveConfirm}
        title={`Approve "${content.title}" (v${content.current_version_no})?`}
        consequence="Content will be marked as Approved. If anyone subsequently edits the text, the approval will be automatically cleared and returned to Draft."
        confirmLabel="Approve Content"
        confirmVariant="primary"
        onConfirm={handleApproveConfirm}
        onCancel={() => setShowApproveConfirm(false)}
      />
    </div>
  );
};
