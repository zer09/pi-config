import { Worker, MessageChannel, receiveMessageOnPort, isMainThread, parentPort, workerData } from "node:worker_threads";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { cleanupOwned, ownedIsAlive, signalOwned } from "./process-cleanup.mjs";

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_PROCESSES = 4096;
const names = ["ctx_execute_file", "ctx_batch_execute", "ctx_search"];

// Tests import this entry point to hold the launch acknowledgment. The production
// IPC request and tool schemas cannot select or configure that boundary.
export function runOwner(beforeLaunchAck) {
  // Keep the IPC owner responsive even when the backend blocks in SQLite or JS.
  const shared = new Int32Array(new SharedArrayBuffer(4));
  const owned = new Set();
  let thread;
  let stopping = false;
  let started = false;
  const startup = setTimeout(() => finish({ type: "error", error: "Context Mode worker startup expired" }), 10000);
  const send = (message) => {
    if (process.connected) process.send(message, (error) => { if (error) void finish(); });
  };
  const killFallbackGroup = () => {
    // Fork uses a private Unix group. Signal only -our PID, never the inherited
    // host group. Do not await cleanupOwned on a group containing this owner.
    if (process.platform !== "win32") signalOwned(process.pid, "SIGKILL");
    process.kill(process.pid, "SIGKILL");
  };
  async function finish(message) {
    if (stopping) return;
    stopping = true;
    clearTimeout(startup);
    Atomics.store(shared, 0, 1);
    Atomics.notify(shared, 0);
    let forced = false;
    // Native backend work can delay thread termination. The IPC owner must still
    // clean groups and exit when its parent is gone, without waiting for that work.
    const deadline = setTimeout(async () => {
      forced = true;
      try { await cleanupOwned(owned); } finally { killFallbackGroup(); }
    }, 500);
    try {
      // Stop the backend before child exits can wake its serial or parallel queue.
      if (thread) await thread.terminate();
      if (forced) return;
      clearTimeout(deadline);
      await cleanupOwned(owned);
    } catch (error) {
      clearTimeout(deadline);
      message = { type: "error", error: String(error.message).slice(0, 4000) };
    }
    if (message && process.connected) {
      const privateGroup = process.platform !== "win32";
      // Delivery does not transfer cleanup ownership: the parent can die on receipt.
      // Bound a stuck handoff, then kill our private group even after a successful send.
      const deliveryDeadline = privateGroup ? setTimeout(killFallbackGroup, 500) : undefined;
      try {
        process.send(privateGroup ? { ...message, teardown: "private_group" } : message, (error) => {
          clearTimeout(deliveryDeadline);
          if (privateGroup || error || !process.connected) killFallbackGroup();
          else process.exit(message.type === "result" ? 0 : 1);
        });
      } catch {
        clearTimeout(deliveryDeadline);
        killFallbackGroup();
      }
    } else killFallbackGroup();
  }
  process.on("disconnect", () => void finish());
  process.on("SIGTERM", () => void finish());
  process.on("SIGINT", () => void finish());
  process.on("message", (request) => {
    if (request?.type === "cancel") { void finish({ type: "error", error: "Context Mode call cancelled" }); return; }
    if (started || stopping || request?.type !== "invoke" || !names.includes(request.name) ||
        typeof request.bundle !== "string" || !request.bundle.startsWith("file:") ||
        typeof request.projectDir !== "string" || !request.args || typeof request.args !== "object" ||
        Array.isArray(request.args) || Buffer.byteLength(JSON.stringify(request)) > MAX_MESSAGE_BYTES) {
      void finish({ type: "error", error: "Invalid Context Mode worker request" }); return;
    }
    started = true;
    clearTimeout(startup);
    thread = new Worker(new URL(import.meta.url), { workerData: { ...request, shared: shared.buffer }, execArgv: [] });
    const children = new Map();
    let launches = 0;
    thread.on("message", (message) => {
      if (message?.type === "launch") {
        const { id, args, port, ack } = message;
        const acknowledge = (value) => {
          port.postMessage(value);
          Atomics.store(new Int32Array(ack), 0, 1);
          Atomics.notify(new Int32Array(ack), 0);
          port.close();
        };
        if (stopping) {
          acknowledge({ error: { message: "Context Mode call cancelled" } }); return;
        };
        if (++launches > MAX_PROCESSES || Buffer.byteLength(JSON.stringify(args)) > MAX_MESSAGE_BYTES) {
          acknowledge({ error: { message: "Context Mode subprocess limit exceeded" } }); return;
        }
        let child;
        try {
          child = childProcess.spawn(...args);
          // No callback or await can run between native creation and this ledger.
          // Terminating the backend thread cannot erase an unpublished PID here.
          if (child.pid) {
            owned.add(child.pid);
            send({ type: "owned", pid: child.pid });
          }
        } catch (error) {
          acknowledge({ error: { message: error.message, code: error.code } }); return;
        }
        const relay = (event, value) => {
          if (!stopping) thread.postMessage({ type: "child", id, event, ...value });
        };
        // One bounded chunk per stream may be in flight. SQLite stalls must not
        // turn output relay into an unbounded MessagePort queue.
        const reads = new Map();
        for (const name of ["stdout", "stderr"]) {
          const stream = child[name];
          if (!stream) continue;
          let waiting = false;
          const read = () => {
            if (stopping || waiting) return;
            const chunk = stream.read(Math.min(stream.readableLength, 64 * 1024) || 1);
            if (chunk === null) return;
            waiting = true;
            relay(name, { chunk });
          };
          reads.set(name, () => { waiting = false; read(); });
          stream.on("readable", read);
        }
        children.set(id, { child, reads });
        child.on("error", (error) => relay("error", { error: { message: error.message, code: error.code, errno: error.errno, syscall: error.syscall, path: error.path, spawnargs: error.spawnargs } }));
        child.on("exit", (code, signal) => relay("exit", { code, signal }));
        child.on("close", (code, signal) => {
          children.delete(id);
          if (child.pid && !ownedIsAlive(child.pid)) {
            owned.delete(child.pid);
            send({ type: "released", pid: child.pid });
          }
          relay("close", { code, signal });
        });
        const ready = () => {
          if (!stopping) acknowledge({ pid: child.pid, stdout: Boolean(child.stdout), stderr: Boolean(child.stderr) });
          else port.close();
        };
        if (beforeLaunchAck) {
          Promise.resolve(beforeLaunchAck(child.pid)).then(ready, () => void finish({ type: "error", error: "Context Mode test launch boundary failed" }));
        } else ready();
      } else if (stopping) return;
      else if (message?.type === "read") {
        children.get(message.id)?.reads.get(message.stream)?.();
      } else if (message?.type === "unref") {
        children.get(message.id)?.child.unref();
      } else if (message?.type === "progress") {
        if (!stopping) send(message);
      } else if (message?.type === "result" || message?.type === "error") {
        if (Buffer.byteLength(JSON.stringify(message)) > MAX_MESSAGE_BYTES) {
          void finish({ type: "error", error: "Context Mode worker result exceeds IPC limit" });
        } else void finish(message);
      } else void finish({ type: "error", error: "Invalid Context Mode backend message" });
    });
    thread.on("error", () => void finish({ type: "error", error: "Context Mode backend thread failed" }));
    thread.on("exit", () => { if (!stopping) void finish({ type: "error", error: "Context Mode backend exited without a result" }); });
  });
}

if (isMainThread) {
  if (process.argv[1] === fileURLToPath(import.meta.url)) runOwner();
} else {
  const shared = new Int32Array(workerData.shared);
  const cancelled = () => Atomics.load(shared, 0) !== 0;
  let started = 0;
  let completed = 0;
  let outputBytes = 0;
  let phase = "loading";
  let pending;
  let last = "";
  const progress = () => {
    clearTimeout(pending);
    pending = undefined;
    if (cancelled()) return;
    const value = { phase, started, completed, outputBytes };
    const digest = JSON.stringify(value);
    if (digest !== last) { last = digest; parentPort.postMessage({ type: "progress", value }); }
  };
  const children = new Map();
  parentPort.on("message", (message) => {
    if (cancelled() || message?.type !== "child") return;
    const child = children.get(message.id);
    if (!child) return;
    if (message.event === "stdout" || message.event === "stderr") {
      const chunk = Buffer.from(message.chunk);
      outputBytes = Math.min(Number.MAX_SAFE_INTEGER, outputBytes + chunk.length);
      if (!pending) pending = setTimeout(progress, 100);
      child[message.event].emit("data", chunk);
      parentPort.postMessage({ type: "read", id: message.id, stream: message.event });
    } else if (message.event === "error") {
      child.emit("error", Object.assign(new Error(message.error.message), message.error));
    } else {
      if (message.event === "close") {
        children.delete(message.id);
        completed += 1;
        progress();
      }
      child.emit(message.event, message.code, message.signal);
    }
  });
  // Pinned context-mode 1.0.169 only uses pid, stdout/stderr data listeners,
  // error/close events, and unref. Unix timeout killTree signals -pid directly.
  // This patch exists only in the backend thread, never in the Pi host.
  childProcess.spawn = function (...args) {
    if (cancelled()) throw new Error("Context Mode call cancelled");
    if (started >= MAX_PROCESSES) throw new Error("Context Mode subprocess limit exceeded");
    const index = Array.isArray(args[1]) ? 2 : 1;
    args[index] = { ...args[index], env: args[index]?.env ?? { ...process.env } };
    if (process.platform !== "win32") args[index].detached = true;
    if (Buffer.byteLength(JSON.stringify(args)) > MAX_MESSAGE_BYTES) throw new Error("Context Mode launch exceeds IPC limit");
    const id = started + 1;
    const { port1, port2 } = new MessageChannel();
    const ack = new Int32Array(new SharedArrayBuffer(4));
    let response;
    try {
      parentPort.postMessage({ type: "launch", id, args, ack: ack.buffer, port: port2 }, [port2]);
      // Upstream needs pid synchronously for its execution timeout. The owner
      // remains responsive during this wait and owns the child before waking us.
      while (Atomics.load(ack, 0) === 0 && !cancelled()) Atomics.wait(ack, 0, 0, 100);
      if (cancelled()) throw new Error("Context Mode call cancelled");
      response = receiveMessageOnPort(port1).message;
    } finally { port1.close(); }
    if (response.error) throw Object.assign(new Error(response.error.message), response.error);
    const child = new EventEmitter();
    child.pid = response.pid;
    child.stdout = response.stdout ? new EventEmitter() : null;
    child.stderr = response.stderr ? new EventEmitter() : null;
    child.unref = () => { parentPort.postMessage({ type: "unref", id }); };
    children.set(id, child);
    started += 1;
    progress();
    return child;
  };
  syncBuiltinESMExports();
  progress();
  try {
    const backend = await import(workerData.bundle);
    if (cancelled()) throw new Error("Context Mode call cancelled");
    if (!Array.isArray(backend.REGISTERED_CTX_TOOLS)) throw new Error("context-mode backend did not export REGISTERED_CTX_TOOLS");
    for (const name of names) {
      if (!backend.REGISTERED_CTX_TOOLS.some((tool) => tool?.name === name && typeof tool.handler === "function")) {
        throw new Error(`context-mode backend missing ${name}`);
      }
    }
    if (typeof backend.withProjectDirOverride !== "function") throw new Error("context-mode backend missing withProjectDirOverride");
    const tool = backend.REGISTERED_CTX_TOOLS.find((tool) => tool.name === workerData.name);
    let args = workerData.args;
    if (typeof tool.config?.inputSchema?.parse === "function") {
      try {
        args = tool.config.inputSchema.parse(args);
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("schema parser returned a non-object value");
      } catch (error) { throw new Error(`Invalid arguments for ${tool.name}: ${error.message}`); }
    }
    phase = "executing";
    progress();
    const result = await backend.withProjectDirOverride({ projectDir: workerData.projectDir }, async () => tool.handler(args));
    phase = "complete";
    progress();
    const message = { type: "result", result };
    if (Buffer.byteLength(JSON.stringify(message)) > MAX_MESSAGE_BYTES) throw new Error("Context Mode worker result exceeds IPC limit");
    parentPort.postMessage(message);
  } catch (error) {
    parentPort.postMessage({ type: "error", error: String(error.message).slice(0, 4000) });
  }
}
