"""
StudyGenie AI
Text Cleaner Service

Purpose:
    Conservative text preprocessing for RAG pipelines.

Design principles:
    - Preserve document meaning.
    - Preserve headings, lists, numbers, tables, and formulas.
    - Remove only high-confidence extraction/OCR noise.
    - Avoid aggressive transformations that can hurt retrieval accuracy.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any, Dict


logger = logging.getLogger(__name__)


class TextCleanerError(Exception):
    """Raised when text cleaning fails."""


class TextCleaner:
    """
    Conservative text cleaner for StudyGenie AI RAG.

    The cleaner intentionally avoids:
        - Blind page-number removal
        - Blind header/footer removal
        - Aggressive paragraph reconstruction
        - Destructive symbol removal
    """

    # ------------------------------------------------------------------
    # Regular expressions
    # ------------------------------------------------------------------

    _MULTIPLE_SPACES = re.compile(r"[ \t]+")
    _MULTIPLE_BLANK_LINES = re.compile(r"\n{3,}")
    _SPACE_BEFORE_PUNCTUATION = re.compile(r"[ \t]+([,.;:!?])")
    _SPACE_AFTER_SENTENCE = re.compile(r"([.!?])(?=[A-Za-z])")

    # Only lines consisting entirely of visual separators.
    _SEPARATOR_LINE = re.compile(r"^[=_*]{5,}$")

    # ------------------------------------------------------------------
    # Safe OCR replacements
    # ------------------------------------------------------------------

    _OCR_REPLACEMENTS = {
        "\ufeff": "",
        "\u200b": "",
        "\u200c": "",
        "\u200d": "",
        "\u00a0": " ",
        "ﬁ": "fi",
        "ﬂ": "fl",
        "ﬀ": "ff",
        "ﬃ": "ffi",
        "ﬄ": "ffl",
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
        "…": "...",
        "−": "-",
        "–": "-",
        "—": "-",
    }

    def __init__(self) -> None:
        self.original_length = 0
        self.cleaned_length = 0

    # ==================================================================
    # BASIC CLEANING
    # ==================================================================

    def normalize_unicode(self, text: str) -> str:
        """
        Normalize Unicode compatibility representations.

        Important:
            NFKC does NOT convert "Café" into "Cafe".
            It normalizes compatible Unicode forms while preserving
            the meaning of the text.
        """

        if not text:
            return ""

        return unicodedata.normalize("NFKC", text)

    def remove_null_bytes(self, text: str) -> str:
        """Remove null bytes commonly found in extracted PDF text."""

        return text.replace("\x00", "")

    def normalize_line_endings(self, text: str) -> str:
        """Convert Windows/Mac line endings to Unix-style line endings."""

        return text.replace("\r\n", "\n").replace("\r", "\n")

    def remove_control_characters(self, text: str) -> str:
        """
        Remove unwanted Unicode control characters.

        Newlines and tabs are preserved because they carry document
        structure.
        """

        cleaned = []

        for char in text:
            if char in {"\n", "\t"}:
                cleaned.append(char)
                continue

            category = unicodedata.category(char)

            if category == "Cc":
                continue

            cleaned.append(char)

        return "".join(cleaned)

    def normalize_whitespace(self, text: str) -> str:
        """
        Normalize spaces while preserving paragraph boundaries.
        """

        text = self._MULTIPLE_SPACES.sub(" ", text)

        lines = [
            line.strip()
            for line in text.splitlines()
        ]

        text = "\n".join(lines)

        text = self._MULTIPLE_BLANK_LINES.sub(
            "\n\n",
            text,
        )

        return text.strip()

    # ==================================================================
    # OCR CLEANING
    # ==================================================================

    def fix_ocr_errors(self, text: str) -> str:
        """
        Apply only safe, common OCR substitutions.
        """

        for wrong, correct in self._OCR_REPLACEMENTS.items():
            text = text.replace(wrong, correct)

        return text

    # ==================================================================
    # STRUCTURAL CLEANING
    # ==================================================================

    def normalize_hyphenated_line_breaks(self, text: str) -> str:
        """
        Join words split across a line break.

        Example:
            Machine-
            Learning

        becomes:
            Machine Learning

        Only alphabetic word boundaries are changed.
        """

        return re.sub(
            r"([A-Za-z])-\n([a-z])",
            r"\1 \2",
            text,
        )

    def remove_separator_lines(self, text: str) -> str:
        """
        Remove lines made only from long visual separators.

        Example:
            ==========
            **********
            _________

        Normal symbols inside actual content are preserved.
        """

        lines = []

        for line in text.splitlines():
            stripped = line.strip()

            if stripped and self._SEPARATOR_LINE.fullmatch(stripped):
                continue

            lines.append(line)

        return "\n".join(lines)

    def remove_consecutive_duplicate_lines(self, text: str) -> str:
        """
        Remove immediately repeated identical lines.

        Only consecutive duplicates are removed.
        """

        lines = []
        previous = None

        for line in text.splitlines():
            normalized = line.strip()

            if normalized and normalized == previous:
                continue

            lines.append(line)

            if normalized:
                previous = normalized

        return "\n".join(lines)

    # ==================================================================
    # PUNCTUATION
    # ==================================================================

    def normalize_punctuation(self, text: str) -> str:
        """Fix obvious punctuation spacing problems."""

        text = self._SPACE_BEFORE_PUNCTUATION.sub(
            r"\1",
            text,
        )

        text = self._SPACE_AFTER_SENTENCE.sub(
            r"\1 ",
            text,
        )

        text = re.sub(
            r"\(\s+",
            "(",
            text,
        )

        text = re.sub(
            r"\s+\)",
            ")",
            text,
        )

        return text

    # ==================================================================
    # VALIDATION
    # ==================================================================

    def validate_cleaned_text(self, text: str) -> bool:
        """
        Verify that useful text remains after cleaning.
        """

        if not isinstance(text, str):
            return False

        if not text.strip():
            return False

        if len(text.strip()) < 10:
            return False

        return True

    # ==================================================================
    # STATISTICS
    # ==================================================================

    def calculate_statistics(
        self,
        original: str,
        cleaned: str,
    ) -> Dict[str, Any]:
        """Calculate before/after cleaning statistics."""

        original_words = len(original.split())
        cleaned_words = len(cleaned.split())

        original_lines = len(original.splitlines())
        cleaned_lines = len(cleaned.splitlines())

        original_chars = len(original)
        cleaned_chars = len(cleaned)

        return {
            "original": {
                "characters": original_chars,
                "words": original_words,
                "lines": original_lines,
            },
            "cleaned": {
                "characters": cleaned_chars,
                "words": cleaned_words,
                "lines": cleaned_lines,
            },
            "removed": {
                "characters": max(
                    original_chars - cleaned_chars,
                    0,
                ),
                "words": max(
                    original_words - cleaned_words,
                    0,
                ),
                "lines": max(
                    original_lines - cleaned_lines,
                    0,
                ),
            },
            "compression_ratio": round(
                (cleaned_chars / max(original_chars, 1)) * 100,
                2,
            ),
        }

    # ==================================================================
    # PIPELINE
    # ==================================================================

    def clean_document(
        self,
        text: str,
    ) -> Dict[str, Any]:
        """
        Execute the complete conservative cleaning pipeline.

        Pipeline:
            1. Unicode normalization
            2. Null-byte removal
            3. Line-ending normalization
            4. Control-character removal
            5. OCR correction
            6. Hyphenated line-break repair
            7. Separator removal
            8. Consecutive duplicate removal
            9. Whitespace normalization
            10. Punctuation normalization
            11. Validation
            12. Statistics
        """

        logger.info(
            "Starting StudyGenie AI text cleaning."
        )

        if not isinstance(text, str):
            return {
                "success": False,
                "cleaned_text": "",
                "statistics": {},
                "error": "Input text must be a string.",
            }

        if not text.strip():
            return {
                "success": False,
                "cleaned_text": "",
                "statistics": {},
                "error": "Input text is empty.",
            }

        original_text = text
        self.original_length = len(original_text)

        try:
            # ----------------------------------------------------------
            # 1. Unicode
            # ----------------------------------------------------------

            text = self.normalize_unicode(text)

            # ----------------------------------------------------------
            # 2. PDF extraction artifacts
            # ----------------------------------------------------------

            text = self.remove_null_bytes(text)

            text = self.normalize_line_endings(text)

            text = self.remove_control_characters(text)

            # ----------------------------------------------------------
            # 3. OCR corrections
            # ----------------------------------------------------------

            text = self.fix_ocr_errors(text)

            # ----------------------------------------------------------
            # 4. Safe structural cleanup
            # ----------------------------------------------------------

            text = self.normalize_hyphenated_line_breaks(text)

            text = self.remove_separator_lines(text)

            text = self.remove_consecutive_duplicate_lines(text)

            # ----------------------------------------------------------
            # 5. Whitespace
            # ----------------------------------------------------------

            text = self.normalize_whitespace(text)

            # ----------------------------------------------------------
            # 6. Punctuation
            # ----------------------------------------------------------

            text = self.normalize_punctuation(text)

            # Final whitespace normalization.
            text = self.normalize_whitespace(text)

            # ----------------------------------------------------------
            # 7. Validation
            # ----------------------------------------------------------

            if not self.validate_cleaned_text(text):
                raise TextCleanerError(
                    "Cleaned text contains insufficient usable content."
                )

            # ----------------------------------------------------------
            # 8. Statistics
            # ----------------------------------------------------------

            self.cleaned_length = len(text)

            statistics = self.calculate_statistics(
                original_text,
                text,
            )

            logger.info(
                "Text cleaning completed: %d -> %d characters.",
                self.original_length,
                self.cleaned_length,
            )

            return {
                "success": True,
                "cleaned_text": text,
                "statistics": statistics,
                "error": None,
            }

        except TextCleanerError as exc:
            logger.error(
                "Text cleaning validation failed: %s",
                exc,
            )

            return {
                "success": False,
                "cleaned_text": "",
                "statistics": {},
                "error": str(exc),
            }

        except Exception as exc:
            logger.exception(
                "Unexpected text cleaning failure."
            )

            return {
                "success": False,
                "cleaned_text": "",
                "statistics": {},
                "error": str(exc),
            }

    # ==================================================================
    # CALLABLE INTERFACE
    # ==================================================================

    def __call__(
        self,
        text: str,
    ) -> Dict[str, Any]:
        """Allow cleaner(text) syntax."""

        return self.clean_document(text)


# ======================================================================
# Shared service instance
# ======================================================================

text_cleaner = TextCleaner()