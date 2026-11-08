// src/pages/ReviewWorkspacePage.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  RotateCcw,
  CheckCircle,
  Clock,
  History,
  MessageSquare,
  FileText,
  AlertOctagon,
  AlertTriangle,
  Info,
  ChevronDown,
  Sparkles,
  Edit2,
  Save,
  X,
  Play,
  Layers,
  Send,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import {
  ContentItem,
  EntryCategory,
  Finding,
  FindingDecisionAction,
} from '../types/domain';
import {
  StatusBadge,
  DiffView,
  Skeleton,
  InlineAlert,
  ConfirmDialog,
} from '../components/shared/Primitives';
import { HighlightedText } from '../components/workspace/HighlightedText';
import { FindingCard } from '../components/workspace/FindingCard';
import { SubmitApprovalModal } from '../components/workspace/SubmitApprovalModal';
import { ReviewerDecisionPanel } from '../components/workspace/ReviewerDecisionPanel';

interface ReviewWorkspacePageProps {
  contentId: string;
}

export const ReviewWorkspacePage: React.FC<ReviewWorkspacePageProps> = ({ contentId }) => {
  const { user, navigate, pushToast } = useApp();

  const [content, setContent] = useState<ContentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active view tabs & selection
  const [mobileTab, setMobileTab] = useState<'document' | 'findings' | 'versions' | 'comments'>('document');
  const [rightTab, setRightTab] = useState<'findings' | 'versions' | 'comments' | 'timeline'>('findings');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  // Document inline editing mode
  const [isEditingDoc, setIsEditingDoc] = useState(false);
  const [editText, setEditText] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Text selection for comment anchoring
  const [anchoredText, setAnchoredText] = useState<string>('');

  // Check execution state
  const [isChecking, setIsChecking] = useState(false);

  // Modals
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [showRevertDraftConfirm, setShowRevertDraftConfirm] = useState(false);

  // Versions compare
  const [compareVersionNo, setCompareVersionNo] = useState<number>(1);

  const loadContent = useCallback(async () => {
    try {
      const data = await api.getContentById(contentId);
      setContent(data);
      const latestVer = data.versions[data.versions.length - 1];
      setEditText(latestVer.body_text);
      if (data.versions.length > 1) {
        setCompareVersionNo(data.versions[data.versions.length - 2].version_no);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load content');
    } finally {
      setLoading(false);
    }
  }, [contentId]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const latestVersion = content?.versions[content.versions.length - 1];
  const findings = content?.latest_check?.findings || [];

  // Filter findings by category
  const filteredFindings = useMemo(() => {
    return findings.filter((f) => {
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      return true;
    });
  }, [findings, categoryFilter]);

  const activeFindings = filteredFindings.filter((f) => {
    const dec = f.decisions[f.decisions.length - 1];
    return !dec || (dec.action !== 'dismissed' && dec.action !== 'overridden');
  });

  const dismissedFindings = filteredFindings.filter((f) => {
    const dec = f.decisions[f.decisions.length - 1];
    return dec && (dec.action === 'dismissed' || dec.action === 'overridden');
  });

  // Automatically select first finding on check completion
  useEffect(() => {
    if (activeFindings.length > 0 && !selectedFindingId) {
      setSelectedFindingId(activeFindings[0].id);
    }
  }, [activeFindings, selectedFindingId]);

  // Keyboard navigation shortcuts: J / K / A / D / E
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing inside input or textarea
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (e.key === 'j' || e.key === 'J') {
        // Next finding
        e.preventDefault();
        const currentIndex = activeFindings.findIndex((f) => f.id === selectedFindingId);
        const nextIndex = (currentIndex + 1) % Math.max(1, activeFindings.length);
        if (activeFindings[nextIndex]) {
          setSelectedFindingId(activeFindings[nextIndex].id);
        }
      } else if (e.key === 'k' || e.key === 'K') {
        // Previous finding
        e.preventDefault();
        const currentIndex = activeFindings.findIndex((f) => f.id === selectedFindingId);
        const prevIndex = (currentIndex - 1 + activeFindings.length) % Math.max(1, activeFindings.length);
        if (activeFindings[prevIndex]) {
          setSelectedFindingId(activeFindings[prevIndex].id);
        }
      } else if (e.key === 'a' || e.key === 'A') {
        // Accept selected finding
        if (selectedFindingId && user && user.role !== 'reviewer') {
          handleDecision(selectedFindingId, 'accepted');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFindings, selectedFindingId, user]);

  // Handle Finding Decision (Accept, Edit, Dismiss, Override, Confirm)
  const handleDecision = async (
    findingId: string,
    action: FindingDecisionAction,
    reason?: string,
    editedReplacementText?: string
  ) => {
    if (!user || !content) return;
    try {
      const result = await api.decideFinding(user, content.id, findingId, {
        action,
        reason,
        edited_text: editedReplacementText,
      });
      setContent(result.item);

      if (action === 'accepted' && result.previousText) {
        const priorText = result.previousText;
        pushToast({
          title: 'Suggestion applied to document',
          description: `Created new version v${result.item.current_version_no}`,
          type: 'success',
          undoLabel: 'Undo edit',
          undoAction: async () => {
            const restored = await api.updateContentBody(user, content.id, priorText, 'manual');
            setContent(restored);
            pushToast({ title: 'Restored previous text version', type: 'info' });
          },
        });
      }
    } catch (err: unknown) {
      pushToast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
      throw err;
    }
  };

  // Re-run brand check
  const handleRerunCheck = async () => {
    if (!user || !content) return;
    setIsChecking(true);
    try {
      const run = await api.triggerCheckRun(user, content.id);
      await loadContent();
      setSelectedFindingId(run.findings[0]?.id || null);
      pushToast({
        title: run.status === 'degraded' ? 'Check completed (Degraded Mode)' : 'Brand check completed',
        description: `${run.findings.length} findings identified`,
        type: run.status === 'degraded' ? 'warning' : 'success',
      });
    } catch (err: unknown) {
      pushToast({
        title: 'Check failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    } finally {
      setIsChecking(false);
    }
  };

  // Save manual document edit
  const handleSaveDocEdit = async () => {
    if (!user || !content) return;
    if (['checked', 'approved'].includes(content.status)) {
      setShowRevertDraftConfirm(true);
      return;
    }
    executeSaveEdit();
  };

  const executeSaveEdit = async () => {
    if (!user || !content) return;
    setIsSavingEdit(true);
    setShowRevertDraftConfirm(false);
    try {
      const updated = await api.updateContentBody(user, content.id, editText, 'manual');
      setContent(updated);
      setIsEditingDoc(false);
      pushToast({
        title: 'New version saved',
        description: `Saved version v${updated.current_version_no} (Status: ${updated.status})`,
        type: 'info',
      });
    } catch (err: unknown) {
      pushToast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Text selection handler for anchored comments
  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim()) {
      setAnchoredText(sel.toString().trim());
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-10 w-1/4" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <Skeleton className="lg:col-span-7 h-96" />
          <Skeleton className="lg:col-span-5 h-96" />
        </div>
      </div>
    );
  }

  if (error || !content || !latestVersion) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <InlineAlert
          title="Could not load review workspace"
          message={error || 'Content item not found'}
          onRetry={loadContent}
        />
        <button
          type="button"
          onClick={() => navigate('my-content')}
          className="mt-4 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          Return to My Content
        </button>
      </div>
    );
  }

  const isCreatorRole = user?.role === 'creator';
  const isReviewerRole = user?.role === 'reviewer';
  const isAdminRole = user?.role === 'admin';

  const canCreatorAct = (isCreatorRole || isAdminRole) && content.status !== 'in_review';
  const canReviewerAct = (isReviewerRole || isAdminRole) && content.status === 'in_review';

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-slate-100">
      {/* 1. Header Bar */}
      <header className="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate(user?.role === 'reviewer' ? 'review-queue' : 'my-content')}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Back to listing"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-slate-900 truncate max-w-xs sm:max-w-md">
                {content.title}
              </h2>
              <StatusBadge status={content.status} />
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                v{content.current_version_no}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
              <span>{content.word_count} words</span>
              <span>·</span>
              <span>Created by {content.creator_name}</span>
              <span>·</span>
              <span>Checked with Brand Library v{content.latest_check?.library_version || 14}</span>
            </div>
          </div>
        </div>

        {/* Primary Role Actions */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Re-run button */}
          <button
            type="button"
            disabled={isChecking}
            onClick={handleRerunCheck}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-xs"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{isChecking ? 'Checking...' : 'Re-run check'}</span>
          </button>

          {/* Submit for Approval (Creator) */}
          {(isCreatorRole || isAdminRole) && content.status !== 'in_review' && content.status !== 'approved' && (
            <button
              type="button"
              onClick={() => setIsSubmitModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit for approval</span>
            </button>
          )}

          {/* Withdraw submission (Creator when in review) */}
          {content.status === 'in_review' && (isCreatorRole || isAdminRole) && (
            <button
              type="button"
              onClick={async () => {
                if (!user) return;
                const updated = await api.withdrawSubmission(user, content.id);
                setContent(updated);
                pushToast({ title: 'Submission withdrawn from queue', type: 'info' });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
            >
              Withdraw
            </button>
          )}
        </div>
      </header>

      {/* Mobile Tab Segmented Control */}
      <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-around text-xs shrink-0">
        <button
          type="button"
          onClick={() => setMobileTab('document')}
          className={`py-1 px-3 rounded-lg font-medium ${
            mobileTab === 'document' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600'
          }`}
        >
          Document
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('findings')}
          className={`py-1 px-3 rounded-lg font-medium relative ${
            mobileTab === 'findings' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600'
          }`}
        >
          Findings ({activeFindings.length})
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('versions')}
          className={`py-1 px-3 rounded-lg font-medium ${
            mobileTab === 'versions' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600'
          }`}
        >
          Versions
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('comments')}
          className={`py-1 px-3 rounded-lg font-medium ${
            mobileTab === 'comments' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600'
          }`}
        >
          Comments ({content.comments.length})
        </button>
      </div>

      {/* 2 & 3. Main Workspace Canvas (Desktop 3 zones: Document on Left, Tabs on Right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Zone: Document Viewport (≈ 60%) */}
        <section
          aria-label="Document Content"
          className={`w-full lg:w-[58%] border-r border-slate-200 bg-white flex flex-col overflow-hidden ${
            mobileTab !== 'document' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Document Toolbar */}
          <div className="px-5 py-2.5 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <FileText className="w-4 h-4 text-slate-500" />
              <span>Version {latestVersion.version_no} ({latestVersion.source})</span>
              <span>·</span>
              <span className="font-mono text-[11px]">{content.word_count} words</span>
            </div>

            <div className="flex items-center gap-2">
              {isEditingDoc ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditText(latestVersion.body_text);
                      setIsEditingDoc(false);
                    }}
                    className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSavingEdit}
                    onClick={handleSaveDocEdit}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded font-semibold bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save version</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingDoc(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit text</span>
                </button>
              )}
            </div>
          </div>

          {/* Document Body Area */}
          <div
            className="flex-1 p-6 md:p-8 overflow-y-auto"
            onMouseUp={handleMouseUp}
          >
            {isEditingDoc ? (
              <textarea
                rows={16}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full h-full text-[15px] p-4 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-indigo-600 focus:outline-none leading-relaxed font-sans"
              />
            ) : (
              <div className="max-w-prose mx-auto">
                <HighlightedText
                  text={latestVersion.body_text}
                  findings={findings}
                  selectedFindingId={selectedFindingId}
                  onSelectFinding={(id) => {
                    setSelectedFindingId(id);
                    if (window.innerWidth < 1024) {
                      setMobileTab('findings');
                    }
                  }}
                />

                {/* Attached Image L1 Display */}
                {content.attachment && (
                  <div className="mt-8 p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                    <div className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                      <span>Attached Visual Asset:</span>
                      <span className="font-mono text-[10px] text-slate-500">{content.attachment.file_name}</span>
                    </div>
                    {content.attachment.preview_url && (
                      <img
                        src={content.attachment.preview_url}
                        alt={content.attachment.alt_text}
                        className="max-h-48 object-contain rounded-lg border border-slate-200"
                      />
                    )}
                    <div className="text-xs text-slate-600">
                      <strong>Alt text:</strong> {content.attachment.alt_text || <span className="text-rose-600 italic">Missing descriptive alt text</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Right Zone: Findings / Versions / Comments / Timeline (≈ 42%) */}
        <section
          aria-label="Review Inspector"
          className={`w-full lg:w-[42%] bg-slate-50 flex flex-col overflow-hidden ${
            mobileTab === 'document' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Right Tabs Header */}
          <div className="px-4 py-2 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1 text-xs">
              <button
                type="button"
                onClick={() => setRightTab('findings')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  rightTab === 'findings'
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Findings ({activeFindings.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('versions')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  rightTab === 'versions'
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Versions ({content.versions.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('comments')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  rightTab === 'comments'
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Comments ({content.comments.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('timeline')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  rightTab === 'timeline'
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Timeline
              </button>
            </div>
          </div>

          {/* Tab 1: Findings */}
          {rightTab === 'findings' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Check Run Summary Strip */}
              {content.latest_check && (
                <div
                  aria-live="polite"
                  className="px-4 py-3 bg-white border-b border-slate-200 shrink-0 space-y-2"
                >
                  {content.latest_check.status === 'degraded' && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950 font-medium">
                      AI review unavailable — showing deterministic rule findings only.
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 font-semibold text-rose-700 tabular-nums">
                        <AlertOctagon className="w-3.5 h-3.5" />
                        {content.latest_check.stats.high} High
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-amber-700 tabular-nums">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {content.latest_check.stats.medium} Medium
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-sky-700 tabular-nums">
                        <Info className="w-3.5 h-3.5" />
                        {content.latest_check.stats.low} Low
                      </span>
                    </div>

                    <span className="text-[11px] text-slate-500">
                      {content.latest_check.engine_info.rules_checked} rules checked · {content.latest_check.engine_info.categories_checked} categories
                    </span>
                  </div>

                  {/* Category Filter Chips */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
                    {['all', 'tone', 'terminology', 'messaging', 'facts_claims', 'accessibility', 'visual'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-2.5 py-0.5 rounded-full capitalize whitespace-nowrap transition-colors ${
                          categoryFilter === cat
                            ? 'bg-slate-800 text-white font-medium'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {cat.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Findings Cards List */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3">
                {activeFindings.length === 0 && dismissedFindings.length === 0 ? (
                  <div className="text-center py-12 px-4 bg-white rounded-xl border border-dashed border-slate-200">
                    <CheckCircle className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                    <div className="text-sm font-semibold text-slate-900">No issues found</div>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                      Checked {content.latest_check?.engine_info.rules_checked || 7} brand rules across active categories. Note: this check is an automated assessment, not a legal guarantee.
                    </p>
                  </div>
                ) : (
                  <>
                    {activeFindings.map((finding) => (
                      <FindingCard
                        key={finding.id}
                        finding={finding}
                        isSelected={selectedFindingId === finding.id}
                        onSelect={() => setSelectedFindingId(finding.id)}
                        userRole={user?.role || 'creator'}
                        canCreatorDecide={canCreatorAct}
                        canReviewerOverride={canReviewerAct}
                        onDecision={handleDecision}
                        onRerunCheck={handleRerunCheck}
                        onOpenLibrary={() => navigate('library')}
                      />
                    ))}

                    {/* Collapsible Dismissed Group */}
                    {dismissedFindings.length > 0 && (
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => setShowDismissed((v) => !v)}
                          className="w-full flex items-center justify-between p-2.5 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
                        >
                          <span>Dismissed / Overridden Findings ({dismissedFindings.length})</span>
                          <ChevronDown
                            className={`w-4 h-4 transition-transform ${showDismissed ? 'rotate-180' : ''}`}
                          />
                        </button>

                        {showDismissed && (
                          <div className="mt-2 space-y-2">
                            {dismissedFindings.map((finding) => (
                              <FindingCard
                                key={finding.id}
                                finding={finding}
                                isSelected={selectedFindingId === finding.id}
                                onSelect={() => setSelectedFindingId(finding.id)}
                                userRole={user?.role || 'creator'}
                                canCreatorDecide={canCreatorAct}
                                canReviewerOverride={canReviewerAct}
                                onDecision={handleDecision}
                                onRerunCheck={handleRerunCheck}
                                onOpenLibrary={() => navigate('library')}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* S07 Reviewer Decision Sticky Panel */}
              {canReviewerAct && user && (
                <ReviewerDecisionPanel
                  content={content}
                  currentUser={user}
                  selectedText={anchoredText}
                  onDecision={async (decision, comment) => {
                    const updated = await api.submitReviewDecision(user, content.id, decision, comment);
                    setContent(updated);
                    pushToast({
                      title: decision === 'approved' ? 'Draft approved' : 'Changes requested',
                      description: `Notification sent to ${content.creator_name}`,
                      type: 'success',
                    });
                  }}
                  onAddComment={async (commentText, anchor) => {
                    const updated = await api.addComment(user, content.id, commentText, anchor);
                    setContent(updated);
                    setAnchoredText('');
                    pushToast({ title: 'Comment added', type: 'info' });
                  }}
                />
              )}
            </div>
          )}

          {/* Tab 2: Versions Compare */}
          {rightTab === 'versions' && (
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                <div className="text-xs font-semibold text-slate-900 mb-2">Version History:</div>
                <div className="space-y-2">
                  {content.versions.map((ver) => (
                    <div
                      key={ver.id}
                      className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                        ver.version_no === content.current_version_no
                          ? 'border-indigo-600 bg-indigo-50/40'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div>
                        <span className="font-bold text-slate-900">v{ver.version_no}</span> · Source:{' '}
                        <span className="capitalize">{ver.source}</span>
                        <p className="text-[11px] text-slate-500">
                          By {ver.created_by_name} at {new Date(ver.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      {ver.version_no !== content.current_version_no && (
                        <button
                          type="button"
                          onClick={() => setCompareVersionNo(ver.version_no)}
                          className="px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 rounded"
                        >
                          Compare with v{content.current_version_no}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Side by side diff compare */}
              {content.versions.length > 1 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-800">
                    Comparing v{compareVersionNo} with current v{content.current_version_no}:
                  </div>
                  <DiffView
                    before={content.versions.find((v) => v.version_no === compareVersionNo)?.body_text || ''}
                    after={latestVersion.body_text}
                    mode="side-by-side"
                  />
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Comments */}
          {rightTab === 'comments' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 p-4 overflow-y-auto space-y-3">
                {content.comments.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-400">
                    No comments yet. Select text in the document or type below to leave feedback.
                  </div>
                ) : (
                  content.comments.map((cmt) => (
                    <div key={cmt.id} className="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500 text-[11px]">
                        <span className="font-semibold text-slate-900">
                          {cmt.author_name} ({cmt.author_role})
                        </span>
                        <span>{new Date(cmt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {cmt.anchor_text && (
                        <div className="p-1.5 bg-slate-50 rounded border border-slate-200 text-[11px] italic text-slate-600">
                          &ldquo;{cmt.anchor_text}&rdquo;
                        </div>
                      )}
                      <p className="text-slate-800 leading-relaxed">{cmt.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* New Comment Input */}
              <div className="p-3 bg-white border-t border-slate-200">
                {anchoredText && (
                  <div className="flex items-center justify-between text-[11px] text-indigo-700 bg-indigo-50 p-1.5 rounded mb-2">
                    <span className="truncate">Anchored to: &ldquo;{anchoredText}&rdquo;</span>
                    <button type="button" onClick={() => setAnchoredText('')} className="p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const inputEl = (e.target as HTMLFormElement).elements.namedItem('comment') as HTMLInputElement;
                    if (!inputEl.value.trim() || !user) return;
                    const updated = await api.addComment(user, content.id, inputEl.value.trim(), anchoredText);
                    setContent(updated);
                    inputEl.value = '';
                    setAnchoredText('');
                  }}
                  className="flex gap-2"
                >
                  <input
                    name="comment"
                    type="text"
                    placeholder="Write a comment..."
                    className="flex-1 text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                  >
                    Post
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Tab 4: Timeline Audit */}
          {rightTab === 'timeline' && (
            <div className="flex-1 p-4 overflow-y-auto space-y-3">
              <div className="text-xs font-semibold text-slate-800 mb-2">Audit Event Stream:</div>
              {content.timeline.map((event) => (
                <div key={event.id} className="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1">
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <span className="font-semibold text-slate-900">
                      {event.actor_name} ({event.actor_role})
                    </span>
                    <span className="font-mono">{new Date(event.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-slate-800 leading-relaxed">{event.summary}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* S05 Submit for Approval Modal */}
      {user && (
        <SubmitApprovalModal
          open={isSubmitModalOpen}
          content={content}
          currentUser={user}
          onClose={() => setIsSubmitModalOpen(false)}
          onSubmit={async (reviewerId, note) => {
            const updated = await api.submitForApproval(user, content.id, reviewerId, note);
            setContent(updated);
            pushToast({
              title: 'Submitted for approval',
              description: `Assigned to ${updated.reviewer_name}`,
              type: 'success',
            });
          }}
          onSelectFinding={(fId) => {
            setSelectedFindingId(fId);
            setRightTab('findings');
          }}
        />
      )}

      {/* Editing resets approved content confirmation */}
      <ConfirmDialog
        open={showRevertDraftConfirm}
        title="Editing will reset approval"
        consequence="Modifying this document will clear existing approval status and revert it to Draft mode. A new version will be created."
        confirmLabel="Continue & Save Edit"
        confirmVariant="primary"
        onConfirm={executeSaveEdit}
        onCancel={() => setShowRevertDraftConfirm(false)}
      />
    </div>
  );
};
