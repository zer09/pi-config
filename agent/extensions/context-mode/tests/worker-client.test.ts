import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fork } from "node:child_process";
import { cleanupOwned } from "../src/process-cleanup.mjs";
import { invokeWorker } from "../src/worker-client.js";
import { ProgressFiles } from "../src/progress-files.js";

vi.mock("node:child_process", () => ({ fork: vi.fn() }));
vi.mock("../src/process-cleanup.mjs", () => ({ cleanupOwned: vi.fn() }));

function worker(pid?: number) {
  return Object.assign(new EventEmitter(), {
    pid, connected: true,
    send: vi.fn(), kill: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cleanupOwned).mockResolvedValue(undefined);
});

// No real processes are signalled by these protocol and cleanup-failure tests.
describe("worker settlement", () => {
  it("rejects a failed fork without trying to clean an invalid group", async () => {
    const child = worker();
    vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
    const pending = invokeWorker("file:///fixture.mjs", "/fixture", "ctx_search", {}, {});
    child.emit("error", new Error("fork failed"));
    await expect(pending).rejects.toThrow("fork failed");
    expect(vi.mocked(cleanupOwned).mock.calls.map(([pids]) => [...pids])).toEqual([[]]);
  });

  it.skipIf(process.platform === "win32")("accepts declared private-group teardown only after both cleanup proofs", async () => {
    const child = worker(12345);
    vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
    const pending = invokeWorker("file:///fixture.mjs", "/fixture", "ctx_search", {}, {});
    child.emit("message", { type: "owned", pid: 23456 });
    child.emit("message", { type: "result", result: "clean result", teardown: "private_group" });
    child.emit("exit", null, "SIGKILL");
    await expect(pending).resolves.toBe("clean result");
    expect(vi.mocked(cleanupOwned).mock.calls.map(([pids]) => [...pids])).toEqual([[23456], [12345]]);
  });

  it.skipIf(process.platform === "win32").each([
    [undefined, null, "SIGKILL"], [undefined, 17, null],
    ["private_group", null, "SIGTERM"], ["private_group", 17, null], ["private_group", 0, null],
  ])("rejects an unexpected result exit (teardown=%s, code=%s, signal=%s)", async (teardown, code, signal) => {
    const child = worker(12345);
    vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
    const pending = invokeWorker("file:///fixture.mjs", "/fixture", "ctx_search", {}, {});
    child.emit("message", { type: "result", result: "must not succeed", ...(teardown ? { teardown } : {}) });
    child.emit("exit", code, signal);
    await expect(pending).rejects.toThrow("worker failed after its result");
  });

  it.skipIf(process.platform === "win32")("cleans the fallback group even if async ledger cleanup fails", async () => {
    const child = worker(12345);
    vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
    vi.mocked(cleanupOwned).mockRejectedValueOnce(new Error("ledger cleanup failed"));
    const pending = invokeWorker("file:///fixture.mjs", "/fixture", "ctx_search", {}, {});
    child.emit("message", { type: "owned", pid: 23456 });
    child.emit("message", { type: "result", result: "must not succeed" });
    child.emit("exit", 0, null);
    await expect(pending).rejects.toThrow("ledger cleanup failed");
    expect(vi.mocked(cleanupOwned).mock.calls.map(([pids]) => [...pids])).toEqual([[23456], [12345]]);
    expect(vi.mocked(fork).mock.calls[0][2]?.detached).toBe(true);
  });

  it.skipIf(process.platform === "win32")("does not turn fallback cleanup failure into success", async () => {
    const child = worker(12345);
    vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
    vi.mocked(cleanupOwned).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("fallback cleanup failed"));
    const pending = invokeWorker("file:///fixture.mjs", "/fixture", "ctx_search", {}, {});
    child.emit("message", { type: "result", result: "must not succeed", teardown: "private_group" });
    child.emit("exit", null, "SIGKILL");
    await expect(pending).rejects.toThrow("fallback cleanup failed");
    expect(vi.mocked(cleanupOwned).mock.calls.map(([pids]) => [...pids])).toEqual([[], [12345]]);
  });
});

describe("owner file polling lifetime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("unchanged polls produce no update or novel counter", async () => {
    const poll = vi.spyOn(ProgressFiles.prototype, "poll").mockResolvedValue(0);
    const child = worker();
    vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
    const onUpdate = vi.fn();
    const pending = invokeWorker("file:///fixture.mjs", "/fixture", "ctx_batch_execute", {}, {}, { progressFiles: ["/fixture/log"], onUpdate });
    await vi.advanceTimersByTimeAsync(0);
    child.emit("message", { type: "progress", value: { phase: "executing", started: 1, completed: 0, outputBytes: 0 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(6);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate.mock.calls[0][0].details.progress).not.toHaveProperty("fileBytes");
    child.emit("message", { type: "result", result: "usual result" });
    child.emit("exit", 0, null);
    await expect(pending).resolves.toBe("usual result");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["result", "error", "abort", "crash"])("does not overlap polls or emit late updates after %s", async (end) => {
    let finishPoll!: () => void;
    const poll = vi.spyOn(ProgressFiles.prototype, "poll").mockImplementation(function (this: ProgressFiles, baseline) {
      if (baseline) return Promise.resolve(0);
      return new Promise<number>((resolve) => {
        finishPoll = () => { this.bytes = 42; resolve(42); };
      });
    });
    const child = worker();
    vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
    const controller = new AbortController();
    const onUpdate = vi.fn();
    const pending = invokeWorker("file:///fixture.mjs", "/fixture", "ctx_batch_execute", {}, {}, { progressFiles: ["/fixture/log"], signal: controller.signal, onUpdate });
    const settled = pending.then((result) => result, (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(1200);
    expect(poll).toHaveBeenCalledTimes(2);
    if (end === "abort") controller.abort();
    else if (end !== "crash") child.emit("message", { type: end, result: "usual result", error: "fixture error" });
    child.emit("exit", end === "crash" ? 17 : 0, null);
    const result = await settled;
    if (end === "result") expect(result).toBe("usual result");
    else expect(result).toMatch(/fixture error|cancelled|exited without a result/);
    finishPoll();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an update failure stops file polling and uses existing cancellation cleanup", async () => {
    const poll = vi.spyOn(ProgressFiles.prototype, "poll").mockImplementation(async function (this: ProgressFiles, baseline) {
      if (!baseline) this.bytes++;
      return this.bytes;
    });
    const child = worker();
    vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
    const pending = invokeWorker("file:///fixture.mjs", "/fixture", "ctx_batch_execute", {}, {}, {
      progressFiles: ["/fixture/log"], onUpdate: () => { throw new Error("file update failed"); },
    });
    const settled = pending.catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(200);
    expect(child.send).toHaveBeenCalledWith({ type: "cancel" }, expect.any(Function));
    child.emit("exit", 0, null);
    expect(await settled).toBe("file update failed");
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(cleanupOwned).toHaveBeenCalledOnce();
  });
});
