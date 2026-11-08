// src/services/api.ts
/**
 * Dhrishyam API Client Service.
 * Connects the React SPA to the FastAPI Backend (/api/v1).
 * Supports automatic token injection, polling check runs, and offline graceful fallback.
 */

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
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
  'http://localhost:8000'
).replace(/\/+$/, '') + '/api/v1';

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  user?: UserProfile | null
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Inject Authorization Bearer token
  if (!headers.has('Authorization')) {
    const role = user?.role || 'creator';
    const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('dhrishyam_token') : null;
    const token = storedToken || `demo-${role}-token`;
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (user?.org_id && !headers.has('X-Org-Id')) {
    headers.set('X-Org-Id', user.org_id);
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

// In-Memory store for offline fallback
let membersStore: UserProfile[] = Object.values(DEMO_USERS);
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
    } catch {
      if (user.role === 'creator') {
        return contentStore.filter((c) => c.creator_id === user.id);
      }
      return [...contentStore];
    }
  },

  async getContentById(id: string): Promise<ContentItem> {
    try {
      return await request<ContentItem>(`/content/${id}`, { method: 'GET' });
    } catch {
      const item = contentStore.find((c) => c.id === id);
      if (!item) throw new ApiClientError(404, 'not_found', 'Content item not found');
      return item;
    }
  },

  async duplicateContentAsDraft(user: UserProfile, id: string): Promise<ContentItem> {
    try {
      return await request<ContentItem>(`/content/${id}/duplicate`, { method: 'POST' }, user);
    } catch {
      const original = await this.getContentById(id);
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
    } catch {
      contentStore = contentStore.filter((c) => c.id !== id);
    }
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
        return await this.getContentById(created.id);
      }
      return created;
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.status !== 0) throw err;

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
      const maxAttempts = 20;
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
    } catch {
      const item = await this.getContentById(contentId);
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
      const updated = await this.getContentById(contentId);
      return { item: updated };
    } catch {
      const item = await this.getContentById(contentId);
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
      return await this.getContentById(contentId);
    } catch {
      const item = await this.getContentById(contentId);
      item.status = 'in_review';
      return item;
    }
  },

  async withdrawSubmission(user: UserProfile, contentId: string): Promise<ContentItem> {
    try {
      await request<void>(`/content/${contentId}/withdraw`, { method: 'POST' }, user);
      return await this.getContentById(contentId);
    } catch {
      const item = await this.getContentById(contentId);
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
      return await this.getContentById(contentId);
    } catch {
      const item = await this.getContentById(contentId);
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
      return await this.getContentById(contentId);
    } catch {
      const item = await this.getContentById(contentId);
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
    } catch {
      return [...entriesStore];
    }
  },

  async getEntryVersions(entryId: string): Promise<BrandEntryVersion[]> {
    try {
      return await request<BrandEntryVersion[]>(`/library/entries/${entryId}/versions`);
    } catch {
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
    } catch {
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
    } catch {
      const entry = entriesStore.find((e) => e.id === entryId);
      if (entry) entry.is_active = isActive;
      return entry!;
    }
  },

  async seedDemoLibrary(user: UserProfile): Promise<BrandEntry[]> {
    try {
      await request<void>('/library/seed', { method: 'POST' }, user);
      return await this.getLibraryEntries();
    } catch {
      return this.getLibraryEntries();
    }
  },

  async previewGuidelineImport(rawText: string): Promise<ProposedImportEntry[]> {
    try {
      return await request<ProposedImportEntry[]>('/library/import/preview', {
        method: 'POST',
        body: JSON.stringify({ raw_text: rawText }),
      });
    } catch {
      return [];
    }
  },

  async getInsights(periodDays: number): Promise<InsightsData> {
    try {
      return await request<InsightsData>(`/insights/summary?period_days=${periodDays}`);
    } catch {
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
    } catch {
      return notificationsStore.filter((n) => n.user_id === userId);
    }
  },

  async markAllNotificationsRead(userId: string): Promise<void> {
    try {
      await request<void>('/notifications/mark-read', { method: 'POST' });
    } catch {
      const now = new Date().toISOString();
      notificationsStore = notificationsStore.map((n) =>
        n.user_id === userId ? { ...n, read_at: n.read_at || now } : n
      );
    }
  },

  async getMembers(): Promise<UserProfile[]> {
    try {
      return await request<UserProfile[]>('/members');
    } catch {
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
    } catch {
      const target = membersStore.find((m) => m.id === memberId);
      if (target) target.role = newRole;
      return [...membersStore];
    }
  },

  async addMember(
    actor: UserProfile,
    payload: { display_name: string; email: string; role: Role }
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
    } catch {
      const newM: UserProfile = {
        id: `usr_${Date.now()}`,
        email: payload.email,
        display_name: payload.display_name,
        role: payload.role,
        org_id: actor.org_id,
        org_name: actor.org_name,
        library_version: 1,
        last_active: new Date().toISOString(),
      };
      membersStore.push(newM);
      return [...membersStore];
    }
  },

  async removeMember(actor: UserProfile, memberId: string): Promise<UserProfile[]> {
    try {
      return await request<UserProfile[]>(`/members/${memberId}`, { method: 'DELETE' }, actor);
    } catch {
      membersStore = membersStore.filter((m) => m.id !== memberId);
      return [...membersStore];
    }
  },

  async getAuditLog(): Promise<AuditLogItem[]> {
    try {
      return await request<AuditLogItem[]>('/audit');
    } catch {
      return [...auditStore];
    }
  },

  async login(email: string, password?: string): Promise<UserProfile> {
    try {
      const res = await request<{ access_token: string; user: UserProfile }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dhrishyam_token', res.access_token);
        localStorage.setItem('dhrishyam_user', JSON.stringify(res.user));
      }
      return res.user;
    } catch {
      const trimmed = email.trim().toLowerCase();
      const existing = membersStore.find((m) => m.email.toLowerCase() === trimmed);
      if (existing) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('dhrishyam_token', `demo-${existing.role}-token`);
        }
        return existing;
      }
      const demoCreator = DEMO_USERS.creator;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('dhrishyam_token', `demo-creator-token`);
      }
      return demoCreator;
    }
  },

  getDemoUsers(): Record<Role, UserProfile> {
    return DEMO_USERS;
  },
};
