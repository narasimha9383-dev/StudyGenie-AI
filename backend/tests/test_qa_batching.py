from ai.generation.prompt_service import PromptService
from ai.generation.qa_generator import QAGenerator
from ai.generation.response_formatter import ResponseFormatter


def test_qa_batch_prompt_is_compact_and_json_only():
    prompt = PromptService.build_qa_answer_batch_prompt(
        "Context text about photosynthesis.",
        ["What is photosynthesis?", "Why is chlorophyll important?"],
    )

    lowered = prompt.lower()
    assert "return only valid json" in lowered
    assert "do not explain your reasoning" in lowered
    assert "under 100 words" in lowered
    assert "detailed, exam-quality, information-dense" not in lowered


def test_requested_question_count_is_not_forced_to_twenty():
    assert QAGenerator.effective_question_count(1) == 1
    assert QAGenerator.effective_question_count(7) == 7
    assert QAGenerator.effective_question_count(100) == 60


def test_formatter_repairs_only_trailing_json_commas():
    parsed = ResponseFormatter.parse_json(
        '[{"question": "What is TCP?", "answer": "A protocol",}]'
    )
    assert parsed[0]["answer"] == "A protocol"

    # A comma-like sequence inside a JSON string is content, never syntax to
    # repair or silently alter.
    literal = '{"text": "literal,}"}'
    assert ResponseFormatter.parse_json(literal)["text"] == "literal,}"
