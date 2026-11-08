// src/utils/rulesEngine.ts
import {
  BrandEntry,
  ContentStatus,
  Finding,
  Role,
} from '../types/domain';

export interface GroundingGateCheckResult {
  passed: boolean;
  gate: string;
  reason?: string;
}

export function validateGroundingGate(
  candidate: {
    entry_code: string;
    category: string;
    span_text: string;
    suggestion: string;
  },
  docText: string,
  activeEntries: BrandEntry[],
  runManifestCodes: Set<string>,
  deterministicSpans: { start: number; end: number }[]
): GroundingGateCheckResult {
  // G1: Schema check (values exist)
  if (!candidate.entry_code || !candidate.category || !candidate.span_text || candidate.suggestion === undefined) {
    return { passed: false, gate: 'G1', reason: 'Missing required schema fields' };
  }

  // G2: entry code exists, is active, and is in run manifest
  const entry = activeEntries.find((e) => e.code === candidate.entry_code && e.is_active);
  if (!entry || !runManifestCodes.has(candidate.entry_code)) {
    return { passed: false, gate: 'G2', reason: `Entry ${candidate.entry_code} not active in manifest` };
  }

  // G3: span occurs verbatim in document
  const spanIndex = docText.indexOf(candidate.span_text);
  if (spanIndex === -1) {
    return { passed: false, gate: 'G3', reason: 'Span text does not occur verbatim in content' };
  }

  // G4: category matches entry category
  if (candidate.category !== entry.category) {
    return { passed: false, gate: 'G4', reason: `Category ${candidate.category} does not match entry ${entry.category}` };
  }

  // G5: suggestion non-empty, differs from span, minimal length <= 2*span + 20 chars
  const sugg = candidate.suggestion.trim();
  if (!sugg || sugg === candidate.span_text) {
    return { passed: false, gate: 'G5', reason: 'Suggestion is empty or identical to span' };
  }
  const maxAllowedLen = candidate.span_text.length * 2 + 20;
  if (sugg.length > maxAllowedLen) {
    return { passed: false, gate: 'G5', reason: 'Suggestion exceeds maximum minimal length bound' };
  }

  // G6: Self-lint: suggestion must not contain banned terms
  for (const other of activeEntries) {
    if (other.pattern?.banned && sugg.toLowerCase().includes(other.pattern.banned.toLowerCase())) {
      return { passed: false, gate: 'G6', reason: `Suggestion introduces banned term: "${other.pattern.banned}"` };
    }
  }

  // G7: Not a duplicate of a deterministic finding on the same span
  const spanEnd = spanIndex + candidate.span_text.length;
  const isDuplicate = deterministicSpans.some(
    (ds) => ds.start === spanIndex && ds.end === spanEnd
  );
  if (isDuplicate) {
    return { passed: false, gate: 'G7', reason: 'Deterministic finding already covers this exact span' };
  }

  return { passed: true, gate: 'ALL' };
}

/**
 * Shifts finding offsets after replacing text at a given span.
 * Marks findings that overlap the replaced region as stale.
 */
export function shiftFindingOffsets(
  findings: Finding[],
  appliedFindingId: string,
  oldStart: number,
  oldEnd: number,
  newText: string
): { updatedFindings: Finding[]; delta: number } {
  const delta = newText.length - (oldEnd - oldStart);

  const updatedFindings = findings.map((f) => {
    if (f.id === appliedFindingId) {
      return {
        ...f,
        span_end: f.span_start + newText.length,
        span_text: newText,
      };
    }

    // Subsequent non-overlapping finding: shift positions
    if (f.span_start >= oldEnd) {
      return {
        ...f,
        span_start: f.span_start + delta,
        span_end: f.span_end + delta,
      };
    }

    // Overlapping finding: mark stale because surrounding text changed
    if (f.span_end > oldStart && f.span_start < oldEnd) {
      return {
        ...f,
        is_stale: true,
      };
    }

    return f;
  });

  return { updatedFindings, delta };
}

/**
 * Calculates Clarity Score per SRS FR-INS-2:
 * 0.6 * dismissal_rate + 0.4 * override_rate
 */
export function calculateClarityScore(dismissalRate: number, overrideRate: number): number {
  const score = 0.6 * dismissalRate + 0.4 * overrideRate;
  return Number(score.toFixed(2));
}

/**
 * Validates status transitions per SRS Appendix A State Machine
 */
export function canTransitionStatus(
  from: ContentStatus,
  to: ContentStatus,
  actorRole: Role,
  isCreator: boolean,
  hasUndecidedHighFindings: boolean,
  hasComment = false
): { allowed: boolean; reason?: string } {
  // checked -> in_review (Creator submits)
  if (from === 'checked' && to === 'in_review') {
    if (hasUndecidedHighFindings) {
      return { allowed: false, reason: 'All High severity findings must have a decision before submission.' };
    }
    return { allowed: true };
  }

  // in_review -> changes_requested (Reviewer requests changes)
  if (from === 'in_review' && to === 'changes_requested') {
    if (isCreator) {
      return { allowed: false, reason: "You can't approve or review your own content." };
    }
    if (!hasComment) {
      return { allowed: false, reason: 'A comment is required when requesting changes.' };
    }
    return { allowed: true };
  }

  // in_review -> approved (Reviewer approves)
  if (from === 'in_review' && to === 'approved') {
    if (isCreator) {
      return { allowed: false, reason: "You can't approve or review your own content." };
    }
    return { allowed: true };
  }

  // changes_requested -> in_review (Creator resubmits)
  if (from === 'changes_requested' && to === 'in_review') {
    if (hasUndecidedHighFindings) {
      return { allowed: false, reason: 'All High severity findings must have a decision before submission.' };
    }
    return { allowed: true };
  }

  // Editing body in checked/changes_requested/approved reverts to draft
  if (['checked', 'changes_requested', 'approved'].includes(from) && to === 'draft') {
    return { allowed: true };
  }

  return { allowed: false, reason: `Invalid transition from ${from} to ${to}` };
}
