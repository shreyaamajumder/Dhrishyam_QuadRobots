BEGIN;

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

