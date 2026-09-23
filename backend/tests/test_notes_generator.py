"""Tests for the LLM-backed NotesGenerator.

These prove the notes-generation control flow WITHOUT touching the network or a
real model: a fake LLM client lets us assert the output-token budget and the notes
read-timeout are actually applied, that an invalid-JSON response is repaired, and —
critically for the timeout bug — that a slow (timeout) or unreachable model degrades
into a clean, user-safe error result instead of crashing the process.
"""

import json
import os
import unittest
from unittest.mock import patch

from ai.generation.llm_service import LLMGenerationError
from ai.generation.notes_generator import NotesGenerator
from ai.generation.response_formatter import ResponseFormatterError

VALID_NOTES = {
    "title": "DBMS Normalization",
    "summary": "Normalization reduces redundancy.",
    "key_concepts": ["1NF", "2NF", "3NF"],
    "important_points": ["Avoid update anomalies"],
    "revision_tips": ["Practice decomposition"],
}


class FakePromptService:
    def build_notes_prompt(self, content):
        return f"NOTES_PROMPT::{content[:32]}"


class FakeFormatter:
    """Deterministic stand-in: parse succeeds only for valid JSON objects."""

    def parse_notes(self, response):
        try:
            data = json.loads(response)
        except (ValueError, TypeError) as error:
            raise ResponseFormatterError(f"invalid JSON: {error}")
        if not isinstance(data, dict):
            raise ResponseFormatterError("notes must be a JSON object")
        return data

    def success(self, notes):
        return {"success": True, "data": notes}

    def error(self, message):
        return {"success": False, "error": message}


class RecordingLLM:
    """Fake LLM client that records call kwargs and yields queued responses.

    A queued item that is an Exception is raised (to simulate timeout / unavailable
    / other LLM failures); anything else is returned as the response string.
    """

    notes_timeout = 240.0

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def generate_json(self, prompt, temperature=None, max_tokens=None, images=None, timeout=None):
        self.calls.append({"prompt": prompt, "max_tokens": max_tokens, "timeout": timeout})
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def make_generator(llm):
    return NotesGenerator(
        llm_service=llm,
        prompt_service=FakePromptService(),
        response_formatter=FakeFormatter(),
    )


class NotesGeneratorTests(unittest.TestCase):
    def test_generates_structured_notes(self):
        llm = RecordingLLM([json.dumps(VALID_NOTES)])
        result = make_generator(llm).generate("A study document about DBMS normalization.")
        self.assertTrue(result["success"])
        self.assertEqual(result["data"]["title"], "DBMS Normalization")
        self.assertEqual(len(llm.calls), 1)

    def test_applies_output_token_budget_and_notes_timeout(self):
        # The output-token budget is configurable via NOTES_LLM_MAX_TOKENS and the
        # longer notes read-timeout is forwarded to the LLM client.
        with patch.dict(os.environ, {"NOTES_LLM_MAX_TOKENS": "900"}, clear=False):
            llm = RecordingLLM([json.dumps(VALID_NOTES)])
            make_generator(llm).generate("content that is long enough to matter")
        self.assertEqual(llm.calls[0]["max_tokens"], 900)
        self.assertEqual(llm.calls[0]["timeout"], 240.0)

    def test_repairs_invalid_json_then_succeeds(self):
        llm = RecordingLLM(["this is not json", json.dumps(VALID_NOTES)])
        result = make_generator(llm).generate("content")
        self.assertTrue(result["success"])
        self.assertEqual(len(llm.calls), 2)
        # The repair call asks for at least the JSON-repair headroom (3072).
        self.assertGreaterEqual(llm.calls[1]["max_tokens"], 3072)

    def test_slow_generation_timeout_degrades_gracefully(self):
        # A read timeout must NOT crash: it becomes a clean error result carrying the
        # real, PII-safe reason (distinct from an unreachable server).
        error = LLMGenerationError("llama.cpp request took too long (exceeded 240s).")
        error.timeout = True
        result = make_generator(RecordingLLM([error])).generate("content")
        self.assertFalse(result["success"])
        self.assertIn("took too long", result["error"])

    def test_unavailable_model_degrades_gracefully(self):
        error = LLMGenerationError("llama.cpp is not reachable at 127.0.0.1:8080 (refused).")
        error.unavailable = True
        result = make_generator(RecordingLLM([error])).generate("content")
        self.assertFalse(result["success"])
        self.assertIn("not reachable", result["error"])

    def test_repair_failure_reports_original_error(self):
        llm = RecordingLLM(["not json", "still not json"])
        result = make_generator(llm).generate("content")
        self.assertFalse(result["success"])
        self.assertEqual(len(llm.calls), 2)

    def test_empty_content_is_rejected_without_calling_llm(self):
        llm = RecordingLLM([json.dumps(VALID_NOTES)])
        result = make_generator(llm).generate("   ")
        self.assertFalse(result["success"])
        self.assertEqual(len(llm.calls), 0)

    def test_large_content_still_generates(self):
        # A realistically long document body should pass straight through to a
        # successful result (the char/chunk budgeting happens upstream in Node).
        llm = RecordingLLM([json.dumps(VALID_NOTES)])
        result = make_generator(llm).generate("Chapter. " * 5000)
        self.assertTrue(result["success"])


if __name__ == "__main__":
    unittest.main()
