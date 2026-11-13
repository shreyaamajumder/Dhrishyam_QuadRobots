// src/pages/ReviewWorkspacePage.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  RotateCcw,
  CheckCircle,
  FileText,
  AlertOctagon,
  AlertTriangle,
  Info,
  ChevronDown,
  Edit2,
  Save,
  X,
  Send,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import {
  ContentItem,
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
import { ImageReviewPanel } from '../components/workspace/ImageReviewPanel';
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

  // Flexible workspace split state (28% - 78%)
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('dhrishyam_workspace_split');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 28 && parsed <= 78) return parsed;
      }
    } catch {}
    return 58;
  });

  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dhrishyam_inspector_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const [isDraggingSplitter, setIsDraggingSplitter] = useState<boolean>(false);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 1024
  );
  const workspaceContainerRef = useRef<HTMLDivElement>(null);

  // Responsive desktop detection
  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Persist inspector collapsed state
  useEffect(() => {
    try {
      localStorage.setItem('dhrishyam_inspector_collapsed', isInspectorCollapsed ? 'true' : 'false');
    } catch {}
  }, [isInspectorCollapsed]);

  // Persist split ratio
  useEffect(() => {
    try {
      localStorage.setItem('dhrishyam_workspace_split', splitRatio.toString());
    } catch {}
  }, [splitRatio]);

  // Draggable Splitter mouse / pointer handling
  const handleSplitterPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDraggingSplitter(true);
    const startX = e.clientX;
    const initialRatio = splitRatio;
    const container = workspaceContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const nextRatio = Math.min(78, Math.max(28, initialRatio + deltaPercent));
      setSplitRatio(nextRatio);
    };

    const onPointerUp = () => {
      setIsDraggingSplitter(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, [splitRatio]);

  // Keyboard shortcut Ctrl+B or Option+I to toggle Inspector focus mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setIsInspectorCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch document
  const fetchContent = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getContentById(contentId);
      setContent(data);
      if (data.versions.length > 0) {
        setEditText(data.versions[data.versions.length - 1].body_text);
        if (data.versions.length > 1) {
          setCompareVersionNo(data.versions[data.versions.length - 2].version_no);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load content item');
    } finally {
      setLoading(false);
    }
  }, [user, contentId]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  // Re-run checks
  const handleRerunCheck = async () => {
    if (!content || !user) return;
    try {
      setIsChecking(true);
      const run = await api.triggerCheckRun(user, content.id);
      const updated = await api.getContentById(content.id);
      setContent(updated);
      const totalFindings = (run.stats.high || 0) + (run.stats.medium || 0) + (run.stats.low || 0);
      pushToast({
        title: 'Policy check complete',
        description: `Found ${totalFindings} total observations (${run.stats.high || 0} high severity)`,
        type: 'success',
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

  // Inline editing save
  const handleSaveDocEdit = () => {
    if (!content) return;
    if (content.status === 'approved') {
      setShowRevertDraftConfirm(true);
      return;
    }
    executeSaveEdit();
  };

  const executeSaveEdit = async () => {
    if (!content || !user) return;
    setShowRevertDraftConfirm(false);
    try {
      setIsSavingEdit(true);
      const updated = await api.updateContentBody(user, content.id, editText);
      setContent(updated);
      setIsEditingDoc(false);
      pushToast({
        title: 'Version saved',
        description: `Created revision v${updated.current_version_no} with fresh guardrail verification`,
        type: 'success',
      });
    } catch (err: unknown) {
      pushToast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Error writing new revision',
        type: 'error',
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Finding decisions
  const handleDecision = async (
    findingId: string,
    action: FindingDecisionAction,
    reason?: string,
    editedReplacementText?: string
  ) => {
    if (!content || !user) return;
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
          title: 'Suggestion applied to draft',
          description: `Generated new version v${result.item.current_version_no}`,
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

  // Text selection listener for comment anchoring
  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 3) {
      setAnchoredText(sel.toString().trim());
    }
  };

  const latestVersion = useMemo(() => {
    if (!content || content.versions.length === 0) return null;
    return content.versions[content.versions.length - 1];
  }, [content]);

  const findings = useMemo(() => {
    if (!content?.latest_check?.findings) return [];
    return content.latest_check.findings;
  }, [content]);

  // Filtered findings by category
  const filteredFindings = useMemo(() => {
    if (categoryFilter === 'all') return findings;
    return findings.filter((f) => f.category === categoryFilter);
  }, [findings, categoryFilter]);

  // Separate active and dismissed findings
  const { activeFindings, dismissedFindings } = useMemo(() => {
    const active: Finding[] = [];
    const dismissed: Finding[] = [];
    for (const f of filteredFindings) {
      const dec = f.decisions[f.decisions.length - 1];
      const isDismissed = dec && (dec.action === 'dismissed' || dec.action === 'overridden');
      if (isDismissed) {
        dismissed.push(f);
      } else {
        active.push(f);
      }
    }
    return { activeFindings: active, dismissedFindings: dismissed };
  }, [filteredFindings]);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
          <div className="lg:col-span-5 space-y-4">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-48 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !content || !latestVersion) {
    return (
      <div className="p-6 max-w-2xl mx-auto text-center py-20">
        <InlineAlert
          variant="error"
          title="Document Error"
          message={error || 'Could not find the requested content manuscript'}
        />
        <button
          type="button"
          onClick={() => navigate('review-queue')}
          className="mt-4 px-4 py-2 text-xs font-sans font-semibold text-white bg-[#282828] dark:bg-[#edeae1] dark:text-[#282828] rounded-xl cursor-pointer hover:bg-[#3c3836] dark:hover:bg-white transition-all shadow-xs"
        >
          Return to Queue
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
    <div className="flex flex-col h-full min-h-0 bg-[#f6f4ee] dark:bg-[#1d2021] text-[#282828] dark:text-[#ebdbb2]">
      {/* 1. Header Bar */}
      <header className="bg-white/95 dark:bg-[#242728]/95 backdrop-blur-md border-b border-[#e2ded5] dark:border-[#32302f] px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate(user?.role === 'reviewer' ? 'review-queue' : 'my-content')}
            className="p-1.5 text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white rounded-lg hover:bg-[#edeae1] dark:hover:bg-[#32302f] transition-colors cursor-pointer"
            aria-label="Back to listing"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-base sm:text-lg font-serif font-bold text-[#282828] dark:text-[#fbf1c7] truncate max-w-xs sm:max-w-md tracking-tight">
                {content.title}
              </h2>
              <StatusBadge status={content.status} />
              <span className="text-[10px] font-sans font-semibold px-2 py-0.5 rounded-md bg-[#edeae1] dark:bg-[#32302f] text-[#4a4440] dark:text-[#d5c4a1] border border-[#ded9ce] dark:border-[#3c3836]">
                v{content.current_version_no}
              </span>
            </div>
            <div className="text-[11px] font-sans text-[#706860] dark:text-[#a89984] flex items-center gap-2 mt-0.5">
              <span>{content.word_count} words</span>
              <span>•</span>
              <span>By {content.creator_name}</span>
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-sans font-medium text-[#282828] dark:text-[#ebdbb2] bg-white dark:bg-[#32302f] border border-[#ded9ce] dark:border-[#3c3836] hover:bg-[#edeae1] dark:hover:bg-[#3c3836] disabled:opacity-50 transition-all cursor-pointer shadow-2xs active:scale-[0.98]"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{isChecking ? 'Evaluating...' : 'Re-run Check'}</span>
          </button>

          {/* Submit for Approval (Creator) */}
          {(isCreatorRole || isAdminRole) && content.status !== 'in_review' && content.status !== 'approved' && (
            <button
              type="button"
              onClick={() => setIsSubmitModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-sans font-semibold text-white dark:text-[#1d2021] bg-[#36755a] dark:bg-[#8ec07c] hover:bg-[#2e634c] dark:hover:bg-[#a9d19a] transition-all shadow-xs cursor-pointer active:scale-[0.98]"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit for Approval</span>
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-sans font-medium text-[#706860] hover:text-[#a8231b] dark:text-[#a89984] dark:hover:text-[#fb4934] bg-white dark:bg-[#32302f] border border-[#ded9ce] dark:border-[#3c3836] cursor-pointer"
            >
              <span>Withdraw</span>
            </button>
          )}
        </div>
      </header>

      {/* Mobile Tab Control */}
      <div className="lg:hidden bg-white dark:bg-[#242728] border-b border-[#e2ded5] dark:border-[#32302f] px-3 py-2 flex items-center justify-around text-xs font-sans shrink-0">
        <button
          type="button"
          onClick={() => setMobileTab('document')}
          className={`py-1 px-3 rounded-lg font-medium transition-all ${
            mobileTab === 'document' ? 'bg-[#282828] text-white dark:bg-[#edeae1] dark:text-[#282828] font-semibold' : 'text-[#706860] dark:text-[#a89984]'
          }`}
        >
          Document
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('findings')}
          className={`py-1 px-3 rounded-lg font-medium transition-all ${
            mobileTab === 'findings' ? 'bg-[#282828] text-white dark:bg-[#edeae1] dark:text-[#282828] font-semibold' : 'text-[#706860] dark:text-[#a89984]'
          }`}
        >
          Findings ({activeFindings.length})
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('versions')}
          className={`py-1 px-3 rounded-lg font-medium transition-all ${
            mobileTab === 'versions' ? 'bg-[#282828] text-white dark:bg-[#edeae1] dark:text-[#282828] font-semibold' : 'text-[#706860] dark:text-[#a89984]'
          }`}
        >
          Versions
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('comments')}
          className={`py-1 px-3 rounded-lg font-medium transition-all ${
            mobileTab === 'comments' ? 'bg-[#282828] text-white dark:bg-[#edeae1] dark:text-[#282828] font-semibold' : 'text-[#706860] dark:text-[#a89984]'
          }`}
        >
          Comments ({content.comments.length})
        </button>
      </div>

      {/* 2 & 3. Main Workspace Canvas with Interactive Splitter */}
      <div
        ref={workspaceContainerRef}
        className={`flex-1 flex overflow-hidden relative ${isDraggingSplitter ? 'select-none' : ''}`}
      >
        {/* Left Zone: Document Viewport */}
        <section
          aria-label="Document Content"
          style={isDesktop ? { width: isInspectorCollapsed ? '100%' : `${splitRatio}%` } : undefined}
          className={`w-full border-r border-[#e2ded5] dark:border-[#32302f] bg-[#f6f4ee] dark:bg-[#1d2021] flex flex-col overflow-hidden transition-[width] ${
            isDraggingSplitter ? 'duration-0' : 'duration-200 ease-out'
          } ${mobileTab !== 'document' ? 'hidden lg:flex' : 'flex'}`}
        >
          {/* Document Toolbar */}
          <div className="px-5 py-2.5 bg-white/70 dark:bg-[#242728]/70 border-b border-[#e2ded5] dark:border-[#32302f] flex items-center justify-between gap-3 shrink-0 font-sans text-xs">
            <div className="flex items-center gap-2 text-[#706860] dark:text-[#a89984]">
              <FileText className="w-3.5 h-3.5" />
              <span>Version v{latestVersion.version_no} ({latestVersion.source})</span>
              <span>•</span>
              <span>{content.word_count} words</span>
            </div>

            <div className="flex items-center gap-2">
              {isInspectorCollapsed && (
                <button
                  type="button"
                  onClick={() => setIsInspectorCollapsed(false)}
                  className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-sans font-semibold text-[#36755a] dark:text-[#8ec07c] bg-[#36755a]/10 dark:bg-[#8ec07c]/15 border border-[#36755a]/25 dark:border-[#8ec07c]/30 rounded-lg hover:bg-[#36755a]/20 transition-colors cursor-pointer shadow-2xs"
                  title="Open findings inspector panel"
                >
                  <PanelRightOpen className="w-3.5 h-3.5" />
                  <span>Inspector ({activeFindings.length})</span>
                </button>
              )}

              {isEditingDoc ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditText(latestVersion.body_text);
                      setIsEditingDoc(false);
                    }}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg border border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-[#32302f] text-[#4a4440] dark:text-[#d5c4a1] hover:bg-[#edeae1] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSavingEdit}
                    onClick={handleSaveDocEdit}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg bg-[#282828] dark:bg-[#edeae1] text-white dark:text-[#282828] shadow-xs cursor-pointer active:scale-[0.98]"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Revision</span>
                  </button>
                </>
              ) : latestVersion.image ? null : (
                <button
                  type="button"
                  onClick={() => setIsEditingDoc(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-[#32302f] text-[#4a4440] dark:text-[#d5c4a1] hover:bg-[#edeae1] cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit Draft</span>
                </button>
              )}
            </div>
          </div>

          {/* Document Body Area */}
          <div
            className="flex-1 p-6 md:p-8 lg:p-10 overflow-y-auto"
            onMouseUp={handleMouseUp}
          >
            {isEditingDoc ? (
              <textarea
                rows={18}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full h-full text-[17px] sm:text-[18px] p-6 rounded-2xl border border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-[#282828] text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-2 focus:ring-[#36755a]/40 leading-[1.8] font-serif shadow-inner transition-colors"
              />
            ) : (
              <div className="max-w-prose mx-auto bg-white dark:bg-[#282828] p-7 sm:p-9 rounded-2xl border border-[#e2ded5] dark:border-[#3c3836] shadow-sm">
                {latestVersion.image && user && (
                  <ImageReviewPanel
                    user={user}
                    contentId={contentId}
                    image={latestVersion.image}
                    findings={findings}
                    selectedFindingId={selectedFindingId}
                    onSelectFinding={(id) => {
                      setSelectedFindingId(id);
                      if (window.innerWidth < 1024) setMobileTab('findings');
                    }}
                    onRevised={() => {
                      setSelectedFindingId(null);
                      fetchContent();
                    }}
                  />
                )}
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

                {/* Attached Image Display */}
                {content.attachment && (
                  <div className="mt-8 p-4 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/50 dark:bg-[#1d2021]/50 space-y-2">
                    <div className="text-xs font-sans font-semibold text-[#4a4440] dark:text-[#d5c4a1] flex items-center justify-between">
                      <span>Attached Asset</span>
                      <span className="text-[#706860] dark:text-[#a89984] font-normal">{content.attachment.file_name}</span>
                    </div>
                    {content.attachment.preview_url && (
                      <img
                        src={content.attachment.preview_url}
                        alt={content.attachment.alt_text}
                        className="max-h-48 object-contain rounded-lg border border-[#ded9ce] dark:border-[#3c3836]"
                      />
                    )}
                    <div className="text-xs font-sans text-[#706860] dark:text-[#a89984]">
                      <strong>Alt Text:</strong> {content.attachment.alt_text || <span className="text-[#a8231b] dark:text-[#fb4934] italic">Missing alt description</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Draggable Splitter Handle */}
        {!isInspectorCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(splitRatio)}
            aria-valuemin={28}
            aria-valuemax={78}
            aria-label="Resize workspace panels"
            onPointerDown={handleSplitterPointerDown}
            onDoubleClick={() => setSplitRatio(58)}
            title="Drag to resize split, double-click to reset (58/42)"
            className={`hidden lg:flex items-center justify-center w-2 -mx-1 z-30 cursor-col-resize select-none relative group transition-colors ${
              isDraggingSplitter
                ? 'bg-[#36755a]/25 shadow-[0_0_12px_rgba(54,117,90,0.5)]'
                : 'hover:bg-[#36755a]/10'
            }`}
          >
            {/* Grab Notch Handle */}
            <div
              className={`w-1 h-12 rounded-full transition-all duration-150 flex flex-col items-center justify-center gap-1 ${
                isDraggingSplitter
                  ? 'bg-[#36755a] dark:bg-[#8ec07c] scale-y-110'
                  : 'bg-[#ded9ce] dark:bg-[#504945] group-hover:bg-[#36755a] dark:group-hover:bg-[#8ec07c]'
              }`}
            >
              <span className="w-0.5 h-0.5 rounded-full bg-[#706860] dark:bg-[#282828]" />
              <span className="w-0.5 h-0.5 rounded-full bg-[#706860] dark:bg-[#282828]" />
              <span className="w-0.5 h-0.5 rounded-full bg-[#706860] dark:bg-[#282828]" />
            </div>

            {/* Live percentage indicator while dragging */}
            {isDraggingSplitter && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-[#282828] dark:bg-[#1d2021] text-white text-[10px] font-sans font-semibold tracking-wide whitespace-nowrap shadow-xl border border-[#ded9ce] dark:border-[#3c3836] pointer-events-none z-50">
                Manuscript {Math.round(splitRatio)}% · Inspector {Math.round(100 - splitRatio)}%
              </div>
            )}
          </div>
        )}

        {/* Right Zone: Findings / Versions / Comments / Timeline */}
        <section
          aria-label="Review Inspector"
          style={isDesktop ? { width: isInspectorCollapsed ? '0%' : `${100 - splitRatio}%` } : undefined}
          className={`w-full bg-[#fcfbf9] dark:bg-[#222425] flex flex-col overflow-hidden transition-[width] ${
            isDraggingSplitter ? 'duration-0' : 'duration-200 ease-out'
          } ${
            isInspectorCollapsed ? 'hidden' : mobileTab === 'document' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Right Tabs Header */}
          <div className="px-4 py-2 bg-white/95 dark:bg-[#282828]/95 border-b border-[#e2ded5] dark:border-[#32302f] flex items-center justify-between shrink-0 font-sans text-xs">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRightTab('findings')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  rightTab === 'findings'
                    ? 'bg-[#282828] text-white dark:bg-[#32302f] dark:text-[#fbf1c7] font-semibold shadow-2xs'
                    : 'text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white'
                }`}
              >
                Findings ({activeFindings.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('versions')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  rightTab === 'versions'
                    ? 'bg-[#282828] text-white dark:bg-[#32302f] dark:text-[#fbf1c7] font-semibold shadow-2xs'
                    : 'text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white'
                }`}
              >
                Versions ({content.versions.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('comments')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  rightTab === 'comments'
                    ? 'bg-[#282828] text-white dark:bg-[#32302f] dark:text-[#fbf1c7] font-semibold shadow-2xs'
                    : 'text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white'
                }`}
              >
                Comments ({content.comments.length})
              </button>
              <button
                type="button"
                onClick={() => setRightTab('timeline')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  rightTab === 'timeline'
                    ? 'bg-[#282828] text-white dark:bg-[#32302f] dark:text-[#fbf1c7] font-semibold shadow-2xs'
                    : 'text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white'
                }`}
              >
                Audit Trail
              </button>
            </div>

            {/* Split actions: Preset / Focus Mode Collapse */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSplitRatio((r) => (r === 50 ? 58 : 50))}
                className="hidden sm:inline-flex items-center text-[10px] font-sans font-semibold px-2 py-1 rounded-md text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white hover:bg-[#edeae1] dark:hover:bg-[#32302f] transition-colors cursor-pointer"
                title={splitRatio === 50 ? 'Switch to Standard 58/42 split' : 'Switch to Equal 50/50 split'}
              >
                {splitRatio === 50 ? '58:42' : '50:50'}
              </button>
              <button
                type="button"
                onClick={() => setIsInspectorCollapsed(true)}
                className="hidden lg:flex p-1.5 rounded-md text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white hover:bg-[#edeae1] dark:hover:bg-[#32302f] transition-colors cursor-pointer"
                title="Collapse inspector (Full-screen focus mode)"
                aria-label="Collapse inspector"
              >
                <PanelRightClose className="w-4 h-4" />
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
                  className="px-4 py-2.5 bg-white dark:bg-[#282828] border-b border-[#e2ded5] dark:border-[#32302f] shrink-0 space-y-2 font-sans text-xs"
                >
                  {content.latest_check.status === 'degraded' && (
                    <div className="p-2 rounded-lg bg-[#af3a03]/10 border border-[#af3a03]/25 text-xs text-[#af3a03] dark:text-[#fe8019] font-medium">
                      Offline heuristic fallback mode active.
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 font-semibold text-[#a8231b] dark:text-[#fb4934] tabular-nums">
                        <AlertOctagon className="w-3.5 h-3.5" />
                        {content.latest_check.stats.high} Critical
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-[#af3a03] dark:text-[#fe8019] tabular-nums">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {content.latest_check.stats.medium} Warning
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-[#35656d] dark:text-[#83a598] tabular-nums">
                        <Info className="w-3.5 h-3.5" />
                        {content.latest_check.stats.low} Advisory
                      </span>
                    </div>

                    <span className="text-[11px] text-[#706860] dark:text-[#a89984]">
                      {content.latest_check.engine_info.rules_checked} rules evaluated
                    </span>
                  </div>

                  {/* Category Filter Chips */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px]">
                    {['all', 'tone', 'terminology', 'messaging', 'facts_claims', 'accessibility', 'visual'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-2.5 py-0.5 rounded-lg capitalize font-medium transition-all cursor-pointer ${
                          categoryFilter === cat
                            ? 'bg-[#282828] text-white dark:bg-[#32302f] dark:text-[#fbf1c7] font-semibold shadow-2xs'
                            : 'bg-[#edeae1] dark:bg-[#1d2021] text-[#706860] hover:text-[#282828] dark:text-[#a89984] dark:hover:text-white'
                        }`}
                      >
                        {cat.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Findings Cards List */}
              <div className="flex-1 p-3.5 overflow-y-auto space-y-2.5">
                {activeFindings.length === 0 && dismissedFindings.length === 0 ? (
                  <div className="text-center py-12 px-4 bg-white dark:bg-[#282828] rounded-2xl border border-dashed border-[#ded9ce] dark:border-[#3c3836]">
                    <CheckCircle className="w-8 h-8 text-[#627520] dark:text-[#b8bb26] mx-auto mb-2" />
                    <div className="text-sm font-sans font-semibold text-[#282828] dark:text-[#fbf1c7]">
                      All Brand Guardrails Passed
                    </div>
                    <p className="text-xs font-sans text-[#706860] dark:text-[#a89984] mt-1 max-w-xs mx-auto">
                      All {content.latest_check?.engine_info.rules_checked || 7} brand rules verified. No compliance violations detected.
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
                          className="w-full flex items-center justify-between p-2.5 text-xs font-sans font-semibold text-[#706860] dark:text-[#a89984] bg-[#edeae1] dark:bg-[#282828] rounded-xl cursor-pointer hover:bg-[#ded9ce] dark:hover:bg-[#32302f] transition-colors"
                        >
                          <span>Dismissed Findings ({dismissedFindings.length})</span>
                          <ChevronDown
                            className={`w-3.5 h-3.5 transition-transform ${showDismissed ? 'rotate-180' : ''}`}
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
                      description: `Notification dispatched to ${content.creator_name}`,
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
            <div className="flex-1 p-4 overflow-y-auto space-y-4 font-sans text-xs">
              <div className="bg-white dark:bg-[#282828] p-4 rounded-2xl border border-[#e2ded5] dark:border-[#3c3836] shadow-2xs">
                <div className="font-semibold text-[#282828] dark:text-[#fbf1c7] mb-2">
                  Version History
                </div>
                <div className="space-y-1.5">
                  {content.versions.map((ver) => (
                    <div
                      key={ver.id}
                      className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 transition-all ${
                        ver.version_no === content.current_version_no
                          ? 'border-[#36755a] bg-[#36755a]/10 text-[#282828] dark:text-[#fbf1c7]'
                          : 'border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-[#1d2021]'
                      }`}
                    >
                      <div>
                        <span className="font-bold">v{ver.version_no}</span> • {ver.source}
                        <p className="text-[11px] text-[#706860] dark:text-[#a89984] mt-0.5">
                          {ver.created_by_name} • {new Date(ver.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      {ver.version_no !== content.current_version_no && (
                        <button
                          type="button"
                          onClick={() => setCompareVersionNo(ver.version_no)}
                          className="px-2.5 py-1 text-[11px] font-semibold bg-[#edeae1] dark:bg-[#32302f] hover:bg-[#ded9ce] dark:hover:bg-[#3c3836] rounded-lg cursor-pointer transition-colors"
                        >
                          Compare
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {content.versions.length > 1 && (
                <div className="space-y-2">
                  <div className="font-serif font-bold text-sm text-[#282828] dark:text-[#fbf1c7]">
                    Revision Comparison: v{compareVersionNo} vs v{content.current_version_no}
                  </div>
                  <DiffView
                    before={content.versions.find((v) => v.version_no === compareVersionNo)?.body_text || ''}
                    after={latestVersion.body_text}
                    mode="split"
                  />
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Comments */}
          {rightTab === 'comments' && (
            <div className="flex-1 flex flex-col overflow-hidden font-sans text-xs">
              <div className="flex-1 p-3.5 overflow-y-auto space-y-2.5">
                {content.comments.length === 0 ? (
                  <div className="text-center py-10 text-[#706860] dark:text-[#a89984]">
                    No comments recorded yet.
                  </div>
                ) : (
                  content.comments.map((cmt) => (
                    <div key={cmt.id} className="bg-white dark:bg-[#282828] p-3.5 rounded-xl border border-[#e2ded5] dark:border-[#3c3836] space-y-1 shadow-2xs">
                      <div className="flex items-center justify-between text-[#706860] dark:text-[#a89984] text-[11px]">
                        <span className="font-semibold text-[#282828] dark:text-[#fbf1c7]">
                          {cmt.author_name} ({cmt.author_role})
                        </span>
                        <span>{new Date(cmt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {cmt.anchor_text && (
                        <div className="p-2 bg-[#edeae1]/60 dark:bg-[#1d2021]/60 rounded-lg border border-[#ded9ce] dark:border-[#3c3836] text-[11px] italic text-[#706860] dark:text-[#a89984]">
                          &ldquo;{cmt.anchor_text}&rdquo;
                        </div>
                      )}
                      <p className="text-[#3c3836] dark:text-[#ebdbb2] leading-relaxed text-xs">{cmt.body}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Comment Input */}
              <div className="p-3 bg-white dark:bg-[#282828] border-t border-[#e2ded5] dark:border-[#32302f]">
                {anchoredText && (
                  <div className="flex items-center justify-between text-xs text-[#35656d] dark:text-[#83a598] bg-[#35656d]/10 p-2 rounded-xl mb-2 border border-[#35656d]/20 font-sans">
                    <span className="truncate">Referenced text: &ldquo;{anchoredText}&rdquo;</span>
                    <button type="button" onClick={() => setAnchoredText('')} className="p-0.5 cursor-pointer hover:opacity-75">
                      <X className="w-3.5 h-3.5" />
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
                    placeholder="Enter review note..."
                    className="flex-1 text-xs font-sans p-2.5 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] placeholder:text-[#706860] dark:placeholder:text-[#a89984]"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-[#282828] dark:bg-[#edeae1] text-white dark:text-[#282828] text-xs font-semibold hover:bg-[#3c3836] dark:hover:bg-white transition-all cursor-pointer active:scale-[0.98]"
                  >
                    Post Note
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Tab 4: Timeline Audit */}
          {rightTab === 'timeline' && (
            <div className="flex-1 p-3.5 overflow-y-auto space-y-2 font-sans text-xs">
              <div className="font-semibold text-[#706860] dark:text-[#a89984] mb-2 uppercase text-[11px] tracking-wider">
                Event Audit Trail
              </div>
              {content.timeline.map((event) => (
                <div key={event.id} className="bg-white dark:bg-[#282828] p-3.5 rounded-xl border border-[#e2ded5] dark:border-[#3c3836] space-y-1 shadow-2xs">
                  <div className="flex items-center justify-between text-[#706860] dark:text-[#a89984] text-[11px]">
                    <span className="font-semibold text-[#282828] dark:text-[#fbf1c7]">
                      {event.actor_name} ({event.actor_role})
                    </span>
                    <span>{new Date(event.created_at).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-[#3c3836] dark:text-[#ebdbb2] leading-relaxed text-xs">{event.summary}</div>
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
        title="Modifications Clear Certification"
        consequence="Modifying this document will clear existing approval certifications and revert it to Draft status. A new version will be registered in the provenance ledger."
        confirmLabel="Confirm & Save Version"
        confirmVariant="primary"
        onConfirm={executeSaveEdit}
        onCancel={() => setShowRevertDraftConfirm(false)}
      />
    </div>
  );
};
