"""M4 Critic: finding verification and the bounded re-investigation loop (PRD 6.1.3, 6.1.5).

The model reviews every AI candidate. Code then makes the decision (TRD 5.3, gate 4):
- confirmed only if the critic confirms it AND says the evidence supports it, the
  highlight is right and it is a genuine violation AND it has at least one citation;
- rejected candidates are dropped and logged, never shown;
- "reinvestigate" sends the task back to its specialist with a follow-up question and
  search, while iterations remain. At the limit, the candidate is "needs_human_verification";
- anything else, including a missing or inconsistent review, is "needs_human_verification".

Rule-based findings do not pass through the critic: they are exact matches against cited
library rules, and they are the fallback when the model is unavailable.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

from pydantic import BaseModel, ConfigDict, Field

from harness.deterministic import IntakeResult
from harness.library import LibraryRepo
from harness.llm import LLMClient, LLMUnavailable, build_messages, untrusted_block
from harness.orchestrator import InvestigationTask
from harness.prompts import load_prompt
from harness.schemas import (
    DisplayStatus,
    Finding,
    RejectedFinding,
    RunContext,
    Severity,
    StrictModel,
)

MAX_ITERATIONS = 3  # the plan's investigation plus at most two re-investigation rounds
CRITIC_GATE = "critic"
Verdict = Literal["confirm", "reject", "reinvestigate", "needs_human"]


class _ModelAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CandidateReview(_ModelAnswer):
    candidate_id: str
    verdict: Verdict
    evidence_supports: bool
    span_correct: bool
    severity_justified: bool
    genuine_violation: bool
    suggested_severity: Optional[Literal["high", "medium", "low"]]
    reason: str
    follow_up_question: Optional[str] = Field(description="Only for reinvestigate, else null.")
    search_query: Optional[str] = Field(description="Only for reinvestigate, else null.")


class CriticAnswer(_ModelAnswer):
    reviews: List[CandidateReview]


class ReviewCandidate(StrictModel):
    candidate_id: str
    specialist: str
    task_id: Optional[str] = None
    finding: Finding


class ReinvestigationRequest(StrictModel):
    specialist: str
    task: InvestigationTask
    question: str
    search_query: Optional[str] = None
    span_text: str
    fallback: Finding  # shown, unconfirmed, if the follow-up produces nothing


class CriticOutcome(StrictModel):
    verified: List[Finding] = Field(default_factory=list)
    rejected: List[RejectedFinding] = Field(default_factory=list)
    requests: List[ReinvestigationRequest] = Field(default_factory=list)
    verdicts: List[Dict[str, Any]] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)
    llm_call: Optional[Dict[str, Any]] = None
    prompt_version: Optional[str] = None
    failed: bool = False
    error: Optional[str] = None


def _sentence(intake: IntakeResult, finding: Finding, draft: str) -> str:
    for sentence in intake.sentences:
        if sentence.span_start <= finding.span_start and finding.span_end <= sentence.span_end:
            return sentence.span_text
    return draft[max(0, finding.span_start - 80): finding.span_end + 80].strip()


def build_critic_messages(
    candidates: Sequence[ReviewCandidate],
    gaps: Dict[Tuple[str, str], List[str]],
    ctx: RunContext,
    intake: IntakeResult,
    library: LibraryRepo,
) -> Tuple[list, str]:
    prompt = load_prompt("critic")
    blocks = []
    for candidate in candidates:
        f = candidate.finding
        outcome = f", outcome {f.claim_outcome.value}" if f.claim_outcome else ""
        lines = [
            f"{candidate.candidate_id}: from {candidate.specialist}"
            f"{f' (task {candidate.task_id})' if candidate.task_id else ''}, "
            f"{f.category.value}, severity {f.severity.value}{outcome}",
            f'  Quote: "{f.span_text}"',
            f'  Sentence: "{_sentence(intake, f, ctx.draft)}"',
            f"  Explanation: {f.explanation}",
        ]
        if f.citations:
            lines.append("  Cited evidence:")
            for citation in f.citations:
                entry = library.get_entry(citation.entry_id)
                label = entry.public_id if entry else str(citation.entry_id)
                lines.append(f"    [{label}] {citation.quote}")
        else:
            lines.append("  Cited evidence: none")
        for gap in gaps.get((candidate.specialist, candidate.task_id or ""), []):
            lines.append(f"  Specialist's evidence gap: {gap}")
        blocks.append("\n".join(lines))
    user = "\n\n".join([
        f"Content type: {ctx.content_type}\nAudience: {ctx.audience or 'not given'}",
        "Candidates:\n\n" + "\n\n".join(blocks),
        "Draft:\n" + untrusted_block(ctx.draft),
    ])
    return build_messages(prompt.text, user), prompt.version


def _with_verdict(finding: Finding, review: Optional[CandidateReview], decision: str,
                  iteration: int, **changes: Any) -> Finding:
    verdict = {"verdict": decision, "iteration": iteration}
    if review is not None:
        verdict.update({
            "model_verdict": review.verdict,
            "evidence_supports": review.evidence_supports,
            "span_correct": review.span_correct,
            "severity_justified": review.severity_justified,
            "genuine_violation": review.genuine_violation,
            "reason": review.reason.strip(),
        })
    return finding.model_copy(update={"critic_verdict": verdict, **changes})


def apply_reviews(
    candidates: Sequence[ReviewCandidate],
    answer: CriticAnswer,
    tasks: Dict[Tuple[str, str], InvestigationTask],
    iteration: int,
    can_reinvestigate: bool,
) -> CriticOutcome:
    """Turn the critic's reviews into decisions. Code, not the model, has the final say."""
    reviews: Dict[str, CandidateReview] = {}
    outcome = CriticOutcome()
    for review in answer.reviews:
        if review.candidate_id in reviews:
            outcome.notes.append(f"Ignored a second review of {review.candidate_id}.")
        reviews.setdefault(review.candidate_id, review)

    for candidate in candidates:
        finding = candidate.finding
        review = reviews.get(candidate.candidate_id)
        needs_human = DisplayStatus.NEEDS_HUMAN_VERIFICATION
        decision = "needs_human"
        update: Dict[str, Any] = {"display_status": needs_human}

        if review is None:
            outcome.notes.append(f"The critic did not review {candidate.candidate_id}.")
        elif review.verdict == "reject":
            outcome.rejected.append(RejectedFinding(
                gate=CRITIC_GATE, reason=review.reason.strip() or "rejected by the critic",
                candidate=_with_verdict(finding, review, "reject", iteration).model_dump(mode="json")))
            decision = "reject"
        elif review.verdict == "confirm":
            if not (review.evidence_supports and review.span_correct and review.genuine_violation):
                outcome.notes.append(
                    f"{candidate.candidate_id}: confirmed by the critic but a check failed, "
                    "so it needs human verification.")
            elif not finding.citations:
                outcome.notes.append(
                    f"{candidate.candidate_id}: no citation, so it cannot be confirmed.")
            else:
                decision = "confirm"
                update["display_status"] = DisplayStatus.CONFIRMED
        elif review.verdict == "reinvestigate":
            task = tasks.get((candidate.specialist, candidate.task_id or ""))
            if not can_reinvestigate:
                outcome.notes.append(
                    f"{candidate.candidate_id}: re-investigation limit reached, "
                    "so it needs human verification.")
            elif task is None:
                outcome.notes.append(
                    f"{candidate.candidate_id}: no task to re-investigate, "
                    "so it needs human verification.")
            else:
                decision = "reinvestigate"

        if review is not None and not review.severity_justified and review.suggested_severity:
            update["severity"] = Severity(review.suggested_severity)

        outcome.verdicts.append({
            "candidate_id": candidate.candidate_id,
            "specialist": candidate.specialist,
            "task_id": candidate.task_id,
            "span_text": finding.span_text,
            "decision": decision,
            "model_verdict": review.verdict if review else None,
            "reason": review.reason.strip() if review else None,
        })
        if decision == "reject":
            continue
        decided = _with_verdict(finding, review, decision, iteration, **update)
        if decision == "reinvestigate":
            question = (review.follow_up_question or review.reason).strip()
            task = tasks[(candidate.specialist, candidate.task_id or "")]
            outcome.requests.append(ReinvestigationRequest(
                specialist=candidate.specialist,
                task=task.model_copy(update={"focus": f"{task.focus} Follow-up: {question}"}),
                question=question,
                search_query=(review.search_query or "").strip() or None,
                span_text=finding.span_text,
                fallback=decided.model_copy(update={"display_status": needs_human}),
            ))
        else:
            outcome.verified.append(decided)
    return outcome


async def run_critic(
    llm: LLMClient,
    candidates: Sequence[ReviewCandidate],
    gaps: Dict[Tuple[str, str], List[str]],
    tasks: Dict[Tuple[str, str], InvestigationTask],
    ctx: RunContext,
    intake: IntakeResult,
    library: LibraryRepo,
    iteration: int,
    can_reinvestigate: bool,
) -> CriticOutcome:
    """Review candidates. If the model fails, every candidate needs human verification."""
    if not candidates:
        return CriticOutcome()
    messages, prompt_version = build_critic_messages(candidates, gaps, ctx, intake, library)
    try:
        result = await llm.structured(
            CriticAnswer, messages, node="critic", prompt_version=prompt_version)
    except LLMUnavailable as error:
        return CriticOutcome(
            verified=[
                _with_verdict(c.finding, None, "unavailable", iteration,
                              display_status=DisplayStatus.NEEDS_HUMAN_VERIFICATION)
                for c in candidates
            ],
            failed=True,
            error=error.reason,
            prompt_version=prompt_version,
            llm_call=error.call.as_step_data() if error.call and error.call.attempts else None,
        )
    outcome = apply_reviews(candidates, result.value, tasks, iteration, can_reinvestigate)
    outcome.llm_call = result.call.as_step_data()
    outcome.prompt_version = prompt_version
    return outcome
