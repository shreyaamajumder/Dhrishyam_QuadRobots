"""Shared harness contracts. Place at harness/schemas.py.

The API, gates and harness all import these models, and FastAPI's OpenAPI output
generates the frontend types from them. Announce any change in the team chat first.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Awaitable, Callable, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Category(str, Enum):
    TONE = "tone"
    TERMINOLOGY = "terminology"
    MESSAGING = "messaging"
    FACTS_AND_CLAIMS = "facts_and_claims"
    ACCESSIBILITY = "accessibility"
    VISUAL = "visual"


class Severity(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class DisplayStatus(str, Enum):
    CONFIRMED = "confirmed"
    NEEDS_HUMAN_VERIFICATION = "needs_human_verification"


class ClaimOutcome(str, Enum):
    """Allowed claim labels. "false" is deliberately not an option."""

    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"
    PARTIALLY_SUPPORTED = "partially_supported"
    CONFLICTING_EVIDENCE = "conflicting_evidence"
    NEEDS_HUMAN_VERIFICATION = "needs_human_verification"


class Origin(str, Enum):
    RULE_BASED = "rule_based"
    AI = "ai"


class RunMode(str, Enum):
    FULL = "full"
    DETERMINISTIC_ONLY = "deterministic_only"


class RunEventType(str, Enum):
    RUN_STARTED = "run.started"
    PLAN_CREATED = "plan.created"
    TOOL_CALLED = "tool.called"
    EVIDENCE_GAP = "evidence.gap"
    REINVESTIGATION_REQUESTED = "reinvestigation.requested"
    CRITIC_VERDICT = "critic.verdict"
    GATE_REJECTED = "gate.rejected"
    FINDING_READY = "finding.ready"
    RUN_DEGRADED = "run.degraded"
    RUN_COMPLETED = "run.completed"
    RUN_FAILED = "run.failed"


class StrictModel(BaseModel):
    """Reject unknown fields so malformed agent output fails the schema gate."""

    model_config = ConfigDict(extra="forbid")


class Citation(StrictModel):
    entry_id: UUID
    entry_version: int = Field(ge=1)
    quote: str = Field(min_length=1)


class Suggestion(StrictModel):
    """A proposed edit only. The harness never applies it to the draft."""

    before_text: str = Field(min_length=1)
    after_text: str
    rationale: str = Field(min_length=1)


class Finding(StrictModel):
    category: Category
    severity: Severity
    display_status: DisplayStatus
    claim_outcome: ClaimOutcome | None = None
    origin: Origin
    confidence: float = Field(ge=0.0, le=1.0)
    span_start: int = Field(ge=0)
    span_end: int = Field(gt=0)
    span_text: str = Field(min_length=1)
    explanation: str = Field(min_length=1)
    produced_by: list[str] = Field(min_length=1)
    citations: list[Citation] = Field(default_factory=list)
    suggestion: Suggestion | None = None
    critic_verdict: dict[str, Any] | None = None
    guideline_conflict: bool = False

    @model_validator(mode="after")
    def check_finding_shape(self) -> "Finding":
        if self.span_end <= self.span_start:
            raise ValueError("span_end must be greater than span_start")
        if len(self.span_text) != self.span_end - self.span_start:
            raise ValueError("span_text length must match the span offsets")
        if self.display_status is DisplayStatus.CONFIRMED and not self.citations:
            raise ValueError("a confirmed finding needs at least one citation")
        return self


class RejectedFinding(StrictModel):
    """A dropped candidate. Stored in run_steps and never shown as a finding."""

    gate: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    candidate: dict[str, Any]


class RunContext(StrictModel):
    run_id: UUID
    org_id: UUID
    submission_version_id: UUID
    draft: str
    content_type: str
    audience: str | None = None
    objective: str | None = None
    library_version: int = Field(ge=0)


class RunEvent(StrictModel):
    run_id: UUID
    seq: int = Field(ge=0)
    type: RunEventType
    node: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class HarnessResult(StrictModel):
    mode: RunMode
    findings: list[Finding] = Field(default_factory=list)
    rejected: list[RejectedFinding] = Field(default_factory=list)
    plan: list[dict[str, Any]] = Field(default_factory=list)
    iterations: int = Field(default=0, ge=0)
    tool_calls: int = Field(default=0, ge=0)
    llm_provider: str | None = None
    llm_model: str | None = None
    prompt_version: str | None = None
    library_version: int = Field(ge=0)
    degraded_reason: str | None = None


EmitEvent = Callable[[RunEvent], Awaitable[None]]


class RunBrandCheck(Protocol):
    """The single entry point between the backend and the harness."""

    async def __call__(self, ctx: RunContext, emit: EmitEvent) -> HarnessResult: ...
