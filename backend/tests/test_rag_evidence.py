"""Adaptive-RAG contract tests.

These assert the RAG-first + LLM-assisted behaviour:

* RAG_ONLY (sufficient)  -> LLM is called and answers *grounded in* the context.
* RAG+LLM  (partial)     -> LLM is called with the context and fills gaps.
* INSUFFICIENT_CONTEXT    -> no LLM call when there is no source evidence.
* Missing user_id        -> retrieval is skipped (isolation is fail-closed).

The recording fakes let us prove the retrieved chunk text actually reaches the
LLM request (the whole point of a RAG pipeline).
"""

import os
import unittest
from unittest.mock import patch

from ai.generation.llm_service import LLMGenerationError, LLMService
from ai.generation.prompt_service import PromptService
from ai.generation.rag_service import RAGService
# Imported from the SAME module rag_service catches it from, so the raised class
# and the `except RetrievalError` in ask_question are identical (a different
# class would not be caught and the test would be meaningless).
from ai.retrieval.retrieval_service import RetrievalError


class FakeRetrieval:
    def __init__(self, chunks):
        self.chunks = chunks
        self.calls = []

    def retrieve_top_k(self, **kwargs):
        self.calls.append(kwargs)
        return [dict(chunk) for chunk in self.chunks]


class SemanticAndKeywordRetrieval(FakeRetrieval):
    """Simulates a vector miss plus an exact section-heading lexical hit."""

    def __init__(self, semantic_chunks, keyword_chunks):
        super().__init__(semantic_chunks)
        self.keyword_chunks = keyword_chunks

    def retrieve_keyword_candidates(self, query, pdf_id, user_id, limit):
        self.keyword_call = {
            "query": query,
            "pdf_id": pdf_id,
            "user_id": user_id,
            "limit": limit,
        }
        return [dict(chunk) for chunk in self.keyword_chunks]


class FakeRanker:
    def rank(self, question, chunks, limit):
        return chunks[:limit]


class FakeReranker:
    def rerank(self, question, chunks, top_k):
        return chunks[:top_k]


class ScoreSettingReranker:
    def __init__(self, score):
        self.score = score

    def rerank(self, question, chunks, top_k):
        ranked = [dict(chunk) for chunk in chunks[:top_k]]
        for chunk in ranked:
            chunk["rerank_score"] = self.score
        return ranked


class FailingReranker:
    def rerank(self, question, chunks, top_k):
        raise RuntimeError("cross-encoder unavailable")


class RecordingLLM:
    """Captures the (prompt, system) pair passed to the LLM for assertions."""

    def __init__(self, response="A synthesized, grounded explanation of the topic."):
        self.calls = []
        self.response = response

    def generate(self, prompt, system=None, **kwargs):
        self.calls.append({"prompt": prompt, "system": system, "kwargs": kwargs})
        return self.response

    @property
    def last_prompt(self):
        return self.calls[-1]["prompt"] if self.calls else ""

    @property
    def last_system(self):
        return self.calls[-1]["system"] if self.calls else None


class FailingLLM(RecordingLLM):
    def generate(self, prompt, system=None, **kwargs):
        self.calls.append({"prompt": prompt, "system": system, "kwargs": kwargs})
        raise LLMGenerationError("simulated unavailable LLM")


class LocalClient:
    def __init__(self):
        self.calls = []

    def post(self, url, headers, json, timeout=None):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        return type("Response", (), {
            "raise_for_status": lambda self: None,
            "json": lambda self: {"choices": [{"message": {"content": "Grounded answer."}}]},
        })()


def service(chunks, llm, retrieval=None):
    return RAGService(
        retrieval_service=retrieval or FakeRetrieval(chunks),
        hybrid_search=FakeRanker(),
        reranker_service=FakeReranker(),
        llm_service=llm,
    )


TCP_CHUNK = {
    "content": "TCP is a connection-oriented transport protocol that provides reliable data transmission.",
    "score": 0.92,
    "metadata": {"pdf_id": "pdf-1", "chunk_id": "chunk-1", "page_number": 3, "source": "networking.pdf", "section": "Transport Layer"},
}


class AdaptiveRagTests(unittest.TestCase):
    # ---- RAG_ONLY -------------------------------------------------------
    def test_sufficient_evidence_calls_llm_with_grounded_context(self):
        llm = RecordingLLM()
        result = service([TCP_CHUNK], llm).ask_question(
            "What is TCP?", user_id="user-1", pdf_id="pdf-1"
        )
        data = result["data"]
        self.assertEqual(data["mode"], "rag")
        self.assertTrue(data["llm_used"])
        self.assertTrue(data["rag_supported"])
        self.assertTrue(data["rag_complete"])
        self.assertTrue(data["is_from_pdf"])
        # PROOF: the LLM was called exactly once, and the retrieved chunk text
        # is present in the prompt that was sent to it.
        self.assertEqual(len(llm.calls), 1)
        self.assertIn("connection-oriented transport protocol", llm.last_prompt)
        # PROOF: the grounding rules ride in the system role.
        self.assertIsNotNone(llm.last_system)
        self.assertIn("primary source of truth", llm.last_system)
        # Sources come from metadata only.
        self.assertEqual(data["sources"][0]["page_number"], 3)
        self.assertEqual(data["sources"][0]["document_name"], "networking.pdf")
        self.assertIn("Transport Layer", data["relatedConcepts"])

    def test_sufficient_llm_failure_falls_back_to_evidence(self):
        llm = FailingLLM()
        result = service([TCP_CHUNK], llm).ask_question(
            "What is TCP?", user_id="user-1", pdf_id="pdf-1"
        )
        data = result["data"]
        self.assertEqual(data["mode"], "rag")
        self.assertFalse(data["llm_used"])
        # Graceful: still returns the grounded evidence text, plus a machine hint.
        self.assertIn("connection-oriented transport protocol", data["answer"])
        self.assertIn("answer_error", data)

    def test_keyword_fallback_recovers_exact_document_section_missed_by_vector(self):
        retrieval = SemanticAndKeywordRetrieval(
            [{
                "content": "A different section explains supervised learning.",
                "score": 0.31,
                "metadata": {"pdf_id": "pdf-1", "chunk_id": "wrong", "user_id": "user-1"},
            }],
            [{
                "content": (
                    "Generative modeling learns a data distribution and can generate samples. "
                    "Discriminative modeling learns a boundary or conditional label relationship."
                ),
                "score": 0.9,
                "retrieval_channel": "keyword",
                "metadata": {"pdf_id": "pdf-1", "chunk_id": "gen-disc", "user_id": "user-1", "page_number": 7},
            }],
        )
        llm = RecordingLLM()
        result = service(None, llm, retrieval=retrieval).ask_question(
            "Explain generative versus discriminative modeling.",
            user_id="user-1",
            pdf_id="pdf-1",
        )
        self.assertEqual(retrieval.keyword_call["pdf_id"], "pdf-1")
        self.assertIn(result["data"]["mode"], ("rag", "rag_enriched"))
        self.assertIn("Generative modeling learns", llm.last_prompt)
        self.assertEqual(result["data"]["sources"][0]["page_number"], 7)

    def test_follow_up_uses_prior_topic_for_retrieval_but_not_as_evidence(self):
        retrieval = FakeRetrieval([TCP_CHUNK])
        llm = RecordingLLM()
        result = service(None, llm, retrieval=retrieval).ask_question(
            "Can you explain that again?",
            user_id="user-1",
            pdf_id="pdf-1",
            conversation_history=[{
                "question": "What is TCP?",
                "answer": "An earlier answer that is reference-only.",
            }],
        )
        self.assertIn(result["data"]["mode"], ("rag", "rag_enriched"))
        self.assertIn("What is TCP?", retrieval.calls[0]["query"])
        self.assertIn("Recent conversation", llm.last_prompt)
        self.assertIn("reference only", llm.last_prompt)

    def test_concept_follow_up_uses_prior_topic_without_pronoun(self):
        retrieval = FakeRetrieval([TCP_CHUNK])
        llm = RecordingLLM()
        service(None, llm, retrieval=retrieval).ask_question(
            "Explain the generator.",
            user_id="user-1",
            pdf_id="pdf-1",
            conversation_history=[{
                "question": "What is a GAN?",
                "answer": "A generative adversarial network.",
            }],
        )
        self.assertIn("What is a GAN?", retrieval.calls[0]["query"])

    def test_missing_pdf_id_isolation_skips_retrieval(self):
        retrieval = FakeRetrieval([TCP_CHUNK])
        llm = RecordingLLM()
        result = service(None, llm, retrieval=retrieval).ask_question(
            "What is TCP?", user_id="user-1", pdf_id=None
        )
        self.assertFalse(retrieval.calls)
        self.assertEqual(result["data"]["mode"], "insufficient_context")

    # ---- RAG + LLM (partial) -------------------------------------------
    def test_partial_evidence_grounds_and_enriches(self):
        llm = RecordingLLM()
        result = service([{
            "content": "TCP is a connection-oriented transport protocol.",
            "score": 0.84,
            "metadata": {"pdf_id": "pdf-1", "chunk_id": "chunk-1", "page_number": 3, "source": "networking.pdf"},
        }], llm).ask_question(
            "Explain TCP and why is it reliable?", user_id="user-1", pdf_id="pdf-1"
        )
        data = result["data"]
        self.assertEqual(data["mode"], "rag_enriched")
        self.assertTrue(data["llm_used"])
        self.assertTrue(data["rag_supported"])
        self.assertFalse(data["rag_complete"])
        self.assertEqual(len(llm.calls), 1)
        self.assertIn("connection-oriented transport protocol", llm.last_prompt)
        self.assertIn("primary source of truth", llm.last_system)

    def test_partial_llm_failure_returns_rag_evidence(self):
        llm = FailingLLM()
        result = service([{
            "content": "TCP is a connection-oriented transport protocol.",
            "score": 0.84,
            "metadata": {"pdf_id": "pdf-1", "chunk_id": "chunk-1", "page_number": 3},
        }], llm).ask_question(
            "Explain TCP and why is it reliable?", user_id="user-1", pdf_id="pdf-1"
        )
        data = result["data"]
        self.assertEqual(data["mode"], "rag_enriched")
        self.assertFalse(data["llm_used"])
        self.assertIn("connection-oriented transport protocol", data["answer"])
        self.assertIn("does not contain enough detail", data["answer"])

    # ---- Insufficient context ------------------------------------------
    def test_no_evidence_returns_safe_source_fallback(self):
        llm = RecordingLLM()
        result = service([], llm).ask_question(
            "What is photosynthesis?", user_id="user-1", pdf_id="pdf-1"
        )
        data = result["data"]
        self.assertEqual(data["mode"], "insufficient_context")
        self.assertFalse(data["llm_used"])
        self.assertFalse(data["rag_supported"])
        self.assertTrue(data["is_from_pdf"])
        self.assertEqual(data["sources"], [])
        self.assertEqual(len(llm.calls), 0)
        self.assertEqual(data["answer"], PromptService.MISSING_INFORMATION_RESPONSE)

    # ---- Isolation (fail-closed) ---------------------------------------
    def test_missing_user_id_skips_retrieval(self):
        retrieval = FakeRetrieval([TCP_CHUNK])
        llm = RecordingLLM()
        result = service(None, llm, retrieval=retrieval).ask_question(
            "What is TCP?", user_id=None, pdf_id="pdf-1"
        )
        data = result["data"]
        # Retrieval must NOT run without a user_id (no cross-user leakage).
        self.assertEqual(retrieval.calls, [])
        self.assertEqual(data["mode"], "insufficient_context")
        self.assertFalse(data["rag_supported"])
        self.assertEqual(len(llm.calls), 0)

    # ---- Filtering / dedup ---------------------------------------------
    def test_irrelevant_chunk_excluded_from_context(self):
        llm = RecordingLLM()
        result = service([
            TCP_CHUNK,
            {"content": "Photosynthesis converts light into chemical energy.", "score": 0.35,
             "metadata": {"pdf_id": "pdf-1", "chunk_id": "irrelevant"}},
        ], llm).ask_question("What is TCP?", user_id="user-1", pdf_id="pdf-1")
        data = result["data"]
        self.assertEqual(len(data["sources"]), 1)
        # The irrelevant chunk never reaches the LLM context.
        self.assertNotIn("Photosynthesis", llm.last_prompt)

    def test_duplicate_chunks_are_deduped(self):
        llm = RecordingLLM()
        result = service([
            {"content": "TCP is connection-oriented.", "score": 0.84, "metadata": {"pdf_id": "pdf-1", "chunk_id": "a"}},
            {"content": "TCP is connection-oriented.", "score": 0.83, "metadata": {"pdf_id": "pdf-1", "chunk_id": "dup"}},
        ], llm).ask_question("What is TCP?", user_id="user-1", pdf_id="pdf-1")
        self.assertEqual(len(result["data"]["sources"]), 1)

    def test_reranker_failure_keeps_isolated_hybrid_evidence(self):
        llm = RecordingLLM()
        svc = RAGService(
            retrieval_service=FakeRetrieval([TCP_CHUNK]),
            hybrid_search=FakeRanker(),
            reranker_service=FailingReranker(),
            llm_service=llm,
        )
        result = svc.ask_question("What is TCP?", user_id="user-1", pdf_id="pdf-1")
        self.assertEqual(result["data"]["mode"], "rag")
        self.assertTrue(result["data"]["llm_used"])
        self.assertEqual(len(llm.calls), 1)

    # ---- Context truncation (Bug 9) ------------------------------------
    def test_context_is_truncated_to_budget(self):
        svc = service([TCP_CHUNK], RecordingLLM())
        svc.max_context_chars = 300
        blocks = ["A" * 250, "B" * 250, "C" * 250]
        truncated = svc._truncate_context(blocks)
        total = sum(len(b) for b in truncated)
        # Never exceeds the budget (allowing the short " …" partial marker).
        self.assertLessEqual(total, 300 + 2)
        self.assertLess(len(truncated), len(blocks))

    # ---- Local llama.cpp request actually carries context + system -----
    def test_rag_only_uses_local_llama_cpp_with_system_message(self):
        client = LocalClient()
        with patch.dict(os.environ, {"LOCAL_LLM_ENABLED": "true"}, clear=False):
            llm = LLMService(client=client)
            result = service([TCP_CHUNK], llm).ask_question(
                "What is TCP?", user_id="user-1", pdf_id="pdf-1"
            )
        self.assertEqual(result["data"]["mode"], "rag")
        self.assertTrue(result["data"]["llm_used"])
        self.assertEqual(len(client.calls), 1)
        messages = client.calls[0]["json"]["messages"]
        self.assertEqual(messages[0]["role"], "system")
        self.assertIn("connection-oriented transport protocol", messages[1]["content"])


class PromptServiceGroundingTests(unittest.TestCase):
    def test_system_grounding_is_strictly_document_only(self):
        grounding = PromptService.SYSTEM_GROUNDING.lower()
        self.assertIn("only facts", grounding)
        self.assertIn("do not use general knowledge", grounding)
        self.assertIn("conversation history", grounding)

    def test_llm_only_prompt_requires_safe_fallback(self):
        prompt = PromptService.build_llm_only_prompt("What is X?")
        self.assertIn(PromptService.MISSING_INFORMATION_RESPONSE, prompt)


class RecordingSearch:
    """Online-search provider double. Records whether it was consulted so the
    tests can prove the ALLOW_ONLINE_SEARCH gate short-circuits BEFORE any
    provider call (never a silent online search when disabled)."""

    def __init__(self, results=None):
        self.results = results if results is not None else []
        self.called = False

    def search(self, question):
        self.called = True
        return self.results


class TenMarkModeTests(unittest.TestCase):
    """§8 structured 10-mark exam mode: wider retrieval, the exam-style prompt, and
    a ``questionType`` marker on the payload — while ordinary chat stays unchanged.

    The evidence heuristic may classify a given question as sufficient (``rag``) or
    partial (``rag_enriched``); both are grounded and both carry the 10-mark prompt
    and marker, so these assertions accept either grounded mode rather than pinning
    a brittle exact string."""

    def test_ten_mark_widens_retrieval_and_uses_exam_prompt(self):
        retrieval = FakeRetrieval([TCP_CHUNK])
        llm = RecordingLLM()
        result = service(None, llm, retrieval=retrieval).ask_question(
            "Explain TCP.", user_id="user-1", pdf_id="pdf-1", question_type="10_mark",
        )
        data = result["data"]
        # Grounded in the PDF and tagged so the caller can render exam formatting.
        self.assertIn(data["mode"], ("rag", "rag_enriched"))
        self.assertTrue(data["rag_supported"])
        self.assertTrue(data["is_from_pdf"])
        self.assertEqual(data["questionType"], "10_mark")
        # Retrieval was widened for a long answer: top_k = max(chunks, 8) >= 8.
        self.assertTrue(retrieval.calls, "retrieval must run for a 10-mark question")
        self.assertGreaterEqual(retrieval.calls[0]["top_k"], 8)
        # The exam-style prompt template reached the LLM (not the ordinary Q&A one).
        self.assertIn("university-style 10-mark answer", llm.last_prompt)

    def test_question_type_aliases_map_to_ten_mark(self):
        # Every accepted spelling (case-insensitive) selects 10-mark mode.
        for alias in ("10-mark", "ten_mark", "10mark", "EXAM"):
            retrieval = FakeRetrieval([TCP_CHUNK])
            llm = RecordingLLM()
            result = service(None, llm, retrieval=retrieval).ask_question(
                "Explain TCP.", user_id="user-1", pdf_id="pdf-1", question_type=alias,
            )
            self.assertEqual(result["data"]["questionType"], "10_mark", alias)
            self.assertGreaterEqual(retrieval.calls[0]["top_k"], 8, alias)

    def test_ordinary_question_is_not_ten_mark(self):
        # No question_type -> ordinary chat: no exam prompt, no 10-mark marker.
        retrieval = FakeRetrieval([TCP_CHUNK])
        llm = RecordingLLM()
        result = service(None, llm, retrieval=retrieval).ask_question(
            "Explain TCP.", user_id="user-1", pdf_id="pdf-1",
        )
        self.assertNotIn("university-style 10-mark answer", llm.last_prompt)
        self.assertNotEqual(result["data"].get("questionType"), "10_mark")


class OnlineSearchGatingTests(unittest.TestCase):
    """§10: online search is OFF by default and is NEVER consulted unless
    ALLOW_ONLINE_SEARCH=true. Proven by a recording provider that must stay
    untouched while disabled, and consulted only once explicitly enabled."""

    def _build(self, provider):
        # Fakes for the heavy services (as the module `service()` helper does), plus
        # the injected search provider whose consultation we are asserting on.
        return RAGService(
            retrieval_service=FakeRetrieval([]),
            hybrid_search=FakeRanker(),
            reranker_service=FakeReranker(),
            llm_service=RecordingLLM(),
            web_search_service=provider,
        )

    def test_disabled_by_default_never_calls_provider(self):
        provider = RecordingSearch([{"title": "X", "snippet": "s", "url": "http://x"}])
        with patch.dict(os.environ, {"ALLOW_ONLINE_SEARCH": "false"}, clear=False):
            svc = self._build(provider)
        self.assertFalse(svc.allow_online_search)
        # Gate returns [] and short-circuits before the provider is ever consulted.
        self.assertEqual(svc._maybe_online_search("anything"), [])
        self.assertFalse(provider.called, "provider must NOT be consulted when disabled")

    def test_enabled_consults_provider(self):
        results = [{"title": "X", "snippet": "s", "url": "http://x"}]
        provider = RecordingSearch(results)
        with patch.dict(os.environ, {"ALLOW_ONLINE_SEARCH": "true"}, clear=False):
            svc = self._build(provider)
        self.assertTrue(svc.allow_online_search)
        # Positive control: once explicitly enabled, the provider IS consulted.
        self.assertEqual(svc._maybe_online_search("anything"), results)
        self.assertTrue(provider.called)


class FakeFailingRetrieval:
    """Retrieval whose infrastructure is down: every ``retrieve_top_k`` raises
    ``RetrievalError``, exactly as the real service does when the embedding model
    load or the Chroma search fails. Used to prove an infra failure surfaces as a
    distinguishable RETRIEVAL_SYSTEM_FAILURE — never a fake "no information" and
    never a silent LLM-only answer."""

    def __init__(self):
        self.calls = []

    def retrieve_top_k(self, **kwargs):
        self.calls.append(kwargs)
        raise RetrievalError("simulated retrieval infrastructure failure")


class RetrievalSystemFailureTests(unittest.TestCase):
    """Milestone-1 safety rule: a retrieval-infrastructure failure (Chroma /
    embedding model) MUST be reported as an explicit, distinguishable
    system-failure — never downgraded to LLM_ONLY, never disguised as a genuine
    no-evidence ("no information found") result."""

    def test_retrieval_failure_is_distinguishable_not_llm_not_no_info(self):
        retrieval = FakeFailingRetrieval()
        llm = RecordingLLM()
        with patch.dict(os.environ, {"RAG_WARMUP_ON_INIT": "false"}, clear=False):
            svc = service(None, llm, retrieval=retrieval)
        before_failed = svc.failed_requests

        result = svc.ask_question(
            "What is TCP?", user_id="user-1", pdf_id="pdf-1"
        )
        data = result["data"]

        # Retrieval was actually attempted (truthy user_id) and it failed.
        self.assertTrue(retrieval.calls, "retrieval must be attempted")
        # (1) Distinguishable in diagnostics.
        self.assertEqual(data["mode"], "retrieval_error")
        self.assertEqual(data["answer_source"], "RETRIEVAL_SYSTEM_FAILURE")
        self.assertEqual(data["retrieval_status"], "system_failure")
        # (2) NOT downgraded to an LLM answer: the LLM is never consulted.
        self.assertFalse(data["llm_used"])
        self.assertEqual(len(llm.calls), 0)
        self.assertFalse(data["rag_supported"])
        # (3) NOT disguised as a genuine "no information found" result: it is
        # tagged as PDF-scoped and says the material simply could not be searched.
        self.assertTrue(data["is_from_pdf"])
        self.assertIn("does not mean the material", data["answer"])
        self.assertNotIn("not from your uploaded material", data["answer"])
        # Counted as a failed request for observability.
        self.assertEqual(svc.failed_requests, before_failed + 1)


class PartialBandTests(unittest.TestCase):
    """§7 recall/relevance decoupling: RAG_PARTIAL_SCORE_THRESHOLD lets mid-score,
    on-topic evidence be GROUNDED as a *partial* answer instead of dropped to
    "none" — while defaulting to byte-identical behaviour and never letting a
    below-relevance chunk masquerade as "sufficient". Exercised through
    ``classify_evidence`` directly (deterministic; no end-to-end routing)."""

    MID_CHUNK = {
        "content": "TCP is a reliable connection-oriented transport protocol.",
        "score": 0.30,
        "metadata": {"pdf_id": "pdf-1", "chunk_id": "c1"},
    }

    def _classify(self, extra_env, chunk, question):
        # Pin the relevance bar to 0.5 and construct inside the patched env so
        # __init__ reads the knobs; then classify the chunk directly.
        env = {"RAG_WARMUP_ON_INIT": "false", "RAG_RELEVANCE_THRESHOLD": "0.5"}
        env.update(extra_env)
        with patch.dict(os.environ, env, clear=False):
            svc = service([chunk], RecordingLLM())
            self.assertEqual(svc.relevance_threshold, 0.5)
            return svc, svc.classify_evidence(question, [chunk])

    def test_defaults_to_relevance_so_midscore_is_none(self):
        # Blank knob (as shipped in .env.example) -> partial == relevance, so a
        # 0.30 chunk below the 0.5 relevance bar classifies as "none".
        svc, (level, evidence, score) = self._classify(
            {"RAG_PARTIAL_SCORE_THRESHOLD": ""},
            self.MID_CHUNK,
            "Explain why TCP is reliable.",
        )
        self.assertEqual(svc.partial_relevance_threshold, svc.relevance_threshold)
        self.assertEqual(level, "none")
        self.assertEqual(evidence, [])
        # The chunk WAS seen and graded (proves the gate decided, not empty input).
        self.assertAlmostEqual(score, 0.3, places=4)

    def test_rerank_score_controls_grounding_gate(self):
        chunk = {
            "content": "TCP is a reliable connection-oriented transport protocol.",
            "score": 0.95,
            "metadata": {"pdf_id": "pdf-1", "chunk_id": "c1"},
        }
        with patch.dict(os.environ, {"RAG_WARMUP_ON_INIT": "false", "RAG_RELEVANCE_THRESHOLD": "0.5"}, clear=False):
            svc = RAGService(
                retrieval_service=FakeRetrieval([]),
                hybrid_search=FakeRanker(),
                reranker_service=ScoreSettingReranker(-4.0),
                llm_service=RecordingLLM(),
            )
        level, evidence, score = svc.classify_evidence("Explain TCP.", [dict(chunk, rerank_score=-4.0)])
        self.assertEqual(level, "none")
        self.assertEqual(evidence, [])
        self.assertLess(score, 0.5)

    def test_lowered_knob_grounds_midscore_as_partial(self):
        # Lower the band to 0.2 -> the same 0.30 chunk now grounds as "partial".
        svc, (level, evidence, score) = self._classify(
            {"RAG_PARTIAL_SCORE_THRESHOLD": "0.2"},
            self.MID_CHUNK,
            "Explain why TCP is reliable.",
        )
        self.assertEqual(svc.partial_relevance_threshold, 0.2)
        self.assertEqual(level, "partial")
        self.assertTrue(evidence)
        self.assertLess(score, svc.relevance_threshold)  # still below sufficient

    def test_lowered_knob_never_promotes_belowrelevance_to_sufficient(self):
        # Full term coverage on a simple question would otherwise be "sufficient",
        # but a score below the relevance threshold is capped at "partial" so the
        # sufficient bar stays honest even when the partial band is lowered.
        chunk = {
            "content": "TCP is a transport protocol.",
            "score": 0.40,
            "metadata": {"pdf_id": "pdf-1", "chunk_id": "c1"},
        }
        svc, (level, evidence, score) = self._classify(
            {"RAG_PARTIAL_SCORE_THRESHOLD": "0.2"}, chunk, "TCP"
        )
        self.assertEqual(level, "partial")
        self.assertLess(score, svc.relevance_threshold)


if __name__ == "__main__":
    unittest.main()
