// src/services/api.ts
/**
 * Dhrishyam API Client Service.
 * Connects the React SPA to the FastAPI Backend (/api/v1).
 * Supports automatic token injection, polling check runs, and offline graceful fallback.
 */

import {
  AddMemberPayload,
  AuditLogItem,
  AuthTokenResponse,
  BrandEntry,
  BrandEntryVersion,
  CheckRun,
  ContentItem,
  ContentType,
  DisclosureInfo,
  Finding,
  FindingDecision,
  FindingDecisionAction,
  InsightsData,
  NotificationItem,
  ProposedImportEntry,
  RegisterBrandPayload,
  Role,
  TenantSummary,
  UserProfile,
} from '../types/domain';
import { shiftFindingOffsets } from '../utils/rulesEngine';
import { supabase } from './supabase';

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
    id: '10000000-0000-0000-0000-000000000001',
    email: 'aarav.writer@acme-cloud.io',
    display_name: 'Aarav Mehta',
    role: 'creator',
    org_id: '00000000-0000-0000-0000-000000000001',
    org_name: 'Acme Cloud Workspace',
    library_version: 1,
    last_active: '2026-11-06T09:55:00Z',
  },
  reviewer: {
    id: '10000000-0000-0000-0000-000000000002',
    email: 'priya.brand@acme-cloud.io',
    display_name: 'Priya Nair',
    role: 'reviewer',
    org_id: '00000000-0000-0000-0000-000000000001',
    org_name: 'Acme Cloud Workspace',
    library_version: 1,
    last_active: '2026-11-06T10:02:00Z',
  },
  admin: {
    id: '10000000-0000-0000-0000-000000000003',
    email: 'rohan.governance@acme-cloud.io',
    display_name: 'Rohan Kapoor',
    role: 'admin',
    org_id: '00000000-0000-0000-0000-000000000001',
    org_name: 'Acme Cloud Workspace',
    library_version: 1,
    last_active: '2026-11-06T10:08:00Z',
  },
};

const API_BASE = (
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL !== undefined)
    ? import.meta.env.VITE_API_URL
    : ''
).replace(/\/+$/, '') + '/api/v1';

function getStoredUser(): UserProfile | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('dhrishyam_user');
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

function rethrowIfHttpError(err: unknown): void {
  if (err instanceof ApiClientError && err.status !== 0) {
    throw err;
  }
}

/**
 * The token sent to the backend: the current Supabase access token when real sign-in is
 * configured (Supabase refreshes it automatically), otherwise the demo token for the role.
 */
async function authToken(activeUser?: UserProfile | null): Promise<string | null> {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
  const role = activeUser?.role || 'creator';
  const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('dhrishyam_token') : null;
  return storedToken || `demo-${role}-token`;
}

/** Fetches a protected file (a stored picture) and returns a URL the browser can show. */
async function requestBlobUrl(endpoint: string, user?: UserProfile | null): Promise<string> {
  const activeUser = user ?? getStoredUser();
  const headers = new Headers();
  const token = await authToken(activeUser);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (activeUser?.org_id) headers.set('X-Org-Id', activeUser.org_id);
  const response = await fetch(`${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`, { headers });
  if (!response.ok) {
    throw new ApiClientError(response.status, 'api_error', 'The image could not be loaded.');
  }
  return URL.createObjectURL(await response.blob());
}

const ACTIVE_ORG_KEY = 'dhrishyam_active_org';
const PENDING_BRAND_KEY = 'dhrishyam_pending_brand';

function rememberActiveOrg(orgId: string | undefined): void {
  try {
    if (orgId) localStorage.setItem(ACTIVE_ORG_KEY, orgId);
  } catch {
    // Ignore
  }
}

function friendlyAuthError(message: string): string {
  if (message === 'Invalid login credentials') return 'Incorrect email or password.';
  if (message === 'Email not confirmed') return 'Please confirm your email address first: check your inbox for the link.';
  return message;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  user?: UserProfile | null
): Promise<T> {
  const activeUser = user ?? getStoredUser();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Inject Authorization Bearer token
  if (!headers.has('Authorization')) {
    const token = await authToken(activeUser);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  if (activeUser?.org_id && !headers.has('X-Org-Id')) {
    headers.set('X-Org-Id', activeUser.org_id);
  }

  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (netErr: unknown) {
    const msg = netErr instanceof Error ? netErr.message : 'Network request failed';
    throw new ApiClientError(0, 'network_error', `Backend connection failed (${msg}).`);
  }

  if (!response.ok) {
    let errCode = 'api_error';
    let errMsg = `Request failed with status ${response.status}`;
    let errDetails: Record<string, unknown> | undefined;

    try {
      const data = await response.json();
      if (data.detail) {
        errMsg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
        errCode = 'validation_error';
      } else if (data.error) {
        errMsg = data.error.message || errMsg;
        errCode = data.error.code || errCode;
        errDetails = data.error.details;
      }
    } catch {
      // Ignore JSON parse failure
    }

    throw new ApiClientError(response.status, errCode, errMsg, errDetails);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export const SEEDED_ACME_WORKSPACE: TenantSummary = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Acme Cloud Workspace',
  role: 'admin',
  library_version: 1,
  org_id: '00000000-0000-0000-0000-000000000001',
  org_name: 'Acme Cloud Workspace',
};

// In-Memory store for offline fallback
let tenantsStore: TenantSummary[] = [SEEDED_ACME_WORKSPACE];
let offlinePasswordsStore: Record<string, string> = {
  'aarav.writer@acme-cloud.io': 'Password123!',
  'priya.reviewer@acme-cloud.io': 'Password123!',
  'priya.brand@acme-cloud.io': 'Password123!',
  'kabir.governance@acme-cloud.io': 'Password123!',
  'rohan.governance@acme-cloud.io': 'Password123!',
};
let membersStore: UserProfile[] = [
  ...Object.values(DEMO_USERS),
  {
    id: '10000000-0000-0000-0000-000000000004',
    email: 'priya.reviewer@acme-cloud.io',
    display_name: 'Priya Nair',
    role: 'reviewer',
    org_id: SEEDED_ACME_WORKSPACE.id,
    org_name: SEEDED_ACME_WORKSPACE.name,
    library_version: 1,
    last_active: '2026-11-06T10:02:00Z',
  },
  {
    id: '10000000-0000-0000-0000-000000000005',
    email: 'kabir.governance@acme-cloud.io',
    display_name: 'Kabir Governance',
    role: 'admin',
    org_id: SEEDED_ACME_WORKSPACE.id,
    org_name: SEEDED_ACME_WORKSPACE.name,
    library_version: 1,
    last_active: '2026-11-06T10:08:00Z',
  },
];

export const INITIAL_SEEDED_ENTRIES: BrandEntry[] = [
  {
    id: 'ent_001',
    org_id: SEEDED_ACME_WORKSPACE.id,
    code: 'R-TERM-001',
    entry_type: 'term',
    category: 'terminology',
    title: 'Product Brand Name Formatting',
    body: 'The official platform brand must be rendered as "Acme Cloud" with a space, never closed-compound as "AcmeCloud" or hyphenated.',
    check_mode: 'deterministic',
    pattern: { banned: 'AcmeCloud', preferred: 'Acme Cloud' },
    good_example: 'Scale seamlessly with Acme Cloud Enterprise.',
    bad_example: 'Scale seamlessly with AcmeCloud Enterprise.',
    severity_default: 'high',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-06T10:00:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_002',
    org_id: SEEDED_ACME_WORKSPACE.id,
    code: 'R-CLAIM-001',
    entry_type: 'claim_rule',
    category: 'facts_claims',
    title: 'Unverified Absolute SLA Guarantees',
    body: 'Absolute superlatives like "100% guaranteed uptime" violate regulatory and legal truth-in-advertising standards. Use verified multi-region SLA commitments (e.g., 99.99% SLA availability).',
    check_mode: 'deterministic',
    pattern: { banned: '100% guaranteed uptime', preferred: 'industry-leading 99.99% SLA commitment' },
    good_example: 'We provide an industry-leading 99.99% SLA commitment across global regions.',
    bad_example: 'We provide 100% guaranteed uptime across 40 languages worldwide.',
    severity_default: 'high',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-06T10:00:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_003',
    org_id: SEEDED_ACME_WORKSPACE.id,
    code: 'R-TONE-003',
    entry_type: 'rule',
    category: 'tone',
    title: 'Calm Objective Enterprise Tone',
    body: 'Avoid alarmist phrasing like "catastrophically destroy" or panic marketing. Maintain a calm, objective, authoritative engineering perspective.',
    check_mode: 'deterministic',
    pattern: { banned: 'catastrophically destroy', preferred: 'disrupt or degrade' },
    good_example: 'Legacy architectures may face operational degradation during failover.',
    bad_example: 'Legacy tools will catastrophically destroy your pipeline.',
    severity_default: 'medium',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-06T10:00:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_004',
    org_id: SEEDED_ACME_WORKSPACE.id,
    code: 'R-ACC-001',
    entry_type: 'rule',
    category: 'accessibility',
    title: 'Meaningful Hyperlink Context',
    body: 'Do not use generic anchor text like "click here". Provide descriptive hyperlink labels describing the destination asset for WCAG AA compliance.',
    check_mode: 'deterministic',
    pattern: { banned: 'click here', preferred: 'view the benchmark whitepaper' },
    good_example: 'To examine architecture specs, view the benchmark whitepaper.',
    bad_example: 'To explore the full benchmark report and security whitepaper, click here.',
    severity_default: 'medium',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-06T10:00:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_005',
    org_id: SEEDED_ACME_WORKSPACE.id,
    code: 'R-MSG-001',
    entry_type: 'rule',
    category: 'messaging',
    title: 'Mission Pillar: Open Interoperability',
    body: 'Reinforce customer sovereignty and open APIs rather than proprietary lock-in rhetoric.',
    check_mode: 'deterministic',
    pattern: { banned: 'proprietary lock-in', preferred: 'open standard portability' },
    good_example: 'Enjoy complete data sovereignty with open standard portability.',
    bad_example: 'Protect investments with proprietary lock-in.',
    severity_default: 'low',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-06T10:00:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
  {
    id: 'ent_006',
    org_id: SEEDED_ACME_WORKSPACE.id,
    code: 'R-VIS-001',
    entry_type: 'rule',
    category: 'visual',
    title: 'Optical Palette Hex Specifications',
    body: 'Digital brand collateral must utilize calibrated Cobalt (#2563eb) and Obsidian (#08090d). Non-compliant purple or generic gradients are prohibited.',
    check_mode: 'deterministic',
    severity_default: 'low',
    is_active: true,
    current_version: 1,
    updated_at: '2026-11-06T10:00:00Z',
    updated_by_name: 'Rohan Kapoor',
  },
];

export const INITIAL_SEEDED_CONTENT: ContentItem[] = [
  {
    id: 'cnt_101',
    org_id: SEEDED_ACME_WORKSPACE.id,
    creator_id: '10000000-0000-0000-0000-000000000001',
    creator_name: 'Aarav Mehta',
    title: 'Announcing the Q4 Release of Acme Cloud Enterprise',
    content_type: 'blog',
    status: 'checked',
    current_version_no: 1,
    reviewer_id: '10000000-0000-0000-0000-000000000002',
    reviewer_name: 'Priya Nair',
    updated_at: '2026-11-06T10:15:00Z',
    language_detected: 'en',
    word_count: 48,
    versions: [
      {
        id: 'ver_cnt_101_1',
        content_id: 'cnt_101',
        version_no: 1,
        body_text: `Announcing the Q4 Release of Acme Cloud Enterprise!\n\nLegacy tools will catastrophically destroy your pipeline if you do not migrate immediately. With our new release, we provide 100% guaranteed uptime across 40 languages worldwide so our enterprise clients never experience a slowdown.\n\nTo explore the full benchmark report and security whitepaper, click here.`,
        source: 'paste',
        created_by_id: '10000000-0000-0000-0000-000000000001',
        created_by_name: 'Aarav Mehta',
        created_at: '2026-11-06T10:10:00Z',
      },
    ],
    latest_check: {
      id: 'chk_101_1',
      content_id: 'cnt_101',
      content_version_no: 1,
      status: 'completed',
      library_version: 1,
      library_manifest: { 'R-TONE-003': 1, 'R-CLAIM-001': 1, 'R-ACC-001': 1 },
      engine_info: {
        provider: 'Google Gemini API',
        model: 'gemini-2.5-flash',
        prompt_version: 'check_v1.4',
        rules_checked: 45,
        categories_checked: 5,
      },
      stats: { high: 1, medium: 2, low: 0, rejected_by_gate: 0, deterministic_done: true, llm_done: true },
      started_at: '2026-11-06T10:11:00Z',
      finished_at: '2026-11-06T10:11:02Z',
      findings: [
        {
          id: 'fnd_101_1',
          check_run_id: 'chk_101_1',
          content_version_no: 1,
          category: 'tone',
          severity: 'medium',
          source_type: 'rule_engine',
          entry_id: 'ent_003',
          entry_code: 'R-TONE-003',
          entry_title: 'Calm Objective Enterprise Tone',
          entry_body: 'Avoid alarmist phrasing like "catastrophically destroy". Maintain an objective, calm, authoritative tone.',
          entry_version: 1,
          span_start: 71,
          span_end: 95,
          span_text: 'catastrophically destroy',
          explanation: 'Alarmist hyperbole undermines calm enterprise authority. Replace with measured operational terminology.',
          suggestion_text: 'disrupt or degrade',
          confidence: 'high',
          label: 'issue',
          decisions: [],
        },
        {
          id: 'fnd_101_2',
          check_run_id: 'chk_101_1',
          content_version_no: 1,
          category: 'facts_claims',
          severity: 'high',
          source_type: 'rule_engine',
          entry_id: 'ent_002',
          entry_code: 'R-CLAIM-001',
          entry_title: 'Unverified Absolute SLA Guarantees',
          entry_body: 'Absolute superlatives like "100% guaranteed uptime" violate regulatory and legal truth-in-advertising standards.',
          entry_version: 1,
          span_start: 178,
          span_end: 200,
          span_text: '100% guaranteed uptime',
          explanation: 'Unsubstantiated absolute claim exposes organization to legal and regulatory SLA liability. Specify verified SLA tier.',
          suggestion_text: 'industry-leading 99.99% SLA commitment',
          confidence: 'high',
          label: 'unsupported_claim',
          decisions: [],
        },
        {
          id: 'fnd_101_3',
          check_run_id: 'chk_101_1',
          content_version_no: 1,
          category: 'accessibility',
          severity: 'medium',
          source_type: 'rule_engine',
          entry_id: 'ent_004',
          entry_code: 'R-ACC-001',
          entry_title: 'Meaningful Hyperlink Context',
          entry_body: 'Do not use non-descriptive links like "click here". Provide context-rich link text describing destination.',
          entry_version: 1,
          span_start: 349,
          span_end: 359,
          span_text: 'click here',
          explanation: 'Non-descriptive anchor text fails WCAG AA screen reader navigation. Describe target destination.',
          suggestion_text: 'view the benchmark whitepaper',
          confidence: 'high',
          label: 'guideline_conflict',
          decisions: [],
        },
      ],
    },
    comments: [
      {
        id: 'cmt_101_1',
        content_id: 'cnt_101',
        version_no: 1,
        author_id: '10000000-0000-0000-0000-000000000002',
        author_name: 'Priya Nair',
        author_role: 'reviewer',
        body: 'Please accept the SLA commitment revision so we stay aligned with Legal before submittal.',
        anchor_text: '100% guaranteed uptime',
        created_at: '2026-11-06T10:14:00Z',
      },
    ],
    timeline: [
      {
        id: 'tl_101_1',
        content_id: 'cnt_101',
        actor_name: 'Aarav Mehta',
        actor_role: 'creator',
        event_type: 'created',
        summary: 'Created initial draft intake (48 words)',
        created_at: '2026-11-06T10:10:00Z',
      },
      {
        id: 'tl_101_2',
        content_id: 'cnt_101',
        actor_name: 'Dhrishyam AI Engine',
        actor_role: 'admin',
        event_type: 'check_run',
        summary: 'Automated check completed (3 findings detected)',
        created_at: '2026-11-06T10:11:00Z',
      },
    ],
  },
  {
    id: 'cnt_102',
    org_id: SEEDED_ACME_WORKSPACE.id,
    creator_id: '10000000-0000-0000-0000-000000000001',
    creator_name: 'Aarav Mehta',
    title: 'Global Infrastructure Architecture Whitepaper',
    content_type: 'blog',
    status: 'approved',
    current_version_no: 2,
    reviewer_id: '10000000-0000-0000-0000-000000000002',
    reviewer_name: 'Priya Nair',
    updated_at: '2026-11-06T10:05:00Z',
    language_detected: 'en',
    word_count: 245,
    versions: [
      {
        id: 'ver_cnt_102_2',
        content_id: 'cnt_102',
        version_no: 2,
        body_text: 'Acme Cloud delivers resilient, multi-region architecture engineered for fault-tolerant enterprise operations. With automated disaster recovery and sovereign data residency, engineering teams deploy with complete operational certainty.',
        source: 'manual',
        created_by_id: '10000000-0000-0000-0000-000000000001',
        created_by_name: 'Aarav Mehta',
        created_at: '2026-11-06T10:00:00Z',
      },
    ],
    latest_check: {
      id: 'chk_102_1',
      content_id: 'cnt_102',
      content_version_no: 2,
      status: 'completed',
      library_version: 1,
      library_manifest: { 'R-TERM-001': 1, 'R-CLAIM-001': 1 },
      engine_info: {
        provider: 'Google Gemini API',
        model: 'gemini-2.5-flash',
        prompt_version: 'check_v1.4',
        rules_checked: 45,
        categories_checked: 5,
      },
      stats: { high: 0, medium: 0, low: 0, rejected_by_gate: 0, deterministic_done: true, llm_done: true },
      started_at: '2026-11-06T10:01:00Z',
      finished_at: '2026-11-06T10:01:02Z',
      findings: [],
    },
    comments: [],
    timeline: [
      {
        id: 'tl_102_1',
        content_id: 'cnt_102',
        actor_name: 'Priya Nair',
        actor_role: 'reviewer',
        event_type: 'approved',
        summary: 'Certified copy as Brand Approved for public distribution',
        created_at: '2026-11-06T10:05:00Z',
      },
    ],
  },
  {
    id: 'cnt_103',
    org_id: SEEDED_ACME_WORKSPACE.id,
    creator_id: '10000000-0000-0000-0000-000000000001',
    creator_name: 'Aarav Mehta',
    title: 'Zero-Trust Cloud Governance Migration Guide',
    content_type: 'announcement',
    status: 'changes_requested',
    current_version_no: 1,
    reviewer_id: '10000000-0000-0000-0000-000000000002',
    reviewer_name: 'Priya Nair',
    updated_at: '2026-11-06T09:40:00Z',
    language_detected: 'en',
    word_count: 145,
    versions: [
      {
        id: 'ver_cnt_103_1',
        content_id: 'cnt_103',
        version_no: 1,
        body_text: 'Adopting Zero-Trust governance in modern enterprises requires strict role-based access control, cryptographic workload identity, and continuous posture verification across multi-cloud partitions.',
        source: 'paste',
        created_by_id: '10000000-0000-0000-0000-000000000001',
        created_by_name: 'Aarav Mehta',
        created_at: '2026-11-06T09:30:00Z',
      },
    ],
    comments: [
      {
        id: 'cmt_103_1',
        content_id: 'cnt_103',
        version_no: 1,
        author_id: '10000000-0000-0000-0000-000000000002',
        author_name: 'Priya Nair',
        author_role: 'reviewer',
        body: 'Please clarify the specific ISO 27001 cert requirements in paragraph 2 before approval.',
        created_at: '2026-11-06T09:40:00Z',
      },
    ],
    timeline: [
      {
        id: 'tl_103_1',
        content_id: 'cnt_103',
        actor_name: 'Priya Nair',
        actor_role: 'reviewer',
        event_type: 'changes_requested',
        summary: 'Requested revisions on compliance standards citation',
        created_at: '2026-11-06T09:40:00Z',
      },
    ],
  },
  {
    id: 'cnt_104',
    org_id: SEEDED_ACME_WORKSPACE.id,
    creator_id: '10000000-0000-0000-0000-000000000001',
    creator_name: 'Aarav Mehta',
    title: 'Q1 Multi-Region Product Launch Brief',
    content_type: 'product_copy',
    status: 'draft',
    current_version_no: 1,
    updated_at: '2026-11-06T09:15:00Z',
    language_detected: 'en',
    word_count: 85,
    versions: [
      {
        id: 'ver_cnt_104_1',
        content_id: 'cnt_104',
        version_no: 1,
        body_text: 'Accelerate cross-border deployments with Acme Cloud dedicated interconnect nodes. Low-latency streaming and high-throughput data sync across Frankfurt, Singapore, and North America.',
        source: 'paste',
        created_by_id: '10000000-0000-0000-0000-000000000001',
        created_by_name: 'Aarav Mehta',
        created_at: '2026-11-06T09:15:00Z',
      },
    ],
    comments: [],
    timeline: [
      {
        id: 'tl_104_1',
        content_id: 'cnt_104',
        actor_name: 'Aarav Mehta',
        actor_role: 'creator',
        event_type: 'created',
        summary: 'Created initial product brief draft',
        created_at: '2026-11-06T09:15:00Z',
      },
    ],
  },
  {
    id: 'cnt_105',
    org_id: SEEDED_ACME_WORKSPACE.id,
    creator_id: '10000000-0000-0000-0000-000000000001',
    creator_name: 'Aarav Mehta',
    title: 'Customer Success Case Study: FinTech Scale-Up',
    content_type: 'social_post',
    status: 'in_review',
    current_version_no: 1,
    reviewer_id: '10000000-0000-0000-0000-000000000002',
    reviewer_name: 'Priya Nair',
    submitted_at: '2026-11-06T10:02:00Z',
    updated_at: '2026-11-06T10:02:00Z',
    language_detected: 'en',
    word_count: 62,
    versions: [
      {
        id: 'ver_cnt_105_1',
        content_id: 'cnt_105',
        version_no: 1,
        body_text: 'How PaySwift transitioned 14 million daily financial transactions to Acme Cloud without a single microsecond of unscheduled downtime. Read the full benchmark study.',
        source: 'paste',
        created_by_id: '10000000-0000-0000-0000-000000000001',
        created_by_name: 'Aarav Mehta',
        created_at: '2026-11-06T10:00:00Z',
      },
    ],
    comments: [],
    timeline: [
      {
        id: 'tl_105_1',
        content_id: 'cnt_105',
        actor_name: 'Aarav Mehta',
        actor_role: 'creator',
        event_type: 'submitted',
        summary: 'Submitted for brand certification review',
        created_at: '2026-11-06T10:02:00Z',
      },
    ],
  },
];

export const INITIAL_SEEDED_AUDIT: AuditLogItem[] = [
  {
    id: 'aud_001',
    org_id: SEEDED_ACME_WORKSPACE.id,
    actor_id: '10000000-0000-0000-0000-000000000002',
    actor_name: 'Priya Nair',
    actor_role: 'reviewer',
    action: 'APPROVED_CONTENT',
    entity_type: 'content',
    entity_id: 'cnt_102',
    payload: { title: 'Global Infrastructure Architecture Whitepaper', version: 2 },
    created_at: '2026-11-06T10:05:00Z',
  },
  {
    id: 'aud_002',
    org_id: SEEDED_ACME_WORKSPACE.id,
    actor_id: '10000000-0000-0000-0000-000000000001',
    actor_name: 'Aarav Mehta',
    actor_role: 'creator',
    action: 'SUBMITTED_FOR_REVIEW',
    entity_type: 'content',
    entity_id: 'cnt_105',
    payload: { title: 'Customer Success Case Study: FinTech Scale-Up', reviewer: 'Priya Nair' },
    created_at: '2026-11-06T10:02:00Z',
  },
  {
    id: 'aud_003',
    org_id: SEEDED_ACME_WORKSPACE.id,
    actor_id: '10000000-0000-0000-0000-000000000002',
    actor_name: 'Priya Nair',
    actor_role: 'reviewer',
    action: 'REQUESTED_CHANGES',
    entity_type: 'content',
    entity_id: 'cnt_103',
    payload: { title: 'Zero-Trust Cloud Governance Migration Guide', reason: 'Clarify ISO 27001 citation' },
    created_at: '2026-11-06T09:40:00Z',
  },
  {
    id: 'aud_004',
    org_id: SEEDED_ACME_WORKSPACE.id,
    actor_id: '10000000-0000-0000-0000-000000000003',
    actor_name: 'Rohan Kapoor',
    actor_role: 'admin',
    action: 'UPDATED_BRAND_RULE',
    entity_type: 'library',
    entity_id: 'ent_001',
    payload: { code: 'R-TERM-001', change_note: 'Enforce space in Acme Cloud nomenclature' },
    created_at: '2026-11-06T09:00:00Z',
  },
  {
    id: 'aud_005',
    org_id: SEEDED_ACME_WORKSPACE.id,
    actor_id: '10000000-0000-0000-0000-000000000003',
    actor_name: 'Rohan Kapoor',
    actor_role: 'admin',
    action: 'PROVISIONED_MEMBER',
    entity_type: 'member',
    entity_id: '10000000-0000-0000-0000-000000000001',
    payload: { email: 'aarav.writer@acme-cloud.io', role: 'creator' },
    created_at: '2026-11-06T08:30:00Z',
  },
];

export const INITIAL_SEEDED_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif_001',
    user_id: '10000000-0000-0000-0000-000000000001',
    content_id: 'cnt_103',
    content_title: 'Zero-Trust Cloud Governance Migration Guide',
    message: 'Priya Nair requested revisions on paragraph 2 citations.',
    created_at: '2026-11-06T09:40:00Z',
  },
  {
    id: 'notif_002',
    user_id: '10000000-0000-0000-0000-000000000002',
    content_id: 'cnt_105',
    content_title: 'Customer Success Case Study: FinTech Scale-Up',
    message: 'Aarav Mehta submitted a new social post copy for your approval.',
    created_at: '2026-11-06T10:02:00Z',
  },
  {
    id: 'notif_003',
    user_id: '10000000-0000-0000-0000-000000000003',
    content_id: 'cnt_102',
    content_title: 'Global Infrastructure Architecture Whitepaper',
    message: 'Priya Nair approved version 2 for public distribution.',
    created_at: '2026-11-06T10:05:00Z',
  },
];

let entriesStore: BrandEntry[] = JSON.parse(JSON.stringify(INITIAL_SEEDED_ENTRIES));
let contentStore: ContentItem[] = JSON.parse(JSON.stringify(INITIAL_SEEDED_CONTENT));
let auditStore: AuditLogItem[] = JSON.parse(JSON.stringify(INITIAL_SEEDED_AUDIT));
let notificationsStore: NotificationItem[] = JSON.parse(JSON.stringify(INITIAL_SEEDED_NOTIFICATIONS));

export const api = {
  async getDisclosure(): Promise<DisclosureInfo> {
    try {
      return await request<DisclosureInfo>('/disclosure');
    } catch {
      return {
        provider: 'Google Gemini API',
        model: 'gemini-2.5-flash',
        prompt_version: 'check_v1.4',
        data_use_note: 'Content is evaluated strictly as delimited data for brand guidelines inspection.',
        sent_data_scope: 'Only the draft text under review and active brand rules are sent to the model.',
        human_control_guarantee: 'AI suggestions are never auto-applied. Final decisions remain with human reviewers.',
        known_limitations: [
          'English language content only in V1',
          'Text-first checking; complex layouts are out of scope',
          'Accuracy depends on the depth and clarity of the Brand Library',
        ],
      };
    }
  },

  async getContentList(user: UserProfile): Promise<ContentItem[]> {
    try {
      return await request<ContentItem[]>('/content', { method: 'GET' }, user);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      if (user.role === 'creator') {
        return contentStore.filter((c) => c.creator_id === user.id);
      }
      return [...contentStore];
    }
  },

  async getContentById(id: string, user?: UserProfile): Promise<ContentItem> {
    try {
      return await request<ContentItem>(`/content/${id}`, { method: 'GET' }, user);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const item = contentStore.find((c) => c.id === id);
      if (!item) throw new ApiClientError(404, 'not_found', 'Content item not found');
      return item;
    }
  },

  async duplicateContentAsDraft(user: UserProfile, id: string): Promise<ContentItem> {
    try {
      return await request<ContentItem>(`/content/${id}/duplicate`, { method: 'POST' }, user);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const original = await this.getContentById(id, user);
      const newId = `cnt_${Date.now().toString().slice(-4)}`;
      const now = new Date().toISOString();
      const duplicate: ContentItem = {
        ...original,
        id: newId,
        title: `${original.title} (Draft Copy)`,
        status: 'draft',
        current_version_no: 1,
        updated_at: now,
        latest_check: undefined,
        comments: [],
        timeline: [
          {
            id: `tl_${Date.now()}`,
            content_id: newId,
            actor_name: user.display_name,
            actor_role: user.role,
            event_type: 'created',
            summary: `Duplicated from "${original.title}"`,
            created_at: now,
          },
        ],
      };
      contentStore.unshift(duplicate);
      return duplicate;
    }
  },

  async deleteDraft(user: UserProfile, id: string): Promise<void> {
    try {
      await request<void>(`/content/${id}`, { method: 'DELETE' }, user);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      contentStore = contentStore.filter((c) => c.id !== id);
    }
  },

  async uploadContentFile(
    user: UserProfile,
    input: {
      file: File;
      title: string;
      content_type: ContentItem['content_type'];
      run_check_immediately: boolean;
    }
  ): Promise<ContentItem> {
    const form = new FormData();
    form.append('file', input.file);
    form.append('title', input.title);
    form.append('content_type', input.content_type);

    const created = await request<ContentItem>(
      '/content/upload',
      {
        method: 'POST',
        body: form,
      },
      user
    );

    if (input.run_check_immediately) {
      await this.triggerCheckRun(user, created.id);
      return await this.getContentById(created.id, user);
    }
    return created;
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
    try {
      const created = await request<ContentItem>(
        '/content',
        {
          method: 'POST',
          body: JSON.stringify({
            title: input.title,
            content_type: input.content_type,
            body_text: input.body_text,
          }),
        },
        user
      );

      if (input.run_check_immediately) {
        await this.triggerCheckRun(user, created.id);
        return await this.getContentById(created.id, user);
      }
      return created;
    } catch (err: unknown) {
      rethrowIfHttpError(err);

      // Local fallback
      const words = input.body_text.trim().split(/\s+/).filter(Boolean);
      const newId = `cnt_${Date.now().toString().slice(-4)}`;
      const now = new Date().toISOString();
      const newItem: ContentItem = {
        id: newId,
        org_id: user.org_id,
        creator_id: user.id,
        creator_name: user.display_name,
        title: input.title.trim() || 'Untitled Draft',
        content_type: input.content_type,
        status: 'draft',
        current_version_no: 1,
        updated_at: now,
        language_detected: 'en',
        word_count: words.length,
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
            summary: `Created draft v1 (${words.length} words)`,
            created_at: now,
          },
        ],
      };
      contentStore.unshift(newItem);
      if (input.run_check_immediately) {
        await this.triggerCheckRun(user, newItem.id);
        return await this.getContentById(newItem.id, user);
      }
      return newItem;
    }
  },

  /** Upload a creative (JPEG, PNG or WebP). The AI reads it into a text brief, which becomes version 1. */
  async uploadImage(
    user: UserProfile,
    input: { file: File; title: string; platform: string; content_type?: ContentType }
  ): Promise<ContentItem> {
    const form = new FormData();
    form.append('file', input.file);
    form.append('title', input.title);
    form.append('platform', input.platform);
    form.append('content_type', input.content_type ?? 'social_post');
    return request<ContentItem>('/content/upload-image', { method: 'POST', body: form }, user);
  },

  /** Upload a revised design as a new version of an existing image item. */
  async uploadRevisedImage(user: UserProfile, contentId: string, file: File, platform?: string): Promise<ContentItem> {
    const form = new FormData();
    form.append('file', file);
    if (platform) form.append('platform', platform);
    return request<ContentItem>(`/content/${contentId}/image`, { method: 'POST', body: form }, user);
  },

  async getVersionImageUrl(user: UserProfile, imageUrl: string): Promise<string> {
    return requestBlobUrl(imageUrl, user);
  },

  async triggerCheckRun(
    user: UserProfile,
    contentId: string,
    options?: { simulateDegraded?: boolean }
  ): Promise<CheckRun> {
    try {
      const enqueueRes = await request<{ check_run_id: string; status: string }>(
        `/content/${contentId}/checks`,
        { method: 'POST' },
        user
      );

      const checkRunId = enqueueRes.check_run_id;

      // Poll until check run is completed
      const maxAttempts = 90;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const run = await request<CheckRun>(`/checks/${checkRunId}`, { method: 'GET' }, user);
        if (run.status === 'completed' || run.status === 'degraded' || run.status === 'failed') {
          return run;
        }
      }
      return await request<CheckRun>(`/checks/${checkRunId}`, { method: 'GET' }, user);
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.status !== 0) throw err;

      // Local mock check run fallback with real rule evaluation
      const item = await this.getContentById(contentId);
      const latestVer = item.versions[item.versions.length - 1];
      const text = latestVer.body_text;
      const findings: Finding[] = [];
      const runManifest: Record<string, number> = {};

      for (const entry of entriesStore) {
        if (!entry.is_active || !entry.pattern?.banned) continue;
        runManifest[entry.code] = entry.current_version;
        const banned = entry.pattern.banned;
        let searchIndex = 0;
        const lowerText = text.toLowerCase();
        const lowerBanned = banned.toLowerCase();

        while (searchIndex < lowerText.length) {
          const foundIdx = lowerText.indexOf(lowerBanned, searchIndex);
          if (foundIdx === -1) break;
          const actualSpan = text.slice(foundIdx, foundIdx + banned.length);
          findings.push({
            id: `fnd_${Date.now()}_${findings.length + 1}`,
            check_run_id: `chk_${Date.now()}`,
            content_version_no: latestVer.version_no,
            category: entry.category,
            severity: entry.severity_default,
            source_type: entry.check_mode === 'deterministic' ? 'rule_engine' : 'ai',
            entry_id: entry.id,
            entry_code: entry.code,
            entry_title: entry.title,
            entry_body: entry.body,
            entry_version: entry.current_version,
            span_start: foundIdx,
            span_end: foundIdx + banned.length,
            span_text: actualSpan,
            explanation: `Identified violation of ${entry.code} ("${entry.title}"): ${entry.body}`,
            suggestion_text: entry.pattern.preferred || 'Approved alternative',
            confidence: 'high',
            label: entry.category === 'facts_claims' ? 'unsupported_claim' : 'issue',
            decisions: [],
          });
          searchIndex = foundIdx + banned.length;
        }
      }

      const highCount = findings.filter((f) => f.severity === 'high').length;
      const mediumCount = findings.filter((f) => f.severity === 'medium').length;
      const lowCount = findings.filter((f) => f.severity === 'low').length;

      const mockRun: CheckRun = {
        id: `chk_${Date.now()}`,
        content_id: contentId,
        content_version_no: latestVer.version_no,
        status: options?.simulateDegraded ? 'degraded' : 'completed',
        library_version: 1,
        library_manifest: Object.keys(runManifest).length > 0 ? runManifest : { 'R-TERM-001': 1, 'R-CLAIM-001': 1 },
        engine_info: {
          provider: 'Google Gemini API',
          model: 'gemini-2.5-flash',
          prompt_version: 'check_v1.4',
          rules_checked: entriesStore.length || 45,
          categories_checked: 5,
        },
        stats: {
          high: highCount,
          medium: mediumCount,
          low: lowCount,
          rejected_by_gate: 0,
          deterministic_done: true,
          llm_done: true,
        },
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        findings,
      };

      item.latest_check = mockRun;
      item.status = 'checked';

      item.timeline.push({
        id: `tl_${Date.now()}`,
        content_id: contentId,
        actor_name: 'Dhrishyam AI Engine',
        actor_role: 'admin',
        event_type: 'check_run',
        summary: `Governance check identified ${findings.length} findings (${highCount} high, ${mediumCount} medium)`,
        created_at: new Date().toISOString(),
      });

      auditStore.unshift({
        id: `aud_${Date.now()}`,
        org_id: item.org_id,
        actor_id: user.id,
        actor_name: user.display_name,
        actor_role: user.role,
        action: 'RUN_GOVERNANCE_CHECK',
        entity_type: 'content',
        entity_id: contentId,
        payload: { findings_count: findings.length, high: highCount, medium: mediumCount },
        created_at: new Date().toISOString(),
      });

      return mockRun;
    }
  },

  async getCheckSteps(checkRunId: string, user?: UserProfile): Promise<unknown[]> {
    return await request<unknown[]>(`/checks/${checkRunId}/steps`, { method: 'GET' }, user);
  },

  async updateContentBody(
    user: UserProfile,
    contentId: string,
    newBody: string,
    source: 'manual' | 'suggestion' = 'manual'
  ): Promise<ContentItem> {
    try {
      return await request<ContentItem>(
        `/content/${contentId}/body`,
        {
          method: 'PUT',
          body: JSON.stringify({ body_text: newBody, source }),
        },
        user
      );
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const item = await this.getContentById(contentId, user);
      const nextVer = item.current_version_no + 1;
      item.versions.push({
        id: `ver_${contentId}_${nextVer}`,
        content_id: contentId,
        version_no: nextVer,
        body_text: newBody,
        source,
        created_by_id: user.id,
        created_by_name: user.display_name,
        created_at: new Date().toISOString(),
      });
      item.current_version_no = nextVer;
      item.status = 'draft';
      return item;
    }
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
    try {
      await request<void>(
        `/findings/${findingId}/decision`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        user
      );
      const updated = await this.getContentById(contentId, user);
      return { item: updated };
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const item = await this.getContentById(contentId, user);
      if (item.latest_check) {
        const finding = item.latest_check.findings.find((f) => f.id === findingId);
        if (finding) {
          const decision: FindingDecision = {
            id: `dec_${Date.now()}`,
            finding_id: findingId,
            actor_id: user.id,
            actor_name: user.display_name,
            actor_role: user.role,
            action: payload.action,
            reason: payload.reason,
            edited_text: payload.edited_text,
            created_at: new Date().toISOString(),
          };
          finding.decisions.push(decision);

          let previousText: string | undefined;
          if (payload.action === 'accepted' || payload.action === 'edited') {
            const replacement = payload.action === 'accepted' ? finding.suggestion_text : (payload.edited_text || '');
            const latestVer = item.versions[item.versions.length - 1];
            previousText = latestVer.body_text;
            const newText =
              previousText.slice(0, finding.span_start) +
              replacement +
              previousText.slice(finding.span_end);

            const { updatedFindings } = shiftFindingOffsets(
              item.latest_check.findings,
              findingId,
              finding.span_start,
              finding.span_end,
              replacement
            );
            item.latest_check.findings = updatedFindings;

            const nextVer = item.current_version_no + 1;
            item.versions.push({
              id: `ver_${contentId}_${nextVer}`,
              content_id: contentId,
              version_no: nextVer,
              body_text: newText,
              source: 'suggestion',
              created_by_id: user.id,
              created_by_name: user.display_name,
              created_at: new Date().toISOString(),
            });
            item.current_version_no = nextVer;
          }
          return { item, previousText };
        }
      }
      return { item };
    }
  },

  async submitForApproval(
    user: UserProfile,
    contentId: string,
    reviewerId?: string,
    note?: string
  ): Promise<ContentItem> {
    try {
      await request<void>(
        `/content/${contentId}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({ reviewer_id: reviewerId, note }),
        },
        user
      );
      return await this.getContentById(contentId, user);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const item = await this.getContentById(contentId, user);
      item.status = 'in_review';
      item.reviewer_id = reviewerId;
      item.submitted_at = new Date().toISOString();
      item.timeline.push({
        id: `tl_${Date.now()}`,
        content_id: contentId,
        actor_name: user.display_name,
        actor_role: user.role,
        event_type: 'submitted',
        summary: `Submitted for review${note ? `: "${note}"` : ''}`,
        created_at: new Date().toISOString(),
      });
      if (reviewerId) {
        notificationsStore.unshift({
          id: `notif_${Date.now()}`,
          user_id: reviewerId,
          content_id: contentId,
          content_title: item.title,
          message: `${user.display_name} submitted "${item.title}" for your approval.`,
          created_at: new Date().toISOString(),
        });
      }
      auditStore.unshift({
        id: `aud_${Date.now()}`,
        org_id: item.org_id,
        actor_id: user.id,
        actor_name: user.display_name,
        actor_role: user.role,
        action: 'SUBMITTED_FOR_REVIEW',
        entity_type: 'content',
        entity_id: contentId,
        payload: { title: item.title, reviewer_id: reviewerId },
        created_at: new Date().toISOString(),
      });
      return item;
    }
  },

  async withdrawSubmission(user: UserProfile, contentId: string): Promise<ContentItem> {
    try {
      await request<void>(`/content/${contentId}/withdraw`, { method: 'POST' }, user);
      return await this.getContentById(contentId, user);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const item = await this.getContentById(contentId, user);
      item.status = 'draft';
      item.timeline.push({
        id: `tl_${Date.now()}`,
        content_id: contentId,
        actor_name: user.display_name,
        actor_role: user.role,
        event_type: 'withdrawn',
        summary: 'Withdrew submission back to draft',
        created_at: new Date().toISOString(),
      });
      return item;
    }
  },

  async submitReviewDecision(
    user: UserProfile,
    contentId: string,
    decision: 'approved' | 'changes_requested',
    comment: string
  ): Promise<ContentItem> {
    try {
      await request<void>(
        `/content/${contentId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, comment }),
        },
        user
      );
      return await this.getContentById(contentId, user);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const item = await this.getContentById(contentId, user);
      item.status = decision;
      item.timeline.push({
        id: `tl_${Date.now()}`,
        content_id: contentId,
        actor_name: user.display_name,
        actor_role: user.role,
        event_type: decision,
        summary: decision === 'approved'
          ? `Certified as Brand Approved${comment ? `: "${comment}"` : ''}`
          : `Requested changes: "${comment}"`,
        created_at: new Date().toISOString(),
      });
      notificationsStore.unshift({
        id: `notif_${Date.now()}`,
        user_id: item.creator_id,
        content_id: contentId,
        content_title: item.title,
        message: decision === 'approved'
          ? `${user.display_name} approved your document "${item.title}".`
          : `${user.display_name} requested revisions on "${item.title}": "${comment}".`,
        created_at: new Date().toISOString(),
      });
      auditStore.unshift({
        id: `aud_${Date.now()}`,
        org_id: item.org_id,
        actor_id: user.id,
        actor_name: user.display_name,
        actor_role: user.role,
        action: decision === 'approved' ? 'APPROVED_CONTENT' : 'REQUESTED_CHANGES',
        entity_type: 'content',
        entity_id: contentId,
        payload: { title: item.title, comment },
        created_at: new Date().toISOString(),
      });
      return item;
    }
  },

  async addComment(
    user: UserProfile,
    contentId: string,
    body: string,
    anchorText?: string
  ): Promise<ContentItem> {
    try {
      await request<void>(
        `/content/${contentId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ body, anchor_text: anchorText }),
        },
        user
      );
      return await this.getContentById(contentId, user);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const item = await this.getContentById(contentId, user);
      item.comments.push({
        id: `cmt_${Date.now()}`,
        content_id: contentId,
        version_no: item.current_version_no,
        author_id: user.id,
        author_name: user.display_name,
        author_role: user.role,
        body,
        anchor_text: anchorText,
        created_at: new Date().toISOString(),
      });
      return item;
    }
  },

  async getLibraryEntries(): Promise<BrandEntry[]> {
    try {
      return await request<BrandEntry[]>('/library/entries');
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      return [...entriesStore];
    }
  },

  async getEntryVersions(entryId: string): Promise<BrandEntryVersion[]> {
    try {
      return await request<BrandEntryVersion[]>(`/library/entries/${entryId}/versions`);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      return [];
    }
  },

  async saveLibraryEntry(
    user: UserProfile,
    entryInput: Partial<BrandEntry> & { code: string; title: string; body: string },
    changeNote: string
  ): Promise<BrandEntry> {
    try {
      if (entryInput.id && !entryInput.id.startsWith('ent_temp_')) {
        return await request<BrandEntry>(
          `/library/entries/${entryInput.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ ...entryInput, change_note: changeNote }),
          },
          user
        );
      } else {
        return await request<BrandEntry>(
          '/library/entries',
          {
            method: 'POST',
            body: JSON.stringify({ ...entryInput, change_note: changeNote }),
          },
          user
        );
      }
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const entry: BrandEntry = {
        id: entryInput.id || `ent_${Date.now()}`,
        org_id: user.org_id,
        code: entryInput.code.toUpperCase(),
        entry_type: entryInput.entry_type || 'rule',
        category: entryInput.category || 'tone',
        title: entryInput.title,
        body: entryInput.body,
        check_mode: entryInput.check_mode || 'deterministic',
        pattern: entryInput.pattern,
        good_example: entryInput.good_example,
        bad_example: entryInput.bad_example,
        severity_default: entryInput.severity_default || 'medium',
        is_active: entryInput.is_active ?? true,
        current_version: (entryInput.current_version || 1) + 1,
        updated_at: new Date().toISOString(),
        updated_by_name: user.display_name,
      };
      return entry;
    }
  },

  async toggleEntryActive(user: UserProfile, entryId: string, isActive: boolean): Promise<BrandEntry> {
    try {
      return await request<BrandEntry>(
        `/library/entries/${entryId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ is_active: isActive }),
        },
        user
      );
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const entry = entriesStore.find((e) => e.id === entryId);
      if (entry) entry.is_active = isActive;
      return entry!;
    }
  },

  async seedDemoLibrary(user: UserProfile): Promise<BrandEntry[]> {
    try {
      await request<void>('/library/seed', { method: 'POST' }, user);
      return await this.getLibraryEntries();
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      entriesStore = JSON.parse(JSON.stringify(INITIAL_SEEDED_ENTRIES));
      return this.getLibraryEntries();
    }
  },

  resetDemoData(): void {
    entriesStore = JSON.parse(JSON.stringify(INITIAL_SEEDED_ENTRIES));
    contentStore = JSON.parse(JSON.stringify(INITIAL_SEEDED_CONTENT));
    auditStore = JSON.parse(JSON.stringify(INITIAL_SEEDED_AUDIT));
    notificationsStore = JSON.parse(JSON.stringify(INITIAL_SEEDED_NOTIFICATIONS));
  },

  async previewGuidelineImport(rawText: string): Promise<ProposedImportEntry[]> {
    try {
      return await request<ProposedImportEntry[]>('/library/import/preview', {
        method: 'POST',
        body: JSON.stringify({ raw_text: rawText }),
      });
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      return [];
    }
  },

  async getInsights(periodDays: number): Promise<InsightsData> {
    try {
      return await request<InsightsData>(`/insights/summary?period_days=${periodDays}`);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      // Offline: show no data rather than made-up numbers.
      return {
        period_days: periodDays,
        kpis: { checks_run: 0, total_findings: 0, accept_rate: null, dismiss_rate: null },
        most_violated_rules: [],
        category_over_time: [],
        unclear_rules: [],
      };
    }
  },

  async getNotifications(userId: string): Promise<NotificationItem[]> {
    try {
      return await request<NotificationItem[]>('/notifications');
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      return notificationsStore.filter((n) => n.user_id === userId);
    }
  },

  async markAllNotificationsRead(userId: string): Promise<void> {
    try {
      await request<void>('/notifications/mark-read', { method: 'POST' });
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const now = new Date().toISOString();
      notificationsStore = notificationsStore.map((n) =>
        n.user_id === userId ? { ...n, read_at: n.read_at || now } : n
      );
    }
  },

  async getMembers(user?: UserProfile): Promise<UserProfile[]> {
    try {
      return await request<UserProfile[]>('/members', { method: 'GET' }, user);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const activeOrgId = user?.org_id || getStoredUser()?.org_id;
      if (activeOrgId) {
        return membersStore.filter((m) => !m.org_id || m.org_id === activeOrgId);
      }
      return [...membersStore];
    }
  },

  async updateMemberRole(actor: UserProfile, memberId: string, newRole: Role): Promise<UserProfile[]> {
    try {
      return await request<UserProfile[]>(
        `/members/${memberId}/role`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role: newRole }),
        },
        actor
      );
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const target = membersStore.find((m) => m.id === memberId);
      if (target) target.role = newRole;
      return [...membersStore];
    }
  },

  async addMember(
    actor: UserProfile,
    payload: AddMemberPayload
  ): Promise<UserProfile[]> {
    try {
      return await request<UserProfile[]>(
        '/members',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        actor
      );
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const cleanEmail = payload.email.trim().toLowerCase();
      const newM: UserProfile = {
        id: `usr_${Date.now()}`,
        email: cleanEmail,
        display_name: payload.display_name.trim(),
        role: payload.role,
        org_id: actor.org_id,
        org_name: actor.org_name,
        library_version: 1,
        last_active: new Date().toISOString(),
      };
      membersStore.push(newM);
      if (payload.password) {
        offlinePasswordsStore[cleanEmail] = payload.password;
      }
      return membersStore.filter((m) => !m.org_id || m.org_id === actor.org_id);
    }
  },

  async removeMember(actor: UserProfile, memberId: string): Promise<UserProfile[]> {
    try {
      return await request<UserProfile[]>(`/members/${memberId}`, { method: 'DELETE' }, actor);
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      membersStore = membersStore.filter((m) => m.id !== memberId);
      return [...membersStore];
    }
  },

  async getAuditLog(): Promise<AuditLogItem[]> {
    try {
      return await request<AuditLogItem[]>('/audit');
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      return [...auditStore];
    }
  },

  async registerBrand(payload: RegisterBrandPayload): Promise<UserProfile> {
    const brandName = (payload.brand_name || payload.organization_name || '').trim();
    const adminName = payload.admin_name.trim();
    const adminEmail = payload.admin_email.trim().toLowerCase();
    const password = payload.password || payload.admin_password || '';
    const seedRules = payload.seed_default_rules ?? true;

    if (supabase) {
      // Real sign-in: Supabase creates the account (or signs in an existing one), then the
      // backend creates the brand organisation with this person as its admin.
      let session = null;
      const signUp = await supabase.auth.signUp({
        email: adminEmail,
        password,
        options: { data: { display_name: adminName } },
      });
      if (signUp.error) {
        if (!/already (been )?registered/i.test(signUp.error.message)) {
          throw new Error(friendlyAuthError(signUp.error.message));
        }
        const signIn = await supabase.auth.signInWithPassword({ email: adminEmail, password });
        if (signIn.error) {
          throw new Error('An account with this email already exists. Use its password to add a new brand.');
        }
        session = signIn.data.session;
      } else {
        session = signUp.data.session;
      }
      const pending = { email: adminEmail, brand_name: brandName, admin_name: adminName, seed_default_rules: seedRules };
      if (!session) {
        // Email confirmation is switched on: finish the brand after the first sign-in.
        try {
          localStorage.setItem(PENDING_BRAND_KEY, JSON.stringify(pending));
        } catch {
          // Ignore
        }
        throw new Error(
          `Almost done: we sent a confirmation link to ${adminEmail}. Confirm your email, then sign in and ${brandName} will be created.`
        );
      }
      const created = await request<UserProfile>(
        '/auth/register-brand',
        { method: 'POST', body: JSON.stringify(pending) },
        null
      );
      rememberActiveOrg(created.org_id);
      return this.loadSupabaseProfile();
    }

    try {
      const res = await request<AuthTokenResponse>('/auth/register-brand', {
        method: 'POST',
        body: JSON.stringify({
          brand_name: brandName,
          admin_name: adminName,
          admin_email: adminEmail,
          password,
          seed_default_rules: payload.seed_default_rules ?? true,
        }),
      });

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dhrishyam_token', res.access_token);
        localStorage.setItem('dhrishyam_user', JSON.stringify(res.user));
      }

      try {
        const workspaces = await this.getWorkspaces(res.user);
        res.user.organizations = workspaces;
      } catch {
        res.user.organizations = [
          {
            id: res.user.org_id,
            name: res.user.org_name,
            role: res.user.role,
            library_version: res.user.library_version,
            org_id: res.user.org_id,
            org_name: res.user.org_name,
          },
          SEEDED_ACME_WORKSPACE,
        ];
      }

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dhrishyam_user', JSON.stringify(res.user));
      }
      return res.user;
    } catch (err: unknown) {
      rethrowIfHttpError(err);

      // Offline fallback provisioning
      const newOrgId = `org_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const newUserId = `usr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
      const newTenant: TenantSummary = {
        id: newOrgId,
        name: brandName || 'New Brand Workspace',
        role: 'admin',
        library_version: 1,
        org_id: newOrgId,
        org_name: brandName || 'New Brand Workspace',
      };
      tenantsStore.push(newTenant);

      const adminUser: UserProfile = {
        id: newUserId,
        email: adminEmail,
        display_name: adminName,
        role: 'admin',
        org_id: newOrgId,
        org_name: brandName || 'New Brand Workspace',
        library_version: 1,
        last_active: new Date().toISOString(),
        organizations: [newTenant, SEEDED_ACME_WORKSPACE],
      };

      membersStore.push(adminUser);
      if (password) {
        offlinePasswordsStore[adminEmail] = password;
      }

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dhrishyam_token', `demo-admin-token`);
        localStorage.setItem('dhrishyam_user', JSON.stringify(adminUser));
      }
      return adminUser;
    }
  },

  async getWorkspaces(user?: UserProfile): Promise<TenantSummary[]> {
    if (supabase) return this.fetchWorkspaces();
    try {
      const raw = await request<Array<{
        id?: string;
        org_id?: string;
        name?: string;
        org_name?: string;
        role: Role;
        library_version?: number;
      }>>('/auth/workspaces', { method: 'GET' }, user);

      return raw.map((item) => ({
        id: item.org_id || item.id || '',
        name: item.org_name || item.name || 'Workspace',
        role: item.role,
        library_version: item.library_version ?? 1,
        org_id: item.org_id || item.id || '',
        org_name: item.org_name || item.name || 'Workspace',
      }));
    } catch (err: unknown) {
      rethrowIfHttpError(err);
      const active = user || getStoredUser();
      const candidates: TenantSummary[] = [];

      // Return ONLY workspaces accessible to the user:
      // 1. Any organizations explicitly assigned to user?.organizations
      if (active?.organizations && Array.isArray(active.organizations)) {
        for (const org of active.organizations) {
          if (org) candidates.push(org);
        }
      }

      // 2. The active user's primary workspace (user?.org_id)
      if (active?.org_id) {
        candidates.push({
          id: active.org_id,
          name: active.org_name || 'Active Workspace',
          role: active.role || 'creator',
          library_version: active.library_version ?? 1,
          org_id: active.org_id,
          org_name: active.org_name || 'Active Workspace',
        });
      }

      // 3. The seeded Acme Cloud workspace
      candidates.push(SEEDED_ACME_WORKSPACE);

      // Deduplicate by ID
      const seenIds = new Set<string>();
      const result: TenantSummary[] = [];

      for (const item of candidates) {
        const id = item.id || item.org_id;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          result.push({
            id,
            name: item.name || item.org_name || 'Workspace',
            role: item.role || 'creator',
            library_version: item.library_version ?? 1,
            org_id: item.org_id || id,
            org_name: item.org_name || item.name || 'Workspace',
          });
        }
      }

      return result;
    }
  },

  /** The signed-in user's workspaces, straight from the backend (no demo fallback). */
  async fetchWorkspaces(): Promise<TenantSummary[]> {
    const raw = await request<Array<{ org_id: string; org_name: string; role: Role; library_version?: number }>>(
      '/auth/workspaces',
      { method: 'GET' },
      null
    );
    return raw.map((item) => ({
      id: item.org_id,
      name: item.org_name,
      role: item.role,
      library_version: item.library_version ?? 1,
      org_id: item.org_id,
      org_name: item.org_name,
    }));
  },

  /**
   * After a Supabase sign-in: finish a pending brand registration if there is one, then
   * load the user's workspaces and their profile in the active one.
   */
  async loadSupabaseProfile(): Promise<UserProfile> {
    if (!supabase) throw new Error('Supabase sign-in is not configured.');
    const { data } = await supabase.auth.getSession();
    const email = data.session?.user?.email?.toLowerCase() ?? '';

    let pending: { email?: string } | null = null;
    try {
      pending = JSON.parse(localStorage.getItem(PENDING_BRAND_KEY) || 'null');
    } catch {
      pending = null;
    }
    if (pending && pending.email === email) {
      const created = await request<UserProfile>(
        '/auth/register-brand',
        { method: 'POST', body: JSON.stringify(pending) },
        null
      );
      rememberActiveOrg(created.org_id);
      try {
        localStorage.removeItem(PENDING_BRAND_KEY);
      } catch {
        // Ignore
      }
    }

    const workspaces = await this.fetchWorkspaces();
    if (workspaces.length === 0) {
      throw new ApiClientError(
        403,
        'forbidden',
        'Your account is not linked to an organisation yet. Ask an admin to add you, or register a brand.'
      );
    }
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(ACTIVE_ORG_KEY);
    } catch {
      remembered = null;
    }
    const active = workspaces.find((w) => w.id === remembered) ?? workspaces[0];
    const profile = await request<UserProfile>('/me', { headers: { 'X-Org-Id': active.id } }, null);
    profile.organizations = workspaces;
    rememberActiveOrg(profile.org_id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dhrishyam_user', JSON.stringify(profile));
      localStorage.removeItem('dhrishyam_token');
    }
    return profile;
  },

  /** The account from a saved Supabase session (after a page reload), or null. */
  async restoreSession(): Promise<UserProfile | null> {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return null;
    try {
      return await this.loadSupabaseProfile();
    } catch {
      return null;
    }
  },

  async logout(): Promise<void> {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } finally {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('dhrishyam_token');
          localStorage.removeItem('dhrishyam_user');
          localStorage.removeItem('dhrishyam_tenants');
        }
      }
      return;
    }
    try {
      await request<void>('/auth/logout', { method: 'POST' });
    } catch (err: unknown) {
      rethrowIfHttpError(err);
    } finally {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('dhrishyam_token');
        localStorage.removeItem('dhrishyam_user');
        localStorage.removeItem('dhrishyam_tenants');
      }
    }
  },

  async login(email: string, password?: string): Promise<UserProfile> {
    const trimmed = email.trim().toLowerCase();
    if (supabase) {
      // Real sign-in: Supabase checks the password; the backend says which workspaces and
      // role this account has.
      const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password: password || '' });
      if (error) throw new ApiClientError(401, 'unauthorized', friendlyAuthError(error.message));
      try {
        return await this.loadSupabaseProfile();
      } catch (err: unknown) {
        await supabase.auth.signOut();
        throw err;
      }
    }
    try {
      const res = await request<AuthTokenResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: trimmed, password }),
      });

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dhrishyam_token', res.access_token);
        localStorage.setItem('dhrishyam_user', JSON.stringify(res.user));
      }

      try {
        res.user.organizations = await this.getWorkspaces(res.user);
      } catch {
        res.user.organizations = [
          {
            id: res.user.org_id,
            name: res.user.org_name,
            role: res.user.role,
            library_version: res.user.library_version,
            org_id: res.user.org_id,
            org_name: res.user.org_name,
          },
          SEEDED_ACME_WORKSPACE,
        ];
      }

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dhrishyam_user', JSON.stringify(res.user));
      }
      return res.user;
    } catch (err: unknown) {
      rethrowIfHttpError(err);

      // Offline fallback verification
      if (!password) {
        throw new ApiClientError(401, 'unauthorized', 'Invalid work email or password.');
      }

      if (offlinePasswordsStore[trimmed]) {
        if (offlinePasswordsStore[trimmed] !== password) {
          throw new ApiClientError(401, 'unauthorized', 'Invalid work email or password.');
        }
      } else {
        throw new ApiClientError(401, 'unauthorized', 'Invalid work email or password.');
      }

      const existing = membersStore.find((m) => m.email.toLowerCase() === trimmed);
      if (existing) {
        const userCopy: UserProfile = {
          ...existing,
          organizations: existing.organizations || [
            {
              id: existing.org_id,
              name: existing.org_name,
              role: existing.role,
              library_version: existing.library_version,
              org_id: existing.org_id,
              org_name: existing.org_name,
            },
            SEEDED_ACME_WORKSPACE,
          ],
        };

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('dhrishyam_token', `demo-${existing.role}-token`);
          localStorage.setItem('dhrishyam_user', JSON.stringify(userCopy));
        }
        return userCopy;
      }

      throw new ApiClientError(401, 'unauthorized', 'Invalid work email or password.');
    }
  },

  getDemoUsers(): Record<Role, UserProfile> {
    return DEMO_USERS;
  },
};
