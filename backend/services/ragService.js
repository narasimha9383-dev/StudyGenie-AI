const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { localLlamaManager } = require("./localLlamaManager");

const answerCache = new Map();
const cacheMaxEntries = Math.max(
  1,
  Number(process.env.RAG_ANSWER_CACHE_MAX_ENTRIES || 100),
);
const cacheTtlMs = Math.max(
  1000,
  Number(process.env.RAG_ANSWER_CACHE_TTL_MS || 600000),
);

const normalizeConversationHistory = (history) =>
  (Array.isArray(history) ? history : [])
    .slice(-5)
    .map((entry) => ({
      question: String(entry?.question || "").trim().slice(0, 600),
      answer: String(entry?.answer || "").trim().slice(0, 1200),
    }))
    .filter((entry) => entry.question && entry.answer);

const cacheKey = ({ userId, pdfId, question, questionType, conversationHistory }) => {
  const normalized = String(question || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const queryHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      question: normalized,
      history: normalizeConversationHistory(conversationHistory),
    }))
    .digest("hex");
  return `${String(userId || "")}:${String(pdfId || "")}:${String(questionType || "normal")}:${queryHash}`;
};

const getCachedAnswer = (key) => {
  const cached = answerCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > cacheTtlMs) {
    answerCache.delete(key);
    return null;
  }
  // A document may finish indexing after an earlier request found no evidence.
  // Never keep that negative result around: it would make the Tutor repeat the
  // fallback until TTL expiry even though the material is now searchable.
  if (
    !cached.value ||
    !["rag", "rag_enriched"].includes(cached.value.mode) ||
    !Array.isArray(cached.value.sources) ||
    cached.value.sources.length === 0
  ) {
    answerCache.delete(key);
    return null;
  }
  answerCache.delete(key);
  answerCache.set(key, cached);
  return cached.value;
};

const setCachedAnswer = (key, value) => {
  // Cache only answers backed by the selected user's indexed PDF. This keeps
  // the cache an optimisation, never a source of stale "not found" results.
  if (
    !value ||
    !["rag", "rag_enriched"].includes(value.mode) ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0
  ) return;
  answerCache.set(key, { createdAt: Date.now(), value });
  while (answerCache.size > cacheMaxEntries)
    answerCache.delete(answerCache.keys().next().value);
};

const isUsablePythonExecutable = (candidate) => {
  if (!candidate || !fs.existsSync(candidate)) return false;

  const probe = require("child_process").spawnSync(
    candidate,
    // Do not import the full RAG stack here. Loading sentence-transformers can
    // exceed this short probe timeout on a cold machine, falsely marking a
    // perfectly usable Python installation as unavailable.
    ["-c", "import sys; assert sys.version_info >= (3, 10); print(sys.executable)"],
    {
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
};

const resolvePythonExecutable = (backendRoot) => {
  const localAppData = process.env.LOCALAPPDATA || "";
  const systemPythonCandidates =
    process.platform === "win32"
      ? [
          "Python313",
          "Python312",
          "Python311",
          "Python310",
        ].map((version) =>
          path.join(localAppData, "Programs", "Python", version, "python.exe"),
        )
      : ["/usr/bin/python3", "/usr/local/bin/python3"];
  const candidates = [
    process.platform === "win32"
      ? path.join(backendRoot, ".venv", "Scripts", "python.exe")
      : path.join(backendRoot, ".venv", "bin", "python"),
    process.platform === "win32"
      ? path.join(backendRoot, "..", ".venv", "Scripts", "python.exe")
      : path.join(backendRoot, "..", ".venv", "bin", "python"),
    process.env.PYTHON_BIN,
    ...systemPythonCandidates,
  ].filter(Boolean);

  const usable = candidates.find(isUsablePythonExecutable);

  if (!usable) {
    const fallback =
      process.platform === "win32"
        ? path.join(backendRoot, ".venv", "Scripts", "python.exe")
        : path.join(backendRoot, ".venv", "bin", "python");
    const error = new Error(
      `Python executable not found or not usable: ${fallback}`,
    );
    error.code = "PYTHON_EXECUTABLE_NOT_FOUND";
    error.statusCode = 503;
    error.expose = true;
    throw error;
  }

  return usable;
};

const addStderrToError = (error, stderr) => {
  const details = String(stderr || "").trim();
  if (details) error.message = `${error.message} ${details}`;
  error.stderr = stderr;
  return error;
};

const runPythonProcess = ({ pythonExecutable, args, cwd, env, timeoutMs }) =>
  new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(pythonExecutable, args, {
      cwd,
      env,
      windowsHide: true,
    });
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      handler(value);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("[ANSWER-PERF]") || line.includes("[LLM-PERF]"))
          console.log(line);
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      error.code = "PYTHON_PROCESS_START_FAILED";
      finish(reject, addStderrToError(error, stderr));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        const error = new Error(
          `Python process timed out after ${timeoutMs} ms.`,
        );
        error.code = "PYTHON_PROCESS_TIMEOUT";
        return finish(reject, addStderrToError(error, stderr));
      }
      if (code !== 0) {
        const error = new Error(
          `Python process exited with code ${code}${signal ? ` (${signal})` : ""}.`,
        );
        error.code = "PYTHON_PROCESS_FAILED";
        error.exitCode = code;
        error.signal = signal;
        return finish(reject, addStderrToError(error, stderr));
      }
      finish(resolve, { stdout, stderr, code, signal });
    });
  });

let answerWorker = null;
let answerWorkerSeq = 0;
const answerWorkerPending = new Map();

const getAnswerWorker = ({ pythonExecutable, scriptPath, cwd, env }) => {
  if (answerWorker && !answerWorker.killed) return answerWorker;
  answerWorker = spawn(pythonExecutable, [scriptPath, "--answer-worker"], {
    cwd,
    env,
    windowsHide: true,
  });
  let buffer = "";
  answerWorker.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        const pending = answerWorkerPending.get(String(message.id));
        if (!pending) continue;
        answerWorkerPending.delete(String(message.id));
        if (message.error)
          pending.reject(
            Object.assign(new Error(message.error), {
              code: message.error_code,
            }),
          );
        else pending.resolve(message.result || {});
      } catch {
        /* diagnostic lines are emitted on stderr, never stdout */
      }
    }
  });
  answerWorker.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (
        line.startsWith("[ANSWER-PERF]") ||
        line.includes("[LLM-PERF]") ||
        line.startsWith("[RAG]")
      )
        console.log(line);
    }
  });
  const fail = (error) => {
    for (const pending of answerWorkerPending.values()) pending.reject(error);
    answerWorkerPending.clear();
    answerWorker = null;
  };
  answerWorker.on("error", fail);
  answerWorker.on("close", () =>
    fail(new Error("Persistent AI worker exited.")),
  );
  return answerWorker;
};

const runAnswerWorker = ({
  pythonExecutable,
  scriptPath,
  cwd,
  env,
  payload,
  timeoutMs,
}) =>
  new Promise((resolve, reject) => {
    const worker = getAnswerWorker({ pythonExecutable, scriptPath, cwd, env });
    const id = String(++answerWorkerSeq);
    const timer = setTimeout(() => {
      answerWorkerPending.delete(id);
      reject(
        Object.assign(new Error("Persistent AI worker timed out."), {
          code: "PYTHON_PROCESS_TIMEOUT",
        }),
      );
    }, timeoutMs);
    answerWorkerPending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    worker.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
  });

const answerQuestion = async ({
  question,
  userId,
  pdfId,
  questionType,
  llmProvider,
  conversationHistory,
}) => {
  const safeConversationHistory = normalizeConversationHistory(conversationHistory);
  const key = cacheKey({
    question,
    userId,
    pdfId,
    questionType,
    conversationHistory: safeConversationHistory,
  });
  const cached = getCachedAnswer(key);
  if (cached) {
    console.log(
      `[ANSWER-PERF] cache_hit=true total=0.00s pdf_scoped=${Boolean(pdfId)}`,
    );
    return { ...cached, cacheHit: true };
  }
  await localLlamaManager.ensureReady();
  const backendRoot = path.join(__dirname, "..");
  const pythonExecutable = resolvePythonExecutable(backendRoot);
  const scriptPath = path.join(backendRoot, "ai", "main.py");
  const cwd = path.join(backendRoot, "..");
  const env = {
    ...process.env,
    PYTHONPATH: [cwd, process.env.PYTHONPATH]
      .filter(Boolean)
      .join(path.delimiter),
  };

  const configuredProvider = String(
    process.env.LLM_PROVIDER ||
      (String(process.env.LOCAL_LLM_ENABLED || "false").toLowerCase() === "true"
        ? "local"
        : "openrouter"),
  )
    .trim()
    .toLowerCase();
  const requestedProvider = String(llmProvider || "").trim().toLowerCase();
  const providerOverride =
    requestedProvider && requestedProvider !== configuredProvider;

  // Keep one Python worker alive so embedding/reranker/RAG resources and their
  // in-process caches are reused across interactive questions.
  if (
    !providerOverride &&
    String(process.env.PERSISTENT_AI_WORKER || "true").toLowerCase() !== "false"
  ) {
    try {
      const workerResult = await runAnswerWorker({
        pythonExecutable,
        scriptPath,
        cwd,
        env,
        timeoutMs: Number(process.env.PYTHON_AI_TIMEOUT_MS || 180000),
        payload: {
          question: question || "",
          userId: userId || null,
          pdfId: pdfId || null,
          questionType: questionType || null,
          llmProvider: llmProvider || null,
          conversationHistory: safeConversationHistory,
        },
      });
      if (workerResult.error_code)
        throw Object.assign(
          new Error(workerResult.error || "AI worker failed."),
          { code: workerResult.error_code },
        );
      const response = {
        answer: workerResult.answer || "AI response unavailable.",
        mode: workerResult.mode || "llm",
        llm_used: workerResult.llm_used === true,
        rag_supported: workerResult.rag_supported === true,
        rag_complete: workerResult.rag_complete === true,
        sources: workerResult.sources || [],
        pdfId: workerResult.pdfId || null,
        relatedConcepts: workerResult.relatedConcepts || [],
        confidence: workerResult.confidence ?? null,
        is_from_pdf: workerResult.is_from_pdf === true,
        retrievalMethod: workerResult.retrievalMethod || "python-rag",
        questionType: workerResult.questionType || null,
      };
      setCachedAnswer(key, response);
      return response;
    } catch (error) {
      console.warn(
        `[ANSWER-PERF] persistent_worker_fallback=true reason=${error.code || "worker_error"}`,
      );
    }
  }

  const pythonArgs = [scriptPath];
  if (userId) pythonArgs.push("--user-id", String(userId));
  if (pdfId) pythonArgs.push("--pdf-id", String(pdfId));
  // Optional 10-mark exam-answer mode (§8). Left unset for ordinary chat so the
  // Python default (adaptive RAG) is unchanged.
  if (questionType) pythonArgs.push("--question-type", String(questionType));
  // Provider selection is configuration, not a question argument. Python's
  // CLI intentionally has no --llm-provider flag; passing one would silently
  // append it to the natural-language question and damage retrieval.
  if (safeConversationHistory.length) {
    pythonArgs.push(
      "--conversation-history",
      JSON.stringify(safeConversationHistory),
    );
  }
  pythonArgs.push(question || "");
  let result;
  try {
    result = await runPythonProcess({
      pythonExecutable,
      args: pythonArgs,
      cwd,
      env: providerOverride ? { ...env, LLM_PROVIDER: requestedProvider } : env,
      timeoutMs: Number(
        process.env.PYTHON_AI_TIMEOUT_MS ||
          Math.max(
            180000,
            (Number(process.env.LLM_REQUEST_TIMEOUT || 150) + 15) * 1000,
          ),
      ),
    });
  } catch (error) {
    // Surface bridge failures as an actionable service-unavailable response
    // instead of hiding them behind the generic 500 message.
    error.statusCode = 503;
    error.expose = true;
    throw error;
  }

  if (!result.stdout.trim()) {
    const error = new Error("Python returned empty stdout.");
    error.code = "PYTHON_EMPTY_OUTPUT";
    throw addStderrToError(error, result.stderr);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch (error) {
    const parseError = new Error(
      `Python returned invalid JSON: ${error.message}`,
    );
    parseError.code = "PYTHON_INVALID_JSON";
    throw addStderrToError(parseError, result.stderr);
  }

  if (parsed.error_code) {
    const error = new Error(
      parsed.error || "Python reported an AI bridge error.",
    );
    error.code = parsed.error_code;
    throw addStderrToError(error, result.stderr);
  }

  const response = {
    answer: parsed.answer || "AI response unavailable.",
    mode: parsed.mode || "llm",
    llm_used: parsed.llm_used === true,
    rag_supported: parsed.rag_supported === true,
    rag_complete: parsed.rag_complete === true,
    sources: parsed.sources || [],
    pdfId: parsed.pdfId || null,
    relatedConcepts: parsed.relatedConcepts || [],
    confidence: parsed.confidence ?? null,
    is_from_pdf: parsed.is_from_pdf === true,
    retrievalMethod: parsed.retrievalMethod || "python-rag",
    questionType: parsed.questionType || null,
  };
  setCachedAnswer(key, response);
  return response;
};

module.exports = {
  answerQuestion,
};
