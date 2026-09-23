"""Throwaway ChromaDB introspection (read-only, NOT part of the app).

Answers one question: which (user_id, pdf_id) pairs actually have vectors in the
store Node uses, so we pick a Q&A fixture whose answers will truly ground
(rag_supported=true) instead of silently falling back to LLM_ONLY.

Prints ONLY metadata KEYS, id-like values, and COUNTS -- never document text,
never embeddings, never secrets. Delete after use.

Usage:
    cd C:\\java\\studygenie-ai\\studygenie-ai\\backend
    .venv\\Scripts\\python.exe ai\\_chroma_inspect.py
"""
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT.parents[2]   # C:\java\studygenie-ai\studygenie-ai
BACKEND_ROOT = SCRIPT.parents[1]   # ...\backend
os.chdir(PROJECT_ROOT)             # match how Node spawns Python

STORES = [
    ("parent", PROJECT_ROOT / "vector_db" / "chroma"),
    ("backend", BACKEND_ROOT / "vector_db" / "chroma"),
]

# pdf_id -> Mongo (title, user-prefix) from the earlier 47-PDF survey, for readable
# output only. Not authoritative; the chroma metadata below is the source of truth.
KNOWN = {
    "6a7486e7b9d7eb7d8f291030": ("CC- UNIT-3 - M", "6a747ce5"),
    "6a747570746033b4a328bd03": ("R23 CC UNIT-IV", "6a722ca2"),
    "6a748e1eb9d7eb7d8f29105e": ("23FE1A05D3_CSP", "6a747ce5"),
    "6a7d7ddc44a7e372c0eb9138": ("1.GenAI-UNIT-I-M", "6a7d7d70"),
    "6a81c5e6e6342b704caf6a34": ("DSA_Question_Bank", "6a7d7d70"),
    "6a81ec6a67590267fb0f7564": ("core-advanced-java", "6a7d7d70"),
    "6a81e047ab2a7860a3ed4eef": ("Raw_DSA_Notes", "6a7d7d70"),
    "6a81e06dab2a7860a3ed4f06": ("GenAI QB-M", "6a7d7d70"),
}


def pick(md, *keys):
    for k in keys:
        if k in md and md[k] not in (None, ""):
            return k, md[k]
    return None, None


def inspect(label, path):
    print(f"\n[CHROMA] store={label} path={path}")
    if not path.exists():
        print("[CHROMA]   (dir does not exist)")
        return
    try:
        import chromadb
        client = chromadb.PersistentClient(path=str(path))
    except Exception as exc:
        print(f"[CHROMA]   open failed: {exc}")
        return
    try:
        cols = client.list_collections()
    except Exception as exc:
        print(f"[CHROMA]   list_collections failed: {exc}")
        return
    if not cols:
        print("[CHROMA]   (no collections)")
        return
    for c in cols:
        try:
            total = c.count()
        except Exception as exc:
            total = f"? ({exc})"
        print(f"[CHROMA]   collection={c.name} count={total}")
        try:
            got = c.get(include=["metadatas"])   # ids always returned; NO documents/embeddings
        except Exception as exc:
            print(f"[CHROMA]     get(metadatas) failed: {exc}")
            continue
        mds = got.get("metadatas") or []
        keyset = Counter()
        for md in mds:
            if isinstance(md, dict):
                for k in md.keys():
                    keyset[k] += 1
        print(f"[CHROMA]     metadata_keys={dict(keyset)}")

        by_pdf = Counter()
        pdf_user = defaultdict(set)
        pdf_key_used, user_key_used = set(), set()
        for md in mds:
            if not isinstance(md, dict):
                continue
            pk, pv = pick(md, "pdf_id", "pdfId", "pdf", "source_pdf", "document_id", "doc_id")
            uk, uv = pick(md, "user_id", "userId", "user", "owner")
            if pk:
                pdf_key_used.add(pk)
            if uk:
                user_key_used.add(uk)
            if pv is not None:
                by_pdf[str(pv)] += 1
                if uv is not None:
                    pdf_user[str(pv)].add(str(uv))
        print(f"[CHROMA]     pdf_key={sorted(pdf_key_used)} user_key={sorted(user_key_used)}")
        for pv, n in by_pdf.most_common():
            title, _u = KNOWN.get(pv, ("?", ""))
            users = ",".join(sorted(pdf_user.get(pv, [])))
            print(f"[CHROMA]     pdf={pv} vectors={n} users=[{users}] title={title}")


def main():
    for label, path in STORES:
        inspect(label, path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
