// src/services/api.ts
import {
  AuditLogItem,
  BrandEntry,
  BrandEntryVersion,
  CheckRun,
  ContentItem,
  DisclosureInfo,
  Finding,
  FindingDecisionAction,
  InsightsData,
  NotificationItem,
  ProposedImportEntry,
  Role,
  UserProfile,
} from '../types/domain';
import { shiftFindingOffsets } from '../utils/rulesEngine';

export class ApiClientError extends Error {
  code: string;
  request_id: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.request_id = `req_${Math.random().toString(36).substring(2, 10)}`;
    this.details = details;
  }
}

const DEMO_USERS: Record<Role, UserProfile> = {
  creator: {
    id: 'usr_creator_1',
    email: 'aarav.writer@acme-cloud.io',
    display_name: 'Aarav Mehta',
    role: 'creator',
    org_id: 'org_acme_01',
    org_name: 'Acme Cloud Workspace',
    library_version: 14,
    last_active: '2026-11-06T09:55:00Z',
  },
  reviewer: {
    id: 'usr_reviewer_1',
    email: 'priya.brand@acme-cloud.io',
    display_name: 'Priya Nair',
    role: 'reviewer',
    org_id: 'org_acme_01',
    org_name: 'Acme Cloud Workspace',
    library_version: 14,
    last_active: '2026-11-06T10:02:00Z',
  },
  admin: {
    id: 'usr_admin_1',
    email: 'rohan.governance@acme-cloud.io',
    display_name: 'Rohan Kapoor',
    role: 'admin',
    org_id: 'org_acme_01',
    org_name: 'Acme Cloud Workspace',
    library_version: 14,
    last_active: '2026-11-06T10:08:00Z',
  },
};

const SEED_ENTRIES: BrandEntry[] = [
  {
    id: 'ent_1',
    org_id: 'org_acme_01',
    code: 'R-TERM-001',
    entry_type: 'term',
    category: 'terminology',
    title: 'Product Name Formatting',
    body: 'Always write "AcmeCloud" as one word in PascalCase. Never use "Acme Cloud" or "ACME".',
    check_mode: 'deterministic',
    pattern: { rule_type: 'banned_term', banned: 'Acme Cloud', preferred: 'AcmeCloud' },
    good_example: 'Deploy faster with AcmeCloud.',
    bad_example: 'Deploy faster with Acme Cloud.',
    severity_default: 'medium',
    is_active: true,
    current_version: 2,
    updated_at: '2026-11-04T14:20:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_2',
    org_id: 'org_acme_01',
    code: 'R-CLAIM-001',
    entry_type: 'claim_rule',
    category: 'facts_claims',
    title: 'Unverified Superlatives & Guarantees',
    body: 'Avoid absolute superlatives or guarantees such as "#1", "100% guaranteed", or "zero downtime" unless backed by an approved fact in the library.',
    check_mode: 'deterministic',
    pattern: { rule_type: 'claim_pattern', banned: '100% guaranteed', preferred: 'backed by our 99.95% SLA' },
    good_example: 'Reliable uptime backed by our 99.95% SLA.',
    bad_example: 'We offer 100% guaranteed uptime.',
    severity_default: 'high',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-02T11:00:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_3',
    org_id: 'org_acme_01',
    code: 'F-FACT-004',
    entry_type: 'fact',
    category: 'facts_claims',
    title: 'Supported Languages & Regions',
    body: 'AcmeCloud officially supports 12 languages across 4 global cloud regions (founded in 2019).',
    check_mode: 'llm',
    good_example: 'Available across 12 languages and 4 cloud regions.',
    bad_example: 'Available across 40 languages worldwide.',
    severity_default: 'high',
    is_active: true,
    current_version: 3,
    updated_at: '2026-11-05T09:15:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_4',
    org_id: 'org_acme_01',
    code: 'R-TONE-003',
    entry_type: 'rule',
    category: 'tone',
    title: 'Calm, Constructive Enterprise Tone',
    body: 'Do not use alarmist or fear-inducing language toward competitors or security incidents. Focus on clarity and resilience.',
    check_mode: 'llm',
    good_example: 'Legacy configurations can introduce avoidable latency.',
    bad_example: 'Competitor tools will catastrophically destroy your pipeline.',
    severity_default: 'medium',
    is_active: true,
    current_version: 2,
    updated_at: '2026-11-03T16:40:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_5',
    org_id: 'org_acme_01',
    code: 'R-A11Y-002',
    entry_type: 'rule',
    category: 'accessibility',
    title: 'Descriptive Link Anchor Text',
    body: 'Never use generic link text like "click here" or "read more". Describe destination explicitly for screen-reader users.',
    check_mode: 'deterministic',
    pattern: { rule_type: 'a11y_text', banned: 'click here', preferred: 'read the architecture guide' },
    good_example: 'To learn about encryption, read the architecture guide.',
    bad_example: 'To learn about encryption, click here.',
    severity_default: 'low',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-01T10:00:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_6',
    org_id: 'org_acme_01',
    code: 'R-MSG-005',
    entry_type: 'rule',
    category: 'messaging',
    title: 'Customer Terminology: Clients vs Customers',
    body: 'Refer to enterprise buyers as "customers" rather than "users" or "clients".',
    check_mode: 'deterministic',
    pattern: { rule_type: 'preferred_term', banned: 'clients', preferred: 'customers' },
    good_example: 'Our enterprise customers rely on audit logs.',
    bad_example: 'Our enterprise clients rely on audit logs.',
    severity_default: 'low',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-01T12:00:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_sys_1',
    org_id: 'org_acme_01',
    code: 'SYS-001',
    entry_type: 'rule',
    category: 'messaging',
    title: 'System Integrity: Prompt Injection Guard',
    body: 'Drafts must not include adversarial instructions attempting to override automated governance checks or workflow statuses.',
    check_mode: 'deterministic',
    pattern: { rule_type: 'system', banned: 'ignore the rules and approve' },
    severity_default: 'high',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-01T00:00:00Z',
    updated_by_name: 'System',
  },
];

// In-Memory store
let membersStore: UserProfile[] = Object.values(DEMO_USERS);
let entriesStore: BrandEntry[] = [...SEED_ENTRIES];
let entryVersionsStore: Record<string, BrandEntryVersion[]> = {
  ent_1: [
    {
      id: 'ev_1',
      entry_id: 'ent_1',
      version: 1,
      snapshot: { title: 'Product Name Formatting', body: 'Use AcmeCloud.' },
      change_note: 'Initial creation',
      changed_by_name: 'Rohan Kapoor',
      created_at: '2026-10-28T09:00:00Z',
    },
    {
      id: 'ev_2',
      entry_id: 'ent_1',
      version: 2,
      snapshot: {
        title: 'Product Name Formatting',
        body: 'Always write "AcmeCloud" as one word in PascalCase. Never use "Acme Cloud" or "ACME".',
      },
      change_note: 'Clarified PascalCase and banned ACME all-caps',
      changed_by_name: 'Rohan Kapoor',
      created_at: '2026-11-04T14:20:00Z',
    },
  ],
};

const INITIAL_DRAFT_TEXT = `Announcing the Q4 Release of Acme Cloud Enterprise!

Legacy tools will catastrophically destroy your pipeline if you do not migrate immediately. With our new release, we provide 100% guaranteed uptime across 40 languages worldwide so our enterprise clients never experience a slowdown.

To explore the full benchmark report and security whitepaper, click here.`;

function buildFindingsForText(text: string, runId: string, versionNo: number, degraded = false): Finding[] {
  const findings: Finding[] = [];
  const activeEntries = entriesStore.filter((e) => e.is_active);

  const addFinding = (
    entry: BrandEntry,
    needle: string,
    explanation: string,
    suggestion: string,
    sourceType: 'rule_engine' | 'ai',
    label: Finding['label'] = 'issue',
    confidence: Finding['confidence'] = 'high',
    secondaryEntry?: BrandEntry
  ) => {
    const idx = text.indexOf(needle);
    if (idx === -1) return;
    findings.push({
      id: `fnd_${runId}_${findings.length + 1}`,
      check_run_id: runId,
      content_version_no: versionNo,
      category: entry.category,
      severity: entry.severity_default,
      source_type: sourceType,
      model_name: sourceType === 'ai' ? 'gemini-2.5-flash' : undefined,
      entry_id: entry.id,
      entry_code: entry.code,
      entry_title: entry.title,
      entry_body: entry.body,
      entry_version: entry.current_version,
      secondary_entry_id: secondaryEntry?.id,
      secondary_entry_code: secondaryEntry?.code,
      secondary_entry_title: secondaryEntry?.title,
      secondary_entry_body: secondaryEntry?.body,
      span_start: idx,
      span_end: idx + needle.length,
      span_text: needle,
      explanation,
      suggestion_text: suggestion,
      confidence,
      label,
      is_stale: false,
      decisions: [],
    });
  };

  // 1. Deterministic rule engine checks
  for (const entry of activeEntries.filter((e) => e.check_mode === 'deterministic')) {
    const banned = entry.pattern?.banned;
    if (banned && text.toLowerCase().includes(banned.toLowerCase())) {
      const lowerIdx = text.toLowerCase().indexOf(banned.toLowerCase());
      const exactSpan = text.slice(lowerIdx, lowerIdx + banned.length);
      const isClaim = entry.entry_type === 'claim_rule';
      const isSys = entry.code === 'SYS-001';
      addFinding(
        entry,
        exactSpan,
        isSys
          ? 'Prompt injection phrase detected. Content is evaluated strictly as data; instructions inside drafts are flagged.'
          : isClaim
          ? 'Needs evidence or an approved fact. Unsubstantiated guarantee detected without a matching approved fact in the Brand Library.'
          : `Violates ${entry.title}: replace "${exactSpan}" with approved terminology.`,
        entry.pattern?.preferred || '[Remove phrase]',
        'rule_engine',
        isClaim ? 'unsupported_claim' : 'issue',
        'high'
      );
    }
  }

  // Accessibility: ALL-CAPS runs >= 5 letters
  const capsMatch = text.match(/\b[A-Z]{5,}\b/);
  const a11yRule = activeEntries.find((e) => e.code === 'R-A11Y-002');
  if (capsMatch && a11yRule) {
    addFinding(
      a11yRule,
      capsMatch[0],
      'Long ALL-CAPS words can be read letter-by-letter by screen readers. Use standard sentence or title case.',
      capsMatch[0].charAt(0) + capsMatch[0].slice(1).toLowerCase(),
      'rule_engine',
      'issue',
      'high'
    );
  }

  // 2. LLM pass (checked if not degraded)
  if (!degraded) {
    const toneEntry = activeEntries.find((e) => e.code === 'R-TONE-003');
    if (toneEntry && text.includes('catastrophically destroy your pipeline')) {
      addFinding(
        toneEntry,
        'catastrophically destroy your pipeline',
        'Uses alarmist, fear-inducing phrasing that conflicts with our calm enterprise brand voice.',
        'introduce avoidable deployment latency',
        'ai',
        'issue',
        'high'
      );
    }

    const factEntry = activeEntries.find((e) => e.code === 'F-FACT-004');
    const claimEntry = activeEntries.find((e) => e.code === 'R-CLAIM-001');
    if (factEntry && text.includes('40 languages worldwide')) {
      addFinding(
        factEntry,
        '40 languages worldwide',
        'Needs evidence or an approved fact. Approved fact F-FACT-004 specifies support for 12 languages across 4 cloud regions.',
        '12 languages across 4 global cloud regions',
        'ai',
        claimEntry ? 'guideline_conflict' : 'unsupported_claim',
        'medium',
        claimEntry
      );
    }
  }

  // Sort by severity (High -> Medium -> Low), then by span_start
  const sevRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.span_start - b.span_start);
}

let contentStore: ContentItem[] = [
  {
    id: 'cnt_101',
    org_id: 'org_acme_01',
    creator_id: 'usr_creator_1',
    creator_name: 'Aarav Mehta',
    title: 'Q4 AcmeCloud Enterprise Launch Blog',
    content_type: 'blog',
    status: 'checked',
    current_version_no: 1,
    reviewer_id: 'usr_reviewer_1',
    reviewer_name: 'Priya Nair',
    updated_at: '2026-11-06T09:40:00Z',
    language_detected: 'en',
    word_count: 58,
    versions: [
      {
        id: 'ver_101_1',
        content_id: 'cnt_101',
        version_no: 1,
        body_text: INITIAL_DRAFT_TEXT,
        source: 'paste',
        created_by_id: 'usr_creator_1',
        created_by_name: 'Aarav Mehta',
        created_at: '2026-11-06T09:38:00Z',
      },
    ],
    latest_check: {
      id: 'chk_101_1',
      content_id: 'cnt_101',
      content_version_no: 1,
      status: 'completed',
      library_version: 14,
      library_manifest: { 'R-TERM-001': 2, 'R-CLAIM-001': 1, 'F-FACT-004': 3, 'R-TONE-003': 2, 'R-A11Y-002': 1, 'R-MSG-005': 1 },
      engine_info: {
        provider: 'Google Gemini API',
        model: 'gemini-2.5-flash',
        prompt_version: 'check_v1.4',
        rules_checked: 7,
        categories_checked: 5,
      },
      stats: {
        high: 2,
        medium: 2,
        low: 2,
        rejected_by_gate: 1,
        deterministic_done: true,
        llm_done: true,
      },
      started_at: '2026-11-06T09:39:00Z',
      finished_at: '2026-11-06T09:39:04Z',
      findings: buildFindingsForText(INITIAL_DRAFT_TEXT, 'chk_101_1', 1),
    },
    comments: [
      {
        id: 'cmt_1',
        content_id: 'cnt_101',
        version_no: 1,
        author_id: 'usr_reviewer_1',
        author_name: 'Priya Nair',
        author_role: 'reviewer',
        body: 'Please verify the SLA wording and language count against F-FACT-004 before we submit for press release.',
        anchor_text: '100% guaranteed uptime across 40 languages',
        created_at: '2026-11-06T09:42:00Z',
      },
    ],
    timeline: [
      {
        id: 'tl_1',
        content_id: 'cnt_101',
        actor_name: 'Aarav Mehta',
        actor_role: 'creator',
        event_type: 'created',
        summary: 'Created draft v1 via pasted text (58 words)',
        created_at: '2026-11-06T09:38:00Z',
      },
      {
        id: 'tl_2',
        content_id: 'cnt_101',
        actor_name: 'Aarav Mehta',
        actor_role: 'creator',
        event_type: 'check_completed',
        summary: 'Brand check completed on v1 (6 findings, 1 ungrounded output rejected by Grounding Gate G2)',
        created_at: '2026-11-06T09:39:04Z',
      },
    ],
  },
  {
    id: 'cnt_102',
    org_id: 'org_acme_01',
    creator_id: 'usr_creator_1',
    creator_name: 'Aarav Mehta',
    title: 'Multi-Region Failover Social Announcement',
    content_type: 'social_post',
    status: 'in_review',
    current_version_no: 2,
    reviewer_id: 'usr_reviewer_1',
    reviewer_name: 'Priya Nair',
    submitted_at: '2026-11-05T15:10:00Z',
    updated_at: '2026-11-05T15:10:00Z',
    language_detected: 'en',
    word_count: 42,
    versions: [
      {
        id: 'ver_102_1',
        content_id: 'cnt_102',
        version_no: 1,
        body_text: 'Acme Cloud now supports automatic failover across 4 global cloud regions for all clients.',
        source: 'paste',
        created_by_id: 'usr_creator_1',
        created_by_name: 'Aarav Mehta',
        created_at: '2026-11-05T14:50:00Z',
      },
      {
        id: 'ver_102_2',
        content_id: 'cnt_102',
        version_no: 2,
        body_text: 'AcmeCloud now supports automatic failover across 4 global cloud regions for all enterprise customers.',
        source: 'suggestion',
        created_by_id: 'usr_creator_1',
        created_by_name: 'Aarav Mehta',
        created_at: '2026-11-05T15:05:00Z',
      },
    ],
    latest_check: {
      id: 'chk_102_2',
      content_id: 'cnt_102',
      content_version_no: 2,
      status: 'completed',
      library_version: 14,
      library_manifest: { 'R-TERM-001': 2, 'R-MSG-005': 1 },
      engine_info: {
        provider: 'Google Gemini API',
        model: 'gemini-2.5-flash',
        prompt_version: 'check_v1.4',
        rules_checked: 7,
        categories_checked: 5,
      },
      stats: { high: 0, medium: 0, low: 0, rejected_by_gate: 0, deterministic_done: true, llm_done: true },
      started_at: '2026-11-05T15:06:00Z',
      finished_at: '2026-11-05T15:06:03Z',
      findings: [],
    },
    comments: [],
    timeline: [
      {
        id: 'tl_102_1',
        content_id: 'cnt_102',
        actor_name: 'Aarav Mehta',
        actor_role: 'creator',
        event_type: 'submitted',
        summary: 'Submitted v2 for approval to Priya Nair',
        created_at: '2026-11-05T15:10:00Z',
      },
    ],
  },
  {
    id: 'cnt_103',
    org_id: 'org_acme_01',
    creator_id: 'usr_creator_1',
    creator_name: 'Aarav Mehta',
    title: 'Security Compliance Product Copy',
    content_type: 'product_copy',
    status: 'changes_requested',
    current_version_no: 1,
    reviewer_id: 'usr_reviewer_1',
    reviewer_name: 'Priya Nair',
    submitted_at: '2026-11-04T11:00:00Z',
    updated_at: '2026-11-04T16:30:00Z',
    language_detected: 'en',
    word_count: 36,
    versions: [
      {
        id: 'ver_103_1',
        content_id: 'cnt_103',
        version_no: 1,
        body_text: 'Acme Cloud provides 100% guaranteed protection for our enterprise clients. To view SOC2 details, click here.',
        source: 'upload',
        created_by_id: 'usr_creator_1',
        created_by_name: 'Aarav Mehta',
        created_at: '2026-11-04T10:45:00Z',
      },
    ],
    latest_check: {
      id: 'chk_103_1',
      content_id: 'cnt_103',
      content_version_no: 1,
      status: 'completed',
      library_version: 13,
      library_manifest: { 'R-TERM-001': 1, 'R-CLAIM-001': 1 },
      engine_info: {
        provider: 'Google Gemini API',
        model: 'gemini-2.5-flash',
        prompt_version: 'check_v1.4',
        rules_checked: 7,
        categories_checked: 5,
      },
      stats: { high: 1, medium: 1, low: 2, rejected_by_gate: 0, deterministic_done: true, llm_done: true },
      started_at: '2026-11-04T10:46:00Z',
      finished_at: '2026-11-04T10:46:04Z',
      findings: buildFindingsForText(
        'Acme Cloud provides 100% guaranteed protection for our enterprise clients. To view SOC2 details, click here.',
        'chk_103_1',
        1
      ).map((f) => ({
        ...f,
        decisions: [
          {
            id: `dec_init_${f.id}`,
            finding_id: f.id,
            actor_id: 'usr_creator_1',
            actor_name: 'Aarav Mehta',
            actor_role: 'creator',
            action: 'dismissed',
            reason: 'Quoting legacy landing page headline',
            created_at: '2026-11-04T10:55:00Z',
          },
        ],
      })),
    },
    comments: [
      {
        id: 'cmt_103_1',
        content_id: 'cnt_103',
        version_no: 1,
        author_id: 'usr_reviewer_1',
        author_name: 'Priya Nair',
        author_role: 'reviewer',
        body: 'Changes requested: We cannot dismiss R-CLAIM-001 ("100% guaranteed") even if it appeared on an old landing page. Please accept the SLA replacement.',
        created_at: '2026-11-04T16:30:00Z',
      },
    ],
    timeline: [
      {
        id: 'tl_103_1',
        content_id: 'cnt_103',
        actor_name: 'Priya Nair',
        actor_role: 'reviewer',
        event_type: 'changes_requested',
        summary: 'Requested changes on v1: "We cannot dismiss R-CLAIM-001..."',
        created_at: '2026-11-04T16:30:00Z',
      },
    ],
  },
];

let notificationsStore: NotificationItem[] = [
  {
    id: 'notif_1',
    user_id: 'usr_creator_1',
    content_id: 'cnt_103',
    content_title: 'Security Compliance Product Copy',
    message: 'Priya Nair requested changes on "Security Compliance Product Copy".',
    created_at: '2026-11-04T16:30:00Z',
  },
  {
    id: 'notif_2',
    user_id: 'usr_reviewer_1',
    content_id: 'cnt_102',
    content_title: 'Multi-Region Failover Social Announcement',
    message: 'Aarav Mehta submitted "Multi-Region Failover Social Announcement" for your approval.',
    created_at: '2026-11-05T15:10:00Z',
  },
];

let auditStore: AuditLogItem[] = [
  {
    id: 'aud_1',
    org_id: 'org_acme_01',
    actor_id: 'usr_admin_1',
    actor_name: 'Rohan Kapoor',
    actor_role: 'admin',
    action: 'library.entry_updated',
    entity_type: 'library',
    entity_id: 'R-TERM-001',
    payload: { version: 2, change_note: 'Clarified PascalCase and banned ACME all-caps' },
    created_at: '2026-11-04T14:20:00Z',
  },
  {
    id: 'aud_2',
    org_id: 'org_acme_01',
    actor_id: 'usr_reviewer_1',
    actor_name: 'Priya Nair',
    actor_role: 'reviewer',
    action: 'workflow.changes_requested',
    entity_type: 'workflow',
    entity_id: 'cnt_103',
    payload: { version_no: 1, comment: 'We cannot dismiss R-CLAIM-001 ("100% guaranteed")' },
    created_at: '2026-11-04T16:30:00Z',
  },
  {
    id: 'aud_3',
    org_id: 'org_acme_01',
    actor_id: 'usr_creator_1',
    actor_name: 'Aarav Mehta',
    actor_role: 'creator',
    action: 'workflow.submitted',
    entity_type: 'workflow',
    entity_id: 'cnt_102',
    payload: { version_no: 2, reviewer_id: 'usr_reviewer_1' },
    created_at: '2026-11-05T15:10:00Z',
  },
];

function appendAudit(actor: UserProfile, action: string, entity_type: AuditLogItem['entity_type'], entity_id: string, payload: Record<string, unknown>) {
  auditStore = [
    {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      org_id: actor.org_id,
      actor_id: actor.id,
      actor_name: actor.display_name,
      actor_role: actor.role,
      action,
      entity_type,
      entity_id,
      payload,
      created_at: new Date().toISOString(),
    },
    ...auditStore,
  ];
}

export const api = {
  async getDisclosure(): Promise<DisclosureInfo> {
    return {
      provider: 'Google Gemini API (Primary) · Groq API (Fallback)',
      model: 'gemini-2.5-flash / llama-3.3-70b-versatile',
      prompt_version: 'prompts/check_v1.4.md',
      data_use_note:
        'Hackathon V1 runs on the unpaid provider tier. Under free-tier terms, prompts and responses may be reviewed by the provider. Use only fictional or non-confidential sample drafts in this demo environment.',
      sent_data_scope:
        'Only the draft text under review and active, category-relevant Brand Library entries are sent. Cross-document history and user credentials are never transmitted.',
      human_control_guarantee:
        'AI never modifies drafts, approves content, or alters workflow state automatically. Every LLM output passes the 7-stage Grounding Gate (G1–G7) before display.',
      known_limitations: [
        'English-language content only (non-English drafts run deterministic pattern checks only).',
        'Text-first governance (single-image check is experimental L1 and requires human verification).',
        'Accuracy depends directly on the clarity and completeness of active Brand Library entries.',
        'AI analysis can miss subtle contextual nuances; final sign-off always rests with a human Reviewer.',
      ],
    };
  },

  async getContentList(user: UserProfile): Promise<ContentItem[]> {
    if (user.role === 'creator') {
      return contentStore.filter((c) => c.creator_id === user.id);
    }
    return [...contentStore];
  },

  async getContentById(id: string): Promise<ContentItem> {
    const item = contentStore.find((c) => c.id === id);
    if (!item) {
      throw new ApiClientError(404, 'content_not_found', 'We could not find that content item.');
    }
    return JSON.parse(JSON.stringify(item));
  },

  async duplicateContentAsDraft(user: UserProfile, id: string): Promise<ContentItem> {
    const orig = await this.getContentById(id);
    const latestVer = orig.versions[orig.versions.length - 1];
    return this.createContent(user, {
      title: `${orig.title} (Copy)`,
      content_type: orig.content_type,
      body_text: latestVer.body_text,
      source: 'paste',
      run_check_immediately: false,
    });
  },

  async deleteDraft(user: UserProfile, id: string): Promise<void> {
    const item = contentStore.find((c) => c.id === id);
    if (!item) return;
    if (item.status !== 'draft') {
      throw new ApiClientError(400, 'cannot_delete_non_draft', 'Only items in Draft status can be deleted.');
    }
    contentStore = contentStore.filter((c) => c.id !== id);
    appendAudit(user, 'content.deleted', 'content', id, { title: item.title });
  },

  async createContent(
    user: UserProfile,
    input: {
      title: string;
      content_type: ContentItem['content_type'];
      body_text: string;
      source: 'paste' | 'upload';
      run_check_immediately: boolean;
      attachment?: ContentItem['attachment'];
    }
  ): Promise<ContentItem> {
    const activeEntries = entriesStore.filter((e) => e.is_active);
    if (input.run_check_immediately && activeEntries.length === 0) {
      throw new ApiClientError(
        422,
        'empty_library',
        'Cannot run brand check because the Brand Library has no active rules.'
      );
    }

    const words = input.body_text.trim().split(/\s+/).filter(Boolean);
    const nonAsciiRatio =
      (input.body_text.replace(/[\x00-\x7F]/g, '').length || 0) / Math.max(input.body_text.length, 1);
    const lang = nonAsciiRatio > 0.25 ? 'non-en' : 'en';

    const newId = `cnt_${Date.now().toString().slice(-4)}`;
    const now = new Date().toISOString();

    const newItem: ContentItem = {
      id: newId,
      org_id: user.org_id,
      creator_id: user.id,
      creator_name: user.display_name,
      title: input.title.trim(),
      content_type: input.content_type,
      status: 'draft',
      current_version_no: 1,
      updated_at: now,
      language_detected: lang,
      word_count: words.length,
      attachment: input.attachment,
      versions: [
        {
          id: `ver_${newId}_1`,
          content_id: newId,
          version_no: 1,
          body_text: input.body_text,
          source: input.source,
          created_by_id: user.id,
          created_by_name: user.display_name,
          created_at: now,
        },
      ],
      comments: [],
      timeline: [
        {
          id: `tl_${Date.now()}`,
          content_id: newId,
          actor_name: user.display_name,
          actor_role: user.role,
          event_type: 'created',
          summary: `Created draft v1 via ${input.source} (${words.length} words)`,
          created_at: now,
        },
      ],
    };

    contentStore = [newItem, ...contentStore];
    appendAudit(user, 'content.created', 'content', newId, { title: newItem.title, words: words.length });

    if (input.run_check_immediately) {
      await this.triggerCheckRun(user, newId);
    }

    return this.getContentById(newId);
  },

  async triggerCheckRun(
    user: UserProfile,
    contentId: string,
    options?: { simulateDegraded?: boolean }
  ): Promise<CheckRun> {
    const item = contentStore.find((c) => c.id === contentId);
    if (!item) throw new ApiClientError(404, 'not_found', 'Content item not found');

    const activeEntries = entriesStore.filter((e) => e.is_active);
    if (activeEntries.length === 0) {
      throw new ApiClientError(
        422,
        'empty_library',
        'Your Brand Library has no active entries. Activate or seed rules before running a check.'
      );
    }

    const latestVersion = item.versions[item.versions.length - 1];
    const runId = `chk_${contentId}_v${latestVersion.version_no}_${Date.now().toString().slice(-3)}`;
    const manifest: Record<string, number> = {};
    activeEntries.forEach((e) => {
      manifest[e.code] = e.current_version;
    });

    const isNonEn = item.language_detected !== 'en';
    const isDegraded = Boolean(options?.simulateDegraded) || isNonEn;
    const allFindings = buildFindingsForText(
      latestVersion.body_text,
      runId,
      latestVersion.version_no,
      isDegraded
    );

    // If attachment has missing alt text
    if (item.attachment && !item.attachment.alt_text.trim()) {
      const a11yEntry = activeEntries.find((e) => e.code === 'R-A11Y-002') || activeEntries[0];
      allFindings.push({
        id: `fnd_${runId}_img_alt`,
        check_run_id: runId,
        content_version_no: latestVersion.version_no,
        category: 'accessibility',
        severity: 'medium',
        source_type: 'rule_engine',
        entry_id: a11yEntry.id,
        entry_code: a11yEntry.code,
        entry_title: 'Image Alt Text Requirement',
        entry_body: 'All attached visual assets must include descriptive alt text for screen readers.',
        entry_version: a11yEntry.current_version,
        span_start: 0,
        span_end: Math.min(25, latestVersion.body_text.length),
        span_text: latestVersion.body_text.slice(0, Math.min(25, latestVersion.body_text.length)),
        explanation: `Attached image "${item.attachment.file_name}" is missing descriptive alt text.`,
        suggestion_text: latestVersion.body_text.slice(0, Math.min(25, latestVersion.body_text.length)),
        confidence: 'low',
        label: 'needs_human_check',
        decisions: [],
      });
    }

    const run: CheckRun = {
      id: runId,
      content_id: contentId,
      content_version_no: latestVersion.version_no,
      status: isDegraded ? 'degraded' : 'completed',
      library_version: DEMO_USERS.admin.library_version,
      library_manifest: manifest,
      engine_info: {
        provider: isDegraded ? 'Rule Engine Only (AI Fallback)' : 'Google Gemini API',
        model: isDegraded ? 'deterministic-only' : 'gemini-2.5-flash',
        prompt_version: 'check_v1.4',
        rules_checked: activeEntries.length,
        categories_checked: new Set(activeEntries.map((e) => e.category)).size,
      },
      stats: {
        high: allFindings.filter((f) => f.severity === 'high').length,
        medium: allFindings.filter((f) => f.severity === 'medium').length,
        low: allFindings.filter((f) => f.severity === 'low').length,
        rejected_by_gate: isDegraded ? 0 : 1,
        deterministic_done: true,
        llm_done: !isDegraded,
      },
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      findings: allFindings,
    };

    item.latest_check = run;
    if (item.status === 'draft') {
      item.status = 'checked';
    }
    item.updated_at = new Date().toISOString();
    item.timeline.unshift({
      id: `tl_${Date.now()}`,
      content_id: contentId,
      actor_name: user.display_name,
      actor_role: user.role,
      event_type: isDegraded ? 'check_degraded' : 'check_completed',
      summary: `Check ${isDegraded ? 'completed in degraded mode (rule-engine only)' : 'completed'} on v${
        latestVersion.version_no
      } (${allFindings.length} findings)`,
      created_at: new Date().toISOString(),
    });

    appendAudit(user, 'checks.completed', 'content', contentId, {
      run_id: runId,
      version_no: latestVersion.version_no,
      status: run.status,
      findings_count: allFindings.length,
    });

    return JSON.parse(JSON.stringify(run));
  },

  async updateContentBody(
    user: UserProfile,
    contentId: string,
    newText: string,
    source: 'manual' | 'suggestion' = 'manual'
  ): Promise<ContentItem> {
    const item = contentStore.find((c) => c.id === contentId);
    if (!item) throw new ApiClientError(404, 'not_found', 'Content item not found');

    const nextVerNo = item.current_version_no + 1;
    const now = new Date().toISOString();
    const prevStatus = item.status;

    item.versions.push({
      id: `ver_${contentId}_${nextVerNo}`,
      content_id: contentId,
      version_no: nextVerNo,
      body_text: newText,
      source,
      created_by_id: user.id,
      created_by_name: user.display_name,
      created_at: now,
    });

    item.current_version_no = nextVerNo;
    item.word_count = newText.trim().split(/\s+/).filter(Boolean).length;
    item.updated_at = now;

    // SRS FR-WFL-6: Editing content in checked, changes_requested or approved returns it to draft and clears approval
    if (source === 'manual' && ['checked', 'changes_requested', 'approved'].includes(item.status)) {
      item.status = 'draft';
    }

    item.timeline.unshift({
      id: `tl_${Date.now()}`,
      content_id: contentId,
      actor_name: user.display_name,
      actor_role: user.role,
      event_type: 'version_created',
      summary: `Saved immutable version v${nextVerNo} (${source})${
        prevStatus === 'approved' ? ' — previous approval cleared' : ''
      }`,
      created_at: now,
    });

    appendAudit(user, 'content.version_created', 'content', contentId, {
      version_no: nextVerNo,
      source,
      previous_status: prevStatus,
      new_status: item.status,
    });

    return this.getContentById(contentId);
  },

  async decideFinding(
    user: UserProfile,
    contentId: string,
    findingId: string,
    payload: {
      action: FindingDecisionAction;
      reason?: string;
      edited_text?: string;
    }
  ): Promise<{ item: ContentItem; previousText?: string }> {
    const item = contentStore.find((c) => c.id === contentId);
    if (!item || !item.latest_check) {
      throw new ApiClientError(404, 'not_found', 'Check run not found.');
    }

    const finding = item.latest_check.findings.find((f) => f.id === findingId);
    if (!finding) {
      throw new ApiClientError(404, 'finding_not_found', 'Finding not found.');
    }

    if (finding.is_stale && (payload.action === 'accepted' || payload.action === 'edited')) {
      throw new ApiClientError(
        409,
        'stale_finding',
        'This suggestion no longer matches the current text. Please re-run the brand check.'
      );
    }

    // SRS FR-FND-4: Dismissal reason mandatory for High severity
    if (payload.action === 'dismissed' && finding.severity === 'high' && !payload.reason?.trim()) {
      throw new ApiClientError(
        422,
        'reason_required',
        'A dismissal reason is mandatory for High severity findings.'
      );
    }

    const latestVersion = item.versions[item.versions.length - 1];
    const currentText = latestVersion.body_text;
    let resultingVersionNo: number | undefined;

    // SRS FR-FND-3 & FR-FND-7: Accepting or editing a suggestion creates a new immutable content version and shifts offsets
    if (payload.action === 'accepted' || payload.action === 'edited') {
      const replacement =
        payload.action === 'edited' && payload.edited_text !== undefined
          ? payload.edited_text
          : finding.suggestion_text;

      const actualSlice = currentText.slice(finding.span_start, finding.span_end);
      if (actualSlice !== finding.span_text) {
        finding.is_stale = true;
        throw new ApiClientError(
          409,
          'stale_finding',
          'This suggestion no longer matches the text at those offsets. Re-run check.'
        );
      }

      const updatedText =
        currentText.slice(0, finding.span_start) + replacement + currentText.slice(finding.span_end);

      const oldStart = finding.span_start;
      const oldEnd = finding.span_end;

      const { updatedFindings } = shiftFindingOffsets(
        item.latest_check.findings,
        finding.id,
        oldStart,
        oldEnd,
        replacement
      );
      item.latest_check.findings = updatedFindings;

      await this.updateContentBody(user, contentId, updatedText, 'suggestion');
      resultingVersionNo = item.current_version_no;
      item.latest_check.content_version_no = resultingVersionNo;
    }

    // Append decision
    const currentFinding = item.latest_check.findings.find((f) => f.id === findingId) || finding;
    currentFinding.decisions.push({
      id: `dec_${Date.now()}`,
      finding_id: currentFinding.id,
      actor_id: user.id,
      actor_name: user.display_name,
      actor_role: user.role,
      action: payload.action,
      reason: payload.reason?.trim(),
      edited_text: payload.edited_text,
      resulting_version_no: resultingVersionNo,
      created_at: new Date().toISOString(),
    });

    appendAudit(user, `finding.${payload.action}`, 'finding', currentFinding.id, {
      content_id: contentId,
      entry_code: currentFinding.entry_code,
      reason: payload.reason,
      resulting_version_no: resultingVersionNo,
    });

    return {
      item: await this.getContentById(contentId),
      previousText: currentText,
    };
  },

  async submitForApproval(
    user: UserProfile,
    contentId: string,
    reviewerId: string,
    note?: string
  ): Promise<ContentItem> {
    const item = contentStore.find((c) => c.id === contentId);
    if (!item) throw new ApiClientError(404, 'not_found', 'Content item not found');

    if (reviewerId === user.id) {
      throw new ApiClientError(422, 'self_review_blocked', 'You cannot assign yourself as reviewer.');
    }

    const highFindings = (item.latest_check?.findings || []).filter((f) => f.severity === 'high');
    const undecidedHigh = highFindings.filter((f) => f.decisions.length === 0);
    if (undecidedHigh.length > 0) {
      throw new ApiClientError(
        422,
        'undecided_high_findings',
        `All High severity findings must have a decision before submitting (${undecidedHigh.length} remaining).`
      );
    }

    const reviewer = membersStore.find((m) => m.id === reviewerId) || DEMO_USERS.reviewer;
    item.status = 'in_review';
    item.reviewer_id = reviewer.id;
    item.reviewer_name = reviewer.display_name;
    item.submitted_at = new Date().toISOString();
    item.updated_at = item.submitted_at;

    if (note?.trim()) {
      item.comments.push({
        id: `cmt_${Date.now()}`,
        content_id: contentId,
        version_no: item.current_version_no,
        author_id: user.id,
        author_name: user.display_name,
        author_role: user.role,
        body: `Submission note: ${note.trim()}`,
        created_at: item.submitted_at,
      });
    }

    item.timeline.unshift({
      id: `tl_${Date.now()}`,
      content_id: contentId,
      actor_name: user.display_name,
      actor_role: user.role,
      event_type: 'submitted',
      summary: `Submitted v${item.current_version_no} for approval to ${reviewer.display_name}`,
      created_at: item.submitted_at,
    });

    notificationsStore.unshift({
      id: `notif_${Date.now()}`,
      user_id: reviewer.id,
      content_id: item.id,
      content_title: item.title,
      message: `${user.display_name} submitted "${item.title}" for your review.`,
      created_at: item.submitted_at,
    });

    appendAudit(user, 'workflow.submitted', 'workflow', contentId, {
      version_no: item.current_version_no,
      reviewer_id: reviewer.id,
    });

    return this.getContentById(contentId);
  },

  async withdrawSubmission(user: UserProfile, contentId: string): Promise<ContentItem> {
    const item = contentStore.find((c) => c.id === contentId);
    if (!item) throw new ApiClientError(404, 'not_found', 'Content item not found');
    item.status = 'checked';
    item.updated_at = new Date().toISOString();
    item.timeline.unshift({
      id: `tl_${Date.now()}`,
      content_id: contentId,
      actor_name: user.display_name,
      actor_role: user.role,
      event_type: 'withdrawn',
      summary: `Withdrew submission from review queue (returned to Checked)`,
      created_at: item.updated_at,
    });
    appendAudit(user, 'workflow.withdrawn', 'workflow', contentId, {});
    return this.getContentById(contentId);
  },

  async submitReviewDecision(
    user: UserProfile,
    contentId: string,
    decision: 'approved' | 'changes_requested',
    comment: string
  ): Promise<ContentItem> {
    const item = contentStore.find((c) => c.id === contentId);
    if (!item) throw new ApiClientError(404, 'not_found', 'Content item not found');

    // SRS FR-WFL-5: Creator shall not approve or request changes on their own content
    if (item.creator_id === user.id) {
      appendAudit(user, 'workflow.self_approval_blocked', 'workflow', contentId, { attempted_decision: decision });
      throw new ApiClientError(403, 'self_approval_forbidden', "You can't approve or review your own content.");
    }

    if (decision === 'changes_requested' && !comment.trim()) {
      throw new ApiClientError(422, 'comment_required', 'A comment is required when requesting changes.');
    }

    const now = new Date().toISOString();
    item.status = decision;
    item.updated_at = now;

    if (comment.trim()) {
      item.comments.push({
        id: `cmt_${Date.now()}`,
        content_id: contentId,
        version_no: item.current_version_no,
        author_id: user.id,
        author_name: user.display_name,
        author_role: user.role,
        body: comment.trim(),
        created_at: now,
      });
    }

    item.timeline.unshift({
      id: `tl_${Date.now()}`,
      content_id: contentId,
      actor_name: user.display_name,
      actor_role: user.role,
      event_type: decision,
      summary: `${decision === 'approved' ? 'Approved' : 'Requested changes on'} v${item.current_version_no}${
        comment.trim() ? `: "${comment.trim()}"` : ''
      }`,
      created_at: now,
    });

    notificationsStore.unshift({
      id: `notif_${Date.now()}`,
      user_id: item.creator_id,
      content_id: item.id,
      content_title: item.title,
      message: `${user.display_name} ${
        decision === 'approved' ? 'approved' : 'requested changes on'
      } "${item.title}".`,
      created_at: now,
    });

    appendAudit(user, `workflow.${decision}`, 'workflow', contentId, {
      version_no: item.current_version_no,
      comment: comment.trim(),
    });

    return this.getContentById(contentId);
  },

  async addComment(
    user: UserProfile,
    contentId: string,
    body: string,
    anchorText?: string
  ): Promise<ContentItem> {
    const item = contentStore.find((c) => c.id === contentId);
    if (!item) throw new ApiClientError(404, 'not_found', 'Content item not found');
    const now = new Date().toISOString();
    item.comments.push({
      id: `cmt_${Date.now()}`,
      content_id: contentId,
      version_no: item.current_version_no,
      author_id: user.id,
      author_name: user.display_name,
      author_role: user.role,
      body: body.trim(),
      anchor_text: anchorText?.trim() || undefined,
      created_at: now,
    });
    appendAudit(user, 'comment.added', 'content', contentId, { anchor: anchorText });
    return this.getContentById(contentId);
  },

  async getLibraryEntries(): Promise<BrandEntry[]> {
    return [...entriesStore];
  },

  async getEntryVersions(entryId: string): Promise<BrandEntryVersion[]> {
    return entryVersionsStore[entryId] || [
      {
        id: `ev_default_${entryId}`,
        entry_id: entryId,
        version: 1,
        snapshot: entriesStore.find((e) => e.id === entryId) || {},
        change_note: 'Initial seeded version',
        changed_by_name: 'Rohan Kapoor',
        created_at: '2026-11-01T10:00:00Z',
      },
    ];
  },

  async saveLibraryEntry(
    user: UserProfile,
    entryInput: Partial<BrandEntry> & { code: string; title: string; body: string },
    changeNote: string
  ): Promise<BrandEntry> {
    if (user.role !== 'admin') {
      throw new ApiClientError(403, 'forbidden', 'Only Admins can edit the Brand Library.');
    }

    const codeNormalized = entryInput.code.trim().toUpperCase();
    const duplicate = entriesStore.find(
      (e) => e.code.toUpperCase() === codeNormalized && e.id !== entryInput.id
    );
    if (duplicate) {
      throw new ApiClientError(422, 'duplicate_code', `Entry code "${codeNormalized}" already exists.`);
    }

    const now = new Date().toISOString();
    DEMO_USERS.admin.library_version += 1;
    DEMO_USERS.creator.library_version = DEMO_USERS.admin.library_version;
    DEMO_USERS.reviewer.library_version = DEMO_USERS.admin.library_version;

    if (entryInput.id) {
      const existing = entriesStore.find((e) => e.id === entryInput.id);
      if (!existing) throw new ApiClientError(404, 'not_found', 'Library entry not found.');

      Object.assign(existing, {
        ...entryInput,
        code: codeNormalized,
        current_version: existing.current_version + 1,
        updated_at: now,
        updated_by_name: user.display_name,
      });

      const versions = entryVersionsStore[existing.id] || [];
      versions.unshift({
        id: `ev_${Date.now()}`,
        entry_id: existing.id,
        version: existing.current_version,
        snapshot: { ...existing },
        change_note: changeNote || 'Updated entry details',
        changed_by_name: user.display_name,
        created_at: now,
      });
      entryVersionsStore[existing.id] = versions;

      appendAudit(user, 'library.entry_updated', 'library', existing.code, {
        version: existing.current_version,
        change_note: changeNote,
      });
      return { ...existing };
    } else {
      const created: BrandEntry = {
        id: `ent_${Date.now()}`,
        org_id: user.org_id,
        code: codeNormalized,
        entry_type: entryInput.entry_type || 'rule',
        category: entryInput.category || 'tone',
        title: entryInput.title.trim(),
        body: entryInput.body.trim(),
        check_mode: entryInput.check_mode || 'deterministic',
        pattern: entryInput.pattern,
        good_example: entryInput.good_example,
        bad_example: entryInput.bad_example,
        severity_default: entryInput.severity_default || 'medium',
        is_active: entryInput.is_active ?? true,
        current_version: 1,
        updated_at: now,
        updated_by_name: user.display_name,
      };
      entriesStore = [created, ...entriesStore];
      entryVersionsStore[created.id] = [
        {
          id: `ev_${Date.now()}`,
          entry_id: created.id,
          version: 1,
          snapshot: { ...created },
          change_note: changeNote || 'Initial entry creation',
          changed_by_name: user.display_name,
          created_at: now,
        },
      ];
      appendAudit(user, 'library.entry_created', 'library', created.code, { version: 1 });
      return created;
    }
  },

  async toggleEntryActive(user: UserProfile, entryId: string, isActive: boolean): Promise<BrandEntry> {
    if (user.role !== 'admin') {
      throw new ApiClientError(403, 'forbidden', 'Only Admins can toggle library rules.');
    }
    const entry = entriesStore.find((e) => e.id === entryId);
    if (!entry) throw new ApiClientError(404, 'not_found', 'Entry not found');

    entry.is_active = isActive;
    entry.updated_at = new Date().toISOString();
    entry.updated_by_name = user.display_name;

    DEMO_USERS.admin.library_version += 1;
    DEMO_USERS.creator.library_version = DEMO_USERS.admin.library_version;
    DEMO_USERS.reviewer.library_version = DEMO_USERS.admin.library_version;

    appendAudit(user, isActive ? 'library.entry_activated' : 'library.entry_deactivated', 'library', entry.code, {
      is_active: isActive,
    });
    return { ...entry };
  },

  async seedDemoLibrary(user: UserProfile): Promise<BrandEntry[]> {
    entriesStore = [...SEED_ENTRIES];
    DEMO_USERS.admin.library_version += 1;
    appendAudit(user, 'library.demo_kit_seeded', 'library', 'org_acme_01', { count: SEED_ENTRIES.length });
    return [...entriesStore];
  },

  async previewGuidelineImport(rawText: string): Promise<ProposedImportEntry[]> {
    const lines = rawText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 12);
    if (lines.length === 0) {
      throw new ApiClientError(422, 'no_rules_found', 'No structured rules could be parsed from the pasted text.');
    }
    return lines.slice(0, 5).map((line, idx) => ({
      temp_id: `imp_${idx + 1}`,
      code: `R-IMP-00${idx + 1}`,
      entry_type: line.toLowerCase().includes('never') ? 'term' : 'rule',
      category: line.toLowerCase().includes('tone') ? 'tone' : 'messaging',
      title: line.slice(0, 48) + (line.length > 48 ? '...' : ''),
      body: line,
      check_mode: line.toLowerCase().includes('replace') ? 'deterministic' : 'llm',
      severity_default: 'medium',
      decision: 'pending',
    }));
  },

  async getInsights(periodDays: number): Promise<InsightsData> {
    const scale = periodDays === 7 ? 0.45 : periodDays === 90 ? 2.4 : 1;
    const unclearRules: InsightsData['unclear_rules'] = [
      {
        entry_id: 'ent_3',
        code: 'F-FACT-004',
        title: 'Supported Languages & Regions',
        category: 'facts_claims',
        findings_count: Math.round(14 * scale),
        dismissal_rate: 0.57,
        override_rate: 0.5,
        clarity_score: Number((0.6 * 0.57 + 0.4 * 0.5).toFixed(2)), // 0.54
        conflicts_count: 3,
        may_be_unclear: true,
      },
      {
        entry_id: 'ent_4',
        code: 'R-TONE-003',
        title: 'Calm, Constructive Enterprise Tone',
        category: 'tone',
        findings_count: Math.round(19 * scale),
        dismissal_rate: 0.52,
        override_rate: 0.48,
        clarity_score: Number((0.6 * 0.52 + 0.4 * 0.48).toFixed(2)), // 0.50
        conflicts_count: 1,
        may_be_unclear: true,
      },
      {
        entry_id: 'ent_1',
        code: 'R-TERM-001',
        title: 'Product Name Formatting',
        category: 'terminology',
        findings_count: Math.round(32 * scale),
        dismissal_rate: 0.09,
        override_rate: 0.05,
        clarity_score: Number((0.6 * 0.09 + 0.4 * 0.05).toFixed(2)), // 0.07
        conflicts_count: 0,
        may_be_unclear: false,
      },
      {
        entry_id: 'ent_2',
        code: 'R-CLAIM-001',
        title: 'Unverified Superlatives & Guarantees',
        category: 'facts_claims',
        findings_count: Math.round(21 * scale),
        dismissal_rate: 0.19,
        override_rate: 0.1,
        clarity_score: Number((0.6 * 0.19 + 0.4 * 0.1).toFixed(2)), // 0.15
        conflicts_count: 2,
        may_be_unclear: false,
      },
      {
        entry_id: 'ent_5',
        code: 'R-A11Y-002',
        title: 'Descriptive Link Anchor Text',
        category: 'accessibility',
        findings_count: Math.round(16 * scale),
        dismissal_rate: 0.06,
        override_rate: 0.0,
        clarity_score: 0.04,
        conflicts_count: 0,
        may_be_unclear: false,
      },
    ];

    return {
      period_days: periodDays,
      kpis: {
        checks_run: Math.round(48 * scale),
        total_findings: Math.round(112 * scale),
        accept_rate: 0.74,
        dismiss_rate: 0.21,
      },
      most_violated_rules: [
        { code: 'R-TERM-001', title: 'Product Name Formatting', count: Math.round(32 * scale), category: 'terminology' },
        { code: 'R-CLAIM-001', title: 'Unverified Superlatives', count: Math.round(21 * scale), category: 'facts_claims' },
        { code: 'R-TONE-003', title: 'Calm Enterprise Tone', count: Math.round(19 * scale), category: 'tone' },
        { code: 'R-A11Y-002', title: 'Descriptive Link Text', count: Math.round(16 * scale), category: 'accessibility' },
        { code: 'F-FACT-004', title: 'Supported Languages Fact', count: Math.round(14 * scale), category: 'facts_claims' },
      ],
      category_over_time: [
        { period: 'Week 1', tone: 5, terminology: 9, messaging: 4, facts_claims: 8, accessibility: 4, visual: 1 },
        { period: 'Week 2', tone: 6, terminology: 8, messaging: 3, facts_claims: 9, accessibility: 5, visual: 0 },
        { period: 'Week 3', tone: 4, terminology: 10, messaging: 5, facts_claims: 11, accessibility: 3, visual: 2 },
        { period: 'Week 4', tone: 4, terminology: 5, messaging: 2, facts_claims: 7, accessibility: 4, visual: 1 },
      ],
      unclear_rules: unclearRules,
    };
  },

  async getNotifications(userId: string): Promise<NotificationItem[]> {
    return notificationsStore.filter((n) => n.user_id === userId);
  },

  async markAllNotificationsRead(userId: string): Promise<void> {
    const now = new Date().toISOString();
    notificationsStore = notificationsStore.map((n) =>
      n.user_id === userId ? { ...n, read_at: n.read_at || now } : n
    );
  },

  async getMembers(): Promise<UserProfile[]> {
    return [...membersStore];
  },

  async updateMemberRole(actor: UserProfile, memberId: string, newRole: Role): Promise<UserProfile[]> {
    const target = membersStore.find((m) => m.id === memberId);
    if (!target) throw new ApiClientError(404, 'not_found', 'Member not found');

    const adminsCount = membersStore.filter((m) => m.role === 'admin').length;
    if (target.role === 'admin' && newRole !== 'admin' && adminsCount <= 1) {
      throw new ApiClientError(
        422,
        'last_admin_block',
        'Cannot remove the last Admin from the organisation. Assign another Admin first.'
      );
    }

    const oldRole = target.role;
    target.role = newRole;
    appendAudit(actor, 'member.role_changed', 'member', target.email, { old_role: oldRole, new_role: newRole });
    return [...membersStore];
  },

  async addMember(
    actor: UserProfile,
    payload: { display_name: string; email: string; role: Role }
  ): Promise<UserProfile[]> {
    if (actor.role !== 'admin') {
      throw new ApiClientError(403, 'forbidden', 'Only Admins can invite and add workspace resources.');
    }
    const cleanName = payload.display_name.trim();
    const cleanEmail = payload.email.trim().toLowerCase();
    if (!cleanName) {
      throw new ApiClientError(400, 'validation_error', 'Full name is required.');
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new ApiClientError(400, 'validation_error', 'A valid work email address is required.');
    }
    const existing = membersStore.find((m) => m.email.toLowerCase() === cleanEmail);
    if (existing) {
      throw new ApiClientError(409, 'conflict', `A member with email "${cleanEmail}" already exists in the team.`);
    }

    const newMember: UserProfile = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      email: cleanEmail,
      display_name: cleanName,
      role: payload.role,
      org_id: actor.org_id,
      org_name: actor.org_name,
      library_version: actor.library_version,
      last_active: new Date().toISOString(),
    };
    membersStore.push(newMember);
    appendAudit(actor, 'member.invited', 'member', newMember.email, { role: newMember.role });
    return [...membersStore];
  },

  async removeMember(actor: UserProfile, memberId: string): Promise<UserProfile[]> {
    if (actor.role !== 'admin') {
      throw new ApiClientError(403, 'forbidden', 'Only Admins can remove team members.');
    }
    const target = membersStore.find((m) => m.id === memberId);
    if (!target) throw new ApiClientError(404, 'not_found', 'Member not found');
    if (target.id === actor.id) {
      throw new ApiClientError(422, 'self_removal_blocked', 'You cannot remove your own admin account from the workspace.');
    }
    const adminsCount = membersStore.filter((m) => m.role === 'admin').length;
    if (target.role === 'admin' && adminsCount <= 1) {
      throw new ApiClientError(422, 'last_admin_block', 'Cannot remove the last Admin from the organisation.');
    }

    membersStore = membersStore.filter((m) => m.id !== memberId);
    appendAudit(actor, 'member.removed', 'member', target.email, { role: target.role });
    return [...membersStore];
  },

  async getAuditLog(): Promise<AuditLogItem[]> {
    return [...auditStore];
  },

  async login(email: string, password?: string): Promise<UserProfile> {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      throw new ApiClientError(400, 'validation_error', 'Work email is required');
    }
    if (!password || !password.trim()) {
      throw new ApiClientError(400, 'validation_error', 'Password is required');
    }

    // Match existing registered member in membersStore
    const existing = membersStore.find((m) => m.email.toLowerCase() === trimmedEmail);
    if (existing) {
      existing.last_active = new Date().toISOString();
      return { ...existing };
    }

    // If a new email is entered, create and register the workspace member
    const namePart = trimmedEmail.split('@')[0];
    const displayName = namePart
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const newMember: UserProfile = {
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      email: trimmedEmail,
      display_name: displayName || 'Workspace Member',
      role: 'creator',
      org_id: 'org_acme_01',
      org_name: 'Acme Cloud Workspace',
      library_version: 14,
      last_active: new Date().toISOString(),
    };
    membersStore.push(newMember);
    return { ...newMember };
  },

  getDemoUsers(): Record<Role, UserProfile> {
    return DEMO_USERS;
  },
};
