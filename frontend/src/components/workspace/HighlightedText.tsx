// src/components/workspace/HighlightedText.tsx
import React, { useMemo } from 'react';
import { Finding, Severity } from '../../types/domain';

interface HighlightedTextProps {
  text: string;
  findings: Finding[];
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string) => void;
}

interface TextSegment {
  start: number;
  end: number;
  slice: string;
  coveringFindings: Finding[];
}

const SEVERITY_PRIORITY: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  findings,
  selectedFindingId,
  onSelectFinding,
}) => {
  // Filter to active findings
  const activeFindings = useMemo(() => {
    return findings.filter((f) => {
      if (f.is_stale) return false;
      const latest = f.decisions[f.decisions.length - 1];
      if (latest && (latest.action === 'dismissed' || latest.action === 'overridden')) {
        return false;
      }
      return f.span_start >= 0 && f.span_end <= text.length && f.span_start < f.span_end;
    });
  }, [findings, text]);

  // Boundary-sweep segmentation for overlapping intervals
  const segments = useMemo<TextSegment[]>(() => {
    if (text.length === 0) return [];
    const pointsSet = new Set<number>([0, text.length]);
    for (const f of activeFindings) {
      pointsSet.add(Math.max(0, Math.min(text.length, f.span_start)));
      pointsSet.add(Math.max(0, Math.min(text.length, f.span_end)));
    }
    const points = Array.from(pointsSet).sort((a, b) => a - b);
    const result: TextSegment[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      if (start >= end) continue;
      const covering = activeFindings
        .filter((f) => f.span_start <= start && f.span_end >= end)
        .sort((a, b) => SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity]);

      result.push({
        start,
        end,
        slice: text.slice(start, end),
        coveringFindings: covering,
      });
    }
    return result;
  }, [text, activeFindings]);

  const getHighlightClasses = (primary: Finding, isSelected: boolean) => {
    const latestDecision = primary.decisions[primary.decisions.length - 1];
    if (latestDecision?.action === 'accepted' || latestDecision?.action === 'edited') {
      return `bg-emerald-50 text-emerald-950 underline decoration-emerald-600 decoration-solid decoration-2 ${
        isSelected ? 'ring-2 ring-emerald-600 rounded-xs' : ''
      }`;
    }

    switch (primary.severity) {
      case 'high':
        return `bg-rose-100/80 hover:bg-rose-200/80 text-slate-900 underline decoration-rose-600 decoration-wavy decoration-2 ${
          isSelected ? 'ring-2 ring-indigo-600 bg-rose-200 rounded-xs font-medium' : ''
        }`;
      case 'medium':
        return `bg-amber-100/80 hover:bg-amber-200/80 text-slate-900 underline decoration-amber-600 decoration-dashed decoration-2 ${
          isSelected ? 'ring-2 ring-indigo-600 bg-amber-200 rounded-xs font-medium' : ''
        }`;
      case 'low':
        return `bg-sky-100/80 hover:bg-sky-200/80 text-slate-900 underline decoration-sky-600 decoration-dotted decoration-2 ${
          isSelected ? 'ring-2 ring-indigo-600 bg-sky-200 rounded-xs font-medium' : ''
        }`;
    }
  };

  return (
    <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800 font-sans">
      {segments.map((seg, idx) => {
        if (seg.coveringFindings.length === 0) {
          return <React.Fragment key={idx}>{seg.slice}</React.Fragment>;
        }

        const primary = seg.coveringFindings[0];
        const isSelected = seg.coveringFindings.some((f) => f.id === selectedFindingId);

        return (
          <mark
            key={`${seg.start}-${seg.end}`}
            id={`doc-span-${primary.id}`}
            tabIndex={0}
            role="button"
            aria-label={`${primary.severity} severity finding (${primary.entry_code}): ${seg.slice}`}
            onClick={() => onSelectFinding(primary.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectFinding(primary.id);
              }
            }}
            className={`cursor-pointer px-0.5 py-0.5 rounded-xs transition-all ${getHighlightClasses(
              primary,
              isSelected
            )}`}
          >
            {seg.slice}
            {seg.coveringFindings.length > 1 && (
              <sup className="ml-0.5 px-1 py-0.2 text-[10px] font-mono font-bold bg-slate-800 text-white rounded">
                +{seg.coveringFindings.length - 1}
              </sup>
            )}
          </mark>
        );
      })}
    </div>
  );
};
