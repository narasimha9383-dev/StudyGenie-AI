"""
============================================================
StudyGenie AI - Production Metadata Management Service
------------------------------------------------------------
Provides structured, database-ready metadata creation, PDF property 
extraction, multi-tenant security scoping, page quality analytics, 
OCR & storage telemetry, chunking specs, exact RAG citation metadata,
processing SLAs, subject classification, and JSON payload size checks.
============================================================
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# Safe PyMuPDF import
try:
    import fitz
except ImportError:
    fitz = None

# Safe Language Detection import
try:
    from langdetect import detect as lang_detect
except ImportError:
    lang_detect = None

logger = logging.getLogger("MetadataService")


class MetadataService:
    """
    Centralized metadata generator and validator for StudyGenie.AI.
    Decouples document metadata from user analytics and conversation history.
    """

    HASH_BLOCK_SIZE = 1024 * 1024       # 1 MB chunk buffer for file hashing
    MAX_DOC_METADATA_BYTES = 15000      # 15 KB limit for MongoDB document records
    MAX_CHUNK_METADATA_BYTES = 4000     # 4 KB limit for ChromaDB chunk metadata

    # --------------------------------------------------------
    # 1. Document Fingerprinting & Hash
    # --------------------------------------------------------

    @classmethod
    def calculate_document_hash(cls, file_path: str) -> str:
        """
        Calculates SHA-256 fingerprint using 1MB chunk buffers.
        Prevents duplicate uploads and enables vector reuse across identical files.
        """
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for block in iter(lambda: f.read(cls.HASH_BLOCK_SIZE), b""):
                sha256.update(block)
        return sha256.hexdigest()

    # --------------------------------------------------------
    # 2. Basic Document & Pipeline Versioning
    # --------------------------------------------------------

    @staticmethod
    def create_document_metadata(
        pdf_id: str,
        processing_id: str,
        user_id: str,
        file_path: str,
        file_hash: str,
        version: int = 1,
        file_type: str = "application/pdf"
    ) -> Dict[str, Any]:
        """
        Creates core document-level tracking metadata with dual IDs and ISO timestamps.
        """
        path = Path(file_path)
        file_size = path.stat().st_size if path.exists() else 0
        now = datetime.now(timezone.utc).isoformat()

        return {
            "pdf_id": pdf_id,
            "processing_id": processing_id,
            "user_id": user_id,
            "file_name": path.name,
            "file_type": file_type,
            "file_size": file_size,
            "file_hash": file_hash,
            "version": version,
            "pipeline_version": "1.0",
            "rag_version": "2026",
            "created_at": now,
            "updated_at": now
        }

    # --------------------------------------------------------
    # 3. PDF Info & Properties Metadata
    # --------------------------------------------------------

    @staticmethod
    def extract_pdf_metadata(doc: Any) -> Dict[str, Any]:
        """
        Extracts embedded document properties directly from PyMuPDF handle.
        """
        if fitz is None or doc is None:
            logger.warning("PyMuPDF handle unavailable or doc is None. Returning default pdf_info.")
            return {
                "title": "", "author": "", "subject": "", "keywords": "",
                "creator": "", "producer": "", "creation_date": "",
                "modification_date": "", "total_pages": 0
            }

        meta = doc.metadata or {}
        return {
            "title": meta.get("title", ""),
            "author": meta.get("author", ""),
            "subject": meta.get("subject", ""),
            "keywords": meta.get("keywords", ""),
            "creator": meta.get("creator", ""),
            "producer": meta.get("producer", ""),
            "creation_date": meta.get("creationDate", ""),
            "modification_date": meta.get("modDate", ""),
            "total_pages": len(doc)
        }

    # --------------------------------------------------------
    # 4. Multilingual & Text Detection
    # --------------------------------------------------------

    @staticmethod
    def detect_languages(cleaned_text: str) -> Dict[str, Any]:
        """
        Detects primary and supporting languages across a 5,000-character sample.
        Detects English, Telugu, and Hindi scripts.
        """
        default_lang = "en"
        detected_langs = [default_lang]

        if not cleaned_text or not lang_detect:
            return {"primary_language": default_lang, "supported_languages": detected_langs}

        try:
            sample = cleaned_text[:5000]
            primary = lang_detect(sample)

            if any("\u0C00" <= char <= "\u0C7F" for char in sample) and "te" not in detected_langs:
                detected_langs.append("te")
            if any("\u0900" <= char <= "\u097F" for char in sample) and "hi" not in detected_langs:
                detected_langs.append("hi")
            if primary not in detected_langs:
                detected_langs.append(primary)

            return {
                "primary_language": primary,
                "supported_languages": detected_langs
            }
        except Exception:
            return {"primary_language": default_lang, "supported_languages": detected_langs}

    # --------------------------------------------------------
    # 5. Educational Subject & Topic Classification
    # --------------------------------------------------------

    @staticmethod
    def create_subject_metadata(
        subject: str = "General Studies",
        topic: str = "Unclassified",
        difficulty: str = "medium"
    ) -> Dict[str, Any]:
        """
        Stores educational subject metadata for quiz generation and flashcard feeds.
        """
        return {
            "subject": subject,
            "topic": topic,
            "difficulty": difficulty
        }

    # --------------------------------------------------------
    # 6. Page Level Metadata
    # --------------------------------------------------------

    @staticmethod
    def create_page_metadata(
        page_number: int,
        total_pages: int,
        raw_text: str,
        cleaned_text: str,
        image_count: int,
        is_scanned: bool,
        quality_score: float,
        has_diagrams: bool = False
    ) -> Dict[str, Any]:
        """
        Builds per-page structural and quality telemetry.
        """
        orig_len = len(raw_text or "")
        clean_len = len(cleaned_text or "")
        words = len((cleaned_text or "").split())
        comp_ratio = round((clean_len / max(1, orig_len)) * 100, 2)
        return {
            "page_number": page_number,
            "total_pages": total_pages,
            "text_length": orig_len,
            "cleaned_length": clean_len,
            "word_count": words,
            "compression_ratio": comp_ratio,
            "quality_score": round(quality_score, 2),
            "has_images": image_count > 0,
            "image_count": image_count,
            "has_diagrams": has_diagrams,
            "is_scanned": is_scanned
        }

    # --------------------------------------------------------
    # 7. OCR Telemetry Metadata
    # --------------------------------------------------------

    @staticmethod
    def create_ocr_metadata(
        required: bool = False,
        used: bool = False,
        engine: str = "none",
        confidence: float = 0.0,
        pages_processed: int = 0,
        ocr_time_seconds: float = 0.0
    ) -> Dict[str, Any]:
        """
        Tracks OCR pipeline engine metrics and run durations.
        """
        return {
            "required": required,
            "used": used,
            "engine": engine,
            "confidence": round(confidence, 2),
            "pages_processed": pages_processed,
            "ocr_time_seconds": round(ocr_time_seconds, 2)
        }

    # --------------------------------------------------------
    # 8. Document Chunking Strategy
    # --------------------------------------------------------

    @staticmethod
    def create_chunking_metadata(
        strategy: str = "recursive",
        chunk_size: int = 500,
        overlap: int = 100,
        total_chunks: int = 0
    ) -> Dict[str, Any]:
        """
        Tracks vector splitting specs (recursive vs semantic chunking).
        """
        return {
            "strategy": strategy,
            "chunk_size": chunk_size,
            "overlap": overlap,
            "total_chunks": total_chunks
        }

    # --------------------------------------------------------
    # 9. RAG Security Scope (Multi-Tenant Isolation)
    # --------------------------------------------------------

    @staticmethod
    def create_security_metadata(
        user_id: str,
        pdf_id: str,
        visibility: str = "private"
    ) -> Dict[str, Any]:
        """
        Generates mandatory security filtering tags attached to vector embeddings
        to prevent cross-user data leakage during RAG search queries.
        """
        return {
            "owner": user_id,
            "pdf_id": pdf_id,
            "visibility": visibility
        }

    # --------------------------------------------------------
    # 10. Vector Chunk & Citation Metadata
    # --------------------------------------------------------

    @staticmethod
    def create_citation_metadata(
        source_file: str,
        page_number: int,
        section: str = "Main Body",
        chunk_id: str = ""
    ) -> Dict[str, Any]:
        """
        Constructs attribution payloads attached to response context chunks.
        Allows StudyGenie AI to respond with exact sources ("According to page 12...").
        """
        return {
            "source_file": source_file,
            "page": page_number,
            "section": section,
            "chunk_id": chunk_id
        }

    @classmethod
    def create_chunk_metadata(
        cls,
        chunk_id: str,
        pdf_id: str,
        user_id: str,
        source_file: str,
        page_number: int,
        chunk_index: int,
        start_char: int,
        end_char: int,
        text: str,
        section: str = "Main Body"
    ) -> Dict[str, Any]:
        """
        Constructs lean vector database metadata attached to each chunk embedding.
        Enforces MAX_CHUNK_METADATA_BYTES (4KB) budget limit.
        """
        words = len(text.split())
        token_estimate = int(words * 1.3)

        chunk_payload = {
            "chunk_id": chunk_id,
            "pdf_id": pdf_id,
            "security": cls.create_security_metadata(user_id=user_id, pdf_id=pdf_id),
            "citation": cls.create_citation_metadata(
                source_file=source_file,
                page_number=page_number,
                section=section,
                chunk_id=chunk_id
            ),
            "page": page_number,
            "chunk_index": chunk_index,
            "start_character": start_char,
            "end_character": end_char,
            "word_count": words,
            "token_estimate": token_estimate
        }

        # Validate chunk payload size
        json_bytes = len(json.dumps(chunk_payload).encode("utf-8"))
        if json_bytes > cls.MAX_CHUNK_METADATA_BYTES:
            raise ValueError(f"Chunk metadata size violation: {json_bytes} bytes exceeds {cls.MAX_CHUNK_METADATA_BYTES}B limit.")

        return chunk_payload

    # --------------------------------------------------------
    # 11. Embedding & Generation Model Specs
    # --------------------------------------------------------

    @staticmethod
    def create_embedding_metadata(
        status: str = "completed",
        provider: str = "Sentence Transformers",
        model: str = "sentence-transformers/all-MiniLM-L6-v2",
        dimension: int = 384,
        vector_db: str = "ChromaDB",
        embedding_version: str = "v1"
    ) -> Dict[str, Any]:
        """
        Tracks vector model specifications and provider versions.
        """
        return {
            "embedding_status": status,
            "embedding_provider": provider,
            "embedding_model": model,
            "embedding_dimension": dimension,
            "embedding_version": embedding_version,
            "vector_db": vector_db,
            "created_at": datetime.now(timezone.utc).isoformat()
        }

    @staticmethod
    def create_generation_model_metadata(
        provider: str = "Google",
        model: str = "gemini-2.0-flash",
        temperature: float = 0.3
    ) -> Dict[str, Any]:
        """
        Tracks LLM generator specifications paired with RAG context payloads.
        """
        return {
            "provider": provider,
            "model": model,
            "temperature": temperature
        }

    # --------------------------------------------------------
    # 12. Retrieval Telemetry (No Raw Query Storage)
    # --------------------------------------------------------

    @staticmethod
    def create_retrieval_metadata(
        query_id: str = "",
        chunks_retrieved: int = 0,
        average_score: float = 0.0
    ) -> Dict[str, Any]:
        """
        Tracks vector search telemetry without storing raw user query strings 
        (chat text is persisted separately in ChatHistory DB).
        """
        return {
            "query_id": query_id,
            "chunks_retrieved": chunks_retrieved,
            "average_score": round(average_score, 4),
            "last_retrieved_at": datetime.now(timezone.utc).isoformat() if query_id else ""
        }

    # --------------------------------------------------------
    # 13. Processing Metrics & Execution Durations
    # --------------------------------------------------------

    @staticmethod
    def create_processing_metrics(
        upload_time: float = 0.0,
        extraction_time: float = 0.0,
        cleaning_time: float = 0.0,
        embedding_time: float = 0.0,
        total_time: float = 0.0
    ) -> Dict[str, Any]:
        """
        Tracks pipeline run durations across execution stages for SLA monitoring.
        """
        return {
            "upload_time_seconds": round(upload_time, 3),
            "extraction_time_seconds": round(extraction_time, 3),
            "cleaning_time_seconds": round(cleaning_time, 3),
            "embedding_time_seconds": round(embedding_time, 3),
            "total_time_seconds": round(total_time, 3)
        }

    # --------------------------------------------------------
    # 14. Aggregate Document Statistics & Pipeline Status
    # --------------------------------------------------------

    @staticmethod
    def create_document_statistics(
        total_words: int,
        total_characters: int,
        total_chunks: int,
        avg_words_per_page: float = 0.0
    ) -> Dict[str, Any]:
        """
        Generates aggregate stats for paper summaries and dashboard reports.
        """
        return {
            "total_words": total_words,
            "total_characters": total_characters,
            "total_chunks": total_chunks,
            "average_words_per_page": round(avg_words_per_page, 2)
        }

    @staticmethod
    def update_processing_status(
        status: str = "completed",
        uploaded: bool = True,
        extracted: bool = True,
        cleaned: bool = True,
        chunked: bool = True,
        embedded: bool = False
    ) -> Dict[str, Any]:
        """
        Generates dashboard pipeline progression status.
        """
        return {
            "status": status,
            "pipeline": {
                "uploaded": uploaded,
                "extracted": extracted,
                "cleaned": cleaned,
                "chunked": chunked,
                "embedded": embedded
            }
        }

    @staticmethod
    def create_storage_metadata(
        provider: str = "cloudinary",
        url: str = "",
        public_id: str = "",
        bucket: str = ""
    ) -> Dict[str, Any]:
        """
        Tracks cloud storage assets (Cloudinary / AWS S3).
        """
        return {
            "provider": provider,
            "url": url,
            "public_id": public_id,
            "bucket": bucket
        }

    # --------------------------------------------------------
    # 15. Unified Document Schema Assembler & Size Validator
    # --------------------------------------------------------

    @classmethod
    def assemble_unified_metadata(
        cls,
        doc_meta: Dict[str, Any],
        pdf_info: Dict[str, Any],
        statistics: Dict[str, Any],
        processing_status: Dict[str, Any],
        security_meta: Dict[str, Any],
        classification_meta: Optional[Dict[str, Any]] = None,
        ocr_meta: Optional[Dict[str, Any]] = None,
        chunking_meta: Optional[Dict[str, Any]] = None,
        storage_meta: Optional[Dict[str, Any]] = None,
        embedding_meta: Optional[Dict[str, Any]] = None,
        generation_model_meta: Optional[Dict[str, Any]] = None,
        retrieval_meta: Optional[Dict[str, Any]] = None,
        metrics_meta: Optional[Dict[str, Any]] = None,
        errors: Optional[List[Dict[str, Any]]] = None,
        language_info: Optional[Dict[str, Any]] = None,
        quality_score: float = 0.95
    ) -> Dict[str, Any]:
        """
        Assembles metadata structures into MongoDB document schemas.
        Enforces MAX_DOC_METADATA_BYTES (15KB) payload size safety checks.
        """
        now = datetime.now(timezone.utc).isoformat()

        if "updated_at" in doc_meta:
            doc_meta["updated_at"] = now

        langs = language_info or {"primary_language": "en", "supported_languages": ["en"]}

        unified = {
            "document": doc_meta,
            "pdf_info": pdf_info,
            "classification": classification_meta or cls.create_subject_metadata(),
            "statistics": statistics,
            "processing": {
                "status": processing_status.get("status", "processing"),
                "primary_language": langs["primary_language"],
                "supported_languages": langs["supported_languages"],
                "quality_score": quality_score,
                "pipeline": processing_status.get("pipeline", {})
            },
            "metrics": metrics_meta or cls.create_processing_metrics(),
            "security": security_meta,
            "storage": storage_meta or cls.create_storage_metadata(),
            "ocr": ocr_meta or cls.create_ocr_metadata(),
            "chunking": chunking_meta or cls.create_chunking_metadata(),
            "embedding": embedding_meta or cls.create_embedding_metadata(status="pending"),
            "generation_model": generation_model_meta or cls.create_generation_model_metadata(),
            "retrieval": retrieval_meta or cls.create_retrieval_metadata(),
            "errors": errors or []
        }

        cls.validate_document_metadata(unified)
        return unified

    @classmethod
    def validate_document_metadata(cls, metadata: Dict[str, Any]) -> bool:
        """
        Validates keys and enforces MAX_DOC_METADATA_BYTES (15KB) limits.
        """
        required_keys = [
            "document", "pdf_info", "classification", "statistics", "processing", 
            "metrics", "security", "storage", "ocr", "chunking", "embedding", 
            "generation_model", "retrieval", "errors"
        ]
        for key in required_keys:
            if key not in metadata:
                raise ValueError(f"Metadata validation error: Missing root key '{key}'")

        doc_keys = [
            "pdf_id", "processing_id", "user_id", "file_name", "file_hash", 
            "pipeline_version", "rag_version", "created_at", "updated_at"
        ]
        for d_key in doc_keys:
            if d_key not in metadata["document"]:
                raise ValueError(f"Metadata validation error: Missing document key '{d_key}'")

        if not metadata["security"].get("owner"):
            raise ValueError("Metadata validation error: Missing security owner scope.")

        json_bytes = len(json.dumps(metadata).encode("utf-8"))
        if json_bytes > cls.MAX_DOC_METADATA_BYTES:
            raise ValueError(
                f"Metadata size violation: Payload is {json_bytes} bytes, "
                f"exceeding maximum limit of {cls.MAX_DOC_METADATA_BYTES} bytes."
            )

        return True
