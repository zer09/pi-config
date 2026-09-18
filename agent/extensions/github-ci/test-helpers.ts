import assert from "node:assert/strict";
import { abortError } from "./watch.ts";
import type { RunSnapshot, WatchDependencies } from "./types.ts";

export class Clock {
  milliseconds = 0;
  pending = new Map<object, { at: number; finish(): void }>();
  now = () => this.milliseconds;
  sleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const key = {};
      const cleanup = () => {
        this.pending.delete(key);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(abortError());
      };
      this.pending.set(key, {
        at: this.milliseconds + milliseconds,
        finish: () => {
          cleanup();
          resolve();
        },
      });
      signal.addEventListener("abort", abort, { once: true });
    });
  async advance(milliseconds: number) {
    this.milliseconds += milliseconds;
    for (const wait of [...this.pending.values()]) {
      if (wait.at <= this.milliseconds) wait.finish();
    }
    await flush();
  }
}

export async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

export function snapshot(
  status = "completed",
  conclusion: string | null = "success",
  attempt = 1,
): RunSnapshot {
  return {
    status,
    conclusion,
    attempt,
    headSha: "a".repeat(40),
    event: "push",
    url: "https://github.com/o/r/actions/runs/1",
  };
}

export function fixture(sequences: Record<number, Array<RunSnapshot | Error>>) {
  const clock = new Clock();
  const calls: number[] = [];
  const summaries: number[] = [];
  const deps: WatchDependencies = {
    now: clock.now,
    sleep: clock.sleep,
    async queryRun(_repo, id) {
      calls.push(id);
      const next = sequences[id].shift();
      assert.ok(next, `unexpected query for run ${id}`);
      if (next instanceof Error) throw next;
      return next;
    },
    async queryFailureSummary(_repo, id) {
      summaries.push(id);
      return { jobs: [], omittedJobs: 0 };
    },
  };
  return { clock, calls, summaries, deps };
}

export function untilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
