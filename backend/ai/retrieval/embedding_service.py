"""Compatibility imports for the canonical embeddings package.

New code must import from ``ai.embeddings.embedding_service``.
"""

from ai.embeddings.embedding_service import (
    EmbeddingCache,
    EmbeddingConfig,
    EmbeddingService,
    EmbeddingServiceError,
    embedding_service,
)

__all__ = [
    "EmbeddingCache",
    "EmbeddingConfig",
    "EmbeddingService",
    "EmbeddingServiceError",
    "embedding_service",
]
