"""
============================================================
StudyGenie AI - Vector Store Service
------------------------------------------------------------
Persistent ChromaDB vector store.

Responsibilities:
    - Initialize persistent ChromaDB
    - Create/get the application collection
    - Store document chunks and embeddings
    - Perform similarity search
    - Retrieve documents by metadata
    - Delete vectors
    - Reset the collection
    - Report vector-store health

Architecture:

    RetrievalService
          |
          v
    VectorStoreService
          |
          v
       ChromaDB

Important:
    This module is ONLY responsible for vector storage/retrieval.

    It does NOT:
        - generate embeddings
        - generate answers
        - call an LLM
        - perform RAG reasoning
        - rank evidence semantically

Embedding generation belongs to EmbeddingService.
RAG decisions belong to RAGService.
============================================================
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, cast

import chromadb


logger = logging.getLogger("VectorStore")


# ============================================================
# Types
# ============================================================

MetadataScalar = Union[
    str,
    int,
    float,
    bool,
]


# ============================================================
# Exceptions
# ============================================================


class VectorStoreError(Exception):
    """Base exception for vector-store failures."""


# ============================================================
# Configuration
# ============================================================


class VectorStoreConfig:
    """
    Central configuration for ChromaDB.
    """

    VECTOR_DIMENSION = int(
        os.getenv(
            "VECTOR_DIMENSION",
            "384",
        )
    )

    PERSIST_DIRECTORY = os.getenv(
        "CHROMA_PERSIST_DIRECTORY",
        "./vector_db/chroma",
    )

    COLLECTION_NAME = os.getenv(
        "CHROMA_COLLECTION_NAME",
        "studygenie_documents",
    )

    DEFAULT_TOP_K = max(
        1,
        int(
            os.getenv(
                "VECTOR_TOP_K",
                "5",
            )
        ),
    )

    DEFAULT_SCORE_THRESHOLD = float(
        os.getenv(
            "VECTOR_SCORE_THRESHOLD",
            "0.3",
        )
    )


# ============================================================
# Vector Store Service
# ============================================================


class VectorStoreService:
    """
    Thread-safe persistent ChromaDB service.

    This class owns:
        - Chroma client
        - Chroma collection
        - persistence
        - vector insertion
        - similarity search
        - metadata filtering
        - deletion
        - reset
    """

    DEFAULT_TOP_K = (
        VectorStoreConfig.DEFAULT_TOP_K
    )

    DEFAULT_SCORE_THRESHOLD = (
        VectorStoreConfig.DEFAULT_SCORE_THRESHOLD
    )

    # ========================================================
    # Initialization
    # ========================================================

    def __init__(self) -> None:
        self._lock = threading.RLock()

        self.database_path = str(
            Path(
                VectorStoreConfig.PERSIST_DIRECTORY
            )
            .expanduser()
            .resolve()
        )

        Path(
            self.database_path
        ).mkdir(
            parents=True,
            exist_ok=True,
        )

        try:
            self.client = (
                chromadb.PersistentClient(
                    path=self.database_path
                )
            )

            self.collection = (
                self._get_or_create_collection()
            )

            logger.info(
                "ChromaDB initialized successfully: %s",
                self.database_path,
            )

        except Exception as error:

            logger.exception(
                "ChromaDB initialization failed"
            )

            raise VectorStoreError(
                f"Unable to initialize ChromaDB: {error}"
            ) from error

    # ========================================================
    # Collection
    # ========================================================

    def _get_or_create_collection(self) -> Any:
        """
        Get the existing collection or create it.
        """

        return self.client.get_or_create_collection(
            name=VectorStoreConfig.COLLECTION_NAME,
            metadata={
                "hnsw:space": "cosine",
                "description": (
                    "StudyGenie AI knowledge base"
                ),
            },
        )

    # ========================================================
    # ID generation
    # ========================================================

    @staticmethod
    def _stable_id(
        document: Dict[str, Any],
    ) -> str:
        """
        Generate a deterministic document ID.

        Preferred:

            pdf_id:chunk_id

        Fallback:

            SHA-256(content + metadata)
        """

        metadata = (
            document.get("metadata")
            or {}
        )

        if not isinstance(
            metadata,
            dict,
        ):
            metadata = {}

        pdf_id = (
            metadata.get("pdf_id")
            or metadata.get("pdfId")
        )

        chunk_id = (
            metadata.get("chunk_id")
            or metadata.get("chunkId")
        )

        if pdf_id and chunk_id:
            return (
                f"{str(pdf_id).strip()}:"
                f"{str(chunk_id).strip()}"
            )

        content = document.get(
            "content"
        )

        if not isinstance(
            content,
            str,
        ):
            raise VectorStoreError(
                "Document content must be a string."
            )

        content = content.strip()

        if not content:
            raise VectorStoreError(
                "Document content is required "
                "to generate a stable ID."
            )

        payload = json.dumps(
            {
                "content": content,
                "metadata": metadata,
            },
            sort_keys=True,
            default=str,
        )

        return hashlib.sha256(
            payload.encode("utf-8")
        ).hexdigest()

    # ========================================================
    # Metadata normalization
    # ========================================================

    @staticmethod
    def _normalize_metadata(
        metadata: Optional[
            Dict[str, Any]
        ],
    ) -> Dict[
        str,
        MetadataScalar,
    ]:
        """
        Convert metadata into Chroma-compatible
        scalar values.

        Chroma metadata supports scalar values.
        Complex values are JSON encoded.
        """

        if metadata is None:
            return {}

        if not isinstance(
            metadata,
            dict,
        ):
            raise VectorStoreError(
                "Document metadata must be a dictionary."
            )

        result: Dict[
            str,
            MetadataScalar,
        ] = {}

        for key, value in metadata.items():

            normalized_key = str(
                key
            )

            if value is None:

                result[
                    normalized_key
                ] = ""

            elif isinstance(
                value,
                (
                    str,
                    int,
                    float,
                    bool,
                ),
            ):

                result[
                    normalized_key
                ] = value

            else:

                result[
                    normalized_key
                ] = json.dumps(
                    value,
                    sort_keys=True,
                    default=str,
                )

        return result

    # ========================================================
    # Embedding validation
    # ========================================================

    @staticmethod
    def _validate_embedding(
        embedding: Any,
    ) -> List[float]:
        """
        Validate and normalize an embedding.

        Always returns List[float].
        """

        if embedding is None:
            raise VectorStoreError(
                "Embedding is required."
            )

        # ----------------------------------------------------
        # Support:
        #
        # list
        # tuple
        # numpy ndarray
        # ----------------------------------------------------

        try:

            vector = [
                float(value)
                for value in embedding
            ]

        except (
            TypeError,
            ValueError,
        ) as error:

            raise VectorStoreError(
                "Embedding must contain "
                "numeric values."
            ) from error

        expected_dimension = (
            VectorStoreConfig.VECTOR_DIMENSION
        )

        actual_dimension = len(
            vector
        )

        if (
            actual_dimension
            != expected_dimension
        ):

            raise VectorStoreError(
                "Invalid embedding dimension: "
                f"expected {expected_dimension}, "
                f"received {actual_dimension}."
            )

        for value in vector:

            if not math.isfinite(
                value
            ):

                raise VectorStoreError(
                    "Embedding contains "
                    "NaN or infinite values."
                )

        return vector

    # ========================================================
    # Content validation
    # ========================================================

    @staticmethod
    def _validate_content(
        content: Any,
    ) -> str:
        """
        Validate document/chunk content.

        Never silently converts None to "None".
        """

        if not isinstance(
            content,
            str,
        ):

            raise VectorStoreError(
                "Document content must be a string."
            )

        content = content.strip()

        if not content:

            raise VectorStoreError(
                "Document content cannot be empty."
            )

        return content

    # ========================================================
    # Add documents
    # ========================================================

    def add_documents(
        self,
        documents: List[
            Dict[str, Any]
        ],
    ) -> List[str]:
        """
        Insert or update documents using Chroma upsert.

        Expected structure:

            {
                "content": "...",
                "embedding": [...],
                "metadata": {...}
            }
        """

        if not isinstance(
            documents,
            list,
        ):

            raise VectorStoreError(
                "documents must be a list."
            )

        if not documents:
            return []

        ids: List[str] = []

        contents: List[str] = []

        embeddings: List[
            List[float]
        ] = []

        metadatas: List[
            Dict[str, MetadataScalar]
        ] = []

        # ====================================================
        # Validate all documents first
        # ====================================================

        for index, document in enumerate(
            documents
        ):

            if not isinstance(
                document,
                dict,
            ):

                raise VectorStoreError(
                    f"Document at index {index} "
                    "must be a dictionary."
                )

            # ------------------------------------------------
            # Content
            # ------------------------------------------------

            content = self._validate_content(
                document.get(
                    "content"
                )
            )

            # ------------------------------------------------
            # Embedding
            # ------------------------------------------------

            embedding = (
                self._validate_embedding(
                    document.get(
                        "embedding"
                    )
                )
            )

            # ------------------------------------------------
            # Metadata
            # ------------------------------------------------

            metadata = (
                self._normalize_metadata(
                    document.get(
                        "metadata"
                    )
                )
            )

            # ------------------------------------------------
            # ID
            # ------------------------------------------------

            document_id = (
                self._stable_id(
                    {
                        "content": content,
                        "metadata": metadata,
                    }
                )
            )

            ids.append(
                document_id
            )

            contents.append(
                content
            )

            embeddings.append(
                embedding
            )

            metadatas.append(
                metadata
            )

        # ====================================================
        # Safety check
        # ====================================================

        if not (
            len(ids)
            == len(contents)
            == len(embeddings)
            == len(metadatas)
        ):

            raise VectorStoreError(
                "ChromaDB payload lengths do not match."
            )

        # ====================================================
        # Upsert
        # ====================================================

        try:

            with self._lock:

                collection = cast(
                    Any,
                    self.collection,
                )

                collection.upsert(
                    ids=ids,
                    documents=contents,
                    embeddings=embeddings,
                    metadatas=metadatas,
                )

            logger.debug(
                "Upserted %d documents",
                len(ids),
            )

            return ids

        except Exception as error:

            logger.exception(
                "ChromaDB document upsert failed"
            )

            raise VectorStoreError(
                f"Failed to add documents: {error}"
            ) from error

    # ========================================================
    # Similarity Search
    # ========================================================

    def search(
        self,
        query_vector: Any,
        top_k: int = (
            VectorStoreConfig.DEFAULT_TOP_K
        ),
        score_threshold: float = (
            VectorStoreConfig.DEFAULT_SCORE_THRESHOLD
        ),
        where: Optional[
            Dict[str, Any]
        ] = None,
    ) -> List[
        Dict[str, Any]
    ]:
        """
        Perform cosine similarity search.

        Chroma returns distance.

        Since cosine distance is used:

            similarity = 1 - distance
        """

        vector = (
            self._validate_embedding(
                query_vector
            )
        )

        if (
            not isinstance(
                top_k,
                int,
            )
            or top_k < 1
        ):

            raise VectorStoreError(
                "top_k must be a positive integer."
            )

        try:

            threshold = float(
                score_threshold
            )

        except (
            TypeError,
            ValueError,
        ) as error:

            raise VectorStoreError(
                "score_threshold must be "
                "between 0 and 1."
            ) from error

        if not (
            0.0
            <= threshold
            <= 1.0
        ):

            raise VectorStoreError(
                "score_threshold must be "
                "between 0 and 1."
            )

        if (
            where is not None
            and not isinstance(
                where,
                dict,
            )
        ):

            raise VectorStoreError(
                "where must be a dictionary."
            )

        # ====================================================
        # Query Chroma
        # ====================================================

        try:

            with self._lock:

                collection = cast(
                    Any,
                    self.collection,
                )

                count = int(
                    collection.count()
                )

                if count == 0:
                    return []

                result = (
                    collection.query(
                        query_embeddings=[
                            vector
                        ],
                        n_results=min(
                            top_k,
                            count,
                        ),
                        where=(
                            where
                            if where
                            else None
                        ),
                        include=[
                            "documents",
                            "metadatas",
                            "distances",
                        ],
                    )
                )

        except Exception as error:

            logger.exception(
                "ChromaDB similarity search failed"
            )

            raise VectorStoreError(
                f"Similarity search failed: {error}"
            ) from error

        # ====================================================
        # Extract result safely
        # ====================================================

        ids_groups = result.get(
            "ids"
        )

        documents_groups = result.get(
            "documents"
        )

        metadata_groups = result.get(
            "metadatas"
        )

        distance_groups = result.get(
            "distances"
        )

        ids = (
            ids_groups[0]
            if ids_groups
            else []
        )

        contents = (
            documents_groups[0]
            if documents_groups
            else []
        )

        metadatas = (
            metadata_groups[0]
            if metadata_groups
            else []
        )

        distances = (
            distance_groups[0]
            if distance_groups
            else []
        )

        matches: List[
            Dict[str, Any]
        ] = []

        # ====================================================
        # Normalize matches
        # ====================================================

        for (
            item_id,
            content,
            metadata,
            distance,
        ) in zip(
            ids,
            contents,
            metadatas,
            distances,
        ):

            try:

                distance_value = float(
                    distance
                )

            except (
                TypeError,
                ValueError,
            ):

                distance_value = 1.0

            score = (
                1.0
                - distance_value
            )

            score = max(
                0.0,
                min(
                    1.0,
                    score,
                ),
            )

            if score < threshold:
                continue

            # ------------------------------------------------
            # Content normalization
            # ------------------------------------------------

            if content is None:

                normalized_content = ""

            elif isinstance(
                content,
                str,
            ):

                normalized_content = content

            else:

                normalized_content = str(
                    content
                )

            # ------------------------------------------------
            # Metadata normalization
            # ------------------------------------------------

            if isinstance(
                metadata,
                dict,
            ):

                normalized_metadata = dict(
                    metadata
                )

            else:

                normalized_metadata = {}

            matches.append(
                {
                    "id": str(
                        item_id
                    ),
                    "content": normalized_content,
                    "document": normalized_content,
                    "metadata": normalized_metadata,
                    "score": score,
                    "distance": distance_value,
                }
            )

        return matches

    # ========================================================
    # Internal metadata retrieval
    # ========================================================

    def _get(
        self,
        where: Dict[str, Any],
    ) -> List[
        Dict[str, Any]
    ]:
        """
        Fetch documents directly from Chroma.

        IMPORTANT:

        Chroma collection.get() returns ONE dictionary:

            {
                "ids": [...],
                "documents": [...],
                "embeddings": ...,
                "metadatas": [...]
            }

        Do NOT unpack it as:

            content, result = collection.get(...)
        """

        if not isinstance(
            where,
            dict,
        ):

            raise VectorStoreError(
                "where must be a dictionary."
            )

        try:

            with self._lock:

                result = (
                    self.collection.get(
                        where=where,
                        include=[
                            "documents",
                            "metadatas",
                            "embeddings",
                        ],
                    )
                )

        except Exception as error:

            logger.exception(
                "ChromaDB get failed"
            )

            raise VectorStoreError(
                f"Failed to retrieve documents: {error}"
            ) from error

        # ====================================================
        # IDs
        # ====================================================

        ids_raw = result.get(
            "ids"
        )

        ids = (
            ids_raw
            if ids_raw is not None
            else []
        )

        # ====================================================
        # Documents
        # ====================================================

        documents_raw = result.get(
            "documents"
        )

        documents = (
            documents_raw
            if documents_raw is not None
            else []
        )

        # ====================================================
        # Metadata
        # ====================================================

        metadatas_raw = result.get(
            "metadatas"
        )

        metadatas = (
            metadatas_raw
            if metadatas_raw is not None
            else []
        )

        # ====================================================
        # Embeddings
        #
        # IMPORTANT:
        #
        # Do NOT do:
        #
        #     embeddings = result.get("embeddings") or []
        #
        # because Chroma may return numpy.ndarray.
        #
        # ndarray truth evaluation raises:
        #
        #     ValueError:
        #     The truth value of an array with more
        #     than one element is ambiguous.
        # ====================================================

        embeddings_raw = result.get(
            "embeddings"
        )

        if embeddings_raw is None:
            embeddings = []
        else:
            embeddings = embeddings_raw

        # ====================================================
        # Build application objects
        # ====================================================

        results: List[
            Dict[str, Any]
        ] = []

        for index, item_id in enumerate(
            ids
        ):

            # ------------------------------------------------
            # Content
            # ------------------------------------------------

            content = ""

            if index < len(
                documents
            ):

                value = documents[
                    index
                ]

                if isinstance(
                    value,
                    str,
                ):

                    content = value

                elif value is not None:

                    content = str(
                        value
                    )

            # ------------------------------------------------
            # Embedding
            # ------------------------------------------------

            embedding = None

            if index < len(
                embeddings
            ):

                embedding = (
                    embeddings[
                        index
                    ]
                )

            # ------------------------------------------------
            # Metadata
            # ------------------------------------------------

            metadata: Dict[
                str,
                Any
            ] = {}

            if index < len(
                metadatas
            ):

                value = metadatas[
                    index
                ]

                if isinstance(
                    value,
                    dict,
                ):

                    metadata = dict(
                        value
                    )

            results.append(
                {
                    "id": str(
                        item_id
                    ),
                    "content": content,
                    "document": content,
                    "embedding": embedding,
                    "metadata": metadata,
                }
            )

        return results

    # ========================================================
    # User retrieval
    # ========================================================

    def get_documents_by_user(
        self,
        user_id: str,
    ) -> List[
        Dict[str, Any]
    ]:
        """
        Return all vectors belonging to a user.
        """

        if user_id is None:
            raise VectorStoreError(
                "user_id is required."
            )

        normalized_user_id = str(
            user_id
        ).strip()

        if not normalized_user_id:
            raise VectorStoreError(
                "user_id cannot be empty."
            )

        return self._get(
            {
                "user_id": normalized_user_id
            }
        )

    # ========================================================
    # PDF retrieval
    # ========================================================

    def get_documents_by_pdf(
        self,
        pdf_id: str,
    ) -> List[
        Dict[str, Any]
    ]:
        """
        Return all vectors belonging to a PDF.
        """

        if pdf_id is None:
            raise VectorStoreError(
                "pdf_id is required."
            )

        normalized_pdf_id = str(
            pdf_id
        ).strip()

        if not normalized_pdf_id:
            raise VectorStoreError(
                "pdf_id cannot be empty."
            )

        return self._get(
            {
                "pdf_id": normalized_pdf_id
            }
        )

    # ========================================================
    # Compatibility aliases
    # ========================================================

    def filter_by_user(
        self,
        user_id: str,
    ) -> List[
        Dict[str, Any]
    ]:
        return self.get_documents_by_user(
            user_id
        )

    def filter_by_pdf(
        self,
        pdf_id: str,
    ) -> List[
        Dict[str, Any]
    ]:
        return self.get_documents_by_pdf(
            pdf_id
        )

    # ========================================================
    # Delete by PDF
    # ========================================================

    def delete_by_pdf(
        self,
        pdf_id: str,
    ) -> int:
        """
        Delete every vector belonging to a PDF.
        """

        if pdf_id is None:
            raise VectorStoreError(
                "pdf_id is required."
            )

        normalized_pdf_id = str(
            pdf_id
        ).strip()

        if not normalized_pdf_id:
            raise VectorStoreError(
                "pdf_id is required."
            )

        try:

            with self._lock:

                before = int(
                    self.collection.count()
                )

                self.collection.delete(
                    where={
                        "pdf_id": normalized_pdf_id
                    }
                )

                after = int(
                    self.collection.count()
                )

            deleted = max(
                0,
                before - after,
            )

            logger.info(
                "Deleted %d vectors for pdf_id=%s",
                deleted,
                normalized_pdf_id,
            )

            return deleted

        except Exception as error:

            logger.exception(
                "Failed to delete PDF vectors"
            )

            raise VectorStoreError(
                f"Failed to delete PDF vectors: {error}"
            ) from error

    # ========================================================
    # Delete one document
    # ========================================================

    def delete_document(
        self,
        document_id: str,
    ) -> None:
        """
        Delete one vector by Chroma document ID.
        """

        if document_id is None:
            raise VectorStoreError(
                "document_id is required."
            )

        normalized_id = str(
            document_id
        ).strip()

        if not normalized_id:
            raise VectorStoreError(
                "document_id cannot be empty."
            )

        try:

            with self._lock:

                self.collection.delete(
                    ids=[
                        normalized_id
                    ]
                )

        except Exception as error:

            logger.exception(
                "Failed to delete document"
            )

            raise VectorStoreError(
                f"Failed to delete document: {error}"
            ) from error

    # ========================================================
    # Count
    # ========================================================

    def count(self) -> int:
        """
        Return total number of vectors.
        """

        try:

            with self._lock:

                return int(
                    self.collection.count()
                )

        except Exception as error:

            raise VectorStoreError(
                f"Failed to count vectors: {error}"
            ) from error

    # ========================================================
    # Reset
    # ========================================================

    def reset(self) -> None:
        """
        Delete and recreate the collection.

        WARNING:
            This removes every vector.
        """

        try:

            with self._lock:

                self.client.delete_collection(
                    VectorStoreConfig.COLLECTION_NAME
                )

                self.collection = (
                    self._get_or_create_collection()
                )

            logger.warning(
                "ChromaDB collection reset: %s",
                VectorStoreConfig.COLLECTION_NAME,
            )

        except Exception as error:

            logger.exception(
                "Failed to reset ChromaDB collection"
            )

            raise VectorStoreError(
                f"Failed to reset collection: {error}"
            ) from error

    # ========================================================
    # Health Check
    # ========================================================

    def health_check(
        self,
    ) -> Dict[str, Any]:
        """
        Return vector-store health information.
        """

        try:

            with self._lock:

                total = int(
                    self.collection.count()
                )

            return {
                "service": "vector_store",
                "status": "running",
                "database": "chromadb",
                "collection": (
                    VectorStoreConfig.COLLECTION_NAME
                ),
                "total_vectors": total,
                "persistent": True,
                "path": self.database_path,
                "embedding_dimension": (
                    VectorStoreConfig.VECTOR_DIMENSION
                ),
            }

        except Exception as error:

            logger.exception(
                "Vector store health check failed"
            )

            return {
                "service": "vector_store",
                "status": "error",
                "database": "chromadb",
                "collection": (
                    VectorStoreConfig.COLLECTION_NAME
                ),
                "persistent": True,
                "path": self.database_path,
                "error": str(error),
            }


# ============================================================
# Shared Service
# ============================================================

vector_store_service = (
    VectorStoreService()
)