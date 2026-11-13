// src/types/domain.ts

export type Role = 'creator' | 'reviewer' | 'admin';

export type ContentStatus =
  | 'draft'
  | 'checked'
  | 'in_review'
  | 'changes_requested'
  | 'approved';

export type ContentType = 'blog' | 'social_post' | 'announcement' | 'product_copy';

export type VersionSource = 'paste' | 'upload' | 'suggestion' | 'manual' | 'image';

export type EntryType = 'rule' | 'fact' | 'term' | 'claim_rule';

export type EntryCategory =
  | 'tone'
  | 'terminology'
  | 'messaging'
  | 'facts_claims'
  | 'accessibility'
  | 'visual';

export type CheckMode = 'deterministic' | 'llm';

export type Severity = 'high' | 'medium' | 'low';

export type CheckRunStatus = 'queued' | 'running' | 'completed' | 'degraded' | 'failed';

export type FindingSourceType = 'rule_engine' | 'ai';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type FindingLabel =
  | 'issue'
  | 'unsupported_claim'
  | 'guideline_conflict'
  | 'needs_human_check';

export type FindingDecisionAction =
  | 'accepted'
  | 'edited'
  | 'dismissed'
  | 'confirmed'
  | 'overridden';

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id: string;
  };
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  org_id: string;
  org_name: string;
  library_version: number;
  last_active: string;
}

export interface DisclosureInfo {
  provider: string;
  model: string;
  prompt_version: string;
  data_use_note: string;
  sent_data_scope: string;
  human_control_guarantee: string;
  known_limitations: string[];
}

export interface BrandEntryPattern {
  rule_type?: 'banned_term' | 'preferred_term' | 'claim_pattern' | 'fact_match' | 'a11y_text' | 'system';
  banned?: string;
  preferred?: string;
  regex?: string;
}

export interface BrandEntry {
  id: string;
  org_id: string;
  code: string;
  entry_type: EntryType;
  category: EntryCategory;
  title: string;
  body: string;
  check_mode: CheckMode;
  pattern?: BrandEntryPattern;
  good_example?: string;
  bad_example?: string;
  severity_default: Severity;
  is_active: boolean;
  current_version: number;
  updated_at: string;
  updated_by_name: string;
}

export interface BrandEntryVersion {
  id: string;
  entry_id: string;
  version: number;
  snapshot: Partial<BrandEntry>;
  change_note: string;
  changed_by_name: string;
  created_at: string;
}

export interface FindingDecision {
  id: string;
  finding_id: string;
  actor_id: string;
  actor_name: string;
  actor_role: Role;
  action: FindingDecisionAction;
  reason?: string;
  edited_text?: string;
  resulting_version_no?: number;
  created_at: string;
}

export interface Finding {
  id: string;
  check_run_id: string;
  content_version_no: number;
  category: EntryCategory;
  severity: Severity;
  source_type: FindingSourceType;
  model_name?: string;
  entry_id: string;
  entry_code: string;
  entry_title: string;
  entry_body: string;
  entry_version: number;
  secondary_entry_id?: string;
  secondary_entry_code?: string;
  secondary_entry_title?: string;
  secondary_entry_body?: string;
  span_start: number;
  span_end: number;
  span_text: string;
  explanation: string;
  suggestion_text: string;
  confidence: ConfidenceLevel;
  label: FindingLabel;
  is_stale?: boolean;
  decisions: FindingDecision[];
}

export interface CheckRun {
  id: string;
  content_id: string;
  content_version_no: number;
  status: CheckRunStatus;
  library_version: number;
  library_manifest: Record<string, number>;
  engine_info: {
    provider: string;
    model: string;
    prompt_version: string;
    rules_checked: number;
    categories_checked: number;
  };
  stats: {
    high: number;
    medium: number;
    low: number;
    rejected_by_gate: number;
    deterministic_done: boolean;
    llm_done: boolean;
  };
  error?: string;
  started_at: string;
  finished_at?: string;
  findings: Finding[];
}

/** A box on an image, as fractions (0 to 1) from the top-left, tied to a span of the version's text brief. */
export interface ImageRegion {
  start: number;
  end: number;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageChecks {
  width: number;
  height: number;
  size_kb: number;
  blur_score: number;
  brightness: number;
  contrast: number;
  dominant_colours: string[];
  platform_label: string | null;
  recommended_size: [number, number] | null;
  flags: {
    below_recommended_size: boolean;
    wrong_aspect_ratio: boolean;
    looks_blurry: boolean;
    too_dark: boolean;
    too_bright: boolean;
    low_overall_contrast: boolean;
  };
}

export interface VersionImageInfo {
  width: number;
  height: number;
  platform: string | null;
  mime: string;
  url: string;
  metrics: ImageChecks;
  regions: ImageRegion[];
}

export interface ContentVersion {
  id: string;
  content_id: string;
  version_no: number;
  body_text: string;
  source: VersionSource;
  created_by_id: string;
  created_by_name: string;
  created_at: string;
  /** Present when this version is an image. body_text is then the AI's text brief of it. */
  image?: VersionImageInfo | null;
}

export interface ContentComment {
  id: string;
  content_id: string;
  version_no: number;
  author_id: string;
  author_name: string;
  author_role: Role;
  body: string;
  anchor_text?: string;
  finding_id?: string;
  created_at: string;
}

export interface TimelineEvent {
  id: string;
  content_id: string;
  actor_name: string;
  actor_role: Role;
  event_type: string;
  summary: string;
  created_at: string;
}

export interface AttachmentInfo {
  id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  alt_text: string;
  preview_url?: string;
}

export interface ContentItem {
  id: string;
  org_id: string;
  creator_id: string;
  creator_name: string;
  title: string;
  content_type: ContentType;
  status: ContentStatus;
  current_version_no: number;
  reviewer_id?: string;
  reviewer_name?: string;
  submitted_at?: string;
  updated_at: string;
  language_detected: string;
  word_count: number;
  attachment?: AttachmentInfo;
  versions: ContentVersion[];
  latest_check?: CheckRun;
  comments: ContentComment[];
  timeline: TimelineEvent[];
}

export interface NotificationItem {
  id: string;
  user_id: string;
  content_id: string;
  content_title: string;
  message: string;
  read_at?: string;
  created_at: string;
}

export interface AuditLogItem {
  id: string;
  org_id: string;
  actor_id: string;
  actor_name: string;
  actor_role: Role;
  action: string;
  entity_type: 'content' | 'library' | 'finding' | 'workflow' | 'member';
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RuleClarityMetric {
  entry_id: string;
  code: string;
  title: string;
  category: EntryCategory;
  findings_count: number;
  dismissal_rate: number;
  override_rate: number;
  clarity_score: number; // 0.6 * dismissal + 0.4 * override
  conflicts_count: number;
  may_be_unclear: boolean;
}

export interface InsightsData {
  period_days: number;
  kpis: {
    checks_run: number;
    total_findings: number;
    accept_rate: number | null;
    dismiss_rate: number | null;
  };
  most_violated_rules: { code: string; title: string; count: number; category: EntryCategory }[];
  category_over_time: {
    period: string;
    tone: number;
    terminology: number;
    messaging: number;
    facts_claims: number;
    accessibility: number;
    visual: number;
  }[];
  unclear_rules: RuleClarityMetric[];
}

export interface ProposedImportEntry {
  temp_id: string;
  code: string;
  entry_type: EntryType;
  category: EntryCategory;
  title: string;
  body: string;
  check_mode: CheckMode;
  severity_default: Severity;
  preferred?: string;
  banned?: string;
  decision: 'pending' | 'accepted' | 'rejected';
}
