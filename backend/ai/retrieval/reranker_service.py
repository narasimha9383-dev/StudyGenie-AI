"""Semantic post-retrieval reranking for StudyGenie-AI."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List



class RerankerService:
    """Rerank retrieved documents using semantic cross-encoder relevance."""

    def __init__(
        self,
        model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2",
    ) -> None:
        # Loading the model at application start makes every RAG request fail
        # when a local cache is cold or the optional model cannot be fetched.
        # Keep the same reranking architecture, but load only when a query
        # actually needs it; RAGService can safely use hybrid ranking on error.
        self.model_name = model_name
        self.model = None

    def _get_model(self):
        if self.model is None:
            # Optional dependency: retrieval can still use hybrid ranking if
            # the cross-encoder package/model is unavailable.
            from sentence_transformers import CrossEncoder
            self.model = CrossEncoder(self.model_name)
        return self.model

    def rerank(
        self,
        query: str,
        results: Iterable[Dict[str, Any]],
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """Rerank retrieved results and return the most relevant chunks."""

        if not query.strip():
            return []

        if top_k <= 0:
            return []

        items: List[Dict[str, Any]] = []

        for result in results:
            item = dict(result)

            text = (
                item.get("content")
                or item.get("document")
                or item.get("text")
                or ""
            )

            text = str(text).strip()

            if not text:
                continue

            item["content"] = text
            items.append(item)

        if not items:
            return []

        pairs = [(query, item["content"]) for item in items]

        scores = self._get_model().predict(pairs)

        for item, score in zip(items, scores):
            item["rerank_score"] = round(float(score), 6)

        items.sort(
            key=lambda item: item["rerank_score"],
            reverse=True,
        )

        return items[:top_k]
