"""Tests for the deterministic harness tools."""

from uuid import UUID

import pytest

from harness.tools import (
    ClaimKind,
    LinkIssueKind,
    TermEntry,
    check_link_text,
    detect_all_caps,
    detect_claim_patterns,
    lookup_banned_terms,
    make_diff,
    readability,
    segment_sentences,
)

ENTRY_A = UUID("11111111-1111-1111-1111-111111111111")
ENTRY_B = UUID("22222222-2222-2222-2222-222222222222")
SHOWCASE = "India's #1 AI-powered platform, trusted by 10 million users."


def claims(text):
    return [(item.kind, item.span_text) for item in detect_claim_patterns(text)]


def assert_spans_match(text, items):
    for item in items:
        assert text[item.span_start : item.span_end] == item.span_text


# Sentences


def test_sentences_have_exact_offsets():
    text = "  First sentence. Second one!  Third?\n\nFourth without a stop"
    sentences = segment_sentences(text)
    assert [item.span_text for item in sentences] == [
        "First sentence.",
        "Second one!",
        "Third?",
        "Fourth without a stop",
    ]
    assert_spans_match(text, sentences)


def test_sentences_do_not_split_abbreviations_or_decimals():
    text = "Dr. Rao scored 3.5 points. We are No. 1 today."
    assert [item.span_text for item in segment_sentences(text)] == [
        "Dr. Rao scored 3.5 points.",
        "We are No. 1 today.",
    ]


@pytest.mark.parametrize("text", ["", "   \n  "])
def test_sentences_handle_empty_text(text):
    assert segment_sentences(text) == []


# Banned terms


def term(*banned, preferred=None, entry_id=ENTRY_A):
    return TermEntry(entry_id=entry_id, entry_version=1, banned=list(banned), preferred=preferred)


def test_banned_term_match_carries_citation_details():
    text = "Our Cheap plan is here."
    result = lookup_banned_terms(text, [term("cheap", preferred="affordable")])
    assert len(result) == 1
    assert result[0].span_text == "Cheap"
    assert result[0].preferred == "affordable"
    assert result[0].entry_id == ENTRY_A
    assert_spans_match(text, result)


def test_banned_term_respects_word_boundaries():
    assert lookup_banned_terms("Our cheapest plan", [term("cheap")]) == []


def test_banned_term_matches_flexible_whitespace():
    text = "Our best\n  of breed tool"
    assert lookup_banned_terms(text, [term("best of breed")])[0].span_text == "best\n  of breed"


def test_banned_term_matches_curly_apostrophe():
    text = "It’s the customer’s choice"
    assert lookup_banned_terms(text, [term("customer's choice")])[0].span_text == "customer’s choice"


def test_banned_term_handles_regex_characters():
    text = "We use C++ and AI/ML (beta)."
    result = lookup_banned_terms(text, [term("C++", "AI/ML", "(beta)")])
    assert [item.span_text for item in result] == ["C++", "AI/ML", "(beta)"]


def test_longer_banned_term_wins_over_contained_term():
    result = lookup_banned_terms(
        "A cloud platform",
        [term("cloud", entry_id=ENTRY_A), term("cloud platform", entry_id=ENTRY_B)],
    )
    assert [(item.span_text, item.entry_id) for item in result] == [("cloud platform", ENTRY_B)]


def test_two_rules_banning_same_term_are_both_reported():
    result = lookup_banned_terms(
        "A cheap plan", [term("cheap", entry_id=ENTRY_A), term("cheap", entry_id=ENTRY_B)]
    )
    assert {item.entry_id for item in result} == {ENTRY_A, ENTRY_B}


def test_banned_term_ignores_blank_terms_and_empty_library():
    assert lookup_banned_terms("A cheap plan", [term("", "  ")]) == []
    assert lookup_banned_terms("A cheap plan", []) == []


# Claim patterns


def test_showcase_draft_finds_ranking_and_user_count():
    assert claims(SHOWCASE) == [
        (ClaimKind.RANKING, "#1"),
        (ClaimKind.STATISTIC, "10 million users"),
    ]
    assert_spans_match(SHOWCASE, detect_claim_patterns(SHOWCASE))


@pytest.mark.parametrize(
    "text, kind, expected",
    [
        ("We are No. 1 in India", ClaimKind.RANKING, "No. 1"),
        ("the number one choice", ClaimKind.RANKING, "number one"),
        ("a top 10 tool", ClaimKind.RANKING, "top 10"),
        ("ranked first by analysts", ClaimKind.RANKING, "ranked first"),
        ("India’s first platform", ClaimKind.RANKING, "India’s first"),
        ("the market leader today", ClaimKind.RANKING, "market leader"),
        ("the best tool", ClaimKind.SUPERLATIVE, "best"),
        ("a best-in-class tool", ClaimKind.SUPERLATIVE, "best-in-class"),
        ("our most trusted tool", ClaimKind.SUPERLATIVE, "most trusted"),
        ("an unrivalled tool", ClaimKind.SUPERLATIVE, "unrivalled"),
        ("results guaranteed", ClaimKind.GUARANTEE, "guaranteed"),
        ("a risk-free trial", ClaimKind.GUARANTEE, "risk-free"),
        ("it never fails", ClaimKind.GUARANTEE, "never fails"),
        ("100% secure by design", ClaimKind.GUARANTEE, "100% secure"),
        ("99.9% uptime", ClaimKind.STATISTIC, "99.9%"),
        ("50 percent faster", ClaimKind.STATISTIC, "50 percent"),
        ("3x faster", ClaimKind.STATISTIC, "3x"),
        ("costs ₹2,500 monthly", ClaimKind.STATISTIC, "₹2,500"),
        ("raised $5 million", ClaimKind.STATISTIC, "$5 million"),
        ("over 1,00,000 customers", ClaimKind.STATISTIC, "1,00,000 customers"),
        ("8 million registered users", ClaimKind.STATISTIC, "8 million registered users"),
        ("10k+ downloads", ClaimKind.STATISTIC, "10k+ downloads"),
        ("5 crore users", ClaimKind.STATISTIC, "5 crore users"),
        ("available in 3 languages", ClaimKind.STATISTIC, "3 languages"),
    ],
)
def test_claim_patterns(text, kind, expected):
    assert (kind, expected) in claims(text)
    assert_spans_match(text, detect_claim_patterns(text))


@pytest.mark.parametrize(
    "text",
    [
        "We were founded in 2018.",
        "Call us at 10 am on Monday.",
        "Our team writes clear guides.",
        "Version 2.5 is here.",
        "Please read chapter 3 today.",
        "",
    ],
)
def test_claim_patterns_ignore_ordinary_text(text):
    assert claims(text) == []


def test_contained_claim_is_dropped_for_the_longer_one():
    assert claims("100% guaranteed") == [(ClaimKind.GUARANTEE, "100% guaranteed")]


# Readability


def test_readability_reports_scores_for_ordinary_text():
    result = readability("The cat sat on the mat. The dog ran to the park.")
    assert result.word_count == 12
    assert result.sentence_count == 2
    assert result.average_words_per_sentence == 6
    assert result.flesch_reading_ease is not None
    assert result.flesch_kincaid_grade is not None


def test_readability_marks_short_text_as_unreliable():
    assert readability("A short post.").scores_reliable is False


def test_readability_marks_long_text_as_reliable():
    assert readability("The team writes clear guides for readers. " * 20).scores_reliable is True


def test_readability_finds_long_sentences_with_spans():
    long_sentence = " ".join(["word"] * 30) + "."
    text = f"Short one. {long_sentence}"
    result = readability(text)
    assert [item.span_text for item in result.long_sentences] == [long_sentence]
    assert_spans_match(text, result.long_sentences)


def test_simpler_text_scores_as_easier():
    simple = readability("The cat sat. The dog ran. We had fun.")
    complex_text = readability(
        "Organisational interoperability necessitates comprehensive institutional "
        "standardisation throughout multinational infrastructure."
    )
    assert simple.flesch_reading_ease > complex_text.flesch_reading_ease


@pytest.mark.parametrize("text", ["", "   ", "...!!!"])
def test_readability_handles_text_without_words(text):
    result = readability(text)
    assert result.word_count == 0
    assert result.flesch_reading_ease is None
    assert result.scores_reliable is False


# All caps


def test_all_caps_finds_passage_with_exact_span():
    text = "Hello. THIS IS A VERY BIG SALE today."
    result = detect_all_caps(text)
    assert [item.span_text for item in result] == ["THIS IS A VERY BIG SALE"]
    assert result[0].word_count == 6
    assert_spans_match(text, result)


@pytest.mark.parametrize(
    "text", ["We use AI and an API.", "Our AI API works.", "normal text", "", "Call 123 456 789"]
)
def test_all_caps_ignores_acronyms_and_normal_text(text):
    assert detect_all_caps(text) == []


def test_all_caps_runs_across_punctuation_and_numbers():
    assert detect_all_caps("BUY NOW! SALE ENDS 2026 TONIGHT")[0].span_text == (
        "BUY NOW! SALE ENDS 2026 TONIGHT"
    )


def test_all_caps_trailing_number_is_not_part_of_passage():
    assert detect_all_caps("SALE ENDS TODAY 2026")[0].span_text == "SALE ENDS TODAY"


def test_all_caps_does_not_join_separate_lines():
    assert detect_all_caps("BIG\nSALE\nNOW") == []


def test_all_caps_minimum_can_be_changed():
    assert detect_all_caps("OUR API", min_words=2)[0].span_text == "OUR API"


def test_all_caps_finds_multiple_passages():
    result = detect_all_caps("BUY THIS NOW then GET IT TODAY")
    assert [item.span_text for item in result] == ["BUY THIS NOW", "GET IT TODAY"]


# Link text


def test_markdown_non_descriptive_link():
    text = "To apply, [click here](https://example.com/apply) today."
    result = check_link_text(text)
    assert len(result) == 1
    assert result[0].kind is LinkIssueKind.NON_DESCRIPTIVE
    assert result[0].span_text == "click here"
    assert result[0].url == "https://example.com/apply"
    assert_spans_match(text, result)


def test_html_non_descriptive_link():
    text = 'Read <a class="x" href="https://example.com">Learn more</a> now.'
    result = check_link_text(text)
    assert result[0].span_text == "Learn more"
    assert result[0].url == "https://example.com"
    assert_spans_match(text, result)


@pytest.mark.parametrize("text", ["[](https://example.com)", '<a href="https://example.com"> </a>'])
def test_empty_link_reports_whole_link(text):
    result = check_link_text(text)
    assert result[0].kind is LinkIssueKind.EMPTY
    assert result[0].span_text == text


def test_descriptive_links_pass():
    text = '[Download the pricing guide](https://a.co) <a href="https://b.co">Our privacy policy</a>'
    assert check_link_text(text) == []


def test_image_syntax_is_not_a_link():
    assert check_link_text("![here](photo.png)") == []


def test_plain_click_here_is_reported():
    text = "Click here to read the guide."
    result = check_link_text(text)
    assert result[0].kind is LinkIssueKind.PLAIN_PHRASE
    assert result[0].span_text == "Click here"


def test_linked_click_here_is_reported_once():
    assert len(check_link_text("[Click here](https://example.com)")) == 1


def test_link_text_ignores_trailing_punctuation_and_case():
    assert check_link_text("[READ MORE »](https://example.com)")[0].span_text == "READ MORE »"


# Diff


def apply_changes(before, changes):
    result = before
    for change in reversed(changes):
        result = result[: change.before_start] + change.after + result[change.before_end :]
    return result


@pytest.mark.parametrize(
    "before, after",
    [
        ("trusted by 10 million users", "trusted by 8 million registered users"),
        ("India's #1 platform", "An AI-powered platform"),
        ("Remove this word now", "Remove this now"),
        ("Keep this", "Keep this and add more"),
        ("", "New text"),
        ("Old text", ""),
        ("Spaces   and\nlines", "Spaces and lines"),
    ],
)
def test_diff_changes_reproduce_the_after_text(before, after):
    result = make_diff(before, after)
    assert apply_changes(before, result.changes) == after
    for change in result.changes:
        assert before[change.before_start : change.before_end] == change.before


def test_diff_is_minimal_at_word_level():
    result = make_diff("trusted by 10 million users", "trusted by 8 million users")
    assert [(item.op, item.before, item.after) for item in result.changes] == [
        ("replace", "10", "8")
    ]


def test_identical_text_has_no_changes():
    result = make_diff("Same text", "Same text")
    assert result.changes == []
    assert result.similarity == 1


def test_diff_reports_operation_types():
    assert make_diff("A B", "A B C").changes[0].op == "insert"
    assert make_diff("A B C", "A C").changes[0].op == "delete"
    assert make_diff("A B", "A X").changes[0].op == "replace"


def test_tools_do_not_change_the_input():
    text = SHOWCASE
    detect_claim_patterns(text)
    detect_all_caps(text)
    check_link_text(text)
    readability(text)
    make_diff(text, "Different")
    assert text == SHOWCASE
