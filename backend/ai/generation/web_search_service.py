"""
StudyGenie AI - Web Search Service

Architecture:
    RAGService
        |
        v
    WebSearchService
        |
        +-- Text Search Provider
        |
        +-- Image Search Provider

Online search is disabled by default.

Search is allowed only when:

    ALLOW_ONLINE_SEARCH=true

and a provider is configured.

This service never fabricates search results.
If search is unavailable or fails, it returns an empty result.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from ai.core.logger import get_logger


logger = get_logger("StudyGenie.AI.search")


# ============================================================
# Result Models
# ============================================================


@dataclass(frozen=True)
class SearchResult:
    """
    Normalized text-search result.
    """

    title: str
    snippet: str
    url: str
    source: str = "ONLINE_SEARCH"


@dataclass(frozen=True)
class ImageSearchResult:
    """
    Normalized image-search result.
    """

    title: str
    image_url: str
    source_url: str = ""
    thumbnail_url: str = ""
    source: str = "ONLINE_SEARCH_IMAGE"


# ============================================================
# Configuration
# ============================================================


class WebSearchConfig:
    """
    Centralized web-search configuration.
    """

    def __init__(self) -> None:
        self.enabled = self._read_bool(
            "ALLOW_ONLINE_SEARCH",
            default=False,
        )

        self.provider = os.getenv(
            "ONLINE_SEARCH_PROVIDER",
            "",
        ).strip()

        self.api_key = os.getenv(
            "ONLINE_SEARCH_API_KEY",
            "",
        ).strip()

        self.default_max_results = self._read_positive_int(
            "ONLINE_SEARCH_MAX_RESULTS",
            default=5,
        )

        self.default_max_images = self._read_positive_int(
            "ONLINE_IMAGE_SEARCH_MAX_RESULTS",
            default=5,
        )

    @staticmethod
    def _read_bool(
        name: str,
        default: bool,
    ) -> bool:

        value = os.getenv(name)

        if value is None:
            return default

        return value.strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

    @staticmethod
    def _read_positive_int(
        name: str,
        default: int,
    ) -> int:

        try:
            return max(
                1,
                int(
                    os.getenv(
                        name,
                        str(default),
                    )
                ),
            )

        except (TypeError, ValueError):
            logger.warning(
                "Invalid %s. Using %s.",
                name,
                default,
            )

            return default

    @property
    def available(self) -> bool:
        """
        True only when search is explicitly enabled
        and a provider is configured.
        """

        return bool(
            self.enabled
            and self.provider
            and self.api_key
        )


# ============================================================
# Web Search Service
# ============================================================


class WebSearchService:
    """
    Application-facing web-search service.

    Responsibilities:

        - Decide whether online search is permitted.
        - Normalize search configuration.
        - Provide text-search interface.
        - Provide image-search interface.
        - Never fabricate results.
        - Never make online search mandatory.

    The actual provider implementation can be added later
    without changing RAGService.
    """

    SOURCE_TEXT = "ONLINE_SEARCH"
    SOURCE_IMAGE = "ONLINE_SEARCH_IMAGE"

    def __init__(
        self,
        config: Optional[WebSearchConfig] = None,
    ) -> None:

        self.config = (
            config
            or WebSearchConfig()
        )

        logger.info(
            "[SEARCH] configured enabled=%s provider=%s available=%s",
            self.config.enabled,
            self.config.provider or "none",
            self.config.available,
        )

    # ========================================================
    # Availability
    # ========================================================

    def is_enabled(self) -> bool:
        """
        Return whether online search is explicitly enabled.
        """

        return self.config.enabled

    def is_available(self) -> bool:
        """
        Return whether online search can actually execute.
        """

        return self.config.available

    # ========================================================
    # Text Search
    # ========================================================

    def search(
        self,
        query: str,
        max_results: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Search the web for text results.

        Returns:

            [
                {
                    "title": "...",
                    "snippet": "...",
                    "url": "...",
                    "source": "ONLINE_SEARCH"
                }
            ]

        If search is disabled, unavailable, or not implemented,
        returns [].
        """

        query = self._validate_query(query)

        if not query:
            return []

        if not self.config.enabled:

            logger.info(
                "[SEARCH] text search disabled"
            )

            return []

        if not self.config.available:

            logger.info(
                "[SEARCH] enabled but provider unavailable"
            )

            return []

        limit = (
            max_results
            if max_results is not None
            else self.config.default_max_results
        )

        limit = max(
            1,
            int(limit),
        )

        # ----------------------------------------------------
        # Provider implementation goes here.
        #
        # Example future flow:
        #
        # provider_results = self.provider.search(
        #     query=query,
        #     max_results=limit,
        # )
        #
        # return self._normalize_results(provider_results)
        # ----------------------------------------------------

        logger.warning(
            "[SEARCH] provider=%s is configured but not implemented",
            self.config.provider,
        )

        return []

    # ========================================================
    # Image Search
    # ========================================================

    def search_images(
        self,
        query: str,
        max_results: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Search for images related to the query.

        Returns normalized image metadata.

        Example:

            {
                "title": "Transformer Architecture",
                "image_url": "...",
                "source_url": "...",
                "thumbnail_url": "...",
                "source": "ONLINE_SEARCH_IMAGE"
            }

        This is intentionally separate from normal text search.
        """

        query = self._validate_query(query)

        if not query:
            return []

        if not self.config.enabled:

            logger.info(
                "[SEARCH] image search disabled"
            )

            return []

        if not self.config.available:

            logger.info(
                "[SEARCH] image search unavailable"
            )

            return []

        limit = (
            max_results
            if max_results is not None
            else self.config.default_max_images
        )

        limit = max(
            1,
            int(limit),
        )

        # ----------------------------------------------------
        # Future image provider implementation.
        # ----------------------------------------------------

        logger.warning(
            "[SEARCH] image provider=%s is configured but not implemented",
            self.config.provider,
        )

        return []

    # ========================================================
    # Query Validation
    # ========================================================

    @staticmethod
    def _validate_query(
        query: Any,
    ) -> str:
        """
        Normalize a search query.

        Invalid queries return an empty string instead
        of crashing the RAG pipeline.
        """

        if not isinstance(
            query,
            str,
        ):
            logger.warning(
                "[SEARCH] invalid query type"
            )

            return ""

        query = query.strip()

        if not query:
            logger.warning(
                "[SEARCH] empty search query"
            )

            return ""

        return query

    # ========================================================
    # Status
    # ========================================================

    def get_service_information(
        self,
    ) -> Dict[str, Any]:
        """
        Return service configuration/status.
        """

        return {
            "service": "WebSearchService",
            "enabled": self.config.enabled,
            "provider": self.config.provider or None,
            "available": self.config.available,
            "text_search": True,
            "image_search": True,
            "implemented": False,
        }

    # ========================================================
    # Health
    # ========================================================

    def health_check(self) -> bool:
        """
        Check service configuration.

        This does not make an external request.
        """

        if not self.config.enabled:
            return True

        return self.config.available


# ============================================================
# Shared Service
# ============================================================

web_search_service = WebSearchService()