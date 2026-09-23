import os
import unittest
from unittest.mock import patch

from ai.generation.llm_service import LLMConfigurationError, LLMService


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeClient:
    def __init__(self):
        self.calls = []

    def post(self, url, headers, json, timeout=None):
        self.calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        return FakeResponse({"choices": [{"message": {"content": "grounded answer"}}]})


class GroqLLMServiceTests(unittest.TestCase):
    def test_groq_uses_openai_compatible_endpoint_and_keeps_system_context(self):
        client = FakeClient()
        env = {
            "LLM_PROVIDER": "groq",
            "GROQ_API_KEY": "test-key",
            "GROQ_MODEL": "openai/gpt-oss-20b",
            "GROQ_REASONING_EFFORT": "low",
            "LOCAL_LLM_ENABLED": "true",
        }
        with patch.dict(os.environ, env, clear=False):
            service = LLMService(client=client)
            self.assertEqual(service.provider_name, "Groq")
            self.assertEqual(service.generate("PDF context: TCP", system="Use only PDF context."), "grounded answer")

        request = client.calls[0]
        self.assertEqual(request["url"], "https://api.groq.com/openai/v1/chat/completions")
        self.assertEqual(request["headers"]["Authorization"], "Bearer test-key")
        self.assertEqual(request["json"]["model"], "openai/gpt-oss-20b")
        self.assertEqual(request["json"]["reasoning_effort"], "low")
        self.assertEqual(request["json"]["messages"][0]["content"], "Use only PDF context.")
        self.assertEqual(request["json"]["messages"][1]["content"], "PDF context: TCP")

    def test_new_fast_llm_alias_selects_groq(self):
        with patch.dict(os.environ, {
            "LLM_PROVIDER": "NEW_FAST_LLM",
            "GROQ_API_KEY": "test-key",
        }, clear=False):
            self.assertEqual(LLMService(client=FakeClient()).provider_name, "Groq")

    def test_groq_requires_key(self):
        with patch.dict(os.environ, {"LLM_PROVIDER": "groq", "GROQ_API_KEY": ""}, clear=False):
            with self.assertRaisesRegex(LLMConfigurationError, "GROQ_API_KEY"):
                LLMService()


if __name__ == "__main__":
    unittest.main()
