const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PDFParse } = require("pdf-parse");
const PDF = require("../models/PDF");
const User = require("../models/User");
const DocumentChunk = require("../models/DocumentChunk");
const {
  runAiPipeline,
  initialStages,
} = require("./ai/orchestrator/aiOrchestrator");
const PDFDocument = require("pdfkit");
const { spawn } = require("child_process");
const { localLlamaManager } = require("./localLlamaManager");
const { buildBoundedMaterialsContent } = require("./materialsContext");

// RAG-first policy: upload/setup only extracts + indexes into the vector store.
// Study material (notes/flashcards/quiz) is produced on demand when the user
// clicks "Generate Study Material". Set AUTO_GENERATE_ON_SETUP=true to restore
// the legacy behaviour where setup also generates the requested outputs.
const autoGenerateOnSetup =
  String(process.env.AUTO_GENERATE_ON_SETUP || "").toLowerCase() === "true";

// Pure decision for whether setup should also generate study material inline.
// Kept side-effect-free and exported so the RAG-first gate is unit-testable
// without a database. Auto-generation happens only when explicitly enabled, the
// document processed successfully, and the PDF is study content (not a question
// paper acting purely as a question source).
const shouldAutoGenerateMaterials = (
  status,
  setup = {},
  { autoGenerate = autoGenerateOnSetup } = {},
) =>
  Boolean(autoGenerate) &&
  status === "completed" &&
  setup.documentRole !== "question_source";

// Figure selection is deliberately conservative. Extraction remains broad so a
// legitimate diagram is not lost, but only figures that clear this score are
// allowed into generated PDFs or downstream model inputs.
const IMAGE_RELEVANCE_THRESHOLD = Math.min(
  1,
  Math.max(0, Number(process.env.IMAGE_RELEVANCE_THRESHOLD || 0.68)),
);
const IMAGE_MAX_RESULTS = Math.max(
  0,
  Number.parseInt(process.env.IMAGE_MAX_RESULTS || "2", 10) || 2,
);
const IMAGE_RETRIEVAL_DEBUG =
  String(process.env.IMAGE_RETRIEVAL_DEBUG || "false").toLowerCase() === "true";

const IMAGE_STOP_WORDS = new Set(
  "a an and are as at be by for from how in into is it of on or that the their this to was what when where which with explain about use using working does do describe define why".split(
    /\s+/,
  ),
);

const imageTokens = (value) =>
  new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((token) => token.replace(/(ing|ed|es|s)$/i, ""))
      .filter((token) => token.length > 2 && !IMAGE_STOP_WORDS.has(token)),
  );

const tokenCoverage = (query, candidate) => {
  const queryTokens = imageTokens(query);
  const candidateTokens = imageTokens(candidate);
  if (!queryTokens.size || !candidateTokens.size) return 0;
  let matches = 0;
  for (const token of queryTokens) if (candidateTokens.has(token)) matches += 1;
  return matches / queryTokens.size;
};

const figurePages = (figure) => {
  const pages = Array.isArray(figure?.pages) ? figure.pages : [figure?.page_number];
  return pages.map(Number).filter((page) => Number.isFinite(page) && page > 0);
};

const pageProximity = (figure, sourcePages) => {
  const pages = (sourcePages || []).map(Number).filter(Number.isFinite);
  if (!pages.length) return 0;
  const distances = figurePages(figure).map((page) =>
    Math.min(...pages.map((sourcePage) => Math.abs(page - sourcePage))),
  );
  const distance = distances.length ? Math.min(...distances) : Infinity;
  if (distance === 0) return 1;
  if (distance === 1) return 0.55;
  if (distance === 2) return 0.2;
  return 0;
};

const figureDedupKey = (figure) =>
  [figure?.figure_id, figure?.checksum, figure?.file_checksum, figure?.image_path]
    .map((value) => String(value || "").trim().toLowerCase())
    .find(Boolean) ||
  `${String(figure?.caption || "").trim().toLowerCase()}|${figurePages(figure).join(",")}`;

/** Rank extracted PDF figures using multiple local signals and no padding. */
const selectRelevantFigures = ({
  figures = [],
  question = "",
  retrievedContext = "",
  sourcePages = [],
  userId,
  pdfId,
} = {}) => {
  // The parent PDF is normally already authorized by getReadyPdf(). Keeping the
  // scope requirement here makes this function safe when called independently.
  if (!String(userId || "").trim() || !String(pdfId || "").trim()) return [];
  const seen = new Set();
  const ranked = [];
  for (const figure of Array.isArray(figures) ? figures : []) {
    if (!figure || !figure.image_path) continue;
    if (
      figure.pdf_id !== undefined &&
      figure.pdf_id !== null &&
      String(figure.pdf_id) !== String(pdfId)
    )
      continue;
    const key = figureDedupKey(figure);
    if (seen.has(key)) continue;
    seen.add(key);

    const caption = String(figure.caption || "").trim();
    const nearbyText = String(figure.nearby_text || "").trim();
    const section = String(
      figure.section || figure.subsection || figure.section_title || figure.heading || "",
    ).trim();
    const combined = `${caption} ${nearbyText} ${section}`.trim();
    const context = String(retrievedContext || "").trim();
    const semanticScore = Math.max(
      tokenCoverage(question, combined),
      tokenCoverage(context, combined),
    );
    const captionScore = tokenCoverage(question, caption);
    const contextScore = tokenCoverage(question, nearbyText);
    const sectionScore = tokenCoverage(question, section);
    const proximityScore = pageProximity(figure, sourcePages);
    const finalScore = Math.min(
      1,
      0.45 * semanticScore +
        0.30 * captionScore +
        0.20 * contextScore +
        0.05 * sectionScore +
        0.06 * proximityScore,
    );
    const accepted = finalScore >= IMAGE_RELEVANCE_THRESHOLD;
    if (IMAGE_RETRIEVAL_DEBUG) {
      console.info(
        `[IMAGE RETRIEVAL] Figure: ${figure.figure_id || key} Page: ${figure.page_number || "?"} ` +
          `Caption: ${caption || "(none)"} Semantic Score: ${semanticScore.toFixed(2)} ` +
          `Caption Score: ${captionScore.toFixed(2)} Context Score: ${contextScore.toFixed(2)} ` +
          `Section Score: ${sectionScore.toFixed(2)} Final Score: ${finalScore.toFixed(2)} ` +
          `Decision: ${accepted ? "ACCEPT" : "REJECT"}${accepted ? "" : " (below threshold)"}`,
      );
    }
    if (accepted) ranked.push({ figure, finalScore, proximityScore });
  }
  ranked.sort(
    (left, right) =>
      right.finalScore - left.finalScore ||
      right.proximityScore - left.proximityScore ||
      String(left.figure.figure_id || "").localeCompare(String(right.figure.figure_id || "")),
  );
  return ranked.slice(0, IMAGE_MAX_RESULTS).map(({ figure }) => figure);
};

let pythonExecutableCache;

// OCR is a fallback for scanned/image-based PDFs. Normal PDF text extraction
// remains the fast first choice; invoking Tesseract for every upload would make
// selectable-text PDFs unnecessarily slow.
const TESSERACT_DEFAULT_PATH = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";

const resolveTesseractExecutable = () => {
  const configured = String(process.env.TESSERACT_BIN || "").trim();
  return [configured, TESSERACT_DEFAULT_PATH].find(
    (candidate) => candidate && fs.existsSync(candidate),
  );
};

const shouldUseOcr = (text, pageCount) => {
  if (String(process.env.OCR_ENABLED || "true").toLowerCase() === "false") {
    return false;
  }
  if (!Number.isFinite(Number(pageCount)) || Number(pageCount) < 1) return false;
  // A document with fewer than ~120 readable characters per page is commonly a
  // scan with a title/page number layer, rather than usable study text.
  return String(text || "").trim().length < Math.max(1000, Number(pageCount) * 120);
};

const runLocalProcess = (command, args, { cwd, timeoutMs = 60000 } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) return resolve();
      const reason = timedOut ? "timed out" : `exited with code ${code}`;
      reject(new Error(`${path.basename(command)} ${reason}: ${stderr.slice(0, 300)}`));
    });
  });

const extractTextWithOcr = async (pdfPath, totalPages) => {
  const tesseract = resolveTesseractExecutable();
  if (!tesseract) {
    return { status: "unavailable", text: "", pages: [] };
  }

  const maxPages = Math.max(
    1,
    Number.parseInt(process.env.OCR_MAX_PAGES || "120", 10) || 120,
  );
  const pageLimit = Math.min(Number(totalPages) || 0, maxPages);
  if (!pageLimit) return { status: "no_pages", text: "", pages: [] };

  const tempDir = path.join(
    __dirname,
    "..",
    "uploads",
    "ocr",
    `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`,
  );
  const pages = [];
  try {
    await fs.promises.mkdir(tempDir, { recursive: true });
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const outputBase = path.join(tempDir, `page-${pageNumber}`);
      await runLocalProcess(
        "pdftoppm",
        [
          "-f",
          String(pageNumber),
          "-l",
          String(pageNumber),
          "-r",
          "200",
          "-png",
          "-singlefile",
          pdfPath,
          outputBase,
        ],
        { timeoutMs: 60000 },
      );
      await runLocalProcess(
        tesseract,
        [`${outputBase}.png`, outputBase, "-l", "eng", "--psm", "6"],
        { timeoutMs: 60000 },
      );
      const pageText = await fs.promises.readFile(`${outputBase}.txt`, "utf8");
      if (pageText.trim()) pages.push({ page: pageNumber, text: pageText.trim() });
    }
    return {
      status: pageLimit < Number(totalPages) ? "partial" : "completed",
      text: pages.map((page) => page.text).join("\n\n"),
      pages,
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "studygenie-ai",
        event: "pdf_ocr_failed",
        message: error.message,
      }),
    );
    return { status: "failed", text: "", pages: [] };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const resolvePythonExecutable = (workspaceRoot) => {
  if (pythonExecutableCache === "__unavailable__") return null;
  if (pythonExecutableCache) return pythonExecutableCache;

  const localAppData = process.env.LOCALAPPDATA || "";
  const systemPythonCandidates =
    process.platform === "win32"
      ? ["Python313", "Python312", "Python311", "Python310"].map((version) =>
          path.join(localAppData, "Programs", "Python", version, "python.exe"),
        )
      : ["/usr/bin/python3", "/usr/local/bin/python3"];
  const candidates = [
    path.join(workspaceRoot, "backend", ".venv", "Scripts", "python.exe"),
    path.join(workspaceRoot, "backend", ".venv", "bin", "python"),
    path.join(workspaceRoot, ".venv", "Scripts", "python.exe"),
    path.join(workspaceRoot, ".venv", "bin", "python"),
    path.join(workspaceRoot, "..", ".venv", "Scripts", "python.exe"),
    path.join(workspaceRoot, "..", ".venv", "bin", "python"),
    process.env.PYTHON_BIN,
    ...systemPythonCandidates,
  ].filter(Boolean);

  const healthy = candidates.find((candidate) => {
    if (!fs.existsSync(candidate)) return false;
    const probe = require("child_process").spawnSync(
      candidate,
      // Keep this probe fast. The generation process reports dependency errors
      // itself; importing the full ML stack here causes false negatives during
      // cold starts because the probe has a five-second timeout.
      ["-c", "import sys; assert sys.version_info >= (3, 10); print(sys.executable)"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      },
    );
    return (
      !probe.error &&
      probe.status === 0 &&
      !String(probe.stderr || "")
        .toLowerCase()
        .includes("importerror")
    );
  });

  pythonExecutableCache = healthy || "__unavailable__";
  return healthy || null;
};

const syncChunksToChroma = (pdfId, userId, chunks) =>
  new Promise((resolve, reject) => {
    if (!chunks.length) return resolve({ indexed: 0, status: "skipped" });

    const workspaceRoot = path.join(__dirname, "..", "..");
    const pythonExecutable = resolvePythonExecutable(workspaceRoot);
    if (!pythonExecutable) {
      return resolve({ indexed: 0, status: "unavailable" });
    }

    const scriptPath = path.join(__dirname, "..", "ai", "main.py");
    const payload = chunks.map((chunk) => ({
      pdf_id: String(pdfId),
      chunk_id: String(chunk.chunkId),
      content: chunk.text,
      metadata: {
        ...(chunk.metadata || {}),
        pdf_id: String(pdfId),
        user_id: String(userId),
        chunk_id: String(chunk.chunkId),
        title: String(chunk.title || ""),
      },
    }));
    const child = spawn(pythonExecutable, [scriptPath, "--index-chunks"], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        PYTHONPATH: [workspaceRoot, process.env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => child.kill(),
      Number(process.env.PYTHON_INDEX_TIMEOUT_MS || 120000),
    );
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Chroma indexing failed: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // ai/main.py writes a structured {success:false,error:...} to STDOUT on failure
        // and routes tracebacks through its logger (often a file), so stderr is usually
        // empty here. Prefer the real stdout error before the generic fallback so the
        // actual cause (e.g. a Chroma SQLite lock) is not lost.
        let detail = stderr.trim();
        if (!detail) {
          try {
            detail = String(JSON.parse(stdout || "{}").error || "");
          } catch {
            /* stdout not JSON */
          }
        }
        return reject(
          new Error(
            `Chroma indexing failed: ${(detail || "Python indexing failed.").slice(0, 500)}`,
          ),
        );
      }
      let response;
      try {
        response = JSON.parse(stdout || "{}");
      } catch {
        return reject(
          new Error("Chroma indexing returned an invalid response."),
        );
      }
      if (!response.success)
        return reject(new Error(response.error || "Chroma indexing failed."));
      return resolve({
        indexed: response.indexed || payload.length,
        status: "ready",
      });
    });
    child.stdin.end(JSON.stringify(payload));
  });

const extractFigures = async (filePath, pdfId) => {
  const workspaceRoot = path.join(__dirname, "..", "..");
  const pythonExecutable = resolvePythonExecutable(workspaceRoot);
  if (!pythonExecutable)
    return {
      figures: [],
      diagnostics: { image_extraction_count: 0, image_failed_count: 0 },
    };
  return new Promise((resolve) => {
    const child = spawn(
      pythonExecutable,
      [path.join(__dirname, "..", "ai", "main.py"), "--extract-figures"],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          PYTHONPATH: [workspaceRoot, process.env.PYTHONPATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
        windowsHide: true,
      },
    );
    let stdout = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.on("close", () => {
      try {
        const result = JSON.parse(stdout || "{}");
        resolve(
          result.success
            ? result
            : {
                figures: [],
                diagnostics: {
                  image_extraction_count: 0,
                  image_failed_count: 0,
                },
              },
        );
      } catch {
        resolve({
          figures: [],
          diagnostics: { image_extraction_count: 0, image_failed_count: 0 },
        });
      }
    });
    child.on("error", () =>
      resolve({
        figures: [],
        diagnostics: { image_extraction_count: 0, image_failed_count: 0 },
      }),
    );
    child.stdin.end(
      JSON.stringify({ file_path: filePath, pdf_id: String(pdfId) }),
    );
  });
};

// Map an internal AI error message to a user-safe HTTP status + stable code so the
// polled note.error.code distinguishes a slow-generation timeout from an unreachable
// model from a real failure (instead of a single opaque "generation failed").
const classifyGenerationError = (message) => {
  const text = String(message || "");
  if (/\b429\b|rate limit|too many requests/i.test(text))
    return { statusCode: 429, code: "RATE_LIMITED" };
  if (/timed out|timeout|took too long/i.test(text))
    return { statusCode: 504, code: "LLM_TIMEOUT" };
  if (
    /not reachable|unavailable|connection (?:refused|failed)|failed to connect/i.test(
      text,
    )
  )
    return { statusCode: 503, code: "LLM_UNAVAILABLE" };
  return { statusCode: 502, code: "GENERATION_FAILED" };
};

const generateAiMaterials = async ({
  pdf,
  userId,
  generationType = "qa",
  sourceQuestions = [],
  sourceImages = [],
  count,
  onProgress,
}) => {
  const startedAt = Date.now();
  await localLlamaManager.ensureReady();
  const retrievalStart = Date.now();
  const chunks = await DocumentChunk.find({ user: userId, pdf: pdf._id })
    .select("chunkId index text metadata")
    .sort({ index: 1 })
    .lean();
  const retrievalMs = Date.now() - retrievalStart;
  const sourceChunks = chunks.length
    ? chunks
    : [{ text: pdf.text, metadata: { page: 1 } }];

  // Enforce a bounded context budget (like the chat/RAG path) instead of sending
  // the entire PDF. This is the root-cause fix for the generation timeout: prompt
  // size — and therefore CPU prompt-eval time — is now bounded and predictable.
  const promptBuildStart = Date.now();
  const budget = buildBoundedMaterialsContent(sourceChunks, {
    maxChars: Number(
      process.env.NOTES_CONTEXT_MAX_CHARS ||
        process.env.RAG_MAX_CONTEXT_CHARS ||
        8000,
    ),
    maxChunks: Number(process.env.NOTES_CONTEXT_MAX_CHUNKS || 12),
  });
  const content = budget.content;
  const promptBuildMs = Date.now() - promptBuildStart;
  if (!content) {
    const error = new Error(
      "The document has no extractable text to generate study material from.",
    );
    error.statusCode = 422;
    error.code = "EMPTY_CONTENT";
    throw error;
  }

  const workspaceRoot = path.join(__dirname, "..", "..");
  const pythonExecutable = resolvePythonExecutable(workspaceRoot);
  if (!pythonExecutable) {
    const error = new Error(
      "AI generation is unavailable because the Python environment could not be started.",
    );
    error.statusCode = 503;
    throw error;
  }

  // Structured, PII-safe timing log (counts and durations only — never PDF text).
  const logTiming = (extra) => {
    try {
      console.log(
        JSON.stringify({
          service: "studygenie-ai",
          event: "notes_timing",
          generationType,
          retrieval_ms: retrievalMs,
          prompt_build_ms: promptBuildMs,
          chunk_count_total: budget.chunkCountTotal,
          chunk_count_used: budget.chunkCountUsed,
          context_chars: budget.contextChars,
          ...extra,
        }),
      );
    } catch {
      /* logging must never break generation */
    }
  };

  const spawnStart = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      pythonExecutable,
      [path.join(__dirname, "..", "ai", "main.py"), "--generate-materials"],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          PYTHONPATH: [workspaceRoot, process.env.PYTHONPATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    // Dedicated per-operation ceiling for materials generation. It must exceed the
    // sum of the per-call llama read timeouts for the worst case (quiz = notes +
    // Easy/Medium/Hard). This is separate from the shorter chat timeout so a
    // multi-call materials job is never killed as if it were a single quick chat.
    // The Q&A path answers 20+ 10-mark questions with one grounded LLM call each,
    // so it gets its own, larger ceiling (MATERIALS_QA_TIMEOUT_MS) — a Q&A job must
    // never be killed mid-set and produce an incomplete PDF (§3).
    const materialsTimeoutMs =
      generationType === "qa"
        ? Number(
            process.env.MATERIALS_QA_TIMEOUT_MS ||
              process.env.MATERIALS_AI_TIMEOUT_MS ||
              1800000,
          )
        : Number(process.env.MATERIALS_AI_TIMEOUT_MS || 300000);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, materialsTimeoutMs);
    const finalize = (handler, value, ok) => {
      logTiming({
        llm_request_ms: Date.now() - spawnStart,
        total_ms: Date.now() - startedAt,
        status: ok ? "ok" : "error",
      });
      handler(value);
    };
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      const text = String(data);
      stderr += text;
      // Surface only the PII-safe [NOTES] per-stage timing lines to the backend log
      // (even on success); the rest of stderr is retained for error diagnostics.
      for (const line of text.split(/\r?\n/)) {
        // Surface the PII-safe per-stage timing/count lines to the backend log:
        // [NOTES] per-stage timing, the [PDF-PERF] qa split, and the [QA] count
        // trace, plus the per-question [RAG]/[LLM] timing+grounding lines (durations,
        // counts, scores; question text only). The rest of stderr is kept for diagnostics.
        if (
          line.startsWith("[NOTES]") ||
          line.startsWith("[PDF-PERF]") ||
          line.startsWith("[QA]") ||
          line.startsWith("[QA-PROGRESS]") ||
          line.startsWith("[RAG]") ||
          line.startsWith("[LLM]") ||
          line.includes("[LLM-PERF]")
        )
          console.log(line);
        const progressMatch = line.match(
          /^\[QA-PROGRESS\]\s+completed=(\d+)\s+total=(\d+)/,
        );
        if (progressMatch && typeof onProgress === "function") {
          Promise.resolve(
            onProgress({
              completed: Number(progressMatch[1]),
              total: Number(progressMatch[2]),
            }),
          ).catch(() => undefined);
        }
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finalize(
        reject,
        Object.assign(new Error(`AI generation failed: ${error.message}`), {
          statusCode: 502,
        }),
        false,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        return finalize(
          reject,
          Object.assign(
            new Error(
              "AI generation timed out while waiting for the language model.",
            ),
            { statusCode: 504, code: "GENERATION_TIMEOUT" },
          ),
          false,
        );
      if (code !== 0) {
        try {
          const response = JSON.parse(stdout || "{}");
          if (response && response.success === false && response.error) {
            const message = String(response.error).slice(0, 500);
            const { statusCode, code: errorCode } =
              classifyGenerationError(message);
            return finalize(
              reject,
              Object.assign(new Error(message), {
                statusCode,
                code: errorCode,
              }),
              false,
            );
          }
        } catch {
          // Fall through to the safe stderr-based error below.
        }
        return finalize(
          reject,
          Object.assign(
            new Error(
              `AI generation failed: ${(stderr.trim() || "Python AI generation failed.").slice(0, 500)}`,
            ),
            { statusCode: 502 },
          ),
          false,
        );
      }
      finalize(resolve, { stdout, stderr }, true);
    });
    child.stdin.end(
      JSON.stringify({
        content,
        chunks: sourceChunks,
        generationType,
        sourceQuestions,
        sourceImages,
        // The requested count is a maximum target. User/pdf ids let the Python
        // side run the per-question retrieval funnel against this user's indexed
        // chunks and return fewer items rather than fabricate padding.
        count,
        userId: userId != null ? String(userId) : undefined,
        pdfId: pdf?._id != null ? String(pdf._id) : undefined,
        difficulty_counts: {
          Easy: Number(process.env.QUESTION_BANK_EASY_COUNT || 5),
          Medium: Number(process.env.QUESTION_BANK_MEDIUM_COUNT || 5),
          Hard: Number(process.env.QUESTION_BANK_HARD_COUNT || 5),
        },
      }),
    );
  });
  let generated;
  try {
    generated = JSON.parse(result.stdout || "{}");
  } catch {
    const error = new Error("AI generation returned an invalid response.");
    error.statusCode = 502;
    throw error;
  }
  if (!generated.success) {
    const error = new Error(generated.error || "AI generation failed.");
    error.statusCode = 502;
    throw error;
  }
  const chromaSync = pdf.metadata?.chromaSync || {};
  return {
    ...generated,
    processing: {
      pages: pdf.totalPages,
      characters: pdf.text.length,
      chunks: chunks.length,
      embeddings: chunks.length,
      vectors_stored:
        chromaSync.status === "ready" ? chromaSync.indexed || 0 : 0,
    },
  };
};

const formatList = (items = []) =>
  items
    .map(
      (item) =>
        `- ${typeof item === "string" ? item : item.term || item.text || JSON.stringify(item)}`,
    )
    .join("\n");

const formatNotesMarkdown = (title, notes = {}) =>
  [
    `# ${title}`,
    "",
    notes.summary ? `## Summary\n\n${notes.summary}` : "",
    notes.key_concepts?.length
      ? `## Important Concepts\n\n${formatList(notes.key_concepts)}`
      : "",
    notes.important_points?.length
      ? `## Important Points\n\n${formatList(notes.important_points)}`
      : "",
    notes.revision_tips?.length
      ? `## Revision Tips\n\n${formatList(notes.revision_tips)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const formatQuestionBankMarkdown = (
  title,
  questions = [],
  generationType = "qa",
) => {
  if (generationType === "qa") {
    return [
      "# Questions & Answers",
      `Based on: ${title}`,
      ...questions.map((item, index) =>
        [
          `## Q${index + 1}. ${item.question}`,
          `**Answer:** ${item.answer}`,
          item.key_points?.length
            ? `**Key points:**\n${item.key_points.map((point) => `- ${point}`).join("\n")}`
            : "",
          item.source_pages?.length
            ? `**Source:** Uploaded Study Material, p. ${item.source_pages.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      ),
    ].join("\n\n");
  }
  const groups = ["easy", "medium", "hard"];
  return [
    "# Question Bank",
    `Based on: ${title}`,
    ...groups.map((difficulty) => {
      const entries = questions.filter(
        (item) => item.difficulty === difficulty,
      );
      if (!entries.length) return "";
      return `## ${difficulty[0].toUpperCase()}${difficulty.slice(1)} Questions\n\n${entries
        .map((item) =>
          [
            `### Q${item.question_number}. ${item.question}`,
            `**Answer:** ${item.answer}`,
            item.explanation ? `**Explanation:** ${item.explanation}` : "",
            `**Source:** ${item.source_pages.map((page) => `PDF Page ${page}`).join(", ")}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        )
        .join("\n\n---\n\n")}`;
    }),
  ]
    .filter(Boolean)
    .join("\n\n");
};

const splitSentences = (text) =>
  text
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((item) => item.trim())
    .filter(Boolean) || [];

const analyzeDocument = (text) => {
  if (typeof text !== "string" || !text.trim()) {
    const error = new Error("PDF text is empty.");
    error.statusCode = 422;
    throw error;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  const sentences = splitSentences(normalized);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const chapters = lines
    .filter(
      (line) =>
        /^(chapter|unit|module|lesson|[0-9]+[.)])/i.test(line) ||
        (line.length < 90 && /^[A-Z][A-Za-z\s:-]{4,}$/.test(line)),
    )
    .slice(0, 20);
  const words = normalized.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [];
  const stopWords = new Set([
    "this",
    "that",
    "with",
    "from",
    "have",
    "will",
    "which",
    "when",
    "where",
    "there",
    "their",
    "about",
    "would",
    "should",
    "these",
    "those",
    "into",
    "than",
    "then",
    "also",
    "using",
    "used",
    "such",
    "each",
    "more",
    "other",
    "been",
    "being",
    "they",
    "them",
    "your",
    "what",
    "does",
    "data",
  ]);
  const frequency = words.reduce((map, word) => {
    if (!stopWords.has(word)) map[word] = (map[word] || 0) + 1;
    return map;
  }, {});
  const concepts = Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([term, count]) => ({ term, count }));
  const definitions = sentences
    .filter((sentence) =>
      /\b(is defined as|refers to|is called|means|is a|are a)\b/i.test(
        sentence,
      ),
    )
    .slice(0, 12);
  const formulas = lines
    .filter((line) => /[=≈≤≥√∑∫]|\b(formula|equation|theorem)\b/i.test(line))
    .slice(0, 12);
  const algorithms = sentences
    .filter((sentence) =>
      /\b(algorithm|procedure|step [0-9]|complexity|pseudocode)\b/i.test(
        sentence,
      ),
    )
    .slice(0, 12);
  const codeSignals = lines
    .filter((line) =>
      /\b(function|class|public|private|const|let|def|return|import)\b|[{};]/.test(
        line,
      ),
    )
    .slice(0, 12);
  const relationships = concepts
    .slice(0, 8)
    .map((concept, index) => ({
      source: concept.term,
      target:
        concepts[(index + 1) % Math.max(concepts.length, 1)]?.term ||
        concept.term,
      type: "related",
    }));
  const difficulty =
    normalized.length > 18000 || formulas.length > 4 || algorithms.length > 4
      ? "Advanced"
      : normalized.length > 7000
        ? "Intermediate"
        : "Beginner";
  return {
    subject: chapters[0] || concepts[0]?.term || "Study material",
    chapters,
    concepts,
    definitions,
    formulas,
    algorithms,
    codeSignals,
    relationships,
    difficulty,
    estimatedReadingMinutes: Math.max(1, Math.ceil(words.length / 220)),
    keySentences: sentences.slice(0, 18),
    analyzedAt: new Date(),
  };
};

const ensureProcessed = async (record, fileBuffer) => {
  let parser;
  try {
    const data = fileBuffer || (await fs.promises.readFile(record.filePath));
    const fileStats = await fs.promises.stat(record.filePath);
    console.info(
      JSON.stringify({
        service: "studygenie-ai",
        event: "pdf_opened",
        filename: record.fileName,
        path: record.filePath,
        exists: true,
        size: fileStats.size,
      }),
    );
    parser = new PDFParse({ data });
    // PDFParse maintains parser state internally, so its operations must not
    // run concurrently on one instance.
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo({ parsePageInfo: true });
    record.text = textResult.text.trim();
    record.extractedText = record.text;
    record.totalPages = infoResult.total || 0;
    record.pageCount = record.totalPages;
    const extractedPages = Array.isArray(textResult.pages)
      ? textResult.pages
      : [];
    let processedPages = extractedPages.length
      ? extractedPages.map((page, index) => ({
          page: index + 1,
          text: String(page?.text ?? page ?? ""),
        }))
      : [];
    let ocrStatus = "not_needed";
    if (shouldUseOcr(record.text, record.totalPages)) {
      const ocrResult = await extractTextWithOcr(record.filePath, record.totalPages);
      ocrStatus = ocrResult.status;
      // OCR may be less accurate on a PDF that already has selectable text.
      // Prefer it only when it gives the RAG pipeline materially more content.
      if (ocrResult.text.length > Math.max(300, record.text.length * 1.1)) {
        record.text = ocrResult.text;
        record.extractedText = record.text;
        processedPages = ocrResult.pages;
        ocrStatus = ocrResult.status === "partial" ? "partial_used" : "used";
      }
    }
    record.status = record.text ? "completed" : "failed";
    const pagesWithText = processedPages.length
      ? processedPages.filter((page) => String(page.text || "").trim()).length
      : record.text
        ? record.totalPages
        : 0;
    // Retain per-page text in Mongoose's per-document scratch space ($locals is
    // never persisted to MongoDB) so the AI pipeline can chunk with accurate
    // page numbers and heading structure (§2, §3) instead of estimating them.
    record.$locals.extractedPages = processedPages;
    const questionBlocks =
      record.metadata?.learningSetup?.documentRole === "question_source"
        ? extractQuestionsFromPages(
            processedPages,
          )
        : [];
    record.questionBlocks = questionBlocks.length ? questionBlocks : undefined;
    record.metadata = {
      ...record.metadata,
      processingError: record.text
        ? undefined
        : "PDF is valid but no readable text could be extracted.",
      processingCode: record.text ? undefined : "NO_EXTRACTABLE_TEXT",
      extraction: {
        totalPages: record.totalPages,
        pagesWithText,
        pagesWithoutText: Math.max(0, record.totalPages - pagesWithText),
        characters: record.text.length,
        ocrStatus,
      },
      questionExtraction:
        record.metadata?.learningSetup?.documentRole === "question_source"
          ? {
              status: questionBlocks.length ? "completed" : "no_questions",
              questionCount: questionBlocks.length,
              questionBlocks,
            }
          : undefined,
    };
    console.info(
      JSON.stringify({
        service: "studygenie-ai",
        event: "pdf_extracted",
        filename: record.fileName,
        pages: record.totalPages,
        extractedCharacters: record.text.length,
        ocr_status: ocrStatus,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        service: "studygenie-ai",
        event: "pdf_extraction_failed",
        message: error.message,
      }),
    );
    record.status = "failed";
    record.text = "";
    record.totalPages = 0;
    record.metadata = {
      ...record.metadata,
      processingError: "The uploaded file could not be opened as a valid PDF.",
      processingCode: "PDF_OPEN_FAILED",
      extraction: {
        totalPages: 0,
        pagesWithText: 0,
        pagesWithoutText: 0,
        characters: 0,
      },
    };
  } finally {
    if (parser && typeof parser.destroy === "function") {
      await parser.destroy().catch(() => undefined);
    }
  }
  await record.save();
  return record;
};

const removeUploadedFile = async (filePath, attempts = 5) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch (error) {
      const retryable = ["EBUSY", "EPERM", "EACCES"].includes(error.code);
      if (!retryable || attempt === attempts - 1) {
        console.warn(
          JSON.stringify({
            service: "studygenie-ai",
            event: "upload_cleanup_failed",
            code: error.code || "UNKNOWN",
          }),
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  return false;
};

const uploadPdf = async (userId, file) => {
  if (!file) {
    const error = new Error("No PDF file uploaded");
    error.statusCode = 400;
    throw error;
  }

  const fileBuffer = await fs.promises.readFile(file.path);
  if (
    fileBuffer.length < 5 ||
    fileBuffer.subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    await removeUploadedFile(file.path);
    const error = new Error("The uploaded file is not a valid PDF.");
    error.statusCode = 422;
    throw error;
  }
  const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const duplicate = await PDF.findOne({ user: userId, checksum });
  if (duplicate) {
    await removeUploadedFile(file.path);
    // Re-uploading the same file is a valid retry (for example after a
    // failed setup/AI processing attempt). Reuse the user's existing record
    // instead of creating duplicate database rows or rejecting the upload.
    return duplicate;
  }

  const record = await PDF.create({
    user: userId,
    title: path.basename(file.originalname, path.extname(file.originalname)),
    fileName: file.filename,
    filePath: file.path,
    checksum,
    fileType: "pdf",
    sourceFile: file.originalname,
    pageCount: 0,
    totalPages: 0,
    status: "awaiting_setup",
  });

  record.metadata = { size: file.size, mimeType: file.mimetype };
  await record.save();
  return record;
};

const createLearningPlan = (setup) => ({
  title: `${setup.goal || "Personalized"} learning plan`,
  focus: setup.focusAreas?.length ? setup.focusAreas : ["Everything"],
  outputs: setup.outputTypes?.length
    ? setup.outputTypes
    : ["Smart Notes", "Flashcards", "Quiz"],
  studyTime: setup.studyTime || "1 Hour",
  deadline: setup.deadline || null,
  nextStep: "Review the generated notes, then complete flashcards and a quiz.",
  stages: [
    "Reading PDF",
    "Understanding Concepts",
    "Creating Knowledge Graph",
    "Finding Important Topics",
    "Generating Notes",
    "Building Flashcards",
    "Creating Quiz",
    "Generating Revision Plan",
    "Almost Ready",
  ],
});

const processPdfInternal = async (pdfId, userId, setup) => {
  const pdf = await PDF.findOne({ _id: pdfId, user: userId });
  if (!pdf) {
    const error = new Error("PDF not found");
    error.statusCode = 404;
    throw error;
  }
  if (!setup || !setup.goal || !setup.level || !setup.explanationStyle) {
    const error = new Error(
      "Study goal, learning level, and explanation style are required.",
    );
    error.statusCode = 400;
    throw error;
  }
  const learningPlan = createLearningPlan(setup);
  pdf.status = "processing";
  pdf.metadata = {
    ...pdf.metadata,
    learningSetup: setup,
    learningPlan,
    processingStages: initialStages(),
    pipelineStatus: "processing",
  };
  await pdf.save();
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        learningPreferences: {
          level: setup.level,
          explanationStyle: setup.explanationStyle,
          outputLanguage: setup.outputLanguage || "English",
          aiPersonality: setup.aiPersonality || "Friendly Teacher",
        },
      },
    },
  );
  await ensureProcessed(pdf);
  const figureResult =
    pdf.status === "completed"
      ? await extractFigures(pdf.filePath, pdf._id)
      : { figures: [] };
  pdf.metadata = {
    ...pdf.metadata,
    figures: figureResult.figures || [],
    imageDiagnostics: figureResult.diagnostics || {},
  };
  await pdf.save();
  let pipeline = null;
  if (pdf.status === "completed" && setup.documentRole !== "question_source") {
    const analysis = analyzeDocument(pdf.text);
    try {
      pipeline = await runAiPipeline({
        text: pdf.text,
        pages: pdf.$locals?.extractedPages || null,
        figures: pdf.metadata?.figures || [],
        source: pdf.title,
        pdfId: pdf._id,
        userId,
        totalPages: pdf.totalPages,
        analysis,
        setup,
        onStage: async (processingStages) => {
          pdf.metadata = { ...pdf.metadata, processingStages };
          await pdf.save();
        },
      });
      await DocumentChunk.deleteMany({ pdf: pdf._id, user: userId });
      if (pipeline.semanticIndex.chunks.length) {
        const chunks = pipeline.semanticIndex.chunks.map((chunk) => ({
          ...chunk,
          title: pdf.title,
        }));
        await DocumentChunk.insertMany(
          chunks.map((chunk) => ({
            user: userId,
            pdf: pdf._id,
            title: pdf.title,
            chunkId: chunk.chunkId,
            index: chunk.index,
            text: chunk.text,
            metadata: chunk.metadata,
            embedding: chunk.embedding,
          })),
        );
        try {
          const chromaSync = await syncChunksToChroma(pdf._id, userId, chunks);
          pdf.metadata = { ...pdf.metadata, chromaSync };
        } catch (error) {
          // MongoDB remains the available retrieval fallback if the optional
          // Python/Chroma runtime is unavailable or fails during indexing.
          console.error(
            JSON.stringify({
              service: "studygenie-ai",
              event: "chroma_indexing_failed",
              message: error.message,
            }),
          );
          pdf.metadata = {
            ...pdf.metadata,
            chromaSync: { indexed: 0, status: "failed" },
            processingCode: "VECTOR_STORE_FAILED",
            processingError:
              "The PDF was processed, but the vector store could not be updated.",
          };
        }
      }
      pdf.metadata = {
        ...pdf.metadata,
        analysis,
        semanticIndex: {
          provider: pipeline.semanticIndex.provider,
          dimension: pipeline.semanticIndex.dimension,
          version: pipeline.semanticIndex.version,
          chunkCount: pipeline.semanticIndex.chunks.length,
          indexedAt: new Date(),
        },
        knowledgeGraph: pipeline.knowledgeGraph,
        pipeline: pipeline.pipeline,
        processingStages: pipeline.stages,
        pipelineStatus: "ready",
      };
      await pdf.save();
    } catch (error) {
      pdf.status = "failed";
      pdf.metadata = {
        ...pdf.metadata,
        pipelineStatus: "failed",
        processingCode: "PIPELINE_FAILED",
        processingError: "AI pipeline failed",
      };
      await pdf.save();
      throw error;
    }
  }
  if (pdf.status !== "completed") {
    pdf.metadata = { ...pdf.metadata, pipelineStatus: "failed" };
    await pdf.save();
    return { pdf, learningPlan, generated: {}, pipeline: null };
  }
  const requestedOutputs = new Set(setup.outputTypes || []);
  const generated = {};
  // Retrieve first, generate second: by default setup stops after extraction +
  // indexing above. Study material is generated only on explicit user request
  // (the /notes, /flashcards, /quiz generate endpoints). The legacy inline
  // generation runs only when AUTO_GENERATE_ON_SETUP is enabled.
  if (shouldAutoGenerateMaterials(pdf.status, setup)) {
    if (
      requestedOutputs.has("Smart Notes") ||
      requestedOutputs.has("Handwritten Notes") ||
      requestedOutputs.has("Revision Notes")
    ) {
      generated.notes = await require("./notesService").generateNotes(
        pdf._id,
        userId,
      );
    }
    if (requestedOutputs.has("Flashcards")) {
      generated.flashcards =
        await require("./flashcardService").generateFlashcards({
          pdfId: pdf._id,
          userId,
        });
    }
    if (requestedOutputs.has("Quiz")) {
      generated.quiz = await require("./quizService").generateQuiz({
        pdfId: pdf._id,
        userId,
        numberOfQuestions: setup.level === "Advanced" ? 10 : 5,
      });
    }
  }
  if (pipeline) {
    const completed = new Set();
    if (generated.notes) completed.add("Generating Notes");
    if (generated.flashcards) completed.add("Creating Flashcards");
    if (generated.quiz) completed.add("Preparing Quiz");
    pdf.metadata.processingStages = (pdf.metadata.processingStages || []).map(
      (stage) =>
        completed.has(stage.name)
          ? { ...stage, status: "completed", updatedAt: new Date() }
          : stage,
    );
  }
  pdf.metadata = {
    ...pdf.metadata,
    generatedOutputs: Object.keys(generated),
    plannedOutputs: (setup.outputTypes || []).filter(
      (item) =>
        ![
          "Smart Notes",
          "Handwritten Notes",
          "Revision Notes",
          "Flashcards",
          "Quiz",
        ].includes(item),
    ),
  };
  await pdf.save();
  return {
    pdf,
    learningPlan,
    generated,
    pipeline: pipeline
      ? {
          ...pipeline.pipeline,
          chunks: pipeline.semanticIndex.chunks.length,
          graph: pipeline.knowledgeGraph,
        }
      : null,
  };
};

const processPdf = async (pdfId, userId, setup) => {
  try {
    return await processPdfInternal(pdfId, userId, setup);
  } catch (error) {
    await PDF.updateOne(
      { _id: pdfId, user: userId },
      {
        $set: {
          status: "failed",
          "metadata.pipelineStatus": "failed",
          "metadata.processingCode": "PROCESSING_FAILED",
          "metadata.processingError": String(
            error.message || "PDF processing failed",
          ).slice(0, 500),
        },
      },
    );
    throw error;
  }
};

const setupPdf = async (pdfId, userId, setup) => {
  const pdf = await PDF.findOne({ _id: pdfId, user: userId });
  if (!pdf) {
    const error = new Error("PDF not found");
    error.statusCode = 404;
    throw error;
  }
  if (!setup || !setup.goal || !setup.level || !setup.explanationStyle) {
    const error = new Error(
      "Study goal, learning level, and explanation style are required.",
    );
    error.statusCode = 400;
    throw error;
  }
  if (pdf.status === "processing") {
    const error = new Error("This PDF is already being processed.");
    error.statusCode = 409;
    throw error;
  }

  const learningPlan = createLearningPlan(setup);
  pdf.status = "processing";
  pdf.metadata = {
    ...pdf.metadata,
    learningSetup: setup,
    learningPlan,
    processingStages: initialStages(),
    pipelineStatus: "processing",
    processingError: undefined,
    processingCode: undefined,
  };
  await pdf.save();

  // The upload/setup response must not wait for extraction, embeddings, or
  // Chroma synchronization. The existing processing pipeline runs in the
  // background and remains observable through GET /:pdfId/processing.
  processPdf(pdfId, userId, setup).catch((error) => {
    console.error(
      JSON.stringify({
        service: "studygenie-ai",
        event: "pdf_processing_failed",
        pdfId: String(pdfId),
        message: error.message,
      }),
    );
  });

  return { pdf, learningPlan, generated: {}, pipeline: null };
};

const getAllPdfs = async (userId) => {
  return PDF.find({ user: userId })
    .select("_id title fileName totalPages status createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();
};

// The API should never expose extracted text, local file paths, checksums, or
// the internal AI metadata object. Those fields are required by the services
// but are not needed by the browser.
const toPublicPdf = (pdf) => ({
  _id: pdf._id,
  title: pdf.title,
  fileName: pdf.fileName,
  sourceFile: pdf.sourceFile || pdf.fileName,
  fileType: pdf.fileType || "pdf",
  pageCount: pdf.pageCount || pdf.totalPages || 0,
  totalPages: pdf.totalPages,
  status: pdf.status,
  // Additive readiness signal for retrieval consumers. A PDF can have finished
  // text extraction while its Chroma indexing failed; calling it tutor-ready
  // in that state guarantees an insufficient-context response.
  ragReady: !["failed", "unavailable", "skipped"].includes(
    String(pdf.metadata?.chromaSync?.status || "").toLowerCase(),
  ),
  createdAt: pdf.createdAt,
  updatedAt: pdf.updatedAt,
});

const getPdfById = async (pdfId, userId) => {
  const pdf = await PDF.findOne({ _id: pdfId, user: userId });

  if (!pdf) {
    const error = new Error("PDF not found");
    error.statusCode = 404;
    throw error;
  }

  return pdf;
};

const getPdfDownload = async (pdfId, userId) => {
  const pdf = await PDF.findOne({ _id: pdfId, user: userId }).select(
    "title fileName filePath",
  );

  if (!pdf) {
    const error = new Error("PDF not found");
    error.statusCode = 404;
    throw error;
  }

  const uploadRoot = path.resolve(__dirname, "..", "uploads", "pdfs");
  const filePath = path.resolve(pdf.filePath || "");
  const relativePath = path.relative(uploadRoot, filePath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    const error = new Error("The stored PDF path is invalid.");
    error.statusCode = 500;
    throw error;
  }

  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) throw new Error("Not a file");
  } catch {
    const error = new Error("The requested PDF is no longer available.");
    error.statusCode = 404;
    throw error;
  }

  const safeTitle =
    String(pdf.title || "study-material")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "study-material";
  return { filePath, fileName: `${safeTitle}.pdf` };
};

// Shared readiness gate for every generated resource. Keeping this here
// prevents notes, quizzes, and flashcards from drifting into different
// validation or PDF-processing behavior.
const getReadyPdf = async (pdfId, userId) => {
  const pdf = await getPdfById(pdfId, userId);

  if (pdf.status === "awaiting_setup") {
    const error = new Error(
      "Complete the AI study setup before generating resources.",
    );
    error.statusCode = 409;
    throw error;
  }

  if (pdf.status !== "completed" || !pdf.text) {
    await ensureProcessed(pdf);
  }

  if (pdf.status !== "completed" || !pdf.text) {
    const error = new Error(
      "This PDF contains no machine-readable text. Handwritten or scanned PDFs require OCR before answers can be retrieved.",
    );
    error.statusCode = 422;
    throw error;
  }

  return pdf;
};

const getProcessingStatus = async (pdfId, userId) => {
  const pdf = await getPdfById(pdfId, userId);
  const extraction = pdf.metadata?.extraction || {};
  const semanticIndex = pdf.metadata?.semanticIndex || {};
  const chromaSync = pdf.metadata?.chromaSync || {};
  return {
    success: pdf.status !== "failed",
    pdfId: pdf._id,
    filename: pdf.fileName,
    fileType: pdf.fileType || "pdf",
    sourceFile: pdf.sourceFile || pdf.fileName,
    status: pdf.status,
    pipelineStatus: pdf.metadata?.pipelineStatus || pdf.status,
    stage:
      (pdf.metadata?.processingStages || []).find(
        (item) => item.status === "processing",
      )?.name || null,
    stages: pdf.metadata?.processingStages || [],
    pages: extraction.totalPages || pdf.pageCount || pdf.totalPages || 0,
    pagesWithText: extraction.pagesWithText || 0,
    pagesWithoutText: extraction.pagesWithoutText || 0,
    characters: extraction.characters || pdf.text?.length || 0,
    ocrStatus: extraction.ocrStatus || "not_recorded",
    chunks: semanticIndex.chunkCount || 0,
    embeddings: semanticIndex.chunkCount || 0,
    vectorsStored: chromaSync.status === "ready" ? chromaSync.indexed || 0 : 0,
    vectorStoreStatus: chromaSync.status || "pending",
    questionExtraction: pdf.metadata?.questionExtraction
      ? {
          status: pdf.metadata.questionExtraction.status,
          questionCount: pdf.metadata.questionExtraction.questionCount || 0,
        }
      : null,
    error:
      pdf.status === "failed"
        ? {
            code: pdf.metadata?.processingCode || "PROCESSING_FAILED",
            message: pdf.metadata?.processingError || "PDF processing failed.",
          }
        : null,
    graph: pdf.metadata?.knowledgeGraph
      ? {
          nodes: pdf.metadata.knowledgeGraph.nodeCount,
          edges: pdf.metadata.knowledgeGraph.edgeCount,
        }
      : null,
  };
};

const deletePdf = async (pdfId, userId) => {
  const pdf = await PDF.findOne({ _id: pdfId, user: userId });

  if (!pdf) {
    const error = new Error("PDF not found");
    error.statusCode = 404;
    throw error;
  }

  if (pdf.filePath && fs.existsSync(pdf.filePath)) {
    await fs.promises.unlink(pdf.filePath);
  }

  await Promise.all([
    require("../models/Note").deleteMany({ pdf: pdf._id }),
    require("../models/Quiz").deleteMany({ pdf: pdf._id }),
    require("../models/FlashCards").deleteMany({ pdf: pdf._id }),
    require("../models/Chat").deleteMany({ pdf: pdf._id }),
    DocumentChunk.deleteMany({ user: userId, pdf: pdf._id }),
  ]);
  await PDF.deleteOne({ _id: pdfId, user: userId });

  return { message: "PDF deleted successfully" };
};

const questionNoise =
  /^(?:page\s*\d+|\d+\s*(?:of|\/|-)\s*\d+|section\s*[a-z0-9]*|time\s*:|duration\s*:|marks?\s*:|max(?:imum)?\s+marks|answer\s+(?:all|any)|instructions?|university|semester\s+exam(?:ination)?|date\s*:|roll\s*(?:no|number))/i;
const questionLead =
  /^(?:what|why|when|where|which|who|how|define|describe|explain|discuss|compare|differentiate|write|state|list|illustrate|derive|analyse|analyze|evaluate|give|mention)\b/i;
const cleanQuestionText = (value) =>
  String(value || "")
    .replace(/Downloaded from\s+www\.stuhive\.in[^\n]*/gi, " ")
    .replace(/Prepared By:\s*StuHive\.in/gi, " ")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-:.)\s]+|[-\s]+$/g, "")
    .trim();
const questionTokens = (value) =>
  new Set(
    (value.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter(
      (word) =>
        ![
          "what",
          "which",
          "explain",
          "describe",
          "write",
          "about",
          "with",
          "from",
          "that",
          "this",
        ].includes(word),
    ),
  );
const isDuplicateQuestion = (candidate, accepted) => {
  const left = questionTokens(candidate);
  return accepted.some((item) => {
    const right = questionTokens(item.question);
    const overlap = [...left].filter((token) => right.has(token)).length;
    return overlap / Math.max(1, Math.min(left.size, right.size)) >= 0.82;
  });
};
const mergeQuestionBlocks = (...groups) =>
  groups
    .flat()
    .reduce((accepted, item) => {
      const question = cleanQuestionText(item?.question);
      if (
        question &&
        isValidExtractedQuestion(question) &&
        !isDuplicateQuestion(question, accepted)
      )
        accepted.push({ ...item, question });
      return accepted;
    }, [])
    .slice(0, 20);
const isValidExtractedQuestion = (question) => {
  const letters = (question.match(/[a-z]/gi) || []).length;
  const symbols = (question.match(/[^a-z0-9\s,;:()/'"?-]/gi) || []).length;
  return (
    question.length >= 10 &&
    question.length <= 600 &&
    letters / Math.max(question.length, 1) >= 0.45 &&
    symbols / Math.max(question.length, 1) < 0.12 &&
    !questionNoise.test(question) &&
    (questionLead.test(question) || question.endsWith("?"))
  );
};
const extractQuestionsFromPages = (pages) => {
  const normalizedPages = (pages || []).map(({ page, text }) => ({
    page,
    lines: String(text || "")
      .split(/\r?\n/)
      .map(cleanQuestionText)
      .filter(Boolean),
  }));
  const repeatedLines = new Map();
  normalizedPages.forEach(({ lines }) =>
    new Set(
      lines
        .filter((line) => line.length > 3 && line.length < 120)
        .map((line) => line.toLowerCase()),
    ).forEach((line) =>
      repeatedLines.set(line, (repeatedLines.get(line) || 0) + 1),
    ),
  );
  const accepted = [];
  let current = null;
  const commit = () => {
    if (!current) return;
    const question = cleanQuestionText(current.text);
    if (
      isValidExtractedQuestion(question) &&
      !isDuplicateQuestion(question, accepted)
    )
      accepted.push({ question, sourcePage: current.page });
    current = null;
  };
  normalizedPages.forEach(({ page, lines }) =>
    lines.forEach((line) => {
      if (
        questionNoise.test(line) ||
        repeatedLines.get(line.toLowerCase()) >= 3
      )
        return;
      const numbered = line.match(
        /^(?:q(?:uestion)?\s*)?\(?\d{1,3}\)?\s*(?:\([a-z]\))?\s*[.)\-:]\s*(.+)$/i,
      );
      const bullet = line.match(/^(?:[-*])\s*(.+\?)$/);
      const continuation =
        current &&
        !/[?.!]$/.test(current.text.trim()) &&
        /^(?:and|or|with|that|which|how|why|when|where)\b/i.test(line);
      const standaloneQuestion =
        !continuation &&
        (questionLead.test(line) || (line.endsWith("?") && line.length >= 10));
      if (numbered || bullet || standaloneQuestion) {
        commit();
        current = { page, text: numbered?.[1] || bullet?.[1] || line };
      } else if (current && line.length > 2) {
        current.text += ` ${line}`;
      }
    }),
  );
  commit();
  return accepted.slice(0, 100);
};

const extractQuestions = (text) => {
  const cleaned = String(text || "")
    .replace(/Downloaded from\s+www\.stuhive\.in[^\n]*/gi, " ")
    .replace(/Prepared By:\s*StuHive\.in/gi, " ")
    .replace(/JAVA\s+HANDWRITTEN\s+NOTES/gi, " ")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, " ")
    .replace(/[•●]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const marker =
    /(?:^|\bl\s+|\|\s*)(?:q(?:uestion)?\s*)?\d+\s*(?:\([a-z]\))?\s*[.)\-:]\s*/gi;
  const matches = [...cleaned.matchAll(marker)];
  const questions = matches
    .map((match, index) => {
      const start = match.index + match[0].length;
      const end = matches[index + 1]?.index ?? cleaned.length;
      return cleaned
        .slice(start, end)
        .replace(/\bQuick Revision Checklist\b[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    })
    .filter(
      (question) =>
        question.length > 8 &&
        !/^(answer|solution|marks?|section)\b/i.test(question) &&
        // Numbered chapter headings (for example, "1. Arrays") are not
        // questions even though they use the same numeric marker.
        !(
          question.length < 40 &&
          !/[?.!]$/.test(question) &&
          /^[A-Z][A-Za-z\s&/-]+$/.test(question)
        ),
    );
  return [...new Set(questions)].slice(0, 200);
};

const answerFromRawContext = (question, rawText) => {
  const ignored = new Set([
    "what",
    "when",
    "where",
    "which",
    "explain",
    "write",
    "difference",
    "between",
    "does",
    "have",
    "using",
    "their",
    "there",
    "that",
    "this",
  ]);
  const terms = (question.toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter(
    (term) => !ignored.has(term),
  );
  const source = String(rawText || "")
    .replace(/Downloaded from\s+www\.stuhive\.in[^\n]*/gi, " ")
    .replace(/Prepared By:\s*StuHive\.in/gi, " ")
    .replace(/JAVA\s+HANDWRITTEN\s+NOTES/gi, " ")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, " ");
  const sentences = source
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 20);
  const ranked = sentences
    .map((sentence) => ({
      sentence,
      score: terms.reduce(
        (score, term) =>
          score + (sentence.toLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  if (!ranked.length)
    return "Information not available in the provided source.";
  return ranked.map((item) => `• ${item.sentence}`).join("\n");
};

const drawConceptDiagram = (document, title, text, availableWidth) => {
  const x = document.page.margins.left;
  const y = document.y + 12;
  const width = availableWidth;
  const boxWidth = Math.min(105, (width - 54) / 4);
  const boxHeight = 34;
  const labels = text.split("|").slice(0, 4);
  document
    .save()
    .roundedRect(x, y, width, 92, 8)
    .fillAndStroke("#f1f8f0", "#b8d9ae");
  document
    .fillColor("#12351d")
    .fontSize(10)
    .text(title, x + 12, y + 10);
  labels.forEach((label, index) => {
    const boxX = x + 12 + index * ((width - 24) / labels.length);
    const boxY = y + 39;
    document
      .roundedRect(boxX, boxY, boxWidth, boxHeight, 5)
      .fillAndStroke("#ffffff", "#4aa83a");
    document
      .fillColor("#234b2a")
      .fontSize(8.5)
      .text(label, boxX + 6, boxY + 11, {
        width: boxWidth - 12,
        align: "center",
      });
    if (index < labels.length - 1) {
      document
        .moveTo(boxX + boxWidth + 2, boxY + 17)
        .lineTo(boxX + (width - 24) / labels.length - 2, boxY + 17)
        .stroke("#4aa83a");
    }
  });
  document.restore();
  document.moveDown(5.2);
};

const normalizePdfText = (value) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u00AD\u200B\u200C\u200D]/g, "")
    .replace(/ï¿¾|ï¿½|�/g, "-")
    .replace(/\s+/g, " ")
    .trim();

// Convert untrusted model output into human-readable text before it reaches
// PDFKit.  Structured responses are unwrapped recursively; plain text and
// malformed JSON remain usable without ever being serialized as JSON.
const normalizeGeneratedContent = (value) => {
  const seen = new Set();
  const walk = (input, depth = 0) => {
    if (input == null || depth > 12) return "";
    if (typeof input === "string") {
      const text = input
        .trim()
        .replace(/^```(?:json|javascript|python)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      if (!text) return "";
      try {
        return walk(JSON.parse(text), depth + 1);
      } catch {
        /* plain text */
      }
      // Local models frequently emit Python repr syntax (single-quoted dicts).
      // Convert only quote delimiters, preserving apostrophes inside words.
      try {
        const jsonish = text
          .replace(/([{,]\s*)'([^']+)'\s*:/g, '$1"$2":')
          .replace(/:\s*'([^']*)'/g, ':"$1"')
          .replace(/,\s*'([^']*)'/g, ',"$1"')
          .replace(/^'([^']*)'$/g, '"$1"');
        return walk(JSON.parse(jsonish), depth + 1);
      } catch {
        /* continue with embedded/plain text */
      }
      const pointsMatch = text.match(
        /['\"]key_points['\"]\s*:\s*\[([^\]]*)\]/i,
      );
      if (pointsMatch) {
        const points = [
          ...pointsMatch[1].matchAll(/['\"]((?:\\.|[^'\"])*)['\"]/g),
        ]
          .map((match) => match[1].replace(/\\(['\"])/g, "$1").trim())
          .filter(Boolean);
        if (points.length)
          return `Key points:\n${points.map((point) => `• ${point}`).join("\n")}`;
      }
      const start = text.search(/[\\[{]/);
      if (start >= 0) {
        for (let end = text.length; end > start + 1; end -= 1) {
          try {
            return `${text.slice(0, start).trim()} ${walk(JSON.parse(text.slice(start, end)), depth + 1)}`.trim();
          } catch {
            /* continue */
          }
        }
      }
      return text.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
    if (typeof input !== "object" || seen.has(input)) return "";
    seen.add(input);
    if (Array.isArray(input))
      return input
        .map((item) => walk(item, depth + 1))
        .filter(Boolean)
        .join("\n\n");
    const preferred = [
      "answer",
      "explanation",
      "content",
      "text",
      "summary",
      "body",
      "description",
    ];
    const parts = [];
    for (const key of preferred)
      if (input[key] != null) {
        const part = walk(input[key], depth + 1);
        if (part) parts.push(part);
      }
    if (input.key_points || input.keyPoints) {
      const points = input.key_points || input.keyPoints;
      if (Array.isArray(points) && points.length)
        parts.push(
          `Key points:\n${points.map((p) => `• ${walk(p, depth + 1)}`).join("\n")}`,
        );
    }
    return parts.length
      ? parts.join("\n\n")
      : Object.entries(input)
          .filter(([k]) => !["sources", "images", "metadata"].includes(k))
          .map(([, v]) => walk(v, depth + 1))
          .filter(Boolean)
          .join("\n\n");
  };
  return String(walk(value) || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u00AD\u200B\u200C\u200D]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const normalizeQuestionForPdf = (value) => {
  let question = normalizePdfText(value)
    .replace(/\s+in\s+this\s+PDF\s*\??$/i, "")
    .trim();
  if (/^what\s+is\s+gan\b/i.test(question))
    question = question.replace(/^what\s+is\s+gan\b/i, "What is a GAN");
  question = question.charAt(0).toUpperCase() + question.slice(1);
  return question.endsWith("?") ? question : `${question}?`;
};

// A grounded 10-mark answer is emitted by the LLM as light markdown (## headings,
// "1. Introduction" section numbers, **bold** labels, "- " bullets). PDFKit has no
// markdown, so the exam renderer detects heading/bullet lines and strips inline
// markers per line — never across the whole answer, which would collapse newlines.
const isExamHeadingLine = (line) =>
  /^#{1,6}\s+\S/.test(line) || // "## Introduction"
  /^\d+[.)]\s+[A-Za-z]/.test(line) || // "1. Introduction"
  /^\*\*[^*]+\*\*:?\s*$/.test(line); // "**Introduction**"

const stripInlineMarkdown = (value) =>
  normalizePdfText(value)
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*/g, "")
    .trim();

// Figure/table asset types carried on a retrieval source record (§7). Text-only:
// captions are shown, images are never claimed to have been read.
const EXAM_FIGURE_TYPES = new Set([
  "figure",
  "image",
  "chart",
  "diagram",
  "table",
]);

const isUsefulFigureCaption = (value) => {
  const caption = normalizePdfText(value);
  if (!caption) return false;
  // Do not render empty labels such as "Source figure" or a broken OCR label.
  // A real image still renders; only the misleading text is suppressed.
  if (/^(?:source\s*)?(?:fig(?:ure)?|image|diagram|chart|table)\.?$/i.test(caption)) {
    return false;
  }
  return caption.replace(/[^a-z0-9]/gi, "").length >= 5;
};

const renderStudyMaterialPdf = async ({
  filePath,
  title,
  notes = {},
  questions = [],
  generationType = "qa",
  sourceText = "",
}) => {
  const margins = { top: 58, bottom: 52, left: 58, right: 58 };
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margins,
      bufferPages: true,
    });
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    document.pipe(stream);
    const width = document.page.width - margins.left - margins.right;
    const bottom = document.page.height - margins.bottom;
    const setColumn = () => {
      document.x = margins.left;
      document.lineGap = 2;
    };
    const heading = (text, size = 13) => {
      setColumn();
      document
        .moveDown(0.6)
        .fillColor("#12351d")
        .fontSize(size)
        .font("Helvetica-Bold")
        .text(normalizePdfText(text), { width, underline: true });
    };
    const paragraph = (text, size = 10.5) => {
      setColumn();
      document
        .fillColor("#333333")
        .fontSize(size)
        .text(normalizePdfText(text), { width, lineGap: 2 });
    };
    const list = (items) =>
      (items || []).forEach((item) =>
        paragraph(
          `• ${normalizeGeneratedContent(typeof item === "string" ? item : item.term || item.text || item.definition || item.description || "")}`,
        ),
      );

    setColumn();
    document
      .moveDown(5)
      .fillColor("#12351d")
      .fontSize(27)
      .text("STUDYGENIE-AI", { width, align: "center" });
    document
      .moveDown(0.5)
      .fillColor("#222222")
      .fontSize(20)
      .text(
        generationType === "quiz"
          ? "Assessment Quiz"
          : generationType === "notes"
            ? "Comprehensive Study Material"
            : "Descriptive Questions & Answers",
        { width, align: "center" },
      );
    document
      .moveDown(0.35)
      .fillColor("#666666")
      .fontSize(12)
      .text(`Subject: ${normalizePdfText(title)}`, { width, align: "center" });
    document.addPage();
    setColumn();
    if (generationType === "notes") {
      // Each export stays mode-specific: Q&A and quiz PDFs contain only their
      // requested assessment content, and notes PDFs contain only study notes.
      document
        .fillColor("#12351d")
        .fontSize(16)
        .text("1. Study Notes", { width });
      if (notes.summary) paragraph(notes.summary);
      [
        ["Important Concepts", notes.key_concepts],
        ["Important Points", notes.important_points],
        ["Revision Tips", notes.revision_tips],
      ].forEach(([label, items]) => {
        if (items?.length) {
          heading(label);
          list(items);
        }
      });
    }
    if (generationType !== "notes" && questions.length) {
      heading(
        `1. ${generationType === "quiz" ? "Quiz" : "Questions & Answers"}`,
        16,
      );
      questions.forEach((item, index) => {
        const question = normalizeQuestionForPdf(item.question);
        const rawAnswer = normalizeGeneratedContent(
          item.answer || item.explanation || item,
        );
        const answerFlat = normalizePdfText(rawAnswer); // flattened form for the page-break height estimate only
        const keyPoints = item.key_points?.length
          ? `\nKey points:\n${item.key_points.map((point) => `- ${normalizeGeneratedContent(point)}`).join("\n")}`
          : "";
        const source = item.source_pages?.length
          ? `\nSource: Uploaded Study Material, p. ${item.source_pages.join(", ")}`
          : "";
        const options =
          generationType === "quiz" && item.options?.length
            ? `\n${item.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}) ${normalizePdfText(option)}`).join("\n")}`
            : "";
        const block = `Q${String(index + 1).padStart(2, "0")}\n${question}${options}\n\nANSWER\n${answerFlat}${keyPoints}${source}`;
        setColumn();
        const blockHeight =
          document.heightOfString(block, { width, lineGap: 2 }) + 18;
        if (document.y + blockHeight > bottom) document.addPage();
        setColumn();
        document
          .fillColor("#12351d")
          .fontSize(12)
          .text(`Q${String(index + 1).padStart(2, "0")}`, { width });
        paragraph(question, 11);
        if (options) paragraph(options, 10);
        const renderSourceFigures = () => {
          // Figures are selected only from source-page evidence; no diagram is
          // invented. This helper is called after the Definition section.
          for (const image of Array.isArray(item.images) ? item.images : []) {
          const imagePath = image.image_path || image.imagePath;
          if (!imagePath || !fs.existsSync(imagePath)) {
            console.warn(
              JSON.stringify({
                service: "studygenie-ai",
                event: "image_missing",
                image_id: image.figure_id || image.image_id,
                image_path: imagePath || null,
              }),
            );
            continue;
          }
          try {
            const opened = document.openImage(imagePath);
            const scale = Math.min(width / opened.width, 260 / opened.height, 1);
            const renderedHeight = opened.height * scale;
            if (document.y + renderedHeight + 35 > bottom) document.addPage();
            setColumn();
            document.image(imagePath, document.x, document.y, {
              width: opened.width * scale,
              height: renderedHeight,
            });
            document.y += renderedHeight + 6;
            if (isUsefulFigureCaption(image.caption)) {
              paragraph(`Figure: ${normalizePdfText(image.caption)}`, 9);
            }
          } catch (error) {
            console.warn(
              JSON.stringify({
                service: "studygenie-ai",
                event: "image_render_failed",
                image_path: imagePath,
                message: error.message,
              }),
            );
          }
          }
        };
        heading("ANSWER", 10);
        // Render the model's structured 10-mark answer line by line so section
        // headings (## / "1." / **bold**) and bullets keep their hierarchy instead
        // of collapsing into one wall of text (§5/§13). A short answer with no
        // heading lines simply renders as a single paragraph, as before.
        let sourceFiguresRendered = false;
        for (const rawLine of rawAnswer.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          if (
            !sourceFiguresRendered &&
            /^2[.)]\s+(?:point[- ]wise|detailed|main)\s+/i.test(line)
          ) {
            renderSourceFigures();
            sourceFiguresRendered = true;
          }
          if (isExamHeadingLine(line)) heading(stripInlineMarkdown(line), 11);
          else if (/^[-*•]\s+/.test(line))
            paragraph(
              `• ${stripInlineMarkdown(line.replace(/^[-*•]\s+/, ""))}`,
              10.5,
            );
          else paragraph(stripInlineMarkdown(line), 10.5);
        }
        // If the model did not emit the expected section heading, retain the
        // trusted figure rather than silently dropping it.
        if (!sourceFiguresRendered) renderSourceFigures();
        if (keyPoints) paragraph(keyPoints, 10);
        if (source) paragraph(source, 9);
      });
    }
    const range = document.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      document.switchToPage(page);
      document.save();
      document
        .fillColor("#777777")
        .fontSize(8.5)
        .text(
          `StudyGenie-AI                                      ${page + 1}`,
          margins.left,
          document.page.height - margins.bottom - 12,
          { width, lineBreak: false },
        );
      document.restore();
    }
    document.flushPages();
    document.end();
  });
};

const renderExamAnswerPdf = async ({
  filePath,
  title,
  question,
  answer,
  sources = [],
  sourcePages = [],
}) => {
  const margins = { top: 58, bottom: 52, left: 58, right: 58 };
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margins,
      bufferPages: true,
    });
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    document.pipe(stream);
    const width = document.page.width - margins.left - margins.right;
    const bottom = document.page.height - margins.bottom;
    const setColumn = () => {
      document.x = margins.left;
      document.lineGap = 2;
    };
    const ensureSpace = (needed) => {
      if (document.y + needed > bottom) document.addPage();
      setColumn();
    };
    const sectionHeading = (text) => {
      ensureSpace(46);
      document
        .moveDown(0.5)
        .fillColor("#12351d")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(normalizePdfText(text), { width, underline: true });
    };
    const paragraph = (text, size = 10.5) => {
      setColumn();
      document
        .fillColor("#333333")
        .font("Helvetica")
        .fontSize(size)
        .text(normalizeGeneratedContent(text), { width, lineGap: 2 });
    };
    const bullet = (text) => {
      setColumn();
      document
        .fillColor("#333333")
        .fontSize(10.5)
        .text(`• ${text}`, { width, indent: 10, lineGap: 2 });
    };

    // Cover header (§13).
    setColumn();
    document
      .moveDown(4)
      .fillColor("#12351d")
      .fontSize(27)
      .text("STUDYGENIE-AI", { width, align: "center" });
    document
      .moveDown(0.5)
      .fillColor("#222222")
      .fontSize(20)
      .text("Exam Answer (10 Marks)", { width, align: "center" });
    document
      .moveDown(0.35)
      .fillColor("#666666")
      .fontSize(12)
      .text(`Subject: ${normalizePdfText(title)}`, { width, align: "center" });
    document.addPage();

    // Question.
    setColumn();
    document
      .fillColor("#12351d")
      .font("Helvetica-Bold")
      .fontSize(15)
      .text("Question", { width, underline: true });
    paragraph(normalizePdfText(question), 12);
    document.moveDown(0.6);
    setColumn();
    document.fillColor("#12351d").fontSize(15).text("Answer", { width });

    // Answer body: render the model's structured sections. Headings are styled;
    // everything else flows as paragraphs/bullets. We never inject a diagram or
    // page reference the answer/sources did not actually provide (§9).
    for (const rawLine of String(answer || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (isExamHeadingLine(line)) {
        sectionHeading(stripInlineMarkdown(line));
      } else if (/^[-*•]\s+/.test(line)) {
        bullet(stripInlineMarkdown(line.replace(/^[-*•]\s+/, "")));
      } else {
        paragraph(stripInlineMarkdown(line));
      }
    }

    // Render only real, readable source images. A caption without a usable image
    // is not a figure and must never create a broken "Source figure" section.
    const figures = (sources || []).filter(
      (source) =>
        source &&
        EXAM_FIGURE_TYPES.has(String(source.asset_type || "").toLowerCase()) &&
        isUsefulFigureCaption(source.caption) &&
        (source.image_path || source.imagePath) &&
        fs.existsSync(source.image_path || source.imagePath),
    );
    if (figures.length) {
      sectionHeading("Figures referenced");
      figures.forEach((figure) => {
        const imagePath = figure.image_path || figure.imagePath;
        try {
          const image = document.openImage(imagePath);
          const maxWidth = width;
          const maxHeight = 260;
          const scale = Math.min(
            maxWidth / image.width,
            maxHeight / image.height,
            1,
          );
          ensureSpace(Math.min(maxHeight, image.height * scale) + 30);
          document.image(imagePath, margins.left, document.y, {
            width: image.width * scale,
            height: image.height * scale,
          });
          document.y += image.height * scale + 8;
          paragraph(`Figure: ${normalizePdfText(figure.caption)}`, 9);
        } catch (error) {
          console.warn(
            JSON.stringify({
              service: "studygenie-ai",
              event: "image_render_failed",
              image_path: imagePath,
              message: error.message,
            }),
          );
        }
      });
    }

    // Source page references — only pages that actually backed the answer (§9, §13).
    if ((sourcePages || []).length) {
      sectionHeading("Source references");
      paragraph(`Uploaded study material, p. ${sourcePages.join(", ")}`, 10);
    }

    // Footer page numbers (§13).
    const range = document.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page += 1) {
      document.switchToPage(page);
      document.save();
      document
        .fillColor("#777777")
        .fontSize(8.5)
        .text(
          `StudyGenie-AI                                      ${page + 1}`,
          margins.left,
          document.page.height - margins.bottom - 12,
          { width, lineBreak: false },
        );
      document.restore();
    }
    document.flushPages();
    document.end();
  });
};

// Grounded 10-mark exam answer (§8). No retrieval logic lives here: this is the
// export wrapper around the existing RAG service in structured "10_mark" mode,
// so the async Note-job route (§14) can reuse it exactly like the other exports.
// The answer stays grounded in the SELECTED raw PDF — pdfId is pinned to rawPdfId
// so a 10-mark export can never retrieve a different uploaded document.
const generateExamAnswerPdf = async ({
  rawPdfId,
  questionText = "",
  userId,
}) => {
  const rawPdf = await getReadyPdf(rawPdfId, userId);
  const question = normalizePdfText(questionText).trim();
  if (!question) {
    const error = new Error(
      "A question is required to generate a 10-mark answer.",
    );
    error.statusCode = 400;
    error.code = "QUESTION_REQUIRED";
    throw error;
  }
  // Lazy require avoids a module-load cycle (ragService spawns the Python AI layer;
  // pdfService is required widely) and scopes the dependency to this one path.
  const ragService = require("./ragService");
  const rag = await ragService.answerQuestion({
    question,
    userId: String(userId),
    pdfId: String(rawPdfId),
    questionType: "10_mark",
  });
  const answer = String(rag.answer || "").trim();
  if (!answer) {
    const error = new Error(
      "The AI could not generate a 10-mark answer from the uploaded material.",
    );
    error.statusCode = 422;
    error.code = "NO_EXAM_ANSWER";
    throw error;
  }
  const sources = Array.isArray(rag.sources) ? rag.sources : [];
  // Only real, deduplicated pages that actually backed the answer (§9, §13).
  const sourcePages = [
    ...new Set(
      sources
        .map((source) => source.page_number)
        .filter((page) => page !== null && page !== undefined),
    ),
  ].sort((a, b) => Number(a) - Number(b));
  const outputDir = path.resolve(__dirname, "..", "uploads", "generated");
  await fs.promises.mkdir(outputDir, { recursive: true });
  const fileName = `exam_${String(userId)}_${Date.now()}.pdf`;
  const filePath = path.join(outputDir, fileName);
  await renderExamAnswerPdf({
    filePath,
    title: rawPdf.title,
    question,
    answer,
    sources,
    sourcePages,
  });
  const content = `# ${rawPdf.title}\n\n## Question\n${question}\n\n## 10-Mark Answer\n\n${answer}`;
  // Shape mirrors generateQuestionAnswerPdf so the Note-job route persists it
  // identically. `processing` carries only grounding flags already surfaced by the
  // chat endpoint — never raw ChromaDB metadata or internal prompts (security).
  return {
    filePath,
    fileName,
    content,
    notes: {},
    questions: [],
    answers: [],
    sourcePages,
    processing: {
      mode: rag.mode || null,
      retrievalMethod: rag.retrievalMethod || null,
      rag_supported: rag.rag_supported === true,
      rag_complete: rag.rag_complete === true,
      llm_used: rag.llm_used === true,
      questionType: rag.questionType || "10_mark",
    },
  };
};

const generateQuestionAnswerPdf = async ({
  rawPdfId,
  questionPdfId,
  questionText = "",
  questionImages = [],
  userId,
  generationType = "qa",
  count,
  onProgress,
}) => {
  const reqStart = Date.now();
  const rawPdf = await getReadyPdf(rawPdfId, userId);
  // Backfill figures for PDFs processed before figure extraction was connected
  // to ingestion. The extractor manifest makes this a cheap cache hit after the
  // first successful run; failures remain visible in persisted diagnostics.
  if (
    !Array.isArray(rawPdf.metadata?.figures) ||
    !rawPdf.metadata.figures.length
  ) {
    const figureResult = await extractFigures(rawPdf.filePath, rawPdf._id);
    rawPdf.metadata = {
      ...rawPdf.metadata,
      figures: figureResult.figures || [],
      imageDiagnostics: figureResult.diagnostics || {},
    };
    await rawPdf.save();
    console.info(
      JSON.stringify({
        service: "studygenie-ai",
        event: "image_backfill",
        pdf_id: String(rawPdf._id),
        image_extraction_count: rawPdf.metadata.figures.length,
        image_failed_count: Number(
          figureResult.diagnostics?.image_failed_count || 0,
        ),
      }),
    );
  }
  const questionPdf = questionPdfId
    ? await getReadyPdf(questionPdfId, userId)
    : null;
  const textQuestions = questionText.trim()
    ? extractQuestionsFromPages([{ page: null, text: questionText }])
    : [];
  const pdfQuestions =
    questionPdf?.metadata?.questionExtraction?.questionBlocks ||
    (questionPdf
      ? extractQuestionsFromPages([{ page: null, text: questionPdf.text }])
      : []);
  const sourceQuestions = mergeQuestionBlocks(textQuestions, pdfQuestions);
  if (questionPdf && !sourceQuestions.length) {
    const error = new Error(
      "No valid questions were detected in the Question Source PDF.",
    );
    error.statusCode = 422;
    error.code = "NO_VALID_QUESTIONS";
    throw error;
  }
  const generated = await generateAiMaterials({
    pdf: rawPdf,
    userId,
    generationType,
    sourceQuestions,
    sourceImages: questionImages,
    count,
    onProgress,
  });
  const questions = generated.questions || [];
  if (!questions.length) {
    const error = new Error(
      "The PDF was processed, but the AI could not generate enough supported questions.",
    );
    error.statusCode = 422;
    throw error;
  }
  const notesMarkdown = formatNotesMarkdown(
    rawPdf.title,
    generated.notes || {},
  );
  const questionBankMarkdown = formatQuestionBankMarkdown(
    rawPdf.title,
    questions,
    generationType,
  );
  const content = `${notesMarkdown}\n\n---\n\n${questionBankMarkdown}`;
  /*
    // Keep generated answers grounded in the selected Raw Context PDF. The
    // existing RAG service remains available to chat, but this export must not
    // accidentally retrieve a different uploaded document.
  */
  const outputDir = path.resolve(__dirname, "..", "uploads", "generated");
  await fs.promises.mkdir(outputDir, { recursive: true });
  const fileName = `notes_${String(userId)}_${Date.now()}.pdf`;
  const filePath = path.join(outputDir, fileName);
  const renderStart = Date.now();
  const allFigures = rawPdf.metadata?.figures || [];
  questions.forEach((item) => {
    // Page evidence is a ranking signal, not permission to attach every nearby
    // image. Missing page evidence intentionally produces [] unless a figure has
    // independently strong question/caption/context relevance.
    item.images = selectRelevantFigures({
      figures: allFigures,
      question: item.question,
      retrievedContext: item.answer,
      sourcePages: item.source_pages || [],
      userId,
      pdfId: rawPdf._id,
    });
  });
  console.info(
    JSON.stringify({
      service: "studygenie-ai",
      event: "image_selection",
      pdf_id: String(rawPdf._id),
      extracted_image_count: allFigures.length,
      question_count: questions.length,
      relevance_threshold: IMAGE_RELEVANCE_THRESHOLD,
      max_image_results: IMAGE_MAX_RESULTS,
      selected_image_count: questions.reduce(
        (sum, item) => sum + item.images.length,
        0,
      ),
    }),
  );
  await renderStudyMaterialPdf({
    filePath,
    title: rawPdf.title,
    notes: generated.notes || {},
    questions,
    generationType,
    sourceText: rawPdf.text,
  });
  // [PDF-PERF] Request-level timing (durations + counts only, never PDF text): the
  // pdfkit render step (previously untimed) plus the end-to-end total covering
  // load -> AI generate -> render. Additive; does not affect the returned payload.
  try {
    console.log(
      JSON.stringify({
        service: "studygenie-ai",
        event: "pdf_perf",
        generationType,
        question_count: questions.length,
        pdf_render_ms: Date.now() - renderStart,
        total_ms: Date.now() - reqStart,
      }),
    );
  } catch {
    /* logging must never break generation */
  }
  return {
    filePath,
    fileName,
    content,
    notes: generated.notes || {},
    questions,
    answers: questions,
    sourcePages: generated.source_pages || [],
    processing: generated.processing,
  };

  /* Legacy inline renderer removed; renderStudyMaterialPdf is the sole renderer.
      items.forEach((item) => document.moveDown(.15).fillColor("#333333").fontSize(11).text(`• ${typeof item === "string" ? item : item.term || item.text || JSON.stringify(item)}`, { lineGap: 2 }));
    });
    if (generationType !== "notes") {
      document.moveDown(1).fillColor("#12351d").fontSize(16).text(generationType === "quiz" ? "2. Quiz" : "2. Questions & Answers");
      questions.forEach((item, index) => {
        document.moveDown(.7).fillColor("#12351d").fontSize(13).text(`Q${index + 1}. ${item.question}`, { lineGap: 2 });
        if (generationType === "quiz") (item.options || []).forEach((option, optionIndex) => document.moveDown(.1).fillColor("#333333").fontSize(10.5).text(`${String.fromCharCode(65 + optionIndex)}) ${option}`, { lineGap: 1 }));
        document.moveDown(.2).fillColor("#12351d").fontSize(11).text(`Answer: ${item.answer}`);
        if (item.explanation) document.moveDown(.1).fillColor("#333333").fontSize(10.5).text(`Explanation: ${item.explanation}`, { lineGap: 2 });
        if (item.key_points?.length) document.moveDown(.1).fillColor("#333333").fontSize(10.5).text(`Key points: ${item.key_points.join("; ")}`, { lineGap: 2 });
        if (item.source_pages?.length) document.moveDown(.1).fillColor("#666666").fontSize(9.5).text(`Source: Uploaded Study Material, p. ${item.source_pages.join(", ")}`);
      });
    }
    Legacy renderer removed.
    document.flushPages(); document.end();
  });
  */
};

module.exports = {
  uploadPdf,
  setupPdf,
  processPdf,
  analyzeDocument,
  ensureProcessed,
  getAllPdfs,
  toPublicPdf,
  getPdfById,
  getPdfDownload,
  getReadyPdf,
  getProcessingStatus,
  deletePdf,
  generateQuestionAnswerPdf,
  generateExamAnswerPdf,
  renderStudyMaterialPdf,
  renderExamAnswerPdf,
  normalizeGeneratedContent,
  normalizeGeneratedContent,
  isExamHeadingLine,
  stripInlineMarkdown,
  isUsefulFigureCaption,
  selectRelevantFigures,
  extractQuestions,
  extractQuestionsFromPages,
  shouldAutoGenerateMaterials,
  shouldUseOcr,
};
