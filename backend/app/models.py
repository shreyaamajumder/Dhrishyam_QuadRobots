"""Database schema, section 7 of the team's TRD ("Database schema proposal").

Conventions from the spec: UUID primary keys (gen_random_uuid()), categorical columns are
TEXT + CHECK (not native enums), tenant tables carry org_id, timestamps are timestamptz.
Append-only / immutable tables are protected by triggers in the migrations:
audit_log, finding_decisions, content_versions, brand_entry_versions (0001), and
finding_citations, suggestions, run_steps (0002).

Findings follow the harness model (harness/schemas.py, TRD section 6): any number of
citations, a structured suggestion, display status and claim outcome kept separate, and
provenance (produced_by, critic_verdict). A deferred trigger keeps "grounded or silent":
a confirmed finding must have at least one citation when the transaction commits.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import ForeignKey, ForeignKeyConstraint, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# ---- allowed values (CHECK constraints) -------------------------------------------------
ROLES = ("creator", "reviewer", "admin")
ENTRY_TYPES = ("rule", "fact", "term", "claim_rule")
CATEGORIES = ("tone", "terminology", "messaging", "facts_and_claims", "accessibility", "visual")
CHECK_MODES = ("deterministic", "llm")
SEVERITIES = ("high", "medium", "low")
CONTENT_STATUSES = ("draft", "checked", "in_review", "changes_requested", "approved")
VERSION_SOURCES = ("paste", "upload", "suggestion", "manual")
RUN_STATUSES = ("queued", "running", "completed", "degraded", "failed")
RUN_MODES = ("full", "deterministic_only")
# These four match the enums in harness/schemas.py (tested in tests/test_models.py).
ORIGINS = ("rule_based", "ai")
DISPLAY_STATUSES = ("confirmed", "needs_human_verification")
CLAIM_OUTCOMES = ("supported", "unsupported", "partially_supported", "conflicting_evidence",
                  "needs_human_verification")
RUN_EVENT_TYPES = ("run.started", "plan.created", "tool.called", "evidence.gap",
                   "reinvestigation.requested", "critic.verdict", "gate.rejected",
                   "finding.ready", "run.degraded", "run.completed", "run.failed")
RUN_STEP_KINDS = ("plan", "tool_call", "llm_call", "verdict", "route", "gate")
DECISION_ACTIONS = ("accepted", "edited", "dismissed", "confirmed", "overridden")
REVIEW_DECISIONS = ("approved", "changes_requested")


def check_in(column: str, values: tuple[str, ...], name: str | None = None) -> sa.CheckConstraint:
    quoted = ", ".join(f"'{v}'" for v in values)
    return sa.CheckConstraint(f"{column} IN ({quoted})", name=name or f"{column}_valid")


def uuid_col(*args: Any, **kwargs: Any) -> Mapped[uuid.UUID]:
    return mapped_column(PG_UUID(as_uuid=True), *args, **kwargs)


def pk() -> Mapped[uuid.UUID]:
    return uuid_col(primary_key=True, server_default=sa.text("gen_random_uuid()"))


def created_at_col(func: str = "now") -> Mapped[datetime]:
    return mapped_column(sa.DateTime(timezone=True), server_default=sa.text(f"{func}()"),
                         nullable=False)


def updated_at_col() -> Mapped[datetime]:
    return mapped_column(sa.DateTime(timezone=True), server_default=sa.text("now()"),
                         onupdate=sa.func.now(), nullable=False)


# ---- tenancy and people ------------------------------------------------------------------
class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(sa.Text, nullable=False)
    # Incremented in the same transaction as any library change.
    library_version: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="1")
    created_at: Mapped[datetime] = created_at_col()


class Profile(Base):
    """Identity lives in Supabase Auth or offline local auth; id equals the auth user id."""
    __tablename__ = "profiles"
    id: Mapped[uuid.UUID] = uuid_col(primary_key=True)
    email: Mapped[str] = mapped_column(sa.Text, nullable=False, unique=True)
    display_name: Mapped[str | None] = mapped_column(sa.Text)
    password_hash: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = created_at_col()


class Membership(Base):
    """Role source of truth."""
    __tablename__ = "memberships"
    id: Mapped[uuid.UUID] = pk()
    org_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("organizations.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("profiles.id"), nullable=False)
    role: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (
        UniqueConstraint("org_id", "user_id", name="uq_memberships_org_user"),
        check_in("role", ROLES),
    )


# ---- brand library -----------------------------------------------------------------------
class BrandEntry(Base):
    __tablename__ = "brand_entries"
    id: Mapped[uuid.UUID] = pk()
    org_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("organizations.id"), nullable=False)
    code: Mapped[str] = mapped_column(sa.Text, nullable=False)  # for example R-TONE-003
    entry_type: Mapped[str] = mapped_column(sa.Text, nullable=False)
    category: Mapped[str | None] = mapped_column(sa.Text)
    title: Mapped[str] = mapped_column(sa.Text, nullable=False)
    body: Mapped[str] = mapped_column(sa.Text, nullable=False)
    check_mode: Mapped[str | None] = mapped_column(sa.Text)
    pattern: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    good_example: Mapped[str | None] = mapped_column(sa.Text)
    bad_example: Mapped[str | None] = mapped_column(sa.Text)
    severity_default: Mapped[str | None] = mapped_column(sa.Text)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.true())
    current_version: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="1")
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
    __table_args__ = (
        UniqueConstraint("org_id", "code", name="uq_brand_entries_org_code"),
        check_in("entry_type", ENTRY_TYPES),
        check_in("category", CATEGORIES),
        check_in("check_mode", CHECK_MODES),
        check_in("severity_default", SEVERITIES),
        Index("ix_brand_entries_org_type_active", "org_id", "entry_type", "is_active"),
    )


class BrandEntryVersion(Base):
    """Full snapshot per edit. Immutable. Findings cite (entry_id, version)."""
    __tablename__ = "brand_entry_versions"
    id: Mapped[uuid.UUID] = pk()
    entry_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("brand_entries.id"), nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    changed_by: Mapped[uuid.UUID | None] = uuid_col(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (UniqueConstraint("entry_id", "version", name="uq_brand_entry_versions_entry_version"),)


# ---- content -----------------------------------------------------------------------------
class ContentItem(Base):
    __tablename__ = "content_items"
    id: Mapped[uuid.UUID] = pk()
    org_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("organizations.id"), nullable=False)
    creator_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("profiles.id"), nullable=False)
    title: Mapped[str] = mapped_column(sa.Text, nullable=False)
    content_type: Mapped[str | None] = mapped_column(sa.Text)
    status: Mapped[str] = mapped_column(sa.Text, nullable=False, server_default="draft")
    current_version_no: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default="1")
    reviewer_id: Mapped[uuid.UUID | None] = uuid_col(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
    __table_args__ = (
        check_in("status", CONTENT_STATUSES),
        Index("ix_content_items_org_status_reviewer", "org_id", "status", "reviewer_id"),
    )


class ContentVersion(Base):
    """Immutable. Every edit or accepted suggestion is a new row."""
    __tablename__ = "content_versions"
    id: Mapped[uuid.UUID] = pk()
    content_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("content_items.id"), nullable=False)
    version_no: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    body_text: Mapped[str] = mapped_column(sa.Text, nullable=False)
    source: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_by: Mapped[uuid.UUID] = uuid_col(ForeignKey("profiles.id"), nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (
        UniqueConstraint("content_id", "version_no", name="uq_content_versions_content_version_no"),
        check_in("source", VERSION_SOURCES),
    )


class Attachment(Base):
    """L1 (later). Alt text feeds the accessibility checks."""
    __tablename__ = "attachments"
    id: Mapped[uuid.UUID] = pk()
    content_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("content_items.id"), nullable=False)
    storage_path: Mapped[str] = mapped_column(sa.Text, nullable=False)
    mime: Mapped[str] = mapped_column(sa.Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    alt_text: Mapped[str | None] = mapped_column(sa.Text)
    created_at: Mapped[datetime] = created_at_col()


# ---- checks and findings ---------------------------------------------------------------
class CheckRun(Base):
    __tablename__ = "check_runs"
    id: Mapped[uuid.UUID] = pk()
    content_version_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("content_versions.id"), nullable=False)
    org_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("organizations.id"), nullable=False)
    status: Mapped[str] = mapped_column(sa.Text, nullable=False, server_default="queued")
    mode: Mapped[str | None] = mapped_column(sa.Text)  # set when the run finishes
    library_version: Mapped[int | None] = mapped_column(sa.Integer)  # organisation version used
    library_manifest: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # entry id -> version used
    engine_info: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # provider, model, prompt_version
    cache_key: Mapped[str | None] = mapped_column(sa.Text)
    stats: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(sa.Text)
    started_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (
        check_in("status", RUN_STATUSES),
        check_in("mode", RUN_MODES),
        sa.CheckConstraint("library_version IS NULL OR library_version >= 0",
                           name="library_version_valid"),
        Index("ix_check_runs_content_version_id", "content_version_id"),
        Index("ix_check_runs_org_cache_key", "org_id", "cache_key"),
    )


class Finding(Base):
    """One finding from a check run. Mirrors harness.schemas.Finding."""
    __tablename__ = "findings"
    id: Mapped[uuid.UUID] = pk()
    check_run_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("check_runs.id"), nullable=False)
    org_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("organizations.id"), nullable=False)
    category: Mapped[str] = mapped_column(sa.Text, nullable=False)
    severity: Mapped[str] = mapped_column(sa.Text, nullable=False)
    display_status: Mapped[str] = mapped_column(sa.Text, nullable=False)
    claim_outcome: Mapped[str | None] = mapped_column(sa.Text)  # facts and claims only
    origin: Mapped[str] = mapped_column(sa.Text, nullable=False)
    confidence: Mapped[float | None] = mapped_column(sa.Float)
    span_start: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    span_end: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    span_text: Mapped[str] = mapped_column(sa.Text, nullable=False)
    explanation: Mapped[str] = mapped_column(sa.Text, nullable=False)
    produced_by: Mapped[list[str]] = mapped_column(ARRAY(sa.Text), nullable=False,
                                                   server_default=sa.text("'{}'::text[]"))
    critic_verdict: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    guideline_conflict: Mapped[bool] = mapped_column(sa.Boolean, nullable=False,
                                                     server_default=sa.false())
    # Set when an edit means the span no longer matches; the interface then offers a re-run.
    is_stale: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.false())
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (
        check_in("category", CATEGORIES),
        check_in("severity", SEVERITIES),
        check_in("display_status", DISPLAY_STATUSES),
        check_in("claim_outcome", CLAIM_OUTCOMES),
        check_in("origin", ORIGINS),
        sa.CheckConstraint("span_start >= 0 AND span_end > span_start", name="span_valid"),
        sa.CheckConstraint("length(span_text) = span_end - span_start", name="span_text_length"),
        sa.CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)",
                           name="confidence_range"),
        # Matches the harness wording gate: only facts and claims findings have an outcome.
        sa.CheckConstraint("(category = 'facts_and_claims') = (claim_outcome IS NOT NULL)",
                           name="claim_outcome_only_for_claims"),
        Index("ix_findings_check_run_id", "check_run_id"),
    )


class FindingCitation(Base):
    """Immutable. One row per cited (entry, version). The entry must belong to the finding's org."""
    __tablename__ = "finding_citations"
    id: Mapped[uuid.UUID] = pk()
    finding_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("findings.id"), nullable=False)
    entry_id: Mapped[uuid.UUID] = uuid_col(nullable=False)
    entry_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    quote: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (
        ForeignKeyConstraint(["entry_id", "entry_version"],
                             ["brand_entry_versions.entry_id", "brand_entry_versions.version"],
                             name="fk_finding_citations_entry_version"),
        UniqueConstraint("finding_id", "entry_id", "entry_version",
                         name="uq_finding_citations_finding_entry_version"),
        sa.CheckConstraint("length(trim(quote)) > 0", name="quote_not_blank"),
        Index("ix_finding_citations_entry", "entry_id", "entry_version"),
    )


class Suggestion(Base):
    """Immutable. A proposed edit only: it is applied only through a creator's decision."""
    __tablename__ = "suggestions"
    id: Mapped[uuid.UUID] = pk()
    finding_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("findings.id"), nullable=False,
                                             unique=True)
    before_text: Mapped[str] = mapped_column(sa.Text, nullable=False)
    after_text: Mapped[str] = mapped_column(sa.Text, nullable=False)  # may be empty (a deletion)
    rationale: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (
        sa.CheckConstraint("length(before_text) > 0", name="before_text_not_empty"),
        sa.CheckConstraint("length(trim(rationale)) > 0", name="rationale_not_blank"),
    )


class RunStep(Base):
    """Append-only. Every harness RunEvent, in order: powers the Investigation Trace and replay.

    Rejected candidates are stored here as gate.rejected events, never as findings.
    """
    __tablename__ = "run_steps"
    id: Mapped[uuid.UUID] = pk()
    run_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("check_runs.id"), nullable=False)
    seq: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(sa.Text, nullable=False)
    node: Mapped[str | None] = mapped_column(sa.Text)
    kind: Mapped[str | None] = mapped_column(sa.Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False,
                                                 server_default=sa.text("'{}'::jsonb"))
    latency_ms: Mapped[int | None] = mapped_column(sa.Integer)
    tokens: Mapped[int | None] = mapped_column(sa.Integer)
    created_at: Mapped[datetime] = created_at_col("clock_timestamp")
    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_run_steps_run_seq"),
        check_in("event_type", RUN_EVENT_TYPES),
        check_in("kind", RUN_STEP_KINDS),
        sa.CheckConstraint("seq >= 0", name="seq_valid"),
        sa.CheckConstraint("latency_ms IS NULL OR latency_ms >= 0", name="latency_valid"),
        sa.CheckConstraint("tokens IS NULL OR tokens >= 0", name="tokens_valid"),
    )


class FindingDecision(Base):
    """Append-only. The latest row per finding is its current state."""
    __tablename__ = "finding_decisions"
    id: Mapped[uuid.UUID] = pk()
    finding_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("findings.id"), nullable=False)
    actor_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("profiles.id"), nullable=False)
    action: Mapped[str] = mapped_column(sa.Text, nullable=False)
    reason: Mapped[str | None] = mapped_column(sa.Text)
    resulting_version_id: Mapped[uuid.UUID | None] = uuid_col(ForeignKey("content_versions.id"))
    created_at: Mapped[datetime] = created_at_col("clock_timestamp")
    __table_args__ = (
        check_in("action", DECISION_ACTIONS),
        Index("ix_finding_decisions_finding_created", "finding_id", "created_at"),
    )


# ---- collaboration -----------------------------------------------------------------------
class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[uuid.UUID] = pk()
    content_id: Mapped[uuid.UUID] = uuid_col(nullable=False)
    version_no: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    author_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("profiles.id"), nullable=False)
    body: Mapped[str] = mapped_column(sa.Text, nullable=False)
    anchor_start: Mapped[int | None] = mapped_column(sa.Integer)  # anchors are optional
    anchor_end: Mapped[int | None] = mapped_column(sa.Integer)
    finding_id: Mapped[uuid.UUID | None] = uuid_col(ForeignKey("findings.id"))
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (
        ForeignKeyConstraint(["content_id", "version_no"],
                             ["content_versions.content_id", "content_versions.version_no"],
                             name="fk_comments_content_version"),
        sa.CheckConstraint(
            "(anchor_start IS NULL AND anchor_end IS NULL) OR "
            "(anchor_start IS NOT NULL AND anchor_end IS NOT NULL "
            "AND anchor_start >= 0 AND anchor_end > anchor_start)", name="anchor_valid"),
        Index("ix_comments_content_version", "content_id", "version_no"),
    )


class ReviewDecision(Base):
    __tablename__ = "review_decisions"
    id: Mapped[uuid.UUID] = pk()
    content_id: Mapped[uuid.UUID] = uuid_col(nullable=False)
    version_no: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    reviewer_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("profiles.id"), nullable=False)
    decision: Mapped[str] = mapped_column(sa.Text, nullable=False)
    comment: Mapped[str | None] = mapped_column(sa.Text)
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (
        ForeignKeyConstraint(["content_id", "version_no"],
                             ["content_versions.content_id", "content_versions.version_no"],
                             name="fk_review_decisions_content_version"),
        check_in("decision", REVIEW_DECISIONS),
        sa.CheckConstraint(
            "decision <> 'changes_requested' OR (comment IS NOT NULL AND length(trim(comment)) > 0)",
            name="comment_required_for_changes"),
        Index("ix_review_decisions_content_version", "content_id", "version_no"),
    )


class Notification(Base):
    """In-app only."""
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("profiles.id"), nullable=False)
    content_id: Mapped[uuid.UUID | None] = uuid_col(ForeignKey("content_items.id"))
    kind: Mapped[str] = mapped_column(sa.Text, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read_at"),)


class AuditLog(Base):
    """Append-only."""
    __tablename__ = "audit_log"
    id: Mapped[uuid.UUID] = pk()
    org_id: Mapped[uuid.UUID] = uuid_col(ForeignKey("organizations.id"), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = uuid_col()
    action: Mapped[str] = mapped_column(sa.Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(sa.Text, nullable=False)
    entity_id: Mapped[uuid.UUID | None] = uuid_col()
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = created_at_col("clock_timestamp")
    __table_args__ = (
        Index("ix_audit_log_entity", "entity_type", "entity_id", "created_at"),
        Index("ix_audit_log_org_created", "org_id", "created_at"),
    )
