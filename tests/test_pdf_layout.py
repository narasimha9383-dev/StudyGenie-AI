"""Deterministic PDF layout smoke test; it never calls an LLM or external API."""

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "sample_document.json"
OUTPUT = ROOT / "tests" / "fixtures" / "sample_document.pdf"


class PdfLayoutTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(["node", str(ROOT / "tests" / "render_fixture.js")], cwd=ROOT, capture_output=True, text=True, check=True)
        cls.output = Path(result.stdout.strip())

    def test_fixture_is_static(self):
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertIn("questions_answers", fixture)
        self.assertTrue(self.output.exists())

    def test_pdf_has_content_and_no_bad_layout_tokens(self):
        data = self.output.read_bytes()
        self.assertTrue(data.startswith(b"%PDF"))
        self.assertNotIn("Generated using AI".encode(), data)

    def test_renderer_is_not_an_llm_path(self):
        renderer = (ROOT / "backend" / "services" / "pdfService.js").read_text(encoding="utf-8")
        self.assertIn("renderStudyMaterialPdf", renderer)
        self.assertNotIn("generateAiMaterials", (ROOT / "tests" / "render_fixture.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
