import { afterEach, beforeEach, describe, expect, it } from "vitest";
import childProcess, { fork } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { callCtxTool } from "../src/backend.js";
import { cleanupOwned, ownedIsAlive } from "../src/process-cleanup.mjs";
import type { LeanToolName, ToolUpdate } from "../src/types.js";
// Load the harness at runtime without making this package depend on Pi host declarations.
const monitorPath = fileURLToPath(new URL("../../delegated-pi-loop/monitor.ts", import.meta.url));
const livenessPath = fileURLToPath(new URL("../../delegated-pi-loop/liveness.ts", import.meta.url));
const { PiRpcMonitor } = await import(monitorPath);
const { evaluateLiveness } = await import(livenessPath);

const fixtureRoot = fileURLToPath(new URL("./fixtures", import.meta.url));
let dir: string;
let env: NodeJS.ProcessEnv;
const pids = () => existsSync(resolve(dir, "pids")) ? readFileSync(resolve(dir, "pids"), "utf8").trim().split("\n").map(Number) : [];
async function waitFor(predicate: () => boolean, deadline = 3000) {
  const end = Date.now() + deadline;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error("fixture deadline expired");
    await delay(20);
  }
}
function args(mode: string, extra: Record<string, unknown> = {}) {
  return { mode, marker: resolve(dir, "started"), pids: resolve(dir, "pids"), ...extra };
}
function call(mode: string, lifecycle: { signal?: AbortSignal; onUpdate?: (update: ToolUpdate) => void } = {}, extra: Record<string, unknown> = {}, name: LeanToolName = "ctx_batch_execute") {
  return callCtxTool(dir, name, args(mode, extra), { env }, lifecycle);
}
beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "ctx-worker-test-"));
  env = { ...process.env, CONTEXT_MODE_ROOT: fixtureRoot, CONTEXT_MODE_DIR: resolve(dir, "store"), PI_CONFIG_DIR: dir, HOME: dir };
});
afterEach(async () => {
  await cleanupOwned(new Set(pids()));
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("owned backend worker", () => {
  it("parses schemas and preserves result content and project attribution", async () => {
    const spawn = childProcess.spawn;
    const result = await call("schema", {}, { limit: "4" });
    expect(childProcess.spawn).toBe(spawn);
    expect(result).toEqual({ content: [{ type: "text", text: "4" }], details: { tool: "ctx_batch_execute" } });
  });

  it("preserves bridge bytes, argv, env, cwd, and exit/close order", async () => {
    const result = JSON.parse((await call("bridge-output", {}, { cwd: dir })).content[0].text);
    const header = Buffer.from(`${JSON.stringify({ args: ["space argument", "=literal"], cwd: dir, env: "space=value" })}\n`);
    expect(Buffer.from(result.stdout, "base64")).toEqual(Buffer.concat([header, Buffer.alloc(300123, 171)]));
    expect(Buffer.from(result.stderr, "base64")).toEqual(Buffer.alloc(310123, 205));
    expect(result.events).toEqual([{ event: "exit", code: 7, signal: null }, { event: "close", code: 7, signal: null }]);
  });

  it("preserves asynchronous native spawn errors", async () => {
    const error = JSON.parse((await call("bridge-error")).content[0].text);
    expect(error.code).toBe("ENOENT");
    expect(error.syscall).toBe("spawn /ctx-fixture-missing-executable");
    expect(error.message).toContain("ENOENT");
  });

  it("reports authentic bounded output growth, never command or output text", async () => {
    const updates: ToolUpdate[] = [];
    expect((await call("productive", { onUpdate: (value) => updates.push(value) })).content[0].text).toBe("fixture result");
    const progress = updates.map((value) => value.details!.progress as { outputBytes: number; completed: number });
    expect(progress.some((value) => value.outputBytes > 0)).toBe(true);
    expect(progress.some((value) => value.completed === 1)).toBe(true);
    expect(new Set(updates.map((update) => JSON.stringify(update))).size).toBe(updates.length);
    expect(updates.length).toBeLessThan(25);
    expect(JSON.stringify(updates)).not.toContain("fixture output");
    expect(JSON.stringify(updates)).not.toContain(dir);
  });

  it("sends no heartbeat during a silent command", async () => {
    let updates = 0;
    const pending = call("silent", { onUpdate: () => updates++ }, { duration: 700 });
    await waitFor(() => pids().length === 1);
    await delay(100);
    const before = updates;
    await delay(250);
    expect(updates).toBe(before);
    await pending;
  });

  it("honors pre-abort without importing or starting a command", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(call("silent", { signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(existsSync(resolve(dir, "started"))).toBe(false);
  });

  it("cancels startup before any command starts", async () => {
    env.CTX_FIXTURE_STARTUP_FILE = resolve(dir, "importing");
    const controller = new AbortController();
    const pending = call("silent", { signal: controller.signal });
    await waitFor(() => existsSync(env.CTX_FIXTURE_STARTUP_FILE!));
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(existsSync(resolve(dir, "started"))).toBe(false);
  });

  it.each([1, 2])("cancels active execution and stops serial/parallel queues (concurrency=%i)", async (concurrency) => {
    const controller = new AbortController();
    const pending = call("silent", { signal: controller.signal }, { count: 5, concurrency, duration: 10000 });
    await waitFor(() => pids().length === concurrency);
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(readFileSync(resolve(dir, "started"), "utf8").trim().split("\n")).toHaveLength(concurrency);
    expect(pids().every((pid) => !ownedIsAlive(pid))).toBe(true);
    for (const pid of pids()) expect(() => process.kill(pid, 0)).toThrow();
  });

  it.each(["ctx_search", "ctx_execute_file"] as const)("cancels blocking backend work in %s", async (name) => {
    const controller = new AbortController();
    const pending = call("block", { signal: controller.signal }, {}, name);
    await waitFor(() => existsSync(resolve(dir, "started")));
    const start = Date.now();
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it("cancels blocking indexing after command completion", async () => {
    const controller = new AbortController();
    const blockMarker = resolve(dir, "indexing");
    const pending = call("index-block", { signal: controller.signal }, { blockMarker, duration: 100 });
    await waitFor(() => existsSync(blockMarker));
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(pids().every((pid) => !ownedIsAlive(pid))).toBe(true);
  });

  it("kills Unix command groups including TERM-resistant descendants", async () => {
    const controller = new AbortController();
    const pending = call("tree", { signal: controller.signal }, { duration: 10000 });
    await waitFor(() => pids().length === 2);
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(ownedIsAlive(pids()[0])).toBe(false);
  });

  it("cleans active commands when onUpdate throws", async () => {
    const pending = call("productive", { onUpdate: (update) => {
      if ((update.details!.progress as { outputBytes: number }).outputBytes > 0) throw new Error("update failed");
    } }, { duration: 10000 });
    await expect(pending).rejects.toThrow("update failed");
    expect(pids().every((pid) => !ownedIsAlive(pid))).toBe(true);
  });

  it.each(["throw-after-spawn", "bad-progress", "bad-protocol"])("cleans subprocesses on backend/protocol failure (%s)", async (mode) => {
    await expect(call(mode, {}, { duration: 10000 })).rejects.toThrow(/fixture failure|Invalid Context Mode/);
    expect(pids().length).toBe(1);
    expect(ownedIsAlive(pids()[0])).toBe(false);
  });

  it("cleans leftover owned subprocesses before returning success", async () => {
    expect((await call("orphan", {}, { duration: 10000 })).content[0].text).toBe("orphan result");
    expect(pids().length).toBe(1);
    expect(ownedIsAlive(pids()[0])).toBe(false);
  });

  it.each(["crash", "throw"])("reports backend %s without returning success", async (mode) => {
    await expect(call(mode)).rejects.toThrow(/exited without a result|fixture failure/);
  });

  it.each(["tree", "block"])("cleans the worker and groups after IPC parent death (%s)", async (mode) => {
    let workerPid = 0;
    const parent = fork(resolve(fixtureRoot, "parent.mjs"), [resolve(fixtureRoot, "server.bundle.mjs"), dir, mode, resolve(dir, "started"), resolve(dir, "pids")], {
      env, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    parent.on("message", (value) => { workerPid = (value as { workerPid: number }).workerPid; });
    try {
      await waitFor(() => workerPid > 0 && (mode === "tree" ? pids().length === 2 : existsSync(resolve(dir, "started"))));
      const exit = new Promise<void>((resolve) => parent.once("exit", () => resolve()));
      parent.kill("SIGKILL");
      await exit;
      await waitFor(() => {
        try { process.kill(workerPid, 0); return false; } catch { return true; }
      });
      if (mode === "tree") expect(ownedIsAlive(pids()[0])).toBe(false);
    } finally {
      parent.kill("SIGKILL");
      if (workerPid) { try { process.kill(workerPid, "SIGKILL"); } catch {} }
    }
  });

  describe("synchronous subprocess fallback", () => {
    let sentinel: ReturnType<typeof childProcess.spawn>;
    const alive = (pid: number, readStat: (path: string, encoding: "utf8") => string = readFileSync) => {
      if (process.platform === "linux") {
        try {
          const stat = readStat(`/proc/${pid}/stat`, "utf8");
          return !["Z", "X"].includes(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0]);
        } catch (error) {
          // A process can disappear before opening stat or while reading it.
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ESRCH") return false;
          throw error;
        }
      }
      try { process.kill(pid, 0); return true; } catch { return false; }
    };
    const assertClean = () => {
      expect(pids()).toHaveLength(2);
      expect(pids().every((pid) => !alive(pid))).toBe(true);
      expect(alive(sentinel.pid!)).toBe(true);
    };
    beforeEach(() => {
      // This child inherits the test host group, not a worker's private group.
      sentinel = childProcess.spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    });
    afterEach(async () => {
      // Also reap fixtures when an assertion fails against the unfixed worker.
      for (const pid of pids()) { try { process.kill(pid, "SIGKILL"); } catch {} }
      const exit = new Promise<void>((resolve) => sentinel.once("exit", () => resolve()));
      sentinel.kill("SIGKILL");
      await exit;
    });

    describe.skipIf(process.platform !== "linux")("process probe", () => {
      it.each(["ENOENT", "ESRCH"])("returns false when stat disappears (%s)", (code) => {
        const error = Object.assign(new Error("fixture disappeared"), { code });
        expect(alive(123, (path, encoding) => {
          expect(path).toBe("/proc/123/stat");
          expect(encoding).toBe("utf8");
          throw error;
        })).toBe(false);
      });

      it.each([["R", true], ["S", true], ["Z", false], ["X", false]] as const)("preserves stat state %s", (state, expected) => {
        expect(alive(123, (path, encoding) => {
          expect(path).toBe("/proc/123/stat");
          expect(encoding).toBe("utf8");
          return `123 (fixture with ) name) ${state} 1 123`;
        })).toBe(expected);
      });

      it("propagates an unexpected stat error unchanged", () => {
        const error = Object.assign(new Error("fixture access denied"), { code: "EACCES" });
        let caught: unknown;
        try {
          alive(123, (path, encoding) => {
            expect(path).toBe("/proc/123/stat");
            expect(encoding).toBe("utf8");
            throw error;
          });
        } catch (failure) {
          caught = failure;
        }
        expect(caught).toBe(error);
      });
    });

    it.each([
      ["execFileSync", "resistant"], ["spawnSync", "resistant"],
      ["execFileSync", "ordinary"], ["spawnSync", "ordinary"],
    ])("cleans a blocked startup probe on abort (%s, %s)", async (api, behavior) => {
      env.CTX_FIXTURE_SYNC_STARTUP = api;
      env.CTX_FIXTURE_SYNC_PIDS = resolve(dir, "pids");
      env.CTX_FIXTURE_SYNC_BEHAVIOR = behavior;
      const controller = new AbortController();
      const updates: ToolUpdate[] = [];
      const pending = call("silent", { signal: controller.signal, onUpdate: (update) => updates.push(update) });
      await waitFor(() => pids().length === 2);
      controller.abort();
      await expect(pending).rejects.toThrow(/cancelled/);
      assertClean();
      expect(existsSync(resolve(dir, "started"))).toBe(false);
      expect(updates.every((update) => (update.details!.progress as { started: number }).started === 0)).toBe(true);
    });

    it.each([
      ["sync-exec", "resistant"], ["sync-spawn", "resistant"],
      ["sync-exec", "ordinary"], ["sync-spawn", "ordinary"],
    ])("cleans blocked execution on abort (%s, %s)", async (mode, behavior) => {
      const controller = new AbortController();
      const pending = call(mode, { signal: controller.signal }, { behavior });
      await waitFor(() => pids().length === 2);
      controller.abort();
      await expect(pending).rejects.toThrow(/cancelled/);
      assertClean();
    });

    it.each(["sync-exec", "sync-spawn"])("cleans a returned synchronous call's leftover descendant (%s)", async (mode) => {
      const updates: ToolUpdate[] = [];
      expect((await call(mode, { onUpdate: (update) => updates.push(update) }, { leftover: true })).content[0].text).toBe("sync result");
      assertClean();
      expect(updates.every((update) => (update.details!.progress as { started: number }).started === 0)).toBe(true);
    });

    it.each(["sync-exec", "sync-spawn"])("cleans synchronous leftovers before returning an error (%s)", async (mode) => {
      await expect(call(mode, {}, { leftover: true, fail: true })).rejects.toThrow("fixture failure after sync");
      assertClean();
    });

    it.each([
      ["sync-exec", "death"], ["sync-spawn", "death"],
      ["sync-exec", "disconnect"], ["sync-spawn", "disconnect"],
    ])("cleans synchronous leftovers when the parent acts on terminal receipt (%s, %s)", async (mode, action) => {
      let workerPid = 0;
      const parent = fork(resolve(fixtureRoot, "parent.mjs"), [resolve(fixtureRoot, "server.bundle.mjs"), dir, mode, resolve(dir, "started"), resolve(dir, "pids"), action], {
        env, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      parent.on("message", (value) => { workerPid = (value as { workerPid: number }).workerPid; });
      try {
        await waitFor(() => workerPid > 0 && existsSync(resolve(dir, "started")));
        expect(readFileSync(resolve(dir, "started"), "utf8")).toBe("result");
        await waitFor(() => !alive(workerPid) && pids().every((pid) => !alive(pid)));
        assertClean();
        if (action === "disconnect") expect(alive(parent.pid!)).toBe(true);
        else await waitFor(() => !alive(parent.pid!));
      } finally {
        parent.kill("SIGKILL");
        if (workerPid) await cleanupOwned(new Set([workerPid]));
      }
    });

    it.each([
      ["sync-exec", "SIGKILL"], ["sync-spawn", "SIGKILL"],
      ["sync-exec", "SIGTERM"], ["sync-spawn", "SIGTERM"],
    ] as const)("cleans synchronous children after a worker crash/forced exit (%s, %s)", async (mode, signal) => {
      const workerPid = resolve(dir, "worker-pid");
      const pending = call(mode, {}, { workerPid });
      await waitFor(() => pids().length === 2);
      process.kill(Number(readFileSync(workerPid, "utf8")), signal);
      await expect(pending).rejects.toThrow(/exited without a result/);
      assertClean();
    });

    it.each([
      ["sync-exec", "death"], ["sync-spawn", "death"],
      ["sync-exec", "disconnect"], ["sync-spawn", "disconnect"],
    ])("cleans synchronous children after IPC parent %s/%s", async (mode, action) => {
      let workerPid = 0;
      const parent = fork(resolve(fixtureRoot, "parent.mjs"), [resolve(fixtureRoot, "server.bundle.mjs"), dir, mode, resolve(dir, "started"), resolve(dir, "pids")], {
        env, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      parent.on("message", (value) => { workerPid = (value as { workerPid: number }).workerPid; });
      try {
        await waitFor(() => workerPid > 0 && pids().length === 2);
        if (action === "death") parent.kill("SIGKILL");
        else parent.send("disconnect");
        await waitFor(() => !alive(workerPid));
        // No invocation client remains to clean up. The worker must kill its own group.
        await waitFor(() => pids().every((pid) => !alive(pid)));
        assertClean();
        if (action === "disconnect") expect(alive(parent.pid!)).toBe(true);
      } finally {
        parent.kill("SIGKILL");
        if (workerPid) { try { process.kill(workerPid, "SIGKILL"); } catch {} }
      }
    });
  });

  it("changed real updates renew the delegate tool lease; duplicate updates do not", async () => {
    let now = 0;
    const monitor = new PiRpcMonitor(0, "2026-01-01T00:00:00Z", () => now);
    monitor.acceptPrompt(1);
    monitor.consumeEvent(1, { type: "agent_start" });
    monitor.consumeEvent(1, { type: "tool_execution_start", toolCallId: "ctx", toolName: "ctx_batch_execute", args: {} });
    let last: ToolUpdate | undefined;
    await call("productive", { onUpdate: (update) => {
      now += 50;
      const event = { type: "tool_execution_update", toolCallId: "ctx", toolName: "ctx_batch_execute", partialResult: update };
      monitor.consumeEvent(1, event);
      expect(monitor.snapshot().activeToolLastNovelUpdateMonotonic).toBe(now);
      now += 10;
      monitor.consumeEvent(1, event);
      expect(monitor.snapshot().activeToolLastNovelUpdateMonotonic).toBe(now - 10);
      last = update;
    } });
    expect(last).toBeDefined();
    expect(monitor.snapshot().errors).toEqual([]);
  });

  it.each(["productive", "silent"])("reduced lease permits productive long execution but stalls silence (%s)", async (mode) => {
    const start = performance.now();
    const monitor = new PiRpcMonitor(start, new Date().toISOString());
    monitor.acceptPrompt(1);
    monitor.consumeEvent(1, { type: "agent_start" });
    monitor.consumeEvent(1, { type: "tool_execution_start", toolCallId: "ctx", toolName: "ctx_batch_execute", args: {} });
    const controller = new AbortController();
    let stalled = false;
    let checking = false;
    const pending = call(mode, { signal: controller.signal, onUpdate: (update) => {
      monitor.recordValidRpc();
      monitor.consumeEvent(1, { type: "tool_execution_update", toolCallId: "ctx", toolName: "ctx_batch_execute", partialResult: update });
      if ((update.details!.progress as { started: number }).started > 0) checking = true;
    } }, { duration: 1000 });
    const poll = setInterval(() => {
      if (!checking) return;
      const snapshot = monitor.snapshot();
      const now = performance.now();
      const decision = evaluateLiveness({
        rpcIdleMs: now - snapshot.lastValidRpcMonotonic,
        activityIdleMs: now - snapshot.lastActivityMonotonic,
        progressIdleMs: now - snapshot.lastStructuralProgressMonotonic,
        activeToolIdleMs: now - snapshot.activeToolLastNovelUpdateMonotonic!,
        duplicateCheckpointsSinceNovel: snapshot.duplicateCheckpointsSinceNovel,
      }, { activityIdleMs: 400, activityWarningMs: 300, progressStallMs: 10000, progressWarningMs: 9000 });
      if (decision.action === "stall") { stalled = true; controller.abort(); }
    }, 20);
    try {
      if (mode === "silent") await expect(pending).rejects.toThrow(/cancelled/);
      else expect((await pending).content[0].text).toBe("fixture result");
      expect(stalled).toBe(mode === "silent");
      if (mode === "productive") expect(performance.now() - start).toBeGreaterThan(1000);
    } finally { clearInterval(poll); }
  });

  it.each([1, 2])("cancels installed upstream queues (concurrency=%i)", async (concurrency) => {
    const { CONTEXT_MODE_ROOT: _root, ...upstreamEnv } = env;
    const controller = new AbortController();
    const commandFile = resolve(fixtureRoot, "command.mjs");
    const command = `${process.execPath} ${commandFile} silent ${resolve(dir, "pids")} 10000`;
    const pending = callCtxTool(dir, "ctx_batch_execute", {
      commands: Array.from({ length: 5 }, (_, index) => ({ label: `fixture-${index}`, command })),
      queries: ["fixture"], timeout: 12000, concurrency, cwd: dir, query_scope: "batch",
    }, { env: upstreamEnv }, { signal: controller.signal });
    await waitFor(() => pids().length === concurrency);
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(pids().length).toBe(concurrency);
    // These are shell descendants, so check their state as well as group leaders.
    for (const pid of pids()) {
      if (existsSync(`/proc/${pid}/stat`)) {
        expect(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0]).toBe("Z");
      }
    }
  });

  it("cleans installed upstream explicit-timeout command groups", async () => {
    const { CONTEXT_MODE_ROOT: _root, ...upstreamEnv } = env;
    const sentinel = childProcess.spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: "ignore" });
    try {
      const command = `${process.execPath} ${resolve(fixtureRoot, "command.mjs")} tree ${resolve(dir, "pids")} 10000`;
      const result = await callCtxTool(dir, "ctx_batch_execute", {
        commands: [{ label: "timeout-tree", command }], queries: ["timeout"], timeout: 1200, concurrency: 1, cwd: dir, query_scope: "batch",
      }, { env: upstreamEnv });
      expect(result.content[0].text).toMatch(/timed?\s*out|timeout/i);
      expect(pids()).toHaveLength(2);
      // Upstream kills -proc.pid, which is the detached shell's group, not these children.
      for (const pid of pids()) {
        if (existsSync(`/proc/${pid}/stat`)) expect(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0]).toBe("Z");
      }
      expect(ownedIsAlive(sentinel.pid!)).toBe(true);
    } finally {
      await cleanupOwned(new Set([sentinel.pid!]));
    }
  }, 10000);

  it("smokes the installed upstream bundle with shared storage and real progress", async () => {
    const { CONTEXT_MODE_ROOT: _root, ...upstreamEnv } = env;
    const updates: ToolUpdate[] = [];
    const result = await callCtxTool(dir, "ctx_batch_execute", {
      commands: [{ label: "fixture", command: "printf 'CTX_WORKER_SMOKE\\n'" }],
      queries: ["CTX_WORKER_SMOKE"], timeout: 2000, concurrency: 1, cwd: dir, query_scope: "batch",
    }, { env: upstreamEnv }, { onUpdate: (update) => updates.push(update) });
    expect(result.content[0].text).toContain("CTX_WORKER_SMOKE");
    expect(updates.some((update) => (update.details!.progress as { outputBytes: number }).outputBytes > 0)).toBe(true);
    const search = await callCtxTool(dir, "ctx_search", { queries: ["CTX_WORKER_SMOKE"] }, { env: upstreamEnv });
    expect(search.content[0].text).toContain("CTX_WORKER_SMOKE");
    const file = resolve(dir, "input.txt");
    writeFileSync(file, "CTX_FILE_SMOKE");
    const executed = await callCtxTool(dir, "ctx_execute_file", { path: file, language: "javascript", code: "console.log(FILE_CONTENT)", timeout: 2000 }, { env: upstreamEnv });
    expect(executed.content[0].text).toContain("CTX_FILE_SMOKE");
  }, 15000);
});
