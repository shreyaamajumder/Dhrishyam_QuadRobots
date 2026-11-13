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
      return `bg-emerald-500/15 text-emerald-950 dark:text-emerald-200 underline decoration-emerald-500 decoration-solid decoration-2 ${
        isSelected ? 'ring-2 ring-emerald-500 rounded shadow-xs' : ''
      }`;
    }

    switch (primary.severity) {
      case 'high':
        return `bg-rose-500/15 hover:bg-rose-500/25 text-[#282828] dark:text-[#fbf1c7] underline decoration-rose-500 decoration-wavy decoration-2 ${
          isSelected ? 'ring-2 ring-[#36755a] dark:ring-[#8ec07c] bg-rose-500/30 rounded font-medium shadow-xs scale-[1.01]' : ''
        }`;
      case 'medium':
        return `bg-[#d65d0e]/15 hover:bg-[#d65d0e]/25 text-[#282828] dark:text-[#f5f5f4] underline decoration-[#d65d0e] decoration-dashed decoration-2 ${
          isSelected ? 'ring-2 ring-[#458588] bg-[#d65d0e]/30 rounded font-medium shadow-xs scale-[1.01]' : ''
        }`;
      case 'low':
        return `bg-[#35656d]/15 hover:bg-[#35656d]/25 text-[#282828] dark:text-[#fbf1c7] underline decoration-[#35656d] dark:decoration-[#83a598] decoration-dotted decoration-2 ${
          isSelected ? 'ring-2 ring-[#36755a] dark:ring-[#8ec07c] bg-[#35656d]/30 rounded font-medium shadow-xs scale-[1.01]' : ''
        }`;
    }
  };

  return (
    <div className="whitespace-pre-wrap text-[18px] sm:text-[19px] leading-[1.85] text-[#282828] dark:text-[#fbf1c7] font-serif selection:bg-[#458588]/25 selection:text-[#282828] dark:selection:bg-[#83a598]/30 dark:selection:text-[#f5f5f4] font-normal tracking-normal transition-colors">
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
            className={`cursor-pointer px-1 py-0.5 rounded-sm transition-all ${getHighlightClasses(
              primary,
              isSelected
            )}`}
          >
            {seg.slice}
            {seg.coveringFindings.length > 1 && (
              <sup className="ml-0.5 px-1 py-0.2 text-[10px] font-mono font-bold bg-slate-800 dark:bg-slate-700 text-white rounded">
                +{seg.coveringFindings.length - 1}
              </sup>
            )}
          </mark>
        );
      })}
    </div>
  );
};
