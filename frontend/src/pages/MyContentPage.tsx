// src/pages/MyContentPage.tsx
import React, { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  MoreVertical,
  Copy,
  Trash2,
  ExternalLink,
  MessageSquare,
  FileText,
  AlertOctagon,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { ContentItem, ContentStatus } from '../types/domain';
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
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.creator_name.toLowerCase().includes(q) ||
        item.content_type.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">My Content</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage your drafts, review brand check results, and track approval workflows.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('new-review')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-xs shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Review</span>
        </button>
      </div>

      {error && <InlineAlert title="Error loading drafts" message={error} onRetry={loadContent} />}

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by title, creator, or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
          />
        </div>

        {/* Filter chips & Scope */}
        <div className="flex flex-wrap items-center gap-2">
          {user?.role === 'admin' && (
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 mr-2 text-xs">
              <button
                type="button"
                onClick={() => setScopeFilter('mine')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  scopeFilter === 'mine' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Mine
              </button>
              <button
                type="button"
                onClick={() => setScopeFilter('all')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  scopeFilter === 'all' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Workspace
              </button>
            </div>
          )}

          <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 text-xs">
            {['all', 'draft', 'checked', 'in_review', 'changes_requested', 'approved'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg capitalize whitespace-nowrap transition-colors ${
                  statusFilter === st
                    ? 'bg-indigo-600 text-white font-medium shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content Table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-6 h-6" />}
          explanation={
            search || statusFilter !== 'all'
              ? 'No drafts match the selected filters.'
              : 'No drafts yet. Check your first piece of content against your brand rules.'
          }
          actionLabel={search || statusFilter !== 'all' ? 'Clear Filters' : 'New Review'}
          onAction={() => {
            if (search || statusFilter !== 'all') {
              setSearch('');
              setStatusFilter('all');
            } else {
              navigate('new-review');
            }
          }}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="px-4 py-3">Title & Format</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Latest Check</th>
                <th scope="col" className="px-4 py-3">Reviewer</th>
                <th scope="col" className="px-4 py-3">Updated</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-normal">
              {filteredItems.map((item) => {
                const stats = item.latest_check?.stats;
                return (
                  <tr
                    key={item.id}
                    onClick={() => navigate(`workspace/${item.id}`)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    {/* Title & Format */}
                    <td className="px-4 py-3 max-w-xs sm:max-w-md">
                      <div className="font-semibold text-slate-900 line-clamp-1">{item.title}</div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        <span className="capitalize">{item.content_type.replace('_', ' ')}</span>
                        <span>·</span>
                        <span>v{item.current_version_no}</span>
                        <span>·</span>
                        <span>{item.word_count} words</span>
                        {item.attachment && (
                          <>
                            <span>·</span>
                            <span className="text-indigo-600 font-medium">1 image attached</span>
                          </>
                        )}
                      </div>
                      {item.status === 'changes_requested' && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-800 font-medium bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          <MessageSquare className="w-3 h-3 text-amber-600" />
                          <span>Reviewer comments require attention</span>
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={item.status} />
                    </td>

                    {/* Latest Check summary */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {item.latest_check ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {stats && stats.high > 0 ? (
                              <span className="inline-flex items-center gap-0.5 text-rose-700 font-semibold tabular-nums">
                                <AlertOctagon className="w-3 h-3 text-rose-600" /> {stats.high}
                              </span>
                            ) : null}
                            {stats && stats.medium > 0 ? (
                              <span className="inline-flex items-center gap-0.5 text-amber-700 font-semibold tabular-nums">
                                <AlertTriangle className="w-3 h-3 text-amber-600" /> {stats.medium}
                              </span>
                            ) : null}
                            {stats && stats.low > 0 ? (
                              <span className="inline-flex items-center gap-0.5 text-sky-700 font-semibold tabular-nums">
                                <Info className="w-3 h-3 text-sky-600" /> {stats.low}
                              </span>
                            ) : null}
                            {stats && stats.high === 0 && stats.medium === 0 && stats.low === 0 ? (
                              <span className="text-emerald-700 font-medium">No issues found</span>
                            ) : null}
                          </div>
                          <span className="text-[10px] text-slate-400 block font-mono">
                            {new Date(item.latest_check.started_at).toLocaleDateString()}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Not checked yet</span>
                      )}
                    </td>

                    {/* Reviewer */}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {item.reviewer_name || <span className="text-slate-400">—</span>}
                    </td>

                    {/* Updated */}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                      {new Date(item.updated_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>

                    {/* Actions menu */}
                    <td
                      className="px-4 py-3 whitespace-nowrap text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleDuplicate(item.id)}
                          className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"
                          title="Duplicate as new draft"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        {item.status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => setDeleteTargetId(item.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50"
                            title="Delete draft"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate(`workspace/${item.id}`)}
                          className="p-1 text-indigo-600 hover:text-indigo-800 rounded hover:bg-indigo-50"
                          title="Open in Workspace"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Draft Confirm Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        title="Delete this draft?"
        consequence="This draft and its version history will be permanently deleted. This action cannot be undone."
        confirmLabel="Delete Draft"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  );
};
