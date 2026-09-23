"""Embedded-raster figure extraction contract tests.

These cover the guarantees a later stage depends on when it attaches a real
figure from the uploaded PDF to a generated question:

* text and numbered lists are never figures (they are page text, not rasters);
* page number and source identity survive extraction, including across the
  cache, so a figure can always be traced back to its PDF;
* one stored image is decoded and written ONCE, however many pages place it;
* non-figure rasters (spacers, rules, solid blocks) are rejected;
* a caption is only ever the document's own label -- a section heading that
  merely follows a figure must NOT be presented as its caption;
* nothing is written outside the cache root, and an interrupted write cannot
  leave a truncated PNG behind.

The PDFs are built here with PyMuPDF rather than loaded from a fixture, so the
suite needs no uploads directory, no vector store, and no network. Image bytes
are pseudo-random so they survive the real default byte/entropy filters instead
of the tests having to weaken them.
"""

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf as fitz

from ai.ingestion.figure_extractor import (
    ExtractedFigure,
    FigureExtractionError,
    FigureExtractor,
)
from ai.ingestion.pdf_processor import InvalidPDFError, PDFLoadError

# Where an image is placed on the synthetic page, in PDF points.
IMAGE_RECT = fitz.Rect(100, 200, 400, 350)


def noisy_png(width: int, height: int, seed: int = 1) -> bytes:
    """Return PNG bytes with enough entropy to survive the real filters.

    A flat two-tone image compresses to a few hundred bytes and would be
    rejected as ``encoded_too_small``; that filter is deliberately left at its
    production value, so the test data has to be genuinely detailed. Samples
    are generated with a small LCG so every run produces identical bytes and
    checksums stay reproducible.
    """
    state = seed or 1
    samples = bytearray(width * height * 3)
    for index in range(len(samples)):
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        samples[index] = (state >> 16) & 0xFF
    pixmap = fitz.Pixmap(fitz.csRGB, width, height, bytes(samples), False)
    return pixmap.tobytes("png")


def flat_png(width: int, height: int, value: int = 200) -> bytes:
    """Return PNG bytes for a single solid colour (a non-figure block)."""
    samples = bytes([value]) * (width * height * 3)
    pixmap = fitz.Pixmap(fitz.csRGB, width, height, samples, False)
    return pixmap.tobytes("png")


class FigureExtractorTestCase(unittest.TestCase):
    """Shared temp cache + synthetic-PDF builders."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="figtest_"))
        self.cache = self.tmp / "cache"
        # Explicit cache_root, so a developer's FIGURE_CACHE_DIR cannot make the
        # tests write into the real uploads directory.
        self.extractor = FigureExtractor(cache_root=self.cache)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- builders ------------------------------------------------------

    def write_pdf(self, name: str, build) -> Path:
        """Create a PDF at ``name`` by calling ``build(document)``."""
        path = self.tmp / name
        document = fitz.open()
        try:
            build(document)
            document.save(str(path))
        finally:
            document.close()
        return path

    def pdf_with_image(
        self,
        name: str = "one.pdf",
        *,
        below: str = "",
        above: str = "",
        image: bytes = None,
        rect: fitz.Rect = IMAGE_RECT,
    ) -> Path:
        """A one-page PDF with an image, optionally captioned above/below it."""
        payload = image if image is not None else noisy_png(300, 150)

        def build(document):
            page = document.new_page()
            page.insert_image(rect, stream=payload)
            if above:
                # Baseline just above the image's top edge.
                page.insert_text((rect.x0, rect.y0 - 5), above, fontsize=10)
            if below:
                # Baseline just below the image's bottom edge.
                page.insert_text((rect.x0, rect.y1 + 10), below, fontsize=10)

        return self.write_pdf(name, build)


class TextIsNeverAFigure(FigureExtractorTestCase):
    """Requirement: do not treat text blocks or numbered lists as figures."""

    def test_prose_and_numbered_list_yield_no_figures(self):
        def build(document):
            page = document.new_page()
            page.insert_text((72, 100), "Principles for trustworthy AI", fontsize=14)
            body = [
                "1. Principles for trust",
                "2. Pillars of trustworthy AI",
                "3. Impact dimensions",
                "4. Governance",
                "The list above is ordinary body text and must never be",
                "reported as a figure, however diagram-like its layout is.",
            ]
            for offset, line in enumerate(body):
                page.insert_text((72, 140 + offset * 18), line, fontsize=11)

        path = self.write_pdf("text_only.pdf", build)
        self.assertEqual(self.extractor.extract(path, pdf_id="textdoc"), [])

    def test_vector_drawing_is_not_extracted(self):
        """Vector art is excluded by design, not merely unimplemented."""

        def build(document):
            page = document.new_page()
            page.draw_rect(fitz.Rect(100, 100, 300, 200), color=(0, 0, 0))
            page.draw_line(fitz.Point(100, 100), fitz.Point(300, 200))
            page.draw_circle(fitz.Point(200, 150), 40, color=(0, 0, 1))
            page.insert_text((100, 230), "Fig. 1 a vector diagram", fontsize=10)

        path = self.write_pdf("vector.pdf", build)
        self.assertEqual(self.extractor.extract(path, pdf_id="vecdoc"), [])


class MetadataIsPreserved(FigureExtractorTestCase):
    """Requirements: preserve page number, source metadata, and the PDF link."""

    def test_page_and_source_metadata(self):
        def build(document):
            for index in range(3):
                page = document.new_page()
                if index == 1:  # only the SECOND page carries the figure
                    page.insert_image(IMAGE_RECT, stream=noisy_png(300, 150))

        path = self.write_pdf("meta.pdf", build)
        figures = self.extractor.extract(path, pdf_id="metadoc")

        self.assertEqual(len(figures), 1)
        figure = figures[0]
        self.assertEqual(figure.page_number, 2, "1-based page number of the raster")
        self.assertEqual(figure.pages, (2,))
        self.assertEqual(figure.pdf_id, "metadoc")
        self.assertEqual(figure.source_name, "meta.pdf")
        self.assertEqual(Path(figure.source_path), path.resolve())
        self.assertEqual(figure.document_key, FigureExtractor.document_key(path))
        self.assertTrue(Path(figure.image_path).is_file())
        self.assertGreater(figure.byte_size, 0)
        self.assertEqual(figure.byte_size, Path(figure.image_path).stat().st_size)
        self.assertIn(figure.figure_kind, {"diagram", "inline"})

    def test_figure_id_is_stable_and_identifies_page_and_xref(self):
        path = self.pdf_with_image("stable.pdf")
        first = self.extractor.extract(path, pdf_id="stabledoc")
        second = self.extractor.extract(path, pdf_id="stabledoc", force=True)
        self.assertEqual(
            [item.figure_id for item in first],
            [item.figure_id for item in second],
            "figure_id must not depend on run order or wall-clock time",
        )
        self.assertIn("p1", first[0].figure_id)

    def test_dataclass_round_trips_through_json(self):
        path = self.pdf_with_image("round.pdf", below="Fig. 4 round trip")
        figure = self.extractor.extract(path, pdf_id="rounddoc")[0]
        restored = ExtractedFigure.from_dict(json.loads(json.dumps(figure.to_dict())))
        self.assertEqual(restored, figure)
        self.assertIsInstance(restored.pages, tuple)


class DuplicatesAreExtractedOnce(FigureExtractorTestCase):
    """Requirement: avoid duplicate image extraction."""

    def test_one_image_on_three_pages_is_written_once(self):
        payload = noisy_png(320, 160, seed=7)

        def build(document):
            first = document.new_page()
            first.insert_image(IMAGE_RECT, stream=payload)
            # Reuse the SAME stored image object on later pages, which is what a
            # real document does with a repeated logo/diagram.
            xref = first.get_images(full=True)[0][0]
            for _ in range(2):
                page = document.new_page()
                page.insert_image(IMAGE_RECT, stream=payload, xref=xref)

        path = self.write_pdf("repeat.pdf", build)
        figures = self.extractor.extract(path, pdf_id="repeatdoc")

        self.assertEqual(len(figures), 1, "one stored image -> one figure")
        self.assertEqual(figures[0].pages, (1, 2, 3), "every placement recorded")
        self.assertEqual(figures[0].page_number, 1, "cite the first appearance")

        written = list((self.cache / "repeatdoc").glob("*.png"))
        self.assertEqual(len(written), 1, "decoded and written exactly once")

    def test_identical_pixels_under_two_xrefs_collapse_to_one_file(self):
        """Byte-identical figures must not produce two copies on disk."""
        payload = noisy_png(300, 150, seed=11)

        def build(document):
            for _ in range(2):
                page = document.new_page()
                page.insert_image(IMAGE_RECT, stream=payload)

        path = self.write_pdf("samepixels.pdf", build)
        figures = self.extractor.extract(path, pdf_id="samedoc")

        self.assertEqual(len(figures), 1)
        self.assertEqual(figures[0].pages, (1, 2))
        self.assertEqual(len(list((self.cache / "samedoc").glob("*.png"))), 1)

    def test_by_page_finds_a_repeated_figure_under_every_page(self):
        figure = ExtractedFigure(
            figure_id="k-p2-x9",
            pdf_id="d",
            document_key="k",
            source_path="s.pdf",
            source_name="s.pdf",
            page_number=2,
            pages=(2, 5, 9),
            xref=9,
            image_path="x.png",
            width=300,
            height=150,
            source_width=300,
            source_height=150,
            byte_size=2048,
            figure_kind="diagram",
            caption=None,
            caption_source="none",
            nearby_text=None,
            checksum="abc",
        )
        index = FigureExtractor.by_page([figure])
        self.assertEqual(sorted(index), [2, 5, 9])
        for page in (2, 5, 9):
            self.assertEqual(index[page], [figure])


class CacheIsReusedAndInvalidated(FigureExtractorTestCase):
    """Requirement: do the expensive work once, but never serve stale figures."""

    def test_second_call_reuses_the_manifest(self):
        path = self.pdf_with_image("cached.pdf", below="Fig. 1 cached")
        first = self.extractor.extract(path, pdf_id="cachedoc")
        before = Path(first[0].image_path).stat().st_mtime_ns

        second = self.extractor.extract(path, pdf_id="cachedoc")

        self.assertEqual([f.to_dict() for f in first], [f.to_dict() for f in second])
        self.assertEqual(
            Path(second[0].image_path).stat().st_mtime_ns,
            before,
            "a cache hit must not rewrite the PNG",
        )

    def test_force_reextracts(self):
        path = self.pdf_with_image("forced.pdf")
        first = self.extractor.extract(path, pdf_id="forcedoc")
        second = self.extractor.extract(path, pdf_id="forcedoc", force=True)
        self.assertEqual(
            [f.figure_id for f in first], [f.figure_id for f in second]
        )

    def test_reupload_under_the_same_pdf_id_invalidates_the_cache(self):
        """The killer case: same id, different file. Stale figures must not leak."""
        path = self.tmp / "swap.pdf"

        document = fitz.open()
        page = document.new_page()
        page.insert_image(IMAGE_RECT, stream=noisy_png(300, 150, seed=3))
        document.save(str(path))
        document.close()
        first = self.extractor.extract(path, pdf_id="swapdoc")

        # Same path and pdf_id, genuinely different content: two figures now.
        document = fitz.open()
        for seed in (21, 22):
            page = document.new_page()
            page.insert_image(IMAGE_RECT, stream=noisy_png(340, 170, seed=seed))
        document.save(str(path))
        document.close()
        second = self.extractor.extract(path, pdf_id="swapdoc")

        self.assertEqual(len(first), 1)
        self.assertEqual(len(second), 2, "re-upload must be re-extracted")
        self.assertNotEqual(first[0].document_key, second[0].document_key)
        self.assertNotEqual(first[0].checksum, second[0].checksum)

    def test_deleted_png_forces_reextraction(self):
        path = self.pdf_with_image("gone.pdf")
        first = self.extractor.extract(path, pdf_id="gonedoc")
        Path(first[0].image_path).unlink()

        second = self.extractor.extract(path, pdf_id="gonedoc")

        self.assertEqual(len(second), 1)
        self.assertTrue(
            Path(second[0].image_path).is_file(),
            "a manifest pointing at a missing file must trigger re-extraction",
        )

    def test_manifest_from_an_older_schema_is_ignored(self):
        path = self.pdf_with_image("schema.pdf")
        self.extractor.extract(path, pdf_id="schemadoc")
        manifest = self.cache / "schemadoc" / "figures.json"
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        payload["version"] = 0
        manifest.write_text(json.dumps(payload), encoding="utf-8")

        figures = self.extractor.extract(path, pdf_id="schemadoc")
        self.assertEqual(len(figures), 1)

    def test_corrupt_manifest_is_ignored(self):
        path = self.pdf_with_image("corrupt.pdf")
        self.extractor.extract(path, pdf_id="corruptdoc")
        (self.cache / "corruptdoc" / "figures.json").write_text("{not json", encoding="utf-8")

        self.assertEqual(len(self.extractor.extract(path, pdf_id="corruptdoc")), 1)


class NonFiguresAreRejected(FigureExtractorTestCase):
    """Logos, spacers, hairline rules and solid blocks are not figures."""

    def _reasons(self, path: Path, pdf_id: str):
        """Extract while capturing the [IMAGE] log, returning (figures, log)."""
        buffer = io.StringIO()
        original, sys.stderr = sys.stderr, buffer
        try:
            figures = self.extractor.extract(path, pdf_id=pdf_id)
        finally:
            sys.stderr = original
        return figures, buffer.getvalue()

    def test_tiny_raster_is_rejected(self):
        path = self.pdf_with_image(
            "tiny.pdf",
            image=noisy_png(40, 20),
            rect=fitz.Rect(100, 200, 140, 220),
        )
        figures, log = self._reasons(path, "tinydoc")
        self.assertEqual(figures, [])
        self.assertIn("reason=too_small", log)

    def test_low_area_raster_is_rejected(self):
        path = self.pdf_with_image("area.pdf", image=noisy_png(100, 30))
        figures, log = self._reasons(path, "areadoc")
        self.assertEqual(figures, [])
        self.assertIn("reason=area_below_min", log)

    def test_hairline_rule_is_rejected(self):
        path = self.pdf_with_image("rule.pdf", image=noisy_png(1600, 30))
        figures, log = self._reasons(path, "ruledoc")
        self.assertEqual(figures, [])
        self.assertIn("reason=extreme_aspect", log)

    def test_solid_colour_block_is_rejected(self):
        path = self.pdf_with_image("solid.pdf", image=flat_png(300, 200))
        figures, log = self._reasons(path, "soliddoc")
        self.assertEqual(figures, [])
        self.assertIn("reason=uniform_colour", log)

    def test_a_real_figure_alongside_junk_still_survives(self):
        """Rejecting junk must not cost us the genuine figure on the same page."""

        def build(document):
            page = document.new_page()
            page.insert_image(fitz.Rect(60, 60, 80, 70), stream=noisy_png(20, 10))
            page.insert_image(fitz.Rect(100, 200, 400, 350), stream=noisy_png(320, 200, seed=5))
            page.insert_image(fitz.Rect(60, 400, 500, 410), stream=flat_png(300, 200))

        path = self.write_pdf("mixed.pdf", build)
        figures = self.extractor.extract(path, pdf_id="mixeddoc")
        self.assertEqual(len(figures), 1)
        self.assertEqual((figures[0].width, figures[0].height), (320, 200))

    def test_oversized_raster_is_downscaled_with_aspect_preserved(self):
        extractor = FigureExtractor(cache_root=self.cache, max_pixels=10_000)
        path = self.pdf_with_image("big.pdf", image=noisy_png(400, 200, seed=9))
        figure = extractor.extract(path, pdf_id="bigdoc")[0]

        self.assertEqual((figure.source_width, figure.source_height), (400, 200))
        self.assertLess(figure.width, 400, "must actually shrink")
        self.assertAlmostEqual(
            figure.width / figure.height, 400 / 200, places=2,
            msg="integer halving must preserve the aspect ratio exactly",
        )


class CaptionsAreNeverInvented(FigureExtractorTestCase):
    """A caption is the document's own label -- or there is no caption."""

    def caption_of(self, **kwargs):
        path = self.pdf_with_image(f"cap{abs(hash(str(kwargs))) % 10**6}.pdf", **kwargs)
        figure = self.extractor.extract(path, pdf_id="capdoc", force=True)[0]
        return figure

    def test_labelled_caption_below_is_used(self):
        figure = self.caption_of(below="Fig. 2 GAN architecture")
        self.assertEqual(figure.caption_source, "below")
        self.assertEqual(figure.caption, "Fig. 2 GAN architecture")
        self.assertEqual(figure.display_caption, "Fig. 2 GAN architecture")

    def test_introducing_label_above_is_used_and_trimmed(self):
        figure = self.caption_of(
            above="Discriminator Loss Function: the discriminator minimizes this:"
        )
        self.assertEqual(figure.caption_source, "above_label")
        self.assertEqual(
            figure.caption,
            "Discriminator Loss Function:",
            "keep the label, drop the sentence it introduces",
        )

    def test_section_heading_below_is_not_a_caption(self):
        """Regression: the line after a figure is usually the NEXT heading."""
        figure = self.caption_of(below="3. Adversarial Learning")
        self.assertIsNone(figure.caption)
        self.assertEqual(figure.caption_source, "none")
        self.assertEqual(figure.display_caption, "Figure from page 1")
        self.assertIn(
            "Adversarial",
            figure.nearby_text or "",
            "the heading is still kept for question matching, just not as a caption",
        )

    def test_prose_starting_with_a_keyword_is_not_a_caption(self):
        """Regression: "Image generation and enhancement" is a sentence."""
        figure = self.caption_of(below="Image generation and enhancement")
        self.assertIsNone(figure.caption)
        self.assertEqual(figure.caption_source, "none")

    def test_wrapped_prose_ending_in_a_colon_is_not_a_caption(self):
        """Regression: a mid-sentence fragment above the image is not a label."""
        figure = self.caption_of(above="previous value. It is expressed as:")
        self.assertIsNone(figure.caption)
        self.assertEqual(figure.caption_source, "none")

    def test_long_prose_below_is_not_a_caption(self):
        figure = self.caption_of(
            below=(
                "This paragraph simply happens to sit underneath the image and "
                "continues for a considerable number of words without ever "
                "being a caption for it at all."
            )
        )
        self.assertIsNone(figure.caption)

    def test_distant_text_is_not_a_caption(self):
        """A line far below the image belongs to something else."""

        def build(document):
            page = document.new_page()
            page.insert_image(IMAGE_RECT, stream=noisy_png(300, 150))
            page.insert_text((100, 700), "Fig. 9 far away", fontsize=10)

        path = self.write_pdf("far.pdf", build)
        figure = self.extractor.extract(path, pdf_id="fardoc")[0]
        self.assertIsNone(figure.caption)

    def test_horizontally_separated_text_is_not_a_caption(self):
        """A caption in another column does not belong to this image."""

        def build(document):
            page = document.new_page()
            page.insert_image(fitz.Rect(60, 200, 200, 300), stream=noisy_png(300, 150))
            page.insert_text((420, 310), "Fig. 7 other column", fontsize=10)

        path = self.write_pdf("column.pdf", build)
        figure = self.extractor.extract(path, pdf_id="coldoc")[0]
        self.assertIsNone(figure.caption)

    def test_symbol_font_bullets_and_unmapped_glyphs_are_stripped(self):
        """Wingdings bullets and U+FFFD would render as hollow boxes in the PDF.

        Asserted on the normaliser directly: a synthetic PDF cannot reliably
        round-trip a private-use glyph through Helvetica, whereas the real
        fixture genuinely contains U+F0D8 and U+F0E0.
        """
        bullet, arrow, unmapped = chr(0xF0D8), chr(0xF0E0), chr(0xFFFD)
        raw = bullet + " Fig. 3" + arrow + " pipeline" + unmapped + " overview"
        cleaned = FigureExtractor._normalize_caption(raw)

        self.assertNotIn(bullet, cleaned)
        self.assertNotIn(arrow, cleaned)
        self.assertNotIn(unmapped, cleaned)
        self.assertEqual(cleaned, "Fig. 3 pipeline overview")

    def test_a_real_typographic_apostrophe_is_kept(self):
        """U+2019 is legitimate text -- the fixture's captions use it."""
        apostrophe = chr(0x2019)
        raw = "Fig. VAE" + apostrophe + "s architecture"
        self.assertEqual(FigureExtractor._normalize_caption(raw), raw)



class StorageIsSafe(FigureExtractorTestCase):
    """Requirement: safe temporary/local storage."""

    def test_images_are_written_inside_the_cache_root(self):
        path = self.pdf_with_image("inside.pdf")
        figure = self.extractor.extract(path, pdf_id="insidedoc")[0]
        self.assertIn(self.cache.resolve(), Path(figure.image_path).resolve().parents)

    def test_no_temporary_files_remain(self):
        path = self.pdf_with_image("atomic.pdf")
        self.extractor.extract(path, pdf_id="atomicdoc")
        self.assertEqual(list(self.cache.rglob("*.tmp")), [])
        self.assertEqual(list(self.cache.rglob("*.png.tmp")), [])

    def test_hostile_pdf_id_cannot_escape_the_cache_root(self):
        directory = self.extractor.cache_dir_for("deadbeef", "../../../etc/passwd")
        self.assertIn(self.cache.resolve(), directory.resolve().parents)
        self.assertNotIn("..", directory.parts)

    def test_pdf_id_of_only_separators_falls_back_to_the_document_key(self):
        directory = self.extractor.cache_dir_for("deadbeef", "../..")
        self.assertEqual(directory.name, "deadbeef")

    def test_unusable_identifiers_are_refused(self):
        with self.assertRaises(FigureExtractionError):
            self.extractor.cache_dir_for("///", "///")

    def test_document_key_tracks_content_not_path(self):
        first = self.pdf_with_image("k1.pdf", image=noisy_png(300, 150, seed=4))
        copied = self.tmp / "k1_copy.pdf"
        shutil.copyfile(first, copied)
        other = self.pdf_with_image("k2.pdf", image=noisy_png(300, 150, seed=99))

        self.assertEqual(
            FigureExtractor.document_key(first),
            FigureExtractor.document_key(copied),
            "a copy is the same document",
        )
        self.assertNotEqual(
            FigureExtractor.document_key(first),
            FigureExtractor.document_key(other),
        )


class BadInputIsReported(FigureExtractorTestCase):
    """Failures are explicit, never a silent empty result."""

    def test_missing_file_raises(self):
        with self.assertRaises((InvalidPDFError, PDFLoadError, FigureExtractionError)):
            self.extractor.extract(self.tmp / "nope.pdf", pdf_id="nodoc")

    def test_non_pdf_content_raises(self):
        path = self.tmp / "fake.pdf"
        path.write_bytes(b"this is not a PDF at all")
        with self.assertRaises((InvalidPDFError, PDFLoadError, FigureExtractionError)):
            self.extractor.extract(path, pdf_id="fakedoc")

    def test_pdf_without_images_returns_empty_not_an_error(self):
        path = self.write_pdf("blank.pdf", lambda document: document.new_page())
        self.assertEqual(self.extractor.extract(path, pdf_id="blankdoc"), [])


class PerDocumentCapIsHonest(FigureExtractorTestCase):
    """A capped run must say what it dropped rather than truncate silently."""

    def test_cap_is_logged(self):
        extractor = FigureExtractor(cache_root=self.cache, max_figures_per_document=2)

        def build(document):
            for seed in range(4):
                page = document.new_page()
                page.insert_image(IMAGE_RECT, stream=noisy_png(300, 150, seed=seed + 31))

        path = self.write_pdf("many.pdf", build)
        buffer = io.StringIO()
        original, sys.stderr = sys.stderr, buffer
        try:
            figures = extractor.extract(path, pdf_id="manydoc")
        finally:
            sys.stderr = original

        self.assertEqual(len(figures), 2)
        self.assertIn("capped", buffer.getvalue())
        self.assertIn("skipped=2", buffer.getvalue())


class LoggingIsPiiSafe(FigureExtractorTestCase):
    """Document text must never reach the logs."""

    def test_caption_text_is_not_logged(self):
        secret = "Fig. 5 Confidential Patient Cohort Diagram"
        path = self.pdf_with_image("pii.pdf", below=secret)
        buffer = io.StringIO()
        original, sys.stderr = sys.stderr, buffer
        try:
            figure = self.extractor.extract(path, pdf_id="piidoc")[0]
        finally:
            sys.stderr = original
        log = buffer.getvalue()

        self.assertEqual(figure.caption, secret, "the caption is still captured")
        self.assertNotIn("Confidential", log)
        self.assertNotIn("Patient", log)
        self.assertIn("caption=below", log, "only the provenance is logged")


if __name__ == "__main__":
    unittest.main()
