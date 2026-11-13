// src/pages/InsightsPage.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  HelpCircle,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { InsightsData } from '../types/domain';
import { Skeleton, InlineAlert } from '../components/shared/Primitives';

/** The backend sends rates as fractions (0.74), or null when nothing has been decided yet. */
function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  const pct = rate <= 1 ? rate * 100 : rate;
  return `${Math.round(pct)}%`;
}

export const InsightsPage: React.FC = () => {
  const { navigate } = useApp();
  const [period, setPeriod] = useState<number>(30);
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFormulaModal, setShowFormulaModal] = useState(false);

  const loadInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getInsights(period);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load insights data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInsights();
  }, [period]);

  const maxViolation = data?.most_violated_rules
    ? Math.max(...data.most_violated_rules.map((r) => r.count), 1)
    : 1;

  const categoryTotals = useMemo(() => {
    if (!data?.category_over_time?.length) return [];
    const totals: Record<string, number> = {
      terminology: 0,
      facts_claims: 0,
      tone: 0,
      accessibility: 0,
      messaging: 0,
      visual: 0,
    };
    for (const p of data.category_over_time) {
      totals.terminology += p.terminology || 0;
      totals.facts_claims += p.facts_claims || 0;
      totals.tone += p.tone || 0;
      totals.accessibility += p.accessibility || 0;
      totals.messaging += p.messaging || 0;
      totals.visual += p.visual || 0;
    }
    const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(totals)
      .map(([category, count]) => ({
        category,
        count,
        percentage: Math.round((count / sum) * 100),
      }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [data]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#282828] dark:text-white tracking-tight">
            Editorial Analytics & Governance Intelligence
          </h1>
          <p className="text-xs sm:text-sm font-serif italic text-[#7c6f64] dark:text-[#a89984] mt-1">
            System-wide brand consistency, rule violation frequencies, and author verification telemetry
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex items-center bg-[#f0eee9]/50 dark:bg-[#282828] p-1 rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] text-xs font-serif shrink-0">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setPeriod(d)}
              className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer tap-interactive ${
                period === d
                  ? 'bg-white dark:bg-[#32302f] text-[#282828] dark:text-white shadow-xs'
                  : 'text-[#7c6f64] hover:text-[#282828] dark:hover:text-[#ebdbb2]'
              }`}
            >
              {d} Days
            </button>
          ))}
        </div>
      </div>

      {error && <InlineAlert title="Error loading analytics" message={error} onRetry={loadInsights} />}

      {loading || !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        </div>
      ) : (
        <>
          {/* Bento KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1 */}
            <div className="bg-white/90 dark:bg-[#32302f]/90 p-5 rounded-2xl sm:rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-serif font-bold uppercase tracking-wider text-[#7c6f64] dark:text-[#a89984]">
                  Evaluations Run
                </span>
                <div className="p-2 rounded-xl bg-[#f0eee9]/60 dark:bg-[#282828]/60 text-[#458588] dark:text-[#83a598]">
                  <BarChart3 className="w-4 h-4" />
                </div>
              </div>
              <div className="my-2">
                <div className="font-serif text-3xl sm:text-4xl font-bold text-[#282828] dark:text-white tabular-nums">
                  {data.kpis.checks_run}
                </div>
                <div className="text-[11px] text-[#7c6f64] dark:text-[#a89984] mt-1 flex items-center gap-1 font-serif">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>In the last {data.period_days} days</span>
                </div>
              </div>
              <div className="text-[11px] font-serif italic text-[#7c6f64] dark:text-[#a89984] pt-2 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60">
                Total pre-publication checks
              </div>
            </div>

            {/* KPI 2 */}
            <div className="bg-white/90 dark:bg-[#32302f]/90 p-5 rounded-2xl sm:rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-serif font-bold uppercase tracking-wider text-[#d65d0e] dark:text-[#fe8019]">
                  Total Flagged Issues
                </span>
                <div className="p-2 rounded-xl bg-[#d65d0e]/10 text-[#d65d0e] dark:text-[#fe8019]">
                  <AlertTriangle className="w-4 h-4" />
                </div>
              </div>
              <div className="my-2">
                <div className="font-serif text-3xl sm:text-4xl font-bold text-[#d65d0e] dark:text-[#fe8019] tabular-nums">
                  {data.kpis.total_findings}
                </div>
                <div className="text-[11px] text-[#7c6f64] dark:text-[#a89984] mt-1 font-serif">
                  Avg {(data.kpis.total_findings / Math.max(data.kpis.checks_run, 1)).toFixed(1)} per evaluation
                </div>
              </div>
              <div className="text-[11px] font-serif italic text-[#7c6f64] dark:text-[#a89984] pt-2 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60">
                Rule violations detected
              </div>
            </div>

            {/* KPI 3 */}
            <div className="bg-white/90 dark:bg-[#32302f]/90 p-5 rounded-2xl sm:rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-serif font-bold uppercase tracking-wider text-[#98971a] dark:text-[#b8bb26]">
                  Acceptance Ratio
                </span>
                <div className="p-2 rounded-xl bg-[#98971a]/10 text-[#98971a] dark:text-[#b8bb26]">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>
              <div className="my-2">
                <div className="font-serif text-3xl sm:text-4xl font-bold text-[#98971a] dark:text-[#b8bb26] tabular-nums">
                  {formatRate(data.kpis.accept_rate)}
                </div>
                <div className="text-[11px] text-[#7c6f64] dark:text-[#a89984] mt-1 font-serif">
                  Author compliance consensus
                </div>
              </div>
              <div className="text-[11px] font-serif italic text-[#7c6f64] dark:text-[#a89984] pt-2 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60">
                Suggestions adopted in drafts
              </div>
            </div>

            {/* KPI 4 */}
            <div className="bg-white/90 dark:bg-[#32302f]/90 p-5 rounded-2xl sm:rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-serif font-bold uppercase tracking-wider text-[#458588] dark:text-[#83a598]">
                  Ambiguity Index
                </span>
                <button
                  type="button"
                  onClick={() => setShowFormulaModal(true)}
                  className="p-1.5 text-[#7c6f64] hover:text-[#282828] dark:hover:text-white rounded-lg hover:bg-[#f0eee9] dark:hover:bg-[#282828] cursor-pointer"
                  title="View Ambiguity Score calculation"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
              </div>
              <div className="my-2">
                <div className="font-serif text-3xl sm:text-4xl font-bold text-[#458588] dark:text-[#83a598] tabular-nums">
                  {formatRate(data.kpis.dismiss_rate)}
                </div>
                <div className="text-[11px] text-[#7c6f64] dark:text-[#a89984] mt-1 font-serif">
                  Rules under active dispute
                </div>
              </div>
              <div className="text-[11px] font-serif italic text-[#7c6f64] dark:text-[#a89984] pt-2 border-t border-[#e2e0dc]/50 dark:border-[#3c3836]/60">
                Guidelines requiring clarification
              </div>
            </div>
          </div>

          {/* Bento Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Most Violated Rules */}
            <div className="bg-white/90 dark:bg-[#32302f]/90 p-6 rounded-2xl sm:rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-serif text-base sm:text-lg font-bold text-[#282828] dark:text-white">
                    Top Policy Infringements
                  </h3>
                  <p className="text-xs font-serif italic text-[#7c6f64] dark:text-[#a89984] mt-0.5">
                    Highest frequency brand rule triggers
                  </p>
                </div>
                <span className="text-[10px] font-serif font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#f0eee9] dark:bg-[#282828] text-[#7c6f64] dark:text-[#a89984] border border-[#e2e0dc] dark:border-[#3c3836]">
                  Occurrences
                </span>
              </div>

              <div className="space-y-4">
                {data.most_violated_rules.map((rule) => {
                  const pct = Math.round((rule.count / maxViolation) * 100);
                  return (
                    <div key={rule.code} className="space-y-1.5">
                      <div className="flex items-baseline justify-between text-xs sm:text-sm">
                        <span className="font-medium text-[#282828] dark:text-[#ebdbb2]">
                          <span className="font-mono text-xs text-[#458588] dark:text-[#83a598] font-bold mr-2">[{rule.code}]</span>
                          <span className="font-serif font-semibold">{rule.title}</span>
                        </span>
                        <span className="font-serif font-bold tabular-nums text-[#282828] dark:text-white text-xs">{rule.count}</span>
                      </div>
                      <div className="w-full h-2.5 bg-[#f0eee9]/80 dark:bg-[#282828] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#458588] to-[#689d6a] dark:from-[#83a598] dark:to-[#8ec07c] rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="bg-white/90 dark:bg-[#32302f]/90 p-6 rounded-2xl sm:rounded-3xl border border-[#e2e0dc] dark:border-[#3c3836] shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-serif text-base sm:text-lg font-bold text-[#282828] dark:text-white">
                    Category Distribution
                  </h3>
                  <p className="text-xs font-serif italic text-[#7c6f64] dark:text-[#a89984] mt-0.5">
                    Proportion of findings across governance pillars
                  </p>
                </div>
                <span className="text-[10px] font-serif font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#f0eee9] dark:bg-[#282828] text-[#7c6f64] dark:text-[#a89984] border border-[#e2e0dc] dark:border-[#3c3836]">
                  Proportion
                </span>
              </div>

              <div className="space-y-4">
                {categoryTotals.map((cat) => (
                  <div key={cat.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="capitalize font-serif font-semibold text-[#282828] dark:text-[#ebdbb2]">
                        {cat.category.replace('_', ' ')}
                      </span>
                      <span className="tabular-nums font-serif text-xs text-[#7c6f64] dark:text-[#a89984]">{cat.percentage}% ({cat.count})</span>
                    </div>
                    <div className="w-full h-2.5 bg-[#f0eee9]/80 dark:bg-[#282828] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#504945] dark:bg-[#a89984] rounded-full transition-all duration-500"
                        style={{ width: `${cat.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Formula Modal */}
      {showFormulaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-100"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#282828] rounded-2xl sm:rounded-3xl max-w-md w-full p-6 shadow-2xl border border-[#e2e0dc] dark:border-[#3c3836] space-y-4">
            <div className="flex items-center justify-between border-b border-[#e2e0dc]/60 dark:border-[#3c3836] pb-3">
              <h4 className="font-serif text-lg font-bold text-[#282828] dark:text-white">
                Ambiguity Index Metric
              </h4>
              <button
                type="button"
                onClick={() => setShowFormulaModal(false)}
                className="text-[#7c6f64] hover:text-[#282828] dark:hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[#504945] dark:text-[#ebdbb2] text-xs sm:text-sm leading-relaxed font-serif">
              The Ambiguity Score measures rules where authors and editors frequently dispute, dismiss, or override suggestions. A high ambiguity index indicates guidelines that require editorial re-clarification in the Brand Library.
            </p>
            <div className="p-3 bg-[#f0eee9]/60 dark:bg-[#1d2021] rounded-xl border border-[#e2e0dc] dark:border-[#3c3836] text-xs font-mono text-[#282828] dark:text-[#ebdbb2]">
              <code>Ambiguity Rate = (Overridden + Dismissed) / Total Decisions * 100</code>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowFormulaModal(false)}
                className="px-4 py-2 rounded-xl bg-[#282828] dark:bg-[#f0eee9] text-white dark:text-[#1d2021] text-xs font-semibold cursor-pointer tap-interactive"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
