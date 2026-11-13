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
  DisclosureInfo,
  Finding,
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
    const role = activeUser?.role || 'creator';
    const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('dhrishyam_token') : null;
    const token = storedToken || `demo-${role}-token`;
    headers.set('Authorization', `Bearer ${token}`);
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
let entriesStore: BrandEntry[] = [];
let contentStore: ContentItem[] = [];
let auditStore: AuditLogItem[] = [];
let notificationsStore: NotificationItem[] = [];

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
      return newItem;
    }
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

      // Local mock check run fallback
      const item = await this.getContentById(contentId);
      const latestVer = item.versions[item.versions.length - 1];
      const mockRun: CheckRun = {
        id: `chk_${Date.now()}`,
        content_id: contentId,
        content_version_no: latestVer.version_no,
        status: options?.simulateDegraded ? 'degraded' : 'completed',
        library_version: 1,
        library_manifest: { 'R-TERM-001': 1, 'R-CLAIM-001': 1, 'SYS-001': 1 },
        engine_info: {
          provider: 'Google Gemini API',
          model: 'gemini-2.5-flash',
          prompt_version: 'check_v1.4',
          rules_checked: 45,
          categories_checked: 5,
        },
        stats: { high: 1, medium: 1, low: 0, rejected_by_gate: 0, deterministic_done: true, llm_done: true },
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        findings: [],
      };
      item.latest_check = mockRun;
      item.status = 'checked';
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
      return this.getLibraryEntries();
    }
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
      return {
        period_days: periodDays,
        kpis: { checks_run: 14, total_findings: 32, accept_rate: 74, dismiss_rate: 26 },
        most_violated_rules: [
          { code: 'R-TERM-001', title: 'Product Name Formatting', count: 12, category: 'terminology' },
          { code: 'R-CLAIM-001', title: 'Unverified Superlatives', count: 8, category: 'facts_claims' },
          { code: 'R-TONE-003', title: 'Calm Enterprise Tone', count: 7, category: 'tone' },
        ],
        category_over_time: [
          { period: 'Week 1', tone: 8, terminology: 14, messaging: 4, facts_claims: 6, accessibility: 3, visual: 0 },
          { period: 'Week 2', tone: 10, terminology: 16, messaging: 6, facts_claims: 8, accessibility: 5, visual: 1 },
        ],
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

  async logout(): Promise<void> {
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
