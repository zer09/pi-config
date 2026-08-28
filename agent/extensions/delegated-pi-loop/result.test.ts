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
import { PROVIDER_FAILURE_CATEGORIES } from "./types.ts";

function progress(overrides: Partial<DelegateProgress> = {}): DelegateProgress {
  return {
    label: "solution-a",
    role: "solution-a",
    state: "stalled",
    protocol: "pi-rpc",
    route: "opencode-go/muse-spark-1.2-contributor:xhigh",
    attempt: 1,
    phase: "provider",
    lastEvent: "tool_execution_start",
    lastEventDetail: "read",
    lastEventAt: "2026-08-21T10:00:00.000Z",
    activityIdleSeconds: 0,
    elapsedSeconds: 612.4,
    toolExecutionCount: 2,
    activityWarningCount: 0,
    progressWarningCount: 0,
    restartAfterWorkCount: 0,
    reportNudgeCount: 0,
    reportRound: 1,
    rpcIdleSeconds: 0,
    progressIdleSeconds: 0,
    activityEventCount: 7,
    structuralProgressCount: 1,
    duplicateCheckpointCount: 0,
    ...overrides,
  };
}

function completedResult(report: string): DelegateRunResult {
  return {
    label: "solution-a",
    role: "solution-a",
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
    state: "stalled",
    report: "SECRET-REPORT-BODY\n\nDELEGATE_RESULT: COMPLETED",
    artifactDir: "/tmp/delegated-pi-solution-a-abc",
    selectedRoute: "opencode-go/muse-spark-1.2-contributor:xhigh",
    attempts: [
      {
        route: "opencode-go/muse-spark-1.2-contributor:xhigh",
        state: "stalled",
        elapsedSeconds: 301.0,
        restartAfterWork: true,
      },
    ],
    startedAt: "2026-08-21T09:49:47.600Z",
    endedAt: "2026-08-21T10:00:00.000Z",
    elapsedSeconds: 612.4,
    streamErrors: ["Pi JSON stream ended with a partial line"],
    progress: progress({ restartAfterWorkCount: 1 }),
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
    "- route: opencode-go/muse-spark-1.2-contributor:xhigh",
    "- restarts after work: 1",
    "- phase: provider",
    "- last event: tool_execution_start (read)",
    "- last event at: 2026-08-21T10:00:00.000Z",
    "- elapsed: 612.4s",
    "- attempts: opencode-go/muse-spark-1.2-contributor:xhigh -> stalled (restart after work)",
    "",
    "The delegate stopped producing required liveness evidence and was terminated.",
  ].join("\n"));
});

test("failure Markdown carries the fixed stall-cause bullet and summary", () => {
  for (const [cause, summary] of [
    ["rpc_silent", "No valid RPC record arrived from the child within the activity-idle interval."],
    ["activity_idle", "The child kept communicating but produced no accepted task activity within the activity-idle interval."],
    ["active_tool_idle", "An executing tool produced no novel update within the activity-idle interval."],
    ["progress_stagnation", "The delegate produced no novel completed structural checkpoint within the renewable progress lease."],
    ["repeated_cycle", "The delegate repeated already-seen structural checkpoints without novel progress until the progress lease expired."],
    ["report_recovery_idle", "The report-recovery round went silent within its fixed five-minute idle lease."],
  ] as const) {
    const text = failureMarkdown(failedResult({ stallCause: cause }));
    assert.match(text, new RegExp(`^- stall cause: ${cause}$`, "m"), cause);
    assert.match(text, new RegExp(summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "m"), cause);
  }
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

test("failure Markdown and ToolResult details reject seeded operational free text", () => {
  const forbidden = "/home/gc/PRIVATE_PATH sk-SECRET_TOKEN SIGKILL pid=4242 raw-error tool-argument tool-result provider-body";
  const result = failedResult({
    selectedRoute: forbidden,
    deadlineCause: forbidden as never,
    stallCause: forbidden as never,
    cleanupFailureReason: forbidden as never,
    interruptionSource: forbidden as never,
    attempts: [{
      route: forbidden,
      state: "cleanup_failed",
      elapsedSeconds: 1,
      activeToolName: forbidden,
      deadlineCause: forbidden as never,
      stallCause: forbidden as never,
      cleanupFailureReason: forbidden as never,
      interruptionSource: forbidden as never,
    }],
    progress: progress({
      phase: forbidden,
      lastEvent: forbidden,
      lastEventDetail: forbidden,
      lastEventAt: forbidden,
      activeToolCount: 1,
      activeToolName: forbidden,
      stallCause: forbidden as never,
      leaseWarning: forbidden as never,
      providerFailureCategory: `${forbidden} 503 PRIVATE` as never,
    }),
  });
  const toolResult = finalToolResult(result);
  const content = JSON.stringify(toolResult);
  for (const token of ["PRIVATE_PATH", "SECRET_TOKEN", "SIGKILL", "4242", "raw-error", "tool-argument", "tool-result", "provider-body"]) {
    assert.ok(!content.includes(token), token);
  }
});

test("sanitized attempts carry the mapped unknown tool label and finite idle telemetry, and omit them when unavailable", () => {
  const withTool = failedResult({
    attempts: [{
      route: "zai/glm-5.3:max",
      state: "stalled",
      elapsedSeconds: 12.5,
      activeToolCount: 1,
      activeToolName: "unknown",
      activeToolElapsedSeconds: 3.2,
      activeToolIdleSeconds: 2.1,
      stallCause: "active_tool_idle",
    }],
    progress: progress({
      stallCause: "active_tool_idle",
      activeToolCount: 1,
      activeToolName: "unknown",
      activeToolIdleSeconds: 2.1,
    }),
  });
  const details = finalToolResult(withTool).details as Record<string, unknown>;
  assert.deepEqual(details.attempts, [{
    route: "zai/glm-5.3:max",
    state: "stalled",
    elapsedSeconds: 12.5,
    activeToolCount: 1,
    activeToolName: "unknown",
    activeToolElapsedSeconds: 3.2,
    activeToolIdleSeconds: 2.1,
    stallCause: "active_tool_idle",
  }]);
  const sanitizedProgress = details.progress as Record<string, unknown>;
  assert.equal(sanitizedProgress.activeToolName, "unknown");
  assert.equal(sanitizedProgress.activeToolIdleSeconds, 2.1);
  assert.match((finalToolResult(withTool).content[0] as { text: string }).text, /- active tool: unknown/);

  // A catalog attempt without tool telemetry keeps no fabricated fields.
  const withoutTool = failedResult({
    attempts: [{ route: "zai/glm-5.3:max", state: "catalog_unavailable", elapsedSeconds: 0.4 }],
  });
  const absent = (finalToolResult(withoutTool).details as Record<string, unknown>).attempts as Record<string, unknown>[];
  assert.equal("activeToolCount" in absent[0]!, false);
  assert.equal("activeToolIdleSeconds" in absent[0]!, false);
});

test("sanitized attempts retain finite supervised liveness evidence and drop non-finite internals", () => {
  const supervised = {
    rpcIdleSeconds: 301.2,
    activityIdleSeconds: 300.4,
    progressIdleSeconds: 299.8,
    activityEventCount: 88,
    structuralProgressCount: 9,
    duplicateCheckpointCount: 3,
    activityWarningCount: 1,
    progressWarningCount: 1,
    activeToolIdleSeconds: 12.3,
  };
  const finiteResult = failedResult({
    attempts: [{
      route: "zai/glm-5.3:max",
      state: "stalled",
      elapsedSeconds: 301.0,
      stallCause: "progress_stagnation",
      ...supervised,
    }],
  });
  const details = finalToolResult(finiteResult).details as Record<string, unknown>;
  assert.deepEqual(details.attempts, [{
    route: "zai/glm-5.3:max",
    state: "stalled",
    elapsedSeconds: 301.0,
    stallCause: "progress_stagnation",
    ...supervised,
  }]);
  // Malformed internal non-finite values fail closed: every supervised
  // field is omitted, never passed through or fabricated.
  for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const poisoned = failedResult({
      attempts: [{
        route: "zai/glm-5.3:max",
        state: "stalled",
        elapsedSeconds: 1,
        rpcIdleSeconds: poison,
        activityIdleSeconds: poison,
        progressIdleSeconds: poison,
        activityEventCount: poison,
        structuralProgressCount: poison,
        duplicateCheckpointCount: poison,
        activityWarningCount: poison,
        progressWarningCount: poison,
        activeToolIdleSeconds: poison,
      }],
    });
    const sanitized = (finalToolResult(poisoned).details as Record<string, unknown>).attempts as Record<string, unknown>[];
    for (const key of [
      "rpcIdleSeconds",
      "activityIdleSeconds",
      "progressIdleSeconds",
      "activityEventCount",
      "structuralProgressCount",
      "duplicateCheckpointCount",
      "activityWarningCount",
      "progressWarningCount",
      "activeToolIdleSeconds",
    ]) {
      assert.equal(key in sanitized[0]!, false, `${key} for ${poison}`);
    }
  }
});

test("invalid provider categories are omitted from ToolResult surfaces and valid ones survive", () => {
  for (const invalid of [
    "/home/gc/PRIVATE_PATH/provider",
    "sk-SECRET_TOKEN",
    "503 provider body PRIVATE",
    "credits_exhausted ",
    "unknown_category",
  ]) {
    const result = failedResult({ progress: progress({ providerFailureCategory: invalid as never }) });
    const toolResult = finalToolResult(result) as ToolResult;
    assert.equal(toolResult.details?.providerFailureCategory, undefined, invalid);
    const sanitized = toolResult.details?.progress as DelegateProgress;
    assert.equal(sanitized.providerFailureCategory, undefined, invalid);
    assert.doesNotMatch(JSON.stringify(toolResult), /PRIVATE|SECRET|503/);
  }
  for (const valid of PROVIDER_FAILURE_CATEGORIES) {
    const result = failedResult({ progress: progress({ providerFailureCategory: valid }) });
    const toolResult = finalToolResult(result) as ToolResult;
    assert.equal(toolResult.details?.providerFailureCategory, valid);
    assert.equal((toolResult.details?.progress as DelegateProgress).providerFailureCategory, valid);
  }
});

test("failure Markdown shows only the accepted reason enum with a fixed summary", () => {
  const text = failureMarkdown(blockedRun({ terminalReason: "budget_exhausted", reasonStatus: "accepted" }));
  assert.match(text, /- terminal reason: budget_exhausted/);
  assert.match(text, /The delegate ended with DELEGATE_RESULT: BLOCKED\.\nThe attempt budget was exhausted before a required result was available\./);
});

test("failure Markdown pins the finding_reported misuse to the COMPLETED contract", () => {
  const text = failureMarkdown(blockedRun({
    terminalReason: "finding_reported",
    reasonStatus: "accepted",
    blockedMisuseSuspected: true,
  }));
  assert.match(text, /- terminal reason: finding_reported/);
  assert.match(text, /A finding should have been returned with DELEGATE_RESULT: COMPLETED; reviews with findings must use COMPLETED, never BLOCKED\./);
});

test("failure Markdown uses fixed unspecified labels for missing and rejected reasons", () => {
  const missing = failureMarkdown(blockedRun({ terminalReason: "unspecified", reasonStatus: "missing" }));
  assert.match(missing, /- terminal reason: unspecified \(missing\)/);
  assert.match(missing, /No terminal reason code was provided; the outcome stands\./);

  const rejected = failureMarkdown(blockedRun({ terminalReason: "unspecified", reasonStatus: "rejected" }));
  assert.match(rejected, /- terminal reason: unspecified \(rejected\)/);
  assert.match(rejected, /The terminal reason line was invalid and was discarded; the outcome stands\./);
});

test("failure Markdown carries no reason line without a non-completed delegate outcome", () => {
  for (const state of ["stalled", "routes_unavailable", "interrupted"] as const) {
    const text = failureMarkdown(failedResult({ state }));
    assert.doesNotMatch(text, /terminal reason/);
  }
  // Even a stale accepted-looking reason on a completed run never renders.
  const completedText = failureMarkdown(failedResult({ state: "completed" }));
  assert.doesNotMatch(completedText, /terminal reason/);
});

test("final tool result details carry the typed reason and misuse flag for blocked runs", () => {
  const result = blockedRun({
    terminalReason: "finding_reported",
    reasonStatus: "accepted",
    blockedMisuseSuspected: true,
  });
  const toolResult = finalToolResult(result) as ToolResult;
  assert.equal(toolResult.details?.delegateOutcome, "blocked");
  assert.equal(toolResult.details?.terminalReason, "finding_reported");
  assert.equal(toolResult.details?.reasonStatus, "accepted");
  assert.equal(toolResult.details?.blockedMisuseSuspected, true);
  assert.equal((toolResult.details?.progress as DelegateProgress).terminalReason, "finding_reported");
  assert.match(toolResult.content[0]!.text, /- terminal reason: finding_reported/);
  assert.doesNotMatch(JSON.stringify(toolResult), /SECRET-REPORT-BODY/);
});

/** A blocked DelegateRunResult whose reason fields can be injected. */
function blockedRun(
  reason: Pick<DelegateRunResult, "terminalReason" | "reasonStatus"> & { blockedMisuseSuspected?: boolean },
): DelegateRunResult {
  return failedResult({
    state: "blocked",
    delegateOutcome: "blocked",
    ...reason,
    progress: progress({
      state: "blocked",
      lastEvent: "message_end",
      lastEventDetail: undefined,
      delegateOutcome: "blocked",
      terminalReason: reason.terminalReason,
      reasonStatus: reason.reasonStatus,
      blockedMisuseSuspected: reason.blockedMisuseSuspected,
    }),
  });
}

test("every non-completed state has a deterministic safe summary", () => {
  const states = [
    "catalog_check", "running", "routes_unavailable", "stalled", "timed_out", "output_limit",
    "blocked", "delegate_failed", "provider_failed", "prompt_rejected", "invalid_result", "invalid_stream", "missing_report",
    "child_failed", "spawn_failed", "cleanup_failed", "interrupted",
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
