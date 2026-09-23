const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { LocalLlamaManager } = require("../services/localLlamaManager");

const fakeChild = () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 12345;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.exitCode = 0;
    child.emit("exit", 0, null);
  };
  return child;
};

test("reuses an already-ready local llama.cpp endpoint", async () => {
  let spawnCount = 0;
  const manager = new LocalLlamaManager({
    enabled: true,
    executable: process.execPath,
    request: async () => ({ data: [{ id: "model" }] }),
    spawnProcess: () => { spawnCount += 1; return fakeChild(); },
  });

  const status = await manager.ensureReady();
  assert.equal(status.status, "ready");
  assert.equal(status.managedProcess, false);
  assert.equal(spawnCount, 0);
});

test("starts llama.cpp with the configured Hugging Face model and stops it cleanly", async () => {
  let command;
  const child = fakeChild();
  let requests = 0;
  const manager = new LocalLlamaManager({
    enabled: true,
    executable: process.execPath,
    model: "ggml-org/Qwen3.5-0.8B-GGUF",
    ctxSize: 8192,
    // Explicit zeros keep the asserted args deterministic regardless of any
    // LOCAL_LLM_* values in the ambient environment.
    threads: 0,
    batchSize: 0,
    parallel: 0,
    request: async () => {
      requests += 1;
      return requests > 1 ? { data: [{ id: "model" }] } : null;
    },
    spawnProcess: (...args) => { command = args; return child; },
    startupTimeoutMs: 3000,
  });

  const status = await manager.ensureReady();
  assert.equal(status.status, "ready");
  // The bounded --ctx-size is always present; tuning knobs are omitted when unset.
  // Reasoning is disabled by default so Qwen3 does not burn the output budget thinking.
  assert.deepEqual(command[1], ["serve", "--host", "127.0.0.1", "--port", "8080", "--hf-repo", "ggml-org/Qwen3.5-0.8B-GGUF", "--ctx-size", "8192", "--reasoning", "off"]);
  assert.equal(status.managedProcess, true);
  await manager.stop();
  assert.equal(manager.getStatus().status, "stopped");
});

test("emits llama.cpp tuning flags only when explicitly configured", async () => {
  let command;
  const child = fakeChild();
  let requests = 0;
  const manager = new LocalLlamaManager({
    enabled: true,
    executable: process.execPath,
    model: "ggml-org/Qwen3.5-0.8B-GGUF",
    ctxSize: 4096,
    threads: 6,
    batchSize: 256,
    parallel: 2,
    request: async () => {
      requests += 1;
      return requests > 1 ? { data: [{ id: "model" }] } : null;
    },
    spawnProcess: (...args) => { command = args; return child; },
    startupTimeoutMs: 3000,
  });

  await manager.ensureReady();
  assert.deepEqual(command[1], [
    "serve", "--host", "127.0.0.1", "--port", "8080",
    "--hf-repo", "ggml-org/Qwen3.5-0.8B-GGUF",
    "--ctx-size", "4096", "--threads", "6", "--batch-size", "256", "--parallel", "2",
    "--reasoning", "off",
  ]);
  await manager.stop();
});
