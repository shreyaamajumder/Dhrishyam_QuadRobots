// src/pages/InsightsPage.tsx
import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  HelpCircle,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  CheckCircle2,
  XCircle,
  BookOpen,
  Info,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { InsightsData } from '../types/domain';
import { Skeleton, InlineAlert } from '../components/shared/Primitives';

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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Governance Insights</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Identify repeat violations, track adoption velocity, and expose ambiguous brand guidelines.
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs shrink-0">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setPeriod(d)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                period === d ? 'bg-white text-indigo-700 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last {d} Days
            </button>
          ))}
        </div>
      </div>

      {error && <InlineAlert title="Error loading analytics" message={error} onRetry={loadInsights} />}

      {loading || !data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      ) : (
        <>
          {/* KPI Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 font-medium">Checks Run</span>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {data.kpis.checks_run}
              </div>
              <div className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                <span>+18% from last period</span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 font-medium">Total Findings Flagged</span>
              <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {data.kpis.total_findings}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Across 6 policy categories</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 font-medium">Suggestion Accept Rate</span>
              <div className="text-2xl font-bold text-emerald-600 mt-1 tabular-nums">
                {data.kpis.accept_rate !== null ? `${Math.round(data.kpis.accept_rate * 100)}%` : '—'}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Creators applied suggested fix</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-xs text-slate-500 font-medium">Dismissal Rate</span>
              <div className="text-2xl font-bold text-slate-700 mt-1 tabular-nums">
                {data.kpis.dismiss_rate !== null ? `${Math.round(data.kpis.dismiss_rate * 100)}%` : '—'}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Dismissed with logged reason</div>
            </div>
          </div>

          {/* Two-column charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Chart 1: Most Violated Rules */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Most Frequently Violated Rules</h3>
                  <p className="text-[11px] text-slate-500">Highest occurrence in submitted drafts</p>
                </div>
                <BarChart3 className="w-4 h-4 text-slate-400" />
              </div>

              <div className="space-y-3 pt-1">
                {data.most_violated_rules.map((rule) => {
                  const pct = Math.round((rule.count / maxViolation) * 100);
                  return (
                    <div key={rule.code} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-indigo-700">{rule.code}</span>
                        <span className="font-semibold text-slate-900 tabular-nums">{rule.count} times</span>
                      </div>
                      <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                        <div
                          className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{rule.title}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chart 2: Category Breakdown Over Time */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Violations by Category Over Time</h3>
                  <p className="text-[11px] text-slate-500">Weekly breakdown across active policy domains</p>
                </div>
              </div>

              {/* Stacked Bar Legend */}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 pt-1">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" /> Terminology
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Facts & Claims
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Tone
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> Accessibility
                </span>
              </div>

              {/* Stacked visualization */}
              <div className="space-y-3 pt-2">
                {data.category_over_time.map((item) => {
                  const total = item.terminology + item.facts_claims + item.tone + item.accessibility;
                  return (
                    <div key={item.period} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between text-[11px] text-slate-600">
                        <span className="font-medium">{item.period}</span>
                        <span className="font-mono">{total} total flags</span>
                      </div>
                      <div className="w-full bg-slate-100 h-4 rounded-lg flex overflow-hidden">
                        <div style={{ width: `${(item.terminology / total) * 100}%` }} className="bg-indigo-600 h-full" title={`Terminology: ${item.terminology}`} />
                        <div style={{ width: `${(item.facts_claims / total) * 100}%` }} className="bg-rose-500 h-full" title={`Facts & Claims: ${item.facts_claims}`} />
                        <div style={{ width: `${(item.tone / total) * 100}%` }} className="bg-amber-500 h-full" title={`Tone: ${item.tone}`} />
                        <div style={{ width: `${(item.accessibility / total) * 100}%` }} className="bg-sky-500 h-full" title={`Accessibility: ${item.accessibility}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Table: Rules That May Be Unclear (Clarity Score) */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Rules That May Be Unclear or In Dispute
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  High dismissal and override rates signal rules that writers repeatedly reject or dispute.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowFormulaModal(true)}
                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>How is Clarity Score calculated?</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
                  <tr>
                    <th scope="col" className="px-4 py-3">Rule Code & Title</th>
                    <th scope="col" className="px-4 py-3">Category</th>
                    <th scope="col" className="px-4 py-3">Decided Findings</th>
                    <th scope="col" className="px-4 py-3">Dismissal Rate</th>
                    <th scope="col" className="px-4 py-3">Override Rate</th>
                    <th scope="col" className="px-4 py-3">Clarity Risk Score</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-normal">
                  {data.unclear_rules.map((rule) => (
                    <tr
                      key={rule.entry_id}
                      onClick={() => navigate('library')}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-indigo-700">{rule.code}</div>
                        <div className="text-slate-800 font-medium mt-0.5">{rule.title}</div>
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-600">
                        {rule.category.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700">
                        {rule.findings_count}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700">
                        {Math.round(rule.dismissal_rate * 100)}%
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums text-slate-700">
                        {Math.round(rule.override_rate * 100)}%
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded text-xs tabular-nums ${
                            rule.clarity_score >= 0.5
                              ? 'bg-rose-100 text-rose-800'
                              : rule.clarity_score >= 0.2
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {rule.clarity_score.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {rule.may_be_unclear ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                            <AlertTriangle className="w-3 h-3 text-rose-600" />
                            May be unclear
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Clear policy
                          </span>
                        )}
                        {rule.conflicts_count > 0 && (
                          <span className="ml-1 text-[10px] text-amber-800 bg-amber-50 px-1 py-0.2 rounded">
                            {rule.conflicts_count} conflicts
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Clarity Score Explanation Modal */}
      {showFormulaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">
                Clarity Score Calculation
              </h3>
              <button
                type="button"
                onClick={() => setShowFormulaModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-700 leading-relaxed space-y-3">
              <p>
                The Clarity Score measures the ambiguity of a brand rule based on human decisions over the last 30 days:
              </p>
              <div className="p-3 bg-slate-100 rounded-lg font-mono text-[11px] text-slate-900">
                Clarity Risk = 0.6 × Dismissal Rate + 0.4 × Override Rate
              </div>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li><strong>Dismissal Rate:</strong> Percentage of times creators dismissed findings under this rule.</li>
                <li><strong>Override Rate:</strong> Percentage of times reviewers disagreed and manually overrode findings.</li>
                <li><strong>Threshold (0.50):</strong> Rules scoring 0.50 or higher are flagged as &ldquo;May be unclear&rdquo; because creators and reviewers frequently dispute them.</li>
              </ul>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowFormulaModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800"
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
