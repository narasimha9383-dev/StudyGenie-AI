"""Shared input validation helpers for the Python AI engine."""

from __future__ import annotations

import math
from typing import Any


class ValidationError(ValueError):
    """Raised when an AI pipeline input cannot be safely processed."""


def require_text(
    value: Any,
    field: str = "text",
    max_length: int = 200_000,
) -> str:
    """Validate and normalize a required text value."""

    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{field} must be a non-empty string.")

    text = value.strip()

    if len(text) > max_length:
        raise ValidationError(
            f"{field} exceeds the maximum supported length."
        )

    return text


def require_positive_int(
    value: Any,
    field: str,
    maximum: int = 100,
) -> int:
    """Validate an integer in the range 1..maximum."""

    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(
            f"{field} must be a positive integer."
        )

    if value < 1 or value > maximum:
        raise ValidationError(
            f"{field} must be between 1 and {maximum}."
        )

    return value


def sanitize_metadata(metadata: Any) -> dict[str, Any]:
    """Keep only safe scalar metadata values for vector storage."""

    if metadata is None:
        return {}

    if not isinstance(metadata, dict):
        raise ValidationError("metadata must be an object.")

    result: dict[str, Any] = {}

    for key, value in metadata.items():
        if not isinstance(key, str) or len(key) > 100:
            continue

        if isinstance(value, bool):
            result[key] = value

        elif isinstance(value, int):
            result[key] = value

        elif isinstance(value, float) and math.isfinite(value):
            result[key] = value

        elif isinstance(value, str):
            result[key] = value

    return result