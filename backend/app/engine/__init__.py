"""Check Engine module (Brand check deterministic rules + Grounding Gates + LangGraph).

Exposes the unified check engine API for FastAPI routes and background tasks.
"""

from gates.core import (
    GateRejection,
    GateReport,
    apply_gates,
    citation_gate,
    schema_gate,
    span_gate,
    wording_gate,
)
from harness.corrector import apply_suggestion, locate_suggestion
from harness.deterministic import (
    deterministic_baseline,
    intake_guard,
    run_deterministic_baseline,
    run_intake_guard,
)
from harness.graph import build_graph
from harness.library import BrandEntry, EntryType, InMemoryLibraryRepo, LibraryRepo
from harness.llm import LLMClient
from harness.runner import RunBlocked, build_run_brand_check, run_brand_check
from harness.schemas import (
    Category,
    Citation,
    ClaimOutcome,
    DisplayStatus,
    Finding,
    HarnessResult,
    Origin,
    RejectedFinding,
    RunContext,
    RunEvent,
    RunEventType,
    RunMode,
    Severity,
    Suggestion,
)
from harness.seed import SHOWCASE_DRAFT, build_seed_entries

__all__ = [
    "apply_gates",
    "citation_gate",
    "schema_gate",
    "span_gate",
    "wording_gate",
    "GateRejection",
    "GateReport",
    "run_deterministic_baseline",
    "run_intake_guard",
    "intake_guard",
    "deterministic_baseline",
    "build_graph",
    "build_run_brand_check",
    "run_brand_check",
    "RunBlocked",
    "LLMClient",
    "apply_suggestion",
    "locate_suggestion",
    "BrandEntry",
    "EntryType",
    "LibraryRepo",
    "InMemoryLibraryRepo",
    "Category",
    "Severity",
    "Finding",
    "RejectedFinding",
    "Citation",
    "Suggestion",
    "ClaimOutcome",
    "DisplayStatus",
    "Origin",
    "RunContext",
    "RunEvent",
    "RunEventType",
    "RunMode",
    "HarnessResult",
    "build_seed_entries",
    "SHOWCASE_DRAFT",
]
