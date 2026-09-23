"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULTS = Object.freeze({
  enabled: false,
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "ggml-org/Qwen3.5-0.8B-GGUF",
  ctxSize: 8192,
  threads: 0,
  batchSize: 0,
  parallel: 0,
  reasoning: "off",
  startupTimeoutMs: 120000,
  healthTimeoutMs: 3000,
  restartDelayMs: 3000,
  stopTimeoutMs: 5000,
});

const PROVIDER = "llama.cpp";

const localProviderSelected = () => {
  const provider = String(process.env.LLM_PROVIDER || "").trim().toLowerCase();
  if (provider) return ["local", "llama.cpp"].includes(provider);
  return toBoolean(process.env.LOCAL_LLM_ENABLED, DEFAULTS.enabled);
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
};

const toNumber = (value, fallback, minimum = 0) => {
  const number = Number(value);

  if (!Number.isFinite(number) || number < minimum) {
    return fallback;
  }

  return number;
};

const removeTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const createError = (message, code, extra = {}) => {
  const error = new Error(message);

  if (code) {
    error.code = code;
  }

  Object.assign(error, extra);

  return error;
};

/**
 * Perform a GET request and parse the response as JSON.
 *
 * Used only for llama.cpp readiness checks.
 */
const requestJson = (url, timeoutMs) =>
  new Promise((resolve, reject) => {
    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch (error) {
      reject(
        createError(`Invalid llama.cpp URL: ${url}`, "LLAMA_INVALID_URL", {
          cause: error,
        }),
      );
      return;
    }

    const transport = parsedUrl.protocol === "https:" ? https : http;

    const request = transport.get(
      parsedUrl,
      {
        headers: {
          Accept: "application/json",
        },
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              createError(
                `llama.cpp returned HTTP ${response.statusCode}.`,
                "LLAMA_HTTP_ERROR",
                {
                  statusCode: response.statusCode,
                },
              ),
            );

            return;
          }

          try {
            resolve(JSON.parse(body || "{}"));
          } catch (error) {
            reject(
              createError(
                "llama.cpp returned invalid JSON.",
                "LLAMA_INVALID_JSON",
                {
                  cause: error,
                },
              ),
            );
          }
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(
        createError(
          "llama.cpp readiness request timed out.",
          "LLAMA_REQUEST_TIMEOUT",
        ),
      );
    });

    request.on("error", reject);
  });

/**
 * Local llama.cpp process manager.
 *
 * Responsibilities:
 * - Check whether llama.cpp is already running.
 * - Start llama.cpp when required.
 * - Monitor the child process.
 * - Restart it after unexpected failure.
 * - Stop it gracefully during application shutdown.
 * - Expose operational status.
 *
 * This class does NOT:
 * - generate prompts
 * - perform RAG
 * - access MongoDB
 * - access ChromaDB
 * - generate flashcards
 * - generate quizzes
 */
class LocalLlamaManager {
  constructor(options = {}) {
    this.config = this._buildConfig(options);

    this.request = options.request || requestJson;
    this.spawnProcess = options.spawnProcess || spawn;

    this.child = null;
    this.ownedProcess = false;

    this.startPromise = null;
    this.restartTimer = null;

    this.shuttingDown = false;

    this.status = this.config.enabled ? "stopped" : "disabled";

    this.lastError = null;
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  _buildConfig(options) {
    const baseUrl = removeTrailingSlash(
      options.baseUrl || process.env.LOCAL_LLM_BASE_URL || DEFAULTS.baseUrl,
    );

    const executable =
      options.executable ||
      process.env.LOCAL_LLM_EXECUTABLE ||
      this._defaultExecutable();

    return Object.freeze({
      enabled:
        options.enabled ??
        localProviderSelected(),

      baseUrl,

      executable,

      model: options.model || process.env.LOCAL_LLM_MODEL || DEFAULTS.model,

      modelPath: options.modelPath || process.env.LOCAL_LLM_MODEL_PATH || "",

      ctxSize:
        options.ctxSize ??
        toNumber(process.env.LOCAL_LLM_CTX_SIZE, DEFAULTS.ctxSize),

      threads:
        options.threads ??
        toNumber(process.env.LOCAL_LLM_THREADS, DEFAULTS.threads),

      batchSize:
        options.batchSize ??
        toNumber(process.env.LOCAL_LLM_BATCH_SIZE, DEFAULTS.batchSize),

      parallel:
        options.parallel ??
        toNumber(process.env.LOCAL_LLM_PARALLEL, DEFAULTS.parallel),

      reasoning: String(
        options.reasoning ??
          process.env.LOCAL_LLM_REASONING ??
          DEFAULTS.reasoning,
      )
        .trim()
        .toLowerCase(),

      startupTimeoutMs:
        options.startupTimeoutMs ??
        toNumber(
          process.env.LOCAL_LLM_STARTUP_TIMEOUT_MS,
          DEFAULTS.startupTimeoutMs,
          1000,
        ),

      healthTimeoutMs:
        options.healthTimeoutMs ??
        toNumber(
          process.env.LOCAL_LLM_HEALTH_TIMEOUT_MS,
          DEFAULTS.healthTimeoutMs,
          100,
        ),

      restartDelayMs:
        options.restartDelayMs ??
        toNumber(
          process.env.LOCAL_LLM_RESTART_DELAY_MS,
          DEFAULTS.restartDelayMs,
          100,
        ),

      stopTimeoutMs:
        options.stopTimeoutMs ??
        toNumber(
          process.env.LOCAL_LLM_STOP_TIMEOUT_MS,
          DEFAULTS.stopTimeoutMs,
          100,
        ),
    });
  }

  _defaultExecutable() {
    if (process.platform === "win32") {
      return "llama.exe";
    }

    return "llama-server";
  }

  // ---------------------------------------------------------------------------
  // Public status
  // ---------------------------------------------------------------------------

  getStatus() {
    return {
      enabled: this.config.enabled,
      status: this.status,
      provider: PROVIDER,
      baseUrl: this.config.baseUrl,
      model: this.config.modelPath || this.config.model,
      managedProcess: this.ownedProcess,
      pid: this.child?.pid || null,
      error: this.lastError?.message || null,
    };
  }

  // ---------------------------------------------------------------------------
  // URL helpers
  // ---------------------------------------------------------------------------

  _getServerUrl() {
    return new URL(this.config.baseUrl);
  }

  _getModelsUrl() {
    return `${this.config.baseUrl}/models`;
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  async isReady() {
    try {
      const payload = await this.request(
        this._getModelsUrl(),
        this.config.healthTimeoutMs,
      );

      return Boolean(payload && Array.isArray(payload.data));
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Command construction
  // ---------------------------------------------------------------------------

  buildArgs() {
    const url = this._getServerUrl();

    const host = url.hostname;

    const port = url.port || (url.protocol === "https:" ? "443" : "80");

    const args = ["serve", "--host", host, "--port", port];

    if (this.config.modelPath) {
      args.push("--model", this.config.modelPath);
    } else {
      args.push("--hf-repo", this.config.model);
    }

    if (this.config.ctxSize > 0) {
      args.push("--ctx-size", String(this.config.ctxSize));
    }

    if (this.config.threads > 0) {
      args.push("--threads", String(this.config.threads));
    }

    if (this.config.batchSize > 0) {
      args.push("--batch-size", String(this.config.batchSize));
    }

    if (this.config.parallel > 0) {
      args.push("--parallel", String(this.config.parallel));
    }

    if (this.config.reasoning === "off") {
      args.push("--reasoning", "off");
    }

    return args;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async ensureReady() {
    if (!this.config.enabled) {
      this.status = "disabled";
      return this.getStatus();
    }

    if (this.shuttingDown) {
      throw createError(
        "llama.cpp manager is shutting down.",
        "LLAMA_MANAGER_SHUTTING_DOWN",
      );
    }

    // Prevent multiple callers from starting multiple llama.cpp processes.
    if (this.startPromise) {
      return this.startPromise;
    }

    // llama.cpp may already have been started externally.
    if (await this.isReady()) {
      this.status = "ready";
      this.lastError = null;

      return this.getStatus();
    }

    this.startPromise = this._start();

    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async _start() {
    this._validateExecutable();

    this.status = "starting";
    this.lastError = null;

    const child = this._spawn();

    this.child = child;
    this.ownedProcess = true;

    this._attachProcessHandlers(child);

    const deadline = Date.now() + this.config.startupTimeoutMs;

    while (Date.now() < deadline) {
      if (this._hasProcessExited(child)) {
        throw (
          this.lastError ||
          createError(
            "llama.cpp stopped before becoming ready.",
            "LLAMA_STARTUP_FAILED",
          )
        );
      }

      if (await this.isReady()) {
        this.status = "ready";
        this.lastError = null;

        return this.getStatus();
      }

      await sleep(1000);
    }

    const error = createError(
      `llama.cpp did not become ready within ${this.config.startupTimeoutMs} ms.`,
      "LLAMA_STARTUP_TIMEOUT",
    );

    this.lastError = error;
    this.status = "error";

    this._killProcess(child);

    throw error;
  }

  _validateExecutable() {
    if (
      process.platform === "win32" &&
      !fs.existsSync(this.config.executable)
    ) {
      throw createError(
        `llama.cpp executable not found: ${this.config.executable}`,
        "LLAMA_EXECUTABLE_NOT_FOUND",
      );
    }
  }

  _spawn() {
    const executable = this.config.executable;

    const cwd = path.dirname(executable);

    return this.spawnProcess(executable, this.buildArgs(), {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  _attachProcessHandlers(child) {
    child.stdout?.on("data", (data) => {
      console.log(`[${PROVIDER}] ${String(data).trim()}`);
    });

    child.stderr?.on("data", (data) => {
      console.warn(`[${PROVIDER}] ${String(data).trim()}`);
    });

    child.once("error", (error) => {
      this._handleProcessStopped(error);
    });

    child.once("exit", (code, signal) => {
      const error = createError(
        `llama.cpp exited with code ${code}${signal ? ` (${signal})` : ""}.`,
        "LLAMA_PROCESS_EXIT",
      );

      this._handleProcessStopped(error);
    });
  }

  _hasProcessExited(child) {
    return child.exitCode !== null || child.signalCode !== null;
  }

  // ---------------------------------------------------------------------------
  // Crash handling
  // ---------------------------------------------------------------------------

  _handleProcessStopped(error) {
    if (this.shuttingDown) {
      return;
    }

    if (!this.child) {
      return;
    }

    this.child = null;
    this.ownedProcess = false;

    this.status = "stopped";
    this.lastError = error;

    this._scheduleRestart();
  }

  _scheduleRestart() {
    if (this.shuttingDown || this.restartTimer || !this.config.enabled) {
      return;
    }

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;

      try {
        await this.ensureReady();
      } catch (error) {
        this.status = "error";
        this.lastError = error;

        this._scheduleRestart();
      }
    }, this.config.restartDelayMs);

    this.restartTimer.unref?.();
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async stop() {
    this.shuttingDown = true;

    this._clearRestartTimer();

    const child = this.child;

    this.child = null;
    this.ownedProcess = false;

    if (!child || this._hasProcessExited(child)) {
      this.status = this.config.enabled ? "stopped" : "disabled";

      return;
    }

    this._killProcess(child);

    await this._waitForExit(child);

    this.status = "stopped";
  }

  _clearRestartTimer() {
    if (!this.restartTimer) {
      return;
    }

    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  _killProcess(child) {
    try {
      child.kill();
    } catch (error) {
      console.warn(`[${PROVIDER}] failed to stop process:`, error);
    }
  }

  _waitForExit(child) {
    return new Promise((resolve) => {
      if (this._hasProcessExited(child)) {
        resolve();
        return;
      }

      const timer = setTimeout(resolve, this.config.stopTimeoutMs);

      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

// -----------------------------------------------------------------------------
// Singleton
// -----------------------------------------------------------------------------

const localLlamaManager = new LocalLlamaManager();

module.exports = {
  LocalLlamaManager,
  localLlamaManager,
};
