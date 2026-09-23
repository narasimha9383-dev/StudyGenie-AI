"""
Canonical local SentenceTransformer embedding service for StudyGenie-AI.

Responsibilities:
- Load exactly one SentenceTransformer model per Python process.
- Generate normalized embeddings.
- Batch document embeddings efficiently.
- Cache repeated embeddings using a bounded LRU cache.
- Provide query/document embedding helpers.
- Validate embedding dimensions and numerical values.
- Provide health information.
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
from collections import OrderedDict
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Sequence, cast

import numpy as np
from dotenv import load_dotenv

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer


load_dotenv()

logger = logging.getLogger(__name__)


# ============================================================
# Exceptions
# ============================================================

class EmbeddingServiceError(RuntimeError):
    """Raised when embedding input, model loading, or output is invalid."""


# ============================================================
# Configuration
# ============================================================

class EmbeddingConfig:
    MODEL_NAME: str = os.getenv(
        "EMBEDDING_MODEL",
        "sentence-transformers/all-MiniLM-L6-v2",
    )

    VECTOR_DIMENSION: int = int(
        os.getenv("VECTOR_DIMENSION", "384")
    )

    CACHE_MAX_SIZE: int = max(
        1,
        int(os.getenv("EMBEDDING_CACHE_MAX_SIZE", "10000")),
    )

    BATCH_SIZE: int = max(
        1,
        int(os.getenv("EMBEDDING_BATCH_SIZE", "32")),
    )

    SHOW_PROGRESS: bool = (
        os.getenv("EMBEDDING_SHOW_PROGRESS", "false").lower()
        == "true"
    )


# ============================================================
# LRU Embedding Cache
# ============================================================

class EmbeddingCache:
    """
    Thread-safe bounded LRU cache.

    The cache stores:
        text hash -> embedding vector
    """

    def __init__(
        self,
        max_size: int = EmbeddingConfig.CACHE_MAX_SIZE,
    ) -> None:
        self.max_size = max(1, max_size)

        self._items: OrderedDict[
            str,
            List[float]
        ] = OrderedDict()

        self._lock = threading.RLock()

        self.hits = 0
        self.misses = 0

    @staticmethod
    def create_key(text: str) -> str:
        """
        Create a stable cache key.

        We use SHA-256 instead of storing the complete text as the
        dictionary key to keep cache keys compact.
        """
        return hashlib.sha256(
            text.encode("utf-8")
        ).hexdigest()

    def get(
        self,
        text: str,
    ) -> Optional[List[float]]:
        key = self.create_key(text)

        with self._lock:
            value = self._items.get(key)

            if value is None:
                self.misses += 1
                return None

            self.hits += 1

            # Move recently used item to the end.
            self._items.move_to_end(key)

            return value

    def set(
        self,
        text: str,
        embedding: List[float],
    ) -> None:
        key = self.create_key(text)

        with self._lock:
            self._items[key] = embedding
            self._items.move_to_end(key)

            while len(self._items) > self.max_size:
                self._items.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._items)

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            total = self.hits + self.misses

            hit_rate = (
                self.hits / total
                if total > 0
                else 0.0
            )

            return {
                "size": len(self._items),
                "max_size": self.max_size,
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": round(hit_rate, 4),
            }


# ============================================================
# Embedding Service
# ============================================================

class EmbeddingService:
    """
    Canonical embedding service.

    Important:
        Do not create this class repeatedly throughout the application.

    Prefer the module-level singleton:

        from ai.embeddings.embedding_service import embedding_service
    """

    def __init__(
        self,
        model: Optional[Any] = None,
    ) -> None:

        self.model = model

        self.cache = EmbeddingCache()

        self._model_lock = threading.RLock()

        self._model_load_count = 0

    # --------------------------------------------------------
    # Model loading
    # --------------------------------------------------------

    def load_model(self) -> Any:
        """
        Lazily load the SentenceTransformer model.

        Thread-safe and only loads the model once for this
        EmbeddingService instance.
        """

        if self.model is not None:
            return self.model

        with self._model_lock:

            # Double-check after acquiring the lock.
            if self.model is not None:
                return self.model

            try:
                from sentence_transformers import SentenceTransformer

                logger.info(
                    "Loading embedding model: %s",
                    EmbeddingConfig.MODEL_NAME,
                )

                self.model = SentenceTransformer(
                    EmbeddingConfig.MODEL_NAME
                )

                self._model_load_count += 1

                logger.info(
                    "Embedding model loaded successfully: %s",
                    EmbeddingConfig.MODEL_NAME,
                )

            except Exception as error:

                logger.exception(
                    "Failed to load embedding model."
                )

                raise EmbeddingServiceError(
                    f"Unable to load embedding model: {error}"
                ) from error

        return self.model

    # --------------------------------------------------------
    # Validation
    # --------------------------------------------------------

    @staticmethod
    def _validate_text(text: Any) -> None:

        if not isinstance(text, str):
            raise EmbeddingServiceError(
                "Embedding text must be a string."
            )

        if not text.strip():
            raise EmbeddingServiceError(
                "Embedding text must not be empty."
            )

    @staticmethod
    def _validate_vector(
        vector: Any,
    ) -> List[float]:

        try:
            values = np.asarray(
                vector,
                dtype=np.float32,
            ).reshape(-1)

        except Exception as error:

            raise EmbeddingServiceError(
                "Embedding output could not be converted to a numeric vector."
            ) from error

        expected_dimension = EmbeddingConfig.VECTOR_DIMENSION

        if len(values) != expected_dimension:

            raise EmbeddingServiceError(
                "Invalid embedding dimension: "
                f"expected {expected_dimension}, "
                f"received {len(values)}."
            )

        if not np.isfinite(values).all():

            raise EmbeddingServiceError(
                "Embedding contains NaN or infinite values."
            )

        return values.tolist()

    # --------------------------------------------------------
    # Single embedding
    # --------------------------------------------------------

    def generate_embedding(
        self,
        text: str,
    ) -> List[float]:

        self._validate_text(text)

        cached = self.cache.get(text)

        if cached is not None:
            return cached

        try:

            model = self.load_model()

            vector = model.encode(
                text,
                normalize_embeddings=True,
                show_progress_bar=False,
            )

            validated = self._validate_vector(vector)

            self.cache.set(
                text,
                validated,
            )

            return validated

        except EmbeddingServiceError:
            raise

        except Exception as error:

            logger.exception(
                "Embedding generation failed."
            )

            raise EmbeddingServiceError(
                f"Embedding generation failed: {error}"
            ) from error

    # --------------------------------------------------------
    # Batch embeddings
    # --------------------------------------------------------

    def generate_batch_embeddings(
        self,
        texts: Sequence[str],
    ) -> List[List[float]]:

        if not isinstance(texts, (list, tuple)):
            raise EmbeddingServiceError(
                "Batch embeddings require a list or tuple of strings."
            )

        if not texts:
            return []

        for text in texts:
            self._validate_text(text)

        # ----------------------------------------------------
        # First retrieve cached values.
        # ----------------------------------------------------

        result: List[Optional[List[float]]] = [
            self.cache.get(text)
            for text in texts
        ]

        # ----------------------------------------------------
        # Find missing values.
        #
        # IMPORTANT:
        # Deduplicate missing texts so the same chunk isn't
        # encoded multiple times in the same batch.
        # ----------------------------------------------------

        missing_text_to_indices: Dict[
            str,
            List[int]
        ] = {}

        for index, vector in enumerate(result):

            if vector is None:

                text = texts[index]

                missing_text_to_indices.setdefault(
                    text,
                    [],
                ).append(index)

        if missing_text_to_indices:

            unique_missing_texts = list(
                missing_text_to_indices.keys()
            )

            try:

                model = self.load_model()

                encoded = model.encode(
                    unique_missing_texts,
                    batch_size=EmbeddingConfig.BATCH_SIZE,
                    normalize_embeddings=True,
                    show_progress_bar=EmbeddingConfig.SHOW_PROGRESS,
                )

                # ------------------------------------------------
                # Validate number of returned vectors.
                # ------------------------------------------------

                if len(encoded) != len(
                    unique_missing_texts
                ):
                    raise EmbeddingServiceError(
                        "Embedding model returned an incomplete batch."
                    )

                # ------------------------------------------------
                # Validate and cache each vector.
                # ------------------------------------------------

                for text, vector in zip(
                    unique_missing_texts,
                    encoded,
                ):

                    validated = self._validate_vector(
                        vector
                    )

                    self.cache.set(
                        text,
                        validated,
                    )

                    # Fill every occurrence of this text.
                    for index in missing_text_to_indices[text]:

                        result[index] = validated

            except EmbeddingServiceError:
                raise

            except Exception as error:

                logger.exception(
                    "Batch embedding generation failed."
                )

                raise EmbeddingServiceError(
                    f"Batch embedding generation failed: {error}"
                ) from error

        # ----------------------------------------------------
        # Final validation.
        # ----------------------------------------------------

        if any(
            vector is None
            for vector in result
        ):

            raise EmbeddingServiceError(
                "Embedding generation returned incomplete results."
            )

        return [
            cast(List[float], vector)
            for vector in result
        ]

    # --------------------------------------------------------
    # Document embeddings
    # --------------------------------------------------------

    def embed_documents(
        self,
        documents: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:

        if not isinstance(documents, list):

            raise EmbeddingServiceError(
                "documents must be a list."
            )

        if not documents:
            return []

        contents: List[str] = []

        for document in documents:

            if not isinstance(document, dict):

                raise EmbeddingServiceError(
                    "Each document must be a dictionary."
                )

            if "content" not in document:

                raise EmbeddingServiceError(
                    "Each document must contain 'content'."
                )

            content = document["content"]

            self._validate_text(content)

            metadata = document.get(
                "metadata",
                {},
            )

            if metadata is None:
                metadata = {}

            if not isinstance(metadata, dict):

                raise EmbeddingServiceError(
                    "Document metadata must be a dictionary."
                )

            contents.append(content)

        vectors = self.generate_batch_embeddings(
            contents
        )

        result: List[Dict[str, Any]] = []

        for document, content, vector in zip(
            documents,
            contents,
            vectors,
        ):

            result.append(
                {
                    "content": content,
                    "embedding": vector,
                    "metadata": document.get(
                        "metadata"
                    ) or {},
                }
            )

        return result

    # --------------------------------------------------------
    # Query embedding
    # --------------------------------------------------------

    def embed_query(
        self,
        query: str,
    ) -> List[float]:

        return self.generate_embedding(query)

    # --------------------------------------------------------
    # Warmup
    # --------------------------------------------------------

    def warmup(self) -> bool:
        """
        Load the embedding model before the first real request.

        This avoids making the first user request pay the
        model-loading cost.
        """

        try:

            self.generate_embedding(
                "__studygenie_embedding_warmup__"
            )

            logger.info(
                "Embedding model warmup completed."
            )

            return True

        except Exception as error:

            logger.warning(
                "Embedding warmup failed: %s",
                error,
            )

            return False

    # --------------------------------------------------------
    # Similarity
    # --------------------------------------------------------

    def cosine_similarity(
        self,
        vector1: List[float],
        vector2: List[float],
    ) -> float:

        try:

            first = np.asarray(
                vector1,
                dtype=np.float32,
            )

            second = np.asarray(
                vector2,
                dtype=np.float32,
            )

        except (TypeError, ValueError) as error:

            raise EmbeddingServiceError(
                "Embeddings must contain numeric values."
            ) from error

        if first.shape != second.shape:

            raise EmbeddingServiceError(
                "Embedding dimensions must match."
            )

        denominator = float(
            np.linalg.norm(first)
            * np.linalg.norm(second)
        )

        if denominator == 0:
            return 0.0

        return float(
            np.dot(first, second)
            / denominator
        )

    # --------------------------------------------------------
    # Cache management
    # --------------------------------------------------------

    def clear_cache(self) -> None:

        self.cache.clear()

        logger.info(
            "Embedding cache cleared."
        )

    # --------------------------------------------------------
    # Health
    # --------------------------------------------------------

    def health_check(self) -> Dict[str, Any]:

        return {
            "service": "embedding",
            "status": "running",
            "model": EmbeddingConfig.MODEL_NAME,
            "dimension": EmbeddingConfig.VECTOR_DIMENSION,
            "batch_size": EmbeddingConfig.BATCH_SIZE,
            "model_loaded": self.model is not None,
            "model_load_count": self._model_load_count,
            "cache": self.cache.stats(),
        }


# ============================================================
# CANONICAL SINGLETON
# ============================================================

embedding_service = EmbeddingService()