# StudyGenie‑AI

A **RAG‑first, LLM‑assisted adaptive study assistant.** You upload your study material (text, PDF, or image), and the system answers questions using *your* documents as the primary source of truth — falling back to the language model only when your material doesn't cover the question, and always telling you which mode it used.

- **Retrieval‑first:** every question is embedded and matched against your uploaded material in a vector database before the LLM is involved.
- **Adaptive answering:** depending on how well your material covers the question, the answer comes from one of three modes (see [How it works](#how-it-works)).
- **Private by design:** one user can never retrieve another user's documents (fail‑closed isolation).
- **Runs locally:** uses a local `llama.cpp` model by default — no paid cloud LLM required.

---

## Quick start

> **You start three things by hand — DB → backend → frontend.** The AI layer is *not* launched separately: the backend spawns the Python AI per request and auto‑starts llama.cpp.

| # | Component | How to start | Port |
|---|-----------|--------------|------|
| 1 | **DB** — MongoDB *(start first)* | Runs as a Windows service; `net start MongoDB` if stopped | 27017 |
| 2 | **Backend** — Express *(also starts llama.cpp + Python AI)* | `cd backend` → `npm run dev` | 5000 |
| 3 | **Frontend** — React/Vite | `cd frontend` → `npm run dev` | 5173 |

Use two terminals, then open **http://localhost:5173**:

```powershell
# Terminal 1 — backend (auto-starts llama.cpp on :8080 and spawns the Python AI layer)
cd C:\java\studygenie-ai\studygenie-ai\backend
npm run dev

# Terminal 2 — frontend
cd C:\java\studygenie-ai\studygenie-ai\frontend
npm run dev
```

**Mental model — you start 3, the backend starts the rest:**

```
You start:       MongoDB  ->  Backend (npm run dev)  ->  Frontend (npm run dev)
Backend starts:  llama.cpp (:8080)   +   Python AI layer (per request)
```

> ⏳ The **first** backend launch downloads the local LLM model (a few hundred MB) before it prints `Local llama.cpp is ready` — one‑time, a few minutes. See [Running the app](#running-the-app) for the full walkthrough and [Troubleshooting](#troubleshooting) if a component is down.

**Run the AI layer standalone** (optional — normally automatic; useful for testing):
```powershell
cd C:\java\studygenie-ai\studygenie-ai\backend
.venv\Scripts\python.exe ai\main.py --user-id <userId> --pdf-id <pdfId> "What is Artificial Intelligence?"
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite, Material UI, Firebase auth |
| Backend | Node.js + Express (CommonJS) |
| Database | MongoDB (Mongoose) |
| AI layer | Python 3.11, spawned per‑request by the backend |
| Vector store | ChromaDB (embedded, persistent) |
| Embeddings | `sentence-transformers` — all‑MiniLM‑L6‑v2 (384‑dim) |
| LLM | Local `llama.cpp` (Qwen GGUF) by default; OpenRouter as fallback |

### Ports

| Service | URL |
|---------|-----|
| Frontend (Vite) | http://localhost:5173 |
| Backend (Express API) | http://localhost:5000 |
| Local llama.cpp | http://127.0.0.1:8080 (auto‑started by the backend) |
| MongoDB | mongodb://localhost:27017 |

---

## Prerequisites

- **Node.js** 18+ (for both backend and frontend)
- **Python** 3.10+ (3.11 recommended) for the AI layer
- **MongoDB** running locally on port 27017 — **required**; the backend refuses to start without it
- **llama.cpp** executable (only if you want local LLM generation — see [Configuration](#configuration))

---

## One‑time setup

> Skip any step whose dependencies are already installed.

**1. Backend (Node):**
```powershell
cd backend
npm install
```

**2. Python AI layer** (creates a virtual environment inside `backend/`):
```powershell
cd backend
python -m venv .venv
.venv\Scripts\pip install -r ai\requirements.txt
```

**3. Frontend (Node):**
```powershell
cd frontend
npm install
```

**4. Environment files** — copy each example and fill in your own values:
```powershell
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```
See [Configuration](#configuration) below for what each key does.

**5. MongoDB** — install and start it (e.g. run the MongoDB service, or `mongod`). Confirm it is listening on `27017`.

---

## Running the app

You need **two terminals**. The backend automatically starts and manages `llama.cpp`, and spawns the Python AI layer per request — you do **not** start those manually.

**Terminal 1 — backend + AI layer:**
```powershell
cd backend
npm run dev
```

**Terminal 2 — frontend:**
```powershell
cd frontend
npm run dev
```

Then open **http://localhost:5173** (Vite opens it automatically).

### What a healthy startup looks like

The backend terminal prints, in order:
```
MongoDB connected ...
Local llama.cpp is ready (ggml-org/Qwen3.5-0.8B-GGUF).
Server running on port 5000
```

> ⏳ **First run downloads the LLM model** (a few hundred MB) before llama.cpp reports `ready` — this can take several minutes the first time only. Until then, AI answers report a provider error; the rest of the app works normally.

### `npm run dev` vs `npm start` (backend)

- `npm run dev` — uses **nodemon** (auto‑restarts on file changes). Best for development.
- `npm start` — plain `node server.js`.

Press **Ctrl+C** in the backend terminal to stop; it also cleanly shuts down the llama.cpp process it started.

---

## Configuration

Secrets live in `.env` files that are **not** committed. Templates are provided as `.env.example`.

### `backend/.env`

| Key | Purpose |
|-----|---------|
| `PORT` | Backend port (default 5000) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing auth tokens — use a long random value |
| `OPENROUTER_API_KEY` | Fallback cloud LLM key (used only if local LLM is disabled/unavailable) |
| `OPENROUTER_MODEL` | Fallback model name |
| `LOCAL_LLM_ENABLED` | `true` to use local llama.cpp (default); `false` to skip it and use OpenRouter |
| `LOCAL_LLM_BASE_URL` | llama.cpp OpenAI‑compatible endpoint (default `http://127.0.0.1:8080/v1`) |
| `LOCAL_LLM_MODEL` | Hugging Face repo / model served by llama.cpp |
| `CHROMA_PERSIST_DIRECTORY` | **Absolute** path to the vector store (avoids empty cwd‑relative stores) |
| `CHROMA_COLLECTION_NAME` | Chroma collection name |
| `VECTOR_TOP_K` | How many chunks to retrieve per query |
| `VECTOR_SCORE_THRESHOLD` / `RAG_RELEVANCE_THRESHOLD` | Minimum similarity for a chunk to count as relevant |
| `RAG_MAX_CONTEXT_CHUNKS` | Cap on chunks sent to the LLM |
| `RAG_MAX_CONTEXT_CHARS` | Character budget for the assembled context (prevents overflowing the local model) |
| `RAG_MIN_RELEVANT_CHUNKS` | Minimum relevant chunks required to treat coverage as sufficient |
| `AI_LOG_LEVEL` | Python AI log verbosity (`DEBUG`/`INFO`/`WARNING`/`ERROR`) |

> **Local LLM executable:** on Windows, if `LOCAL_LLM_EXECUTABLE` is not set the backend uses a default `llama.exe` path. To use a different build, set `LOCAL_LLM_EXECUTABLE` (and optionally `LOCAL_LLM_MODEL_PATH` for a local `.gguf`). See `backend/.env.example` for the full list.

### `frontend/.env`

| Key | Purpose |
|-----|---------|
| `VITE_API_URL` | Backend API base (default `http://localhost:5000/api`) |
| `VITE_FIREBASE_*` | Firebase web config for Google sign‑in |

---

## How it works

Every question flows through a retrieval‑first, adaptive pipeline:

```
User input (text / PDF / image)
   → extract & normalize the QUESTION        (question files are never indexed)
   → embed the query
   → retrieve from ChromaDB (scoped to THIS user + document)
   → hybrid search + rerank
   → classify how well your material covers the question
        │
        ├─ sufficient → RAG_ONLY  (mode "rag")          → answer grounded in your material
        ├─ partial    → RAG + LLM (mode "rag_enriched")  → your material + model reasoning
        └─ none       → LLM_ONLY  (mode "llm")           → model answer + explicit disclosure
   → LLM (with grounding rules in the system prompt)
   → final answer + sources
```

- **SOURCE vs QUERY:** uploaded *study material* is indexed into the vector store; a *question* supplied as a PDF or image is only read for its text and is **never** indexed.
- **Isolation:** if a request has no authenticated user, retrieval is skipped entirely (fail‑closed) rather than searching everyone's data.
- **Grounding:** the LLM is instructed to treat your retrieved material as the primary source of truth and to disclose when it answers from general knowledge.

---

## Project structure

```
studygenie-ai/
├─ backend/                 Node/Express API + Python AI layer
│  ├─ server.js             App entry (port 5000; auto-starts llama.cpp)
│  ├─ routes/               Express routes (auth, pdf, chat, quiz, notes, ...)
│  ├─ controllers/          Route handlers
│  ├─ services/             Node services (ragService.js, localLlamaManager.js, ...)
│  ├─ models/               Mongoose models
│  ├─ ai/                   Python AI layer
│  │  ├─ main.py            CLI bridge invoked by Node
│  │  ├─ generation/        rag_service.py, llm_service.py, query_input.py, ...
│  │  ├─ retrieval/         vector_store.py, retrieval_service.py, reranker
│  │  ├─ ingestion/         pdf_processor.py, chunking, embeddings
│  │  └─ requirements.txt   Python dependencies
│  ├─ tests/                Python + Node tests
│  └─ .env.example          Backend config template
├─ frontend/                React + Vite app (port 5173)
│  └─ .env.example          Frontend config template
└─ vector_db/               Persistent ChromaDB store
```

---

## Testing

From the `backend/` directory:

```powershell
# Python AI tests (adaptive RAG, query input, local LLM client)
.venv\Scripts\python.exe -m unittest tests.test_rag_evidence tests.test_query_input tests.test_llm_service_local

# Node test (local llama.cpp lifecycle manager)
node --test tests\localLlamaManager.test.js
```

The RAG tests prove that retrieved context actually reaches the LLM request and that documents are isolated per user.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Backend exits with *"MongoDB is unavailable"* | MongoDB isn't running. Start it and confirm port 27017 is listening. |
| Backend logs *"Local llama.cpp is not ready"* | The model is still downloading (first run) or the llama.cpp executable path is wrong. The app stays up; wait, or set `LOCAL_LLM_ENABLED=false` to use OpenRouter. |
| AI answers say the provider is unavailable | llama.cpp isn't ready yet and no OpenRouter fallback is configured. Wait for `ready`, or configure the fallback. |
| Frontend can't reach the API / CORS error | Check `VITE_API_URL` in `frontend/.env` and that the backend is on port 5000. |
| Want a fast start without the local model | Set `LOCAL_LLM_ENABLED=false` in `backend/.env` (uses OpenRouter fallback). |
| Chroma returns no results | Confirm `CHROMA_PERSIST_DIRECTORY` is an **absolute** path pointing at your populated store. |

---

## Security

- **Never commit `.env` files.** Only the `.env.example` templates belong in version control.
- If an API key (e.g. `OPENROUTER_API_KEY`) has ever been committed or shared, **rotate it immediately** in the provider dashboard and treat the old one as compromised.
- The AI layer logs only counts and scores — never your question text or document contents — and never returns internal stack traces to the frontend.
