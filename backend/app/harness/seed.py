"""Fictional demo brand kit for "Lumio", an AI study-planning platform.

Fictional on purpose: free LLM tiers may log inputs (TRD section 9). The facts
are built so the PRD showcase draft behaves as described in PRD 6.1.5:
    "India's #1 AI-powered platform, trusted by 10 million users"
 -> ranking has no evidence; 10 million is not supported by 8 million registered
    users (and only 2.4 million are monthly active).
"""

from __future__ import annotations

from harness.library import BrandEntry, EntryType, InMemoryLibraryRepo, make_entry_id
from harness.schemas import Category

T, M, C, A, V = (
    Category.TONE,
    Category.MESSAGING,
    Category.FACTS_AND_CLAIMS,
    Category.ACCESSIBILITY,
    Category.VISUAL,
)

# public_id, category, title, body, good_example, bad_example
_GUIDELINES = [
    ("TONE-001", T, "Friendly, plain and confident", "Write in a warm, plain voice. Be confident without sounding boastful.", "Plan your week in minutes.", "Revolutionise your learning journey."),
    ("TONE-002", T, "No hype punctuation", "Use at most one exclamation mark per piece. Never stack exclamation marks.", "Your study plan is ready.", "Your study plan is ready!!!"),
    ("TONE-003", T, "Speak to the reader as you", "Address the reader as 'you'. Do not refer to them as 'the user' in public copy.", "You can change your plan any time.", "The user can change the plan."),
    ("TONE-004", T, "No pressure or fear", "Do not use fear, guilt or false urgency to push action.", "Start whenever you are ready.", "Don't fall behind - only 2 hours left!"),
    ("MSG-001", M, "Lead with the learner benefit", "Open with what the learner gains before describing features.", "Spend less time planning and more time learning.", "Our proprietary scheduling engine v3 launches."),
    ("MSG-002", M, "AI assists, educators lead", "Describe the AI as an assistant to learners and educators, never as a replacement for teachers.", "Lumio helps teachers spot where learners struggle.", "Lumio replaces your tutor."),
    ("MSG-003", M, "No promised outcomes", "Never imply guaranteed exam results, grades or admissions.", "Learners use Lumio to prepare for exams.", "Score 95% or more with Lumio."),
    ("MSG-004", M, "No named competitors", "Do not name or directly compare against competitors in public copy.", "Lumio builds a plan around your goals.", "Better than BrandX."),
    ("ACC-001", A, "Descriptive link text", "Link text must describe the destination. Avoid 'click here' or 'read more'.", "Read the study plan guide", "Click here"),
    ("ACC-002", A, "No all-caps passages", "Do not set whole sentences or phrases in capitals. Short acronyms are fine.", "Join today.", "JOIN TODAY AND SAVE BIG."),
    ("ACC-003", A, "Reading level", "Aim for a reading grade of 8 or below for general audiences.", "Short sentences help everyone.", "Notwithstanding preceding provisions, participants are encouraged to commence."),
    ("ACC-004", A, "Alt text on every image", "Every image needs alt text that describes what it shows.", "Alt: Learner reviewing a weekly study plan on a tablet.", "Alt: image1.png"),
    ("VIS-001", V, "Logo clear space", "Keep clear space equal to the logo's height on all sides.", None, None),
    ("VIS-002", V, "Brand palette only", "Use only the approved palette: Lumio Indigo, Soft Sand and white.", None, None),
    ("VIS-003", V, "No images of real students without consent", "Do not use photos of identifiable students unless consent is on file.", None, None),
]

# public_id, key, value, body
_FACTS = [
    ("FACT-001", "registered_users", "8,000,000", "Lumio has 8 million registered users."),
    ("FACT-002", "monthly_active_users", "2,400,000", "Lumio has 2.4 million monthly active users."),
    ("FACT-003", "founded", "2018", "Lumio was founded in 2018."),
    ("FACT-004", "languages", "3", "Lumio supports 3 languages: English, Hindi and Bengali."),
    ("FACT-005", "headquarters", "Kolkata", "Lumio is headquartered in Kolkata, India."),
    ("FACT-006", "employees", "120", "Lumio has 120 employees."),
    ("FACT-007", "partner_schools", "1,200", "Lumio is used by 1,200 partner schools."),
    ("FACT-008", "uptime_target", "99.5%", "Lumio targets 99.5% monthly uptime. This is a target, not a guarantee."),
    ("FACT-009", "pricing", "Free plan; paid from Rs 199 per month", "Lumio has a free plan. Paid plans start at Rs 199 per month."),
    ("FACT-010", "independent_ranking", "none", "Lumio has not been ranked by any independent third party."),
]

# public_id, title, body, keywords
_CLAIM_RULES = [
    ("CLAIM-001", "Rankings need evidence", "Ranking claims such as #1, number one or top 10 need an approved fact that supports them.", ["#1", "no. 1", "number one", "ranked", "top 10", "market leader", "first"]),
    ("CLAIM-002", "Superlatives need evidence", "Words such as best, fastest, largest or leading need an approved fact that supports them.", ["best", "fastest", "largest", "leading", "most trusted", "unmatched", "world-class"]),
    ("CLAIM-003", "No guarantees", "Do not promise guaranteed outcomes, zero risk or money-back terms unless an approved fact allows it.", ["guarantee", "guaranteed", "risk-free", "never fails", "promise", "proven"]),
    ("CLAIM-004", "Numbers must match approved facts", "User counts, percentages and other statistics must match an approved fact exactly. Do not round up.", ["million", "users", "learners", "%", "percent", "schools", "customers"]),
    ("CLAIM-005", "Comparisons need evidence", "Comparisons such as 'better than' or 'faster than' need an approved fact.", ["better than", "faster than", "cheaper than", "more than", "outperforms"]),
]

# preferred, banned terms
_TERMS = [
    ("learners", ["kids", "pupils"]),
    ("Lumio", ["Lumio App", "LumioEdu"]),
    ("AI-assisted tutoring", ["robot teacher", "AI teacher"]),
    ("get started", ["sign up now", "register today"]),
    ("affordable", ["cheap", "dirt cheap"]),
    ("study plan", ["cheat sheet", "shortcut"]),
    ("practice questions", ["question dumps", "dumps"]),
    ("mentor", ["guru", "ninja"]),
    ("improve", ["crush", "hack"]),
    ("exam preparation", ["exam cramming", "mugging up"]),
    ("progress report", ["report card"]),
    ("learning goals", ["targets"]),
    ("free plan", ["freebie"]),
    ("data privacy", ["spy", "tracking"]),
    ("community", ["tribe", "army"]),
]


def build_seed_entries() -> list[BrandEntry]:
    entries: list[BrandEntry] = []
    for public_id, category, title, body, good, bad in _GUIDELINES:
        entries.append(BrandEntry(id=make_entry_id(public_id), public_id=public_id, entry_type=EntryType.GUIDELINE, category=category, title=title, body=body, good_example=good, bad_example=bad))
    for public_id, key, value, body in _FACTS:
        entries.append(BrandEntry(id=make_entry_id(public_id), public_id=public_id, entry_type=EntryType.FACT, category=C, title=key.replace("_", " ").capitalize(), body=body, metadata={"key": key, "value": value}))
    for public_id, title, body, keywords in _CLAIM_RULES:
        entries.append(BrandEntry(id=make_entry_id(public_id), public_id=public_id, entry_type=EntryType.CLAIM_RULE, category=C, title=title, body=body, metadata={"keywords": keywords, "evidence_required": True}))
    for number, (preferred, banned) in enumerate(_TERMS, start=1):
        public_id = f"TERM-{number:03d}"
        quoted = " or ".join(f'"{term}"' for term in banned)
        entries.append(BrandEntry(id=make_entry_id(public_id), public_id=public_id, entry_type=EntryType.TERM, category=Category.TERMINOLOGY, title=preferred, body=f'Use "{preferred}" instead of {quoted}.', metadata={"preferred": preferred, "banned": banned}))
    return entries


def seed_repo() -> InMemoryLibraryRepo:
    return InMemoryLibraryRepo(build_seed_entries(), library_version=1)


SHOWCASE_DRAFT = "India's #1 AI-powered platform, trusted by 10 million users."
