"""
============================================================
StudyGenie AI - Enhanced Production Chunking Engine
------------------------------------------------------------
Author : StudyGenie AI Engineering
============================================================
"""

from __future__ import annotations
import hashlib
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
 # Optional, will fallback if not installed
# Optional Tiktoken import with fallback
try:
    import tiktoken
    TIKTOKEN_AVAILABLE = True
except ImportError:
    TIKTOKEN_AVAILABLE = False

logger = logging.getLogger("ChunkService")


class EnhancedChunkService:
    """
    Production RAG Chunking Engine with exact tokenization, structural typing,
    visual metadata propagation, and bi-directional chunk linking.
    """

    DEFAULT_CONFIG: Dict[str, Any] = {
        "strategy": "RecursiveCharacterTextSplitter",
        "chunk_size": 500,        # Target tokens per chunk
        "chunk_overlap": 100,     # Token overlap window
        "min_chunk_size": 100,    # Minimum token threshold before merging
        "max_chunk_size": 800,    # Maximum token ceiling before forced split
        "tokenizer_model": "cl100k_base",  # Tiktoken encoding family
        "separators": ["\n\n", "\n", ". ", "? ", "! ", " ", ""]
    }

    MAX_CHUNK_METADATA_BYTES = 4000  # 4 KB metadata ceiling for vector DBs

    # --------------------------------------------------------
    # 1. Exact Token Estimation
    # --------------------------------------------------------

    @classmethod
    def estimate_tokens(cls, text: str, model_encoding: str = "cl100k_base") -> int:
        """
        Calculates exact token counts via tiktoken if available,
        falling back to word multiplier (~1.3 tokens/word).
        """
        if not text:
            return 0

        if TIKTOKEN_AVAILABLE:
            try:
                encoding = tiktoken.get_encoding(model_encoding)
                return len(encoding.encode(text))
            except Exception as err:
                logger.debug("Tiktoken encoding error, using heuristic fallback: %s", err)

        # Fallback estimation heuristic
        words = len(text.split())
        return int(words * 1.3)

    # --------------------------------------------------------
    # 2. Block Masking & Content Type Detection
    # --------------------------------------------------------

    @classmethod
    def _mask_protected_blocks(cls, text: str) -> Tuple[str, Dict[str, Dict[str, str]]]:
        """
        Replaces protected blocks with unique keys and catalogs their dynamic type.
        """
        block_store: Dict[str, Dict[str, str]] = {}

        # Protect Fenced Code Blocks
        def replace_code(match: re.Match) -> str:
            key = f"__STUDYGENIE_PROTECTED_CODE_{len(block_store)}__"
            block_store[key] = {"content": match.group(0), "type": "code"}
            return key

        text = re.sub(r'```[\s\S]*?```', replace_code, text)

        # Protect Block Formulas ($$...$$)
        def replace_math(match: re.Match) -> str:
            key = f"__STUDYGENIE_PROTECTED_MATH_{len(block_store)}__"
            block_store[key] = {"content": match.group(0), "type": "formula"}
            return key

        text = re.sub(r'\$\$[\s\S]*?\$\$', replace_math, text)

        # Protect Tables
        def replace_table(match: re.Match) -> str:
            key = f"__STUDYGENIE_PROTECTED_TABLE_{len(block_store)}__"
            block_store[key] = {"content": match.group(0), "type": "table"}
            return key

        text = re.sub(r'(?:^\|.*\|\n?)+', replace_table, text, flags=re.MULTILINE)

        return text, block_store

    @staticmethod
    def _unmask_protected_blocks(text: str, block_store: Dict[str, Dict[str, str]]) -> Tuple[str, str]:
        """
        Restores protected block content and determines primary content classification.
        """
        primary_type = "text"
        for key, info in block_store.items():
            if key in text:
                text = text.replace(key, info["content"])
                if primary_type == "text":
                    primary_type = info["type"]
        return text, primary_type

    # --------------------------------------------------------
    # 3. Enhanced Structure Detection
    # --------------------------------------------------------

    @staticmethod
    def detect_section_title(text: str, default: str = "Main Body") -> str:
        """
        Extracts document headers supporting Markdown, ALL-CAPS, and numbering.
        """
        if not text:
            return default

        lines = [line.strip() for line in text.split("\n") if line.strip()]
        if not lines:
            return default

        first_line = lines[0]

        # Markdown Headers (# Header)
        if first_line.startswith("#"):
            return re.sub(r'^#+\s*', '', first_line)[:100].strip()

        # Chapter/Section patterns, numbers, Roman numerals
        match = re.match(
            r'^(?:chapter|section|part|[IVXLCDM]+\.|\d+(\.\d+)*)\s*[:.-]?\s*(.*)$',
            first_line,
            re.IGNORECASE
        )
        if match:
            return first_line[:100].strip()

        # ALL CAPS titles
        if len(first_line) > 3 and first_line.isupper() and len(first_line) < 80:
            return first_line[:100].strip()

        # Short Title Case
        if len(first_line) < 80 and first_line.istitle():
            return first_line[:100].strip()

        return default

    @staticmethod
    def calculate_chunk_hash(text: str) -> str:
        """Generates a unique SHA-256 string for duplicate identification."""
        cleaned = re.sub(r'\s+', ' ', text.strip()).encode("utf-8")
        return hashlib.sha256(cleaned).hexdigest()

    # --------------------------------------------------------
    # 4. Orchestrator API
    # --------------------------------------------------------

    @classmethod
    def create_chunks_from_pages(
        cls,
        pages: List[Dict[str, Any]],
        pdf_id: str,
        user_id: str,
        file_name: str,
        config: Optional[Dict[str, Any]] = None
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Transforms raw extracted pages into structured chunks with links and visual metadata.
        """
        cfg = {**cls.DEFAULT_CONFIG, **(config or {})}
        raw_payloads: List[Dict[str, Any]] = []
        seen_hashes = set()
        duplicate_count = 0
        total_tokens = 0

        for page in pages:
            raw_text = page.get("cleaned_text") or page.get("raw_text") or ""
            if not raw_text or len(raw_text.strip()) < 10:
                continue

            page_num = page.get("source", {}).get("page_number") or page.get("page", 1)
            section = cls.detect_section_title(raw_text)

            # Extract visual indicators from input page object
            visual_metadata = {
                "has_images": page.get("has_images", False),
                "image_count": page.get("image_count", 0),
                "has_diagrams": page.get("has_diagrams", False)
            }

            # Mask Code, Formulas, and Tables
            masked_text, block_store = cls._mask_protected_blocks(raw_text)

            # Perform Recursive Splitting (Internal logic retained)
            raw_splits = cls._recursive_split_internal(
                text=masked_text,
                chunk_size_tokens=cfg["chunk_size"],
                overlap_tokens=cfg["chunk_overlap"],
                separators=cfg["separators"],
                model_encoding=cfg["tokenizer_model"]
            )

            # Unmask and classify chunk type
            processed_splits = []
            for s in raw_splits:
                unmasked_text, content_type = cls._unmask_protected_blocks(s, block_store)
                processed_splits.append((unmasked_text, content_type))

            # Package records
            char_cursor = 0
            for idx, (text_block, content_type) in enumerate(processed_splits):
                chunk_hash = cls.calculate_chunk_hash(text_block)

                if chunk_hash in seen_hashes:
                    duplicate_count += 1
                    continue
                seen_hashes.add(chunk_hash)

                chunk_id = f"{pdf_id}_p{page_num:03d}_c{idx+1:03d}"
                tokens = cls.estimate_tokens(text_block, cfg["tokenizer_model"])
                total_tokens += tokens
                start_char = char_cursor
                end_char = start_char + len(text_block)

                chunk_record = {
                    "chunk_id": chunk_id,
                    "pdf_id": pdf_id,
                    "chunk_hash": chunk_hash,
                    "text": text_block,
                    "chunk_type": content_type,
                    "metadata": {
                        "chunk_id": chunk_id,
                        "pdf_id": pdf_id,
                        "user_id": user_id,
                        "source": file_name,
                        "page_number": page_num,
                        "chunk_index": idx + 1,
                        "section": section,
                        "chunk_type": content_type,
                        "text_length": len(text_block),
                        "token_count": tokens,
                        "start_character": start_char,
                        "end_character": end_char,
                        "visual_metadata": visual_metadata,
                        "previous_chunk_id": None,
                        "next_chunk_id": None,
                        "embedding_status": "pending"
                    }
                }

                # Payload budget validation (<4KB)
                payload_size = len(json.dumps(chunk_record["metadata"]).encode("utf-8"))
                if payload_size > cls.MAX_CHUNK_METADATA_BYTES:
                    logger.warning("Truncating metadata section for chunk %s (%d B)", chunk_id, payload_size)
                    chunk_record["metadata"]["section"] = "Main Body"

                raw_payloads.append(chunk_record)
                char_cursor = end_char + 1

        # Link sequential neighbor pointers
        for i in range(len(raw_payloads)):
            if i > 0:
                raw_payloads[i]["metadata"]["previous_chunk_id"] = raw_payloads[i - 1]["chunk_id"]
            if i < len(raw_payloads) - 1:
                raw_payloads[i]["metadata"]["next_chunk_id"] = raw_payloads[i + 1]["chunk_id"]

        summary = {
            "total_chunks": len(raw_payloads),
            "duplicates_removed": duplicate_count,
            "total_estimated_tokens": total_tokens,
            "chunking_strategy": cfg["strategy"],
            "chunk_size": cfg["chunk_size"],
            "chunk_overlap": cfg["chunk_overlap"]
        }

        return raw_payloads, summary

    # Helper method for recursive splitting
    @classmethod
    def _recursive_split_internal(
        cls, text: str, chunk_size_tokens: int, overlap_tokens: int, separators: List[str], model_encoding: str
    ) -> List[str]:
        if not text or not text.strip():
            return []
        if cls.estimate_tokens(text, model_encoding) <= chunk_size_tokens:
            return [text.strip()]

        separator = separators[-1]
        for s in separators:
            if s == "":
                separator = ""
                break
            if s in text:
                separator = s
                break

        splits = text.split(separator) if separator != "" else list(text)
        final_chunks: List[str] = []
        current_segment: List[str] = []
        current_token_count = 0

        for split in splits:
            split_tokens = cls.estimate_tokens(split, model_encoding)
            if current_token_count + split_tokens > chunk_size_tokens and current_segment:
                joined_text = separator.join(current_segment).strip()
                if joined_text:
                    final_chunks.append(joined_text)
                
                words = joined_text.split()
                target_overlap_words = int(overlap_tokens / 1.3)
                overlap_words = words[-target_overlap_words:] if words and target_overlap_words > 0 else []

                current_segment = [" ".join(overlap_words), split] if overlap_words else [split]
                current_token_count = cls.estimate_tokens(separator.join(current_segment), model_encoding)
            else:
                current_segment.append(split)
                current_token_count += split_tokens

        if current_segment:
            last_joined = separator.join(current_segment).strip()
            if last_joined:
                final_chunks.append(last_joined)

        return final_chunks

    # --------------------------------------------------------
    # 5. Embedding Store Adapter Method
    # --------------------------------------------------------

    @staticmethod
    def to_embedding_payloads(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Converts internal service chunks into flat payloads ready for vector stores.
        """
        embedding_ready = []
        for c in chunks:
            embedding_ready.append({
                "id": c["chunk_id"],
                "content": c["text"],
                "metadata": c["metadata"]
            })
        return embedding_ready
