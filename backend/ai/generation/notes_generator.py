"""
StudyGenie AI - Notes Generator

Generates structured study notes from supplied study material.

Architecture:

    Source Content
         ↓
    NotesGenerator
         ↓
    PromptService
         ↓
    LLMService
         ↓
    ResponseFormatter
         ↓
    Structured Notes

This service does not handle:
- PDF extraction
- Chunking
- Embeddings
- ChromaDB
- Retrieval
- PDF generation
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Dict, Optional

from ai.generation.llm_service import (
    LLMGenerationError,
    LLMService,
)
from ai.generation.prompt_service import PromptService
from ai.generation.response_formatter import (
    ResponseFormatter,
    ResponseFormatterError,
)


logger = logging.getLogger(__name__)


class NotesGeneratorError(Exception):
    """Base exception for notes generation."""


class NotesGenerationError(NotesGeneratorError):
    """Raised when notes generation or parsing fails."""


@dataclass(frozen=True)
class NotesGeneratorConfig:
    """Configuration for notes generation."""

    max_tokens: int = 1536
    repair_max_tokens: int = 3072
    enable_json_repair: bool = True

    MIN_MAX_TOKENS = 256
    MAX_MAX_TOKENS = 8192

    MIN_REPAIR_TOKENS = 512
    MAX_REPAIR_TOKENS = 8192

    @classmethod
    def from_environment(cls) -> "NotesGeneratorConfig":
        return cls(
            max_tokens=cls._read_int(
                "NOTES_LLM_MAX_TOKENS",
                default=1536,
                minimum=cls.MIN_MAX_TOKENS,
                maximum=cls.MAX_MAX_TOKENS,
            ),
            repair_max_tokens=cls._read_int(
                "NOTES_LLM_REPAIR_MAX_TOKENS",
                default=3072,
                minimum=cls.MIN_REPAIR_TOKENS,
                maximum=cls.MAX_REPAIR_TOKENS,
            ),
            enable_json_repair=cls._read_bool(
                "NOTES_ENABLE_JSON_REPAIR",
                default=True,
            ),
        )

    @staticmethod
    def _read_int(
        name: str,
        *,
        default: int,
        minimum: int,
        maximum: int,
    ) -> int:
        value = os.getenv(name)

        if value is None:
            return default

        try:
            value = int(value)
        except ValueError:
            logger.warning(
                "Invalid %s=%r. Using default=%d.",
                name,
                value,
                default,
            )
            return default

        return max(minimum, min(value, maximum))

    @staticmethod
    def _read_bool(
        name: str,
        *,
        default: bool,
    ) -> bool:
        value = os.getenv(name)

        if value is None:
            return default

        value = value.strip().lower()

        if value in {"1", "true", "yes", "on"}:
            return True

        if value in {"0", "false", "no", "off"}:
            return False

        logger.warning(
            "Invalid %s=%r. Using default=%s.",
            name,
            value,
            default,
        )

        return default


@dataclass
class NotesGeneratorStatistics:
    """Runtime statistics."""

    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    repair_attempts: int = 0
    repair_successes: int = 0
    total_generation_ms: float = 0.0


class NotesGenerator:
    """Generate structured study notes using the shared AI services."""

    SERVICE_NAME = "StudyGenie Notes Generator"

    REQUIRED_FIELDS = (
        "title",
        "summary",
        "key_concepts",
        "important_points",
        "revision_tips",
    )

    def __init__(
        self,
        llm_service: Optional[LLMService] = None,
        prompt_service: Optional[PromptService] = None,
        response_formatter: Optional[ResponseFormatter] = None,
        config: Optional[NotesGeneratorConfig] = None,
    ) -> None:

        self.llm_service = llm_service or LLMService()
        self.prompt_service = prompt_service or PromptService()
        self.response_formatter = (
            response_formatter or ResponseFormatter()
        )
        self.config = (
            config or NotesGeneratorConfig.from_environment()
        )

        self._statistics = NotesGeneratorStatistics()
        self._statistics_lock = Lock()

    # =========================================================
    # Validation
    # =========================================================

    @staticmethod
    def validate_content(content: Any) -> str:
        """Validate study material."""

        if not isinstance(content, str):
            raise NotesGeneratorError(
                "Content must be a string."
            )

        content = content.strip()

        if not content:
            raise NotesGeneratorError(
                "Content cannot be empty."
            )

        return content

    # =========================================================
    # Prompt
    # =========================================================

    def build_prompt(self, content: str) -> str:
        """Build notes prompt using PromptService."""

        try:
            prompt = self.prompt_service.build_notes_prompt(
                content=content
            )
        except Exception as error:
            logger.exception(
                "Failed to build notes prompt."
            )
            raise NotesGenerationError(
                "Failed to build notes generation prompt."
            ) from error

        if not isinstance(prompt, str) or not prompt.strip():
            raise NotesGenerationError(
                "Generated notes prompt is empty."
            )

        return prompt

    # =========================================================
    # LLM
    # =========================================================

    def _generate_json(
        self,
        prompt: str,
        max_tokens: int,
    ) -> str:
        """Generate JSON using the shared LLM service."""

        try:
            response = self.llm_service.generate_json(
                prompt=prompt,
                max_tokens=max_tokens,
                timeout=getattr(
                    self.llm_service,
                    "notes_timeout",
                    None,
                ),
            )

        except LLMGenerationError as error:
            raise NotesGenerationError(
                f"LLM failed to generate notes: {error}"
            ) from error

        except Exception as error:
            logger.exception(
                "Unexpected LLM error."
            )
            raise NotesGenerationError(
                "Unexpected error during notes generation."
            ) from error

        if not isinstance(response, str) or not response.strip():
            raise NotesGenerationError(
                "LLM returned an empty response."
            )

        return response

    def generate_notes(self, prompt: str) -> str:
        """Generate the initial notes response."""

        if not isinstance(prompt, str) or not prompt.strip():
            raise NotesGenerationError(
                "Notes prompt cannot be empty."
            )

        return self._generate_json(
            prompt,
            self.config.max_tokens,
        )

    # =========================================================
    # Parsing
    # =========================================================

    def parse_notes(
        self,
        response: str,
    ) -> Dict[str, Any]:
        """Parse notes using ResponseFormatter."""

        if not isinstance(response, str) or not response.strip():
            raise NotesGenerationError(
                "Cannot parse an empty response."
            )

        try:
            notes = self.response_formatter.parse_notes(
                response
            )

        except ResponseFormatterError as error:
            raise NotesGenerationError(
                "Generated notes failed response validation."
            ) from error

        except Exception as error:
            logger.exception(
                "Unexpected notes parsing error."
            )
            raise NotesGenerationError(
                "Unexpected error while parsing notes."
            ) from error

        if not isinstance(notes, dict):
            raise NotesGenerationError(
                "Parsed notes must be an object."
            )

        return notes

    # =========================================================
    # JSON Repair
    # =========================================================

    def _build_repair_prompt(
        self,
        original_prompt: str,
    ) -> str:
        """Build a strict JSON repair prompt."""

        fields = ", ".join(
            self.REQUIRED_FIELDS
        )

        return f"""
{original_prompt}

IMPORTANT:

The previous response was not valid structured JSON.

Return ONLY one valid JSON object.

Required fields:
{fields}

Rules:
- Do not use Markdown.
- Do not use code fences.
- Do not add explanations outside the JSON.
- Do not omit required fields.
- Do not invent information.
- Use only the supplied study material.
""".strip()

    def _repair_notes(
        self,
        original_prompt: str,
    ) -> Dict[str, Any]:
        """Attempt exactly one JSON repair."""

        self._increment(
            "repair_attempts"
        )

        repair_prompt = self._build_repair_prompt(
            original_prompt
        )

        try:
            response = self._generate_json(
                repair_prompt,
                self.config.repair_max_tokens,
            )

            notes = self.parse_notes(
                response
            )

        except NotesGenerationError:
            logger.warning(
                "Notes JSON repair failed."
            )
            raise

        self._increment(
            "repair_successes"
        )

        logger.info(
            "Notes JSON repair succeeded."
        )

        return notes

    # =========================================================
    # Main Generation
    # =========================================================

    def generate(
        self,
        content: str,
    ) -> Dict[str, Any]:
        """Generate structured study notes."""

        started_at = time.perf_counter()

        self._increment(
            "total_requests"
        )

        try:
            content = self.validate_content(
                content
            )

            prompt = self.build_prompt(
                content
            )

            response = self.generate_notes(
                prompt
            )

            try:
                notes = self.parse_notes(
                    response
                )

            except NotesGenerationError as original_error:

                if not self.config.enable_json_repair:
                    raise

                logger.warning(
                    "Initial notes response was invalid. "
                    "Attempting JSON repair."
                )

                try:
                    notes = self._repair_notes(
                        prompt
                    )

                except NotesGenerationError:
                    raise original_error from original_error

            self._increment(
                "successful_requests"
            )

            self._record_duration(
                started_at
            )

            logger.info(
                "Notes generation completed successfully."
            )

            return self.response_formatter.success(
                notes
            )

        except NotesGeneratorError as error:

            self._increment(
                "failed_requests"
            )

            self._record_duration(
                started_at
            )

            logger.warning(
                "Notes generation failed: %s",
                error,
            )

            return self.response_formatter.error(
                str(error)
            )

        except Exception:

            self._increment(
                "failed_requests"
            )

            self._record_duration(
                started_at
            )

            logger.exception(
                "Unexpected NotesGenerator failure."
            )

            return self.response_formatter.error(
                "Unexpected notes generation failure."
            )

    # =========================================================
    # Health
    # =========================================================

    def health_check(self) -> bool:
        """Check LLM availability."""

        try:
            return bool(
                self.llm_service.health_check()
            )
        except Exception:
            logger.exception(
                "NotesGenerator health check failed."
            )
            return False

    # =========================================================
    # Statistics
    # =========================================================

    def _increment(
        self,
        field: str,
    ) -> None:
        """Thread-safe counter increment."""

        with self._statistics_lock:
            value = getattr(
                self._statistics,
                field,
                None,
            )

            if isinstance(value, int):
                setattr(
                    self._statistics,
                    field,
                    value + 1,
                )

    def _record_duration(
        self,
        started_at: float,
    ) -> float:
        """Record elapsed generation time."""

        elapsed_ms = (
            time.perf_counter() - started_at
        ) * 1000

        with self._statistics_lock:
            self._statistics.total_generation_ms += (
                elapsed_ms
            )

        return elapsed_ms

    def get_statistics(self) -> Dict[str, Any]:
        """Return current runtime statistics."""

        with self._statistics_lock:
            stats = NotesGeneratorStatistics(
                total_requests=self._statistics.total_requests,
                successful_requests=self._statistics.successful_requests,
                failed_requests=self._statistics.failed_requests,
                repair_attempts=self._statistics.repair_attempts,
                repair_successes=self._statistics.repair_successes,
                total_generation_ms=self._statistics.total_generation_ms,
            )

        total = stats.total_requests

        return {
            "service": self.SERVICE_NAME,
            "total_requests": stats.total_requests,
            "successful_requests": stats.successful_requests,
            "failed_requests": stats.failed_requests,
            "repair_attempts": stats.repair_attempts,
            "repair_successes": stats.repair_successes,
            "success_rate": round(
                (
                    stats.successful_requests
                    / max(total, 1)
                )
                * 100,
                2,
            ),
            "average_generation_ms": round(
                stats.total_generation_ms
                / max(total, 1),
                2,
            ),
        }

    def get_service_information(self) -> Dict[str, Any]:
        """Return configuration and statistics."""

        return {
            "service": self.SERVICE_NAME,
            "config": {
                "max_tokens": self.config.max_tokens,
                "repair_max_tokens": (
                    self.config.repair_max_tokens
                ),
                "json_repair_enabled": (
                    self.config.enable_json_repair
                ),
            },
            "statistics": self.get_statistics(),
        }

    def reset_statistics(self) -> None:
        """Reset runtime statistics."""

        with self._statistics_lock:
            self._statistics = NotesGeneratorStatistics()

    # =========================================================
    # Lifecycle
    # =========================================================

    def close(self) -> None:
        """Close generator resources.

        LLMService owns the actual model/network resources.
        """

        logger.debug(
            "NotesGenerator close requested."
        )

    # =========================================================
    # Callable
    # =========================================================

    def __call__(
        self,
        content: str,
    ) -> Dict[str, Any]:
        """Allow direct invocation."""

        return self.generate(content)