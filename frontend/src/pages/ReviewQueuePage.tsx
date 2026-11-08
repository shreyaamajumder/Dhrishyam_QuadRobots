// src/pages/ReviewQueuePage.tsx
import React, { useState, useEffect } from 'react';
import {
  Inbox,
  Clock,
  AlertOctagon,
  AlertTriangle,
  Info,
  CheckCircle2,
  ExternalLink,
  Search,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { ContentItem } from '../types/domain';
import {
  StatusBadge,
  EmptyState,
  InlineAlert,
  Skeleton,
} from '../components/shared/Primitives';

export const ReviewQueuePage: React.FC = () => {
  const { user, navigate } = useApp();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'awaiting' | 'decided' | 'all'>('awaiting');
  const [search, setSearch] = useState('');

  const loadData = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const all = await api.getContentList(user);
      setItems(all);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  // Tab filtering
  const filtered = items.filter((item) => {
    if (activeTab === 'awaiting') {
      return item.status === 'in_review';
    } else if (activeTab === 'decided') {
      return item.status === 'approved' || item.status === 'changes_requested';
    }
    return true; // 'all'
  }).filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      item.creator_name.toLowerCase().includes(q) ||
      item.content_type.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Review Queue</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Content submissions awaiting review and brand sign-off.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('awaiting')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === 'awaiting'
                ? 'bg-white text-indigo-700 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Awaiting Review ({items.filter((i) => i.status === 'in_review').length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('decided')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === 'decided'
                ? 'bg-white text-indigo-700 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Decided ({items.filter((i) => i.status === 'approved' || i.status === 'changes_requested').length})
          </button>
          {user?.role === 'admin' && (
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'all'
                  ? 'bg-white text-indigo-700 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Items ({items.length})
            </button>
          )}
        </div>
      </div>

      {error && <InlineAlert title="Error loading queue" message={error} onRetry={loadData} />}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Filter by title, creator, or format..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <Skeleton className="h-8 w-1/4" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="w-6 h-6" />}
          explanation={
            search
              ? 'No submissions match your search.'
              : activeTab === 'awaiting'
              ? 'Nothing waiting for review right now.'
              : 'No decided items in this queue.'
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="px-4 py-3">Submission</th>
                <th scope="col" className="px-4 py-3">Creator</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Issues / Dismissals</th>
                <th scope="col" className="px-4 py-3">Submitted</th>
                <th scope="col" className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-normal">
              {filtered.map((item) => {
                const stats = item.latest_check?.stats;
                const dismissedCount = (item.latest_check?.findings || []).filter((f) =>
                  f.decisions.some((d) => d.action === 'dismissed')
                ).length;

                return (
                  <tr
                    key={item.id}
                    onClick={() => navigate(`workspace/${item.id}`)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    {/* Submission Title */}
                    <td className="px-4 py-3 max-w-sm">
                      <div className="font-semibold text-slate-900 line-clamp-1">{item.title}</div>
                      <div className="text-[11px] text-slate-500 capitalize mt-0.5">
                        {item.content_type.replace('_', ' ')} · v{item.current_version_no} ({item.word_count} words)
                      </div>
                    </td>

                    {/* Creator */}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700 font-medium">
                      {item.creator_name}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={item.status} />
                    </td>

                    {/* Findings & Dismissals */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-xs">
                        {stats && stats.high > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-rose-700 font-semibold tabular-nums">
                            <AlertOctagon className="w-3.5 h-3.5 text-rose-600" /> {stats.high}
                          </span>
                        ) : null}
                        {stats && stats.medium > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-amber-700 font-semibold tabular-nums">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> {stats.medium}
                          </span>
                        ) : null}
                        {stats && stats.low > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-sky-700 font-semibold tabular-nums">
                            <Info className="w-3.5 h-3.5 text-sky-600" /> {stats.low}
                          </span>
                        ) : null}
                        {dismissedCount > 0 && (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]">
                            {dismissedCount} dismissed
                          </span>
                        )}
                        {stats && stats.high === 0 && stats.medium === 0 && stats.low === 0 && (
                          <span className="text-emerald-700">Clean</span>
                        )}
                      </div>
                    </td>

                    {/* Submitted / Time */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-slate-800 font-mono text-[11px]">
                        {item.submitted_at
                          ? new Date(item.submitted_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </div>
                      {item.status === 'in_review' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 font-medium bg-amber-50 px-1.5 py-0.2 rounded mt-0.5">
                          <Clock className="w-3 h-3" /> Waiting review
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`workspace/${item.id}`);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                      >
                        <span>Review</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
