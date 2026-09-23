"""
StudyGenie-AI Retrieval Service
===============================

Application-facing retrieval layer for ChromaDB.

Responsibilities
----------------
- Generate query embeddings.
- Retrieve high-recall candidates.
- Apply user/PDF metadata filters.
- Fetch exact chunks by chunk_id.
- Support neighboring-chunk expansion.
- Index document chunks.
- Delete PDF vectors safely.
- Provide retrieval health/status information.

Architecture
------------

    RAGService
        |
        v
    RetrievalService
        |
        +---- EmbeddingService
        |
        +---- VectorStoreService
                    |
                    v
                 ChromaDB

Important
---------
ChromaDB lifecycle is owned by VectorStoreService.

This service does NOT create its own Chroma client.
"""

from __future__ import annotations

import logging
import os
import re
import time
from threading import Lock
from typing import Any, Dict, List, Optional

from ai.embeddings.embedding_service import (
    EmbeddingService,
    embedding_service as shared_embedding_service,
)

from ai.retrieval.vector_store import (
    VectorStoreConfig,
    VectorStoreService,
    vector_store_service,
)


logger = logging.getLogger(__name__)


# ============================================================================
# Exceptions
# ============================================================================


class RetrievalServiceError(Exception):
    """Base exception for retrieval-service failures."""


class CollectionInitializationError(RetrievalServiceError):
    """Raised when the Chroma collection cannot be initialized."""


class RetrievalError(RetrievalServiceError):
    """Raised when retrieval, indexing, or deletion fails."""


# ============================================================================
# Retrieval Service
# ============================================================================


class RetrievalService:
    """
    Application-facing retrieval API.

    Retrieval pipeline:

        Query
          |
          v
        EmbeddingService
          |
          v
        ChromaDB high-recall search
          |
          v
        Candidate chunks
          |
          v
        RAGService ranking / evidence grading
          |
          v
        LLM

    This class intentionally does not decide whether retrieved evidence
    is sufficient. That decision belongs to RAGService.
    """

    SERVICE_NAME = "StudyGenie Retrieval Service"

    # ------------------------------------------------------------------------
    # Defaults
    # ------------------------------------------------------------------------

    DEFAULT_TOP_K = 10
    DEFAULT_SCORE_THRESHOLD = 0.30

    # ------------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------------

    def __init__(
        self,
        embedding_service: Optional[EmbeddingService] = None,
        vector_store: Optional[VectorStoreService] = None,
    ) -> None:
        """
        Initialize RetrievalService.

        Shared singleton services are used by default to avoid:

        - Loading the embedding model multiple times.
        - Creating multiple Chroma clients.
        - Creating multiple persistent vector-store instances.
        """

        try:
            self.embedding_service = (
                embedding_service
                if embedding_service is not None
                else shared_embedding_service
            )

            self.vector_store = (
                vector_store
                if vector_store is not None
                else vector_store_service
            )

            self.collection = self._initialize_collection()

        except CollectionInitializationError:
            raise

        except Exception as exc:
            raise CollectionInitializationError(
                f"Failed to initialize retrieval collection: {exc}"
            ) from exc

        # Retrieval configuration.
        self.top_k = self._safe_positive_int(
            getattr(
                self.vector_store,
                "DEFAULT_TOP_K",
                self.DEFAULT_TOP_K,
            ),
            fallback=self.DEFAULT_TOP_K,
        )

        self.min_relevance_score = self._clamp_unit(
            getattr(
                self.vector_store,
                "DEFAULT_SCORE_THRESHOLD",
                self.DEFAULT_SCORE_THRESHOLD,
            ),
            fallback=self.DEFAULT_SCORE_THRESHOLD,
        )

        # High-recall retrieval intentionally uses a very low threshold.
        # RAGService performs the final relevance decision.
        self.recall_min_score = self._clamp_unit(
            os.getenv(
                "RAG_RECALL_SCORE_THRESHOLD",
                "0.0",
            ),
            fallback=0.0,
        )

        # Runtime counters.
        self.total_documents = 0
        self.total_searches = 0

        self._statistics_lock = Lock()

        logger.info(
            "%s initialized: collection=%s top_k=%d "
            "relevance_threshold=%.3f recall_threshold=%.3f",
            self.SERVICE_NAME,
            self.collection_name,
            self.top_k,
            self.min_relevance_score,
            self.recall_min_score,
        )

    # =========================================================================
    # Utility
    # =========================================================================

    @staticmethod
    def _clamp_unit(
        value: Any,
        fallback: float,
    ) -> float:
        """
        Convert a value to float and clamp it to [0, 1].
        """

        try:
            number = float(value)

        except (TypeError, ValueError):
            return fallback

        if number != number:  # NaN
            return fallback

        return max(
            0.0,
            min(1.0, number),
        )

    @staticmethod
    def _safe_positive_int(
        value: Any,
        fallback: int,
    ) -> int:
        """
        Convert value to a positive integer.
        """

        try:
            number = int(value)

        except (TypeError, ValueError):
            return fallback

        return max(1, number)

    @staticmethod
    def _normalize_identifier(
        value: Any,
        name: str,
    ) -> str:
        """
        Validate and normalize an identifier.
        """

        if value is None:
            raise RetrievalError(
                f"{name} cannot be None."
            )

        normalized = str(value).strip()

        if not normalized:
            raise RetrievalError(
                f"{name} cannot be empty."
            )

        return normalized

    @staticmethod
    def _normalize_document(
        document: Any,
    ) -> str:
        """
        Validate and normalize document content.

        This method guarantees that the returned value is a non-empty string.
        """

        if not isinstance(document, str):
            raise RetrievalError(
                "Document must be a string."
            )

        normalized = document.strip()

        if not normalized:
            raise RetrievalError(
                "Document cannot be empty."
            )

        return normalized

    @staticmethod
    def _normalize_content(
        value: Any,
        *,
        field_name: str = "content",
    ) -> str:
        """
        Normalize retrieved content to a real string.

        None becomes an empty string rather than the literal string "None".
        """

        if value is None:
            return ""

        if isinstance(value, str):
            return value

        try:
            return str(value)

        except Exception as exc:
            raise RetrievalError(
                f"{field_name} could not be converted to string."
            ) from exc

    @staticmethod
    def _normalize_metadata(
        value: Any,
    ) -> Dict[str, Any]:
        """
        Guarantee dictionary metadata.
        """

        if isinstance(value, dict):
            return dict(value)

        return {}

    # =========================================================================
    # Collection
    # =========================================================================

    def _initialize_collection(self) -> Any:
        """
        Obtain the existing Chroma collection from VectorStoreService.

        Chroma client creation remains centralized inside VectorStoreService.
        """

        try:
            collection = self.vector_store.collection

        except Exception as exc:
            raise CollectionInitializationError(
                f"Unable to access Chroma collection: {exc}"
            ) from exc

        if collection is None:
            raise CollectionInitializationError(
                "VectorStoreService returned an empty Chroma collection."
            )

        return collection

    @property
    def collection_name(self) -> str:
        """Return the configured Chroma collection name."""

        return VectorStoreConfig.COLLECTION_NAME

    @property
    def database_path(self) -> str:
        """Return the Chroma persistence path."""

        return self.vector_store.database_path

    # =========================================================================
    # Metadata Filters
    # =========================================================================

    @classmethod
    def _build_where_filter(
        cls,
        user_id: Optional[str] = None,
        pdf_id: Optional[str] = None,
        where: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Build a safe Chroma metadata filter.

        Examples
        --------

        PDF:

            {"pdf_id": "123"}

        User:

            {"user_id": "456"}

        PDF + user:

            {
                "$and": [
                    {"pdf_id": "123"},
                    {"user_id": "456"}
                ]
            }

        Existing `where` conditions are preserved.
        """

        conditions: List[Dict[str, Any]] = []

        if where is not None:
            if not isinstance(where, dict):
                raise RetrievalError(
                    "where must be a dictionary."
                )

            conditions.append(dict(where))

        if user_id is not None:
            normalized_user_id = str(user_id).strip()

            if normalized_user_id:
                conditions.append(
                    {
                        "user_id": normalized_user_id,
                    }
                )

        if pdf_id is not None:
            normalized_pdf_id = str(pdf_id).strip()

            if normalized_pdf_id:
                conditions.append(
                    {
                        "pdf_id": normalized_pdf_id,
                    }
                )

        if not conditions:
            return None

        if len(conditions) == 1:
            return conditions[0]

        return {
            "$and": conditions,
        }

    # =========================================================================
    # Service Information
    # =========================================================================

    def get_service_information(self) -> Dict[str, Any]:
        """
        Return retrieval-service status information.
        """

        return {
            "service": self.SERVICE_NAME,
            "database": "ChromaDB",
            "database_path": self.database_path,
            "collection": self.collection_name,
            "top_k": self.top_k,
            "recall_min_score": self.recall_min_score,
            "min_relevance_score": self.min_relevance_score,
            "documents": self.collection_count(),
            "searches": self.total_searches,
        }

    # =========================================================================
    # Document IDs
    # =========================================================================

    @staticmethod
    def make_document_id(
        pdf_id: str,
        chunk_id: str,
    ) -> str:
        """
        Create a deterministic Chroma document ID.

        Format:

            pdf_id:chunk_id
        """

        normalized_pdf_id = str(pdf_id).strip()
        normalized_chunk_id = str(chunk_id).strip()

        if not normalized_pdf_id:
            raise RetrievalError(
                "pdf_id is required."
            )

        if not normalized_chunk_id:
            raise RetrievalError(
                "chunk_id is required."
            )

        return (
            f"{normalized_pdf_id}:"
            f"{normalized_chunk_id}"
        )

    # =========================================================================
    # Add One Document
    # =========================================================================

    def add_document(
        self,
        document_id: str,
        document: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Generate an embedding and store one document.
        """

        normalized_id = self._normalize_identifier(
            document_id,
            "document_id",
        )

        normalized_document = self._normalize_document(
            document,
        )

        if metadata is not None and not isinstance(metadata, dict):
            raise RetrievalError(
                "metadata must be a dictionary."
            )

        try:
            embedding = self.embedding_service.generate_embedding(
                normalized_document
            )

            payload = {
                "content": normalized_document,
                "embedding": embedding,
                "metadata": {
                    **(metadata or {}),
                    "document_id": normalized_id,
                },
            }

            self.vector_store.add_documents(
                [payload]
            )

            self._increment_documents(1)

        except RetrievalError:
            raise

        except Exception as exc:
            raise RetrievalError(
                f"Failed to add document '{normalized_id}': {exc}"
            ) from exc

    # =========================================================================
    # Add Multiple Documents
    # =========================================================================

    def add_documents(
        self,
        document_ids: List[str],
        documents: List[str],
        metadatas: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """
        Generate embeddings and store multiple documents.
        """

        if not isinstance(document_ids, list):
            raise RetrievalError(
                "document_ids must be a list."
            )

        if not isinstance(documents, list):
            raise RetrievalError(
                "documents must be a list."
            )

        if len(document_ids) != len(documents):
            raise RetrievalError(
                "Document IDs and documents count mismatch."
            )

        if not document_ids:
            return

        if metadatas is not None:
            if not isinstance(metadatas, list):
                raise RetrievalError(
                    "metadatas must be a list."
                )

            if len(metadatas) != len(documents):
                raise RetrievalError(
                    "Document metadata count mismatch."
                )

        # Normalize IDs.
        normalized_ids = [
            self._normalize_identifier(
                document_id,
                "document_id",
            )
            for document_id in document_ids
        ]

        # Normalize documents.
        normalized_documents = [
            self._normalize_document(document)
            for document in documents
        ]

        # Normalize metadata.
        normalized_metadatas: List[Dict[str, Any]] = []

        if metadatas is None:
            normalized_metadatas = [
                {}
                for _ in normalized_documents
            ]

        else:
            for metadata in metadatas:
                if not isinstance(metadata, dict):
                    raise RetrievalError(
                        "Each document metadata value must be a dictionary."
                    )

                normalized_metadatas.append(
                    dict(metadata)
                )

        try:
            embeddings = (
                self.embedding_service.generate_batch_embeddings(
                    normalized_documents
                )
            )

            if len(embeddings) != len(normalized_documents):
                raise RetrievalError(
                    "Embedding count does not match document count."
                )

            payload: List[Dict[str, Any]] = []

            for index, document in enumerate(
                normalized_documents
            ):
                metadata = normalized_metadatas[index]

                metadata["document_id"] = normalized_ids[index]

                payload.append(
                    {
                        "content": document,
                        "embedding": embeddings[index],
                        "metadata": metadata,
                    }
                )

            self.vector_store.add_documents(
                payload
            )

            self._increment_documents(
                len(payload)
            )

        except RetrievalError:
            raise

        except Exception as exc:
            raise RetrievalError(
                f"Failed to store documents: {exc}"
            ) from exc

    # =========================================================================
    # Add PDF Chunks
    # =========================================================================

    def add_chunks(
        self,
        chunks: List[Dict[str, Any]],
    ) -> None:
        """
        Index PDF chunks.

        Expected format:

            {
                "content": "...",
                "metadata": {
                    "pdf_id": "...",
                    "chunk_id": "...",
                    "user_id": "..."
                }
            }

        Supported content keys:

            content
            text
            document
        """

        if not isinstance(chunks, list):
            raise RetrievalError(
                "chunks must be a list."
            )

        if not chunks:
            return

        document_ids: List[str] = []
        documents: List[str] = []
        metadatas: List[Dict[str, Any]] = []

        for index, chunk in enumerate(chunks):

            if not isinstance(chunk, dict):
                raise RetrievalError(
                    f"Chunk at index {index} must be a dictionary."
                )

            # --------------------------------------------------------------
            # Metadata
            # --------------------------------------------------------------

            metadata_value = chunk.get("metadata")

            if metadata_value is None:
                metadata: Dict[str, Any] = {}

            elif isinstance(metadata_value, dict):
                metadata = dict(metadata_value)

            else:
                raise RetrievalError(
                    f"Metadata for chunk at index {index} "
                    "must be a dictionary."
                )

            # --------------------------------------------------------------
            # PDF ID
            # --------------------------------------------------------------

            pdf_id_value = (
                metadata.get("pdf_id")
                or chunk.get("pdf_id")
            )

            pdf_id = self._normalize_identifier(
                pdf_id_value,
                "pdf_id",
            )

            # --------------------------------------------------------------
            # Chunk ID
            # --------------------------------------------------------------

            chunk_id_value = (
                metadata.get("chunk_id")
                or chunk.get("chunk_id")
            )

            chunk_id = self._normalize_identifier(
                chunk_id_value,
                "chunk_id",
            )

            # --------------------------------------------------------------
            # Content
            # --------------------------------------------------------------

            content_value = (
                chunk.get("content")
                or chunk.get("text")
                or chunk.get("document")
            )

            if not isinstance(content_value, str):
                raise RetrievalError(
                    f"Content for chunk '{chunk_id}' "
                    "must be a string."
                )

            content = content_value.strip()

            if not content:
                raise RetrievalError(
                    f"Content for chunk '{chunk_id}' "
                    "cannot be empty."
                )

            # --------------------------------------------------------------
            # Normalize metadata
            # --------------------------------------------------------------

            metadata["pdf_id"] = pdf_id
            metadata["chunk_id"] = chunk_id

            # --------------------------------------------------------------
            # Deterministic Chroma ID
            # --------------------------------------------------------------

            document_id = self.make_document_id(
                pdf_id,
                chunk_id,
            )

            document_ids.append(
                document_id
            )

            documents.append(
                content
            )

            metadatas.append(
                metadata
            )

        self.add_documents(
            document_ids=document_ids,
            documents=documents,
            metadatas=metadatas,
        )

        logger.info(
            "[RAG] Indexed %d chunks.",
            len(documents),
        )

    # =========================================================================
    # Similarity Search
    # =========================================================================

    def search(
        self,
        query: str,
        top_k: Optional[int] = None,
        where: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        pdf_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Perform normal similarity search.

        This uses the configured relevance threshold.
        """

        if not isinstance(query, str) or not query.strip():
            raise RetrievalError(
                "Query cannot be empty."
            )

        if self.collection_count() == 0:
            return {
                "ids": [[]],
                "documents": [[]],
                "metadatas": [[]],
                "distances": [[]],
            }

        normalized_query = query.strip()

        try:
            query_embedding = (
                self.embedding_service.generate_embedding(
                    normalized_query
                )
            )

            requested_k = (
                self._safe_positive_int(
                    top_k,
                    self.top_k,
                )
                if top_k is not None
                else self.top_k
            )

            matches = self.vector_store.search(
                query_embedding,
                top_k=requested_k,
                score_threshold=self.min_relevance_score,
                where=self._build_where_filter(
                    user_id=user_id,
                    pdf_id=pdf_id,
                    where=where,
                ),
            )

            self._increment_searches()

            return self._format_search_results(
                matches
            )

        except RetrievalError:
            raise

        except Exception as exc:
            raise RetrievalError(
                f"Similarity search failed: {exc}"
            ) from exc

    # =========================================================================
    # High Recall Retrieval
    # =========================================================================

    def retrieve_top_k(
        self,
        query: str,
        top_k: Optional[int] = None,
        user_id: Optional[str] = None,
        pdf_id: Optional[str] = None,
        where: Optional[Dict[str, Any]] = None,
        timings: Optional[Dict[str, float]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Retrieve high-recall candidate chunks.

        Important:

        This method intentionally does not make the final relevance
        decision. RAGService performs ranking/evidence grading afterward.
        """

        if not isinstance(query, str) or not query.strip():
            raise RetrievalError(
                "Query cannot be empty."
            )

        if self.collection_count() == 0:
            return []

        normalized_query = query.strip()

        try:
            # --------------------------------------------------------------
            # Query embedding
            # --------------------------------------------------------------

            started = time.perf_counter()

            query_embedding = (
                self.embedding_service.generate_embedding(
                    normalized_query
                )
            )

            if timings is not None:
                timings["embedding_ms"] = round(
                    (
                        time.perf_counter() - started
                    )
                    * 1000,
                    2,
                )

            # --------------------------------------------------------------
            # Chroma search
            # --------------------------------------------------------------

            started = time.perf_counter()

            requested_k = (
                self._safe_positive_int(
                    top_k,
                    self.top_k,
                )
                if top_k is not None
                else self.top_k
            )

            matches = self.vector_store.search(
                query_embedding,
                top_k=requested_k,
                score_threshold=self.recall_min_score,
                where=self._build_where_filter(
                    user_id=user_id,
                    pdf_id=pdf_id,
                    where=where,
                ),
            )

            if timings is not None:
                timings["chroma_ms"] = round(
                    (
                        time.perf_counter() - started
                    )
                    * 1000,
                    2,
                )

            self._increment_searches()

            # --------------------------------------------------------------
            # Normalize results
            # --------------------------------------------------------------

            return self._normalize_retrieval_results(
                matches
            )

        except RetrievalError:
            raise

        except Exception as exc:
            raise RetrievalError(
                f"Retrieval failed: {exc}"
            ) from exc

    # =========================================================================
    # Result Formatting
    # =========================================================================

    def _format_search_results(
        self,
        matches: Any,
    ) -> Dict[str, Any]:
        """
        Convert VectorStoreService results into the legacy Chroma-like format.
        """

        if not isinstance(matches, list):
            matches = []

        ids: List[str] = []
        documents: List[str] = []
        metadatas: List[Dict[str, Any]] = []
        distances: List[float] = []

        for item in matches:

            if not isinstance(item, dict):
                continue

            item_id = item.get("id")

            if item_id is not None:
                ids.append(
                    str(item_id)
                )

            documents.append(
                self._normalize_content(
                    item.get("content", "")
                )
            )

            metadatas.append(
                self._normalize_metadata(
                    item.get("metadata", {})
                )
            )

            try:
                score = float(
                    item.get("score", 0.0)
                )

            except (TypeError, ValueError):
                score = 0.0

            distances.append(
                1.0 - score
            )

        return {
            "ids": [ids],
            "documents": [documents],
            "metadatas": [metadatas],
            "distances": [distances],
        }

    def _normalize_retrieval_results(
        self,
        matches: Any,
    ) -> List[Dict[str, Any]]:
        """
        Normalize VectorStoreService results into application-level records.
        """

        if not isinstance(matches, list):
            return []

        results: List[Dict[str, Any]] = []

        for item in matches:

            if not isinstance(item, dict):
                continue

            content = self._normalize_content(
                item.get("content", "")
            )

            metadata = self._normalize_metadata(
                item.get("metadata", {})
            )

            try:
                score = float(
                    item.get("score", 0.0)
                )

            except (TypeError, ValueError):
                score = 0.0

            result = dict(item)

            result.update(
                {
                    "content": content,
                    "document": content,
                    "metadata": metadata,
                    "score": score,
                    "distance": 1.0 - score,
                }
            )

            results.append(result)

        return results

    def retrieve_keyword_candidates(
        self,
        query: str,
        pdf_id: Optional[str],
        user_id: Optional[str] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Return exact lexical matches from one already-authorized PDF.

        Vector search is excellent for paraphrases but can miss a named section
        (for example, "generative vs discriminative modeling"). This fallback
        never searches another user's material: it is available only when the
        caller supplies both the selected PDF and authenticated user IDs.
        """
        if not isinstance(query, str) or not query.strip() or not pdf_id or not user_id:
            return []

        query_terms = set(re.findall(r"[a-z0-9][a-z0-9_-]{2,}", query.lower()))
        if not query_terms:
            return []

        try:
            documents = self.vector_store.get_documents_by_pdf(str(pdf_id))
        except Exception as exc:
            logger.warning("[RAG] keyword retrieval unavailable: %s", type(exc).__name__)
            return []

        matches: List[Dict[str, Any]] = []
        normalized_user_id = str(user_id).strip()
        for document in documents:
            if not isinstance(document, dict):
                continue
            metadata = self._normalize_metadata(document.get("metadata", {}))
            if str(metadata.get("user_id") or "").strip() != normalized_user_id:
                continue
            content = self._normalize_content(document.get("content", ""))
            document_terms = set(re.findall(r"[a-z0-9][a-z0-9_-]{2,}", content.lower()))
            overlap = len(query_terms & document_terms) / len(query_terms)
            if overlap < 0.34:
                continue
            item = dict(document)
            item.update({
                "content": content,
                "document": content,
                "metadata": metadata,
                # Score denotes lexical evidence here; RAGService keeps the
                # channel visible and combines it with semantic ranking.
                "score": overlap,
                "lexical_score": overlap,
                "retrieval_channel": "keyword",
            })
            matches.append(item)

        matches.sort(key=lambda item: item["score"], reverse=True)
        return matches[:max(1, int(limit))]

    # =========================================================================
    # Exact Chunk Retrieval
    # =========================================================================

    def fetch_by_chunk_ids(
        self,
        pdf_id: str,
        chunk_ids: List[str],
        user_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch exact chunks by PDF ID and chunk IDs.

        Used for neighboring-chunk/context expansion.

        Chroma collection.get() returns ONE dictionary:

            {
                "ids": [...],
                "documents": [...],
                "metadatas": [...]
            }

        It does NOT return:

            content, result = collection.get(...)
        """

        try:
            normalized_pdf_id = self._normalize_identifier(
                pdf_id,
                "pdf_id",
            )

        except RetrievalError:
            logger.warning(
                "[RAG] fetch_by_chunk_ids: invalid pdf_id."
            )
            return []

        if not isinstance(chunk_ids, list):
            return []

        normalized_chunk_ids: List[str] = []

        for chunk_id in chunk_ids:

            if chunk_id is None:
                continue

            normalized = str(
                chunk_id
            ).strip()

            if normalized:
                normalized_chunk_ids.append(
                    normalized
                )

        if not normalized_chunk_ids:
            return []

        normalized_user_id: Optional[str] = None

        if user_id is not None:
            normalized_user_id = str(
                user_id
            ).strip()

            if not normalized_user_id:
                normalized_user_id = None

        conditions: List[Dict[str, Any]] = [
            {
                "pdf_id": normalized_pdf_id,
            },
            {
                "chunk_id": {
                    "$in": normalized_chunk_ids,
                }
            },
        ]

        if normalized_user_id:
            conditions.append(
                {
                    "user_id": normalized_user_id,
                }
            )

        where_filter = {
            "$and": conditions,
        }

        try:
            result = (
                self.vector_store
                .collection
                .get(
                    where=where_filter,
                    include=[
                        "documents",
                        "metadatas",
                    ],
                )
            )

        except Exception as exc:
            logger.warning(
                "[RAG] fetch_by_chunk_ids failed: %s",
                exc,
            )
            return []

        if not isinstance(result, dict):
            logger.warning(
                "[RAG] Chroma returned an invalid get() result."
            )
            return []

        ids = result.get("ids") or []
        documents = result.get("documents") or []
        metadatas = result.get("metadatas") or []

        results: List[Dict[str, Any]] = []

        for index, item_id in enumerate(ids):

            document = ""

            if index < len(documents):
                document = self._normalize_content(
                    documents[index]
                )

            metadata: Dict[str, Any] = {}

            if index < len(metadatas):
                metadata = self._normalize_metadata(
                    metadatas[index]
                )

            results.append(
                {
                    "id": str(item_id),
                    "content": document,
                    "document": document,
                    "metadata": metadata,
                    "score": 0.0,
                    "distance": 1.0,
                }
            )

        logger.debug(
            "[RAG] fetch_by_chunk_ids returned=%d",
            len(results),
        )

        return results

    # =========================================================================
    # Warmup
    # =========================================================================

    def warmup(self) -> bool:
        """
        Warm the embedding model.

        This avoids first-query model-loading latency.
        """

        try:
            return bool(
                self.embedding_service.warmup()
            )

        except Exception:
            logger.exception(
                "[RAG] Embedding warmup failed."
            )
            return False

    # =========================================================================
    # Delete One Document
    # =========================================================================

    def delete_document(
        self,
        document_id: str,
    ) -> None:
        """
        Delete one Chroma document by deterministic ID.
        """

        normalized_id = self._normalize_identifier(
            document_id,
            "document_id",
        )

        try:
            self.vector_store.collection.delete(
                ids=[normalized_id]
            )

        except Exception as exc:
            raise RetrievalError(
                f"Failed to delete document: {exc}"
            ) from exc

    # =========================================================================
    # Delete PDF
    # =========================================================================

    def delete_by_pdf(
        self,
        pdf_id: str,
        user_id: Optional[str] = None,
    ) -> int:
        """
        Delete all vectors belonging to a PDF.

        If user_id is supplied, deletion is scoped to that user.
        """

        normalized_pdf_id = self._normalize_identifier(
            pdf_id,
            "pdf_id",
        )

        normalized_user_id = None

        if user_id is not None:
            normalized_user_id = str(
                user_id
            ).strip()

            if not normalized_user_id:
                normalized_user_id = None

        try:
            collection = self.vector_store.collection

            before = int(
                collection.count()
            )

            if normalized_user_id:

                where_filter = {
                    "$and": [
                        {
                            "pdf_id": normalized_pdf_id,
                        },
                        {
                            "user_id": normalized_user_id,
                        },
                    ]
                }

            else:

                where_filter = {
                    "pdf_id": normalized_pdf_id,
                }

            collection.delete(
                where=where_filter
            )

            after = int(
                collection.count()
            )

            deleted = max(
                0,
                before - after,
            )

            logger.info(
                "[RAG] Deleted %d vectors for pdf_id=%s",
                deleted,
                normalized_pdf_id,
            )

            return deleted

        except Exception as exc:
            raise RetrievalError(
                f"Failed to delete PDF vectors: {exc}"
            ) from exc

    # =========================================================================
    # Count
    # =========================================================================

    def collection_count(self) -> int:
        """
        Return the number of vectors currently stored.
        """

        try:
            return int(
                self.vector_store
                .collection
                .count()
            )

        except Exception as exc:
            raise RetrievalError(
                f"Failed to count collection: {exc}"
            ) from exc

    # =========================================================================
    # Clear Collection
    # =========================================================================

    def clear_collection(self) -> None:
        """
        Delete all vectors from the collection.
        """

        try:
            self.vector_store.reset()

            with self._statistics_lock:
                self.total_documents = 0

        except Exception as exc:
            raise RetrievalError(
                f"Failed to clear collection: {exc}"
            ) from exc

    # =========================================================================
    # Health Check
    # =========================================================================

    def health_check(self) -> bool:
        """
        Check whether the underlying vector store is healthy.
        """

        try:
            return bool(
                self.vector_store.health_check()
            )

        except Exception:
            logger.exception(
                "[RAG] Retrieval health check failed."
            )
            return False

    # =========================================================================
    # Runtime Statistics
    # =========================================================================

    def get_statistics(self) -> Dict[str, int]:
        """
        Return retrieval runtime counters.
        """

        with self._statistics_lock:
            return {
                "total_documents_added": self.total_documents,
                "total_searches": self.total_searches,
            }

    def _increment_documents(
        self,
        count: int,
    ) -> None:
        """
        Safely increment document counter.
        """

        with self._statistics_lock:
            self.total_documents += max(
                0,
                int(count),
            )

    def _increment_searches(self) -> None:
        """
        Safely increment search counter.
        """

        with self._statistics_lock:
            self.total_searches += 1

    # =========================================================================
    # Close
    # =========================================================================

    def close(self) -> None:
        """
        No-op.

        VectorStoreService owns the Chroma lifecycle.
        """

        return None


# ============================================================================
# Shared Retrieval Service
# ============================================================================

retrieval_service = RetrievalService()
