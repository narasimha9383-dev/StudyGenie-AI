import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]

for path in (PROJECT_ROOT, BACKEND_ROOT):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


def _normalise_result(result: Any) -> Dict[str, Any]:
    """Return the stable shape consumed by the Node chat service.

    RAGService uses the formatter's ``success/data`` envelope internally,
    while the Express bridge historically expects ``answer`` at the top
    level. Normalising at this process boundary keeps both APIs compatible.
    """
    if isinstance(result, dict) and result.get("success") is True:
        payload = result.get("data")
        if isinstance(payload, dict):
            return payload

    if isinstance(result, dict) and result.get("success") is False:
        message = result.get("error")
        return {
            "answer": "I couldn't generate an answer from the uploaded material.",
            "sources": [],
            "error_code": "AI_RESPONSE_FAILED",
            "error": str(message) if message else "AI response failed",
        }

    if isinstance(result, dict):
        return result

    return {
        "answer": "AI response unavailable.",
        "sources": [],
        "error_code": "AI_INVALID_RESPONSE",
    }


_SUPPORT_STOP_WORDS = {
    "about", "according", "answer", "answers", "below", "describe",
    "does", "explain", "following", "from", "important", "material",
    "please", "question", "questions", "study", "that", "the", "their",
    "these", "this", "those", "what", "when", "where", "which", "who",
    "with", "write", "would", "your",
}


def _support_terms(value: Any) -> set[str]:
    """Return distinctive, exact-match terms for conservative grounding checks."""
    return {
        term
        for term in re.findall(r"[a-z0-9]{4,}", str(value or "").lower())
        if term not in _SUPPORT_STOP_WORDS
    }


def _all_source_terms(
    chunks: list[Dict[str, Any]],
    fallback_content: str = "",
) -> set[str]:
    text = " ".join(
        str(chunk.get("text") or chunk.get("content") or "")
        for chunk in chunks
        if isinstance(chunk, dict)
    )
    return _support_terms(text or fallback_content)


def _has_source_support(
    value: Any,
    source_terms: set[str],
    minimum_ratio: float = 0.4,
) -> bool:
    """Require several exact source terms instead of trusting model output."""
    terms = _support_terms(value)
    if not terms or not source_terms:
        return False

    matched = len(terms & source_terms)
    minimum_matches = min(2, len(terms))
    return (
        matched >= minimum_matches
        and (matched / len(terms)) >= minimum_ratio
    )


def _is_source_supported(
    item: Dict[str, Any],
    chunks: list[Dict[str, Any]],
    fallback_content: str = "",
    require_question: bool = True,
) -> bool:
    """Reject an item when its answer (or generated question) lacks PDF support."""
    if not isinstance(item, dict):
        return False

    source_terms = _all_source_terms(chunks, fallback_content)
    if not _has_source_support(item.get("answer"), source_terms):
        return False

    if require_question and not _has_source_support(
        item.get("question"), source_terms, minimum_ratio=0.34,
    ):
        return False

    key_points = item.get("key_points") or []
    if isinstance(key_points, list):
        return all(
            _has_source_support(point, source_terms, minimum_ratio=0.34)
            for point in key_points
            if str(point or "").strip()
        )

    return True


def _is_quiz_source_supported(
    item: Dict[str, Any],
    chunks: list[Dict[str, Any]],
    fallback_content: str = "",
) -> bool:
    """Validate every displayed quiz field against the uploaded material."""
    if not isinstance(item, dict):
        return False

    source_terms = _all_source_terms(chunks, fallback_content)
    options = item.get("options")
    explanation = str(item.get("explanation") or "").strip()

    if not isinstance(options, list) or len(options) != 4 or not explanation:
        return False

    return (
        _has_source_support(item.get("question"), source_terms, 0.34)
        and _has_source_support(item.get("answer"), source_terms)
        and _has_source_support(explanation, source_terms, 0.34)
        and all(
            _has_source_support(option, source_terms, 0.34)
            for option in options
        )
    )


def _source_pages(item: Dict[str, Any], chunks: list[Dict[str, Any]]) -> list[int]:
    """Return only pages with exact source-term evidence for an item."""
    evidence_text = " ".join([
        str(item.get("answer") or ""),
        str(item.get("explanation") or ""),
        " ".join(str(point) for point in item.get("key_points") or []),
        str(item.get("question") or ""),
    ])
    terms = _support_terms(evidence_text)
    ranked: list[tuple[int, int]] = []

    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue

        chunk_terms = _support_terms(
            chunk.get("text") or chunk.get("content") or ""
        )
        overlap = len(terms & chunk_terms)
        metadata = chunk.get("metadata") or {}
        page = metadata.get("page_number") or metadata.get("page")

        if not overlap or page is None:
            continue

        try:
            ranked.append((overlap, int(page)))
        except (TypeError, ValueError):
            continue

    return sorted({
        page
        for _, page in sorted(ranked, reverse=True)[:3]
    })


def _source_records(chunks: list[Dict[str, Any]]) -> list[Dict[str, Any]]:
    """Expose only source metadata supplied by ingestion; never invent it."""
    records = []
    seen = set()

    for chunk in chunks:
        metadata = chunk.get("metadata") or {}

        text = str(
            chunk.get("text") or chunk.get("content") or ""
        ).strip()

        if not text:
            continue

        pdf_id = metadata.get("pdf_id") or chunk.get("pdf_id")
        chunk_id = metadata.get("chunk_id") or chunk.get("chunk_id")
        page = metadata.get("page_number") or metadata.get("page")

        key = (
            str(pdf_id),
            str(chunk_id),
            str(page),
            metadata.get("source") or metadata.get("file_name"),
        )

        if key in seen:
            continue

        seen.add(key)

        asset_type = str(
            metadata.get("type")
            or metadata.get("asset_type")
            or "text"
        ).lower()

        records.append({
            "pdf_id": str(pdf_id) if pdf_id is not None else None,
            "chunk_id": str(chunk_id) if chunk_id is not None else None,
            "page_number": page,
            "document_name": (
                metadata.get("source")
                or metadata.get("file_name")
                or metadata.get("title")
            ),
            "source_type": "PDF_RAG",
            "asset_type": asset_type,
            "caption": metadata.get("caption") or None,
        })

        try:
            images = json.loads(
                metadata.get("images_json") or "[]"
            )
        except (TypeError, ValueError, json.JSONDecodeError):
            images = []

        for image in images if isinstance(images, list) else []:
            image_path = (
                image.get("image_path")
                if isinstance(image, dict)
                else None
            )

            image_key = (
                "image",
                image.get("image_id"),
                image_path,
            )

            if not image_path or image_key in seen:
                continue

            seen.add(image_key)

            records.append({
                "pdf_id": str(pdf_id) if pdf_id is not None else None,
                "chunk_id": str(chunk_id) if chunk_id is not None else None,
                "page_number": image.get("page_number") or page,
                "document_name": (
                    metadata.get("source")
                    or metadata.get("title")
                ),
                "source_type": "PDF_RAG",
                "asset_type": image.get("image_type") or "image",
                "caption": (
                    image.get("caption")
                    or metadata.get("caption")
                    or None
                ),
                "image_id": image.get("image_id"),
                "image_path": image_path,
                "width": image.get("width"),
                "height": image.get("height"),
            })

    return records


def _generation_metadata(
    chunks: list[Dict[str, Any]],
    llm_used: bool = True,
) -> Dict[str, Any]:
    sources = _source_records(chunks)

    pages = sorted({
        record["page_number"]
        for record in sources
        if record.get("page_number") is not None
    })

    return {
        "mode": "rag_enriched" if sources and llm_used else "llm_fallback",
        "llm_used": llm_used,
        "rag_supported": bool(sources),
        "rag_complete": False,
        "sources": sources,
        "source_pages": pages,
    }


# ============================================================
# Descriptive Q&A orchestration
# ============================================================

_PLACEHOLDER_MARKERS = (
    "could not generate an answer",
    "could not prepare the question",
    "uploaded study material is empty",
    "insufficient information in the uploaded material",
)


def _qa_answer_max_tokens() -> int:
    """Per-answer token cap for the batch Q&A path."""
    try:
        return max(
            256,
            int(
                os.getenv(
                    "RAG_QA_ANSWER_MAX_TOKENS",
                    "800",
                )
            ),
        )
    except (TypeError, ValueError):
        return 800


def _is_placeholder_answer(text: str) -> bool:
    lowered = str(text or "").strip().lower()

    if not lowered:
        return True

    return any(
        marker in lowered
        for marker in _PLACEHOLDER_MARKERS
    )


def _extract_rag_answer(result: Any) -> str:
    """Return a grounded answer string from a RAGService result, else ""."""
    if not isinstance(result, dict):
        return ""

    data = (
        result.get("data")
        if result.get("success") is True
        else result
    )

    if result.get("success") is False or not isinstance(data, dict):
        return ""

    if data.get("rag_supported") is not True:
        return ""

    answer = str(
        data.get("answer") or ""
    ).strip()

    return (
        ""
        if _is_placeholder_answer(answer)
        else answer
    )


def _make_rag_service(user_id: str | None):
    """Build a RAGService once per generation."""
    if not user_id:
        return None

    try:
        from ai.generation.rag_service import RAGService

        return RAGService()

    except Exception:
        logging.getLogger("StudyGenie.AI").warning(
            "RAGService unavailable; Q&A will answer from bounded content only."
        )
        return None


def _answer_one_question(
    generator,
    rag_service,
    content,
    question,
    source_images,
    user_id,
    pdf_id,
):
    """Answer ONE generated question."""

    answer = ""
    key_points: list = []

    # Primary: RAG
    if rag_service is not None:
        try:
            rag_result = rag_service.ask_question(
                question,
                user_id=user_id,
                pdf_id=pdf_id,
                question_type="10_mark",
                max_answer_tokens=_qa_answer_max_tokens(),
            )

            answer = _extract_rag_answer(rag_result)

        except Exception:
            logging.getLogger("StudyGenie.AI").warning(
                "RAG answering failed for a generated question; using fallback."
            )

    # Fallback: bounded study material
    if not answer:
        single = generator.answer_single(
            content,
            question,
            source_images=source_images,
        )

        candidate = str(
            single.get("answer") or ""
        ).strip()

        if candidate and not _is_placeholder_answer(candidate):
            answer = candidate

            points = single.get("key_points") or []

            if isinstance(points, list):
                key_points = [
                    str(p).strip()
                    for p in points
                    if str(p).strip()
                ]

    if not answer:
        return None

    return {
        "question": question,
        "answer": answer,
        "key_points": key_points,
    }


def _generate_qa_items(
    content,
    chunks,
    requested_count,
    source_questions,
    source_images,
    user_id,
    pdf_id,
):
    """Produce descriptive Q&A items."""

    from ai.generation.qa_generator import QAGenerator

    generator = QAGenerator()

    # --------------------------------------------------------
    # Source-question mode
    # --------------------------------------------------------
    if source_questions:
        items = []
        rejected = 0
        valid_questions = [
            str(item.get("question") or "").strip()
            for item in source_questions
            if isinstance(item, dict)
            and str(item.get("question") or "").strip()
        ]

        batch_size = max(
            1,
            min(
                5,
                int(
                    os.getenv(
                        "QA_ANSWER_BATCH_SIZE",
                        "3",
                    )
                ),
            ),
        )

        for offset in range(
            0,
            len(valid_questions),
            batch_size,
        ):
            batch = valid_questions[
                offset:offset + batch_size
            ]

            try:
                batch_items = (
                    generator.answer_batch(
                        content,
                        batch,
                    )
                    if len(batch) > 1
                    else []
                )
            except Exception as error:
                logging.getLogger("StudyGenie.AI").warning(
                    "Source question batch failed: %s",
                    error,
                )
                batch_items = []

            if not batch_items:
                batch_items = []

                for question in batch:
                    try:
                        item = _answer_one_question(
                            generator,
                            None,
                            content,
                            question,
                            source_images,
                            user_id,
                            pdf_id,
                        )

                        if item is not None:
                            batch_items.append(item)

                    except Exception as error:
                        logging.getLogger("StudyGenie.AI").warning(
                            "Source question failed: %s",
                            error,
                        )

            supported_by_question = {}

            for item in batch_items:
                if not isinstance(item, dict):
                    rejected += 1
                    continue

                item_question = str(item.get("question") or "").strip()
                if _is_source_supported(
                    item,
                    chunks,
                    content,
                    require_question=False,
                ):
                    supported_by_question.setdefault(item_question, item)
                else:
                    rejected += 1

            # Source-question mode preserves every extracted question. If the
            # supplied material cannot support its answer, make that limitation
            # explicit instead of silently inventing or substituting a question.
            for question in batch:
                supported = supported_by_question.get(question)
                items.append(
                    supported
                    if supported is not None
                    else {
                        "question": question,
                        "answer": (
                            "I couldn't find enough information in the provided "
                            "study material to answer that accurately."
                        ),
                        "key_points": [],
                        "rag_supported": False,
                    }
                )

            print(
                f"[QA-PROGRESS] completed={len(items)} "
                f"total={len(valid_questions)}",
                file=sys.stderr,
                flush=True,
            )

        stats = {
            "mode": "source",
            "requested": len(valid_questions),
            "effective": len(valid_questions),
            "generated": len(valid_questions),
            "answered": len(items) - sum(
                1 for item in items if item.get("rag_supported") is False
            ),
            "returned": len(items),
            "rejected": rejected,
            "safe_fallbacks": sum(
                1 for item in items if item.get("rag_supported") is False
            ),
            "batch_size": batch_size,
        }

        return items, stats

    # --------------------------------------------------------
    # Generate-from-material mode
    # --------------------------------------------------------

    effective = QAGenerator.effective_question_count(
        requested_count
    )

    rag_service = _make_rag_service(user_id)

    qgen_ms = 0.0
    answer_ms: list[float] = []

    # Question generation
    _q_start = time.perf_counter()

    questions = generator.generate_questions(
        content,
        effective,
    )

    qgen_ms += (
        time.perf_counter() - _q_start
    ) * 1000

    generated_total = len(questions)

    items: list = []
    seen: set = set()
    rejected = 0
    pending = list(questions)

    max_topup_rounds = 3
    round_index = 0

    batch_size = max(
        2,
        min(
            10,
            int(
                os.getenv(
                    "QA_ANSWER_BATCH_SIZE",
                    "5",
                )
            ),
        ),
    )

    while True:

        if not pending:
            break

        for start in range(
            0,
            len(pending),
            batch_size,
        ):
            batch = pending[
                start:start + batch_size
            ]

            batch_items: list[dict] = []

            # ------------------------------------------------
            # Single question
            # ------------------------------------------------
            if len(batch) == 1:

                question = batch[0]

                key = generator._dedup_key(
                    question
                )

                if key and key in seen:
                    continue

                _a_start = time.perf_counter()

                try:
                    item = _answer_one_question(
                        generator,
                        rag_service,
                        content,
                        question,
                        source_images,
                        user_id,
                        pdf_id,
                    )

                    if item is not None:
                        batch_items = [item]

                except Exception as error:
                    logging.getLogger(
                        "StudyGenie.AI"
                    ).warning(
                        "Failed to answer question: %s",
                        error,
                    )

                answer_ms.append(
                    (
                        time.perf_counter()
                        - _a_start
                    ) * 1000
                )

            # ------------------------------------------------
            # Batch questions
            # ------------------------------------------------
            else:

                batch_questions = [
                    question
                    for question in batch
                    if generator._dedup_key(question)
                ]

                if not batch_questions:
                    continue

                _a_start = time.perf_counter()

                try:
                    batch_result = generator.answer_batch(
                        content,
                        batch_questions,
                    )

                except Exception as error:
                    logging.getLogger(
                        "StudyGenie.AI"
                    ).warning(
                        "Batch answer generation failed: %s. "
                        "Falling back to individual answers.",
                        error,
                    )

                    batch_result = []

                answer_ms.append(
                    (
                        time.perf_counter()
                        - _a_start
                    ) * 1000
                )

                # Batch succeeded
                if batch_result:

                    batch_items = [
                        item
                        for item in batch_result
                        if (
                            isinstance(item, dict)
                            and item.get("answer")
                        )
                    ]

                # Batch failed -> individual fallback
                else:

                    batch_items = []

                    for question in batch_questions:

                        try:
                            _a_start = time.perf_counter()

                            item = _answer_one_question(
                                generator,
                                rag_service,
                                content,
                                question,
                                source_images,
                                user_id,
                                pdf_id,
                            )

                            answer_ms.append(
                                (
                                    time.perf_counter()
                                    - _a_start
                                ) * 1000
                            )

                            if item is not None:
                                batch_items.append(item)

                        except Exception as error:

                            logging.getLogger(
                                "StudyGenie.AI"
                            ).warning(
                                "Failed to answer question: %s",
                                error,
                            )

                            continue

            # ------------------------------------------------
            # Deduplicate + collect
            # ------------------------------------------------
            for item in batch_items:

                question_txt = str(
                    item.get("question") or ""
                ).strip()

                key = generator._dedup_key(
                    question_txt
                )

                if (
                    not question_txt
                    or not key
                    or key in seen
                ):
                    continue

                if not _is_source_supported(item, chunks, content):
                    rejected += 1
                    continue

                seen.add(key)

                items.append(item)

                print(
                    f"[QA-PROGRESS] "
                    f"completed={len(items)} "
                    f"total={effective}",
                    file=sys.stderr,
                    flush=True,
                )

                if len(items) >= effective:
                    break

            if len(items) >= effective:
                break

        # Enough answers
        if (
            len(items) >= effective
            or round_index >= max_topup_rounds
        ):
            break

        # ----------------------------------------------------
        # Top-up question generation
        # ----------------------------------------------------

        round_index += 1

        answered_questions = [
            item["question"]
            for item in items
        ]

        _q_start = time.perf_counter()

        pending = generator.generate_questions(
            content,
            effective - len(items),
            avoid=answered_questions + questions,
        )

        qgen_ms += (
            time.perf_counter() - _q_start
        ) * 1000

        generated_total += len(pending)

        if not pending:
            break

    if not items:
        raise RuntimeError(
            "No source-supported question-answer pairs could be generated "
            "from the uploaded material."
        )

    # Return fewer items when needed; never pad an output with made-up Q&A.
    items = items[:effective]

    stats = {
        "mode": "material",
        "requested": requested_count,
        "effective": effective,
        "generated": generated_total,
        "answered": len(items),
        "returned": len(items),
        "rejected": rejected,
        "target_met": len(items) >= effective,
        "question_generation_ms": int(qgen_ms),
        "answer_attempts": len(answer_ms),
        "answer_total_ms": int(sum(answer_ms)),
        "answer_avg_ms": (
            int(sum(answer_ms) / len(answer_ms))
            if answer_ms
            else 0
        ),
        "answer_min_ms": (
            int(min(answer_ms))
            if answer_ms
            else 0
        ),
        "answer_max_ms": (
            int(max(answer_ms))
            if answer_ms
            else 0
        ),
    }

    return items, stats


def _generate_materials() -> None:

    from ai.generation.notes_generator import NotesGenerator
    from ai.generation.quiz_generator import QuizGenerator

    started = time.perf_counter()

    timings: Dict[str, int] = {}

    content = ""
    chunks: list[Dict[str, Any]] = []

    generation_type = "qa"

    def _elapsed_ms(since: float) -> int:
        return int(
            (
                time.perf_counter()
                - since
            ) * 1000
        )

    def _log_timing() -> None:

        parts = [
            f"generation_type={generation_type}",
            f"content_chars={len(content)}",
            f"chunk_count={len(chunks)}",
        ]

        parts += [
            f"{name}_ms={value}"
            for name, value in timings.items()
        ]

        parts.append(
            f"total_ms={_elapsed_ms(started)}"
        )

        print(
            "[NOTES] " + " ".join(parts),
            file=sys.stderr,
            flush=True,
        )

    try:

        payload = json.load(sys.stdin)

        if not isinstance(payload, dict):
            raise ValueError(
                "Generation payload must be an object."
            )

        content = str(
            payload.get("content") or ""
        ).strip()

        chunks = payload.get("chunks") or []

        generation_type = str(
            payload.get("generationType") or "qa"
        ).strip().lower()

        source_questions = [
            item
            for item in (payload.get("sourceQuestions") or [])
            if isinstance(item, dict)
            and str(item.get("question") or "").strip()
        ]

        source_images = (
            payload.get("sourceImages") or []
        )

        requested_count = payload.get("count")

        user_id = (
            payload.get("userId")
            or payload.get("user_id")
        )

        pdf_id = (
            payload.get("pdfId")
            or payload.get("pdf_id")
        )

        if not content:
            raise ValueError(
                "PDF content is empty."
            )

        # ----------------------------------------------------
        # Q&A
        # ----------------------------------------------------

        if generation_type == "qa":

            qa_started = time.perf_counter()

            qa_items, qa_stats = _generate_qa_items(
                content,
                chunks,
                requested_count,
                source_questions,
                source_images,
                user_id,
                pdf_id,
            )

            timings["qa_llm"] = _elapsed_ms(
                qa_started
            )

            print(
                "[PDF-PERF] "
                + " ".join([
                    "stage=qa",
                    f"question_generation_ms="
                    f"{qa_stats.get('question_generation_ms', 0)}",
                    f"answers={qa_stats.get('answered', 0)}",
                    f"answer_attempts="
                    f"{qa_stats.get('answer_attempts', 0)}",
                    f"answer_total_ms="
                    f"{qa_stats.get('answer_total_ms', 0)}",
                    f"answer_avg_ms="
                    f"{qa_stats.get('answer_avg_ms', 0)}",
                    f"answer_min_ms="
                    f"{qa_stats.get('answer_min_ms', 0)}",
                    f"answer_max_ms="
                    f"{qa_stats.get('answer_max_ms', 0)}",
                    f"qa_total_ms="
                    f"{timings['qa_llm']}",
                ]),
                file=sys.stderr,
                flush=True,
            )

            for index, item in enumerate(
                qa_items,
                start=1,
            ):

                item["question_number"] = index

                source_question = (
                    source_questions[index - 1]
                    if index <= len(source_questions)
                    else {}
                )

                if source_question.get("question"):
                    item["question"] = (
                        source_question["question"]
                    )

                item["source_pages"] = (
                    [source_question["sourcePage"]]
                    if source_question.get("sourcePage")
                    else _source_pages(
                        item,
                        chunks,
                    )
                )

            print(
                "[QA] "
                + " ".join(
                    f"{name}={qa_stats.get(name)}"
                    for name in (
                        "mode",
                        "requested",
                        "effective",
                        "generated",
                        "answered",
                        "returned",
                    )
                ),
                file=sys.stderr,
                flush=True,
            )

            print(
                json.dumps({
                    "success": True,
                    "generationType": "qa",
                    "notes": None,
                    "questions": qa_items,
                    "source_pages": sorted({
                        page
                        for item in qa_items
                        for page in item["source_pages"]
                    }),
                    **_generation_metadata(chunks),
                })
            )

            return

        # ----------------------------------------------------
        # Notes
        # ----------------------------------------------------

        if generation_type == "notes":

            notes_started = time.perf_counter()
            notes_result = NotesGenerator().generate(content)
            timings["notes_llm"] = _elapsed_ms(notes_started)

            if not notes_result.get("success"):
                raise RuntimeError(
                    notes_result.get("error")
                    or "Notes generation failed."
                )

            print(
                json.dumps({
                    "success": True,
                    "generationType": "notes",
                    "notes": notes_result.get("data"),
                    "questions": [],
                    **_generation_metadata(chunks),
                })
            )

            return

        # ----------------------------------------------------
        # Quiz
        # ----------------------------------------------------

        difficulty_counts = (
            payload.get("difficulty_counts")
            or {
                "Easy": 5,
                "Medium": 5,
                "Hard": 5,
            }
        )

        questions = []
        question_number = 1

        for difficulty in (
            "Easy",
            "Medium",
            "Hard",
        ):

            count = max(
                0,
                min(
                    int(
                        difficulty_counts.get(
                            difficulty,
                            0,
                        )
                    ),
                    20,
                ),
            )

            if not count:
                continue

            quiz_started = time.perf_counter()

            quiz_result = QuizGenerator().generate(
                content,
                count=count,
                difficulty=difficulty,
            )

            timings[
                f"quiz_{difficulty.lower()}"
            ] = _elapsed_ms(
                quiz_started
            )

            if not quiz_result.get("success"):
                raise RuntimeError(
                    quiz_result.get("error")
                    or f"{difficulty} question generation failed."
                )

            for item in (
                quiz_result.get("data") or []
            ):
                answer = item.get(
                    "answer",
                    "",
                )

                options = (
                    item.get("options")
                    or []
                )

                if (
                    isinstance(answer, str)
                    and len(answer) == 1
                    and answer.upper() in "ABCD"
                ):

                    option_index = (
                        ord(answer.upper())
                        - ord("A")
                    )

                    if option_index < len(options):
                        answer = options[
                            option_index
                        ]

                validated_item = {
                    **item,
                    "answer": answer,
                    "options": options,
                }

                if not _is_quiz_source_supported(
                    validated_item,
                    chunks,
                    content,
                ):
                    continue

                pages = _source_pages(
                    validated_item,
                    chunks,
                )

                if not pages:
                    continue

                questions.append({
                    "question_number": question_number,
                    "question": str(
                        item.get("question")
                        or ""
                    ).strip(),
                    "answer": str(
                        answer or ""
                    ).strip(),
                    "explanation": str(
                        item.get("explanation")
                        or ""
                    ).strip(),
                    "difficulty": difficulty.lower(),
                    "source_pages": pages,
                    "options": options,
                })

                question_number += 1

        if not questions:
            raise RuntimeError(
                "No source-supported multiple-choice questions could be "
                "generated from the uploaded material."
            )

        print(
            json.dumps({
                "success": True,
                "generationType": "quiz",
                "notes": None,
                "questions": questions,
                "source_pages": sorted({
                    page
                    for item in questions
                    for page in item["source_pages"]
                }),
                **_generation_metadata(chunks),
            })
        )

    finally:
        _log_timing()


def main() -> None:

    args = sys.argv[1:]

    # --------------------------------------------------------
    # Persistent answer worker
    # --------------------------------------------------------

    if args and args[0] == "--answer-worker":

        from ai.generation.rag_service import RAGService

        service = RAGService()

        for line in sys.stdin:

            request_id = None

            try:

                payload = json.loads(line)

                request_id = payload.get("id")

                result = _normalise_result(
                    service.ask_question(
                        str(
                            payload.get("question")
                            or ""
                        ).strip(),
                        user_id=payload.get(
                            "userId"
                        ),
                        pdf_id=payload.get(
                            "pdfId"
                        ),
                        question_type=payload.get(
                            "questionType"
                        ),
                        conversation_history=payload.get(
                            "conversationHistory"
                        ),
                    )
                )

                response = {
                    "id": request_id,
                    "result": result,
                }

            except Exception as error:

                logging.getLogger(
                    "StudyGenie.AI"
                ).exception(
                    "Persistent answer worker request failed"
                )

                response = {
                    "id": request_id,
                    "error": str(error),
                    "error_code": "AI_WORKER_REQUEST_FAILED",
                }

            print(
                json.dumps(response),
                flush=True,
            )

        return

    # --------------------------------------------------------
    # Normalize query
    # --------------------------------------------------------

    if args and args[0] == "--normalize-query":

        try:

            from ai.generation.query_input import (
                QueryInputError,
                resolve_query,
            )

            payload = json.load(
                sys.stdin
            )

            print(
                json.dumps({
                    "success": True,
                    "query": resolve_query(payload),
                })
            )

        except Exception as error:

            from ai.generation.query_input import (
                QueryInputError,
            )

            if isinstance(
                error,
                QueryInputError,
            ):

                print(
                    json.dumps({
                        "success": False,
                        "error": str(error),
                        "error_code": "QUERY_INPUT_INVALID",
                    })
                )

            else:

                logging.getLogger(
                    "StudyGenie.AI"
                ).exception(
                    "Query normalization failed"
                )

                print(
                    json.dumps({
                        "success": False,
                        "error": "Could not process the query input.",
                        "error_code": "QUERY_INPUT_FAILED",
                    })
                )

            raise SystemExit(1)

        return

    # --------------------------------------------------------
    # Extract figures
    # --------------------------------------------------------

    if args and args[0] == "--extract-figures":

        try:

            from ai.ingestion.figure_extractor import (
                figure_extractor,
            )

            payload = json.load(
                sys.stdin
            )

            result = figure_extractor.extract_result(
                payload.get("file_path"),
                (
                    str(payload.get("pdf_id"))
                    if payload.get("pdf_id") is not None
                    else None
                ),
            )

            print(
                json.dumps({
                    "success": True,
                    "figures": [
                        item.to_dict()
                        for item in result.figures
                    ],
                    "diagnostics": {
                        "image_extraction_count":
                            result.accepted,
                        "image_detected_count":
                            result.discovered,
                        "image_failed_count":
                            result.rejected,
                        "cache_hit":
                            result.cache_hit,
                    },
                })
            )

        except Exception as error:

            logging.getLogger(
                "StudyGenie.AI"
            ).exception(
                "Figure extraction failed"
            )

            print(
                json.dumps({
                    "success": False,
                    "error": str(error),
                })
            )

            raise SystemExit(1)

        return

    # --------------------------------------------------------
    # Generate materials
    # --------------------------------------------------------

    if args and args[0] == "--generate-materials":

        try:

            _generate_materials()

        except Exception as error:

            logging.getLogger(
                "StudyGenie.AI"
            ).exception(
                "Material generation failed"
            )

            print(
                json.dumps({
                    "success": False,
                    "error": str(error),
                })
            )

            raise SystemExit(1)

        return

    # --------------------------------------------------------
    # Index chunks
    # --------------------------------------------------------

    if args and args[0] == "--index-chunks":

        try:

            from ai.retrieval.retrieval_service import (
                RetrievalService,
            )

            chunks = json.load(
                sys.stdin
            )

            if not isinstance(
                chunks,
                list,
            ):
                raise ValueError(
                    "Chunk payload must be a list."
                )

            if chunks:

                pdf_ids = {
                    str(chunk.get("pdf_id"))
                    for chunk in chunks
                    if chunk.get("pdf_id")
                }

                service = RetrievalService()

                for pdf_id in pdf_ids:
                    service.delete_by_pdf(
                        pdf_id
                    )

                service.add_chunks(
                    chunks
                )

            print(
                json.dumps({
                    "success": True,
                    "indexed": len(chunks),
                })
            )

        except Exception as error:

            logging.getLogger(
                "StudyGenie.AI"
            ).exception(
                "Chroma indexing failed"
            )

            print(
                json.dumps({
                    "success": False,
                    "error": str(error),
                })
            )

            raise SystemExit(1)

        return

    # --------------------------------------------------------
    # Normal RAG question mode
    # --------------------------------------------------------

    user_id = None
    pdf_id = None
    question_type = None
    conversation_history = None

    question_parts = []
    index = 0

    while index < len(args):

        if (
            args[index] == "--user-id"
            and index + 1 < len(args)
        ):

            user_id = args[index + 1]
            index += 2
            continue

        if (
            args[index] == "--pdf-id"
            and index + 1 < len(args)
        ):

            pdf_id = args[index + 1]
            index += 2
            continue

        if (
            args[index] == "--question-type"
            and index + 1 < len(args)
        ):

            question_type = args[index + 1]
            index += 2
            continue

        if (
            args[index] == "--conversation-history"
            and index + 1 < len(args)
        ):

            try:
                parsed_history = json.loads(args[index + 1])
                conversation_history = (
                    parsed_history
                    if isinstance(parsed_history, list)
                    else None
                )
            except (TypeError, ValueError, json.JSONDecodeError):
                conversation_history = None

            index += 2
            continue

        question_parts.append(
            args[index]
        )

        index += 1

    question = " ".join(
        question_parts
    ).strip()

    if not question:

        print(
            json.dumps({
                "answer": "Please provide a question.",
                "sources": [],
            })
        )

        return

    try:

        from ai.generation.rag_service import (
            RAGService,
        )

        service = RAGService()

        result = _normalise_result(
            service.ask_question(
                question,
                user_id=user_id,
                pdf_id=pdf_id,
                question_type=question_type,
                conversation_history=conversation_history,
            )
        )

    except Exception:

        logging.getLogger(
            "StudyGenie.AI"
        ).exception(
            "RAG request failed"
        )

        result = {
            "answer": (
                "AI service unavailable. "
                "Check the AI environment configuration "
                "and try again."
            ),
            "sources": [],
            "error_code": "AI_SERVICE_UNAVAILABLE",
        }

    print(
        json.dumps(result)
    )


if __name__ == "__main__":
    main()
