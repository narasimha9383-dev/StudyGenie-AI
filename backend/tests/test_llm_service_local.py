import os
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from ai.generation import llm_service as llm_module
from ai.generation.llm_service import LLMGenerationError, LLMService


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def post(self, url, headers, json, timeout=None):
        self.calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        return FakeResponse(self.payload)


class LocalLLMServiceTests(unittest.TestCase):
    def local_env(self):
        return patch.dict(os.environ, {
            "LOCAL_LLM_ENABLED": "true",
            "LOCAL_LLM_BASE_URL": "http://127.0.0.1:8080/v1",
            "LOCAL_LLM_MODEL": "ggml-org/Qwen3.5-0.8B-GGUF",
            "LOCAL_LLM_MAX_TOKENS": "1000",
            "LOCAL_LLM_TEMPERATURE": "0.2",
            "LOCAL_LLM_TIMEOUT": "1",
            "OPENROUTER_API_KEY": "",
        }, clear=False)

    def test_local_success_and_request_shape(self):
        client = FakeClient({"choices": [{"message": {"content": "local answer"}}]})
        with self.local_env():
            service = LLMService(client=client)
            self.assertEqual(service.provider_name, "llama.cpp")
            self.assertEqual(service.generate("Explain TCP"), "local answer")
        request = client.calls[0]
        self.assertEqual(request["url"], "http://127.0.0.1:8080/v1/chat/completions")
        self.assertEqual(request["json"]["model"], "ggml-org/Qwen3.5-0.8B-GGUF")
        self.assertEqual(request["json"]["max_tokens"], 1000)
        self.assertEqual(request["json"]["temperature"], 0.2)
        # The resolved per-request read budget is handed to the transport rather than
        # left to its default. (Which env var supplied it is covered by the tiered
        # timeout test; here we only prove it is threaded through.)
        self.assertEqual(request["timeout"], service.request_timeout)
        self.assertNotIn("Authorization", request["headers"])

    def test_malformed_response_is_rejected(self):
        client = FakeClient({"choices": []})
        with self.local_env(), self.assertRaises(LLMGenerationError):
            LLMService(client=client).generate("Explain TCP")

    def test_timeout_is_not_hidden(self):
        # Connection succeeds (probe ok) but the read exceeds the budget: this must
        # be reported as a slow generation ("timed out after Ns"), NOT a generic
        # failure and NOT as an unreachable server.
        with self.local_env(), \
                patch.object(llm_module.socket, "create_connection", return_value=MagicMock()), \
                patch.object(llm_module, "urlopen", side_effect=TimeoutError("timed out")):
            with self.assertRaises(LLMGenerationError) as ctx:
                LLMService().generate("Explain TCP")
        self.assertRegex(str(ctx.exception), r"timed out after \d+s")
        self.assertTrue(getattr(ctx.exception, "timeout", False))
        self.assertFalse(getattr(ctx.exception, "unavailable", False))

    def test_unavailable_server_is_not_hidden(self):
        # The TCP port is closed: the reachability probe fails fast and the error is
        # classified as "not reachable" (unavailable), distinct from a slow read.
        with self.local_env(), \
                patch.object(llm_module.socket, "create_connection", side_effect=ConnectionRefusedError("refused")):
            with self.assertRaises(LLMGenerationError) as ctx:
                LLMService().generate("Explain TCP")
        self.assertRegex(str(ctx.exception), "not reachable")
        self.assertTrue(getattr(ctx.exception, "unavailable", False))

    def test_generic_connection_error_is_still_surfaced(self):
        # Probe ok, but urlopen fails for a non-timeout, non-refused reason: it must
        # still surface as a real error rather than being silently swallowed.
        with self.local_env(), \
                patch.object(llm_module.socket, "create_connection", return_value=MagicMock()), \
                patch.object(llm_module, "urlopen", side_effect=URLError("boom")):
            with self.assertRaisesRegex(LLMGenerationError, "connection failed"):
                LLMService().generate("Explain TCP")

    def test_tiered_timeouts_are_distinct(self):
        # Per-operation timeouts: notes must get a longer read budget than a normal
        # request, and a dedicated short connect timeout must exist.
        with self.local_env():
            # load_dotenv() pulls the ambient .env (LLM_REQUEST_TIMEOUT=150, etc.) into
            # os.environ at import time, and local_env() patches with clear=False, so
            # those overrides would otherwise leak in and mask the fallback under test.
            # Remove them here so this exercises the path where ONLY LOCAL_LLM_TIMEOUT
            # is set; patch.dict restores the full environment on exit.
            for var in ("LLM_REQUEST_TIMEOUT", "LLM_CONNECT_TIMEOUT", "NOTES_LLM_TIMEOUT"):
                os.environ.pop(var, None)
            service = LLMService()
        self.assertEqual(service.connect_timeout, 10.0)
        self.assertEqual(service.request_timeout, 1.0)  # from LOCAL_LLM_TIMEOUT="1"
        self.assertGreaterEqual(service.notes_timeout, service.request_timeout)
        self.assertEqual(service.notes_timeout, 240.0)


if __name__ == "__main__":
    unittest.main()
