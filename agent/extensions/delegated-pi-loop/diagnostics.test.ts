import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnosticPermissions, failureDiagnostic, writeFailureDiagnostic } from "./diagnostics.ts";
import type { DelegateRunResult } from "./types.ts";

function failedResult(overrides: Partial<DelegateRunResult> = {}): DelegateRunResult {
  return {
    label: "implementation",
    role: "implementation",
    state: "invalid_stream",
    deadlineCause: "idle_deadline",
    cleanupFailureReason: "group_alive",
    interruptionSource: "tool_call_abort",
    report: "SECRET-REPORT-BODY",
    artifactDir: "/tmp/delegated-pi-implementation-x",
    selectedRoute: "zai/glm-5.3:max",
    attempts: [{ route: "zai/glm-5.3:max", state: "invalid_stream", elapsedSeconds: 12.5, restartAfterWork: true }],
    startedAt: "2026-08-21T09:49:47.600Z",
    endedAt: "2026-08-21T10:00:00.000Z",
    elapsedSeconds: 612.4,
    streamErrors: ["rpc_partial_record"],
    workBudgetSeconds: 2700,
    progress: {
      label: "implementation",
      role: "implementation",
      state: "invalid_stream",
      protocol: "pi-rpc",
      route: "zai/glm-5.3:max",
      attempt: 1,
      phase: "tool",
      lastEvent: "tool_execution_end",
      lastEventDetail: "edit",
      lastEventAt: "2026-08-21T09:59:58.000Z",
      idleSeconds: 2,
      elapsedSeconds: 612.4,
      toolExecutionCount: 4,
      idleWarningCount: 1,
      restartAfterWorkCount: 1,
      reportNudgeCount: 1,
      reportRecoveryReason: "invalid_result",
      reportRound: 2,
      workBudgetSeconds: 2700,
      remainingWorkSecondsAtAttemptStart: 2700,
      activeToolCount: 1,
      activeToolName: "ctx_batch_execute",
      activeToolElapsedSeconds: 154.7,
    },
    ...overrides,
  };
}

async function withDiagnosticsRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-diagnostic-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    return await run(root);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
}

test("writes failure diagnostics with 0700 directories and 0600 atomic files", async () => {
  await withDiagnosticsRoot(async (root) => {
    const result = failedResult();
    const first = await writeFailureDiagnostic(result);
    const second = await writeFailureDiagnostic(result);
    const directory = path.join(root, "logs", "delegated-pi-loop");
    assert.ok(first.startsWith(`${directory}${path.sep}`));
    assert.notEqual(first, second);
    const permissions = await diagnosticPermissions(first);
    assert.equal(permissions.directory, 0o700);
    assert.equal(permissions.file, 0o600);
    assert.equal((await stat(path.dirname(second))).mode & 0o777, 0o700);
    assert.equal((await stat(second)).mode & 0o777, 0o600);
  });
});

test("diagnostic content is bounded, sanitized, and free of excluded material", async () => {
  await withDiagnosticsRoot(async () => {
    const filePath = await writeFailureDiagnostic(failedResult());
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    assert.equal(parsed.schemaVersion, 5);
    assert.equal(parsed.state, "invalid_stream");
    assert.equal(parsed.role, "implementation");
    assert.equal(parsed.deadlineCause, "idle_deadline");
    assert.equal(parsed.workBudgetSeconds, 2700);
    assert.equal(parsed.cleanupFailureReason, "group_alive");
    assert.equal(parsed.interruptionSource, "tool_call_abort");
    assert.equal(parsed.activeToolCount, 1);
    assert.equal(parsed.activeToolName, "ctx_batch_execute");
    assert.equal(parsed.activeToolElapsedSeconds, 154.7);
    // A run without a delegate terminal outcome carries no reason fields.
    assert.equal("delegateOutcome" in parsed, false);
    assert.equal("terminalReason" in parsed, false);
    assert.equal("reasonStatus" in parsed, false);
    assert.equal("blockedMisuseSuspected" in parsed, false);
    assert.equal(parsed.selectedRoute, "zai/glm-5.3:max");
    assert.equal(parsed.lastEvent, "tool_execution_end");
    assert.equal(parsed.lastEventDetail, "edit");
    assert.equal(parsed.lastEventAt, "2026-08-21T09:59:58.000Z");
    assert.equal(parsed.toolExecutionCount, 4);
    assert.equal(parsed.restartAfterWorkCount, 1);
    assert.deepEqual(parsed.attempts, [
      { route: "zai/glm-5.3:max", state: "invalid_stream", elapsedSeconds: 12.5, restartAfterWork: true },
    ]);
    assert.equal(parsed.recoveryAttempted, true);
    assert.equal(parsed.reportRecoveryReason, "invalid_result");
    assert.equal(parsed.finalRound, 2);
    assert.deepEqual(parsed.streamErrors, ["rpc_partial_record"]);

    // The removed tree-fingerprint fields stay excluded if ever reintroduced.
    for (const forbidden of [
      "report", "reportPath", "statusPath", "artifactDir", "prompt", "stdout", "stderr",
      "fingerprintBefore", "fingerprintAfter", "args", "credentials",
    ]) {
      assert.equal(forbidden in parsed, false, `diagnostic must not contain key ${forbidden}`);
    }
    assert.doesNotMatch(content, /SECRET-REPORT-BODY/);
    assert.doesNotMatch(content, /\/tmp\/|delegated-pi-implementation-x/);
  });
});

test("schema 5 records typed terminal reason fields for non-completed outcomes without raw reason text", async () => {
  await withDiagnosticsRoot(async () => {
    const accepted = await writeFailureDiagnostic(blockedResult({
      report: "SECRET-REPORT-BODY\n\nDELEGATE_REASON: finding_reported\nDELEGATE_RESULT: BLOCKED",
      progress: blockedProgress({ delegateOutcome: "blocked", terminalReason: "finding_reported", reasonStatus: "accepted", blockedMisuseSuspected: true }),
    }));
    const acceptedContent = await readFile(accepted, "utf8");
    const acceptedParsed = JSON.parse(acceptedContent) as Record<string, unknown>;
    assert.equal(acceptedParsed.schemaVersion, 5);
    assert.equal(acceptedParsed.delegateOutcome, "blocked");
    assert.equal(acceptedParsed.terminalReason, "finding_reported");
    assert.equal(acceptedParsed.reasonStatus, "accepted");
    assert.equal(acceptedParsed.blockedMisuseSuspected, true);
    assert.doesNotMatch(acceptedContent, /SECRET-REPORT-BODY|DELEGATE_REASON|DELEGATE_RESULT/);

    const rejected = await writeFailureDiagnostic(failedResult({
      state: "delegate_failed",
      progress: blockedProgress({ state: "delegate_failed", delegateOutcome: "failed", terminalReason: "unspecified", reasonStatus: "rejected" }),
    }));
    const rejectedContent = await readFile(rejected, "utf8");
    const rejectedParsed = JSON.parse(rejectedContent) as Record<string, unknown>;
    assert.equal(rejectedParsed.terminalReason, "unspecified");
    assert.equal(rejectedParsed.reasonStatus, "rejected");
    assert.equal(rejectedParsed.blockedMisuseSuspected, undefined);
    assert.doesNotMatch(rejectedContent, /DELEGATE_REASON|DELEGATE_RESULT/);
  });
});

/** A blocked DelegateRunResult fixture whose progress can carry typed reason fields. */
function blockedResult(overrides: Partial<DelegateRunResult> = {}): DelegateRunResult {
  return failedResult({
    state: "blocked",
    selectedRoute: "zai/glm-5.3:max",
    attempts: [{ route: "zai/glm-5.3:max", state: "blocked", elapsedSeconds: 12.5 }],
    ...overrides,
  });
}

function blockedProgress(overrides: Partial<DelegateRunResult["progress"]> = {}): DelegateRunResult["progress"] {
  return {
    ...failedResult().progress,
    state: "blocked",
    lastEvent: "message_end",
    lastEventDetail: undefined,
    ...overrides,
  };
}

test("bounds attempts and stream errors in the diagnostic", async () => {
  await withDiagnosticsRoot(async () => {
    const result = failedResult({
      attempts: Array.from({ length: 25 }, (_, index) => ({
        route: `provider/model-${index}:max`,
        state: "catalog_unavailable" as const,
        elapsedSeconds: index,
      })),
      streamErrors: Array.from({ length: 30 }, (_, index) => `error-${index}-${"x".repeat(400)}`),
    });
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(result), "utf8")) as Record<string, unknown>;
    assert.equal((parsed.attempts as unknown[]).length, 10);
    const streamErrors = parsed.streamErrors as string[];
    assert.equal(streamErrors.length, 20);
    assert.ok(streamErrors.every((error) => error.length <= 200));
  });
});

test("schema 5 rejects seeded paths, credentials, payloads, signals, pids, and raw errors", () => {
  const forbidden = "/home/gc/PRIVATE_PATH sk-SECRET_TOKEN SIGKILL pid=4242 provider-body tool-argument tool-result raw-error";
  const result = failedResult({
    label: forbidden,
    selectedRoute: forbidden,
    startedAt: forbidden,
    endedAt: forbidden,
    deadlineCause: forbidden as never,
    cleanupFailureReason: forbidden as never,
    interruptionSource: forbidden as never,
    streamErrors: [forbidden, ...Array.from({ length: 30 }, () => "rpc_partial_record")],
    attempts: [{
      route: forbidden,
      state: "invalid_stream",
      elapsedSeconds: 1,
      activeToolName: forbidden,
      deadlineCause: forbidden as never,
      cleanupFailureReason: forbidden as never,
      interruptionSource: forbidden as never,
    }],
    progress: {
      ...failedResult().progress,
      phase: forbidden,
      lastEvent: forbidden,
      lastEventDetail: forbidden,
      lastEventAt: forbidden,
      activeToolName: forbidden,
    },
  });
  const content = JSON.stringify(failureDiagnostic(result));
  for (const token of ["PRIVATE_PATH", "SECRET_TOKEN", "SIGKILL", "4242", "provider-body", "tool-argument", "tool-result", "raw-error"]) {
    assert.ok(!content.includes(token), token);
  }
  assert.ok(Buffer.byteLength(content) < 16 * 1024, `diagnostic must stay bounded: ${Buffer.byteLength(content)}`);
});

test("refuses diagnostics for successful runs and leaves the logs directory empty", async () => {
  await withDiagnosticsRoot(async (root) => {
    await assert.rejects(
      () => writeFailureDiagnostic(failedResult({ state: "completed" })),
      /only for unsuccessful runs/,
    );
    const directory = path.join(root, "logs", "delegated-pi-loop");
    // The directory may exist from other assertions in this process; nothing
    // may be written for a completed run.
    const entries = await readdir(directory).catch(() => [] as string[]);
    assert.equal(entries.length, 0);
  });
});
