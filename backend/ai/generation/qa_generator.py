"""
StudyGenie AI - Descriptive Q&A Generator.

Generates structured descriptive questions and answers from study material.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional, Set

from ai.generation.llm_service import LLMGenerationError, LLMService
from ai.generation.prompt_service import PromptService
from ai.generation.response_formatter import (
    ResponseFormatter,
    ResponseFormatterError,
)

logger = logging.getLogger(__name__)


class QAGenerator:
    """LLM-backed generator for descriptive, non-MCQ study Q&A."""

    MIN_QUESTIONS = 3
    MAX_QUESTIONS = 20
    DEFAULT_QUESTIONS = 10

    # A requested count is a target, not a license to manufacture more
    # questions than the material can safely support.
    MIN_QA_QUESTIONS = 1
    MAX_GENERATED_QUESTIONS = 60

    GENERATION_MAX_TOKENS = 2048
    # Detailed student PDFs need room for a definition, a point-wise explanation
    # and a conclusion. Batch generation still bounds this per item.
    SINGLE_QUESTION_MAX_TOKENS = 1024

    QUESTION_BATCH_SIZE = max(
        2,
        int(os.getenv("QA_QUESTION_BATCH_SIZE", "10")),
    )

    QUESTION_GENERATION_MAX_TOKENS = max(
        256,
        int(os.getenv("QA_QUESTION_GEN_MAX_TOKENS", "512")),
    )

    QUESTION_STALE_LIMIT = max(
        2,
        int(os.getenv("QA_QUESTION_STALE_LIMIT", "4")),
    )

    _DEDUP_STOP_WORDS = {
        "what",
        "which",
        "how",
        "why",
        "who",
        "when",
        "where",
        "the",
        "a",
        "an",
        "of",
        "is",
        "are",
        "do",
        "does",
        "explain",
        "describe",
        "write",
        "discuss",
        "define",
        "list",
        "and",
        "or",
        "in",
        "to",
        "for",
        "with",
        "on",
        "its",
        "their",
        "give",
        "state",
        "outline",
        "detail",
        "about",
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

    # ------------------------------------------------------------------
    # Input normalization
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_content(content: Any) -> Optional[str]:
        """Return normalized content or None when invalid."""
        if not isinstance(content, str):
            return None

        content = content.strip()
        return content or None

    @classmethod
    def _normalize_count(cls, count: Any) -> int:
        """Normalize legacy generate() question count."""
        try:
            value = int(count)
        except (TypeError, ValueError):
            value = cls.DEFAULT_QUESTIONS

        if value <= 0:
            value = cls.DEFAULT_QUESTIONS

        return max(
            cls.MIN_QUESTIONS,
            min(value, cls.MAX_QUESTIONS),
        )

    @staticmethod
    def _normalize_source_questions(
        source_questions: Optional[List[Dict[str, Any]]],
    ) -> List[Dict[str, Any]]:
        """Normalize source questions."""
        if not isinstance(source_questions, list):
            return []

        normalized = []

        for item in source_questions:
            if not isinstance(item, dict):
                continue

            question = item.get("question")

            if not isinstance(question, str):
                continue

            question = question.strip()

            if not question:
                continue

            normalized.append(
                {
                    **item,
                    "question": question,
                }
            )

        return normalized

    @staticmethod
    def _normalize_source_images(
        source_images: Optional[List[str]],
    ) -> List[str]:
        """Normalize source image paths/URLs."""
        if not isinstance(source_images, list):
            return []

        return [
            image.strip()
            for image in source_images
            if isinstance(image, str) and image.strip()
        ]

    # ------------------------------------------------------------------
    # Legacy multi-Q&A generation
    # ------------------------------------------------------------------

    def generate(
        self,
        content: str,
        count: int = DEFAULT_QUESTIONS,
        source_questions: Optional[List[Dict[str, Any]]] = None,
        source_images: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Generate multiple descriptive questions and answers."""

        normalized_content = self._validate_content(content)

        if normalized_content is None:
            return self.response_formatter.error(
                "Study material cannot be empty."
            )

        question_count = self._normalize_count(count)
        normalized_source_questions = (
            self._normalize_source_questions(source_questions)
        )
        normalized_source_images = (
            self._normalize_source_images(source_images)
        )

        has_images = bool(normalized_source_images)

        try:
            prompt = self.prompt_service.build_qa_prompt(
                normalized_content,
                count=question_count,
                source_questions=normalized_source_questions,
                has_images=has_images,
            )
        except Exception as error:
            logger.exception("Failed to build Q&A prompt.")
            return self.response_formatter.error(
                f"Failed to build Q&A prompt: {error}"
            )

        response = self._generate_with_repair(
            prompt=prompt,
            max_tokens=self.GENERATION_MAX_TOKENS,
            images=normalized_source_images if has_images else None,
            parser=self.response_formatter.parse_qa,
            repair_instruction=self._qa_repair_instruction(),
        )

        if response is None:
            return self.response_formatter.error(
                "The AI returned an invalid Q&A response."
            )

        if not isinstance(response, list):
            logger.error("Q&A formatter returned a non-list response.")
            return self.response_formatter.error(
                "Invalid Q&A response structure."
            )

        normalized_data = self._normalize_qa_items(
            response[:question_count]
        )

        if not normalized_data:
            logger.warning(
                "Q&A generation returned no valid questions."
            )
            return self.response_formatter.error(
                "The AI did not generate any valid study questions."
            )

        logger.info(
            "Generated %d descriptive Q&A item(s).",
            len(normalized_data),
        )

        return self.response_formatter.success(normalized_data)

    # ------------------------------------------------------------------
    # Generic generation + repair
    # ------------------------------------------------------------------

    def _generate_with_repair(
        self,
        prompt: str,
        max_tokens: int,
        images: Optional[List[str]],
        parser: Any,
        repair_instruction: str,
    ) -> Any:
        """Generate JSON and retry once when the response is invalid."""

        try:
            response = self.llm_service.generate_json(
                prompt=prompt,
                max_tokens=max_tokens,
                images=images,
            )
            return parser(response)

        except (
            LLMGenerationError,
            ResponseFormatterError,
            ValueError,
        ) as error:
            logger.warning(
                "Initial LLM response failed validation: %s",
                error,
            )

        except Exception:
            logger.exception("Unexpected LLM generation failure.")

        repair_prompt = f"{prompt}\n\n{repair_instruction}"

        try:
            response = self.llm_service.generate_json(
                prompt=repair_prompt,
                max_tokens=max_tokens,
                images=images,
            )
            return parser(response)

        except Exception as error:
            logger.exception("LLM response repair failed: %s", error)
            return None

    @staticmethod
    def _qa_repair_instruction() -> str:
        """Return the repair instruction for multi-Q&A generation."""
        return """
IMPORTANT:
Return ONLY valid JSON.
Return a JSON array.

Each item must contain exactly:
- question
- answer
- key_points

Do NOT include:
- options
- choices
- difficulty
- score
- quiz
- correct_answer
- explanation

Do not use Markdown.
Do not use code fences.
""".strip()

    @staticmethod
    def _single_qa_repair_instruction() -> str:
        """Return the repair instruction for one Q&A."""
        return """
IMPORTANT:
Return ONLY one valid JSON object.
Do NOT return an array.

Use exactly:
- question
- answer
- key_points

Do NOT include:
- options
- choices
- difficulty
- score
- quiz
- correct_answer

Do not use Markdown.
Do not use code fences.
""".strip()

    # ------------------------------------------------------------------
    # Normalize generated Q&A
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_qa_items(
        data: Any,
    ) -> List[Dict[str, Any]]:
        """Normalize generated Q&A objects."""

        if not isinstance(data, list):
            return []

        normalized = []

        for item in data:
            if not isinstance(item, dict):
                continue

            question = str(item.get("question", "")).strip()
            answer = str(item.get("answer", "")).strip()

            if not question or not answer:
                continue

            key_points = item.get("key_points", [])

            if not isinstance(key_points, list):
                key_points = []

            key_points = [
                str(point).strip()
                for point in key_points
                if point is not None and str(point).strip()
            ]

            normalized.append(
                {
                    "question": question,
                    "answer": answer,
                    "key_points": key_points,
                }
            )

        return normalized

    # ------------------------------------------------------------------
    # Study-material question count
    # ------------------------------------------------------------------

    @classmethod
    def effective_question_count(cls, requested: Any) -> int:
        """Return the effective study-material Q&A count.

        Minimum: 1
        Maximum: 60
        """

        try:
            value = int(requested)
        except (TypeError, ValueError):
            value = cls.DEFAULT_QUESTIONS

        if value <= 0:
            value = cls.DEFAULT_QUESTIONS

        return min(max(value, cls.MIN_QA_QUESTIONS), cls.MAX_GENERATED_QUESTIONS)

    # ------------------------------------------------------------------
    # Question-only generation
    # ------------------------------------------------------------------

    def generate_questions(
        self,
        content: str,
        count: int,
        max_attempts: int = 4,
        avoid: Optional[List[str]] = None,
    ) -> List[str]:
        """Generate distinct descriptive questions without answers."""

        normalized_content = self._validate_content(content)

        if normalized_content is None:
            return []

        target = max(1, int(count))

        collected: List[str] = []
        seen: Set[str] = set()

        external_avoid = self._prepare_avoid_questions(
            avoid,
            seen,
        )

        batch_size = max(1, self.QUESTION_BATCH_SIZE)

        rounds_needed = (
            target + batch_size - 1
        ) // batch_size

        attempt_budget = max(
            max_attempts,
            rounds_needed * 2 + 4,
        )

        stale_rounds = 0

        for attempt in range(1, attempt_budget + 1):
            if len(collected) >= target:
                break

            remaining = target - len(collected)

            ask_count = min(
                self.MAX_GENERATED_QUESTIONS,
                batch_size,
                remaining + 2,
            )

            try:
                prompt = (
                    self.prompt_service.build_qa_questions_prompt(
                        normalized_content,
                        count=ask_count,
                        avoid=external_avoid + collected,
                    )
                )

                response = self.llm_service.generate_json(
                    prompt=prompt,
                    max_tokens=self.QUESTION_GENERATION_MAX_TOKENS,
                )

            except Exception:
                logger.warning(
                    "Question generation attempt %d/%d failed.",
                    attempt,
                    attempt_budget,
                    exc_info=True,
                )

                stale_rounds += 1

                if stale_rounds >= self.QUESTION_STALE_LIMIT:
                    break

                continue

            added = self._add_unique_questions(
                response,
                collected,
                seen,
                target,
                normalized_content,
            )

            stale_rounds = 0 if added else stale_rounds + 1

            if stale_rounds >= self.QUESTION_STALE_LIMIT:
                logger.info(
                    "Question generation stopped after %d stale attempts.",
                    stale_rounds,
                )
                break

        logger.info(
            "Generated %d distinct question(s), target=%d.",
            len(collected),
            target,
        )

        return collected

    @staticmethod
    def _prepare_avoid_questions(
        avoid: Optional[List[str]],
        seen: Set[str],
    ) -> List[str]:
        """Normalize externally supplied questions to avoid."""

        result = []

        for question in avoid or []:
            if not isinstance(question, str):
                continue

            question = question.strip()

            if not question:
                continue

            result.append(question)

            key = QAGenerator._dedup_key(question)

            if key:
                seen.add(key)

        return result

    def _add_unique_questions(
        self,
        response: str,
        collected: List[str],
        seen: Set[str],
        target: int,
        content: str = "",
    ) -> int:
        """Parse and add unique questions."""

        added = 0

        for question in self._parse_questions(response):
            key = self._dedup_key(question)

            if (
                not key
                or key in seen
                or self._is_near_duplicate(question, collected)
                or not self._is_question_source_supported(question, content)
            ):
                continue

            seen.add(key)
            collected.append(question)
            added += 1

            if len(collected) >= target:
                break

        return added

    @classmethod
    def _is_question_source_supported(cls, question: str, content: str) -> bool:
        """Require the question's subject matter to occur in the material.

        This is intentionally lexical and conservative. It does not prove a
        complete answer, but it prevents an LLM from introducing a new named
        topic (for example, an inventor or date absent from the PDF) before the
        answer-generation stage adds its separate evidence check.
        """
        source_terms = {
            token
            for token in re.findall(r"[a-z0-9]{3,}", str(content).lower())
        }
        question_terms = {
            token
            for token in cls._dedup_key(question).split()
            if token not in {
                "work", "works", "function", "functions", "important",
                "importance", "purpose", "role", "process", "steps",
                "step", "benefits", "advantages", "disadvantages",
            }
        }

        if not source_terms or not question_terms:
            return False

        matched = len(question_terms & source_terms)
        return matched >= min(2, len(question_terms)) and (
            matched / len(question_terms)
        ) >= 0.66

    @classmethod
    def _is_near_duplicate(cls, question: str, existing: List[str]) -> bool:
        """Reject superficial rewrites such as ``What is GAN?`` / ``Define GAN.``."""
        candidate = set(cls._dedup_key(question).split())
        if not candidate:
            return True
        for previous in existing:
            prior = set(cls._dedup_key(previous).split())
            if not prior:
                continue
            overlap = len(candidate & prior) / max(1, min(len(candidate), len(prior)))
            if overlap >= 0.8:
                return True
        return False

    # ------------------------------------------------------------------
    # Parse generated questions
    # ------------------------------------------------------------------

    def _parse_questions(
        self,
        response: str,
    ) -> List[str]:
        """Parse question-generation JSON."""

        try:
            parsed = self.response_formatter.parse_json(response)
        except Exception:
            logger.warning(
                "Could not parse question-generation JSON."
            )
            return []

        items = parsed

        if isinstance(parsed, dict):
            for key in ("questions", "data", "items", "qa"):
                if isinstance(parsed.get(key), list):
                    items = parsed[key]
                    break
            else:
                items = [parsed]

        if not isinstance(items, list):
            return []

        questions = []

        for item in items:
            if isinstance(item, str):
                question = item.strip()

            elif isinstance(item, dict):
                question = str(
                    item.get("question")
                    or item.get("prompt")
                    or ""
                ).strip()

            else:
                continue

            if len(question) >= 8:
                questions.append(question)

        return questions

    # ------------------------------------------------------------------
    # Question deduplication
    # ------------------------------------------------------------------

    @classmethod
    def _dedup_key(cls, question: str) -> str:
        """Create a normalized content-based question key."""

        tokens = re.findall(
            r"[a-z0-9]+",
            str(question).lower(),
        )

        core = [
            token
            for token in tokens
            if token not in cls._DEDUP_STOP_WORDS
            and len(token) > 2
        ]

        return (
            " ".join(core[:12])
            if core
            else str(question).strip().lower()
        )

    # ------------------------------------------------------------------
    # Answer one question
    # ------------------------------------------------------------------

    def answer_single(
        self,
        content: str,
        question: str,
        source_images: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Answer one descriptive question."""

        normalized_content = self._validate_content(content)

        if normalized_content is None:
            return {
                "question": question or "",
                "answer": "The uploaded study material is empty.",
                "key_points": [],
            }

        question = (
            question.strip()
            if isinstance(question, str)
            else ""
        )

        if not question:
            return {
                "question": "",
                "answer": "",
                "key_points": [],
            }

        images = self._normalize_source_images(source_images)
        has_images = bool(images)

        try:
            prompt = self.prompt_service.build_single_qa_prompt(
                normalized_content,
                question,
                has_images=has_images,
            )
        except Exception:
            logger.exception(
                "Failed to build single Q&A prompt."
            )

            return {
                "question": question,
                "answer": (
                    "The AI could not prepare the question "
                    "for processing."
                ),
                "key_points": [],
            }

        item = self._generate_single_answer(
            prompt=prompt,
            images=images if has_images else None,
        )

        if not item or not item.get("answer"):
            return {
                "question": question,
                "answer": (
                    "The AI could not generate an answer "
                    "for this question from the uploaded material."
                ),
                "key_points": [],
            }

        item["question"] = (
            str(item.get("question") or question).strip()
        )

        return item

    def answer_batch(
        self,
        content: str,
        questions: List[str],
    ) -> List[Dict[str, Any]]:
        """Answer a small ordered question batch with one LLM call."""
        normalized_content = self._validate_content(content)
        normalized_questions = [
            str(question).strip() for question in questions if str(question).strip()
        ]
        if normalized_content is None or not normalized_questions:
            return []
        prompt = self.prompt_service.build_qa_answer_batch_prompt(
            normalized_content,
            normalized_questions,
        )
        try:
            batch_cap = max(1, min(len(normalized_questions), 4))
            response = self.llm_service.generate_json(
                prompt=prompt,
                max_tokens=self.SINGLE_QUESTION_MAX_TOKENS * batch_cap,
            )
            parsed = self.response_formatter.parse_json(response)
            items = parsed.get("items", []) if isinstance(parsed, dict) else parsed
            normalized = self._normalize_qa_items(items)
        except Exception:
            logger.warning("Batch answer generation failed.", exc_info=True)
            return []
        if len(normalized) != len(normalized_questions):
            return []
        for index, question in enumerate(normalized_questions):
            normalized[index]["question"] = question
        return normalized

    def _generate_single_answer(
        self,
        prompt: str,
        images: Optional[List[str]],
    ) -> Optional[Dict[str, Any]]:
        """Generate and repair a single Q&A response."""

        try:
            response = self.llm_service.generate_json(
                prompt=prompt,
                max_tokens=self.SINGLE_QUESTION_MAX_TOKENS,
                images=images,
            )

            return self._parse_single(response)

        except (
            LLMGenerationError,
            ResponseFormatterError,
            ValueError,
        ):
            logger.warning(
                "Initial single-question generation failed. "
                "Attempting repair."
            )

        except Exception:
            logger.exception(
                "Unexpected single-question generation failure."
            )

        try:
            repair_prompt = (
                f"{prompt}\n\n"
                f"{self._single_qa_repair_instruction()}"
            )

            response = self.llm_service.generate_json(
                prompt=repair_prompt,
                max_tokens=self.SINGLE_QUESTION_MAX_TOKENS,
                images=images,
            )

            return self._parse_single(response)

        except Exception:
            logger.exception(
                "Single-question repair failed."
            )
            return None

    # ------------------------------------------------------------------
    # Parse single Q&A
    # ------------------------------------------------------------------

    def _parse_single(
        self,
        response: str,
    ) -> Dict[str, Any]:
        """Parse and normalize one Q&A object."""

        parsed = self.response_formatter.parse_json(response)

        if isinstance(parsed, list):
            parsed = next(
                (
                    item
                    for item in parsed
                    if isinstance(item, dict)
                ),
                {},
            )

        if not isinstance(parsed, dict):
            raise ResponseFormatterError(
                "Expected a single Q&A object."
            )

        question = parsed.get(
            "question",
            parsed.get("prompt", ""),
        )

        answer = parsed.get(
            "answer",
            parsed.get("explanation", ""),
        )

        key_points = parsed.get(
            "key_points",
            parsed.get("keyPoints", []),
        )

        question = (
            str(question).strip()
            if question is not None
            else ""
        )

        answer = (
            str(answer).strip()
            if answer is not None
            else ""
        )

        if not isinstance(key_points, list):
            key_points = []

        normalized_key_points = [
            str(point).strip()
            for point in key_points
            if point is not None and str(point).strip()
        ]

        return {
            "question": question,
            "answer": answer,
            "key_points": normalized_key_points,
        }
