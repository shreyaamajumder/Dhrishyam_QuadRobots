from harness.library import EntryType, make_entry_id
from harness.seed import SHOWCASE_DRAFT, build_seed_entries, seed_repo
from harness.tools import detect_claim_patterns, lookup_banned_terms


def test_seed_kit_size_and_unique_ids():
    entries = build_seed_entries()
    by_type = {t: [e for e in entries if e.entry_type is t] for t in EntryType}
    assert len(by_type[EntryType.GUIDELINE]) == 15
    assert len(by_type[EntryType.FACT]) == 10
    assert len(by_type[EntryType.TERM]) == 15
    assert len(by_type[EntryType.CLAIM_RULE]) == 5
    assert len({e.id for e in entries}) == len(entries)


def test_ids_are_stable_between_builds():
    assert make_entry_id("FACT-001") == seed_repo().get_entries([EntryType.FACT])[0].id


def test_valid_citations_cover_active_entries_only():
    repo = seed_repo()
    fact = repo.get_entries([EntryType.FACT])[0]
    assert (fact.id, 1) in repo.valid_citations()
    repo.set_active("FACT-001", False)
    assert (fact.id, 1) not in repo.valid_citations()
    assert (fact.id, 2) not in repo.valid_citations()


def test_changes_bump_entry_and_library_version():
    repo = seed_repo()
    repo.update_body("FACT-001", "Lumio has 9 million registered users.")
    entry = repo.get_entry(make_entry_id("FACT-001"))
    assert entry.version == 2 and repo.library_version == 2
    assert (entry.id, 1) not in repo.valid_citations()


def test_retrieval_finds_user_fact_and_ranking_rule_for_showcase_draft():
    repo = seed_repo()
    ids = [e.public_id for e in repo.retrieve_entries(SHOWCASE_DRAFT, k=8)]
    assert "FACT-001" in ids
    assert "CLAIM-001" in ids


def test_retrieval_respects_type_filter_and_k():
    repo = seed_repo()
    found = repo.retrieve_entries("million users", types=[EntryType.FACT], k=2)
    assert len(found) <= 2 and all(e.entry_type is EntryType.FACT for e in found)


def test_retrieval_skips_inactive_and_returns_nothing_for_unrelated_text():
    repo = seed_repo()
    repo.set_active("FACT-001", False)
    assert "FACT-001" not in [e.public_id for e in repo.retrieve_entries("registered users")]
    assert repo.retrieve_entries("zzzz qqqq") == []


def test_term_entries_work_with_banned_term_tool():
    repo = seed_repo()
    matches = lookup_banned_terms("Our robot teacher helps kids.", repo.term_entries())
    assert {m.term for m in matches} == {"robot teacher", "kids"}


def test_claim_detector_and_library_work_together_on_showcase_draft():
    kinds = {c.kind.value for c in detect_claim_patterns(SHOWCASE_DRAFT)}
    assert {"ranking", "statistic"} <= kinds
