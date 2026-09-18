import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createQueries, EXEC_TIMEOUT_MS, RUN_FIELDS } from "./github.ts";
import { formatResult, safeText } from "./output.ts";
import { watchRuns } from "./watch.ts";
import { Clock, flush, snapshot, untilAbort } from "./test-helpers.ts";

function response(value: unknown): ExecResult {
  return {
    code: 0,
    killed: false,
    stdout: JSON.stringify(value),
    stderr: "UNRETURNED_STDERR",
  };
}

const run = { repo: "o/r", runs: [{ id: 1 }] };

test("adapter uses only gh run view, exact bounded fields, repo, signal, and 30s timeout", async () => {
  const controller = new AbortController();
  const calls: Parameters<ExtensionAPI["exec"]>[] = [];
  const queries = createQueries({
    exec: async (...args) => {
      calls.push(args);
      return response(args[1].at(-1) === "jobs" ? { jobs: [] } : snapshot());
    },
  });
  await queries.queryRun("o/r", 1, controller.signal);
  await queries.queryFailureSummary("o/r", 1, controller.signal);
  assert.deepEqual(calls, [
    [
      "gh",
      ["run", "view", "1", "--repo", "o/r", "--json", RUN_FIELDS],
      { signal: controller.signal, timeout: EXEC_TIMEOUT_MS },
    ],
    [
      "gh",
      ["run", "view", "1", "--repo", "o/r", "--json", "jobs"],
      { signal: controller.signal, timeout: EXEC_TIMEOUT_MS },
    ],
  ]);
});

test("failure summaries retain only failed jobs and failed step names", async () => {
  const queries = createQueries({
    exec: async () =>
      response({
        jobs: [
          { name: "SUCCESS_NOISE", conclusion: "success", steps: [] },
          { name: "SKIPPED_DOWNSTREAM", conclusion: "skipped", steps: [] },
          { name: "NEUTRAL_NOISE", conclusion: "neutral", steps: [] },
          {
            name: "unit",
            conclusion: "failure",
            url: "https://github.com/o/r/actions/runs/1/job/9?token=hidden#hidden",
            steps: [
              { name: "checkout", conclusion: "success" },
              { name: "test suite", conclusion: "failure" },
              { name: "upload", conclusion: "skipped" },
            ],
          },
          { name: "integration", conclusion: "timed_out", steps: [] },
          { name: "omitted", conclusion: "failure", steps: [] },
        ],
      }),
  });
  const summary = await queries.queryFailureSummary(
    "o/r",
    1,
    new AbortController().signal,
  );
  assert.deepEqual(summary, {
    jobs: [
      {
        name: "unit",
        conclusion: "failure",
        steps: ["test suite"],
        omittedSteps: 0,
        url: "https://github.com/o/r/actions/runs/1/job/9",
      },
      {
        name: "integration",
        conclusion: "timed_out",
        steps: [],
        omittedSteps: 0,
        url: null,
      },
    ],
    omittedJobs: 1,
  });
});

for (const raw of [
  { code: 1, killed: false, stdout: "RAW_STDOUT", stderr: "RAW_STDERR" },
  { code: 0, killed: true, stdout: "RAW_STDOUT", stderr: "RAW_STDERR" },
  { code: 0, killed: false, stdout: "{INVALID_JSON_RAW", stderr: "RAW_STDERR" },
]) {
  test("command and JSON errors expose no stdout or stderr", async () => {
    const queries = createQueries({ exec: async () => raw });
    await assert.rejects(
      queries.queryRun("o/r", 1, new AbortController().signal),
      { message: "github_ci_wait: gh query failed." },
    );
  });
}

for (const method of ["queryRun", "queryFailureSummary"] as const) {
  test(`unsignalled AbortError rejection is sanitized by ${method}`, async () => {
    const controller = new AbortController();
    const queries = createQueries({
      exec: async () => {
        throw Object.assign(new Error("RAW_ABORT"), { name: "AbortError" });
      },
    });
    await assert.rejects(
      queries[method]("o/r", 1, controller.signal),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "Error");
        assert.equal(error.message, "github_ci_wait: gh query failed.");
        assert.equal(error.cause, undefined);
        assert.ok(!error.stack?.includes("RAW_ABORT"));
        return true;
      },
    );
    assert.equal(controller.signal.aborted, false);
  });
}

for (const mode of ["AbortError", "killed"] as const) {
  test(`unsignalled ${mode} query failures remain transient`, async () => {
    const clock = new Clock();
    let calls = 0;
    const queries = createQueries({
      exec: async () => {
        if (++calls <= 2) {
          if (mode === "AbortError")
            throw Object.assign(new Error("RAW_ABORT"), { name: mode });
          return { code: 143, killed: true, stdout: "RAW", stderr: "RAW" };
        }
        return response(snapshot());
      },
    });
    const work = watchRuns(
      { ...run, intervalSeconds: 5 },
      { ...queries, sleep: clock.sleep, now: clock.now },
    );
    await flush();
    await clock.advance(5000);
    await clock.advance(5000);
    const result = await work;
    assert.equal(result.outcome, "PASS");
    assert.equal(result.pollCount, 3);
    assert.equal(calls, 3);
    assert.equal(clock.pending.size, 0);
    assert.ok(!JSON.stringify(result).includes("RAW"));
  });
}

test("malformed run and oversized optional jobs responses have concise errors", async () => {
  const queries = createQueries({
    exec: async (_command, args) => {
      if (args.at(-1) === "jobs")
        return { ...response({}), stdout: "x".repeat(2_000_001) };
      return response({
        status: "completed",
        conclusion: "success",
        attempt: "invalid",
      });
    },
  });
  await assert.rejects(
    queries.queryRun("o/r", 1, new AbortController().signal),
    { message: "github_ci_wait: invalid run response." },
  );
  await assert.rejects(
    queries.queryFailureSummary("o/r", 1, new AbortController().signal),
    { message: "github_ci_wait: gh query failed." },
  );
});

for (const mode of ["reject", "killed"] as const) {
  test(`cancellation during gh call (${mode}) returns CANCELLED after draining`, async () => {
    const clock = new Clock();
    const controller = new AbortController();
    let pending = 0;
    let passedSignal: AbortSignal | undefined;
    const queries = createQueries({
      exec: async (_command, _args, options) => {
        passedSignal = options?.signal;
        assert.ok(passedSignal);
        pending++;
        try {
          await untilAbort(passedSignal);
          throw new Error("unreachable");
        } catch (error) {
          if (mode === "reject") throw error;
          return { code: 143, killed: true, stdout: "RAW", stderr: "RAW" };
        } finally {
          pending--;
        }
      },
    });
    const work = watchRuns(
      run,
      { ...queries, sleep: clock.sleep, now: clock.now },
      controller.signal,
    );
    await flush();
    controller.abort();
    const result = await work;
    assert.equal(result.outcome, "CANCELLED");
    assert.ok(passedSignal?.aborted);
    assert.equal(pending, 0);
    assert.equal(clock.pending.size, 0);
    assert.ok(!JSON.stringify(result).includes("RAW"));
  });
}

test("adversarial labels, jobs, steps, and URLs stay bounded without JSON or control characters", async () => {
  const clock = new Clock();
  const queries = createQueries({
    exec: async (_command, args) => {
      const id = Number(args[2]);
      if (args.at(-1) !== "jobs")
        return response({
          ...snapshot("completed", "failure"),
          url: `https://github.com/o/r/actions/runs/${id}`,
        });
      return response({
        jobs: Array.from({ length: 10 }, () => ({
          name: '\u001b[31m{"name":"' + "😀".repeat(1000) + '"}\n',
          conclusion: "failure",
          url: `https://github.com/o/r/actions/runs/${id}/job/123?credential=DO_NOT_RETURN`,
          steps: Array.from({ length: 10 }, () => ({
            name: "\r\n\u202e" + "文".repeat(1000),
            conclusion: "failure",
          })),
        })),
      });
    },
  });
  const result = await watchRuns(
    {
      repo: "o/r",
      failFast: false,
      runs: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        label: "😀".repeat(80),
      })),
    },
    { ...queries, now: clock.now, sleep: clock.sleep },
  );
  const content = formatResult(result);
  assert.ok(content.startsWith("FAIL:"));
  assert.ok(content.split("\n").length < 25);
  assert.ok(Buffer.byteLength(content) < 4000);
  assert.ok(!/[{}"\r\u001b\u202e]/u.test(content));
  assert.ok(!content.includes("DO_NOT_RETURN"));
  assert.ok(!content.includes("\ufffd"));
  assert.match(content, /truncated/);
  assert.equal(result.runs.length, 10);
  for (const state of result.runs)
    assert.match(
      content,
      new RegExp(`#${state.id} attempt 1: completed/failure`),
    );
  assert.equal(result.failures[0].jobs.length, 2);
  assert.equal(result.failures[0].jobs[0].steps.length, 3);
  assert.equal(result.failures[0].jobs[0].omittedSteps, 7);
  assert.equal(result.failures[0].omittedJobs, 8);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 12_000);
});

test("known token formats are redacted in names; credential URLs are discarded", async () => {
  assert.equal(safeText("ghp_" + "x".repeat(36)), "redacted");
  const queries = createQueries({
    exec: async () =>
      response({
        ...snapshot(),
        event: "ghp_" + "x".repeat(36),
        url: "https://user:password@github.com/o/r/actions/runs/1",
      }),
  });
  const result = await queries.queryRun("o/r", 1, new AbortController().signal);
  assert.equal(result.url, null);
  assert.equal(result.event, "redacted");
});

test("output contains latest states only, not transitions or raw gh JSON", async () => {
  const clock = new Clock();
  let count = 0;
  const queries = createQueries({
    exec: async () =>
      response(++count === 1 ? snapshot("queued", null) : snapshot()),
  });
  const work = watchRuns(
    { ...run, intervalSeconds: 5 },
    { ...queries, now: clock.now, sleep: clock.sleep },
  );
  await flush();
  await clock.advance(5000);
  const result = await work;
  assert.equal(
    formatResult(result),
    "PASS: (5s; 2 polls)\n#1 attempt 1: completed/success",
  );
  assert.ok(!JSON.stringify(result).includes("queued"));
  assert.deepEqual(Object.keys(result), [
    "outcome",
    "elapsedSeconds",
    "pollCount",
    "runs",
    "failures",
  ]);
});
