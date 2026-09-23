"""
Embedded-raster figure extraction for uploaded PDF study material.

This module extracts actual raster images embedded in PDFs and stores them as
PNG files together with metadata that can later be consumed by the question
generation / study-PDF pipeline.

Design principles
-----------------

1. Embedded rasters are authoritative figure candidates.
2. Vector drawings are deliberately NOT reconstructed.
3. Cheap rejection happens before image decoding whenever possible.
4. A document is identified by its complete SHA-256 hash.
5. Extracted files are cached and validated through a manifest.
6. Cache validity includes:
       - document identity
       - manifest schema version
       - extractor version
       - extraction configuration
7. Files are written atomically.
8. Multiple threads may safely request extraction for the same document.
9. Caption detection is conservative and never invents a caption.
10. PyMuPDF is the only image-processing dependency.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sys
import tempfile
import threading
import time
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import pymupdf as fitz

from ai.ingestion.pdf_processor import (
    InvalidPDFError,
    PDFLoadError,
    PDFProcessor,
)


logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# Cache / schema versions
# ---------------------------------------------------------------------------

_MANIFEST_NAME = "figures.json"

_MANIFEST_VERSION = 3

_EXTRACTOR_VERSION = "3"


# ---------------------------------------------------------------------------
# Caption patterns
# ---------------------------------------------------------------------------

_CAPTION_PREFIX = re.compile(
    r"^\s*(fig(?:ure)?|table|diagram|chart|image|exhibit|graph|plot)"
    r"\b\s*(?:[.:)\]\-–—]|\d)",
    re.IGNORECASE,
)

_SECTION_HEADING = re.compile(
    r"^\s*(\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])[.)]\s+\S",
    re.IGNORECASE,
)

_PRIVATE_USE = re.compile(
    r"[\uE000-\uF8FF\uFFFD]"
)


# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------


def _env_int(
    name: str,
    default: int,
    minimum: int = 0,
) -> int:
    """Read an integer environment variable safely."""
    try:
        return max(
            minimum,
            int(os.getenv(name, str(default))),
        )
    except (TypeError, ValueError):
        return default


def _env_float(
    name: str,
    default: float,
    minimum: float = 0.0,
) -> float:
    """Read a float environment variable safely."""
    try:
        return max(
            minimum,
            float(os.getenv(name, str(default))),
        )
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class FigureExtractionError(Exception):
    """Raised when figure extraction cannot proceed for a document."""


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


BBox = Tuple[float, float, float, float]


@dataclass(frozen=True)
class DiscoveredRaster:
    """
    Immutable description of one stored PDF raster.

    A PDF can place the same xref on several pages. Therefore ``pages`` contains
    every page where this stored raster occurs.
    """

    xref: int
    page_number: int
    pages: Tuple[int, ...]
    source_width: int
    source_height: int


@dataclass(frozen=True)
class CaptionResult:
    """Result returned by the caption detector."""

    caption: Optional[str]
    caption_source: str
    nearby_text: Optional[str]


@dataclass(frozen=True)
class ExtractedFigure:
    """
    One embedded raster figure that exists as a real PNG file.
    """

    figure_id: str

    pdf_id: Optional[str]

    document_key: str
    source_path: str
    source_name: str

    page_number: int
    pages: Tuple[int, ...]

    xref: int

    image_path: str

    width: int
    height: int

    source_width: int
    source_height: int

    byte_size: int

    figure_kind: str

    caption: Optional[str]
    caption_source: str
    nearby_text: Optional[str]

    checksum: str

    bbox: Optional[BBox] = None

    file_checksum: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize this figure to a JSON-compatible dictionary."""
        data = asdict(self)

        data["pages"] = list(self.pages)

        if self.bbox is not None:
            data["bbox"] = list(self.bbox)

        return data

    @classmethod
    def from_dict(
        cls,
        data: Dict[str, Any],
    ) -> "ExtractedFigure":
        """Deserialize a manifest entry."""
        payload = dict(data)

        payload["pages"] = tuple(
            int(page)
            for page in payload.get("pages") or ()
        )

        bbox = payload.get("bbox")

        if bbox is not None:
            try:
                payload["bbox"] = tuple(
                    float(value)
                    for value in bbox
                )
            except (TypeError, ValueError):
                payload["bbox"] = None

        payload.setdefault("bbox", None)
        payload.setdefault("file_checksum", None)

        return cls(**payload)

    @property
    def display_caption(self) -> str:
        """
        Return a safe caption for student-facing output.

        No caption is invented from nearby prose.
        """
        return self.caption or (
            f"Figure from page {self.page_number}"
        )


@dataclass(frozen=True)
class FigureExtractionResult:
    """Structured summary of one extraction run."""

    document_key: str
    source_name: str

    figures: Tuple[ExtractedFigure, ...]

    discovered: int
    placements: int
    accepted: int

    duplicates_merged: int
    rejected: int
    capped: int

    cache_hit: bool

    elapsed_ms: int

    @property
    def diagrams(self) -> int:
        """Number of accepted figures classified as diagrams."""
        return sum(
            1
            for figure in self.figures
            if figure.figure_kind == "diagram"
        )

    @property
    def captioned(self) -> int:
        """Number of accepted figures with explicit captions."""
        return sum(
            1
            for figure in self.figures
            if figure.caption
        )


# ---------------------------------------------------------------------------
# Main extractor
# ---------------------------------------------------------------------------


class FigureExtractor:
    """
    Extract embedded raster figures from a PDF.

    One instance can safely be shared between threads.
    """

    def __init__(
        self,
        cache_root: Optional[os.PathLike | str] = None,
        *,
        min_width: Optional[int] = None,
        min_height: Optional[int] = None,
        min_area: Optional[int] = None,
        min_bytes: Optional[int] = None,
        max_aspect: Optional[float] = None,
        max_pixels: Optional[int] = None,
        diagram_min_side: Optional[int] = None,
        diagram_min_area: Optional[int] = None,
        caption_gap_pt: Optional[float] = None,
        max_figures_per_document: Optional[int] = None,
        hash_chunk_size: Optional[int] = None,
    ) -> None:

        default_root = os.getenv(
            "FIGURE_CACHE_DIR"
        ) or str(
            BACKEND_ROOT
            / "uploads"
            / "figures"
        )

        self.cache_root = Path(
            cache_root or default_root
        ).resolve()

        # ---------------------------------------------------------------
        # Cheap filters
        # ---------------------------------------------------------------

        self.min_width = (
            min_width
            if min_width is not None
            else _env_int(
                "FIGURE_MIN_WIDTH",
                80,
                1,
            )
        )

        self.min_height = (
            min_height
            if min_height is not None
            else _env_int(
                "FIGURE_MIN_HEIGHT",
                24,
                1,
            )
        )

        self.min_area = (
            min_area
            if min_area is not None
            else _env_int(
                "FIGURE_MIN_AREA",
                8_000,
                1,
            )
        )

        self.min_bytes = (
            min_bytes
            if min_bytes is not None
            else _env_int(
                "FIGURE_MIN_BYTES",
                1_500,
                1,
            )
        )

        self.max_aspect = (
            max_aspect
            if max_aspect is not None
            else _env_float(
                "FIGURE_MAX_ASPECT",
                50.0,
                1.0,
            )
        )

        self.max_pixels = (
            max_pixels
            if max_pixels is not None
            else _env_int(
                "FIGURE_MAX_PIXELS",
                4_000_000,
                10_000,
            )
        )

        self.diagram_min_side = (
            diagram_min_side
            if diagram_min_side is not None
            else _env_int(
                "FIGURE_DIAGRAM_MIN_SIDE",
                120,
                1,
            )
        )

        self.diagram_min_area = (
            diagram_min_area
            if diagram_min_area is not None
            else _env_int(
                "FIGURE_DIAGRAM_MIN_AREA",
                40_000,
                1,
            )
        )

        self.caption_gap_pt = (
            caption_gap_pt
            if caption_gap_pt is not None
            else _env_float(
                "FIGURE_CAPTION_GAP_PT",
                44.0,
                1.0,
            )
        )

        self.max_figures_per_document = (
            max_figures_per_document
            if max_figures_per_document is not None
            else _env_int(
                "FIGURE_MAX_PER_DOC",
                80,
                1,
            )
        )

        self.hash_chunk_size = (
            hash_chunk_size
            if hash_chunk_size is not None
            else _env_int(
                "FIGURE_HASH_CHUNK_SIZE",
                1024 * 1024,
                4_096,
            )
        )

        self._lock_registry: Dict[
            str,
            threading.RLock,
        ] = {}

        self._lock_registry_guard = threading.Lock()

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------

    @staticmethod
    def _log(message: str) -> None:
        """Emit a PII-safe image trace line."""
        print(
            f"[IMAGE] {message}",
            file=sys.stderr,
            flush=True,
        )

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def _configuration_payload(self) -> Dict[str, Any]:
        """Return configuration affecting extraction output."""
        return {
            "min_width": self.min_width,
            "min_height": self.min_height,
            "min_area": self.min_area,
            "min_bytes": self.min_bytes,
            "max_aspect": self.max_aspect,
            "max_pixels": self.max_pixels,
            "diagram_min_side": self.diagram_min_side,
            "diagram_min_area": self.diagram_min_area,
            "caption_gap_pt": self.caption_gap_pt,
            "max_figures_per_document": (
                self.max_figures_per_document
            ),
        }

    def _configuration_hash(self) -> str:
        """Return a stable hash of the extraction configuration."""
        encoded = json.dumps(
            self._configuration_payload(),
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")

        return hashlib.sha256(
            encoded
        ).hexdigest()[:16]

    # ------------------------------------------------------------------
    # Document identity
    # ------------------------------------------------------------------

    def document_key(
        self,
        file_path: os.PathLike | str,
    ) -> str:
        """
        Return a stable SHA-256 document identity.

        The entire PDF is hashed in bounded chunks.
        """
        path = Path(file_path)

        try:
            stat = path.stat()
        except OSError as error:
            raise FigureExtractionError(
                f"Could not stat PDF: {path}"
            ) from error

        if not path.is_file():
            raise FigureExtractionError(
                f"PDF path is not a file: {path}"
            )

        digest = hashlib.sha256()

        try:
            with path.open("rb") as handle:
                while True:
                    chunk = handle.read(
                        self.hash_chunk_size
                    )

                    if not chunk:
                        break

                    digest.update(chunk)

        except OSError as error:
            raise FigureExtractionError(
                f"Could not read PDF: {path}"
            ) from error

        digest.update(
            b"|size="
            + str(stat.st_size).encode("ascii")
        )

        return digest.hexdigest()[:32]

    @staticmethod
    def _safe_key(
        value: Optional[str],
    ) -> str:
        """Reduce a caller-controlled identifier to one safe path segment."""
        cleaned = re.sub(
            r"[^A-Za-z0-9_-]",
            "",
            str(value or ""),
        )

        return cleaned[:64]

    def cache_dir_for(
        self,
        document_key: str,
        pdf_id: Optional[str] = None,
    ) -> Path:
        """Return the per-document cache directory."""
        identity = (
            self._safe_key(pdf_id)
            or "anonymous"
        )

        document_segment = self._safe_key(
            document_key
        )

        if not document_segment:
            raise FigureExtractionError(
                "Could not derive a safe document cache key."
            )

        candidate = (
            self.cache_root
            / identity
            / document_segment
        ).resolve()

        root = self.cache_root.resolve()

        if (
            candidate != root
            and root not in candidate.parents
        ):
            raise FigureExtractionError(
                "Refusing to write outside the figure cache root."
            )

        return candidate

    # ------------------------------------------------------------------
    # Locks
    # ------------------------------------------------------------------

    def _lock_for(
        self,
        cache_dir: Path,
    ) -> threading.RLock:
        """Return a stable process-local lock."""
        key = str(cache_dir)

        with self._lock_registry_guard:
            lock = self._lock_registry.get(key)

            if lock is None:
                lock = threading.RLock()
                self._lock_registry[key] = lock

            return lock

    # ------------------------------------------------------------------
    # Manifest
    # ------------------------------------------------------------------

    @staticmethod
    def _manifest_path(
        cache_dir: Path,
    ) -> Path:
        return cache_dir / _MANIFEST_NAME

    def _read_manifest(
        self,
        cache_dir: Path,
        document_key: str,
        pdf_id: Optional[str],
    ) -> Optional[List[ExtractedFigure]]:
        """Read and validate the cached manifest."""

        manifest_path = self._manifest_path(
            cache_dir
        )

        if not manifest_path.is_file():
            return None

        try:
            payload = json.loads(
                manifest_path.read_text(
                    encoding="utf-8"
                )
            )
        except Exception:
            logger.debug(
                "Unreadable figure manifest; re-extracting.",
                exc_info=True,
            )
            return None

        if not isinstance(payload, dict):
            return None

        if payload.get("version") != _MANIFEST_VERSION:
            return None

        if payload.get(
            "extractor_version"
        ) != _EXTRACTOR_VERSION:
            return None

        if payload.get(
            "document_key"
        ) != document_key:
            return None

        expected_pdf_id = (
            str(pdf_id)
            if pdf_id is not None
            else None
        )

        if payload.get(
            "pdf_id"
        ) != expected_pdf_id:
            return None

        if payload.get(
            "configuration_hash"
        ) != self._configuration_hash():
            return None

        raw_figures = payload.get(
            "figures"
        )

        if not isinstance(
            raw_figures,
            list,
        ):
            return None

        figures: List[
            ExtractedFigure
        ] = []

        for entry in raw_figures:
            if not isinstance(
                entry,
                dict,
            ):
                return None

            try:
                figure = ExtractedFigure.from_dict(
                    entry
                )
            except Exception:
                logger.debug(
                    "Invalid figure entry in manifest.",
                    exc_info=True,
                )
                return None

            image_path = Path(
                figure.image_path
            )

            try:
                resolved_image = (
                    image_path.resolve()
                )

                resolved_cache = (
                    cache_dir.resolve()
                )

                if (
                    resolved_image
                    != resolved_cache
                    and resolved_cache
                    not in resolved_image.parents
                ):
                    return None

            except OSError:
                return None

            if not image_path.is_file():
                return None

            try:
                actual_size = image_path.stat().st_size
            except OSError:
                return None

            if actual_size <= 0:
                return None

            if (
                figure.byte_size > 0
                and actual_size
                != figure.byte_size
            ):
                return None

            if figure.file_checksum:
                try:
                    actual_checksum = (
                        self._file_sha256(
                            image_path,
                            truncate=64,
                        )
                    )
                except OSError:
                    return None

                if (
                    actual_checksum
                    != figure.file_checksum
                ):
                    return None

            figures.append(figure)

        return figures

    def _write_manifest(
        self,
        cache_dir: Path,
        document_key: str,
        pdf_id: Optional[str],
        source_name: str,
        figures: Sequence[ExtractedFigure],
    ) -> None:
        """Atomically write the extraction manifest."""

        payload = {
            "version": _MANIFEST_VERSION,
            "extractor_version": _EXTRACTOR_VERSION,
            "configuration_hash": (
                self._configuration_hash()
            ),
            "document_key": document_key,
            "pdf_id": (
                str(pdf_id)
                if pdf_id is not None
                else None
            ),
            "source_name": source_name,
            "created_at": time.time(),
            "figures": [
                figure.to_dict()
                for figure in figures
            ],
        }

        target = self._manifest_path(
            cache_dir
        )

        self._atomic_write_text(
            target,
            json.dumps(
                payload,
                indent=2,
                ensure_ascii=False,
            ),
        )

    # ------------------------------------------------------------------
    # File helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _file_sha256(
        path: Path,
        *,
        truncate: Optional[int] = None,
        chunk_size: int = 1024 * 1024,
    ) -> str:
        """Calculate SHA-256 without loading the entire file."""

        digest = hashlib.sha256()

        with path.open("rb") as handle:
            while True:
                chunk = handle.read(
                    chunk_size
                )

                if not chunk:
                    break

                digest.update(chunk)

        result = digest.hexdigest()

        if truncate:
            return result[:truncate]

        return result

    @staticmethod
    def _atomic_write_text(
        target: Path,
        content: str,
    ) -> None:
        """Atomically replace a text file."""

        target.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        temporary: Optional[Path] = None

        try:
            fd, temporary_name = tempfile.mkstemp(
                prefix=f".{target.name}.",
                suffix=".tmp",
                dir=str(target.parent),
                text=True,
            )

            temporary = Path(
                temporary_name
            )

            with os.fdopen(
                fd,
                "w",
                encoding="utf-8",
            ) as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())

            os.replace(
                temporary,
                target,
            )

            temporary = None

        finally:
            if temporary is not None:
                try:
                    temporary.unlink(
                        missing_ok=True
                    )
                except OSError:
                    pass

    @staticmethod
    def _atomic_save_png(
        pixmap: "fitz.Pixmap",
        target: Path,
    ) -> None:
        """Atomically save a PyMuPDF pixmap as PNG."""

        target.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        temporary: Optional[Path] = None

        try:
            fd, temporary_name = tempfile.mkstemp(
                prefix=f".{target.stem}.",
                suffix=".png.tmp",
                dir=str(target.parent),
            )

            os.close(fd)

            temporary = Path(
                temporary_name
            )

            pixmap.save(
                str(temporary),
                output="png",
            )

            os.replace(
                temporary,
                target,
            )

            temporary = None

        finally:
            if temporary is not None:
                try:
                    temporary.unlink(
                        missing_ok=True
                    )
                except OSError:
                    pass

    # ------------------------------------------------------------------
    # PyMuPDF helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _to_rgb(
        pixmap: "fitz.Pixmap",
    ) -> "fitz.Pixmap":
        """
        Return an alpha-free RGB pixmap.
        """

        needs_convert = bool(
            pixmap.alpha
        )

        colorspace = pixmap.colorspace

        if colorspace is None:
            needs_convert = True
        elif colorspace.n > 3:
            needs_convert = True

        if not needs_convert:
            return pixmap

        return fitz.Pixmap(
            fitz.csRGB,
            pixmap,
        )

    def _downscale(
        self,
        pixmap: "fitz.Pixmap",
    ) -> "fitz.Pixmap":
        """
        Reduce large images by powers of two.
        """

        width = pixmap.width
        height = pixmap.height

        factor = 0

        while (
            width * height
            > self.max_pixels
            and factor < 8
        ):
            factor += 1
            width = max(
                1,
                width // 2,
            )
            height = max(
                1,
                height // 2,
            )

        if factor:
            pixmap.shrink(
                factor
            )

        return pixmap

    @staticmethod
    def _is_uniform(
        pixmap: "fitz.Pixmap",
    ) -> bool:
        """Detect a single-colour raster."""

        data = pixmap.samples

        if not data:
            return True

        step = max(
            1,
            len(data) // 4096,
        )

        first = data[0]

        for index in range(
            0,
            len(data),
            step,
        ):
            if data[index] != first:
                return False

        return True

    def _classify(
        self,
        width: int,
        height: int,
    ) -> str:
        """Classify raster size for ranking only."""

        if (
            min(width, height)
            >= self.diagram_min_side
            and width * height
            >= self.diagram_min_area
        ):
            return "diagram"

        return "inline"

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def _discover(
        self,
        document: "fitz.Document",
    ) -> Tuple[
        List[DiscoveredRaster],
        int,
    ]:
        """Discover distinct stored image xrefs."""

        order: List[int] = []

        by_xref: Dict[
            int,
            Dict[str, Any],
        ] = {}

        placements = 0

        for page_index in range(
            len(document)
        ):
            page = document.load_page(
                page_index
            )

            page_number = (
                page_index + 1
            )

            try:
                images = (
                    page.get_images(
                        full=True
                    )
                    or []
                )
            except Exception:
                logger.debug(
                    "Could not inspect images on page %s.",
                    page_number,
                    exc_info=True,
                )
                continue

            for image in images:
                try:
                    xref = int(image[0])
                    width = int(image[2])
                    height = int(image[3])
                except (
                    TypeError,
                    ValueError,
                    IndexError,
                ):
                    continue

                if xref <= 0:
                    continue

                placements += 1

                record = by_xref.get(
                    xref
                )

                if record is None:
                    record = {
                        "xref": xref,
                        "page_number": page_number,
                        "pages": [],
                        "source_width": width,
                        "source_height": height,
                    }

                    by_xref[xref] = record
                    order.append(xref)

                if (
                    page_number
                    not in record["pages"]
                ):
                    record["pages"].append(
                        page_number
                    )

        candidates: List[
            DiscoveredRaster
        ] = []

        for xref in order:
            record = by_xref[xref]

            candidates.append(
                DiscoveredRaster(
                    xref=int(
                        record["xref"]
                    ),
                    page_number=int(
                        record["page_number"]
                    ),
                    pages=tuple(
                        sorted(
                            int(page)
                            for page in record["pages"]
                        )
                    ),
                    source_width=int(
                        record["source_width"]
                    ),
                    source_height=int(
                        record["source_height"]
                    ),
                )
            )

        return candidates, placements

    # ------------------------------------------------------------------
    # Filtering
    # ------------------------------------------------------------------

    def _prefilter(
        self,
        width: int,
        height: int,
    ) -> Optional[str]:
        """Reject obviously invalid rasters before decoding."""

        if width <= 0 or height <= 0:
            return "unknown_size"

        if width < self.min_width:
            return "too_small_width"

        if height < self.min_height:
            return "too_small_height"

        area = width * height

        if area < self.min_area:
            return "area_below_min"

        if area > self.max_pixels:
            return "too_many_pixels"

        longer = max(
            width,
            height,
        )

        shorter = min(
            width,
            height,
        )

        if (
            shorter > 0
            and longer / shorter
            > self.max_aspect
        ):
            return "extreme_aspect"

        return None

    # ------------------------------------------------------------------
    # Caption extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _page_lines(
        page: "fitz.Page",
    ) -> List[
        Tuple[BBox, str]
    ]:
        """Extract all non-empty text lines with bounding boxes."""

        lines: List[
            Tuple[BBox, str]
        ] = []

        try:
            data = page.get_text(
                "dict"
            )
        except Exception:
            logger.debug(
                "Could not read page text.",
                exc_info=True,
            )
            return lines

        # ---------------------------------------------------------------
        # IMPORTANT FIX:
        # PyMuPDF normally returns a dictionary from get_text("dict").
        # Check the runtime type before calling .get().
        # ---------------------------------------------------------------

        if not isinstance(
            data,
            dict,
        ):
            logger.debug(
                "Unexpected page text type: %s",
                type(data).__name__,
            )
            return lines

        blocks = data.get(
            "blocks",
            [],
        )

        if not isinstance(
            blocks,
            (list, tuple),
        ):
            logger.debug(
                "Unexpected blocks type: %s",
                type(blocks).__name__,
            )
            return lines

        for block in blocks:

            if not isinstance(
                block,
                dict,
            ):
                continue

            if block.get(
                "type"
            ) != 0:
                continue

            raw_lines = block.get(
                "lines",
                [],
            )

            if not isinstance(
                raw_lines,
                (list, tuple),
            ):
                continue

            for line in raw_lines:

                if not isinstance(
                    line,
                    dict,
                ):
                    continue

                raw_spans = line.get(
                    "spans",
                    [],
                )

                if not isinstance(
                    raw_spans,
                    (list, tuple),
                ):
                    continue

                text = "".join(
                    str(
                        span.get("text")
                        or ""
                    )
                    for span in raw_spans
                    if isinstance(
                        span,
                        dict,
                    )
                ).strip()

                if not text:
                    continue

                bbox = line.get(
                    "bbox"
                )

                if (
                    not bbox
                    or len(bbox) != 4
                ):
                    continue

                try:
                    box: BBox = (
                        float(bbox[0]),
                        float(bbox[1]),
                        float(bbox[2]),
                        float(bbox[3]),
                    )
                except (
                    TypeError,
                    ValueError,
                ):
                    continue

                lines.append(
                    (
                        box,
                        text,
                    )
                )

        return lines

    @staticmethod
    def _normalize_caption(
        text: str,
    ) -> str:
        """Normalize source text without inventing content."""

        cleaned = _PRIVATE_USE.sub(
            " ",
            str(text or ""),
        )

        return re.sub(
            r"\s+",
            " ",
            cleaned,
        ).strip()[:300]

    @staticmethod
    def _overlap_fraction(
        image_rect: BBox,
        line_box: BBox,
    ) -> float:
        """Return horizontal overlap relative to narrower element."""

        overlap = (
            min(
                image_rect[2],
                line_box[2],
            )
            - max(
                image_rect[0],
                line_box[0],
            )
        )

        if overlap <= 0:
            return 0.0

        image_width = (
            image_rect[2]
            - image_rect[0]
        )

        line_width = (
            line_box[2]
            - line_box[0]
        )

        narrower = min(
            image_width,
            line_width,
        )

        if narrower <= 0:
            return 0.0

        return overlap / narrower

    @staticmethod
    def _is_labelled_caption(
        text: str,
    ) -> bool:
        """Recognize explicit captions."""

        cleaned = _PRIVATE_USE.sub(
            "",
            str(text or ""),
        ).strip()

        if len(cleaned) < 3:
            return False

        if len(cleaned) > 300:
            return False

        return bool(
            _CAPTION_PREFIX.match(
                cleaned
            )
        )

    @staticmethod
    def _label_head(
        text: str,
    ) -> Optional[str]:
        """Extract a colon-terminated introducing label."""

        cleaned = _PRIVATE_USE.sub(
            "",
            str(text or ""),
        ).strip()

        if not cleaned.endswith(":"):
            return None

        head = (
            cleaned.split(
                ":",
                1,
            )[0].strip()
            + ":"
        )

        if len(head) < 3:
            return None

        if len(head) > 200:
            return None

        return head

    @staticmethod
    def _is_introducing_label(
        text: str,
    ) -> bool:
        """Recognize an explicit label immediately introducing an image."""

        cleaned = FigureExtractor._label_head(
            text
        )

        if cleaned is None:
            return False

        if _SECTION_HEADING.match(
            cleaned
        ):
            return False

        if ". " in cleaned:
            return False

        first = cleaned[0]

        if not (
            first.isupper()
            or first.isdigit()
        ):
            return False

        return len(
            cleaned.split()
        ) <= 14

    def _caption_score(
        self,
        image_rect: BBox,
        line_box: BBox,
    ) -> Tuple[
        float,
        float,
        float,
    ]:
        """Produce deterministic caption proximity score."""

        image_top = image_rect[1]
        image_bottom = image_rect[3]

        if line_box[3] <= image_top:
            vertical_distance = (
                image_top
                - line_box[3]
            )
        else:
            vertical_distance = (
                line_box[1]
                - image_bottom
            )

        overlap = self._overlap_fraction(
            image_rect,
            line_box,
        )

        return (
            vertical_distance,
            -overlap,
            line_box[1],
        )

    def _find_caption(
        self,
        image_rect: Optional[BBox],
        lines: Sequence[
            Tuple[BBox, str]
        ],
    ) -> CaptionResult:
        """
        Find a source-authored caption.

        Proximity alone never creates a caption.
        """

        if image_rect is None:
            return CaptionResult(
                caption=None,
                caption_source="none",
                nearby_text=None,
            )

        top = image_rect[1]
        bottom = image_rect[3]

        above: List[
            Tuple[BBox, str]
        ] = []

        below: List[
            Tuple[BBox, str]
        ] = []

        for box, text in lines:
            overlap = self._overlap_fraction(
                image_rect,
                box,
            )

            if overlap < 0.20:
                continue

            if (
                box[1]
                >= bottom - 2.0
                and box[1] - bottom
                <= self.caption_gap_pt
            ):
                below.append(
                    (box, text)
                )

            elif (
                box[3]
                <= top + 2.0
                and top - box[3]
                <= self.caption_gap_pt
            ):
                above.append(
                    (box, text)
                )

        above.sort(
            key=lambda item:
            self._caption_score(
                image_rect,
                item[0],
            )
        )

        below.sort(
            key=lambda item:
            self._caption_score(
                image_rect,
                item[0],
            )
        )

        nearby_parts = [
            text
            for _, text in below[:2]
        ]

        nearby_parts.extend(
            text
            for _, text in above[:1]
        )

        nearby_text = (
            self._normalize_caption(
                " ".join(
                    nearby_parts
                )
            )
            or None
        )

        for _, text in below:
            if self._is_labelled_caption(
                text
            ):
                return CaptionResult(
                    caption=self._normalize_caption(
                        text
                    ),
                    caption_source="below",
                    nearby_text=nearby_text,
                )

        for _, text in above:
            if self._is_labelled_caption(
                text
            ):
                return CaptionResult(
                    caption=self._normalize_caption(
                        text
                    ),
                    caption_source="above",
                    nearby_text=nearby_text,
                )

        for _, text in above:
            if self._is_introducing_label(
                text
            ):
                head = (
                    self._label_head(
                        text
                    )
                    or text
                )

                return CaptionResult(
                    caption=self._normalize_caption(
                        head
                    ),
                    caption_source="above_label",
                    nearby_text=nearby_text,
                )

        return CaptionResult(
            caption=None,
            caption_source="none",
            nearby_text=nearby_text,
        )

    # ------------------------------------------------------------------
    # Image placement
    # ------------------------------------------------------------------

    @staticmethod
    def _image_rect(
        page: "fitz.Page",
        xref: int,
    ) -> Optional[BBox]:
        """Return the first known placement rectangle."""

        try:
            rects = page.get_image_rects(
                xref
            )
        except Exception:
            logger.debug(
                "Placement rectangle unavailable.",
                exc_info=True,
            )
            return None

        if not rects:
            return None

        rect = rects[0]

        try:
            return (
                float(rect.x0),
                float(rect.y0),
                float(rect.x1),
                float(rect.y1),
            )
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Candidate extraction
    # ------------------------------------------------------------------

    def _extract_candidate(
        self,
        document: "fitz.Document",
        candidate: DiscoveredRaster,
        cache_dir: Path,
        document_key: str,
    ) -> Tuple[
        Optional[ExtractedFigure],
        Optional[str],
        Optional[str],
    ]:
        """
        Extract one raster.

        Returns:
            figure,
            rejection_reason,
            checksum
        """

        xref = candidate.xref

        reason = self._prefilter(
            candidate.source_width,
            candidate.source_height,
        )

        if reason is not None:
            return (
                None,
                reason,
                None,
            )

        pixmap: Optional[
            fitz.Pixmap
        ] = None

        target: Optional[Path] = None
        checksum: Optional[str] = None

        try:
            pixmap = fitz.Pixmap(
                document,
                xref,
            )

            pixmap = self._to_rgb(
                pixmap
            )

            pixmap = self._downscale(
                pixmap
            )

            if self._is_uniform(
                pixmap
            ):
                return (
                    None,
                    "uniform_colour",
                    None,
                )

            checksum = hashlib.sha256(
                pixmap.samples
            ).hexdigest()

            width = pixmap.width
            height = pixmap.height

            target = cache_dir / (
                f"p{candidate.page_number:03d}"
                f"_x{xref}"
                f"_{checksum[:16]}.png"
            )

            self._atomic_save_png(
                pixmap,
                target,
            )

            if not target.is_file():
                return (
                    None,
                    "write_failed",
                    checksum,
                )

            byte_size = target.stat().st_size

            if byte_size < self.min_bytes:
                target.unlink(
                    missing_ok=True
                )

                return (
                    None,
                    "encoded_too_small",
                    checksum,
                )

            file_checksum = (
                self._file_sha256(
                    target,
                    truncate=64,
                )
            )

        except MemoryError:
            logger.warning(
                "Memory error while decoding raster xref=%s.",
                xref,
            )

            if target is not None:
                target.unlink(
                    missing_ok=True
                )

            return (
                None,
                "memory_error",
                checksum,
            )

        except (
            OSError,
            ValueError,
            RuntimeError,
            TypeError,
        ):
            logger.debug(
                "Raster extraction failed for xref=%s.",
                xref,
                exc_info=True,
            )

            if target is not None:
                target.unlink(
                    missing_ok=True
                )

            return (
                None,
                "decode_failed",
                checksum,
            )

        finally:
            pixmap = None

        # ---------------------------------------------------------------
        # Page metadata
        # ---------------------------------------------------------------

        try:
            page = document.load_page(
                candidate.page_number - 1
            )
        except Exception:
            if target is not None:
                target.unlink(
                    missing_ok=True
                )

            return (
                None,
                "page_load_failed",
                checksum,
            )

        rect = self._image_rect(
            page,
            xref,
        )

        lines = self._page_lines(
            page
        )

        caption_result = (
            self._find_caption(
                rect,
                lines,
            )
        )

        figure_kind = self._classify(
            width,
            height,
        )

        figure_id = (
            f"{document_key}-{checksum[:16]}"
        )

        figure = ExtractedFigure(
            figure_id=figure_id,
            pdf_id=None,
            document_key=document_key,
            source_path="",
            source_name="",
            page_number=candidate.page_number,
            pages=tuple(
                sorted(
                    set(candidate.pages)
                )
            ),
            xref=xref,
            image_path=str(
                target.resolve()
            ),
            width=width,
            height=height,
            source_width=(
                candidate.source_width
            ),
            source_height=(
                candidate.source_height
            ),
            byte_size=byte_size,
            figure_kind=figure_kind,
            caption=caption_result.caption,
            caption_source=(
                caption_result.caption_source
            ),
            nearby_text=(
                caption_result.nearby_text
            ),
            checksum=checksum,
            bbox=rect,
            file_checksum=file_checksum,
        )

        return (
            figure,
            None,
            checksum,
        )

    # ------------------------------------------------------------------
    # Public extraction API
    # ------------------------------------------------------------------

    def extract(
        self,
        file_path: os.PathLike | str,
        pdf_id: Optional[str] = None,
        *,
        force: bool = False,
    ) -> List[ExtractedFigure]:
        """Extract every accepted embedded raster figure."""

        result = self.extract_result(
            file_path,
            pdf_id,
            force=force,
        )

        return list(
            result.figures
        )

    def extract_result(
        self,
        file_path: os.PathLike | str,
        pdf_id: Optional[str] = None,
        *,
        force: bool = False,
    ) -> FigureExtractionResult:
        """Structured extraction API."""

        started = time.perf_counter()

        path = Path(
            file_path
        )

        processor = PDFProcessor()

        # ---------------------------------------------------------------
        # Validate
        # ---------------------------------------------------------------

        try:
            processor.validate_pdf(
                str(path)
            )
        except (
            InvalidPDFError,
            PDFLoadError,
        ) as error:
            raise FigureExtractionError(
                str(error)
            ) from error

        # ---------------------------------------------------------------
        # Identity
        # ---------------------------------------------------------------

        key = self.document_key(
            path
        )

        cache_dir = self.cache_dir_for(
            key,
            pdf_id,
        )

        source_name = path.name

        lock = self._lock_for(
            cache_dir
        )

        with lock:

            # -----------------------------------------------------------
            # Cache
            # -----------------------------------------------------------

            if not force:
                cached = self._read_manifest(
                    cache_dir,
                    key,
                    pdf_id,
                )

                if cached is not None:
                    elapsed_ms = int(
                        (
                            time.perf_counter()
                            - started
                        )
                        * 1000
                    )

                    self._log(
                        f"cache_hit "
                        f"doc={key} "
                        f"figures={len(cached)} "
                        f"elapsed_ms={elapsed_ms}"
                    )

                    return FigureExtractionResult(
                        document_key=key,
                        source_name=source_name,
                        figures=tuple(cached),
                        discovered=len(cached),
                        placements=sum(
                            len(
                                figure.pages
                            )
                            for figure in cached
                        ),
                        accepted=len(cached),
                        duplicates_merged=0,
                        rejected=0,
                        capped=0,
                        cache_hit=True,
                        elapsed_ms=elapsed_ms,
                    )

            cache_dir.mkdir(
                parents=True,
                exist_ok=True,
            )

            # -----------------------------------------------------------
            # Load PDF
            # -----------------------------------------------------------

            try:
                document = processor.load_pdf(
                    str(path)
                )
            except (
                InvalidPDFError,
                PDFLoadError,
            ) as error:
                raise FigureExtractionError(
                    str(error)
                ) from error

            figures: List[
                ExtractedFigure
            ] = []

            rejected: Dict[
                str,
                int,
            ] = {}

            by_checksum: Dict[
                str,
                int,
            ] = {}

            duplicates = 0
            capped = 0

            def reject(
                reason: str,
            ) -> None:
                rejected[reason] = (
                    rejected.get(
                        reason,
                        0,
                    )
                    + 1
                )

            try:
                candidates, placements = (
                    self._discover(
                        document
                    )
                )

                self._log(
                    f"discovered "
                    f"doc={key} "
                    f"pages={len(document)} "
                    f"placements={placements} "
                    f"distinct_rasters={len(candidates)}"
                )

                # -------------------------------------------------------
                # Candidate loop
                # -------------------------------------------------------

                for position, candidate in enumerate(
                    candidates
                ):

                    if (
                        len(figures)
                        >= self.max_figures_per_document
                    ):
                        capped = (
                            len(candidates)
                            - position
                        )
                        break

                    # ---------------------------------------------------
                    # Cheap filter
                    # ---------------------------------------------------

                    prefilter_reason = (
                        self._prefilter(
                            candidate.source_width,
                            candidate.source_height,
                        )
                    )

                    if prefilter_reason is not None:
                        reject(
                            prefilter_reason
                        )

                        self._log(
                            f"rejected "
                            f"page={candidate.page_number} "
                            f"xref={candidate.xref} "
                            f"w={candidate.source_width} "
                            f"h={candidate.source_height} "
                            f"reason={prefilter_reason}"
                        )

                        continue

                    figure, reason, checksum = (
                        self._extract_candidate(
                            document,
                            candidate,
                            cache_dir,
                            key,
                        )
                    )

                    if reason is not None:
                        reject(
                            reason
                        )

                        self._log(
                            f"rejected "
                            f"page={candidate.page_number} "
                            f"xref={candidate.xref} "
                            f"reason={reason}"
                        )

                        continue

                    if figure is None:
                        reject(
                            "unknown_extraction_failure"
                        )

                        self._log(
                            f"rejected "
                            f"page={candidate.page_number} "
                            f"xref={candidate.xref} "
                            f"reason=unknown_extraction_failure"
                        )

                        continue

                    # ---------------------------------------------------
                    # Visual duplicate
                    # ---------------------------------------------------

                    if (
                        checksum is not None
                        and checksum in by_checksum
                    ):
                        duplicates += 1

                        existing_index = (
                            by_checksum[
                                checksum
                            ]
                        )

                        previous = figures[
                            existing_index
                        ]

                        merged_pages = tuple(
                            sorted(
                                set(
                                    previous.pages
                                ).union(
                                    figure.pages
                                )
                            )
                        )

                        merged_bbox = (
                            previous.bbox
                            if previous.bbox
                            is not None
                            else figure.bbox
                        )

                        figures[
                            existing_index
                        ] = replace(
                            previous,
                            pages=merged_pages,
                            bbox=merged_bbox,
                        )

                        duplicate_path = Path(
                            figure.image_path
                        )

                        previous_path = Path(
                            previous.image_path
                        )

                        if (
                            duplicate_path
                            != previous_path
                        ):
                            duplicate_path.unlink(
                                missing_ok=True
                            )

                        self._log(
                            f"duplicate "
                            f"page={candidate.page_number} "
                            f"xref={candidate.xref} "
                            f"same_as_page={previous.page_number}"
                        )

                        continue

                    # ---------------------------------------------------
                    # Final source metadata
                    # ---------------------------------------------------

                    figure = replace(
                        figure,
                        pdf_id=(
                            str(pdf_id)
                            if pdf_id is not None
                            else None
                        ),
                        source_path=str(
                            path.resolve()
                        ),
                        source_name=source_name,
                    )

                    by_checksum[
                        figure.checksum
                    ] = len(figures)

                    figures.append(
                        figure
                    )

                    self._log(
                        f"extracted "
                        f"page={figure.page_number} "
                        f"xref={figure.xref} "
                        f"{figure.width}x{figure.height} "
                        f"bytes={figure.byte_size} "
                        f"kind={figure.figure_kind} "
                        f"caption={figure.caption_source}"
                    )

            finally:
                processor.close()

            # -----------------------------------------------------------
            # Cap logging
            # -----------------------------------------------------------

            if capped > 0:
                self._log(
                    f"capped "
                    f"doc={key} "
                    f"limit={self.max_figures_per_document} "
                    f"skipped={capped}"
                )

            # -----------------------------------------------------------
            # Manifest
            # -----------------------------------------------------------

            self._write_manifest(
                cache_dir,
                key,
                pdf_id,
                source_name,
                figures,
            )

            elapsed_ms = int(
                (
                    time.perf_counter()
                    - started
                )
                * 1000
            )

            rejected_total = sum(
                rejected.values()
            )

            summary = " ".join(
                f"{reason}={count}"
                for reason, count
                in sorted(
                    rejected.items()
                )
            )

            # IMPORTANT:
            # Keep these calculations outside the f-string. This avoids
            # nested f-string syntax errors.
            diagram_count = sum(
                1
                for item in figures
                if item.figure_kind
                == "diagram"
            )

            captioned_count = sum(
                1
                for item in figures
                if item.caption
            )

            log_message = (
                f"validated "
                f"doc={key} "
                f"accepted={len(figures)} "
                f"diagrams={diagram_count} "
                f"captioned={captioned_count} "
                f"duplicates_merged={duplicates} "
                f"rejected={rejected_total}"
            )

            if summary:
                log_message += (
                    f" [{summary}]"
                )

            log_message += (
                f" elapsed_ms={elapsed_ms}"
            )

            self._log(
                log_message
            )

            return FigureExtractionResult(
                document_key=key,
                source_name=source_name,
                figures=tuple(figures),
                discovered=len(candidates),
                placements=placements,
                accepted=len(figures),
                duplicates_merged=duplicates,
                rejected=rejected_total,
                capped=capped,
                cache_hit=False,
                elapsed_ms=elapsed_ms,
            )

    # ------------------------------------------------------------------
    # Convenience views
    # ------------------------------------------------------------------

    @staticmethod
    def by_page(
        figures: Iterable[
            ExtractedFigure
        ],
    ) -> Dict[
        int,
        List[ExtractedFigure],
    ]:
        """
        Index figures by every page on which they occur.
        """

        index: Dict[
            int,
            List[ExtractedFigure],
        ] = {}

        for figure in figures:
            pages = (
                figure.pages
                or (figure.page_number,)
            )

            for page in pages:
                index.setdefault(
                    int(page),
                    [],
                ).append(
                    figure
                )

        return index

    @staticmethod
    def by_id(
        figures: Iterable[
            ExtractedFigure
        ],
    ) -> Dict[
        str,
        ExtractedFigure,
    ]:
        """Create a figure_id -> figure lookup."""

        return {
            figure.figure_id: figure
            for figure in figures
        }

    @staticmethod
    def diagrams(
        figures: Iterable[
            ExtractedFigure
        ],
    ) -> List[ExtractedFigure]:
        """Return only figures classified as diagrams."""

        return [
            figure
            for figure in figures
            if figure.figure_kind
            == "diagram"
        ]

    @staticmethod
    def captioned(
        figures: Iterable[
            ExtractedFigure
        ],
    ) -> List[ExtractedFigure]:
        """Return figures with explicit source captions."""

        return [
            figure
            for figure in figures
            if figure.caption
        ]


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

figure_extractor = FigureExtractor()


__all__ = [
    "FigureExtractionError",
    "DiscoveredRaster",
    "CaptionResult",
    "ExtractedFigure",
    "FigureExtractionResult",
    "FigureExtractor",
    "figure_extractor",
]