import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanupOwned } from "./process-cleanup.mjs";
import type { LeanToolName, ToolUpdate } from "./types.js";

export type CallLifecycle = {
  signal?: AbortSignal;
  onUpdate?: (result: ToolUpdate) => void;
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
  const worker = fork(fileURLToPath(new URL("./worker.mjs", import.meta.url)), [], {
    env, execArgv: [], detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const owned = new Set<number>();
  let failure: Error | undefined;
  let terminal: { result?: unknown; error?: string; teardown: boolean } | undefined;
  let lastProgress = "";
  let force: ReturnType<typeof setTimeout> | undefined;
  let terminate: ReturnType<typeof setTimeout> | undefined;
  const stop = (error: Error) => {
    if (failure) return;
    failure = error;
    if (worker.connected) worker.send({ type: "cancel" }, () => {});
    terminate = setTimeout(() => worker.kill("SIGTERM"), 2200);
    force = setTimeout(() => worker.kill("SIGKILL"), 3000);
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
        const progress = { phase: value.phase, started: value.started, completed: value.completed, outputBytes: value.outputBytes };
        const digest = JSON.stringify(progress);
        if (digest !== lastProgress && !failure) {
          lastProgress = digest;
          try {
            lifecycle.onUpdate?.({
              content: [{ type: "text", text: `Context Mode ${progress.phase}: ${progress.completed}/${progress.started} processes complete, ${progress.outputBytes} output bytes` }],
              details: { tool: name, progress },
            });
          } catch (error) { stop(error instanceof Error ? error : new Error(String(error))); }
        }
      } else if ((packet.type === "result" || packet.type === "error") && packet.teardown !== undefined &&
          (packet.teardown !== "private_group" || process.platform === "win32")) {
        stop(new Error("Invalid Context Mode worker protocol"));
      } else if (packet.type === "result" && !terminal) {
        if (Buffer.byteLength(JSON.stringify(packet)) > 16 * 1024 * 1024) stop(new Error("Context Mode worker result exceeds IPC limit"));
        else terminal = { result: packet.result, teardown: packet.teardown === "private_group" };
      } else if (packet.type === "error" && !terminal && typeof packet.error === "string" && packet.error.length <= 4000) {
        terminal = { error: packet.error, teardown: packet.teardown === "private_group" };
      } else stop(new Error("Invalid Context Mode worker protocol"));
    });
    worker.on("error", (error) => {
      stop(error);
      // A failed fork has no exit event and owns no processes.
      if (!worker.pid) resolve();
    });
    worker.once("exit", (code, signal) => {
      if (!terminal && !failure) failure = new Error(`Context Mode worker exited without a result (${signal ?? code})`);
      // Only the declared Unix group teardown permits SIGKILL after a result.
      const expectedExit = terminal?.teardown ? code === null && signal === "SIGKILL" : code === 0;
      if (terminal && !terminal.error && !expectedExit && !failure) failure = new Error("Context Mode worker failed after its result");
      resolve();
    });
  });
  if (lifecycle.signal?.aborted) abort();
  if (!failure) worker.send(request, (error) => { if (error) stop(error); });
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
    clearTimeout(terminate);
    clearTimeout(force);
    lifecycle.signal?.removeEventListener("abort", abort);
  }
}
