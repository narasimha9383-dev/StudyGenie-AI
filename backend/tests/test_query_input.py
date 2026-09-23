"""Tests for query-input handling (text / PDF / image).

These prove the QUERY side: a question supplied as text, a PDF, or an image is
turned into normalized question text, and that image extraction degrades
gracefully when the model cannot read images. None of these paths index anything
into the vector store.
"""

import unittest
from pathlib import Path

from ai.generation.llm_service import LLMGenerationError
from ai.generation.query_input import (
    QueryInputError,
    extract_query_from_image,
    normalize_query,
    resolve_query,
)


class VisionLLM:
    def __init__(self, response="What is normalization in DBMS?"):
        self.response = response
        self.images = None

    def generate(self, prompt, images=None, temperature=None, **kwargs):
        self.images = images
        return self.response


class BlindLLM:
    """A text-only model that rejects images (e.g. small local llama.cpp)."""

    provider = "llama.cpp"

    def generate(self, prompt, images=None, temperature=None, **kwargs):
        raise LLMGenerationError("this model does not support image input")


class NormalizeQueryTests(unittest.TestCase):
    def test_collapses_whitespace(self):
        self.assertEqual(normalize_query("  What   is\n\tTCP? "), "What is TCP?")

    def test_empty_raises(self):
        with self.assertRaises(QueryInputError):
            normalize_query("   \n  ")

    def test_caps_length(self):
        out = normalize_query("word " * 5000)
        self.assertLessEqual(len(out), 2000)


class ResolveQueryTests(unittest.TestCase):
    def test_text_type(self):
        self.assertEqual(resolve_query({"type": "text", "text": "Define ACID"}), "Define ACID")

    def test_default_type_is_text(self):
        self.assertEqual(resolve_query({"text": "Define ACID"}), "Define ACID")

    def test_missing_path_raises(self):
        with self.assertRaises(QueryInputError):
            resolve_query({"type": "pdf"})

    def test_unsupported_type_raises(self):
        with self.assertRaises(QueryInputError):
            resolve_query({"type": "audio", "path": "x"})


class ImageQueryTests(unittest.TestCase):
    def _tmp_image(self) -> str:
        # Content is irrelevant because the LLM is faked; we only need a real file.
        path = Path(__file__).with_name("_tmp_query_image.png")
        path.write_bytes(b"\x89PNG\r\n\x1a\nfake-bytes")
        return str(path)

    def tearDown(self):
        stale = Path(__file__).with_name("_tmp_query_image.png")
        if stale.exists():
            stale.unlink()

    def test_image_transcribed_by_vision_llm(self):
        llm = VisionLLM("What is a deadlock?")
        query = extract_query_from_image(self._tmp_image(), llm_service=llm)
        self.assertEqual(query, "What is a deadlock?")
        # The image was forwarded as a base64 data URI, never indexed.
        self.assertTrue(llm.images and llm.images[0].startswith("data:image/png;base64,"))

    def test_blind_model_degrades_gracefully(self):
        with self.assertRaises(QueryInputError):
            extract_query_from_image(self._tmp_image(), llm_service=BlindLLM())

    def test_no_text_response_raises(self):
        with self.assertRaises(QueryInputError):
            extract_query_from_image(self._tmp_image(), llm_service=VisionLLM("NO_TEXT"))

    def test_missing_file_raises(self):
        with self.assertRaises(QueryInputError):
            extract_query_from_image("does-not-exist.png", llm_service=VisionLLM())


if __name__ == "__main__":
    unittest.main()
