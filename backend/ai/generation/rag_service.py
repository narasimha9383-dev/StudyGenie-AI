"""
============================================================
StudyGenie AI
RAG Service
------------------------------------------------------------
Responsibilities
------------------------------------------------------------
1. Retrieve Relevant Context
2. Build RAG Prompt
3. Generate AI Response
4. Format Final Output
5. Logging
6. Error Handling
7. Statistics

Author : StudyGenie AI
============================================================
"""

from __future__ import annotations

import os
import re
import sys
import time
import math
from typing import Any, Dict, List

from dotenv import load_dotenv

from ai.core.logger import get_logger

from ai.retrieval.retrieval_service import (
    RetrievalService,
    RetrievalError,
)

from ai.retrieval.hybrid_search import HybridSearch
from ai.retrieval.reranker_service import RerankerService

from ai.generation.prompt_service import PromptService

from ai.generation.llm_service import (
    LLMService,
    LLMGenerationError,
)

from ai.generation.response_formatter import (
    ResponseFormatter,
    ResponseFormatterError,
)

from ai.generation.web_search_service import WebSearchService


# ============================================================
# Load Environment Variables
# ============================================================

load_dotenv()


# ============================================================
# Logger
# ============================================================

logger = get_logger("StudyGenie.AI.rag")


# ============================================================
# Custom Exceptions
# ============================================================

class RAGServiceError(Exception):
    """Base Exception for RAG Service."""


class ContextGenerationError(RAGServiceError):
    """Raised when context generation fails."""


class AnswerGenerationError(RAGServiceError):
    """Raised when answer generation fails."""


# ============================================================
# RAG Service
# ============================================================

class RAGService:
    """
    Production Retrieval-Augmented Generation Service.

    Workflow
    --------
    User Question
            │
            ▼
    Retrieval Service
            │
            ▼
    Prompt Service
            │
            ▼
    LLM Service
            │
            ▼
    Response Formatter
            │
            ▼
    Final Response
    """

    # ========================================================
    # Constructor
    # ========================================================

    def __init__(
        self,
        retrieval_service=None,
        hybrid_search=None,
        reranker_service=None,
        prompt_service=None,
        llm_service=None,
        response_formatter=None,
        web_search_service=None,
    ):

        logger.info("=" * 60)
        logger.info("Initializing RAG Service...")
        logger.info("=" * 60)

        self.max_context_chunks = int(
            os.getenv(
                "RAG_MAX_CONTEXT_CHUNKS",
                "5",
            )
        )

        try:
            self.relevance_threshold = float(
                os.getenv(
                    "RAG_RELEVANCE_THRESHOLD",
                    os.getenv(
                        "VECTOR_SCORE_THRESHOLD",
                        "0.3",
                    ),
                )
            )
        except (TypeError, ValueError):
            logger.warning(
                "Invalid RAG relevance threshold; using 0.3."
            )
            self.relevance_threshold = 0.3

        self.relevance_threshold = min(
            max(self.relevance_threshold, 0.0),
            1.0,
        )

        # Partial-evidence band (§7 recall/relevance decoupling). Recall now
        # returns low-scoring candidates too, so grading here decides keep vs
        # drop. This is the floor at/above which evidence may be used as
        # PARTIAL (grounded, rag_supported=True, labelled partial) instead of
        # dropped to "none". Defaults to relevance_threshold, so default
        # behaviour is byte-identical; an operator may LOWER it (never above the
        # sufficient bar) to allow honest partial grounding of mid-score
        # evidence — the "sufficient" bar itself still requires the full
        # relevance_threshold.
        try:
            self.partial_relevance_threshold = float(
                os.getenv(
                    "RAG_PARTIAL_SCORE_THRESHOLD",
                    str(self.relevance_threshold),
                )
            )
        except (TypeError, ValueError):
            self.partial_relevance_threshold = (
                self.relevance_threshold
            )

        self.partial_relevance_threshold = min(
            max(self.partial_relevance_threshold, 0.0),
            self.relevance_threshold,
        )

        # Hard cap on retrieved context characters.
        try:
            self.max_context_chars = max(
                500,
                int(
                    os.getenv(
                        "RAG_MAX_CONTEXT_CHARS",
                        "6000",
                    )
                ),
            )
        except (TypeError, ValueError):
            logger.warning(
                "Invalid RAG_MAX_CONTEXT_CHARS; using 6000."
            )
            self.max_context_chars = 6000

        try:
            self.context_max_tokens = max(
                256,
                int(os.getenv("RAG_CONTEXT_MAX_TOKENS", "2200")),
            )
        except (TypeError, ValueError):
            self.context_max_tokens = 2200

        try:
            self.min_relevant_chunks = max(
                1,
                int(
                    os.getenv(
                        "RAG_MIN_RELEVANT_CHUNKS",
                        "1",
                    )
                ),
            )
        except (TypeError, ValueError):
            self.min_relevant_chunks = 1

        # Online search is disabled by default.
        self.allow_online_search = (
            str(
                os.getenv(
                    "ALLOW_ONLINE_SEARCH",
                    "false",
                )
            )
            .strip()
            .lower()
            == "true"
        )

        self.total_requests = 0
        self.successful_requests = 0
        self.failed_requests = 0

        # ----------------------------------------------------
        # Initialize Services
        # ----------------------------------------------------

        self.retrieval_service = (
            retrieval_service
            or RetrievalService()
        )

        self.hybrid_search = (
            hybrid_search
            or HybridSearch()
        )

        self.reranker_service = (
            reranker_service
            or RerankerService()
        )

        self.prompt_service = (
            prompt_service
            or PromptService()
        )

        self.llm_service = (
            llm_service
            or LLMService()
        )

        self.response_formatter = (
            response_formatter
            or ResponseFormatter()
        )

        self.web_search_service = (
            web_search_service
            or WebSearchService()
        )

        # Warm the embedding model once at start-up (opt out via env) so the
        # first user query does not pay the model cold-start (~69s observed,
        # folded into the first retrieve). Best-effort: never blocks start-up.
        warmup_on_init = (
            str(
                os.getenv(
                    "RAG_WARMUP_ON_INIT",
                    "true",
                )
            )
            .strip()
            .lower()
            != "false"
        )

        if warmup_on_init:
            try:
                self.retrieval_service.warmup()
            except Exception as error:
                logger.warning(
                    "Embedding warmup skipped: %s",
                    error,
                )

        logger.info(
            "RAG Service initialized successfully."
        )

    # ========================================================
    # Validate Question
    # ========================================================

    def validate_question(
        self,
        question: str,
    ) -> None:
        """Validate user question."""

        if not isinstance(question, str):
            raise RAGServiceError(
                "Question must be a string."
            )

        if not question.strip():
            raise RAGServiceError(
                "Question cannot be empty."
            )

    @staticmethod
    def _normalise_conversation_history(history: Any) -> List[Dict[str, str]]:
        """Keep only a bounded, document-scoped follow-up window.

        The Node controller scopes this data to the selected PDF. This second
        defensive bound prevents an oversized request from crowding source
        evidence out of the prompt when the service is used directly.
        """
        if not isinstance(history, list):
            return []

        normalised: List[Dict[str, str]] = []

        for item in history[-3:]:
            if not isinstance(item, dict):
                continue

            prior_question = str(item.get("question") or "").strip()[:600]
            prior_answer = str(item.get("answer") or "").strip()[:1200]

            if prior_question and prior_answer:
                normalised.append({
                    "question": prior_question,
                    "answer": prior_answer,
                })

        return normalised

    @staticmethod
    def _follow_up_retrieval_query(
        question: str,
        history: List[Dict[str, str]],
    ) -> str:
        """Use the prior topic only to resolve a short follow-up reference.

        The previous answer is deliberately never added to the retrieval query:
        it is not source evidence and could bias retrieval toward an earlier
        mistake. The selected PDF remains the only retrievable corpus.
        """
        if not history:
            return question

        lowered = str(question or "").lower()
        has_reference = bool(re.search(
            r"\b(?:that|this|these|those|it|again|previous|above|same)\b"
            r"|\b(?:explain|elaborate)\s+(?:more|further)\b",
            lowered,
        ))

        # Students often omit pronouns in short follow-ups (for example,
        # "What is a GAN?" -> "Explain the generator."). Keep these focused
        # concept questions tied to the active topic without changing the
        # question shown to the user.
        short_concept_follow_up = (
            len(re.findall(r"\S+", lowered)) <= 8
            and bool(re.search(
                r"\b(?:generator|discriminator|encoder|decoder|component|"
                r"part|mechanism|architecture|working|advantages?|"
                r"limitations?|process|steps?)\b",
                lowered,
            ))
        )

        has_reference = has_reference or short_concept_follow_up

        if not has_reference:
            return question

        prior_question = history[-1].get("question", "").strip()
        return (
            f"{question}\nPrevious tutor topic: {prior_question}"
            if prior_question
            else question
        )

    # ========================================================
    # Service Information
    # ========================================================

    def get_service_information(self) -> Dict:
        """Return service configuration."""

        return {
            "service": "StudyGenie RAG",
            "max_context_chunks": self.max_context_chunks,
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
        }

    # ========================================================
    # Build Context
    # ========================================================

    def build_context(
        self,
        retrieved_chunks: List[Dict],
    ) -> List[str]:
        """Extract document text from retrieved chunks."""

        logger.info(
            "Building retrieval context..."
        )

        context = []

        for chunk in retrieved_chunks:

            document = (
                chunk.get("content")
                or chunk.get("document")
                or chunk.get("text")
                or ""
            )

            if not document:
                continue

            metadata: Dict[str, Any] = (
                self._get_metadata(chunk)
            )

            page = (
                metadata.get("page_number")
                or metadata.get("page")
            )

            section = (
                metadata.get("section")
                or metadata.get("chapter")
                or metadata.get("unit")
                or ""
            )

            subsection = (
                metadata.get("subsection")
                or ""
            )

            asset_type = str(
                metadata.get("content_type")
                or metadata.get("type")
                or metadata.get("asset_type")
                or ""
            ).lower()

            caption = (
                metadata.get("caption")
                or ""
            )

            header: List[str] = []

            if page:
                header.append(
                    f"[PAGE {page}]"
                )

            if section:
                header.append(
                    f"## {section}"
                )

            if (
                subsection
                and subsection != section
            ):
                header.append(
                    f"### {subsection}"
                )

            if (
                asset_type
                in {
                    "figure",
                    "image",
                    "chart",
                    "diagram",
                    "table",
                }
                and caption
            ):
                header.append(
                    f"[{asset_type.upper()}] {caption}"
                )

            context.append(
                "\n".join(
                    header + [document]
                )
                if header
                else document
            )

        logger.info(
            "Context built with %d chunks.",
            len(context),
        )

        return context

    # ========================================================
    # Build Prompt
    # ========================================================

    def build_prompt(
        self,
        question: str,
        context: List[str],
    ) -> str:
        """Build RAG prompt."""

        logger.info(
            "Building RAG prompt..."
        )

        return self.prompt_service.build_rag_prompt(
            question=question,
            context=context,
        )

    # ========================================================
    # Question Terms
    # ========================================================

    @staticmethod
    def _question_terms(
        question: str,
    ) -> set[str]:

        stop_words = {
            "a",
            "an",
            "and",
            "are",
            "by",
            "can",
            "do",
            "does",
            "for",
            "from",
            "how",
            "is",
            "it",
            "of",
            "on",
            "or",
            "the",
            "their",
            "this",
            "to",
            "what",
            "when",
            "why",
            "with",
            "your",
        }

        return {
            term
            for term in re.findall(
                r"[a-z0-9]{2,}",
                question.lower(),
            )
            if term not in stop_words
        }

    # ========================================================
    # Chunk Text
    # ========================================================

    @staticmethod
    def _chunk_text(
        chunk: Dict,
    ) -> str:

        value = (
            chunk.get("content")
            or chunk.get("document")
            or chunk.get("text")
            or ""
        )

        return re.sub(
            r"\s+",
            " ",
            str(value),
        ).strip()

    # ========================================================
    # Prepare Evidence
    # ========================================================

    @staticmethod
    def _evidence_score(chunk: Dict[str, Any]) -> float:
        """Return the score used for grounding decisions.

        Cross-encoder rerankers commonly return raw logits rather than a
        probability. Prefer that score when available and map it to 0..1;
        otherwise retain the semantic/vector score supplied by retrieval.
        """
        try:
            if chunk.get("rerank_score") is not None:
                value = float(chunk.get("rerank_score") or 0.0)
                if value < 0.0 or value > 1.0:
                    if value >= 0.0:
                        value = 1.0 / (1.0 + math.exp(-value))
                    else:
                        exp_value = math.exp(value)
                        value = exp_value / (1.0 + exp_value)
            else:
                value = float(
                    chunk.get("semantic_score", chunk.get("score", 0.0))
                    or 0.0
                )
        except (TypeError, ValueError, OverflowError):
            value = 0.0
        return max(0.0, min(value, 1.0))

    def _prepare_evidence(
        self,
        question: str,
        retrieved_chunks: List[Dict],
    ) -> List[Dict]:
        """Remove empty/duplicate evidence."""

        prepared = []
        seen = set()

        terms = self._question_terms(
            question
        )

        for chunk in retrieved_chunks or []:

            if not isinstance(chunk, dict):
                continue

            text = self._chunk_text(
                chunk
            )

            if not text:
                continue

            if terms:

                chunk_terms = set(
                    re.findall(
                        r"[a-z0-9]{2,}",
                        text.lower(),
                    )
                )

                lexical_overlap = (
                    terms.intersection(
                        chunk_terms
                    )
                )

                score = self._evidence_score(chunk)

                if (
                    not lexical_overlap
                    and score
                    < max(
                        self.relevance_threshold
                        + 0.2,
                        0.75,
                    )
                ):
                    continue

            key = re.sub(
                r"[^a-z0-9]+",
                " ",
                text.lower(),
            ).strip()

            if not key or key in seen:
                continue

            seen.add(key)

            normalized = dict(chunk)
            normalized["content"] = text

            prepared.append(
                normalized
            )

        return prepared

    # ========================================================
    # Classify Evidence
    # ========================================================

    def classify_evidence(
        self,
        question: str,
        retrieved_chunks: List[Dict],
    ) -> tuple[str, List[Dict], float]:

        evidence = self._prepare_evidence(
            question,
            retrieved_chunks,
        )

        if not evidence:
            return (
                "none",
                [],
                0.0,
            )

        scores = []

        for chunk in evidence:

            scores.append(self._evidence_score(chunk))

        best_score = max(
            scores,
            default=0.0,
        )

        if (
            best_score
            < self.partial_relevance_threshold
        ):
            return (
                "none",
                [],
                round(
                    max(
                        0.0,
                        min(
                            best_score,
                            1.0,
                        ),
                    ),
                    4,
                ),
            )

        terms = self._question_terms(
            question
        )

        combined_text = " ".join(chunk["content"].lower() for chunk in evidence)
        context_terms = set(re.findall(r"[a-z0-9]{2,}", combined_text))

        covered_terms = {
            term
            for term in terms
            if term in context_terms
        }

        coverage = (
            len(covered_terms)
            / len(terms)
            if terms
            else 1.0
        )

        complex_question = bool(
            re.search(
                r"\b("
                r"why|how|explain|compare|"
                r"difference|advantages?|"
                r"limitations?|steps?"
                r")\b",
                question.lower(),
            )
        )

        evidence_words = len(
            combined_text.split()
        )

        if (
            coverage >= 0.75
            and best_score
            >= self.relevance_threshold
            and (
                not complex_question
                or (
                    len(evidence) >= 2
                    and evidence_words >= 20
                )
            )
        ):
            return (
                "sufficient",
                evidence,
                round(
                    max(
                        0.0,
                        min(
                            best_score,
                            1.0,
                        ),
                    ),
                    4,
                ),
            )

        return (
            "partial",
            evidence,
            round(
                max(
                    0.0,
                    min(
                        best_score,
                        1.0,
                    ),
                ),
                4,
            ),
        )

    # ========================================================
    # Evidence Answer
    # ========================================================

    def _evidence_answer(
        self,
        evidence: List[Dict],
    ) -> str:

        return (
            "According to your uploaded material:\n\n"
            + "\n\n".join(
                chunk["content"]
                for chunk in evidence
            )
        )

    # ========================================================
    # Truncate Context
    # ========================================================

    def _truncate_context(
        self,
        context: List[str],
        budget: int | None = None,
    ) -> List[str]:

        budget = (
            budget
            or self.max_context_chars
        )

        kept: List[str] = []
        used = 0
        token_used = 0

        for block in context:

            if not block:
                continue

            block_tokens = len(re.findall(r"\S+", block))
            if used + len(block) <= budget and token_used + block_tokens <= self.context_max_tokens:
                kept.append(block)
                used += len(block)
                token_used += block_tokens
                continue

            remaining = (
                budget - used
            )

            if remaining >= 200:
                kept.append(
                    block[:remaining].rstrip()
                    + " …"
                )

            break

        return kept

    # ========================================================
    # Get Metadata
    # ========================================================

    @staticmethod
    def _get_metadata(
        chunk: Any,
    ) -> Dict[str, Any]:
        """
        Return a chunk's metadata as a plain dict.

        Handles:
        - invalid chunks
        - missing metadata
        - None metadata
        - non-dict metadata
        """

        if not isinstance(
            chunk,
            dict,
        ):
            return {}

        metadata = chunk.get(
            "metadata"
        )

        return (
            metadata
            if isinstance(
                metadata,
                dict,
            )
            else {}
        )

    # ========================================================
    # Normalize Fetched Chunks
    # ========================================================

    @staticmethod
    def _normalize_fetched_chunks(
        fetched: Any,
    ) -> List[Dict[str, Any]]:
        """
        Convert fetched chunks into internal chunk format.
        """

        if isinstance(
            fetched,
            list,
        ):
            return [
                item
                for item in fetched
                if isinstance(
                    item,
                    dict,
                )
            ]

        if isinstance(
            fetched,
            dict,
        ):

            ids = (
                fetched.get("ids")
                or []
            )

            documents = (
                fetched.get("documents")
                or []
            )

            metadatas = (
                fetched.get("metadatas")
                or []
            )

            normalized = []

            for (
                item_id,
                content,
                metadata,
            ) in zip(
                ids,
                documents,
                metadatas,
            ):

                normalized.append(
                    {
                        "id": item_id,
                        "content": content,
                        "document": content,
                        "metadata": (
                            metadata
                            if isinstance(
                                metadata,
                                dict,
                            )
                            else {}
                        ),
                        "score": 0.0,
                    }
                )

            return normalized

        return []

    # ========================================================
    # Expand Context
    # ========================================================

    def _expand_context(
        self,
        evidence: List[Dict],
        user_id: str | None = None,
        pdf_id: str | None = None,
        neighbors: int = 1,
    ) -> List[Dict]:
        """Pull up to ``neighbors`` document-order neighbours on each side of every
        matched chunk (§7 context expansion), walking the previous/next chunk_id
        links hop by hop. ``neighbors=1`` reproduces the original ±1 behaviour;
        larger values widen the window (RAG_CONTEXT_NEIGHBORS). It never fabricates
        a neighbour — only ids ingestion actually linked are fetched — and returns
        the chunks gathered so far if expansion is unavailable or fails.
        """

        if not evidence or neighbors <= 0:
            return evidence

        fetch = getattr(
            self.retrieval_service,
            "fetch_by_chunk_ids",
            None,
        )

        resolved_pdf_id = (
            pdf_id
            or self._get_metadata(
                evidence[0]
            ).get("pdf_id")
        )

        if (
            not callable(fetch)
            or not resolved_pdf_id
        ):
            return evidence

        have = set()

        for chunk in evidence:

            cid = (
                self._get_metadata(
                    chunk
                ).get("chunk_id")
                or chunk.get("id")
            )

            if cid:
                have.add(
                    str(cid)
                )

        expanded = list(evidence)
        frontier = list(evidence)

        for _hop in range(neighbors):

            wanted: List[str] = []

            for chunk in frontier:

                meta = self._get_metadata(
                    chunk
                )

                for key in (
                    "previous_chunk_id",
                    "next_chunk_id",
                ):

                    neighbour_id = str(
                        meta.get(key)
                        or ""
                    ).strip()

                    if (
                        neighbour_id
                        and neighbour_id not in have
                        and neighbour_id not in wanted
                    ):
                        wanted.append(
                            neighbour_id
                        )

            if not wanted:
                break

            try:

                neighbours = (
                    self._normalize_fetched_chunks(
                        fetch(
                            resolved_pdf_id,
                            wanted,
                            user_id=user_id,
                        )
                    )
                )

            except Exception:

                logger.warning(
                    "[RAG] context expansion failed "
                    "-> using chunks gathered so far"
                )

                break

            new_frontier: List[Dict] = []

            for neighbour in neighbours:

                cid = (
                    self._get_metadata(
                        neighbour
                    ).get("chunk_id")
                    or neighbour.get("id")
                )

                if (
                    cid
                    and str(cid) not in have
                ):

                    have.add(
                        str(cid)
                    )

                    neighbour.setdefault(
                        "semantic_score",
                        0.0,
                    )

                    neighbour[
                        "is_context_expansion"
                    ] = True

                    expanded.append(
                        neighbour
                    )

                    new_frontier.append(
                        neighbour
                    )

            if not new_frontier:
                break

            frontier = new_frontier

        return expanded

    # ========================================================
    # ORDER CONTEXT
    # ========================================================

    @staticmethod
    def _order_for_context(
        chunks: List[Dict],
    ) -> List[Dict]:
        """
        Present context in document order.

        Sort order:
        1. Page number
        2. Character start position

        Missing or invalid metadata is handled safely.
        """

        def sort_key(
            chunk: Dict,
        ) -> tuple[int, int]:

            # Always get a safe dictionary.
            metadata = (
                RAGService._get_metadata(
                    chunk
                )
            )

            # ------------------------------------------------
            # Page number
            # ------------------------------------------------

            page = 10**6

            value = metadata.get(
                "page_number"
            )

            if value is None:
                value = metadata.get(
                    "page"
                )

            try:

                if value is not None:
                    page = int(value)

            except (
                TypeError,
                ValueError,
            ):

                page = 10**6

            # ------------------------------------------------
            # Character start
            # ------------------------------------------------

            start = 0

            value = metadata.get(
                "charStart"
            )

            try:

                if value is not None:
                    start = int(value)

            except (
                TypeError,
                ValueError,
            ):

                start = 0

            return page, start

        return sorted(
            chunks or [],
            key=sort_key,
        )

    # ========================================================
    # Source Record
    # ========================================================

    @staticmethod
    def _source_record(
        chunk: Dict,
        requested_pdf_id: str | None = None,
    ) -> Dict:

        metadata = (
            RAGService._get_metadata(
                chunk
            )
        )

        pdf_id = (
            metadata.get("pdf_id")
            or metadata.get("pdfId")
            or requested_pdf_id
        )

        chunk_id = (
            metadata.get("chunk_id")
            or metadata.get("chunkId")
            or chunk.get("id")
        )

        page_number = (
            metadata.get("page_number")
            or metadata.get("page")
        )

        score = chunk.get(
            "semantic_score",
            chunk.get(
                "score",
                0.0,
            ),
        )

        try:

            score = round(
                min(
                    max(
                        float(score),
                        0.0,
                    ),
                    1.0,
                ),
                4,
            )

        except (
            TypeError,
            ValueError,
        ):

            score = 0.0

        asset_type = str(
            metadata.get("type")
            or metadata.get("asset_type")
            or "text"
        ).lower()

        return {
            "pdf_id": (
                str(pdf_id)
                if pdf_id is not None
                else None
            ),
            "chunk_id": (
                str(chunk_id)
                if chunk_id is not None
                else None
            ),
            "page_number": page_number,
            "document_name": (
                metadata.get("source")
                or metadata.get("file_name")
                or metadata.get("title")
            ),
            "score": score,
            "source_type": "PDF_RAG",
            "asset_type": asset_type,
            "caption": (
                metadata.get("caption")
                or None
            ),
        }

    # ========================================================
    # Related Concepts
    # ========================================================

    @staticmethod
    def _related_concepts(
        evidence: List[Dict],
    ) -> List[str]:

        concepts: List[str] = []
        seen = set()

        for chunk in evidence:

            metadata = (
                RAGService._get_metadata(
                    chunk
                )
            )

            label = (
                metadata.get("section")
                or metadata.get("chapter")
                or metadata.get("unit")
            )

            if (
                label
                and str(label).strip()
                and str(label).lower()
                not in seen
            ):

                seen.add(
                    str(label).lower()
                )

                concepts.append(
                    str(label).strip()
                )

            if len(concepts) >= 5:
                break

        return concepts

    # ========================================================
    # Uploaded Material Detection
    # ========================================================

    _UPLOADED_MATERIAL_CUES = re.compile(
        r"\b("
        r"this pdf|the pdf|this document|the document|"
        r"this file|the file|uploaded|my (?:notes?|material|"
        r"document|pdf|file|book|slides?)|in (?:the|this) "
        r"(?:document|pdf|material|notes?|text|chapter|book|paper|slides?)|"
        r"according to (?:the|this|my) "
        r"(?:material|document|notes?|pdf|text|book|chapter)|"
        r"as (?:shown|described|mentioned|explained|stated|given) "
        r"(?:in|on|above|below)|"
        r"figure|fig\.?|diagram|table|chart|graph|illustration|image|"
        r"chapter|section|unit|page\s*\d+"
        r")\b",
        re.IGNORECASE,
    )

    # ========================================================
    # References Uploaded Material
    # ========================================================

    @classmethod
    def _references_uploaded_material(
        cls,
        question: str,
    ) -> bool:

        return bool(
            cls._UPLOADED_MATERIAL_CUES.search(
                question or ""
            )
        )

    # ========================================================
    # Classify Query Intent
    # ========================================================

    @classmethod
    def classify_query_intent(
        cls,
        question: str,
    ) -> str:

        return (
            "pdf"
            if cls._references_uploaded_material(
                question
            )
            else "general"
        )

    # ========================================================
    # Figure Grounding Note
    # ========================================================

    @staticmethod
    def _figure_grounding_note(
        evidence: List[Dict],
    ) -> str | None:

        for chunk in evidence:

            metadata = (
                RAGService._get_metadata(
                    chunk
                )
            )

            asset_type = str(
                metadata.get("type")
                or ""
            ).lower()

            if asset_type in {
                "figure",
                "image",
                "chart",
                "diagram",
            }:

                return (
                    "\n\n"
                    "_Note: this refers to a "
                    "figure/diagram. I answered "
                    "from its caption and the "
                    "surrounding text, not from "
                    "reading the image itself._"
                )

        return None

    # ========================================================
    # Pipeline Logger
    # ========================================================

    @staticmethod
    def _log_pipeline(
        message: str,
    ) -> None:

        logger.info(message)

        print(
            message,
            file=sys.stderr,
            flush=True,
        )

    # ========================================================
    # Online Search
    # ========================================================

    def _maybe_online_search(
        self,
        question: str,
    ) -> List[Dict]:

        if not self.allow_online_search:
            return []

        try:

            return (
                self.web_search_service.search(
                    question
                )
                or []
            )

        except Exception:

            logger.warning(
                "[SEARCH] online search failed "
                "-> treating as no results"
            )

            return []

    # ========================================================
    # Answer From Search
    # ========================================================

    def _answer_from_search(
        self,
        question: str,
        results: List[Dict],
        pdf_id: str | None,
    ) -> Dict:

        snippets = [
            str(
                r.get("snippet")
                or r.get("title")
                or ""
            ).strip()
            for r in results
            if r
        ]

        context = "\n\n".join(
            s
            for s in snippets
            if s
        )[: self.max_context_chars]

        prompt = (
            self.prompt_service.build_partial_prompt(
                question,
                [context],
            )
            if context
            else self.prompt_service.build_llm_only_prompt(
                question
            )
        )

        self._log_pipeline(
            f"[SEARCH] using {len(results)} "
            "external result(s) -> ONLINE_SEARCH answer"
        )

        try:

            answer = self.generate_answer(
                prompt,
                system=(
                    self.prompt_service
                    .SYSTEM_GROUNDING
                ),
            ).strip()

            llm_used = bool(answer)

        except AnswerGenerationError:

            answer = ""
            llm_used = False

        if not answer:
            return self._insufficient_context_response(
                question,
                pdf_id,
            )

        self.successful_requests += 1

        return self.response_formatter.success(
            {
                "question": question,
                "answer": (
                    "This answer draws on "
                    "external sources, not "
                    "your uploaded material.\n\n"
                    + answer
                ),
                "mode": "online_search",
                "llm_used": llm_used,
                "rag_supported": False,
                "rag_complete": False,
                "is_from_pdf": False,
                "confidence": 0.0,
                "sources": [
                    {
                        "source_type": "ONLINE_SEARCH",
                        "url": r.get("url"),
                        "title": r.get("title"),
                    }
                    for r in results
                    if r
                ],
                "relatedConcepts": [],
                "retrievalMethod": "online-search",
                "answer_source": "ONLINE_SEARCH",
                "pdfId": pdf_id,
            }
        )

    # ========================================================
    # Insufficient Context Response
    # ========================================================

    def _general_tutor_response(
        self,
        question: str,
        pdf_id: str | None = None,
        best_score: float = 0.0,
    ) -> Dict:
        """Use the LLM only after PDF retrieval has no usable evidence.

        This is deliberately a separate mode: its answer is never marked as
        PDF-grounded and the client can show that distinction to the student.
        """
        try:
            answer = self.generate_answer(
                self.prompt_service.build_general_tutor_prompt(question),
                system=self.prompt_service.SYSTEM_GENERAL_TUTOR,
            ).strip()
        except AnswerGenerationError:
            answer = ""

        if not answer:
            return self._insufficient_context_response(
                question, pdf_id, best_score,
            )

        self.successful_requests += 1
        self._log_pipeline("[RAG] mode=GENERAL_TUTOR (no PDF evidence)")
        return self.response_formatter.success(
            {
                "question": question,
                "answer": answer,
                "mode": "general_tutor",
                "llm_used": True,
                "rag_supported": False,
                "rag_complete": False,
                "is_from_pdf": False,
                "confidence": best_score,
                "sources": [],
                "relatedConcepts": [],
                "retrievalMethod": "no-pdf-evidence",
                "answer_source": "GENERAL_TUTOR",
                "pdfId": pdf_id,
            }
        )

    def _insufficient_context_response(
        self,
        question: str,
        pdf_id: str | None = None,
        best_score: float = 0.0,
    ) -> Dict:

        self.successful_requests += 1

        self._log_pipeline(
            "[RAG] mode=INSUFFICIENT_CONTEXT "
            "(pdf question, no relevant evidence)"
        )

        return self.response_formatter.success(
            {
                "question": question,
                "answer": self.prompt_service.MISSING_INFORMATION_RESPONSE,
                "mode": "insufficient_context",
                "llm_used": False,
                "rag_supported": False,
                "rag_complete": False,
                # The selected PDF was searched, but it did not provide an
                # answer.  Do not mark this as a PDF-backed answer: the
                # frontend uses this flag to show its evidence badge.
                "is_from_pdf": False,
                "confidence": best_score,
                "sources": [],
                "relatedConcepts": [],
                "retrievalMethod": (
                    "chroma-hybrid-reranked"
                ),
                "answer_source": (
                    "INSUFFICIENT_CONTEXT"
                ),
                "pdfId": pdf_id,
            }
        )

    # ========================================================
    # Retrieval System Failure Response
    # ========================================================

    def _retrieval_failure_response(
        self,
        question: str,
        pdf_id: str | None = None,
    ) -> Dict:
        """Explicit, distinguishable response for a retrieval-infrastructure
        failure (Chroma / embedding model).

        This is deliberately NOT "no information found" and NOT an LLM-only
        answer: retrieval could not run, so the system makes no claim about the
        material either way. Counted as a failed request and tagged so the
        Node layer and diagnostics can tell it apart from a genuine no-evidence
        result. No underlying error text is echoed (avoids leaking content).
        """

        self.failed_requests += 1

        self._log_pipeline(
            "[RAG] mode=RETRIEVAL_SYSTEM_FAILURE "
            "(retrieval infrastructure error; "
            "not a no-evidence result)"
        )

        return self.response_formatter.success(
            {
                "question": question,
                "answer": (
                    "The study material could not "
                    "be searched right now due to "
                    "a temporary system error, so "
                    "no answer was generated. This "
                    "does not mean the material "
                    "lacks the information — please "
                    "try again in a moment."
                ),
                "mode": "retrieval_error",
                "llm_used": False,
                "rag_supported": False,
                "rag_complete": False,
                # Retrieval did not complete, so no PDF evidence exists for
                # this response either.
                "is_from_pdf": False,
                "confidence": 0.0,
                "sources": [],
                "relatedConcepts": [],
                "retrievalMethod": (
                    "chroma-hybrid-reranked"
                ),
                "answer_source": (
                    "RETRIEVAL_SYSTEM_FAILURE"
                ),
                "retrieval_status": (
                    "system_failure"
                ),
                "pdfId": pdf_id,
            }
        )

    # ========================================================
    # Answer Without Context
    # ========================================================

    def _answer_without_context(
        self,
        question: str,
        pdf_id: str | None = None,
        best_score: float = 0.0,
        reason: str = "no_evidence",
    ) -> Dict:

        # In document-grounded mode, a missing retrieval result is not a
        # license to use model knowledge. Returning the deterministic fallback
        # also avoids a needless CPU-bound llama.cpp call.
        logger.info("[RAG] no evidence (reason=%s); returning safe fallback", reason)
        return self._insufficient_context_response(
            question,
            pdf_id,
            best_score,
        )

    # ========================================================
    # Generate Answer
    # ========================================================

    def generate_answer(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int | None = None,
    ) -> str:

        logger.info(
            "Generating AI response..."
        )

        try:

            extra: Dict[str, Any] = (
                {
                    "max_tokens": max_tokens
                }
                if max_tokens
                else {}
            )

            answer = self.llm_service.generate(
                prompt=prompt,
                system=system,
                **extra,
            )

            logger.info(
                "AI response generated successfully."
            )

            return answer

        except LLMGenerationError as error:

            logger.exception(
                "LLM generation failed."
            )

            raise AnswerGenerationError(
                str(error)
            )

    # ========================================================
    # Ask Question
    # ========================================================

    @staticmethod
    def _resolve_funnel(
        is_ten_mark: bool,
        base_top_k: int,
    ) -> tuple[int, int, int, int]:
        """Resolve the §7 retrieve-many -> rerank -> select funnel sizes from env.

        Returns ``(retrieval_top_k, hybrid_top_k, rerank_top_k, neighbors)``.

        The defaults reproduce the previous single-``top_k`` behaviour exactly, so
        the funnel only widens when these variables are set (opt-in, §16):

        * RAG_RETRIEVAL_TOP_K  — how many chunks the vector store returns (retrieve
          MANY). 10-mark override: RAG_TEN_MARK_RETRIEVAL_TOP_K.
        * RAG_HYBRID_TOP_K     — how many survive hybrid (semantic+keyword) ranking.
        * RAG_RERANK_TOP_K     — how many survive reranking (SELECT few).
        * RAG_CONTEXT_NEIGHBORS — ±N document-order neighbours added per match.

        Each has a RAG_TEN_MARK_* variant that wins for 10-mark answers.
        """

        def _envint(names: tuple[str, ...], default: int) -> int:
            for name in names:
                raw = os.getenv(name)
                if raw is not None and str(raw).strip():
                    try:
                        return max(1, int(raw))
                    except (TypeError, ValueError):
                        logger.warning("Invalid %s; ignoring.", name)
            return default

        if is_ten_mark:
            retrieval = _envint(
                ("RAG_TEN_MARK_RETRIEVAL_TOP_K", "RAG_RETRIEVAL_TOP_K"),
                base_top_k,
            )
            hybrid = _envint(
                ("RAG_TEN_MARK_HYBRID_TOP_K", "RAG_HYBRID_TOP_K"),
                retrieval,
            )
            rerank = _envint(
                ("RAG_TEN_MARK_RERANK_TOP_K", "RAG_RERANK_TOP_K"),
                base_top_k,
            )
            neighbors = _envint(
                ("RAG_TEN_MARK_CONTEXT_NEIGHBORS", "RAG_CONTEXT_NEIGHBORS"),
                1,
            )
        else:
            retrieval = _envint(("RAG_RETRIEVAL_TOP_K",), base_top_k)
            hybrid = _envint(("RAG_HYBRID_TOP_K",), retrieval)
            rerank = _envint(("RAG_RERANK_TOP_K",), base_top_k)
            neighbors = _envint(("RAG_CONTEXT_NEIGHBORS",), 1)

        # Keep the stages coherent: never rank/rerank more than were retrieved.
        retrieval = max(retrieval, rerank, hybrid)
        hybrid = max(hybrid, rerank)
        return retrieval, hybrid, rerank, max(0, neighbors)

    @staticmethod
    def _merge_retrieval_channels(*groups: List[Dict]) -> List[Dict]:
        """Deduplicate semantic and exact-keyword candidates without losing provenance."""
        merged: List[Dict] = []
        positions: Dict[str, int] = {}
        for group in groups:
            for candidate in group or []:
                if not isinstance(candidate, dict):
                    continue
                content = RAGService._chunk_text(candidate)
                metadata = RAGService._get_metadata(candidate)
                key = str(metadata.get("chunk_id") or "") or re.sub(r"\W+", " ", content.lower())[:500]
                if not key:
                    continue
                item = dict(candidate)
                channels = set(item.get("retrieval_channels") or [])
                channels.add(str(item.get("retrieval_channel") or "semantic"))
                item["retrieval_channels"] = sorted(channels)
                if key in positions:
                    current = merged[positions[key]]
                    current_channels = set(current.get("retrieval_channels") or []) | channels
                    current["retrieval_channels"] = sorted(current_channels)
                    try:
                        if float(item.get("score", 0) or 0) > float(current.get("score", 0) or 0):
                            current.update(item)
                            current["retrieval_channels"] = sorted(current_channels)
                    except (TypeError, ValueError):
                        pass
                    continue
                positions[key] = len(merged)
                merged.append(item)
        return merged

    def ask_question(
        self,
        question: str,
        user_id: str | None = None,
        pdf_id: str | None = None,
        question_type: str | None = None,
        max_answer_tokens: int | None = None,
        conversation_history: List[Dict[str, str]] | None = None,
    ) -> Dict:

        logger.info("=" * 60)
        logger.info(
            "Processing user question..."
        )
        logger.info("=" * 60)

        self.total_requests += 1

        request_start = (
            time.perf_counter()
        )

        try:

            # --------------------------------------------
            # Validate
            # --------------------------------------------

            self.validate_question(
                question
            )

            conversation_window = self._normalise_conversation_history(
                conversation_history
            )
            retrieval_query = self._follow_up_retrieval_query(
                question,
                conversation_window,
            )

            # --------------------------------------------
            # User Isolation
            # --------------------------------------------

            if not user_id or not pdf_id:

                logger.warning(
                    "[RAG] missing user_id/pdf_id "
                    "-> isolation enforced, "
                    "retrieval skipped"
                )

                return self._answer_without_context(
                    question,
                    pdf_id=pdf_id,
                    reason="isolation",
                )

            # --------------------------------------------
            # 10-Mark Mode
            # --------------------------------------------

            is_ten_mark = (
                str(
                    question_type
                    or ""
                )
                .strip()
                .lower()
                in {
                    "10_mark",
                    "10-mark",
                    "ten_mark",
                    "10mark",
                    "exam",
                }
            )

            context_budget = (
                max(
                    self.max_context_chars,
                    9000,
                )
                if is_ten_mark
                else self.max_context_chars
            )

            try:

                answer_max_tokens = (
                    int(
                        os.getenv(
                            "RAG_TEN_MARK_MAX_TOKENS",
                            "1500",
                        )
                    )
                    if is_ten_mark
                    else None
                )

            except (
                TypeError,
                ValueError,
            ):

                answer_max_tokens = (
                    1500
                    if is_ten_mark
                    else None
                )

            # An explicit caller override (e.g. the batch Q&A path, which answers
            # 20+ questions per subprocess) wins over the env default so a long
            # per-answer budget cannot make a large set time out.
            if max_answer_tokens is not None:
                answer_max_tokens = max_answer_tokens

            # §7 funnel: retrieve MANY -> hybrid rank -> rerank to a SELECT few.
            base_top_k = (
                max(self.max_context_chunks, 8)
                if is_ten_mark
                else self.max_context_chunks
            )
            (
                retrieval_top_k,
                hybrid_top_k,
                rerank_top_k,
                context_neighbors,
            ) = self._resolve_funnel(is_ten_mark, base_top_k)

            self._log_pipeline(
                "[RAG] funnel retrieve=%d hybrid=%d rerank=%d neighbors=%d"
                % (
                    retrieval_top_k,
                    hybrid_top_k,
                    rerank_top_k,
                    context_neighbors,
                )
            )

            # --------------------------------------------
            # Multi-stage Retrieval
            # --------------------------------------------

            timings: Dict[str, float] = {}

            def log_answer_perf() -> None:
                total_ms = int((time.perf_counter() - request_start) * 1000)
                self._log_pipeline(
                    "[ANSWER-PERF] "
                    f"query_embedding={timings.get('embedding_ms', 0) / 1000:.2f}s "
                    f"chroma_retrieval={timings.get('chroma_ms', 0) / 1000:.2f}s "
                    f"filtering={timings.get('classify_ms', 0) / 1000:.2f}s "
                    f"ranking={(timings.get('rank_ms', 0) + timings.get('rerank_ms', 0)) / 1000:.2f}s "
                    f"context_building={timings.get('context_ms', 0) / 1000:.2f}s "
                    f"prompt_construction={timings.get('prompt_ms', 0) / 1000:.2f}s "
                    f"llm_generation={timings.get('llm_ms', 0) / 1000:.2f}s "
                    f"response_parsing={timings.get('response_ms', 0) / 1000:.2f}s "
                    f"total={total_ms / 1000:.2f}s"
                )

            stage_start = (
                time.perf_counter()
            )

            try:
                retrieved_chunks = (
                    self.retrieval_service
                    .retrieve_top_k(
                        query=retrieval_query,
                        top_k=retrieval_top_k,
                        user_id=user_id,
                        pdf_id=pdf_id,
                        timings=timings,
                    )
                )
            except RetrievalError as error:
                # A retrieval-infrastructure failure (Chroma / embedding model)
                # must be distinguishable in diagnostics and must NEVER be
                # silently reported as "no information found" or downgraded to
                # an LLM-only answer. Log only the exception type (no message,
                # so no document text can leak) and return the dedicated
                # system-failure response.
                timings["retrieve_ms"] = int(
                    (
                        time.perf_counter()
                        - stage_start
                    )
                    * 1000
                )
                self._log_pipeline(
                    "[RAG] retrieval_status=SYSTEM_FAILURE "
                    "retrieve_ms=%d error=%s"
                    % (
                        timings["retrieve_ms"],
                        type(error).__name__,
                    )
                )
                return self._retrieval_failure_response(
                    question,
                    pdf_id=pdf_id,
                )

            # Ensure retrieval result is a list.
            if not isinstance(
                retrieved_chunks,
                list,
            ):
                retrieved_chunks = []

            # A vector-only candidate set can omit an exact document heading.
            # Add PDF-scoped keyword matches before hybrid ranking, never from
            # another document or user. Older/fake retrieval services simply
            # skip this optional capability.
            keyword_chunks: List[Dict] = []
            keyword_retrieval = getattr(
                self.retrieval_service,
                "retrieve_keyword_candidates",
                None,
            )
            if callable(keyword_retrieval) and pdf_id:
                try:
                    keyword_chunks = keyword_retrieval(
                        retrieval_query,
                        pdf_id=pdf_id,
                        user_id=user_id,
                        limit=hybrid_top_k,
                    )
                except Exception as error:
                    logger.warning(
                        "[RAG] keyword retrieval failed; continuing semantic-only: %s",
                        type(error).__name__,
                    )
            retrieved_chunks = self._merge_retrieval_channels(
                retrieved_chunks,
                keyword_chunks,
            )

            timings["retrieve_ms"] = int(
                (
                    time.perf_counter()
                    - stage_start
                )
                * 1000
            )

            for chunk in retrieved_chunks:

                if isinstance(
                    chunk,
                    dict,
                ):
                    chunk["semantic_score"] = (
                        chunk.get(
                            "score",
                            0.0,
                        )
                    )

            # --------------------------------------------
            # Hybrid Search
            # --------------------------------------------

            stage_start = (
                time.perf_counter()
            )

            try:
                retrieved_chunks = self.hybrid_search.rank(
                    retrieval_query,
                    retrieved_chunks,
                    limit=hybrid_top_k,
                )
            except Exception as error:
                # Ranking is an optimisation, not permission to discard
                # already-isolated Chroma evidence. Continue with retrieval
                # order and report the degradation in logs.
                logger.warning("[RAG] hybrid ranking failed; using retrieval order: %s", type(error).__name__)
                retrieved_chunks = retrieved_chunks[:hybrid_top_k]

            if not isinstance(
                retrieved_chunks,
                list,
            ):
                retrieved_chunks = []

            timings["rank_ms"] = int(
                (
                    time.perf_counter()
                    - stage_start
                )
                * 1000
            )

            # --------------------------------------------
            # Reranker
            # --------------------------------------------

            stage_start = (
                time.perf_counter()
            )

            try:
                retrieved_chunks = self.reranker_service.rerank(
                    retrieval_query,
                    retrieved_chunks,
                    top_k=rerank_top_k,
                )
            except Exception as error:
                # The cross-encoder is optional at runtime. A cold model cache
                # or inference failure must not turn a valid retrieval into a
                # fabricated answer or a complete outage.
                logger.warning("[RAG] reranking failed; using hybrid ranking: %s", type(error).__name__)
                retrieved_chunks = retrieved_chunks[:rerank_top_k]

            if not isinstance(
                retrieved_chunks,
                list,
            ):
                retrieved_chunks = []

            timings["rerank_ms"] = int(
                (
                    time.perf_counter()
                    - stage_start
                )
                * 1000
            )

            # --------------------------------------------
            # Evidence Classification
            # --------------------------------------------

            stage_start = (
                time.perf_counter()
            )

            (
                evidence_level,
                evidence,
                best_score,
            ) = self.classify_evidence(
                retrieval_query,
                retrieved_chunks,
            )

            timings["classify_ms"] = int(
                (
                    time.perf_counter()
                    - stage_start
                )
                * 1000
            )

            query_intent = self.classify_query_intent(question)

            self._log_pipeline(
                "[RAG] query=\"%s\" | "
                "intent=%s | mode10=%s | "
                "retrieved=%d | "
                "best_score=%.2f | "
                "evidence=%s"
                % (
                    (
                        question or ""
                    )[:60].replace(
                        "\n",
                        " ",
                    ),
                    query_intent,
                    is_ten_mark,
                    len(retrieved_chunks),
                    best_score,
                    evidence_level,
                )
            )

            self._log_pipeline(
                "[RAG] timings "
                "retrieve_ms=%d "
                "embedding_ms=%d "
                "chroma_ms=%d "
                "rank_ms=%d "
                "rerank_ms=%d "
                "classify_ms=%d"
                % (
                    timings["retrieve_ms"],
                    timings.get("embedding_ms", 0),
                    timings.get("chroma_ms", 0),
                    timings["rank_ms"],
                    timings["rerank_ms"],
                    timings["classify_ms"],
                )
            )

            # --------------------------------------------
            # Sources
            # --------------------------------------------

            sources = [
                self._source_record(
                    chunk,
                    pdf_id,
                )
                for chunk in evidence
            ]

            resolved_pdf_id = (
                pdf_id
                or (
                    sources[0].get(
                        "pdf_id"
                    )
                    if sources
                    else None
                )
            )

            related_concepts = (
                self._related_concepts(
                    evidence
                )
            )

            # ============================================
            # No Relevant Evidence
            # ============================================

            if evidence_level == "none":
                # The user selected general Tutor fallback. It is explicitly
                # tagged as non-PDF content so the UI never presents it as
                # retrieved evidence.
                return self._general_tutor_response(
                    question,
                    pdf_id=pdf_id,
                    best_score=best_score,
                )

            # ============================================
            # Context Expansion
            # ============================================

            stage_start = (
                time.perf_counter()
            )

            context_chunks = (
                self._order_for_context(
                    self._expand_context(
                        evidence,
                        user_id=user_id,
                        pdf_id=resolved_pdf_id,
                        neighbors=context_neighbors,
                    )
                )
            )

            timings["expand_ms"] = int(
                (
                    time.perf_counter()
                    - stage_start
                )
                * 1000
            )

            # --------------------------------------------
            # Build Context
            # --------------------------------------------

            stage_start = time.perf_counter()
            context = (
                self._truncate_context(
                    self.build_context(
                        context_chunks
                    ),
                    budget=context_budget,
                )
            )
            timings["context_ms"] = int((time.perf_counter() - stage_start) * 1000)

            logger.info(
                "[RAG] context_blocks=%d "
                "context_chars=%d "
                "expand_ms=%d",
                len(context),
                sum(
                    len(block)
                    for block in context
                ),
                timings["expand_ms"],
            )

            # ============================================
            # RAG ONLY
            # ============================================

            if evidence_level == "sufficient":

                logger.info(
                    "[RAG] mode=RAG_ONLY "
                    "(sufficient) -> "
                    "LLM grounded in context"
                )

                self._log_pipeline(
                    "[LLM] generating grounded "
                    "answer (mode=RAG_ONLY%s)"
                    % (
                        "/10_mark"
                        if is_ten_mark
                        else ""
                    )
                )

                stage_start = time.perf_counter()
                prompt = (
                    self.prompt_service
                    .build_ten_mark_prompt(
                        question,
                        context,
                        partial=False,
                        conversation_history=conversation_window,
                    )
                    if is_ten_mark
                    else self.prompt_service
                    .build_rag_only_prompt(
                        question,
                        context,
                        conversation_history=conversation_window,
                    )
                )
                timings["prompt_ms"] = int((time.perf_counter() - stage_start) * 1000)

                gen_start = (
                    time.perf_counter()
                )

                try:

                    answer = (
                        self.generate_answer(
                            prompt,
                            system=(
                                self.prompt_service
                                .SYSTEM_GROUNDING
                            ),
                            max_tokens=(
                                answer_max_tokens
                            ),
                        )
                        .strip()
                    )

                    if not answer:
                        raise AnswerGenerationError(
                            "LLM returned an "
                            "empty grounded answer."
                        )

                    llm_used = True
                    answer_error = None

                except AnswerGenerationError as error:

                    logger.warning(
                        "[RAG] RAG_ONLY LLM failed "
                        "-> returning evidence text"
                    )

                    answer = (
                        self._evidence_answer(
                            evidence
                        )
                    )

                    llm_used = False
                    answer_error = str(error)

                self._log_pipeline(
                    "[LLM] timings "
                    "generate_ms=%d "
                    "total_ms=%d "
                    "mode=rag"
                    % (
                        int(
                            (
                                time.perf_counter()
                                - gen_start
                            )
                            * 1000
                        ),
                        int(
                            (
                                time.perf_counter()
                                - request_start
                            )
                            * 1000
                        ),
                    )
                )
                timings["llm_ms"] = int((time.perf_counter() - gen_start) * 1000)

                # Figure note
                figure_note = (
                    self._figure_grounding_note(
                        evidence
                    )
                )

                if figure_note:
                    answer = (
                        f"{answer}"
                        f"{figure_note}"
                    )

                self.successful_requests += 1

                payload = {
                    "question": question,
                    "answer": answer,
                    "mode": "rag",
                    "llm_used": llm_used,
                    "rag_supported": True,
                    "rag_complete": True,
                    "is_from_pdf": True,
                    "confidence": best_score,
                    "sources": sources,
                    "relatedConcepts": (
                        related_concepts
                    ),
                    "retrievalMethod": (
                        "chroma-hybrid-reranked"
                    ),
                    "answer_source": "PDF_RAG",
                    "pdfId": resolved_pdf_id,
                }

                if is_ten_mark:
                    payload[
                        "questionType"
                    ] = "10_mark"

                if answer_error:
                    payload[
                        "answer_error"
                    ] = answer_error

                response_start = time.perf_counter()
                formatted = (
                    self.response_formatter
                    .success(payload)
                )
                timings["response_ms"] = int((time.perf_counter() - response_start) * 1000)
                log_answer_perf()
                return formatted

            # ============================================
            # RAG + LLM
            # ============================================

            logger.info(
                "[RAG] mode=RAG_PLUS_LLM "
                "(partial) -> LLM grounded + gap-fill"
            )

            self._log_pipeline(
                "[LLM] generating grounded "
                "answer (mode=RAG_PLUS_LLM%s)"
                % (
                    "/10_mark"
                    if is_ten_mark
                    else ""
                )
            )

            stage_start = time.perf_counter()
            prompt = (
                self.prompt_service
                .build_ten_mark_prompt(
                    question,
                    context,
                    partial=True,
                    conversation_history=conversation_window,
                )
                if is_ten_mark
                else self.prompt_service
                .build_partial_prompt(
                    question,
                    context,
                    conversation_history=conversation_window,
                )
            )
            timings["prompt_ms"] = int((time.perf_counter() - stage_start) * 1000)

            gen_start = (
                time.perf_counter()
            )

            try:

                answer = (
                    self.generate_answer(
                        prompt,
                        system=(
                            self.prompt_service
                            .SYSTEM_GROUNDING
                        ),
                        max_tokens=(
                            answer_max_tokens
                        ),
                    )
                    .strip()
                )

                if not answer:
                    raise AnswerGenerationError(
                        "LLM returned an "
                        "empty answer."
                    )

                llm_used = True
                answer_error = None

            except AnswerGenerationError as error:

                logger.warning(
                    "[RAG] partial LLM failed "
                    "-> returning evidence text"
                )

                answer = (
                    f"{self._evidence_answer(evidence)}\n\n"
                    "I found the information above "
                    "in your uploaded material, but "
                    "it does not contain enough detail "
                    "to fully answer the question."
                )

                llm_used = False
                answer_error = str(error)

            self._log_pipeline(
                "[LLM] timings "
                "generate_ms=%d "
                "total_ms=%d "
                "mode=rag_enriched"
                % (
                    int(
                        (
                            time.perf_counter()
                            - gen_start
                        )
                        * 1000
                    ),
                    int(
                        (
                            time.perf_counter()
                            - request_start
                        )
                        * 1000
                    ),
                )
            )
            timings["llm_ms"] = int((time.perf_counter() - gen_start) * 1000)

            # Figure note
            figure_note = (
                self._figure_grounding_note(
                    evidence
                )
            )

            if figure_note:
                answer = (
                    f"{answer}"
                    f"{figure_note}"
                )

            self.successful_requests += 1

            logger.info(
                "Question answered successfully."
            )

            payload = {
                "question": question,
                "answer": answer,
                "mode": "rag_enriched",
                "llm_used": llm_used,
                "rag_supported": True,
                "rag_complete": False,
                "is_from_pdf": True,
                "confidence": best_score,
                "sources": sources,
                "relatedConcepts": (
                    related_concepts
                ),
                "retrievalMethod": (
                    "chroma-hybrid-reranked"
                ),
                "answer_source": "PDF_RAG",
                "pdfId": resolved_pdf_id,
            }

            if is_ten_mark:
                payload[
                    "questionType"
                ] = "10_mark"

            if answer_error:
                payload[
                    "answer_error"
                ] = answer_error

            response_start = time.perf_counter()
            formatted = (
                self.response_formatter
                .success(payload)
            )
            timings["response_ms"] = int((time.perf_counter() - response_start) * 1000)
            log_answer_perf()
            return formatted

        except Exception as error:

            self.failed_requests += 1

            logger.exception(
                "RAG pipeline failed."
            )

            return (
                self.response_formatter
                .error(
                    str(error)
                )
            )

    # ========================================================
    # Health Check
    # ========================================================

    def health_check(self) -> bool:
        """Verify all RAG components are available."""

        logger.info(
            "Running RAG Service health check..."
        )

        try:

            retrieval_ok = (
                self.retrieval_service
                .health_check()
            )

            llm_ok = (
                self.llm_service
                .health_check()
            )

            if (
                retrieval_ok
                and llm_ok
            ):

                logger.info(
                    "RAG Service is healthy."
                )

                return True

            logger.warning(
                "One or more services "
                "are unavailable."
            )

            return False

        except Exception:

            logger.exception(
                "Health check failed."
            )

            return False

    # ========================================================
    # Get Statistics
    # ========================================================

    def get_statistics(self) -> Dict:
        """Return RAG service statistics."""

        return {
            "service": "RAG Service",
            "total_requests": (
                self.total_requests
            ),
            "successful_requests": (
                self.successful_requests
            ),
            "failed_requests": (
                self.failed_requests
            ),
            "success_rate": round(
                (
                    self.successful_requests
                    / max(
                        self.total_requests,
                        1,
                    )
                )
                * 100,
                2,
            ),
            "max_context_chunks": (
                self.max_context_chunks
            ),
        }

    # ========================================================
    # Reset Statistics
    # ========================================================

    def reset_statistics(
        self,
    ) -> None:
        """Reset request statistics."""

        logger.info(
            "Resetting RAG statistics..."
        )

        self.total_requests = 0
        self.successful_requests = 0
        self.failed_requests = 0

    # ========================================================
    # Close Resources
    # ========================================================

    def close(self) -> None:
        """
        Release resources.

        Reserved for future implementations.
        """

        logger.info(
            "Closing RAG Service..."
        )

        try:

            self.retrieval_service.close()

        except Exception:

            logger.warning(
                "Retrieval Service close skipped."
            )

    # ========================================================
    # Callable Interface
    # ========================================================

    def __call__(
        self,
        question: str,
    ) -> Dict:
        """
        Allow direct invocation.

        Example:
            response = rag_service(
                "What is Machine Learning?"
            )
        """

        return self.ask_question(
            question
        )
