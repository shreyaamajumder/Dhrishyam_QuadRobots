"""Brand Library access for the harness (PRD M1, TRD 5.1 `library/`, 5.2 `retrieve_entries`).

The harness only READS the library, through the LibraryRepo interface. In
production the backend supplies a Postgres/pgvector implementation. Until that
exists, InMemoryLibraryRepo lets the graph, specialists and tests run on their own.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from enum import Enum
from typing import Any, Protocol
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import Field

from harness.schemas import Category, StrictModel
from harness.tools import TermEntry

CitationKey = tuple[UUID, int]


class EntryType(str, Enum):
    GUIDELINE = "guideline"
    FACT = "fact"
    TERM = "term"
    CLAIM_RULE = "claim_rule"


class BrandEntry(StrictModel):
    id: UUID
    public_id: str = Field(min_length=1)  # for example TONE-003; shown to humans
    entry_type: EntryType
    category: Category | None = None
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)
    good_example: str | None = None
    bad_example: str | None = None
    # term: {"banned": [...], "preferred": "..."}; fact: {"key", "value"};
    # claim_rule: {"keywords": [...], "evidence_required": True}
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    version: int = Field(default=1, ge=1)


def make_entry_id(public_id: str) -> UUID:
    """Stable ID, so the seed kit, test fixtures and replay runs never drift."""
    return uuid5(NAMESPACE_URL, f"brandguard/{public_id}")


class LibraryRepo(Protocol):
    """Read-only view of one organisation's library, as seen by one run."""

    @property
    def library_version(self) -> int: ...

    def get_entries(
        self, types: Iterable[EntryType] | None = None, active_only: bool = True
    ) -> list[BrandEntry]: ...

    def get_entry(self, entry_id: UUID) -> BrandEntry | None: ...

    def retrieve_entries(
        self, query: str, types: Iterable[EntryType] | None = None, k: int = 5
    ) -> list[BrandEntry]: ...

    def valid_citations(self) -> set[CitationKey]:
        """Feed this straight into gates.apply_gates()."""
        ...

    def term_entries(self) -> list[TermEntry]:
        """Feed this straight into tools.lookup_banned_terms()."""
        ...


_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is",
    "it", "of", "on", "or", "that", "the", "to", "with", "we", "our", "your",
}


def _tokens(text: str) -> set[str]:
    return {token for token in _TOKEN.findall(text.lower()) if token not in _STOP}


class InMemoryLibraryRepo:
    """Keyword-overlap retrieval over a list of entries. Good enough for about 40 entries."""

    def __init__(self, entries: Iterable[BrandEntry], library_version: int = 1) -> None:
        self._entries: dict[UUID, BrandEntry] = {entry.id: entry for entry in entries}
        self._library_version = library_version

    @property
    def library_version(self) -> int:
        return self._library_version

    def get_entries(
        self, types: Iterable[EntryType] | None = None, active_only: bool = True
    ) -> list[BrandEntry]:
        wanted = set(types) if types is not None else None
        return sorted(
            (
                entry
                for entry in self._entries.values()
                if (wanted is None or entry.entry_type in wanted)
                and (entry.is_active or not active_only)
            ),
            key=lambda entry: entry.public_id,
        )

    def get_entry(self, entry_id: UUID) -> BrandEntry | None:
        return self._entries.get(entry_id)

    def retrieve_entries(
        self, query: str, types: Iterable[EntryType] | None = None, k: int = 5
    ) -> list[BrandEntry]:
        query_tokens = _tokens(query)
        query_lower = query.lower()
        scored: list[tuple[int, str, BrandEntry]] = []
        for entry in self.get_entries(types):
            keywords = [str(word).lower() for word in entry.metadata.get("keywords", [])]
            haystack = f"{entry.title} {entry.body} {' '.join(keywords)}"
            score = len(query_tokens & _tokens(haystack))
            score += 2 * sum(1 for word in keywords if word and word in query_lower)
            if score > 0:
                scored.append((-score, entry.public_id, entry))
        scored.sort(key=lambda item: item[:2])
        return [entry for _, _, entry in scored[:k]]

    def valid_citations(self) -> set[CitationKey]:
        return {(entry.id, entry.version) for entry in self.get_entries()}

    def term_entries(self) -> list[TermEntry]:
        return [
            TermEntry(
                entry_id=entry.id,
                entry_version=entry.version,
                banned=list(entry.metadata.get("banned", [])),
                preferred=entry.metadata.get("preferred"),
            )
            for entry in self.get_entries([EntryType.TERM])
        ]

    # Admin-style changes. They exist so tests can prove that gates react to library changes.

    def set_active(self, public_id: str, active: bool) -> None:
        self._replace(public_id, is_active=active)

    def update_body(self, public_id: str, body: str) -> None:
        self._replace(public_id, body=body)

    def _replace(self, public_id: str, **changes: Any) -> None:
        entry_id = make_entry_id(public_id)
        entry = self._entries[entry_id]
        self._entries[entry_id] = entry.model_copy(
            update={**changes, "version": entry.version + 1}
        )
        self._library_version += 1
