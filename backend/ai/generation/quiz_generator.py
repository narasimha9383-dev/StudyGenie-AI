"""
StudyGenie AI - Quiz Generator

Generates multiple-choice questions from supplied study material.

Flow:
    Content
       ↓
    PromptService
       ↓
    LLMService
       ↓
    ResponseFormatter
       ↓
    Structured Quiz
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

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


class QuizGenerator:
    """LLM-backed multiple-choice quiz generator."""

    DEFAULT_COUNT = 10
    MIN_COUNT = 1
    MAX_COUNT = 50

    DEFAULT_DIFFICULTY = "Medium"
    VALID_DIFFICULTIES = {
        "Easy",
        "Medium",
        "Hard",
    }

    def __init__(
        self,
        llm_service: Optional[LLMService] = None,
        prompt_service: Optional[PromptService] = None,
        response_formatter: Optional[ResponseFormatter] = None,
    ) -> None:

        self.llm_service = llm_service or LLMService()
        self.prompt_service = prompt_service or PromptService()
        self.response_formatter = (
            response_formatter or ResponseFormatter()
        )

        self.total_requests = 0
        self.successful_requests = 0
        self.failed_requests = 0

    # --------------------------------------------------------
    # Input validation
    # --------------------------------------------------------

    @classmethod
    def _normalize_count(cls, count: Any) -> int:
        """Normalize requested quiz question count."""

        try:
            value = int(count)
        except (TypeError, ValueError):
            value = cls.DEFAULT_COUNT

        return max(
            cls.MIN_COUNT,
            min(value, cls.MAX_COUNT),
        )

    @classmethod
    def _normalize_difficulty(cls, difficulty: Any) -> str:
        """Normalize quiz difficulty."""

        if not isinstance(difficulty, str):
            return cls.DEFAULT_DIFFICULTY

        difficulty = difficulty.strip().title()

        if difficulty not in cls.VALID_DIFFICULTIES:
            return cls.DEFAULT_DIFFICULTY

        return difficulty

    @staticmethod
    def _validate_content(content: Any) -> str:
        """Validate and normalize study material."""

        if not isinstance(content, str):
            raise ValueError("Study material must be text.")

        content = content.strip()

        if not content:
            raise ValueError("Study material cannot be empty.")

        return content

    # --------------------------------------------------------
    # Prompt
    # --------------------------------------------------------

    def build_prompt(
        self,
        content: str,
        count: int,
        difficulty: str,
    ) -> str:
        """Build the quiz-generation prompt."""

        return self.prompt_service.build_quiz_prompt(
            content=content,
            count=count,
            difficulty=difficulty,
        )

    # --------------------------------------------------------
    # LLM generation
    # --------------------------------------------------------

    def _generate_response(self, prompt: str) -> str:
        """Generate raw JSON response from the LLM."""

        try:
            return self.llm_service.generate_json(
                prompt=prompt,
            )

        except LLMGenerationError as error:
            logger.exception("Quiz LLM generation failed.")
            raise RuntimeError(
                f"Quiz generation failed: {error}"
            ) from error

    # --------------------------------------------------------
    # Parse response
    # --------------------------------------------------------

    def _parse_response(
        self,
        response: str,
    ) -> List[Dict[str, Any]]:
        """Parse and validate generated quiz."""

        try:
            quiz = self.response_formatter.parse_quiz(
                response
            )

        except ResponseFormatterError as error:
            logger.exception(
                "Quiz response parsing failed."
            )
            raise ValueError(
                f"Invalid quiz response: {error}"
            ) from error

        if not isinstance(quiz, list):
            raise ValueError(
                "Quiz response must be a list."
            )

        return quiz

    # --------------------------------------------------------
    # Main generation
    # --------------------------------------------------------

    def generate(
        self,
        content: str,
        count: int = DEFAULT_COUNT,
        difficulty: str = DEFAULT_DIFFICULTY,
    ) -> Dict[str, Any]:
        """
        Generate a structured quiz.

        Returns:

        {
            "success": True,
            "data": [...]
        }
        """

        self.total_requests += 1

        try:
            content = self._validate_content(content)

            count = self._normalize_count(count)

            difficulty = self._normalize_difficulty(
                difficulty
            )

            logger.info(
                "Generating quiz: count=%d difficulty=%s",
                count,
                difficulty,
            )

            prompt = self.build_prompt(
                content=content,
                count=count,
                difficulty=difficulty,
            )

            response = self._generate_response(prompt)

            quiz = self._parse_response(response)

            # Never return more questions than requested.
            quiz = quiz[:count]

            if not quiz:
                raise ValueError(
                    "The AI did not generate any valid quiz questions."
                )

            self.successful_requests += 1

            logger.info(
                "Quiz generation successful: %d question(s).",
                len(quiz),
            )

            return self.response_formatter.success(
                quiz
            )

        except Exception as error:
            self.failed_requests += 1

            logger.exception(
                "Quiz generation failed."
            )

            return self.response_formatter.error(
                str(error)
            )

    # --------------------------------------------------------
    # Health check
    # --------------------------------------------------------

    def health_check(self) -> bool:
        """Check whether the underlying LLM service is available."""

        try:
            return bool(
                self.llm_service.health_check()
            )

        except Exception:
            logger.exception(
                "Quiz generator health check failed."
            )
            return False

    # --------------------------------------------------------
    # Statistics
    # --------------------------------------------------------

    def get_statistics(self) -> Dict[str, Any]:
        """Return generation statistics."""

        total = self.total_requests

        success_rate = (
            (self.successful_requests / total) * 100
            if total
            else 0.0
        )

        return {
            "service": "Quiz Generator",
            "total_requests": total,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "success_rate": round(
                success_rate,
                2,
            ),
        }

    def reset_statistics(self) -> None:
        """Reset generation statistics."""

        self.total_requests = 0
        self.successful_requests = 0
        self.failed_requests = 0

    # --------------------------------------------------------
    # Callable interface
    # --------------------------------------------------------

    def __call__(
        self,
        content: str,
        count: int = DEFAULT_COUNT,
        difficulty: str = DEFAULT_DIFFICULTY,
    ) -> Dict[str, Any]:
        """Allow the generator to be called directly."""

        return self.generate(
            content=content,
            count=count,
            difficulty=difficulty,
        )