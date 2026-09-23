"""
============================================================
StudyGenie AI
Response Formatter
------------------------------------------------------------
Responsibilities
------------------------------------------------------------
1. Safely clean LLM responses
2. Parse JSON responses
3. Extract JSON embedded in prose
4. Validate Notes responses
5. Validate Quiz responses
6. Validate Flashcard responses
7. Validate descriptive Q&A responses
8. Normalize common LLM output variations
9. Provide consistent success/error envelopes
10. Protect application code from malformed LLM output

Design Goals
------------
- Production-safe
- Type-safe
- Defensive parsing
- No unsafe eval()
- No execution of model-generated code
- Compatible with local LLMs and OpenRouter models
- Backward compatible with existing StudyGenie services

Author : StudyGenie AI
============================================================
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple, Union, cast


# ============================================================
# Logger
# ============================================================

logger = logging.getLogger(__name__)


# ============================================================
# Type Aliases
# ============================================================

JSONDict = Dict[str, Any]
JSONList = List[Any]
JSONValue = Union[JSONDict, JSONList]


# ============================================================
# Custom Exception
# ============================================================


class ResponseFormatterError(Exception):
    """
    Raised when response formatting, parsing, normalization,
    or validation fails.
    """


# ============================================================
# Response Formatter
# ============================================================


class ResponseFormatter:
    """
    Production-grade formatter and validator for LLM responses.

    The LLM is considered an untrusted input source.

    Therefore this class:

    - never uses eval()
    - never executes model output
    - never assumes JSON is valid
    - validates expected structures
    - normalizes common model mistakes
    - returns predictable application-level responses
    """

    # ========================================================
    # Configuration
    # ========================================================

    MAX_RESPONSE_CHARS = 2_000_000

    MAX_JSON_DEPTH = 20

    # Supported JSON wrapper keys returned by different models.
    QUIZ_WRAPPER_KEYS = (
        "questions",
        "quiz",
        "items",
        "data",
    )

    QA_WRAPPER_KEYS = (
        "questions",
        "qa",
        "items",
        "data",
    )

    # ========================================================
    # Generic Helpers
    # ========================================================

    @staticmethod
    def _is_non_empty_string(value: Any) -> bool:
        """
        Check whether a value is a non-empty string.
        """

        return (
            isinstance(value, str)
            and bool(value.strip())
        )

    @staticmethod
    def _safe_string(value: Any) -> str:
        """
        Convert a value to a safe string.

        None becomes an empty string.
        """

        if value is None:
            return ""

        if isinstance(value, str):
            return value.strip()

        return str(value).strip()

    @staticmethod
    def _safe_list(value: Any) -> List[Any]:
        """
        Return a list if value is a list, otherwise [].
        """

        if isinstance(value, list):
            return value

        return []

    # ========================================================
    # Clean Response
    # ========================================================

    @classmethod
    def clean_response(
        cls,
        text: str,
    ) -> str:
        """
        Clean raw LLM output.

        Handles:

        - leading/trailing whitespace
        - Markdown code fences
        - ```json
        - ```JSON
        - bare ```
        - BOM characters
        """

        if not isinstance(text, str):
            return ""

        cleaned = text.strip()

        if not cleaned:
            return ""

        # Remove UTF-8 BOM if present.
        cleaned = cleaned.lstrip("\ufeff")

        # Remove opening Markdown code fence.
        cleaned = re.sub(
            r"^\s*```(?:json|JSON)?[ \t]*\r?\n?",
            "",
            cleaned,
        )

        # Remove closing Markdown code fence.
        cleaned = re.sub(
            r"\r?\n?\s*```\s*$",
            "",
            cleaned,
        )

        return cleaned.strip()

    # ========================================================
    # Response Size Validation
    # ========================================================

    @classmethod
    def _validate_response_size(
        cls,
        text: str,
    ) -> None:
        """
        Prevent unexpectedly huge LLM responses.
        """

        if len(text) > cls.MAX_RESPONSE_CHARS:
            raise ResponseFormatterError(
                "LLM response exceeds the maximum allowed size."
            )

    # ========================================================
    # JSON Extraction
    # ========================================================

    @staticmethod
    def _find_json_start_positions(
        text: str,
    ) -> List[int]:
        """
        Find possible JSON object/array starting positions.
        """

        return [
            match.start()
            for match in re.finditer(
                r"[\[{]",
                text,
            )
        ]

    @staticmethod
    def _remove_trailing_json_commas(text: str) -> str:
        """Repair only commas immediately before a JSON closing token.

        The scan tracks JSON strings and escapes, so text such as
        ``"literal,}"`` is not modified. This is deliberately a narrow syntax
        repair; it never adds or changes generated content.
        """
        output: List[str] = []
        in_string = False
        escaped = False
        index = 0

        while index < len(text):
            char = text[index]

            if in_string:
                output.append(char)
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                index += 1
                continue

            if char == '"':
                in_string = True
                output.append(char)
                index += 1
                continue

            if char == ",":
                look_ahead = index + 1
                while look_ahead < len(text) and text[look_ahead].isspace():
                    look_ahead += 1
                if look_ahead < len(text) and text[look_ahead] in "}]":
                    index += 1
                    continue

            output.append(char)
            index += 1

        return "".join(output)

    # ========================================================
    # JSON Parsing
    # ========================================================

    @classmethod
    def parse_json(
        cls,
        text: str,
    ) -> JSONValue:
        """
        Safely parse JSON from an LLM response.

        Supports:

        1. Pure JSON
        2. JSON surrounded by Markdown fences
        3. JSON embedded inside explanatory prose

        Example:

            Here is the result:

            {"title": "Machine Learning"}

        No eval() or unsafe execution is used.
        """

        cleaned = cls.clean_response(text)

        if not cleaned:
            raise ResponseFormatterError(
                "LLM returned an empty response."
            )

        cls._validate_response_size(cleaned)

        # ----------------------------------------------------
        # Direct JSON parsing
        # ----------------------------------------------------

        try:
            parsed = json.loads(cleaned)

        except json.JSONDecodeError as direct_error:

            repaired = cls._remove_trailing_json_commas(cleaned)

            if repaired != cleaned:
                try:
                    parsed = json.loads(repaired)
                    logger.debug("Recovered JSON after removing trailing commas.")
                except json.JSONDecodeError:
                    parsed = None
                else:
                    if isinstance(parsed, (dict, list)):
                        return parsed

            # ------------------------------------------------
            # Attempt JSON fragment extraction
            # ------------------------------------------------

            decoder = json.JSONDecoder()

            for candidate_text in (cleaned, repaired):
                candidates = cls._find_json_start_positions(candidate_text)

                for start in candidates:
                    fragment = candidate_text[start:]

                    try:
                        parsed, _ = decoder.raw_decode(fragment)

                        if isinstance(parsed, (dict, list)):
                            logger.debug(
                                "Recovered JSON fragment from LLM response."
                            )
                            return parsed

                    except json.JSONDecodeError:
                        continue

            logger.warning(
                "Unable to parse structured LLM response: %s",
                direct_error.msg,
            )

            raise ResponseFormatterError(
                f"JSON parsing failed: "
                f"{direct_error.msg}."
            ) from direct_error

        # ----------------------------------------------------
        # Validate top-level JSON type
        # ----------------------------------------------------

        if not isinstance(
            parsed,
            (dict, list),
        ):
            raise ResponseFormatterError(
                "JSON response must be an object or an array."
            )

        return parsed

    # ========================================================
    # Notes Validation
    # ========================================================

    @classmethod
    def validate_notes(
        cls,
        notes: Any,
    ) -> bool:
        """
        Validate StudyGenie Notes structure.

        Required:

        title
        summary
        key_concepts
        important_points
        revision_tips
        """

        if not isinstance(notes, dict):
            return False

        required_strings = (
            "title",
            "summary",
        )

        required_lists = (
            "key_concepts",
            "important_points",
            "revision_tips",
        )

        for field in required_strings:

            if not cls._is_non_empty_string(
                notes.get(field)
            ):
                return False

        for field in required_lists:

            if not isinstance(
                notes.get(field),
                list,
            ):
                return False

        return True

    # ========================================================
    # Quiz Validation
    # ========================================================

    @classmethod
    def validate_quiz(
        cls,
        quiz: Any,
    ) -> bool:
        """
        Validate multiple-choice quiz questions.
        """

        if not isinstance(quiz, list):
            return False

        if not quiz:
            return False

        for item in quiz:

            if not isinstance(item, dict):
                return False

            question = item.get("question")

            options = item.get("options")

            answer = item.get("answer")

            explanation = item.get(
                "explanation"
            )

            # Question
            if not cls._is_non_empty_string(
                question
            ):
                return False

            # Options
            if not isinstance(
                options,
                list,
            ):
                return False

            if len(options) != 4:
                return False

            for option in options:

                if not cls._is_non_empty_string(
                    option
                ):
                    return False

            normalized_options = {
                re.sub(r"\s+", " ", option.strip().lower())
                for option in options
            }
            if len(normalized_options) != 4:
                return False

            # Answer
            if not cls._is_non_empty_string(
                answer
            ):
                return False

            if re.sub(r"\s+", " ", answer.strip().lower()) not in normalized_options:
                return False

            # Explanation
            if not isinstance(
                explanation,
                str,
            ):
                return False

        return True

    # ========================================================
    # Flashcard Validation
    # ========================================================

    @classmethod
    def validate_flashcards(
        cls,
        cards: Any,
    ) -> bool:
        """
        Validate front/back flashcards.
        """

        if not isinstance(cards, list):
            return False

        if not cards:
            return False

        for card in cards:

            if not isinstance(card, dict):
                return False

            if not cls._is_non_empty_string(
                card.get("front")
            ):
                return False

            if not cls._is_non_empty_string(
                card.get("back")
            ):
                return False

        return True

    # ========================================================
    # Q&A Validation
    # ========================================================

    @classmethod
    def validate_qa(
        cls,
        items: Any,
    ) -> bool:
        """
        Validate descriptive question-answer pairs.

        MCQ-specific fields such as options/choices/difficulty
        are intentionally rejected.
        """

        if not isinstance(items, list):
            return False

        if not items:
            return False

        for item in items:

            if not isinstance(item, dict):
                return False

            if not cls._is_non_empty_string(
                item.get("question")
            ):
                return False

            if not cls._is_non_empty_string(
                item.get("answer")
            ):
                return False

            if item.get("options"):
                return False

            if item.get("choices"):
                return False

            if item.get("difficulty"):
                return False

        return True

    # ========================================================
    # Success Envelope
    # ========================================================

    @staticmethod
    def success(
        data: Any,
    ) -> Dict[str, Any]:
        """
        Return a standardized successful response.
        """

        return {
            "success": True,
            "data": data,
        }

    # ========================================================
    # Error Envelope
    # ========================================================

    @staticmethod
    def error(
        message: str,
    ) -> Dict[str, Any]:
        """
        Return a standardized error response.
        """

        return {
            "success": False,
            "error": str(message),
        }

    # ========================================================
    # Parse Notes
    # ========================================================

    @classmethod
    def parse_notes(
        cls,
        text: str,
    ) -> Dict[str, Any]:
        """
        Parse and validate Notes response.
        """

        notes = cls.parse_json(text)

        if not isinstance(
            notes,
            dict,
        ):
            raise ResponseFormatterError(
                "Invalid Notes format: expected an object."
            )

        if not cls.validate_notes(notes):
            raise ResponseFormatterError(
                "Invalid Notes format."
            )

        return notes

    # ========================================================
    # Normalize Quiz Wrapper
    # ========================================================

    @classmethod
    def _unwrap_quiz(
        cls,
        quiz: JSONValue,
    ) -> Any:
        """
        Normalize common quiz wrapper structures.
        """

        if not isinstance(
            quiz,
            dict,
        ):
            return quiz

        # Example:
        #
        # {
        #     "questions": [...]
        # }

        for key in cls.QUIZ_WRAPPER_KEYS:

            value = quiz.get(key)

            if isinstance(
                value,
                list,
            ):
                return value

        # Single quiz item returned as object.
        if (
            "question" in quiz
            and (
                "options" in quiz
                or "choices" in quiz
            )
        ):
            return [quiz]

        return quiz

    # ========================================================
    # Normalize Quiz Item
    # ========================================================

    @classmethod
    def _normalize_quiz_item(
        cls,
        item: Any,
    ) -> Any:
        """
        Normalize one quiz item.

        Handles:

        - prompt -> question
        - choices -> options
        - correct_answer -> answer
        - correctAnswer -> answer
        - numeric answer index
        - A/B/C/D answer
        """

        if not isinstance(
            item,
            dict,
        ):
            return item

        question = item.get(
            "question",
            item.get(
                "prompt",
                "",
            ),
        )

        options = item.get(
            "options"
        )

        if not isinstance(
            options,
            list,
        ):
            options = item.get(
                "choices"
            )

        if not isinstance(
            options,
            list,
        ):
            options = []

        answer = item.get(
            "answer"
        )

        if answer is None:

            answer = item.get(
                "correct_answer",
                item.get(
                    "correctAnswer"
                ),
            )

        # ----------------------------------------------------
        # Numeric answer index
        # ----------------------------------------------------

        if (
            isinstance(answer, int)
            and isinstance(options, list)
            and 0 <= answer < len(options)
        ):
            answer = options[answer]

        # ----------------------------------------------------
        # A/B/C/D answer
        # ----------------------------------------------------

        if (
            isinstance(answer, str)
            and len(answer.strip()) == 1
            and answer.strip().upper() in "ABCD"
        ):

            index = (
                ord(
                    answer.strip().upper()
                )
                - ord("A")
            )

            if (
                isinstance(options, list)
                and 0 <= index < len(options)
            ):
                answer = options[index]

        explanation = item.get(
            "explanation"
        )

        if explanation is None:
            explanation = ""

        normalized = {
            **item,
            "question": cls._safe_string(
                question
            ),
            "options": options,
            "answer": cls._safe_string(
                answer
            ),
            "explanation": cls._safe_string(
                explanation
            ),
        }

        return normalized

    # ========================================================
    # Parse Quiz
    # ========================================================

    @classmethod
    def parse_quiz(
        cls,
        text: str,
    ) -> List[Dict[str, Any]]:
        """
        Parse, normalize, and validate quiz response.
        """

        quiz = cls.parse_json(text)

        quiz = cls._unwrap_quiz(
            quiz
        )

        if not isinstance(
            quiz,
            list,
        ):
            raise ResponseFormatterError(
                "Invalid Quiz format: expected a list."
            )

        normalized = [
            cls._normalize_quiz_item(item)
            for item in quiz
        ]

        if not cls.validate_quiz(
            normalized
        ):
            raise ResponseFormatterError(
                "Invalid Quiz format."
            )

        return cast(
            List[Dict[str, Any]],
            normalized,
        )

    # ========================================================
    # Parse Flashcards
    # ========================================================

    @classmethod
    def parse_flashcards(
        cls,
        text: str,
    ) -> List[Dict[str, Any]]:
        """
        Parse and validate flashcards.
        """

        cards = cls.parse_json(text)

        if not isinstance(
            cards,
            list,
        ):
            raise ResponseFormatterError(
                "Invalid Flashcard format: expected a list."
            )

        if not cls.validate_flashcards(
            cards
        ):
            raise ResponseFormatterError(
                "Invalid Flashcard format."
            )

        return cast(
            List[Dict[str, Any]],
            cards,
        )

    # ========================================================
    # Normalize Q&A Wrapper
    # ========================================================

    @classmethod
    def _unwrap_qa(
        cls,
        data: JSONValue,
    ) -> Any:
        """
        Normalize common Q&A wrapper structures.
        """

        if not isinstance(
            data,
            dict,
        ):
            return data

        for key in cls.QA_WRAPPER_KEYS:

            value = data.get(key)

            if isinstance(
                value,
                list,
            ):
                return value

        return data

    # ========================================================
    # Normalize Q&A Item
    # ========================================================

    @classmethod
    def _deduplicate_key_points(
        cls,
        answer: Any,
        key_points: Any,
    ) -> List[str]:
        """Keep only short, non-repetitive points not already stated verbatim.

        The renderer places ``answer`` before ``key_points``. Returning a second
        copy of the same claim makes exam PDFs look padded, so this is a final
        defensive formatting boundary after the LLM response is parsed.
        """
        if not isinstance(key_points, list):
            return []
        answer_terms = set(re.findall(r"[a-z0-9]{3,}", cls._safe_string(answer).lower()))
        kept: List[str] = []
        seen = set()
        for raw_point in key_points:
            point = cls._safe_string(raw_point).strip()
            point_terms = set(re.findall(r"[a-z0-9]{3,}", point.lower()))
            normalized = " ".join(sorted(point_terms))
            if not point or not point_terms or normalized in seen:
                continue
            # A point composed almost entirely of answer terms is a duplicate,
            # not a useful exam takeaway.
            if len(point_terms) >= 4 and len(point_terms & answer_terms) / len(point_terms) >= 0.9:
                continue
            seen.add(normalized)
            kept.append(point)
        return kept

    @classmethod
    def _normalize_qa_item(
        cls,
        item: Any,
    ) -> Any:
        """
        Normalize one descriptive Q&A item.
        """

        if not isinstance(
            item,
            dict,
        ):
            return item

        question = item.get(
            "question",
            item.get(
                "prompt",
                "",
            ),
        )

        answer = item.get(
            "answer",
            item.get(
                "explanation",
                "",
            ),
        )

        key_points = item.get(
            "key_points"
        )

        if key_points is None:
            key_points = item.get(
                "keyPoints",
                [],
            )

        key_points = cls._deduplicate_key_points(answer, key_points)

        return {
            **item,
            "question": cls._safe_string(
                question
            ),
            "answer": cls._safe_string(
                answer
            ),
            "key_points": key_points,
        }

    # ========================================================
    # Parse Q&A
    # ========================================================

    @classmethod
    def parse_qa(
        cls,
        text: str,
    ) -> List[Dict[str, Any]]:
        """
        Parse, normalize, and validate descriptive Q&A.
        """

        data = cls.parse_json(text)

        data = cls._unwrap_qa(
            data
        )

        if not isinstance(
            data,
            list,
        ):
            raise ResponseFormatterError(
                "Invalid descriptive Q&A format: "
                "expected a list."
            )

        normalized = [
            cls._normalize_qa_item(item)
            for item in data
        ]

        if not cls.validate_qa(
            normalized
        ):
            raise ResponseFormatterError(
                "Invalid descriptive Q&A format."
            )

        return cast(
            List[Dict[str, Any]],
            normalized,
        )

    # ========================================================
    # Generic Parse + Validate Helper
    # ========================================================

    @classmethod
    def parse_and_validate(
        cls,
        text: str,
        validator: Any,
        response_name: str,
    ) -> JSONValue:
        """
        Generic parser/validator helper.

        Useful for future structured response types.
        """

        parsed = cls.parse_json(
            text
        )

        if not validator(parsed):
            raise ResponseFormatterError(
                f"Invalid {response_name} format."
            )

        return parsed

    # ========================================================
    # Safe Error Message
    # ========================================================

    @staticmethod
    def safe_error_message(
        error: Exception,
    ) -> str:
        """
        Convert an exception into a safe application message.
        """

        message = str(error).strip()

        if not message:
            return "Unknown response formatting error."

        # Avoid accidentally returning enormous exception text.
        if len(message) > 1000:
            message = message[:1000] + "..."

        return message

    # ========================================================
    # Representation
    # ========================================================

    def __repr__(self) -> str:
        return (
            "<ResponseFormatter "
            "status='ready'>"
        )
