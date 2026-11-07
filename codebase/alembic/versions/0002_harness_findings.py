"""harness findings, citations, suggestions and run steps

Aligns findings with the harness model (harness/schemas.py) and TRD section 6:

- findings: display_status and claim_outcome replace the single label; origin replaces
  source_type (rule_engine becomes rule_based); adds produced_by, critic_verdict,
  guideline_conflict and is_stale. Inline citation columns and suggestion_text move out.
- finding_citations: any number of citations per finding, each with the quote shown.
- suggestions: structured before_text, after_text and rationale.
- run_steps: every harness event in order, for the Investigation Trace and replay.
- check_runs: mode and library_version.

Existing rows are converted, so no data is lost on upgrade. Downgrade keeps at most two
citations per finding and only the suggestion's after_text, because 0001 has no room for more.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None

IMMUTABLE_TABLES = ("finding_citations", "suggestions", "run_steps")

CLAIM_OUTCOMES = ("supported", "unsupported", "partially_supported", "conflicting_evidence",
                  "needs_human_verification")
RUN_EVENT_TYPES = ("run.started", "plan.created", "tool.called", "evidence.gap",
                   "reinvestigation.requested", "critic.verdict", "gate.rejected",
                   "finding.ready", "run.degraded", "run.completed", "run.failed")
RUN_STEP_KINDS = ("plan", "tool_call", "llm_call", "verdict", "route", "gate")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    # ---- check_runs ---------------------------------------------------------------------
    op.add_column('check_runs', sa.Column('mode', sa.Text(), nullable=True))
    op.add_column('check_runs', sa.Column('library_version', sa.Integer(), nullable=True))
    op.create_check_constraint(op.f('ck_check_runs_mode_valid'), 'check_runs',
                               "mode IN ('full', 'deterministic_only')")
    op.create_check_constraint(op.f('ck_check_runs_library_version_valid'), 'check_runs',
                               'library_version IS NULL OR library_version >= 0')

    # ---- new tables ---------------------------------------------------------------------
    op.create_table('finding_citations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('finding_id', sa.UUID(), nullable=False),
    sa.Column('entry_id', sa.UUID(), nullable=False),
    sa.Column('entry_version', sa.Integer(), nullable=False),
    sa.Column('quote', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('length(trim(quote)) > 0', name=op.f('ck_finding_citations_quote_not_blank')),
    sa.ForeignKeyConstraint(['entry_id', 'entry_version'], ['brand_entry_versions.entry_id', 'brand_entry_versions.version'], name='fk_finding_citations_entry_version'),
    sa.ForeignKeyConstraint(['finding_id'], ['findings.id'], name=op.f('fk_finding_citations_finding_id_findings')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_finding_citations')),
    sa.UniqueConstraint('finding_id', 'entry_id', 'entry_version', name='uq_finding_citations_finding_entry_version')
    )
    op.create_index('ix_finding_citations_entry', 'finding_citations', ['entry_id', 'entry_version'], unique=False)

    op.create_table('suggestions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('finding_id', sa.UUID(), nullable=False),
    sa.Column('before_text', sa.Text(), nullable=False),
    sa.Column('after_text', sa.Text(), nullable=False),
    sa.Column('rationale', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('length(before_text) > 0', name=op.f('ck_suggestions_before_text_not_empty')),
    sa.CheckConstraint('length(trim(rationale)) > 0', name=op.f('ck_suggestions_rationale_not_blank')),
    sa.ForeignKeyConstraint(['finding_id'], ['findings.id'], name=op.f('fk_suggestions_finding_id_findings')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_suggestions')),
    sa.UniqueConstraint('finding_id', name=op.f('uq_suggestions_finding_id'))
    )

    op.create_table('run_steps',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('run_id', sa.UUID(), nullable=False),
    sa.Column('seq', sa.Integer(), nullable=False),
    sa.Column('event_type', sa.Text(), nullable=False),
    sa.Column('node', sa.Text(), nullable=True),
    sa.Column('kind', sa.Text(), nullable=True),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    sa.Column('latency_ms', sa.Integer(), nullable=True),
    sa.Column('tokens', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('clock_timestamp()'), nullable=False),
    sa.CheckConstraint(_in('event_type', RUN_EVENT_TYPES), name=op.f('ck_run_steps_event_type_valid')),
    sa.CheckConstraint(_in('kind', RUN_STEP_KINDS), name=op.f('ck_run_steps_kind_valid')),
    sa.CheckConstraint('seq >= 0', name=op.f('ck_run_steps_seq_valid')),
    sa.CheckConstraint('latency_ms IS NULL OR latency_ms >= 0', name=op.f('ck_run_steps_latency_valid')),
    sa.CheckConstraint('tokens IS NULL OR tokens >= 0', name=op.f('ck_run_steps_tokens_valid')),
    sa.ForeignKeyConstraint(['run_id'], ['check_runs.id'], name=op.f('fk_run_steps_run_id_check_runs')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_run_steps')),
    sa.UniqueConstraint('run_id', 'seq', name='uq_run_steps_run_seq')
    )

    # ---- findings: new columns, then convert existing rows --------------------------------
    op.alter_column('findings', 'source_type', new_column_name='origin')
    op.drop_constraint(op.f('ck_findings_source_type_valid'), 'findings', type_='check')
    op.add_column('findings', sa.Column('display_status', sa.Text(), nullable=True))
    op.add_column('findings', sa.Column('claim_outcome', sa.Text(), nullable=True))
    op.add_column('findings', sa.Column('produced_by', postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'::text[]"), nullable=False))
    op.add_column('findings', sa.Column('critic_verdict', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('findings', sa.Column('guideline_conflict', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('findings', sa.Column('is_stale', sa.Boolean(), server_default=sa.text('false'), nullable=False))

    op.execute("""
        UPDATE findings SET
            origin = CASE origin WHEN 'rule_engine' THEN 'rule_based' ELSE origin END,
            display_status = CASE WHEN label = 'needs_human_check'
                                  THEN 'needs_human_verification' ELSE 'confirmed' END,
            claim_outcome = CASE WHEN category <> 'facts_and_claims' THEN NULL
                                 WHEN label = 'unsupported_claim' THEN 'unsupported'
                                 ELSE 'needs_human_verification' END,
            guideline_conflict = (label = 'guideline_conflict')
    """)
    for entry_col, version_col in (("entry_id", "entry_version"),
                                   ("secondary_entry_id", "secondary_entry_version")):
        op.execute(f"""
            INSERT INTO finding_citations (finding_id, entry_id, entry_version, quote)
            SELECT f.id, f.{entry_col}, f.{version_col},
                   COALESCE(NULLIF(trim(v.snapshot->>'body'), ''), e.body)
            FROM findings f
            JOIN brand_entry_versions v
              ON v.entry_id = f.{entry_col} AND v.version = f.{version_col}
            JOIN brand_entries e ON e.id = f.{entry_col}
            WHERE f.{entry_col} IS NOT NULL
            ON CONFLICT DO NOTHING
        """)
    op.execute("""
        INSERT INTO suggestions (finding_id, before_text, after_text, rationale)
        SELECT id, span_text, suggestion_text,
               'Carried over from the earlier single-text suggestion.'
        FROM findings WHERE suggestion_text IS NOT NULL
    """)
    op.alter_column('findings', 'display_status', nullable=False)

    # ---- findings: remove the old shape ----------------------------------------------------
    op.drop_index('ix_findings_org_entry', table_name='findings')
    op.drop_constraint('fk_findings_entry_version', 'findings', type_='foreignkey')
    op.drop_constraint('fk_findings_secondary_entry_version', 'findings', type_='foreignkey')
    for name in ('ck_findings_grounded_or_flagged', 'ck_findings_label_valid',
                 'ck_findings_citation_pair', 'ck_findings_secondary_citation_pair'):
        op.drop_constraint(op.f(name), 'findings', type_='check')
    for column in ('entry_id', 'entry_version', 'secondary_entry_id', 'secondary_entry_version',
                   'suggestion_text', 'label'):
        op.drop_column('findings', column)

    op.create_check_constraint(op.f('ck_findings_origin_valid'), 'findings',
                               "origin IN ('rule_based', 'ai')")
    op.create_check_constraint(op.f('ck_findings_display_status_valid'), 'findings',
                               "display_status IN ('confirmed', 'needs_human_verification')")
    op.create_check_constraint(op.f('ck_findings_claim_outcome_valid'), 'findings',
                               _in('claim_outcome', CLAIM_OUTCOMES))
    op.create_check_constraint(op.f('ck_findings_claim_outcome_only_for_claims'), 'findings',
                               "(category = 'facts_and_claims') = (claim_outcome IS NOT NULL)")
    op.create_check_constraint(op.f('ck_findings_span_text_length'), 'findings',
                               'length(span_text) = span_end - span_start')

    # ---- rules Postgres enforces itself ----------------------------------------------------
    for table in IMMUTABLE_TABLES:
        op.execute(f"""
            CREATE TRIGGER {table}_no_change
            BEFORE UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION forbid_change()
        """)

    # Tenant isolation: a finding may only cite its own organisation's library.
    op.execute("""
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
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER finding_citations_same_org
        BEFORE INSERT ON finding_citations
        FOR EACH ROW EXECUTE FUNCTION citation_same_org()
    """)

    # Grounded or silent: checked at COMMIT, so a finding and its citations can be inserted
    # in any order inside one transaction.
    op.execute("""
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
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE CONSTRAINT TRIGGER findings_grounded_or_flagged
        AFTER INSERT OR UPDATE OF display_status ON findings
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION finding_grounded_or_flagged()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS findings_grounded_or_flagged ON findings")
    op.execute("DROP FUNCTION IF EXISTS finding_grounded_or_flagged()")
    op.execute("DROP TRIGGER IF EXISTS finding_citations_same_org ON finding_citations")
    op.execute("DROP FUNCTION IF EXISTS citation_same_org()")

    for name in ('ck_findings_origin_valid', 'ck_findings_display_status_valid',
                 'ck_findings_claim_outcome_valid', 'ck_findings_claim_outcome_only_for_claims',
                 'ck_findings_span_text_length'):
        op.drop_constraint(op.f(name), 'findings', type_='check')
    op.add_column('findings', sa.Column('entry_id', sa.UUID(), nullable=True))
    op.add_column('findings', sa.Column('entry_version', sa.Integer(), nullable=True))
    op.add_column('findings', sa.Column('secondary_entry_id', sa.UUID(), nullable=True))
    op.add_column('findings', sa.Column('secondary_entry_version', sa.Integer(), nullable=True))
    op.add_column('findings', sa.Column('suggestion_text', sa.Text(), nullable=True))
    op.add_column('findings', sa.Column('label', sa.Text(), nullable=True))

    op.execute("""
        UPDATE findings SET
            origin = CASE origin WHEN 'rule_based' THEN 'rule_engine' ELSE origin END,
            label = CASE WHEN display_status = 'needs_human_verification' THEN 'needs_human_check'
                         WHEN guideline_conflict THEN 'guideline_conflict'
                         WHEN claim_outcome IN ('unsupported', 'partially_supported',
                                                'conflicting_evidence') THEN 'unsupported_claim'
                         ELSE 'issue' END
    """)
    op.execute("""
        WITH ranked AS (
            SELECT finding_id, entry_id, entry_version,
                   row_number() OVER (PARTITION BY finding_id ORDER BY created_at, id) AS n
            FROM finding_citations
        )
        UPDATE findings f SET
            entry_id = first.entry_id, entry_version = first.entry_version,
            secondary_entry_id = second.entry_id, secondary_entry_version = second.entry_version
        FROM ranked first
        LEFT JOIN ranked second ON second.finding_id = first.finding_id AND second.n = 2
        WHERE first.finding_id = f.id AND first.n = 1
    """)
    op.execute("""
        UPDATE findings f SET suggestion_text = s.after_text
        FROM suggestions s WHERE s.finding_id = f.id
    """)
    op.alter_column('findings', 'label', nullable=False)
    op.alter_column('findings', 'origin', new_column_name='source_type')
    for column in ('is_stale', 'guideline_conflict', 'critic_verdict', 'produced_by',
                   'claim_outcome', 'display_status'):
        op.drop_column('findings', column)

    op.create_check_constraint(op.f('ck_findings_source_type_valid'), 'findings',
                               "source_type IN ('rule_engine', 'ai')")
    op.create_check_constraint(op.f('ck_findings_label_valid'), 'findings',
                               "label IN ('issue', 'unsupported_claim', 'guideline_conflict', 'needs_human_check')")
    op.create_check_constraint(op.f('ck_findings_grounded_or_flagged'), 'findings',
                               "label = 'needs_human_check' OR entry_id IS NOT NULL")
    op.create_check_constraint(op.f('ck_findings_citation_pair'), 'findings',
                               '(entry_id IS NULL) = (entry_version IS NULL)')
    op.create_check_constraint(op.f('ck_findings_secondary_citation_pair'), 'findings',
                               '(secondary_entry_id IS NULL) = (secondary_entry_version IS NULL)')
    op.create_foreign_key('fk_findings_entry_version', 'findings', 'brand_entry_versions',
                          ['entry_id', 'entry_version'], ['entry_id', 'version'])
    op.create_foreign_key('fk_findings_secondary_entry_version', 'findings', 'brand_entry_versions',
                          ['secondary_entry_id', 'secondary_entry_version'], ['entry_id', 'version'])
    op.create_index('ix_findings_org_entry', 'findings', ['org_id', 'entry_id'], unique=False)

    op.drop_table('run_steps')
    op.drop_table('suggestions')
    op.drop_index('ix_finding_citations_entry', table_name='finding_citations')
    op.drop_table('finding_citations')

    op.drop_constraint(op.f('ck_check_runs_library_version_valid'), 'check_runs', type_='check')
    op.drop_constraint(op.f('ck_check_runs_mode_valid'), 'check_runs', type_='check')
    op.drop_column('check_runs', 'library_version')
    op.drop_column('check_runs', 'mode')
