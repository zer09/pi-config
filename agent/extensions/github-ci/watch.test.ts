import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { abortableSleep, watchRuns } from "./watch.ts";
import { fixture, flush, snapshot, untilAbort } from "./test-helpers.ts";

const one = {
  repo: "o/r",
  runs: [{ id: 1, label: "unit" }],
  intervalSeconds: 5,
};
const two = { ...one, runs: [{ id: 1 }, { id: 2 }] };

test("one success is immediate and leaves no deadline task", async () => {
  const f = fixture({ 1: [snapshot()] });
  const result = await watchRuns(one, f.deps);
  assert.equal(result.outcome, "PASS");
  assert.equal(result.pollCount, 1);
  assert.equal(result.elapsedSeconds, 0);
  assert.deepEqual(f.calls, [1]);
  assert.equal(f.clock.pending.size, 0);
});

test("multiple successes poll active runs only and track latest attempt", async () => {
  const f = fixture({
    1: [snapshot()],
    2: [
      snapshot("queued", null),
      snapshot("in_progress", null, 2),
      snapshot("completed", "success", 2),
    ],
  });
  const work = watchRuns(two, f.deps);
  await flush();
  assert.deepEqual(f.calls, [1, 2]);
  await f.clock.advance(5000);
  await f.clock.advance(5000);
  const result = await work;
  assert.equal(result.outcome, "PASS");
  assert.equal(result.pollCount, 3);
  assert.equal(result.runs[1].attempt, 2);
  assert.deepEqual(f.calls, [1, 2, 2, 2]);
  assert.equal(f.clock.pending.size, 0);
});

test("fail-fast aborts and drains a concurrent slow query", async () => {
  const f = fixture({ 1: [snapshot("completed", "failure")] });
  const query = f.deps.queryRun;
  let pending = 0;
  f.deps.queryRun = async (repo, id, signal) => {
    if (id === 1) return query(repo, id, signal);
    pending++;
    try {
      return await untilAbort(signal);
    } finally {
      pending--;
    }
  };
  const result = await watchRuns(two, f.deps);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.runs[1].status, "unknown");
  assert.deepEqual(f.summaries, [1]);
  assert.equal(pending, 0);
  assert.equal(f.clock.pending.size, 0);
});

test("without fail-fast, mixed runs wait for every terminal state", async () => {
  const f = fixture({
    1: [snapshot("completed", "failure")],
    2: [snapshot("pending", null), snapshot()],
  });
  const work = watchRuns({ ...two, failFast: false }, f.deps);
  await flush();
  await f.clock.advance(5000);
  const result = await work;
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.pollCount, 2);
  assert.deepEqual(f.calls, [1, 2, 2]);
  assert.equal(f.clock.pending.size, 0);
});

for (const conclusion of [
  null,
  "",
  "cancelled",
  "neutral",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
  "new_conclusion",
]) {
  test(`completed ${conclusion} is unsuccessful`, async () => {
    const f = fixture({ 1: [snapshot("completed", conclusion)] });
    assert.equal((await watchRuns(one, f.deps)).outcome, "FAIL");
  });
}

for (const status of [
  "queued",
  "waiting",
  "pending",
  "requested",
  "in_progress",
  "future_status",
]) {
  test(`continues ${status} and times out without an extra cycle`, async () => {
    const f = fixture({ 1: [snapshot(status, null)] });
    const work = watchRuns({ ...one, timeoutSeconds: 2 }, f.deps);
    await flush();
    await f.clock.advance(2000);
    const result = await work;
    assert.equal(result.outcome, "TIMEOUT");
    assert.equal(result.elapsedSeconds, 2);
    assert.equal(result.runs[0].status, status);
    assert.deepEqual(f.calls, [1]);
    assert.equal(f.clock.pending.size, 0);
  });
}

test("deadline aborts an in-flight query and drains it", async () => {
  const f = fixture({});
  let pending = 0;
  f.deps.queryRun = async (_repo, _id, signal) => {
    pending++;
    try {
      return await untilAbort(signal);
    } finally {
      pending--;
    }
  };
  const work = watchRuns({ ...one, timeoutSeconds: 1 }, f.deps);
  await flush();
  await f.clock.advance(1000);
  assert.equal((await work).outcome, "TIMEOUT");
  assert.equal(pending, 0);
  assert.equal(f.clock.pending.size, 0);
});

test("cancellation during sleep retains latest state and clears all work", async () => {
  const f = fixture({ 1: [snapshot("in_progress", null, 3)] });
  const controller = new AbortController();
  const work = watchRuns(one, f.deps, controller.signal);
  await flush();
  controller.abort();
  const result = await work;
  assert.equal(result.outcome, "CANCELLED");
  assert.equal(result.runs[0].attempt, 3);
  assert.equal(f.clock.pending.size, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("unsignalled AbortError queries reach the per-run three-strike limit", async () => {
  const hidden = Object.assign(new Error("RAW_QUERY"), { name: "AbortError" });
  const f = fixture({
    1: [hidden, hidden, hidden],
    2: [snapshot("queued", null), snapshot("in_progress", null), snapshot()],
  });
  const controller = new AbortController();
  const work = watchRuns(two, f.deps, controller.signal);
  const checked = assert.rejects(work, {
    name: "Error",
    message: "github_ci_wait: run 1 query failed 3 consecutive times.",
  });
  await flush();
  await f.clock.advance(5000);
  await f.clock.advance(5000);
  await checked;
  assert.deepEqual(f.calls, [1, 2, 1, 2, 1, 2]);
  assert.equal(controller.signal.aborted, false);
  assert.equal(f.clock.pending.size, 0);
});

test("unsignalled interval sleep AbortError becomes a concise operation error", async () => {
  const f = fixture({ 1: [snapshot("in_progress", null)] });
  f.deps.sleep = async (milliseconds, signal) => {
    if (milliseconds === 5000) {
      assert.equal(signal.aborted, false);
      throw Object.assign(new Error("RAW_SLEEP"), { name: "AbortError" });
    }
    return f.clock.sleep(milliseconds, signal);
  };
  await assert.rejects(watchRuns(one, f.deps), {
    name: "Error",
    message: "github_ci_wait: watcher sleep failed.",
  });
  assert.deepEqual(f.calls, [1]);
  assert.equal(f.clock.pending.size, 0);
});

test("already cancelled calls do not query", async () => {
  const f = fixture({});
  const result = await watchRuns(one, f.deps, AbortSignal.abort());
  assert.equal(result.outcome, "CANCELLED");
  assert.equal(result.pollCount, 0);
  assert.equal(f.clock.pending.size, 0);
});

test("transient errors preserve state and success resets the per-run streak", async () => {
  const hidden = new Error("RAW_COMMAND_OUTPUT");
  const f = fixture({
    1: [
      snapshot("waiting", null, 2),
      hidden,
      hidden,
      snapshot("requested", null, 3),
      hidden,
      hidden,
      snapshot(),
    ],
  });
  const work = watchRuns(one, f.deps);
  await flush();
  for (let i = 0; i < 6; i++) await f.clock.advance(5000);
  const result = await work;
  assert.equal(result.outcome, "PASS");
  assert.equal(result.pollCount, 7);
  assert.ok(!JSON.stringify(result).includes("RAW_COMMAND_OUTPUT"));
  assert.equal(f.clock.pending.size, 0);
});

test("timeout after a transient error retains the last known state", async () => {
  const f = fixture({ 1: [snapshot("waiting", null, 4), new Error("RAW")] });
  const work = watchRuns({ ...one, timeoutSeconds: 6 }, f.deps);
  await flush();
  await f.clock.advance(5000);
  await f.clock.advance(1000);
  const result = await work;
  assert.equal(result.outcome, "TIMEOUT");
  assert.equal(result.runs[0].status, "waiting");
  assert.equal(result.runs[0].attempt, 4);
});

test("three consecutive failures throw only a concise operation error", async () => {
  const f = fixture({
    1: [new Error("RAW1"), new Error("RAW2"), new Error("RAW3")],
  });
  const work = watchRuns(one, f.deps);
  const checked = assert.rejects(work, {
    message: "github_ci_wait: run 1 query failed 3 consecutive times.",
  });
  await flush();
  await f.clock.advance(5000);
  await f.clock.advance(5000);
  await checked;
  assert.equal(f.clock.pending.size, 0);
});

test("cycles do not overlap and launch all active queries concurrently", async () => {
  const f = fixture({});
  const signals: AbortSignal[] = [];
  let active = 0;
  f.deps.queryRun = async (_repo, _id, signal) => {
    signals.push(signal);
    active++;
    try {
      return await untilAbort(signal);
    } finally {
      active--;
    }
  };
  const controller = new AbortController();
  const work = watchRuns(two, f.deps, controller.signal);
  await flush();
  assert.equal(active, 2);
  await f.clock.advance(5000);
  assert.equal(signals.length, 2);
  controller.abort();
  assert.equal((await work).outcome, "CANCELLED");
  assert.equal(active, 0);
  assert.equal(f.clock.pending.size, 0);
});

for (const name of ["Error", "AbortError"]) {
  test(`unsignalled optional summary ${name} preserves FAIL without raw messages`, async () => {
    const f = fixture({ 1: [snapshot("completed", "failure")] });
    const controller = new AbortController();
    f.deps.queryFailureSummary = async (_repo, _id, signal) => {
      assert.equal(signal.aborted, false);
      throw Object.assign(new Error("RAW_JSON"), { name });
    };
    const result = await watchRuns(one, f.deps, controller.signal);
    assert.equal(result.outcome, "FAIL");
    assert.equal(result.failures[0].error, "unavailable");
    assert.ok(!JSON.stringify(result).includes("RAW_JSON"));
    assert.equal(controller.signal.aborted, false);
    assert.equal(f.clock.pending.size, 0);
  });
}

test("summary fetching is bounded by the same deadline and preserves FAIL", async () => {
  const f = fixture({ 1: [snapshot("completed", "failure")] });
  f.deps.queryFailureSummary = (_repo, _id, signal) => untilAbort(signal);
  const work = watchRuns({ ...one, timeoutSeconds: 1 }, f.deps);
  await flush();
  await f.clock.advance(1000);
  assert.equal((await work).outcome, "FAIL");
  assert.equal(f.clock.pending.size, 0);
});

test("external cancellation during optional summary returns CANCELLED and drains it", async () => {
  const f = fixture({ 1: [snapshot("completed", "failure")] });
  const controller = new AbortController();
  let pending = 0;
  f.deps.queryFailureSummary = async (_repo, _id, signal) => {
    pending++;
    try {
      return await untilAbort(signal);
    } finally {
      pending--;
    }
  };
  const work = watchRuns(one, f.deps, controller.signal);
  await flush();
  assert.equal(pending, 1);
  controller.abort();
  assert.equal((await work).outcome, "CANCELLED");
  assert.equal(pending, 0);
  assert.equal(f.clock.pending.size, 0);
});

test("abortable sleep removes listeners and timers on resolve, abort, and pre-abort", async (t) => {
  const timers = new Map<number, () => void>();
  let id = 0;
  t.mock.method(globalThis, "setTimeout", (callback: () => void) => {
    timers.set(++id, callback);
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", (handle: number) => {
    timers.delete(handle);
  });
  const controller = new AbortController();
  const completed = abortableSleep(5000, controller.signal);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  await completed;
  assert.equal(timers.size, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const cancelled = abortableSleep(5000, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  await assert.rejects(abortableSleep(5000, controller.signal), {
    name: "AbortError",
  });
  assert.equal(timers.size, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
