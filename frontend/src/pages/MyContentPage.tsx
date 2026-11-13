// src/pages/MyContentPage.tsx
import React, { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  Copy,
  Trash2,
  FileText,
  AlertOctagon,
  AlertTriangle,
  Info,
  Clock,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { ContentItem } from '../types/domain';
import {
  StatusBadge,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
  Skeleton,
} from '../components/shared/Primitives';

export const MyContentPage: React.FC = () => {
  const { user, navigate, pushToast } = useApp();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<'mine' | 'all'>('mine');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const loadContent = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.getContentList(user);
      setItems(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load content list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContent();
  }, [user]);

  const handleDuplicate = async (id: string) => {
    if (!user) return;
    try {
      const copy = await api.duplicateContentAsDraft(user, id);
      pushToast({
        title: 'Draft duplicated',
        description: `Created "${copy.title}"`,
        type: 'success',
      });
      loadContent();
    } catch (err: unknown) {
      pushToast({
        title: 'Duplication failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!user || !deleteTargetId) return;
    try {
      await api.deleteDraft(user, deleteTargetId);
      pushToast({
        title: 'Draft deleted',
        type: 'info',
      });
      setDeleteTargetId(null);
      loadContent();
    } catch (err: unknown) {
      pushToast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Only drafts can be deleted',
        type: 'error',
      });
      setDeleteTargetId(null);
    }
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    if (scopeFilter === 'mine' && user && item.creator_id !== user.id) return false;
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.creator_name.toLowerCase().includes(q) ||
      item.content_type.toLowerCase().includes(q)
    );
  });

  // Metric stats
  const totalCount = items.length;
  const inReviewCount = items.filter((i) => i.status === 'in_review').length;
  const changesCount = items.filter((i) => i.status === 'changes_requested').length;
  const approvedCount = items.filter((i) => i.status === 'approved').length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#282828] dark:text-[#fbf1c7] tracking-tight">
            Editorial Workspace & Manuscripts
          </h1>
          <p className="text-xs sm:text-sm font-sans text-[#706860] dark:text-[#a89984] mt-1">
            Author brand content, run cited compliance checks, and submit certified copy
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('new-review')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-sans font-semibold text-white dark:text-[#1d2021] bg-[#1d6f7a] hover:bg-[#15545c] dark:bg-[#4ea8a0] dark:hover:bg-[#5ab8ad] transition-all shadow-xs shrink-0 cursor-pointer tap-interactive self-start sm:self-auto active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>New Review Draft</span>
        </button>
      </div>

      {/* Bento Grid Editorial Overview (inspired by bentogrids.com) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Bento Cell 1: Editorial Command Hero (Spans 2 cols on lg) */}
        <div className="col-span-1 lg:col-span-2 bento-card p-5 sm:p-6 flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#1d6f7a] dark:bg-[#4ea8a0] animate-pulse" />
              <span className="text-[11px] font-sans font-semibold uppercase tracking-wider text-[#1d6f7a] dark:text-[#4ea8a0]">
                Active Editorial Ledger
              </span>
            </div>
            <div className="p-2 rounded-xl bg-[#1d6f7a]/10 dark:bg-[#4ea8a0]/15 text-[#1d6f7a] dark:text-[#4ea8a0]">
              <FileText className="w-4 h-4" />
            </div>
          </div>

          <div className="my-4">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl sm:text-5xl font-serif font-bold text-[#282828] dark:text-[#fbf1c7] tabular-nums">
                {totalCount}
              </span>
              <span className="text-sm font-sans text-[#706860] dark:text-[#a89984]">
                manuscripts in current cycle
              </span>
            </div>
            <p className="text-xs font-sans text-[#504945] dark:text-[#a89984] mt-2">
              Human-supervised brand governance with deterministic rule verification and peer approvals.
            </p>
          </div>

          {/* Mini progress bar of status distribution */}
          <div className="space-y-1.5 pt-2 border-t border-[#ded9ce]/60 dark:border-[#3c3836]">
            <div className="flex justify-between text-[11px] font-sans text-[#706860] dark:text-[#a89984]">
              <span>Distribution Breakdown</span>
              <span>{approvedCount} of {Math.max(totalCount, 1)} certified</span>
            </div>
            <div className="h-2 w-full bg-[#edeae1] dark:bg-[#1d2021] rounded-full overflow-hidden flex gap-0.5">
              <div
                style={{ width: `${totalCount ? (approvedCount / totalCount) * 100 : 0}%` }}
                className="bg-[#1d6f7a] dark:bg-[#4ea8a0] h-full transition-all duration-500"
                title={`Approved: ${approvedCount}`}
              />
              <div
                style={{ width: `${totalCount ? (inReviewCount / totalCount) * 100 : 0}%` }}
                className="bg-[#35656d] dark:bg-[#83a598] h-full transition-all duration-500"
                title={`In Review: ${inReviewCount}`}
              />
              <div
                style={{ width: `${totalCount ? (changesCount / totalCount) * 100 : 0}%` }}
                className="bg-[#af3a03] dark:bg-[#fe8019] h-full transition-all duration-500"
                title={`Changes Requested: ${changesCount}`}
              />
            </div>
          </div>
        </div>

        {/* Bento Cell 2: Under Peer Review (Professional Teal Accent) */}
        <div className="bento-card p-5 sm:p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-sans font-semibold uppercase tracking-wider text-[#1d6f7a] dark:text-[#4ea8a0]">
              In Review
            </span>
            <div className="p-2 rounded-xl bg-[#1d6f7a]/10 dark:bg-[#4ea8a0]/15 text-[#1d6f7a] dark:text-[#4ea8a0]">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="my-3">
            <div className="text-3xl sm:text-4xl font-serif font-bold text-[#1d6f7a] dark:text-[#4ea8a0] tabular-nums">
              {inReviewCount}
            </div>
            <p className="text-xs font-sans text-[#706860] dark:text-[#a89984] mt-1">
              Manuscripts pending reviewer clearance
            </p>
          </div>
          <div className="text-[11px] font-sans text-[#706860] dark:text-[#a89984] pt-2 border-t border-[#ded9ce]/60 dark:border-[#3c3836]">
            Awaiting peer inspection
          </div>
        </div>

        {/* Bento Cell 3: Action Required */}
        <div className="bento-card p-5 sm:p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-sans font-semibold uppercase tracking-wider text-[#af3a03] dark:text-[#fe8019]">
              Revisions Needed
            </span>
            <div className="p-2 rounded-xl bg-[#af3a03]/10 text-[#af3a03] dark:text-[#fe8019]">
              <RotateCcw className="w-4 h-4" />
            </div>
          </div>
          <div className="my-3">
            <div className="text-3xl sm:text-4xl font-serif font-bold text-[#af3a03] dark:text-[#fe8019] tabular-nums">
              {changesCount}
            </div>
            <p className="text-xs font-sans text-[#706860] dark:text-[#a89984] mt-1">
              Findings flagged for author revision
            </p>
          </div>
          <div className="text-[11px] font-sans text-[#706860] dark:text-[#a89984] pt-2 border-t border-[#ded9ce]/60 dark:border-[#3c3836]">
            Editorial feedback pending
          </div>
        </div>
      </div>

      {error && <InlineAlert title="Error loading drafts" message={error} onRetry={loadContent} />}

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-[#282828] p-3 rounded-2xl border border-[#e2ded5] dark:border-[#3c3836] shadow-2xs">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#706860] dark:text-[#a89984] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by title, author, or content type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3 py-2 text-xs font-sans rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-[#edeae1]/60 dark:bg-[#1d2021] text-[#282828] dark:text-[#fbf1c7] placeholder:text-[#706860] dark:placeholder:text-[#a89984] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c]"
          />
        </div>

        {/* Filter chips & Scope */}
        <div className="flex flex-wrap items-center gap-2">
          {user?.role === 'admin' && (
            <div className="flex items-center bg-[#edeae1] dark:bg-[#1d2021] rounded-xl p-0.5 border border-[#ded9ce] dark:border-[#3c3836] text-xs font-sans">
              <button
                type="button"
                onClick={() => setScopeFilter('mine')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  scopeFilter === 'mine'
                    ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-[#fbf1c7] shadow-xs'
                    : 'text-[#706860] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                }`}
              >
                My Drafts
              </button>
              <button
                type="button"
                onClick={() => setScopeFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  scopeFilter === 'all'
                    ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-[#fbf1c7] shadow-xs'
                    : 'text-[#706860] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
                }`}
              >
                All Workspace
              </button>
            </div>
          )}

          {/* Status selector */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs font-sans font-medium p-2 px-3 rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-[#1d2021] text-[#282828] dark:text-[#ebdbb2] focus:outline-none focus:ring-1 focus:ring-[#36755a] cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="checked">Verified</option>
            <option value="in_review">In Review</option>
            <option value="changes_requested">Changes Requested</option>
            <option value="approved">Certified Compliant</option>
          </select>
        </div>
      </div>

      {/* Content Table */}
      {loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-6 h-6" />}
          explanation="No documents found matching current filter criteria."
          action={{
            label: 'Create New Draft',
            onClick: () => navigate('new-review'),
          }}
        />
      ) : (
        <div className="bg-white dark:bg-[#282828] rounded-2xl border border-[#e2ded5] dark:border-[#3c3836] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[#e2ded5] dark:divide-[#3c3836] text-left text-xs">
              <thead className="bg-[#edeae1]/60 dark:bg-[#1d2021]/80 text-[#706860] dark:text-[#a89984] font-sans font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th scope="col" className="px-5 py-3.5">Document Title</th>
                  <th scope="col" className="px-5 py-3.5">Status</th>
                  <th scope="col" className="px-5 py-3.5">Type</th>
                  <th scope="col" className="px-5 py-3.5">Findings</th>
                  <th scope="col" className="px-5 py-3.5">Author</th>
                  <th scope="col" className="px-5 py-3.5 text-right">Modified</th>
                  <th scope="col" className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2ded5] dark:divide-[#3c3836]/60 font-sans font-normal">
                {filteredItems.map((item) => {
                  const findings = item.latest_check?.findings || [];
                  const highCount = findings.filter((f) => f.severity === 'high').length;
                  const medCount = findings.filter((f) => f.severity === 'medium').length;
                  const lowCount = findings.filter((f) => f.severity === 'low').length;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`workspace/${item.id}`)}
                      className="hover:bg-[#edeae1]/50 dark:hover:bg-[#32302f]/60 transition-colors cursor-pointer group"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-sans font-semibold text-sm text-[#282828] dark:text-[#fbf1c7] group-hover:text-[#1d6f7a] dark:group-hover:text-[#4ea8a0] transition-colors">
                            {item.title}
                          </span>
                          <span className="text-[10px] font-sans text-[#706860] dark:text-[#a89984]">
                            v{item.current_version_no}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="text-[10px] font-sans uppercase px-2.5 py-0.5 rounded-md bg-[#edeae1] dark:bg-[#1d2021] text-[#4a4440] dark:text-[#a89984] border border-[#ded9ce] dark:border-[#3c3836]">
                          {item.content_type.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-[11px]">
                        {findings.length > 0 ? (
                          <div className="flex items-center gap-1.5">
                            {highCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-[#a8231b]/15 text-[#a8231b] dark:text-[#fb4934] font-semibold border border-[#a8231b]/30">
                                <AlertOctagon className="w-3 h-3" />
                                <span>{highCount}</span>
                              </span>
                            )}
                            {medCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-[#af3a03]/15 text-[#af3a03] dark:text-[#fe8019] font-semibold border border-[#af3a03]/30">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{medCount}</span>
                              </span>
                            )}
                            {lowCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-[#35656d]/15 text-[#35656d] dark:text-[#83a598] font-semibold border border-[#35656d]/30">
                                <Info className="w-3 h-3" />
                                <span>{lowCount}</span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#627520] dark:text-[#b8bb26] text-xs font-sans">
                            Clean · 0 issues
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap font-sans text-[#4a4440] dark:text-[#ebdbb2]">
                        {item.creator_name}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap font-sans text-[11px] text-[#706860] dark:text-[#a89984]">
                        {new Date(item.updated_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleDuplicate(item.id)}
                            className="p-1.5 text-[#706860] hover:text-[#282828] dark:hover:text-white rounded-lg hover:bg-[#edeae1] dark:hover:bg-[#32302f] cursor-pointer transition-colors"
                            title="Duplicate draft"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {item.status === 'draft' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTargetId(item.id)}
                              className="p-1.5 text-[#706860] hover:text-[#a8231b] dark:hover:text-[#fb4934] rounded-lg hover:bg-[#a8231b]/10 cursor-pointer transition-colors"
                              title="Delete draft"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        title="Delete Draft Document?"
        consequence="This draft and its associated automated findings will be permanently purged. This action cannot be undone."
        confirmLabel="Purge Draft"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
};
