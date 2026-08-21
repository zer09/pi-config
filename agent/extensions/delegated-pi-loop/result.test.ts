import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  completedMarkdown,
  delegateToolResultPatch,
  diagnosticLine,
  failureMarkdown,
  finalizeDelegateRun,
  finalToolResult,
  stripCompletedMarker,
} from "./result.ts";
import type { DelegateProgress, DelegateRunResult, ToolResult } from "./types.ts";

function progress(overrides: Partial<DelegateProgress> = {}): DelegateProgress {
  return {
    label: "solution-a",
    role: "solution-a",
    state: "stalled",
    protocol: "pi-json",
    route: "opencode-go/muse-spark-1.2-contributor:xhigh",
    attempt: 1,
    phase: "provider",
    lastEvent: "tool_execution_start",
    lastEventDetail: "read",
    lastEventAt: "2026-08-21T10:00:00.000Z",
    idleSeconds: 0,
    elapsedSeconds: 612.4,
    toolExecutionCount: 2,
    idleWarningCount: 0,
    ...overrides,
  };
}

function completedResult(report: string): DelegateRunResult {
  return {
    label: "solution-a",
    role: "solution-a",
    backend: "default",
    state: "completed",
    report,
    artifactDir: "/tmp/delegated-pi-solution-a-abc",
    selectedRoute: "agentrouter/gpt-5.6-sol:max",
    attempts: [
      { route: "opencode-go/muse-spark-1.2-contributor:xhigh", state: "catalog_unavailable", elapsedSeconds: 0.4 },
      { route: "agentrouter/gpt-5.6-sol:max", state: "completed", elapsedSeconds: 612.4 },
    ],
    startedAt: "2026-08-21T09:49:47.600Z",
    endedAt: "2026-08-21T10:00:00.000Z",
    elapsedSeconds: 612.4,
    streamErrors: [],
    progress: progress({ state: "completed", phase: "complete", lastEvent: "agent_settled" }),
  };
}

function failedResult(overrides: Partial<DelegateRunResult> = {}): DelegateRunResult {
  return {
    label: "solution-a",
    role: "solution-a",
    backend: "default",
    state: "stalled",
    report: "SECRET-REPORT-BODY\n\nDELEGATE_RESULT: COMPLETED",
    artifactDir: "/tmp/delegated-pi-solution-a-abc",
    selectedRoute: "opencode-go/muse-spark-1.2-contributor:xhigh",
    attempts: [
      {
        route: "opencode-go/muse-spark-1.2-contributor:xhigh",
        state: "stalled",
        elapsedSeconds: 301.0,
        fallbackReason: "event_idle_before_tools",
      },
    ],
    startedAt: "2026-08-21T09:49:47.600Z",
    endedAt: "2026-08-21T10:00:00.000Z",
    elapsedSeconds: 612.4,
    streamErrors: ["Pi JSON stream ended with a partial line"],
    progress: progress(),
    ...overrides,
  };
}

test("happy path returns exact Markdown with the terminal marker removed", () => {
  const result = completedResult("# Findings\n\nObserved the defect at src/app.ts:12.\n\nDELEGATE_RESULT: COMPLETED");
  assert.equal(completedMarkdown(result), [
    "## Delegate solution-a completed",
    "",
    "route: agentrouter/gpt-5.6-sol:max · elapsed: 612.4s",
    "",
    "# Findings",
    "",
    "Observed the defect at src/app.ts:12.",
  ].join("\n"));
});

test("happy path strips the marker and leaks no artifact or diagnostic paths", () => {
  const text = completedMarkdown(completedResult("Body\n\nDELEGATE_RESULT: COMPLETED\n"));
  assert.doesNotMatch(text, /DELEGATE_RESULT/);
  assert.doesNotMatch(text, /delegated-pi-solution-a-abc/);
  assert.doesNotMatch(text, /report\.md|status\.json|diagnostic/i);
});

test("marker-only reports get a deterministic placeholder body", () => {
  const text = completedMarkdown(completedResult("DELEGATE_RESULT: COMPLETED"));
  assert.match(text, /\(No report body beyond the terminal marker\.\)$/);
});

test("marker stripping tolerates spacing variants and stays Markdown-verbatim", () => {
  assert.equal(stripCompletedMarker("Para\n\nDELEGATE_RESULT:   COMPLETED   \n\n\n"), "Para");
  const kept = completedMarkdown(completedResult("*emphasis* and `code`\n\nDELEGATE_RESULT: COMPLETED"));
  assert.match(kept, /\*emphasis\* and `code`/);
});

test("truncation notice omits paths", () => {
  const body = `${"x".repeat(60 * 1024)}\n\nDELEGATE_RESULT: COMPLETED`;
  const text = completedMarkdown(completedResult(body));
  assert.match(text, /\[Report truncated: \d+ bytes omitted\.\]$/);
  assert.doesNotMatch(text, /delegated-pi-solution-a-abc|report\.md/);
});

test("failure Markdown is exact, sanitized, and acts without diagnostics", () => {
  const text = failureMarkdown(failedResult());
  assert.equal(text, [
    "## Delegate solution-a failed: stalled",
    "",
    "- state: stalled",
    "- role: solution-a",
    "- backend: default",
    "- route: opencode-go/muse-spark-1.2-contributor:xhigh",
    "- phase: provider",
    "- last event: tool_execution_start (read)",
    "- last event at: 2026-08-21T10:00:00.000Z",
    "- elapsed: 612.4s",
    "- attempts: opencode-go/muse-spark-1.2-contributor:xhigh -> stalled (event_idle_before_tools)",
    "",
    "The delegate stopped emitting accepted activity and was terminated at the event-idle deadline.",
  ].join("\n"));
});

test("failure Markdown omits absent route and bounds untrusted fields", () => {
  const result = failedResult({
    selectedRoute: undefined,
    attempts: [],
    progress: progress({
      phase: "provider",
      lastEvent: `${"e".repeat(200)}`,
      lastEventDetail: `${"d".repeat(300)}`,
    }),
  });
  const text = failureMarkdown(result);
  assert.doesNotMatch(text, /- route:/);
  assert.doesNotMatch(text, /- attempts:/);
  assert.match(text, new RegExp(`- last event: ${"e".repeat(80)} \\(${"d".repeat(80)}\\)`));
});

test("failure Markdown never exposes the report, output, or any paths", () => {
  const text = failureMarkdown(failedResult());
  assert.doesNotMatch(text, /SECRET-REPORT-BODY/);
  assert.doesNotMatch(text, /DELEGATE_RESULT/);
  assert.doesNotMatch(text, /delegated-pi-solution-a-abc|report\.md|status\.json/);
  assert.doesNotMatch(text, /logs\/delegated-pi-loop/);
});

test("every non-completed state has a deterministic safe summary", () => {
  const states = [
    "catalog_check", "running", "routes_unavailable", "stalled", "timed_out", "output_limit",
    "blocked", "delegate_failed", "invalid_result", "invalid_stream", "missing_report",
    "child_failed", "spawn_failed", "interrupted",
  ];
  const summaries = new Set(states.map((state) => failureMarkdown(failedResult({ state: state as DelegateRunResult["state"] })).split("\n").pop()));
  // Every state maps to a non-empty fixed sentence, with real spread across states.
  assert.equal(summaries.has(""), false);
  assert.ok(summaries.size > 1);
  for (const state of states) {
    const text = failureMarkdown(failedResult({ state: state as DelegateRunResult["state"] }));
    assert.match(text, new RegExp(`^- state: ${state}$`, "m"));
  }
});

test("tool_result patch marks only unsuccessful delegate_run results as errors", () => {
  assert.deepEqual(delegateToolResultPatch({ toolName: "delegate_run", details: { state: "stalled" } }), { isError: true });
  assert.deepEqual(delegateToolResultPatch({ toolName: "delegate_run", details: { state: "invalid_result" } }), { isError: true });
  assert.equal(delegateToolResultPatch({ toolName: "delegate_run", details: { state: "completed" } }), undefined);
  assert.equal(delegateToolResultPatch({ toolName: "bash", details: { state: "stalled" } }), undefined);
  assert.equal(delegateToolResultPatch({ toolName: "delegate_run", details: undefined }), undefined);
  assert.equal(delegateToolResultPatch({ toolName: "delegate_run", details: { state: 7 } }), undefined);
  assert.equal(delegateToolResultPatch({ toolName: "delegate_run", details: null }), undefined);
});

test("final tool result keeps the diagnostic path out of content and in details", () => {
  const completed = finalToolResult(completedResult("Done\n\nDELEGATE_RESULT: COMPLETED")) as ToolResult;
  const completedText = completed.content[0]!.text;
  assert.match(completedText, /## Delegate solution-a completed/);
  assert.equal("diagnosticPath" in (completed.details ?? {}), false);
  assert.doesNotMatch(completedText, /delegated-pi-solution-a-abc/);

  const diagnosticPath = "/home/gc/.pi/agent/logs/delegated-pi-loop/failure-solution-a-1-2.json";
  const failed = finalToolResult(failedResult(), diagnosticPath) as ToolResult;
  assert.equal(failed.details?.diagnosticPath, diagnosticPath);
  assert.equal(failed.content[0]!.text.includes(diagnosticPath), false);
  assert.equal(failed.details?.state, "stalled");
  assert.deepEqual(failed.details?.attempts, failedResult().attempts);
  assert.equal("fingerprintBefore" in (failed.details ?? {}), false);
  assert.equal("fingerprintAfter" in (failed.details ?? {}), false);
});

test("diagnostic footer line is TUI-formatted with the raw path", () => {
  const line = diagnosticLine("/tmp/logs/failure.json");
  assert.match(line, /^diagnostic log: \/tmp\/logs\/failure\.json$/);
});

function enoent(error: NodeJS.ErrnoException): boolean {
  return error.code === "ENOENT";
}

async function withDiagnosticsRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-finalize-diag-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    return await run(root);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
}

async function tempArtifactDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "delegate-finalize-test-"));
  await writeFile(path.join(directory, "prompt.md"), "prompt");
  const attemptDir = path.join(directory, "attempt-01");
  await mkdir(attemptDir, { recursive: true });
  await writeFile(path.join(attemptDir, "report.md"), "report");
  return directory;
}

test("finalizeDelegateRun assembles the completed result and removes every temp artifact", async () => {
  const artifactDir = await tempArtifactDir();
  const toolResult = await finalizeDelegateRun({ ...completedResult("Done\n\nDELEGATE_RESULT: COMPLETED"), artifactDir });
  assert.match(toolResult.content[0]!.text, /## Delegate solution-a completed/);
  assert.doesNotMatch(toolResult.content[0]!.text, /delegate-finalize-test|diagnostic log/);
  assert.equal("diagnosticPath" in (toolResult.details ?? {}), false);
  await assert.rejects(() => stat(artifactDir), enoent);
});

test("finalizeDelegateRun persists the compact diagnostic, then removes every temp artifact", async () => {
  await withDiagnosticsRoot(async (root) => {
    const artifactDir = await tempArtifactDir();
    const toolResult = await finalizeDelegateRun({ ...failedResult(), artifactDir });
    const diagnosticPath = toolResult.details?.diagnosticPath;
    assert.equal(typeof diagnosticPath, "string");
    assert.ok((diagnosticPath as string).startsWith(path.join(root, "logs", "delegated-pi-loop")));
    assert.match(toolResult.content[0]!.text, /## Delegate solution-a failed: stalled/);
    assert.doesNotMatch(toolResult.content[0]!.text, /delegate-finalize-test|diagnostic log/);
    const diagnostic = JSON.parse(await readFile(diagnosticPath as string, "utf8")) as Record<string, unknown>;
    assert.equal("artifactDir" in diagnostic, false);
    assert.doesNotMatch(JSON.stringify(diagnostic), /delegate-finalize-test|\/tmp\/delegated-pi/);
    await assert.rejects(() => stat(artifactDir), enoent);
  });
});

test("finalizeDelegateRun survives a diagnostic write failure with sanitized content and cleanup", async () => {
  // Point PI_CODING_AGENT_DIR at a regular file so the logs mkdir fails.
  const blocker = await mkdtemp(path.join(os.tmpdir(), "delegate-finalize-block-"));
  const notADirectory = path.join(blocker, "not-a-directory");
  await writeFile(notADirectory, "x");
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = notADirectory;
  const artifactDir = await tempArtifactDir();
  let toolResult: ToolResult;
  try {
    toolResult = await finalizeDelegateRun({ ...failedResult(), artifactDir });
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(blocker, { recursive: true, force: true });
  }
  assert.match(toolResult.content[0]!.text, /## Delegate solution-a failed: stalled/);
  assert.match(toolResult.content[0]!.text, /- state: stalled/);
  assert.doesNotMatch(toolResult.content[0]!.text, /SECRET-REPORT-BODY|\/tmp\/|diagnostic log/);
  assert.equal("diagnosticPath" in (toolResult.details ?? {}), false);
  await assert.rejects(() => stat(artifactDir), enoent);
});
