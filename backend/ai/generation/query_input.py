"""
StudyGenie AI - Query Input

Handles user questions supplied as:
- Text
- PDF
- Image

Important:
Query input is NEVER indexed or stored in the vector database.
It is only converted into question text.

Study-material ingestion belongs to ai.ingestion.
"""

from __future__ import annotations

import base64
import mimetypes
import re
from pathlib import Path
from typing import Any, Dict, Optional

from ai.core.logger import get_logger


logger = get_logger("StudyGenie.AI.query_input")

MAX_QUERY_CHARS = 2000


class QueryInputError(Exception):
    """Raised when query input cannot be converted into usable text."""


def normalize_query(text: str) -> str:
    """Clean and validate query text."""

    if not isinstance(text, str):
        raise QueryInputError("Query text must be text.")

    text = re.sub(r"\s+", " ", text).strip()

    if not text:
        raise QueryInputError("Query text is empty.")

    return text[:MAX_QUERY_CHARS].rstrip()


def extract_query_from_pdf(path: str) -> str:
    """
    Extract question text from a PDF.

    The PDF is read only.
    It is NOT indexed or stored in the vector database.
    """

    from ai.ingestion.pdf_processor import (
        PDFProcessor,
        PDFProcessorError,
    )

    processor = PDFProcessor()

    try:
        processor.load_pdf(path)
        text = processor.extract_full_text()

    except PDFProcessorError as error:
        raise QueryInputError(str(error)) from error

    finally:
        processor.close()

    if not text or not text.strip():
        raise QueryInputError(
            "The question PDF has no extractable text "
            "(it may be scanned)."
        )

    logger.info(
        "[RAG] query source=pdf extracted_chars=%d",
        len(text),
    )

    return normalize_query(text)


def extract_query_from_image(
    path: str,
    llm_service: Optional[Any] = None,
) -> str:
    """
    Extract question text from an image using the configured vision-capable LLM.

    No OCR dependency is required.
    """

    file_path = Path(path)

    if not file_path.is_file():
        raise QueryInputError("Image file not found.")

    data = file_path.read_bytes()

    if not data:
        raise QueryInputError("Image file is empty.")

    mime_type = (
        mimetypes.guess_type(str(file_path))[0]
        or "image/png"
    )

    data_uri = (
        f"data:{mime_type};base64,"
        f"{base64.b64encode(data).decode('ascii')}"
    )

    if llm_service is None:
        from ai.generation.llm_service import LLMService

        llm_service = LLMService()

    from ai.generation.llm_service import LLMGenerationError

    instruction = """
Transcribe ONLY the question(s) visible in this image.

Rules:
- Return plain text only.
- Do not answer the question.
- Do not add commentary.
- Do not invent unreadable text.
- If no readable question exists, return exactly:
NO_TEXT
""".strip()

    try:
        raw = llm_service.generate(
            instruction,
            images=[data_uri],
            temperature=0.0,
        )

    except LLMGenerationError as error:
        logger.warning(
            "[RAG] query image extraction unavailable provider=%s",
            getattr(llm_service, "provider", "unknown"),
        )

        raise QueryInputError(
            "This image could not be read by the current AI model. "
            "Please type your question as text instead."
        ) from error

    text = (raw or "").strip()

    if not text or text.upper() == "NO_TEXT":
        raise QueryInputError(
            "No readable question text was found in the image."
        )

    logger.info(
        "[RAG] query source=image extracted_chars=%d",
        len(text),
    )

    return normalize_query(text)


def resolve_query(
    payload: Dict[str, Any],
    llm_service: Optional[Any] = None,
) -> str:
    """
    Convert a query payload into normalized question text.

    Supported types:

        {
            "type": "text",
            "text": "What is RAG?"
        }

        {
            "type": "pdf",
            "path": "/path/question.pdf"
        }

        {
            "type": "image",
            "path": "/path/question.png"
        }
    """

    if not isinstance(payload, dict):
        raise QueryInputError("Query payload must be an object.")

    query_type = (
        str(payload.get("type") or "text")
        .strip()
        .lower()
    )

    if query_type == "text":
        return normalize_query(
            str(payload.get("text") or "")
        )

    path = str(
        payload.get("path") or ""
    ).strip()

    if not path:
        raise QueryInputError(
            "A file path is required for pdf/image queries."
        )

    if query_type == "pdf":
        return extract_query_from_pdf(path)

    if query_type == "image":
        return extract_query_from_image(
            path,
            llm_service=llm_service,
        )

    raise QueryInputError(
        f"Unsupported query type: {query_type}"
    )