"""
StudyGenie AI - Flashcard Generation Service.

Responsibilities
----------------
- Validate flashcard generation input.
- Build the flashcard prompt through PromptService.
- Generate structured output through LLMService.
- Parse and validate the response through ResponseFormatter.
- Return a consistent application response.

Architecture
------------
    FlashcardGenerator
        |
        +--> PromptService
        |
        +--> LLMService
        |
        +--> ResponseFormatter

Design principle
----------------
This class is an orchestration layer.

It does NOT:
    - implement prompts
    - implement LLM communication
    - implement JSON parsing
    - implement response validation
    - implement retry logic
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from ai.generation.llm_service import LLMService
from ai.generation.prompt_service import PromptService
from ai.generation.response_formatter import ResponseFormatter


logger = logging.getLogger(__name__)


class FlashcardGenerator:
    """
    Application service for flashcard generation.

    Dependency injection is supported so the service can be tested
    independently from the real LLM and prompt implementations.
    """

    # ============================================================
    # Configuration
    # ============================================================

    DEFAULT_COUNT = 20
    MIN_COUNT = 1
    MAX_COUNT = 50

    # ============================================================
    # Initialization
    # ============================================================

    def __init__(
        self,
        llm_service: Optional[LLMService] = None,
        prompt_service: Optional[PromptService] = None,
        response_formatter: Optional[ResponseFormatter] = None,
    ) -> None:
        """
        Initialize the flashcard generator.

        Production defaults use the shared service implementations.
        Tests may inject lightweight mocks/fakes.
        """

        self.llm_service = (
            llm_service
            if llm_service is not None
            else LLMService()
        )

        self.prompt_service = (
            prompt_service
            if prompt_service is not None
            else PromptService()
        )

        self.response_formatter = (
            response_formatter
            if response_formatter is not None
            else ResponseFormatter()
        )

    # ============================================================
    # Public API
    # ============================================================

    def generate(
        self,
        content: str,
        count: int = DEFAULT_COUNT,
    ) -> Dict[str, Any]:
        """
        Generate flashcards from study material.

        Parameters
        ----------
        content:
            Source study material.

        count:
            Requested number of flashcards.

        Returns
        -------
        Dict[str, Any]
            ResponseFormatter-compatible success/error response.
        """

        # --------------------------------------------------------
        # 1. Validate content
        # --------------------------------------------------------

        normalized_content = self._normalize_content(content)

        if normalized_content is None:
            return self.response_formatter.error(
                "Content must be a non-empty string."
            )

        # --------------------------------------------------------
        # 2. Normalize count
        # --------------------------------------------------------

        try:
            normalized_count = self._normalize_count(count)

        except (TypeError, ValueError) as error:

            logger.warning(
                "Invalid flashcard count: %r",
                count,
            )

            return self.response_formatter.error(
                str(error)
            )

        logger.info(
            "Starting flashcard generation: count=%d",
            normalized_count,
        )

        # --------------------------------------------------------
        # 3. Build prompt
        # --------------------------------------------------------

        try:

            prompt = (
                self.prompt_service
                .build_flashcard_prompt(
                    normalized_content,
                    count=normalized_count,
                )
            )

        except Exception as error:

            logger.exception(
                "Failed to build flashcard prompt."
            )

            return self.response_formatter.error(
                f"Failed to build flashcard prompt: {error}"
            )

        # --------------------------------------------------------
        # 4. Generate structured response
        # --------------------------------------------------------

        try:

            raw_response = (
                self.llm_service
                .generate_json(
                    prompt
                )
            )

        except Exception as error:

            logger.exception(
                "Flashcard LLM generation failed."
            )

            return self.response_formatter.error(
                f"Flashcard generation failed: {error}"
            )

        # --------------------------------------------------------
        # 5. Parse and validate response
        # --------------------------------------------------------

        try:

            cards = (
                self.response_formatter
                .parse_flashcards(
                    raw_response
                )
            )

        except Exception as error:

            logger.exception(
                "Failed to parse flashcard response."
            )

            return self.response_formatter.error(
                f"Invalid flashcard response: {error}"
            )

        # --------------------------------------------------------
        # 6. Final sanity check
        # --------------------------------------------------------

        card_count = self._result_count(
            cards
        )

        if card_count == 0:

            logger.warning(
                "Flashcard generation returned zero valid cards."
            )

            return self.response_formatter.error(
                "No valid flashcards were generated."
            )

        logger.info(
            "Flashcard generation completed: "
            "requested=%d generated=%d",
            normalized_count,
            card_count,
        )

        # --------------------------------------------------------
        # 7. Return standardized result
        # --------------------------------------------------------

        return self.response_formatter.success(
            cards
        )

    # ============================================================
    # Content Validation
    # ============================================================

    @staticmethod
    def _normalize_content(
        content: Any,
    ) -> Optional[str]:
        """
        Validate and normalize source content.

        Returns None when content is invalid.
        """

        if not isinstance(
            content,
            str,
        ):
            logger.warning(
                "Flashcard content must be a string."
            )

            return None

        normalized = content.strip()

        if not normalized:

            logger.warning(
                "Flashcard content is empty."
            )

            return None

        return normalized

    # ============================================================
    # Count Validation
    # ============================================================

    @classmethod
    def _normalize_count(
        cls,
        count: Any,
    ) -> int:
        """
        Normalize requested flashcard count.

        Rules
        -----
        - bool is rejected
        - integer-compatible values are accepted
        - values below MIN_COUNT become MIN_COUNT
        - values above MAX_COUNT become MAX_COUNT

        Example
        -------
        count=0   -> 1
        count=20  -> 20
        count=100 -> 50
        """

        if isinstance(
            count,
            bool,
        ):
            raise TypeError(
                "Flashcard count must be an integer."
            )

        try:

            normalized = int(
                count
            )

        except (
            TypeError,
            ValueError,
        ) as error:

            raise ValueError(
                "Flashcard count must be a valid integer."
            ) from error

        return max(
            cls.MIN_COUNT,
            min(
                cls.MAX_COUNT,
                normalized,
            ),
        )

    # ============================================================
    # Result Inspection
    # ============================================================

    @staticmethod
    def _result_count(
        cards: Any,
    ) -> int:
        """
        Safely determine the number of generated cards.

        ResponseFormatter remains responsible for actual
        validation. This method is only for orchestration
        and logging.
        """

        if isinstance(
            cards,
            (list, tuple),
        ):
            return len(cards)

        return 0

    # ============================================================
    # Callable Interface
    # ============================================================

    def __call__(
        self,
        content: str,
        count: int = DEFAULT_COUNT,
    ) -> Dict[str, Any]:
        """
        Allow:

            generator(content, count=20)

        instead of:

            generator.generate(content, count=20)
        """

        return self.generate(
            content=content,
            count=count,
        )


# ============================================================
# Shared Service
# ============================================================

flashcard_generator = FlashcardGenerator()