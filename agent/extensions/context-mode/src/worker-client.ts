import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanupOwned } from "./process-cleanup.mjs";
import { ProgressFiles } from "./progress-files.js";
import type { LeanToolName, ToolUpdate } from "./types.js";

export type CallLifecycle = {
  signal?: AbortSignal;
  onUpdate?: (result: ToolUpdate) => void;
  progressFiles?: string[];
};

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Context Mode call cancelled");
}

export async function invokeWorker(
  bundle: string,
  projectDir: string,
  name: LeanToolName,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  lifecycle: CallLifecycle = {},
): Promise<unknown> {
  assertNotAborted(lifecycle.signal);
  const request = { type: "invoke", bundle, projectDir, name, args };
  if (Buffer.byteLength(JSON.stringify(request)) > 16 * 1024 * 1024) throw new Error("Context Mode arguments exceed IPC limit");
  const files = lifecycle.progressFiles?.length ? new ProgressFiles(lifecycle.progressFiles) : undefined;
  // Baseline before launching work, including files that do not exist yet.
  if (files) await files.poll(true);
  assertNotAborted(lifecycle.signal);
  const worker = fork(fileURLToPath(new URL("./worker.mjs", import.meta.url)), [], {
    env, execArgv: [], detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const owned = new Set<number>();
  let failure: Error | undefined;
  let terminal: { result?: unknown; error?: string; teardown: boolean } | undefined;
  let lastProgress = "";
  let currentProgress: { phase: unknown; started: unknown; completed: unknown; outputBytes: unknown } = { phase: "loading", started: 0, completed: 0, outputBytes: 0 };
  let poll: ReturnType<typeof setTimeout> | undefined;
  let monitoring = !!files;
  const stopMonitoring = () => {
    monitoring = false;
    clearTimeout(poll);
  };
  let force: ReturnType<typeof setTimeout> | undefined;
  let terminate: ReturnType<typeof setTimeout> | undefined;
  const stop = (error: Error) => {
    if (failure) return;
    failure = error;
    stopMonitoring();
    if (worker.connected) worker.send({ type: "cancel" }, () => {});
    terminate = setTimeout(() => worker.kill("SIGTERM"), 2200);
    force = setTimeout(() => worker.kill("SIGKILL"), 3000);
  };
  const emitProgress = () => {
    const progress = { ...currentProgress, ...(files && files.bytes > 0 ? { fileBytes: files.bytes } : {}) };
    const digest = JSON.stringify(progress);
    if (digest === lastProgress || failure || terminal) return;
    lastProgress = digest;
    const fileText = files && files.bytes > 0 ? `, ${files.bytes} file bytes grown` : "";
    try {
      lifecycle.onUpdate?.({
        content: [{ type: "text", text: `Context Mode ${progress.phase}: ${progress.completed}/${progress.started} processes complete, ${progress.outputBytes} output bytes${fileText}` }],
        details: { tool: name, progress },
      });
    } catch (error) { stop(error instanceof Error ? error : new Error(String(error))); }
  };
  const pollFiles = async () => {
    if (!monitoring || !files) return;
    const before = files.bytes;
    await files.poll();
    // Cancellation or terminal receipt can race an outstanding stat operation.
    if (!monitoring) return;
    if (files.bytes > before) emitProgress();
    if (monitoring) poll = setTimeout(pollFiles, 200);
  };
  const abort = () => stop(new Error("Context Mode call cancelled"));
  lifecycle.signal?.addEventListener("abort", abort, { once: true });
  const exited = new Promise<void>((resolve) => {
    worker.on("message", (message: unknown) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        stop(new Error("Invalid Context Mode worker protocol")); return;
      }
      const packet = message as Record<string, unknown>;
      if (packet.type === "owned" && Number.isSafeInteger(packet.pid) && (packet.pid as number) > 0 && owned.size < 4096) {
        owned.add(packet.pid as number);
      } else if (packet.type === "released" && Number.isSafeInteger(packet.pid) && owned.has(packet.pid as number)) {
        owned.delete(packet.pid as number);
      } else if (packet.type === "progress" && !terminal) {
        const value = packet.value as Record<string, unknown> | undefined;
        if (!value || !["loading", "executing", "complete"].includes(String(value.phase)) ||
            ![value.started, value.completed, value.outputBytes].every((count) => Number.isSafeInteger(count) && (count as number) >= 0) ||
            (value.started as number) > 4096 || (value.completed as number) > (value.started as number)) {
          stop(new Error("Invalid Context Mode worker progress")); return;
        }
        currentProgress = { phase: value.phase, started: value.started, completed: value.completed, outputBytes: value.outputBytes };
        emitProgress();
      } else if ((packet.type === "result" || packet.type === "error") && packet.teardown !== undefined &&
          (packet.teardown !== "private_group" || process.platform === "win32")) {
        stop(new Error("Invalid Context Mode worker protocol"));
      } else if (packet.type === "result" && !terminal) {
        if (Buffer.byteLength(JSON.stringify(packet)) > 16 * 1024 * 1024) stop(new Error("Context Mode worker result exceeds IPC limit"));
        else {
          terminal = { result: packet.result, teardown: packet.teardown === "private_group" };
          stopMonitoring();
        }
      } else if (packet.type === "error" && !terminal && typeof packet.error === "string" && packet.error.length <= 4000) {
        terminal = { error: packet.error, teardown: packet.teardown === "private_group" };
        stopMonitoring();
      } else stop(new Error("Invalid Context Mode worker protocol"));
    });
    worker.on("error", (error) => {
      stop(error);
      // A failed fork has no exit event and owns no processes.
      if (!worker.pid) resolve();
    });
    worker.once("exit", (code, signal) => {
      stopMonitoring();
      if (!terminal && !failure) failure = new Error(`Context Mode worker exited without a result (${signal ?? code})`);
      // Only the declared Unix group teardown permits SIGKILL after a result.
      const expectedExit = terminal?.teardown ? code === null && signal === "SIGKILL" : code === 0;
      if (terminal && !terminal.error && !expectedExit && !failure) failure = new Error("Context Mode worker failed after its result");
      resolve();
    });
  });
  if (lifecycle.signal?.aborted) abort();
  if (!failure) {
    worker.send(request, (error) => { if (error) stop(error); });
    if (monitoring) poll = setTimeout(pollFiles, 200);
  }
  try {
    await exited;
    // Sync probes and compilers inherit this private group without entering the
    // async ledger. Check both after exit, including a normal result or crash.
    try {
      await cleanupOwned(owned);
    } finally {
      // A ledger cleanup failure must not skip the synchronous descendants.
      if (process.platform !== "win32" && Number.isSafeInteger(worker.pid) && worker.pid! > 0) {
        await cleanupOwned(new Set([worker.pid!]));
      }
    }
    if (failure) throw failure;
    if (terminal?.error) throw new Error(terminal.error);
    return terminal?.result;
  } finally {
    stopMonitoring();
    clearTimeout(terminate);
    clearTimeout(force);
    lifecycle.signal?.removeEventListener("abort", abort);
  }
}
