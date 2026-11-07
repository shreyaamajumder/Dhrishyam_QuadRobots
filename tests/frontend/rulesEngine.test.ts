// src/utils/rulesEngine.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGroundingGate,
  shiftFindingOffsets,
  calculateClarityScore,
  canTransitionStatus,
} from '../../frontend/src/utils/rulesEngine';
import { BrandEntry, Finding } from '../../frontend/src/types/domain';

const sampleEntries: BrandEntry[] = [
  {
    id: 'ent_1',
    org_id: 'org_1',
    code: 'R-TERM-001',
    entry_type: 'term',
    category: 'terminology',
    title: 'Brand name',
    body: 'Use AcmeCloud',
    check_mode: 'deterministic',
    pattern: { banned: 'Acme Cloud', preferred: 'AcmeCloud' },
    severity_default: 'medium',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-01',
    updated_by_name: 'Admin',
  },
  {
    id: 'ent_2',
    org_id: 'org_1',
    code: 'R-TONE-003',
    entry_type: 'rule',
    category: 'tone',
    title: 'Calm tone',
    body: 'Avoid alarmist language',
    check_mode: 'llm',
    severity_default: 'medium',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-01',
    updated_by_name: 'Admin',
  },
];

test('Grounding Gate passes valid candidate', () => {
  const result = validateGroundingGate(
    {
      entry_code: 'R-TONE-003',
      category: 'tone',
      span_text: 'catastrophic failure',
      suggestion: 'unexpected latency',
    },
    'This is a catastrophic failure in testing',
    sampleEntries,
    new Set(['R-TONE-003']),
    []
  );
  assert.equal(result.passed, true);
});

test('Grounding Gate G2 rejects unmanifested or inactive rule code', () => {
  const result = validateGroundingGate(
    {
      entry_code: 'R-HALLUCINATED-999',
      category: 'tone',
      span_text: 'catastrophic failure',
      suggestion: 'latency',
    },
    'This is a catastrophic failure',
    sampleEntries,
    new Set(['R-TONE-003']),
    []
  );
  assert.equal(result.passed, false);
  assert.equal(result.gate, 'G2');
});

test('Grounding Gate G3 rejects non-verbatim span', () => {
  const result = validateGroundingGate(
    {
      entry_code: 'R-TONE-003',
      category: 'tone',
      span_text: 'total destruction',
      suggestion: 'latency',
    },
    'This is a catastrophic failure',
    sampleEntries,
    new Set(['R-TONE-003']),
    []
  );
  assert.equal(result.passed, false);
  assert.equal(result.gate, 'G3');
});

test('Grounding Gate G6 self-lint rejects suggestion introducing banned term', () => {
  const result = validateGroundingGate(
    {
      entry_code: 'R-TONE-003',
      category: 'tone',
      span_text: 'catastrophic failure',
      suggestion: 'upgrade to Acme Cloud immediately',
    },
    'This is a catastrophic failure',
    sampleEntries,
    new Set(['R-TONE-003']),
    []
  );
  assert.equal(result.passed, false);
  assert.equal(result.gate, 'G6');
});

test('shiftFindingOffsets shifts subsequent positions accurately and marks overlapping stale', () => {
  const mockFindings: Finding[] = [
    {
      id: 'f1',
      check_run_id: 'r1',
      content_version_no: 1,
      category: 'terminology',
      severity: 'medium',
      source_type: 'rule_engine',
      entry_id: 'ent_1',
      entry_code: 'R-TERM-001',
      entry_title: 'Brand name',
      entry_body: '',
      entry_version: 1,
      span_start: 5,
      span_end: 15,
      span_text: 'Acme Cloud',
      explanation: '',
      suggestion_text: 'AcmeCloud',
      confidence: 'high',
      label: 'issue',
      decisions: [],
    },
    {
      id: 'f2',
      check_run_id: 'r1',
      content_version_no: 1,
      category: 'tone',
      severity: 'high',
      source_type: 'ai',
      entry_id: 'ent_2',
      entry_code: 'R-TONE-003',
      entry_title: 'Calm tone',
      entry_body: '',
      entry_version: 1,
      span_start: 30,
      span_end: 45,
      span_text: 'destroy pipeline',
      explanation: '',
      suggestion_text: 'introduce latency',
      confidence: 'high',
      label: 'issue',
      decisions: [],
    },
  ];

  // Replacing 'Acme Cloud' (len 10) with 'AcmeCloud' (len 9), delta = -1
  const { updatedFindings, delta } = shiftFindingOffsets(mockFindings, 'f1', 5, 15, 'AcmeCloud');
  assert.equal(delta, -1);
  const f2 = updatedFindings.find((f) => f.id === 'f2');
  assert.equal(f2?.span_start, 29);
  assert.equal(f2?.span_end, 44);
});

test('calculateClarityScore returns weighted formula 0.6*dismissal + 0.4*override', () => {
  // 0.6 * 0.50 + 0.4 * 0.40 = 0.30 + 0.16 = 0.46
  assert.equal(calculateClarityScore(0.5, 0.4), 0.46);
  // 0.6 * 0.57 + 0.4 * 0.5 = 0.342 + 0.2 = 0.542 -> 0.54
  assert.equal(calculateClarityScore(0.57, 0.5), 0.54);
});

test('canTransitionStatus enforces submission guards and self-approval block', () => {
  // Creator cannot submit with undecided High findings
  const submitWithHigh = canTransitionStatus('checked', 'in_review', 'creator', true, true);
  assert.equal(submitWithHigh.allowed, false);

  // Creator can submit when all High are decided
  const submitClean = canTransitionStatus('checked', 'in_review', 'creator', true, false);
  assert.equal(submitClean.allowed, true);

  // Creator cannot approve own content
  const selfApprove = canTransitionStatus('in_review', 'approved', 'reviewer', true, false);
  assert.equal(selfApprove.allowed, false);

  // Non-creator reviewer can approve
  const validApprove = canTransitionStatus('in_review', 'approved', 'reviewer', false, false);
  assert.equal(validApprove.allowed, true);

  // Requesting changes requires a comment
  const reqChangesNoComment = canTransitionStatus('in_review', 'changes_requested', 'reviewer', false, false, false);
  assert.equal(reqChangesNoComment.allowed, false);

  const reqChangesWithComment = canTransitionStatus('in_review', 'changes_requested', 'reviewer', false, false, true);
  assert.equal(reqChangesWithComment.allowed, true);
});
