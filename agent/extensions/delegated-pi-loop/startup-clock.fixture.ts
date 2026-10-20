import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import type { TestContext } from "node:test";
import { PiRpcMonitor } from "./monitor.ts";
import { finalizeDelegateRun } from "./result.ts";
import { runDelegate } from "./runner.ts";
import { terminationProbes, type TerminationProbes } from "./supervisor.ts";
import type { DelegateRunResult, RunOptions, ToolResult } from "./types.ts";

type OwnedChild = {
  child: ChildProcess;
  probes: TerminationProbes;
  runtime: boolean;
  spawnedAt: number;
  readyAt?: number;
  readyClock?: number;
  cleanupAt?: number;
  cleanupClock?: number;
  signals: { name: NodeJS.Signals; at: number }[];
};

export function fixtureAttemptSummary(result: DelegateRunResult): string {
  return JSON.stringify(result.attempts.slice(0, 8).map(({ state, deadlineCause, stallCause }) => ({ state, deadlineCause, stallCause })));
}

/** Exclude only runtime startup from short liveness leases, never idle or cleanup. */
export async function withFixtureStartupClock<T>(
  t: TestContext,
  options: RunOptions,
  body: (result: DelegateRunResult, runtime: OwnedChild[], finalize: () => Promise<ToolResult>) => Promise<T>,
  control: { guardMs?: number } = {},
): Promise<T> {
  const guardMs = control.guardMs ?? 10000;
  assert.ok(guardMs > 0 && guardMs <= 10000);
  const originalNow = performance.now;
  const realNow = originalNow.bind(performance);
  const realSetTimeout = globalThis.setTimeout;
  const originalSpawn = childProcess.spawn;
  const originalBuild = terminationProbes.build;
  const originalAccept = PiRpcMonitor.prototype.acceptPrompt;
  const controller = new AbortController();
  let age = realNow();
  let runningSince: number | undefined = age;
  const clockAt = (real: number) => age + (runningSince === undefined ? 0 : real - runningSince);
  const now = () => clockAt(realNow());
  const pause = () => { age = now(); runningSince = undefined; };
  const resume = () => { runningSince ??= realNow(); };
  const owned: OwnedChild[] = [];
  let current: OwnedChild | undefined;
  const clock = t.mock.method(performance, "now", now);
  const spawnMock = t.mock.method(childProcess, "spawn", (...args: Parameters<typeof originalSpawn>) => {
    const runtime = args[1]?.includes("--mode") === true && args[1].includes("rpc");
    if (runtime) pause();
    const child = originalSpawn(...args);
    const entry: OwnedChild = { child, probes: originalBuild(child), runtime, spawnedAt: realNow(), signals: [] };
    owned.push(entry);
    if (runtime) {
      current = entry;
      // An exiting, never-ready child must still consume the real settlement budget.
      child.once("exit", resume);
    }
    return child;
  });
  syncBuiltinESMExports();
  const acceptMock = t.mock.method(PiRpcMonitor.prototype, "acceptPrompt", function (this: PiRpcMonitor, ...args: Parameters<typeof originalAccept>) {
    resume();
    originalAccept.apply(this, args);
    if (current && current.readyAt === undefined && this.snapshot().sessionSeen) {
      current.readyAt = realNow();
      current.readyClock = clockAt(current.readyAt);
    }
  });
  terminationProbes.build = (child) => {
    // Keep the same epoch. All termination waits and group probes consume real time.
    resume();
    const entry = owned.find((entry) => entry.child === child)!;
    entry.cleanupAt = realNow();
    entry.cleanupClock = clockAt(entry.cleanupAt);
    return {
      ...entry.probes,
      signalGroup: (name) => {
        entry.signals.push({ name, at: realNow() });
        entry.probes.signalGroup(name);
      },
    };
  };
  let failure: Error | undefined;
  const abort = () => { resume(); controller.abort(); };
  const guard = realSetTimeout(() => {
    failure = new Error("Fixture startup guard expired before readiness or settlement");
    abort();
  }, guardMs);
  const onAbort = () => { failure ??= new Error("Fixture startup test aborted"); abort(); };
  t.signal.addEventListener("abort", onAbort, { once: true });
  let result: DelegateRunResult | undefined;
  let finalization: Promise<ToolResult> | undefined;
  // Cache failures too: retrying a partial finalization can write another record.
  const finalize = () => finalization ??= Promise.resolve().then(() => finalizeDelegateRun(result!));
  try {
    result = await runDelegate({ ...options, signal: controller.signal });
    clearTimeout(guard);
    if (failure) throw failure;
    return await body(result, owned.filter((entry) => entry.runtime), finalize);
  } catch (error) {
    if (result && error instanceof Error) error.message += `\n${fixtureAttemptSummary(result)}`;
    throw error;
  } finally {
    abort();
    clearTimeout(guard);
    t.signal.removeEventListener("abort", onAbort);
    try {
      try {
        if (result) await finalize();
      } finally {
        for (const { probes } of owned) {
          if (probes.groupExists()) probes.signalGroup("SIGKILL");
          assert.ok(await probes.waitForClose(3000), "owned streams must close before restoring hooks");
          const deadline = realNow() + 3000;
          while (probes.groupExists() && realNow() < deadline) {
            await new Promise<void>((resolve) => realSetTimeout(resolve, 25));
          }
          assert.equal(probes.groupExists(), false, "every exact owned group must be reaped");
          assert.equal(probes.processIsRunning(), false, "every owned leader must be reaped");
        }
      }
    } finally {
      terminationProbes.build = originalBuild;
      acceptMock.mock.restore();
      spawnMock.mock.restore();
      syncBuiltinESMExports();
      clock.mock.restore();
      assert.equal(performance.now, originalNow);
      assert.equal(childProcess.spawn, originalSpawn);
      assert.equal(terminationProbes.build, originalBuild);
      assert.equal(PiRpcMonitor.prototype.acceptPrompt, originalAccept);
    }
  }
}
