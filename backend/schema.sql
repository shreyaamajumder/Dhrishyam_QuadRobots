BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001

CREATE TABLE organizations (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    name TEXT NOT NULL, 
    library_version INTEGER DEFAULT '1' NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_organizations PRIMARY KEY (id)
);

CREATE TABLE profiles (
    id UUID NOT NULL, 
    email TEXT NOT NULL, 
    display_name TEXT, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_profiles PRIMARY KEY (id), 
    CONSTRAINT uq_profiles_email UNIQUE (email)
);

CREATE TABLE audit_log (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    org_id UUID NOT NULL, 
    actor_id UUID, 
    action TEXT NOT NULL, 
    entity_type TEXT NOT NULL, 
    entity_id UUID, 
    payload JSONB, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp() NOT NULL, 
    CONSTRAINT pk_audit_log PRIMARY KEY (id), 
    CONSTRAINT fk_audit_log_org_id_organizations FOREIGN KEY(org_id) REFERENCES organizations (id)
);

CREATE INDEX ix_audit_log_entity ON audit_log (entity_type, entity_id, created_at);

CREATE INDEX ix_audit_log_org_created ON audit_log (org_id, created_at);

CREATE TABLE brand_entries (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    org_id UUID NOT NULL, 
    code TEXT NOT NULL, 
    entry_type TEXT NOT NULL, 
    category TEXT, 
    title TEXT NOT NULL, 
    body TEXT NOT NULL, 
    check_mode TEXT, 
    pattern JSONB, 
    good_example TEXT, 
    bad_example TEXT, 
    severity_default TEXT, 
    is_active BOOLEAN DEFAULT true NOT NULL, 
    current_version INTEGER DEFAULT '1' NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_brand_entries PRIMARY KEY (id), 
    CONSTRAINT ck_brand_entries_category_valid CHECK (category IN ('tone', 'terminology', 'messaging', 'facts_and_claims', 'accessibility', 'visual')), 
    CONSTRAINT ck_brand_entries_check_mode_valid CHECK (check_mode IN ('deterministic', 'llm')), 
    CONSTRAINT ck_brand_entries_entry_type_valid CHECK (entry_type IN ('rule', 'fact', 'term', 'claim_rule')), 
    CONSTRAINT ck_brand_entries_severity_default_valid CHECK (severity_default IN ('high', 'medium', 'low')), 
    CONSTRAINT fk_brand_entries_org_id_organizations FOREIGN KEY(org_id) REFERENCES organizations (id), 
    CONSTRAINT uq_brand_entries_org_code UNIQUE (org_id, code)
);

CREATE INDEX ix_brand_entries_org_type_active ON brand_entries (org_id, entry_type, is_active);

CREATE TABLE content_items (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    org_id UUID NOT NULL, 
    creator_id UUID NOT NULL, 
    title TEXT NOT NULL, 
    content_type TEXT, 
    status TEXT DEFAULT 'draft' NOT NULL, 
    current_version_no INTEGER DEFAULT '1' NOT NULL, 
    reviewer_id UUID, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_content_items PRIMARY KEY (id), 
    CONSTRAINT ck_content_items_status_valid CHECK (status IN ('draft', 'checked', 'in_review', 'changes_requested', 'approved')), 
    CONSTRAINT fk_content_items_creator_id_profiles FOREIGN KEY(creator_id) REFERENCES profiles (id), 
    CONSTRAINT fk_content_items_org_id_organizations FOREIGN KEY(org_id) REFERENCES organizations (id), 
    CONSTRAINT fk_content_items_reviewer_id_profiles FOREIGN KEY(reviewer_id) REFERENCES profiles (id)
);

CREATE INDEX ix_content_items_org_status_reviewer ON content_items (org_id, status, reviewer_id);

CREATE TABLE memberships (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    org_id UUID NOT NULL, 
    user_id UUID NOT NULL, 
    role TEXT NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_memberships PRIMARY KEY (id), 
    CONSTRAINT ck_memberships_role_valid CHECK (role IN ('creator', 'reviewer', 'admin')), 
    CONSTRAINT fk_memberships_org_id_organizations FOREIGN KEY(org_id) REFERENCES organizations (id), 
    CONSTRAINT fk_memberships_user_id_profiles FOREIGN KEY(user_id) REFERENCES profiles (id), 
    CONSTRAINT uq_memberships_org_user UNIQUE (org_id, user_id)
);

CREATE TABLE attachments (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    content_id UUID NOT NULL, 
    storage_path TEXT NOT NULL, 
    mime TEXT NOT NULL, 
    size_bytes BIGINT NOT NULL, 
    alt_text TEXT, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_attachments PRIMARY KEY (id), 
    CONSTRAINT fk_attachments_content_id_content_items FOREIGN KEY(content_id) REFERENCES content_items (id)
);

CREATE TABLE brand_entry_versions (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    entry_id UUID NOT NULL, 
    version INTEGER NOT NULL, 
    snapshot JSONB NOT NULL, 
    changed_by UUID, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_brand_entry_versions PRIMARY KEY (id), 
    CONSTRAINT fk_brand_entry_versions_changed_by_profiles FOREIGN KEY(changed_by) REFERENCES profiles (id), 
    CONSTRAINT fk_brand_entry_versions_entry_id_brand_entries FOREIGN KEY(entry_id) REFERENCES brand_entries (id), 
    CONSTRAINT uq_brand_entry_versions_entry_version UNIQUE (entry_id, version)
);

CREATE TABLE content_versions (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    content_id UUID NOT NULL, 
    version_no INTEGER NOT NULL, 
    body_text TEXT NOT NULL, 
    source TEXT NOT NULL, 
    created_by UUID NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_content_versions PRIMARY KEY (id), 
    CONSTRAINT ck_content_versions_source_valid CHECK (source IN ('paste', 'upload', 'suggestion', 'manual')), 
    CONSTRAINT fk_content_versions_content_id_content_items FOREIGN KEY(content_id) REFERENCES content_items (id), 
    CONSTRAINT fk_content_versions_created_by_profiles FOREIGN KEY(created_by) REFERENCES profiles (id), 
    CONSTRAINT uq_content_versions_content_version_no UNIQUE (content_id, version_no)
);

CREATE TABLE notifications (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    user_id UUID NOT NULL, 
    content_id UUID, 
    kind TEXT NOT NULL, 
    read_at TIMESTAMP WITH TIME ZONE, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_notifications PRIMARY KEY (id), 
    CONSTRAINT fk_notifications_content_id_content_items FOREIGN KEY(content_id) REFERENCES content_items (id), 
    CONSTRAINT fk_notifications_user_id_profiles FOREIGN KEY(user_id) REFERENCES profiles (id)
);

CREATE INDEX ix_notifications_user_read ON notifications (user_id, read_at);

CREATE TABLE check_runs (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    content_version_id UUID NOT NULL, 
    org_id UUID NOT NULL, 
    status TEXT DEFAULT 'queued' NOT NULL, 
    library_manifest JSONB, 
    engine_info JSONB, 
    cache_key TEXT, 
    stats JSONB, 
    error TEXT, 
    started_at TIMESTAMP WITH TIME ZONE, 
    finished_at TIMESTAMP WITH TIME ZONE, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_check_runs PRIMARY KEY (id), 
    CONSTRAINT ck_check_runs_status_valid CHECK (status IN ('queued', 'running', 'completed', 'degraded', 'failed')), 
    CONSTRAINT fk_check_runs_content_version_id_content_versions FOREIGN KEY(content_version_id) REFERENCES content_versions (id), 
    CONSTRAINT fk_check_runs_org_id_organizations FOREIGN KEY(org_id) REFERENCES organizations (id)
);

CREATE INDEX ix_check_runs_content_version_id ON check_runs (content_version_id);

CREATE INDEX ix_check_runs_org_cache_key ON check_runs (org_id, cache_key);

CREATE TABLE review_decisions (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    content_id UUID NOT NULL, 
    version_no INTEGER NOT NULL, 
    reviewer_id UUID NOT NULL, 
    decision TEXT NOT NULL, 
    comment TEXT, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_review_decisions PRIMARY KEY (id), 
    CONSTRAINT ck_review_decisions_comment_required_for_changes CHECK (decision <> 'changes_requested' OR (comment IS NOT NULL AND length(trim(comment)) > 0)), 
    CONSTRAINT ck_review_decisions_decision_valid CHECK (decision IN ('approved', 'changes_requested')), 
    CONSTRAINT fk_review_decisions_content_version FOREIGN KEY(content_id, version_no) REFERENCES content_versions (content_id, version_no), 
    CONSTRAINT fk_review_decisions_reviewer_id_profiles FOREIGN KEY(reviewer_id) REFERENCES profiles (id)
);

CREATE INDEX ix_review_decisions_content_version ON review_decisions (content_id, version_no);

CREATE TABLE findings (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    check_run_id UUID NOT NULL, 
    org_id UUID NOT NULL, 
    category TEXT NOT NULL, 
    severity TEXT NOT NULL, 
    source_type TEXT NOT NULL, 
    entry_id UUID, 
    entry_version INTEGER, 
    secondary_entry_id UUID, 
    secondary_entry_version INTEGER, 
    span_start INTEGER NOT NULL, 
    span_end INTEGER NOT NULL, 
    span_text TEXT NOT NULL, 
    explanation TEXT NOT NULL, 
    suggestion_text TEXT, 
    confidence FLOAT, 
    label TEXT NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_findings PRIMARY KEY (id), 
    CONSTRAINT ck_findings_category_valid CHECK (category IN ('tone', 'terminology', 'messaging', 'facts_and_claims', 'accessibility', 'visual')), 
    CONSTRAINT ck_findings_grounded_or_flagged CHECK (label = 'needs_human_check' OR entry_id IS NOT NULL), 
    CONSTRAINT ck_findings_label_valid CHECK (label IN ('issue', 'unsupported_claim', 'guideline_conflict', 'needs_human_check')), 
    CONSTRAINT ck_findings_severity_valid CHECK (severity IN ('high', 'medium', 'low')), 
    CONSTRAINT ck_findings_source_type_valid CHECK (source_type IN ('rule_engine', 'ai')), 
    CONSTRAINT ck_findings_citation_pair CHECK ((entry_id IS NULL) = (entry_version IS NULL)), 
    CONSTRAINT ck_findings_secondary_citation_pair CHECK ((secondary_entry_id IS NULL) = (secondary_entry_version IS NULL)), 
    CONSTRAINT ck_findings_confidence_range CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)), 
    CONSTRAINT ck_findings_span_valid CHECK (span_start >= 0 AND span_end > span_start), 
    CONSTRAINT fk_findings_check_run_id_check_runs FOREIGN KEY(check_run_id) REFERENCES check_runs (id), 
    CONSTRAINT fk_findings_entry_version FOREIGN KEY(entry_id, entry_version) REFERENCES brand_entry_versions (entry_id, version), 
    CONSTRAINT fk_findings_org_id_organizations FOREIGN KEY(org_id) REFERENCES organizations (id), 
    CONSTRAINT fk_findings_secondary_entry_version FOREIGN KEY(secondary_entry_id, secondary_entry_version) REFERENCES brand_entry_versions (entry_id, version)
);

CREATE INDEX ix_findings_check_run_id ON findings (check_run_id);

CREATE INDEX ix_findings_org_entry ON findings (org_id, entry_id);

CREATE TABLE comments (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    content_id UUID NOT NULL, 
    version_no INTEGER NOT NULL, 
    author_id UUID NOT NULL, 
    body TEXT NOT NULL, 
    anchor_start INTEGER, 
    anchor_end INTEGER, 
    finding_id UUID, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_comments PRIMARY KEY (id), 
    CONSTRAINT ck_comments_anchor_valid CHECK ((anchor_start IS NULL AND anchor_end IS NULL) OR (anchor_start IS NOT NULL AND anchor_end IS NOT NULL AND anchor_start >= 0 AND anchor_end > anchor_start)), 
    CONSTRAINT fk_comments_author_id_profiles FOREIGN KEY(author_id) REFERENCES profiles (id), 
    CONSTRAINT fk_comments_content_version FOREIGN KEY(content_id, version_no) REFERENCES content_versions (content_id, version_no), 
    CONSTRAINT fk_comments_finding_id_findings FOREIGN KEY(finding_id) REFERENCES findings (id)
);

CREATE INDEX ix_comments_content_version ON comments (content_id, version_no);

CREATE TABLE finding_decisions (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    finding_id UUID NOT NULL, 
    actor_id UUID NOT NULL, 
    action TEXT NOT NULL, 
    reason TEXT, 
    resulting_version_id UUID, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp() NOT NULL, 
    CONSTRAINT pk_finding_decisions PRIMARY KEY (id), 
    CONSTRAINT ck_finding_decisions_action_valid CHECK (action IN ('accepted', 'edited', 'dismissed', 'confirmed', 'overridden')), 
    CONSTRAINT fk_finding_decisions_actor_id_profiles FOREIGN KEY(actor_id) REFERENCES profiles (id), 
    CONSTRAINT fk_finding_decisions_finding_id_findings FOREIGN KEY(finding_id) REFERENCES findings (id), 
    CONSTRAINT fk_finding_decisions_resulting_version_id_content_versions FOREIGN KEY(resulting_version_id) REFERENCES content_versions (id)
);

CREATE INDEX ix_finding_decisions_finding_created ON finding_decisions (finding_id, created_at);

CREATE FUNCTION forbid_change() RETURNS trigger AS $$
        BEGIN
            IF current_setting('brandguard.allow_deletion', true) = 'on' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION USING MESSAGE = TG_TABLE_NAME || ' is append-only';
        END;
        $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_change
            BEFORE UPDATE OR DELETE ON audit_log
            FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER finding_decisions_no_change
            BEFORE UPDATE OR DELETE ON finding_decisions
            FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER content_versions_no_change
            BEFORE UPDATE OR DELETE ON content_versions
            FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER brand_entry_versions_no_change
            BEFORE UPDATE OR DELETE ON brand_entry_versions
            FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE VIEW finding_current_decision AS
        SELECT DISTINCT ON (finding_id) *
        FROM finding_decisions
        ORDER BY finding_id, created_at DESC, id DESC;

INSERT INTO alembic_version (version_num) VALUES ('0001') RETURNING alembic_version.version_num;

-- Running upgrade 0001 -> 0002

ALTER TABLE check_runs ADD COLUMN mode TEXT;

ALTER TABLE check_runs ADD COLUMN library_version INTEGER;

ALTER TABLE check_runs ADD CONSTRAINT ck_check_runs_mode_valid CHECK (mode IN ('full', 'deterministic_only'));

ALTER TABLE check_runs ADD CONSTRAINT ck_check_runs_library_version_valid CHECK (library_version IS NULL OR library_version >= 0);

CREATE TABLE finding_citations (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    finding_id UUID NOT NULL, 
    entry_id UUID NOT NULL, 
    entry_version INTEGER NOT NULL, 
    quote TEXT NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_finding_citations PRIMARY KEY (id), 
    CONSTRAINT ck_finding_citations_quote_not_blank CHECK (length(trim(quote)) > 0), 
    CONSTRAINT fk_finding_citations_entry_version FOREIGN KEY(entry_id, entry_version) REFERENCES brand_entry_versions (entry_id, version), 
    CONSTRAINT fk_finding_citations_finding_id_findings FOREIGN KEY(finding_id) REFERENCES findings (id), 
    CONSTRAINT uq_finding_citations_finding_entry_version UNIQUE (finding_id, entry_id, entry_version)
);

CREATE INDEX ix_finding_citations_entry ON finding_citations (entry_id, entry_version);

CREATE TABLE suggestions (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    finding_id UUID NOT NULL, 
    before_text TEXT NOT NULL, 
    after_text TEXT NOT NULL, 
    rationale TEXT NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    CONSTRAINT pk_suggestions PRIMARY KEY (id), 
    CONSTRAINT ck_suggestions_before_text_not_empty CHECK (length(before_text) > 0), 
    CONSTRAINT ck_suggestions_rationale_not_blank CHECK (length(trim(rationale)) > 0), 
    CONSTRAINT fk_suggestions_finding_id_findings FOREIGN KEY(finding_id) REFERENCES findings (id), 
    CONSTRAINT uq_suggestions_finding_id UNIQUE (finding_id)
);

CREATE TABLE run_steps (
    id UUID DEFAULT gen_random_uuid() NOT NULL, 
    run_id UUID NOT NULL, 
    seq INTEGER NOT NULL, 
    event_type TEXT NOT NULL, 
    node TEXT, 
    kind TEXT, 
    data JSONB DEFAULT '{}'::jsonb NOT NULL, 
    latency_ms INTEGER, 
    tokens INTEGER, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT clock_timestamp() NOT NULL, 
    CONSTRAINT pk_run_steps PRIMARY KEY (id), 
    CONSTRAINT ck_run_steps_event_type_valid CHECK (event_type IN ('run.started', 'plan.created', 'tool.called', 'evidence.gap', 'reinvestigation.requested', 'critic.verdict', 'gate.rejected', 'finding.ready', 'run.degraded', 'run.completed', 'run.failed')), 
    CONSTRAINT ck_run_steps_kind_valid CHECK (kind IN ('plan', 'tool_call', 'llm_call', 'verdict', 'route', 'gate')), 
    CONSTRAINT ck_run_steps_seq_valid CHECK (seq >= 0), 
    CONSTRAINT ck_run_steps_latency_valid CHECK (latency_ms IS NULL OR latency_ms >= 0), 
    CONSTRAINT ck_run_steps_tokens_valid CHECK (tokens IS NULL OR tokens >= 0), 
    CONSTRAINT fk_run_steps_run_id_check_runs FOREIGN KEY(run_id) REFERENCES check_runs (id), 
    CONSTRAINT uq_run_steps_run_seq UNIQUE (run_id, seq)
);

ALTER TABLE findings RENAME source_type TO origin;

ALTER TABLE findings DROP CONSTRAINT ck_findings_source_type_valid;

ALTER TABLE findings ADD COLUMN display_status TEXT;

ALTER TABLE findings ADD COLUMN claim_outcome TEXT;

ALTER TABLE findings ADD COLUMN produced_by TEXT[] DEFAULT '{}'::text[] NOT NULL;

ALTER TABLE findings ADD COLUMN critic_verdict JSONB;

ALTER TABLE findings ADD COLUMN guideline_conflict BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE findings ADD COLUMN is_stale BOOLEAN DEFAULT false NOT NULL;

UPDATE findings SET
            origin = CASE origin WHEN 'rule_engine' THEN 'rule_based' ELSE origin END,
            display_status = CASE WHEN label = 'needs_human_check'
                                  THEN 'needs_human_verification' ELSE 'confirmed' END,
            claim_outcome = CASE WHEN category <> 'facts_and_claims' THEN NULL
                                 WHEN label = 'unsupported_claim' THEN 'unsupported'
                                 ELSE 'needs_human_verification' END,
            guideline_conflict = (label = 'guideline_conflict');

INSERT INTO finding_citations (finding_id, entry_id, entry_version, quote)
            SELECT f.id, f.entry_id, f.entry_version,
                   COALESCE(NULLIF(trim(v.snapshot->>'body'), ''), e.body)
            FROM findings f
            JOIN brand_entry_versions v
              ON v.entry_id = f.entry_id AND v.version = f.entry_version
            JOIN brand_entries e ON e.id = f.entry_id
            WHERE f.entry_id IS NOT NULL
            ON CONFLICT DO NOTHING;

INSERT INTO finding_citations (finding_id, entry_id, entry_version, quote)
            SELECT f.id, f.secondary_entry_id, f.secondary_entry_version,
                   COALESCE(NULLIF(trim(v.snapshot->>'body'), ''), e.body)
            FROM findings f
            JOIN brand_entry_versions v
              ON v.entry_id = f.secondary_entry_id AND v.version = f.secondary_entry_version
            JOIN brand_entries e ON e.id = f.secondary_entry_id
            WHERE f.secondary_entry_id IS NOT NULL
            ON CONFLICT DO NOTHING;

INSERT INTO suggestions (finding_id, before_text, after_text, rationale)
        SELECT id, span_text, suggestion_text,
               'Carried over from the earlier single-text suggestion.'
        FROM findings WHERE suggestion_text IS NOT NULL;

ALTER TABLE findings ALTER COLUMN display_status SET NOT NULL;

DROP INDEX ix_findings_org_entry;

ALTER TABLE findings DROP CONSTRAINT fk_findings_entry_version;

ALTER TABLE findings DROP CONSTRAINT fk_findings_secondary_entry_version;

ALTER TABLE findings DROP CONSTRAINT ck_findings_grounded_or_flagged;

ALTER TABLE findings DROP CONSTRAINT ck_findings_label_valid;

ALTER TABLE findings DROP CONSTRAINT ck_findings_citation_pair;

ALTER TABLE findings DROP CONSTRAINT ck_findings_secondary_citation_pair;

ALTER TABLE findings DROP COLUMN entry_id;

ALTER TABLE findings DROP COLUMN entry_version;

ALTER TABLE findings DROP COLUMN secondary_entry_id;

ALTER TABLE findings DROP COLUMN secondary_entry_version;

ALTER TABLE findings DROP COLUMN suggestion_text;

ALTER TABLE findings DROP COLUMN label;

ALTER TABLE findings ADD CONSTRAINT ck_findings_origin_valid CHECK (origin IN ('rule_based', 'ai'));

ALTER TABLE findings ADD CONSTRAINT ck_findings_display_status_valid CHECK (display_status IN ('confirmed', 'needs_human_verification'));

ALTER TABLE findings ADD CONSTRAINT ck_findings_claim_outcome_valid CHECK (claim_outcome IN ('supported', 'unsupported', 'partially_supported', 'conflicting_evidence', 'needs_human_verification'));

ALTER TABLE findings ADD CONSTRAINT ck_findings_claim_outcome_only_for_claims CHECK ((category = 'facts_and_claims') = (claim_outcome IS NOT NULL));

ALTER TABLE findings ADD CONSTRAINT ck_findings_span_text_length CHECK (length(span_text) = span_end - span_start);

CREATE TRIGGER finding_citations_no_change
            BEFORE UPDATE OR DELETE ON finding_citations
            FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER suggestions_no_change
            BEFORE UPDATE OR DELETE ON suggestions
            FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER run_steps_no_change
            BEFORE UPDATE OR DELETE ON run_steps
            FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE FUNCTION citation_same_org() RETURNS trigger AS $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM findings f JOIN brand_entries e ON e.org_id = f.org_id
                WHERE f.id = NEW.finding_id AND e.id = NEW.entry_id
            ) THEN
                RAISE EXCEPTION USING ERRCODE = '23514',
                    MESSAGE = 'finding_citations: entry belongs to a different organisation';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

CREATE TRIGGER finding_citations_same_org
        BEFORE INSERT ON finding_citations
        FOR EACH ROW EXECUTE FUNCTION citation_same_org();

CREATE FUNCTION finding_grounded_or_flagged() RETURNS trigger AS $$
        BEGIN
            IF NEW.display_status = 'confirmed' AND NOT EXISTS (
                SELECT 1 FROM finding_citations c WHERE c.finding_id = NEW.id
            ) THEN
                RAISE EXCEPTION USING ERRCODE = '23514',
                    MESSAGE = 'findings: a confirmed finding needs at least one citation';
            END IF;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER findings_grounded_or_flagged
        AFTER INSERT OR UPDATE OF display_status ON findings
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION finding_grounded_or_flagged();

UPDATE alembic_version SET version_num='0002' WHERE alembic_version.version_num = '0001';

COMMIT;

