// src/pages/ReviewQueuePage.tsx
import React, { useState, useEffect } from 'react';
import {
  Inbox,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Search,
  ArrowRight,
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
  const filtered = items
    .filter((item) => {
      if (activeTab === 'awaiting') {
        return item.status === 'in_review';
      } else if (activeTab === 'decided') {
        return item.status === 'approved' || item.status === 'changes_requested';
      }
      return true; // 'all'
    })
    .filter((item) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.creator_name.toLowerCase().includes(q) ||
        item.content_type.toLowerCase().includes(q)
      );
    });

  const awaitingCount = items.filter((i) => i.status === 'in_review').length;
  const decidedCount = items.filter((i) => i.status === 'approved' || i.status === 'changes_requested').length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#282828] dark:text-[#fbf1c7] tracking-tight">
            Editorial Approval Gateway
          </h1>
          <p className="text-xs sm:text-sm font-sans text-[#706860] dark:text-[#a89984] mt-1">
            Pending submissions awaiting editorial verification, exception overrides, or publication certification
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center bg-[#edeae1] dark:bg-[#1d2021] p-1 rounded-2xl border border-[#ded9ce] dark:border-[#3c3836] text-xs font-sans">
          <button
            type="button"
            onClick={() => setActiveTab('awaiting')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all cursor-pointer tap-interactive ${
              activeTab === 'awaiting'
                ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-[#fbf1c7] shadow-xs'
                : 'text-[#706860] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
            }`}
          >
            Awaiting Review ({awaitingCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('decided')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all cursor-pointer tap-interactive ${
              activeTab === 'decided'
                ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-[#fbf1c7] shadow-xs'
                : 'text-[#706860] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
            }`}
          >
            Decided ({decidedCount})
          </button>
          {user?.role === 'admin' && (
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all cursor-pointer tap-interactive ${
                activeTab === 'all'
                  ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-[#fbf1c7] shadow-xs'
                  : 'text-[#706860] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
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
        <Search className="w-4 h-4 text-[#706860] dark:text-[#a89984] absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Filter queue by title, author, or format..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-3 py-2 text-xs font-sans rounded-xl border border-[#ded9ce] dark:border-[#3c3836] bg-white dark:bg-[#282828] text-[#282828] dark:text-[#fbf1c7] placeholder:text-[#706860] dark:placeholder:text-[#a89984] focus:outline-none focus:ring-1 focus:ring-[#36755a] dark:focus:ring-[#8ec07c] shadow-2xs"
        />
      </div>

      {/* Table */}
      {loading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="w-6 h-6" />}
          explanation={
            activeTab === 'awaiting'
              ? 'Zero pending documents currently awaiting review.'
              : 'No documents found matching current filter.'
          }
        />
      ) : (
        <div className="bg-white dark:bg-[#282828] rounded-2xl border border-[#e2ded5] dark:border-[#3c3836] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full divide-y divide-[#e2ded5] dark:divide-[#3c3836] text-left text-xs">
              <thead className="bg-[#edeae1]/60 dark:bg-[#1d2021]/80 text-[#706860] dark:text-[#a89984] font-sans font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th scope="col" className="px-5 py-3.5">Document Title</th>
                  <th scope="col" className="px-5 py-3.5">Status</th>
                  <th scope="col" className="px-5 py-3.5">Format</th>
                  <th scope="col" className="px-5 py-3.5">Author</th>
                  <th scope="col" className="px-5 py-3.5">Findings</th>
                  <th scope="col" className="px-5 py-3.5 text-right">Submitted</th>
                  <th scope="col" className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2ded5] dark:divide-[#3c3836]/60 font-sans font-normal">
                {filtered.map((item) => {
                  const findings = item.latest_check?.findings || [];
                  const highCount = findings.filter((f) => f.severity === 'high').length;
                  const medCount = findings.filter((f) => f.severity === 'medium').length;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`workspace/${item.id}`)}
                      className="hover:bg-[#edeae1]/50 dark:hover:bg-[#32302f]/60 transition-colors cursor-pointer group"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-baseline gap-2">
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
                      <td className="px-5 py-3.5 whitespace-nowrap text-[#4a4440] dark:text-[#ebdbb2] font-sans">
                        {item.creator_name}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-[11px]">
                        {findings.length > 0 ? (
                          <div className="flex items-center gap-1.5">
                            {highCount > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#a8231b]/15 text-[#a8231b] dark:text-[#fb4934] font-semibold border border-[#a8231b]/30">
                                <AlertOctagon className="w-3 h-3" />
                                <span>{highCount}</span>
                              </span>
                            )}
                            {medCount > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#af3a03]/15 text-[#af3a03] dark:text-[#fe8019] font-semibold border border-[#af3a03]/30">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{medCount}</span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#627520] dark:text-[#b8bb26] text-xs font-sans">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Clean</span>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap font-sans text-[11px] text-[#706860] dark:text-[#a89984]">
                        {new Date(item.updated_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`workspace/${item.id}`);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-sans font-semibold bg-[#1d6f7a] hover:bg-[#16565f] text-white dark:bg-[#4ea8a0] dark:text-[#1d2021] dark:hover:bg-[#5ab8ad] transition-all cursor-pointer shadow-2xs tap-interactive"
                        >
                          <span>{item.status === 'in_review' ? 'Verify' : 'Inspect'}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
