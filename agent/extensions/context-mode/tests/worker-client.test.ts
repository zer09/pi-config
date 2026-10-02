import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fork } from "node:child_process";
import { cleanupOwned } from "../src/process-cleanup.mjs";
import { invokeWorker } from "../src/worker-client.js";

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
