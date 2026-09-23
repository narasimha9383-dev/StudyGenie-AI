"""Safe PDF validation, extraction, and lightweight document analysis."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional,cast
import pymupdf as fitz


logger = logging.getLogger(__name__)


class PDFProcessorError(Exception):
    """Base exception for PDF processing failures."""


class InvalidPDFError(PDFProcessorError):
    """Raised when a supplied path is not a valid PDF file."""


class PDFLoadError(PDFProcessorError):
    """Raised when a valid PDF cannot be opened or authenticated."""


class PDFProcessor:
    """Process text, images, metadata, and basic layout information from PDFs."""

    SUPPORTED_EXTENSION = ".pdf"
    MAX_FILE_SIZE_BYTES = int(os.getenv("AI_MAX_PDF_BYTES", str(20 * 1024 * 1024)))

    def __init__(self) -> None:
        self.document: Optional[fitz.Document] = None
        self.file_path: Optional[str] = None

    def validate_pdf(self, file_path: str) -> bool:
        """Validate path, size, extension, and the PDF file signature."""
        if not file_path or not isinstance(file_path, (str, os.PathLike)):
            raise InvalidPDFError("PDF path is empty.")

        path = Path(file_path)
        if not path.exists():
            raise InvalidPDFError(f"PDF not found: {path}")
        if not path.is_file():
            raise InvalidPDFError("Provided PDF path is not a file.")
        if path.suffix.lower() != self.SUPPORTED_EXTENSION:
            raise InvalidPDFError("Only PDF files are supported.")

        file_size = path.stat().st_size
        if file_size == 0:
            raise InvalidPDFError("PDF file is empty.")
        if file_size > self.MAX_FILE_SIZE_BYTES:
            raise InvalidPDFError("PDF file exceeds the maximum supported size.")

        with path.open("rb") as file_handle:
            if file_handle.read(5) != b"%PDF-":
                raise InvalidPDFError("The uploaded file is not a valid PDF.")

        logger.info("Validated PDF %s (%.2f MB)", path.name, file_size / (1024 * 1024))
        return True

    def load_pdf(self, file_path: str) -> fitz.Document:
        """Validate and open a PDF, authenticating only with an empty password."""
        self.validate_pdf(file_path)
        try:
            self.document = fitz.open(str(file_path))
            self.file_path = str(file_path)
            if self.document.is_encrypted and not self.document.authenticate(""):
                self.close()
                raise PDFLoadError("Password-protected PDFs are not supported.")
            logger.info("Loaded PDF %s", file_path)
            return self.document
        except PDFLoadError:
            raise
        except Exception as error:
            self.close()
            logger.exception("Failed to load PDF %s", file_path)
            raise PDFLoadError(f"Unable to open PDF: {error}") from error

    def is_loaded(self) -> bool:
        """Return whether a document is currently open."""
        return self.document is not None

    def close(self) -> None:
        """Close the current document and clear its reference."""
        if self.document is not None:
            self.document.close()
            self.document = None
        self.file_path = None

    def extract_metadata(self) -> Dict[str, str]:
        """Return standard PDF metadata fields."""
        if self.document is None:
            raise PDFLoadError("PDF is not loaded.")
        metadata = self.document.metadata or {}
        return {
            "title": metadata.get("title", "") or "",
            "author": metadata.get("author", "") or "",
            "subject": metadata.get("subject", "") or "",
            "keywords": metadata.get("keywords", "") or "",
            "creator": metadata.get("creator", "") or "",
            "producer": metadata.get("producer", "") or "",
            "creation_date": metadata.get("creationDate", "") or "",
            "modified_date": metadata.get("modDate", "") or "",
        }

    def extract_document_info(self) -> Dict[str, Any]:
        """Return document information without relying on version-specific APIs."""
        if self.document is None or self.file_path is None:
            raise PDFLoadError("PDF is not loaded.")

        pdf_version = None
        version_reader = getattr(self.document, "pdf_version", None)
        if callable(version_reader):
            try:
                pdf_version = version_reader()
            except Exception:
                logger.debug("PDF version is unavailable", exc_info=True)

        return {
            "filename": Path(self.file_path).name,
            "filepath": self.file_path,
            "total_pages": len(self.document),
            "is_encrypted": bool(self.document.is_encrypted),
            "pdf_version": pdf_version,
        }

    def extract_page_text(self, page_number: int) -> Dict[str, Any]:
        """Extract text and counts for one zero-based page index."""
        if self.document is None:
            raise PDFLoadError("PDF is not loaded.")
        if not isinstance(page_number, int) or isinstance(page_number, bool):
            raise ValueError("Page number must be an integer.")
        if page_number < 0 or page_number >= len(self.document):
            raise ValueError(f"Invalid page number: {page_number}")

        page = self.document.load_page(page_number)
        text = cast(str, page.get_text("text"))
        blocks = page.get_text("blocks") or []
        image_count = len(page.get_images(full=True))
        return {
            "page": page_number + 1,
            "text": text,
            "raw_text": text,
            "cleaned_text": text.strip(),
            "characters": len(text),
            "words": len(text.split()),
            "blocks": len(blocks),
            "has_images": image_count > 0,
            "image_count": image_count,
            "has_diagrams": False,
        }

    def extract_all_pages(self) -> List[Dict[str, Any]]:
        """Extract every page by delegating to ``extract_page_text``."""
        if self.document is None:
            raise PDFLoadError("PDF is not loaded.")
        pages: List[Dict[str, Any]] = []
        for page_number in range(len(self.document)):
            pages.append(self.extract_page_text(page_number))
        return pages

    def extract_full_text(self) -> str:
        """Join all extracted page text in document order."""
        return "\n\n".join(page["text"] for page in self.extract_all_pages()).strip()

    def get_statistics(self) -> Dict[str, Any]:
        """Calculate aggregate page, character, and word statistics."""
        pages = self.extract_all_pages()
        page_count = len(pages)
        characters = sum(page["characters"] for page in pages)
        words = sum(page["words"] for page in pages)
        return {
            "pages": page_count,
            "characters": characters,
            "words": words,
            "average_words_per_page": round(words / max(page_count, 1), 2),
            "average_characters_per_page": round(characters / max(page_count, 1), 2),
        }

    def is_scanned_pdf(self) -> bool:
        """Detect image-only PDFs using at most the first three pages."""
        if self.document is None:
            raise PDFLoadError("PDF is not loaded.")
        sampled_pages = min(3, len(self.document))
        has_images = False
        extracted_words = 0
        for page_number in range(sampled_pages):
            page = self.document.load_page(page_number)
            text = cast(str, page.get_text("text"))
            extracted_words += len(text.split())
            has_images = has_images or bool(page.get_images(full=True))
        return extracted_words == 0 and has_images

    def extract_images(self) -> List[Dict[str, Any]]:
        """Return image metadata for every page."""
        if self.document is None:
            raise PDFLoadError("PDF is not loaded.")
        images: List[Dict[str, Any]] = []
        for page_number in range(len(self.document)):
            page = self.document.load_page(page_number)
            for image_number, image in enumerate(page.get_images(full=True), start=1):
                images.append({
                    "page": page_number + 1,
                    "image_number": image_number,
                    "xref": image[0],
                    "width": image[2],
                    "height": image[3],
                    "colorspace": image[5] if len(image) > 5 else None,
                })
        return images

    def detect_tables(self) -> List[int]:
        """Heuristically flag pages with many drawing objects.

        This is not table extraction; it only identifies pages that may contain
        table-like lines or boxes and should not be treated as structured data.
        """
        if self.document is None:
            raise PDFLoadError("PDF is not loaded.")
        table_pages: List[int] = []
        for page_number in range(len(self.document)):
            page = self.document.load_page(page_number)
            if len(page.get_drawings()) > 20:
                table_pages.append(page_number + 1)
        return table_pages

    def analyze_pages(self) -> List[Dict[str, Any]]:
        """Return text, block, and image counts for every page."""
        if self.document is None:
            raise PDFLoadError("PDF is not loaded.")
        analysis: List[Dict[str, Any]] = []
        for page_number in range(len(self.document)):
            page = self.document.load_page(page_number)
            text = cast(str, page.get_text("text"))
            analysis.append({
                "page": page_number + 1,
                "word_count": len(text.split()),
                "character_count": len(text),
                "has_text": bool(text.strip()),
                "image_count": len(page.get_images(full=True)),
                "block_count": len(page.get_text("blocks") or []),
            })
        return analysis

    def process_pdf(self, file_path: str) -> Dict[str, Any]:
        """Run the complete extraction pipeline and always close the PDF."""
        try:
            self.load_pdf(file_path)
            metadata = self.extract_metadata()
            document_info = self.extract_document_info()
            pages = self.extract_all_pages()
            full_text = "\n\n".join(page["text"] for page in pages).strip()
            page_count = len(pages)
            characters = sum(page["characters"] for page in pages)
            words = sum(page["words"] for page in pages)
            statistics = {
                "pages": page_count,
                "characters": characters,
                "words": words,
                "average_words_per_page": round(words / max(page_count, 1), 2),
                "average_characters_per_page": round(characters / max(page_count, 1), 2),
            }
            images = self.extract_images()
            tables = self.detect_tables()
            analysis = self.analyze_pages()
            scanned = self.is_scanned_pdf()

            if not full_text or scanned:
                return {
                    "success": False,
                    "error": "Unable to extract readable text from the uploaded PDF.",
                    "error_code": "PDF_TEXT_NOT_FOUND",
                }

            return {
                "success": True,
                "document": {
                    "metadata": metadata,
                    "document_info": document_info,
                    "statistics": statistics,
                    "pages": pages,
                    "full_text": full_text,
                    "images": images,
                    "table_pages": tables,
                    "page_analysis": analysis,
                    "is_scanned": scanned,
                },
            }
        except InvalidPDFError as error:
            logger.warning("PDF validation failed: %s", error)
            return {"success": False, "error": str(error), "error_code": "INVALID_PDF"}
        except PDFLoadError as error:
            logger.warning("PDF loading failed: %s", error)
            return {"success": False, "error": str(error), "error_code": "PDF_LOAD_ERROR"}
        except Exception as error:
            logger.exception("PDF processing failed")
            return {
                "success": False,
                "error": "PDF preprocessing failed. Verify that the file is readable and try again.",
                "error_code": type(error).__name__.upper(),
            }
        finally:
            self.close()
