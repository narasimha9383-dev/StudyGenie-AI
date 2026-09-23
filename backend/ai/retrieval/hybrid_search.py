"""Hybrid lexical and semantic ranking for retrieved documents."""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List


_TERM_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]{2,}")


def _terms(value: str) -> set[str]:
    """Extract normalized terms from text."""
    return set(_TERM_PATTERN.findall(value.lower()))


def _unit_score(value: Any) -> float:
    """Coerce untrusted store scores without breaking a user query."""
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    if score != score:  # NaN
        return 0.0
    return max(0.0, min(1.0, score))


class HybridSearch:
    """Combine lexical keyword relevance with semantic similarity."""

    def __init__(
        self,
        lexical_weight: float = 0.35,
        semantic_weight: float = 0.65,
    ) -> None:
        total = float(lexical_weight) + float(semantic_weight)

        if total <= 0:
            raise ValueError("At least one search weight must be greater than zero.")

        self.lexical_weight = float(lexical_weight) / total
        self.semantic_weight = float(semantic_weight) / total

    def rank(
        self,
        query: str,
        candidates: Iterable[Dict[str, Any]],
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """Rank candidates using lexical and semantic relevance."""

        if not query.strip():
            return []

        if limit <= 0:
            return []

        query_terms = _terms(query)

        results: List[Dict[str, Any]] = []

        for candidate in candidates:
            item = dict(candidate)

            text = str(
                item.get("content")
                or item.get("document")
                or item.get("text")
                or ""
            ).strip()

            if not text:
                continue

            document_terms = _terms(text)

            lexical_score = (
                len(query_terms & document_terms)
                / max(len(query_terms), 1)
            )

            semantic_score = _unit_score(item.get("semantic_score", item.get("score", 0.0)))

            final_score = (
                self.lexical_weight * lexical_score
                + self.semantic_weight * semantic_score
            )

            item["lexical_score"] = round(lexical_score, 6)
            item["semantic_score"] = round(semantic_score, 6)
            # Preserve the retrieval score separately from the hybrid score.
            # Downstream evidence grading can then use the intended signal
            # rather than an accidentally overwritten value.
            item["hybrid_score"] = round(final_score, 6)
            item["score"] = item["hybrid_score"]

            results.append(item)

        results.sort(
            key=lambda item: item["score"],
            reverse=True,
        )

        return results[:limit]
