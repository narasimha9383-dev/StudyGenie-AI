"""Dynamic Q&A calibration probe for the RAG retrieval + grounding pipeline.

This is a local diagnostic tool (NOT part of the app request path). It is
*self-configuring*: it discovers whichever PDF is actually indexed in the local
Chroma store from chunk metadata, generates its probe questions from that PDF's
OWN chunk text (via the existing QAGenerator), and measures the retrieval funnel
end to end. There are NO hardcoded user/pdf ids and NO hardcoded question strings,
so the numbers reflect the real material rather than a hand-picked fixture.

What it measures (Task-14 priority order):
    1. retrieval correctness  - retrieve_top_k returns candidates
    2. pdf scoping correctness - retrieval is scoped to the discovered pdf/user
    3. grounding correctness   - classify_evidence level (sufficient/partial/none)
    4. model-init cost         - first-call retrieve latency (cold if warmup off)
    5. LLM generation cost     - only with --full (real ask_question answers)

By default it runs a fast RETRIEVAL-ONLY pass (no answer LLM), so the retrieval
layer can be calibrated in seconds even without the llama server running. Pass
--full to additionally time the real end-to-end ask_question answers.

Output is metrics only: durations, counts, scores, evidence levels. It NEVER
prints PDF text, chunk bodies, secrets, or full ids (ids are masked to a prefix).
Generated question text is shown only with the opt-in --show-questions flag.

Usage:
    cd C:\\java\\studygenie-ai\\studygenie-ai\\backend
    .venv\\Scripts\\python.exe ai\\_calibrate_qa.py [count] [--pdf ID] [--count N] [--full] [--show-questions]

Exit codes: 0 = ran, grounded>0 | 2 = empty store / nothing indexed |
            3 = ran but grounding_rate==0 | 4 = retrieval infrastructure failure.
"""
import argparse
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path

SCRIPT = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT.parents[2]   # C:\java\studygenie-ai\studygenie-ai
BACKEND_ROOT = SCRIPT.parents[1]   # ...\backend

# Resolve ChromaDB's relative ./vector_db/chroma to the SAME store Node uses:
# Node spawns Python with cwd=PROJECT_ROOT, so the store lives at
# PROJECT_ROOT/vector_db/chroma (NOT backend/vector_db/chroma). chdir to match.
os.chdir(PROJECT_ROOT)

for _p in (str(PROJECT_ROOT), str(BACKEND_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)


def _load_env(env_path: Path) -> None:
    """Load backend/.env into os.environ (values only, never printed) so the local
    llama provider + funnel knobs match production. Existing process env wins."""
    if not env_path.exists():
        _eprint(f"[CAL] .env not found at {env_path}; using process env + code defaults")
        return
    for raw in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


# --- calibration knobs (NOT fixtures; no ids, no question text) ---------------
DEFAULT_QUESTION_COUNT = 8       # fast default; the min-20 batch is a ~20-min run
CONTENT_CHAR_BUDGET = 6000       # cap chunk text fed to question generation
METADATA_SCAN_LIMIT = 20000      # cap the metadata enumeration for discovery

# Minimal stopword set for the no-LLM heuristic question fallback only.
_STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was",
    "one", "our", "out", "use", "with", "this", "that", "from", "they", "have",
    "which", "their", "there", "would", "these", "other", "into", "than", "then",
    "them", "such", "also", "been", "were", "when", "what", "where", "how", "why",
    "each", "about", "some", "more", "most", "only", "over", "used", "using", "based",
}


def _eprint(msg: str) -> None:
    print(msg, file=sys.stderr)


def _mask(value) -> str:
    """Mask an id to a short prefix so calibration output never leaks a full id."""
    if value is None or value == "":
        return "(none)"
    s = str(value)
    return (s[:6] + "...") if len(s) > 6 else "***"


def _avg(values) -> float:
    values = list(values)
    return (sum(values) / len(values)) if values else 0.0


def _fmt(value) -> str:
    return f"{value:.2f}" if isinstance(value, (int, float)) else "?"


def _chroma_report() -> None:
    """Best-effort: print resolved chroma dir + per-collection vector counts, to
    prove we hit the populated store and not the empty backend-local one."""
    persist = os.getenv("CHROMA_PERSIST_DIRECTORY", "./vector_db/chroma")
    abspath = Path(persist).resolve()
    _eprint(f"[CAL] chroma_persist={abspath}")
    try:
        import chromadb
        client = chromadb.PersistentClient(path=str(abspath))
        for c in client.list_collections():
            try:
                _eprint(f"[CAL] collection={c.name} count={c.count()}")
            except Exception as exc:  # count may fail on an odd schema; keep going
                _eprint(f"[CAL] collection={c.name} count=? ({exc})")
    except Exception as exc:
        _eprint(f"[CAL] chroma introspection skipped: {exc}")


def discover_pdf(rag, pdf_arg=None):
    """Discover an indexed PDF from Chroma metadata (no hardcoded ids).

    Returns (user_id, pdf_id, chunk_count) for the chosen PDF, or None if the
    store is empty / has no pdf_id metadata. Selection: --pdf if given and present,
    else the pdf_id with the most indexed chunks (maximises question yield)."""
    collection = rag.retrieval_service.vector_store.collection
    got = collection.get(include=["metadatas"], limit=METADATA_SCAN_LIMIT)
    metadatas = got.get("metadatas") or []

    counts = Counter()
    user_for = {}
    for m in metadatas:
        if not isinstance(m, dict):
            continue
        pid = m.get("pdf_id")
        if not pid:
            continue
        counts[pid] += 1
        if pid not in user_for:
            user_for[pid] = m.get("user_id")

    if not counts:
        return None

    _eprint(f"[CAL] indexed_pdfs={len(counts)} scanned_chunks={sum(counts.values())}")

    if pdf_arg:
        if pdf_arg not in counts:
            _eprint(f"[CAL] requested --pdf {_mask(pdf_arg)} not found among indexed pdfs")
            return None
        pid = pdf_arg
    else:
        pid = counts.most_common(1)[0][0]

    return (user_for.get(pid), pid, counts[pid])


def build_content(rag, pdf_id) -> str:
    """Concatenate the PDF's own chunk text (bounded) to feed question generation.
    The returned text is used in-memory only and is never printed.

    We read chunk documents directly from the collection with include=["documents"]
    (no embeddings). The existing vector_store.get_documents_by_pdf() helper also
    pulls embeddings, which the installed Chroma returns as numpy arrays that break
    its `result.get("embeddings") or []` guard (ValueError: truth value ambiguous).
    Since we only need the text, requesting documents-only sidesteps that owned-file
    bug without modifying it."""
    collection = rag.retrieval_service.vector_store.collection
    got = collection.get(where={"pdf_id": str(pdf_id)}, include=["documents"])
    documents = got.get("documents") or []
    parts = []
    total = 0
    for c in documents:
        if not isinstance(c, str):
            c = str(c)
        c = c.strip()
        if not c:
            continue
        parts.append(c)
        total += len(c)
        if total >= CONTENT_CHAR_BUDGET:
            break
    return "\n\n".join(parts)[:CONTENT_CHAR_BUDGET]


def heuristic_questions(content: str, count: int):
    """No-LLM fallback: build probe questions from the document's OWN most frequent
    salient terms (still document-derived, not predefined). Used only when the LLM
    question generator is unavailable, so the retrieval layer stays calibratable."""
    words = re.findall(r"[a-zA-Z][a-zA-Z\-]{3,}", content.lower())
    freq = Counter(w for w in words if w not in _STOPWORDS)
    questions = []
    for term, _ in freq.most_common(count * 3):
        questions.append(f"Explain {term} as discussed in the material.")
        if len(questions) >= count:
            break
    return questions


def make_questions(content: str, count: int):
    """Generate probe questions from the PDF's own text. Prefers the existing
    QAGenerator (LLM-backed, on-topic); falls back to a labelled heuristic set if
    the LLM is unavailable or returns nothing. Returns (questions, source)."""
    if not content.strip():
        return [], "empty"
    try:
        from ai.generation.qa_generator import QAGenerator
        raw = QAGenerator().generate_questions(content, count)
        questions = [q for q in (raw or []) if isinstance(q, str) and q.strip()]
        if questions:
            return questions[:count], "qa_generator"
        _eprint("[CAL] QAGenerator returned no questions; using heuristic fallback")
    except Exception as exc:
        _eprint(f"[CAL] QAGenerator unavailable ({type(exc).__name__}); using heuristic fallback")
    return heuristic_questions(content, count), "heuristic"


def retrieval_pass(rag, questions, user_id, pdf_id, show_questions):
    """Fast pass: per-question retrieve_top_k(timings) + classify_evidence. No answer
    LLM. Returns (rows, infra_failed). infra_failed=True aborts on RetrievalError so
    an infrastructure failure is never silently reported as '0 grounded'."""
    from ai.retrieval.retrieval_service import RetrievalError

    rows = []
    for i, q in enumerate(questions, start=1):
        timings = {}
        t0 = time.perf_counter()
        try:
            chunks = rag.retrieval_service.retrieve_top_k(
                q, user_id=user_id, pdf_id=pdf_id, timings=timings,
            )
        except RetrievalError as exc:
            _eprint(f"[CAL] Q{i} RETRIEVAL INFRA FAILURE: {type(exc).__name__}")
            return rows, True
        wall = (time.perf_counter() - t0) * 1000

        level, _evidence, score = rag.classify_evidence(q, chunks)
        grounded = level != "none"
        row = {
            "retrieved": len(chunks),
            "best_score": float(score),
            "level": level,
            "grounded": grounded,
            "embedding_ms": timings.get("embedding_ms"),
            "chroma_ms": timings.get("chroma_ms"),
            "wall_ms": wall,
        }
        rows.append(row)
        qtext = f" q={q!r}" if show_questions else ""
        _eprint(
            f"[CAL] Q{i} retrieved={row['retrieved']} best_score={row['best_score']:.3f} "
            f"level={level} grounded={grounded} embedding_ms={_fmt(row['embedding_ms'])} "
            f"chroma_ms={_fmt(row['chroma_ms'])} wall_ms={wall:.0f}{qtext}"
        )
    return rows, False


def full_pass(rag, questions, user_id, pdf_id, max_tokens, show_questions):
    """Optional pass: real end-to-end ask_question answers (question_type=10_mark),
    to time LLM generation and cross-check grounding. Requires the answer model."""
    rows = []
    for i, q in enumerate(questions, start=1):
        t0 = time.perf_counter()
        try:
            res = rag.ask_question(
                q, user_id=user_id, pdf_id=pdf_id,
                question_type="10_mark", max_answer_tokens=max_tokens,
            )
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000
            _eprint(f"[CAL] Q{i} FULL EXCEPTION after {ms:.0f}ms: {type(exc).__name__}: {exc}")
            rows.append({"ms": ms, "ok": False, "grounded": False})
            continue
        ms = (time.perf_counter() - t0) * 1000
        if isinstance(res, dict) and res.get("success"):
            data = res.get("data") or {}
        elif isinstance(res, dict):
            data = res
        else:
            data = {}
        answer = str(data.get("answer") or "")
        grounded = bool(data.get("rag_supported"))
        rows.append({"ms": ms, "ok": bool(answer), "grounded": grounded})
        qtext = f" q={q!r}" if show_questions else ""
        _eprint(
            f"[CAL] Q{i} FULL ms={ms:.0f} grounded={grounded} mode={data.get('mode')} "
            f"llm_used={data.get('llm_used')} answer_chars={len(answer)}{qtext}"
        )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Dynamic RAG Q&A calibration probe.")
    parser.add_argument("count_pos", nargs="?", type=int, default=None,
                        help="number of probe questions (back-compat positional)")
    parser.add_argument("--pdf", default=None,
                        help="specific pdf_id to calibrate (default: auto-pick most-indexed)")
    parser.add_argument("--count", type=int, default=None,
                        help=f"number of probe questions (default {DEFAULT_QUESTION_COUNT})")
    parser.add_argument("--full", action="store_true",
                        help="also run the real end-to-end ask_question LLM answers")
    parser.add_argument("--show-questions", action="store_true",
                        help="print generated question text (off by default)")
    args = parser.parse_args()

    count = args.count or args.count_pos or DEFAULT_QUESTION_COUNT
    count = max(1, count)

    # Load backend/.env first so the local-llm provider, funnel knobs, and
    # CHROMA_PERSIST_DIRECTORY match production before we open the store / build RAGService.
    _load_env(BACKEND_ROOT / ".env")
    _eprint(f"[CAL] project_root={PROJECT_ROOT}")
    _eprint(f"[CAL] local_llm_enabled={os.getenv('LOCAL_LLM_ENABLED')} base={os.getenv('LOCAL_LLM_BASE_URL')}")
    _chroma_report()

    from ai.generation.rag_service import RAGService
    rag = RAGService()
    _eprint(f"[CAL] warmup_on_init={os.getenv('RAG_WARMUP_ON_INIT', 'true')}")

    disc = discover_pdf(rag, args.pdf)
    if disc is None:
        _eprint("[CAL] EMPTY STORE / no indexed pdf discovered -- nothing to calibrate")
        return 2
    user_id, pdf_id, chunk_count = disc
    _eprint(f"[CAL] selected pdf={_mask(pdf_id)} user={_mask(user_id)} chunks={chunk_count}")

    content = build_content(rag, pdf_id)
    if not content.strip():
        _eprint("[CAL] selected pdf has no usable chunk text -- nothing to calibrate")
        return 2

    questions, source = make_questions(content, count)
    if not questions:
        _eprint("[CAL] could not obtain any probe questions (LLM + heuristic both empty)")
        return 2
    _eprint(f"[CAL] questions={len(questions)} source={source}")

    overall = time.perf_counter()
    rows, infra_failed = retrieval_pass(rag, questions, user_id, pdf_id, args.show_questions)
    if infra_failed:
        _eprint("[CAL] ===== ABORTED: retrieval infrastructure failure =====")
        return 4

    full_rows = None
    if args.full:
        max_tokens = int(os.getenv("RAG_QA_ANSWER_MAX_TOKENS", "800"))
        full_rows = full_pass(rag, questions, user_id, pdf_id, max_tokens, args.show_questions)
    total_ms = (time.perf_counter() - overall) * 1000

    grounded = [r for r in rows if r["grounded"]]
    scores = [r["best_score"] for r in rows]
    retrieved = [r["retrieved"] for r in rows]
    emb = [r["embedding_ms"] for r in rows if r["embedding_ms"] is not None]
    chrom = [r["chroma_ms"] for r in rows if r["chroma_ms"] is not None]
    first_wall = rows[0]["wall_ms"]
    rest_wall = [r["wall_ms"] for r in rows[1:]]

    _eprint("[CAL] ===== SUMMARY =====")
    _eprint(f"[CAL] pdf={_mask(pdf_id)} chunks={chunk_count} questions={len(rows)} question_source={source}")
    _eprint(f"[CAL] retrieved avg={_avg(retrieved):.1f} min={min(retrieved)} max={max(retrieved)}")
    _eprint(f"[CAL] best_score avg={_avg(scores):.3f} min={min(scores):.3f} max={max(scores):.3f}")
    rate = len(grounded) / len(rows) if rows else 0.0
    _eprint(f"[CAL] grounded={len(grounded)}/{len(rows)} grounding_rate={rate * 100:.0f}%")
    if emb:
        _eprint(f"[CAL] embedding_ms avg={_avg(emb):.2f}")
    if chrom:
        _eprint(f"[CAL] chroma_ms avg={_avg(chrom):.2f}")
    _eprint(f"[CAL] retrieve_wall_ms first={first_wall:.0f} rest_avg={_avg(rest_wall):.0f} "
            f"(first includes any cold model load)")
    if full_rows is not None:
        fg = [r for r in full_rows if r["grounded"]]
        ft = [r["ms"] for r in full_rows]
        if ft:
            _eprint(f"[CAL] FULL grounded={len(fg)}/{len(full_rows)} "
                    f"answer_ms avg={_avg(ft):.0f} min={min(ft):.0f} max={max(ft):.0f}")
    _eprint(f"[CAL] total_ms={total_ms:.0f}")

    return 0 if grounded else 3


if __name__ == "__main__":
    raise SystemExit(main())
