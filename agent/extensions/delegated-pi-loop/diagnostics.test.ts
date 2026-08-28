import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  diagnosticPermissions,
  failureDiagnostic,
  SCHEMA_VERSION,
  schemaSevenRecord,
  SUCCESS_FILE_PREFIX,
  SUCCESS_RECORD_LIMIT,
  writeFailureDiagnostic,
  writeSuccessTelemetry,
  writeSuccessTelemetryQuietly,
} from "./diagnostics.ts";
import { PROVIDER_FAILURE_CATEGORIES } from "./types.ts";
import type { DelegateRunResult } from "./types.ts";

function failedResult(overrides: Partial<DelegateRunResult> = {}): DelegateRunResult {
  return {
    label: "implementation",
    role: "implementation",
    state: "invalid_stream",
    deadlineCause: "idle_deadline",
    stallCause: "progress_stagnation",
    cleanupFailureReason: "group_alive",
    interruptionSource: "tool_call_abort",
    report: "SECRET-REPORT-BODY",
    artifactDir: "/tmp/delegated-pi-implementation-x",
    selectedRoute: "zai/glm-5.3:max",
    attempts: [{
      route: "zai/glm-5.3:max",
      state: "invalid_stream",
      elapsedSeconds: 12.5,
      restartAfterWork: true,
      stallCause: "progress_stagnation",
      rpcIdleSeconds: 1.5,
      activityIdleSeconds: 2,
      progressIdleSeconds: 300.1,
      maxProgressIdleSeconds: 431.2,
      activityEventCount: 88,
      structuralProgressCount: 9,
      duplicateCheckpointCount: 3,
      activityWarningCount: 1,
      progressWarningCount: 1,
      activeToolCount: 1,
      activeToolName: "unknown",
      activeToolElapsedSeconds: 154.7,
      activeToolIdleSeconds: 12.3,
    }],
    startedAt: "2026-08-21T09:49:47.600Z",
    endedAt: "2026-08-21T10:00:00.000Z",
    elapsedSeconds: 612.4,
    streamErrors: ["rpc_partial_record"],
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
      activityIdleSeconds: 2,
      elapsedSeconds: 612.4,
      toolExecutionCount: 4,
      activityWarningCount: 1,
      progressWarningCount: 1,
      restartAfterWorkCount: 1,
      reportNudgeCount: 1,
      reportRecoveryReason: "invalid_result",
      reportRound: 2,
      rpcIdleSeconds: 1.5,
      progressIdleSeconds: 300.1,
      maxProgressIdleSeconds: 431.2,
      activityEventCount: 88,
      structuralProgressCount: 9,
      duplicateCheckpointCount: 3,
      activeToolCount: 1,
      activeToolName: "ctx_batch_execute",
      activeToolElapsedSeconds: 154.7,
      activeToolIdleSeconds: 12.3,
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

    assert.equal(parsed.schemaVersion, 7);
    assert.equal(parsed.state, "invalid_stream");
    assert.equal(parsed.role, "implementation");
    assert.equal(parsed.deadlineCause, "idle_deadline");
    assert.equal(parsed.stallCause, "progress_stagnation");
    assert.equal(parsed.cleanupFailureReason, "group_alive");
    assert.equal(parsed.interruptionSource, "tool_call_abort");
    assert.equal(parsed.rpcIdleSeconds, 1.5);
    assert.equal(parsed.activityIdleSeconds, 2);
    assert.equal(parsed.progressIdleSeconds, 300.1);
    assert.equal(parsed.maxProgressIdleSeconds, 431.2);
    assert.equal(parsed.activityEventCount, 88);
    assert.equal(parsed.structuralProgressCount, 9);
    assert.equal(parsed.duplicateCheckpointCount, 3);
    assert.equal(parsed.activityWarningCount, 1);
    assert.equal(parsed.progressWarningCount, 1);
    assert.equal(parsed.activeToolCount, 1);
    assert.equal(parsed.activeToolName, "ctx_batch_execute");
    assert.equal(parsed.activeToolElapsedSeconds, 154.7);
    assert.equal(parsed.activeToolIdleSeconds, 12.3);
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
      {
        route: "zai/glm-5.3:max",
        state: "invalid_stream",
        elapsedSeconds: 12.5,
        restartAfterWork: true,
        stallCause: "progress_stagnation",
        rpcIdleSeconds: 1.5,
        activityIdleSeconds: 2,
        progressIdleSeconds: 300.1,
        maxProgressIdleSeconds: 431.2,
        activityEventCount: 88,
        structuralProgressCount: 9,
        duplicateCheckpointCount: 3,
        activityWarningCount: 1,
        progressWarningCount: 1,
        activeToolCount: 1,
        activeToolName: "unknown",
        activeToolElapsedSeconds: 154.7,
        activeToolIdleSeconds: 12.3,
      },
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

test("schema 7 records typed terminal reason fields for non-completed outcomes without raw reason text", async () => {
  await withDiagnosticsRoot(async () => {
    const accepted = await writeFailureDiagnostic(blockedResult({
      report: "SECRET-REPORT-BODY\n\nDELEGATE_REASON: finding_reported\nDELEGATE_RESULT: BLOCKED",
      progress: blockedProgress({ delegateOutcome: "blocked", terminalReason: "finding_reported", reasonStatus: "accepted", blockedMisuseSuspected: true }),
    }));
    const acceptedContent = await readFile(accepted, "utf8");
    const acceptedParsed = JSON.parse(acceptedContent) as Record<string, unknown>;
    assert.equal(acceptedParsed.schemaVersion, 7);
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
    // Catalog attempts carry no supervised liveness telemetry: every
    // supervised field stays absent when unavailable, never fabricated.
    for (const attempt of parsed.attempts as Record<string, unknown>[]) {
      for (const key of [
        "stallCause",
        "rpcIdleSeconds",
        "activityIdleSeconds",
        "progressIdleSeconds",
        "maxProgressIdleSeconds",
        "activityEventCount",
        "structuralProgressCount",
        "duplicateCheckpointCount",
        "activityWarningCount",
        "progressWarningCount",
        "activeToolCount",
        "activeToolName",
        "activeToolElapsedSeconds",
        "activeToolIdleSeconds",
      ]) {
        assert.equal(key in attempt, false, key);
      }
    }
    const streamErrors = parsed.streamErrors as string[];
    assert.equal(streamErrors.length, 20);
    assert.ok(streamErrors.every((error) => error.length <= 200));
  });
});

test("schema 7 rejects seeded paths, credentials, payloads, signals, pids, digests, and raw errors", () => {
  const forbidden = "/home/gc/PRIVATE_PATH sk-SECRET_TOKEN SIGKILL pid=4242 provider-body tool-argument tool-result raw-error 4f2a9c1b8e7d";
  const result = failedResult({
    label: forbidden,
    selectedRoute: forbidden,
    startedAt: forbidden,
    endedAt: forbidden,
    deadlineCause: forbidden as never,
    stallCause: forbidden as never,
    cleanupFailureReason: forbidden as never,
    interruptionSource: forbidden as never,
    streamErrors: [forbidden, ...Array.from({ length: 30 }, () => "rpc_partial_record")],
    attempts: [{
      route: forbidden,
      state: "invalid_stream",
      elapsedSeconds: 1,
      activeToolName: forbidden,
      deadlineCause: forbidden as never,
      stallCause: forbidden as never,
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
      stallCause: forbidden as never,
      leaseWarning: forbidden as never,
      providerFailureCategory: forbidden as never,
    },
  });
  const content = JSON.stringify(failureDiagnostic(result));
  for (const token of ["PRIVATE_PATH", "SECRET_TOKEN", "SIGKILL", "4242", "provider-body", "tool-argument", "tool-result", "raw-error"]) {
    assert.ok(!content.includes(token), token);
  }
  assert.ok(Buffer.byteLength(content) < 16 * 1024, `diagnostic must stay bounded: ${Buffer.byteLength(content)}`);
});

test("schema 7 attempt records drop malformed non-finite supervised values", () => {
  const result = failedResult({
    attempts: [{
      route: "zai/glm-5.3:max",
      state: "stalled",
      elapsedSeconds: 1,
      rpcIdleSeconds: Number.NaN,
      activityIdleSeconds: Number.POSITIVE_INFINITY,
      progressIdleSeconds: Number.NEGATIVE_INFINITY,
      maxProgressIdleSeconds: Number.NaN,
      activityEventCount: Number.NaN,
      structuralProgressCount: Number.POSITIVE_INFINITY,
      duplicateCheckpointCount: Number.NaN,
      activityWarningCount: Number.POSITIVE_INFINITY,
      progressWarningCount: Number.NaN,
      activeToolIdleSeconds: Number.NaN,
    }],
  });
  const record = (failureDiagnostic(result).attempts as Record<string, unknown>[])[0]!;
  for (const key of [
    "rpcIdleSeconds",
    "activityIdleSeconds",
    "progressIdleSeconds",
    "maxProgressIdleSeconds",
    "activityEventCount",
    "structuralProgressCount",
    "duplicateCheckpointCount",
    "activityWarningCount",
    "progressWarningCount",
    "activeToolIdleSeconds",
  ]) {
    assert.equal(record[key], undefined, `${key} must fail closed to omitted`);
  }
  // The omitted keys also never survive serialization.
  const serialized = JSON.stringify(record);
  for (const key of ["rpcIdle", "activityIdle", "progressIdle", "Warning", "IdleSeconds", "EventCount", "ProgressCount", "CheckpointCount"]) {
    assert.ok(!serialized.includes(key), key);
  }
});

test("schema 7 omits invalid provider categories and keeps every valid category", async () => {
  await withDiagnosticsRoot(async () => {
    for (const invalid of [
      "/home/gc/PRIVATE_PATH/provider",
      "sk-SECRET_TOKEN",
      "503 provider body PRIVATE",
      "credits_exhausted ",
      "Credits_Exhausted",
      "unknown_category",
      "",
    ]) {
      const result = failedResult({
        progress: { ...failedResult().progress, providerFailureCategory: invalid as never },
      });
      const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(result), "utf8")) as Record<string, unknown>;
      assert.equal(parsed.providerFailureCategory, undefined, invalid);
      assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE|SECRET|503/);
    }
    for (const valid of PROVIDER_FAILURE_CATEGORIES) {
      const result = failedResult({
        progress: { ...failedResult().progress, providerFailureCategory: valid },
      });
      const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(result), "utf8")) as Record<string, unknown>;
      assert.equal(parsed.providerFailureCategory, valid);
    }
  });
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

/** A completed DelegateRunResult fixture for successful-run telemetry. */
function completedResult(overrides: Partial<DelegateRunResult> = {}): DelegateRunResult {
  return failedResult({
    state: "completed",
    report: "SECRET-REPORT-BODY\n\nDELEGATE_RESULT: COMPLETED",
    deadlineCause: undefined,
    stallCause: undefined,
    cleanupFailureReason: undefined,
    interruptionSource: undefined,
    attempts: [{
      route: "zai/glm-5.3:max",
      state: "completed",
      elapsedSeconds: 612.4,
      progressIdleSeconds: 0.2,
      maxProgressIdleSeconds: 300.4,
      activityEventCount: 88,
      structuralProgressCount: 9,
      duplicateCheckpointCount: 3,
      activityWarningCount: 0,
      progressWarningCount: 0,
    }],
    progress: {
      ...failedResult().progress,
      state: "completed",
      phase: "complete",
      lastEvent: "agent_settled",
      deadlineCause: undefined,
      stallCause: undefined,
      cleanupFailureReason: undefined,
      interruptionSource: undefined,
      restartAfterWorkCount: 0,
      reportNudgeCount: 0,
      reportRecoveryReason: undefined,
      reportRound: 1,
      maxProgressIdleSeconds: 300.4,
    },
    ...overrides,
  });
}

/** Writes one exact success-telemetry-named file with an explicit mtime. */
async function seedSuccessFile(directory: string, name: string, writtenAt: Date): Promise<void> {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const filePath = path.join(directory, name);
  await writeFile(filePath, "{}\n", { mode: 0o600 });
  await utimes(filePath, writtenAt, writtenAt);
}

/** Serialized form of one record: the exact shape persisted to disk. */
function serializedRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

/** Regular-file success records only: a no-follow check matches pruning. */
async function successEntries(directory: string): Promise<string[]> {
  const names = (await readdir(directory).catch(() => [] as string[]))
    .filter((name) => name.startsWith(SUCCESS_FILE_PREFIX) && name.endsWith(".json"));
  const regular: string[] = [];
  for (const name of names) {
    const info = await lstat(path.join(directory, name));
    if (info.isFile()) regular.push(name);
  }
  return regular;
}

test("schema version is exactly 7 and the new maximum field has the bounded shape", async () => {
  await withDiagnosticsRoot(async () => {
    assert.equal(SCHEMA_VERSION, 7);
    assert.equal(SUCCESS_RECORD_LIMIT, 4096);
    const record = failureDiagnostic(failedResult());
    assert.equal(record.schemaVersion, 7);
    assert.equal(record.maxProgressIdleSeconds, 431.2);
    assert.equal((record.attempts as Record<string, unknown>[])[0]!.maxProgressIdleSeconds, 431.2);
  });
});

test("completed and unsuccessful records share the same safe schema-7 shape", async () => {
  await withDiagnosticsRoot(async () => {
    const completedPath = await writeSuccessTelemetry(completedResult());
    const completed = JSON.parse(await readFile(completedPath, "utf8")) as Record<string, unknown>;
    // Same builder, same optionals-absent comparison shape: the unsuccessful
    // twin clears exactly the optional fields the completed fixture clears.
    const unsuccessful = serializedRecord(schemaSevenRecord(failedResult({
      deadlineCause: undefined,
      stallCause: undefined,
      cleanupFailureReason: undefined,
      interruptionSource: undefined,
      progress: { ...failedResult().progress, reportRecoveryReason: undefined },
    })));
    assert.deepEqual(Object.keys(completed).sort(), Object.keys(unsuccessful).sort());
    assert.equal(completed.schemaVersion, 7);
    assert.equal(completed.state, "completed");
    assert.equal(completed.maxProgressIdleSeconds, 300.4);
    assert.equal((completed.attempts as Record<string, unknown>[])[0]!.maxProgressIdleSeconds, 300.4);
  });
});

test("success records contain no report, prompt, path, or provider text", async () => {
  await withDiagnosticsRoot(async (root) => {
    // A label outside the bounded identifier alphabet is omitted entirely;
    // the bounded record itself never carries report or prompt material.
    const result = completedResult({ label: "SECRET LABEL /PRIVATE report" });
    const completedPath = await writeSuccessTelemetry(result);
    const content = await readFile(completedPath, "utf8");
    assert.ok(path.basename(completedPath).startsWith(SUCCESS_FILE_PREFIX));
    assert.ok(completedPath.startsWith(path.join(root, "logs", "delegated-pi-loop")));
    for (const forbidden of [
      "SECRET",
      "PRIVATE",
      "DELEGATE_RESULT",
      "report",
      "args",
      "credentials",
      "/tmp/",
      "provider-body",
    ]) {
      assert.ok(!content.includes(forbidden), forbidden);
    }
  });
});

test("top-level and attempt maxima survive when valid, including zero", () => {
  const record = schemaSevenRecord(completedResult({
    progress: { ...completedResult().progress, maxProgressIdleSeconds: 0 },
    attempts: [{ route: "zai/glm-5.3:max", state: "completed", elapsedSeconds: 1, maxProgressIdleSeconds: 0 }],
  }));
  assert.equal(record.maxProgressIdleSeconds, 0);
  assert.equal((record.attempts as Record<string, unknown>[])[0]!.maxProgressIdleSeconds, 0);
});

test("invalid top-level and attempt maximum values fail closed by omission", () => {
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const record = serializedRecord(schemaSevenRecord(completedResult({
      progress: { ...completedResult().progress, maxProgressIdleSeconds: invalid },
      attempts: [{ route: "zai/glm-5.3:max", state: "completed", elapsedSeconds: 1, maxProgressIdleSeconds: invalid }],
    })));
    assert.equal(record.maxProgressIdleSeconds, undefined, String(invalid));
    assert.ok(!JSON.stringify(record).includes("maxProgressIdleSeconds"), String(invalid));
  }
});

test("catalog-only attempts omit the maximum in schema-7 records", () => {
  const record = serializedRecord(schemaSevenRecord(completedResult({
    attempts: [{ route: "zai/glm-5.3:max", state: "catalog_unavailable", elapsedSeconds: 0.4 }],
  })));
  const attempt = (record.attempts as Record<string, unknown>[])[0]!;
  assert.equal("maxProgressIdleSeconds" in attempt, false);
});

test("historical schema 3-6 files are never rewritten or pruned", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const historicalAt = new Date(Date.now() - 3_600_000);
    const names = [
      "failure-implementation-1000-1-1.json",
      "failure-implementation-1000-2-2.json",
      "diagnostic-2025-06-01.json",
      "unknown-file.json",
      "success-v6-implementation-1000-3-3.json",
      "success-v7x-implementation-1000-4-4.json",
    ];
    for (let index = 0; index < names.length; index += 1) {
      await seedSuccessFile(directory, names[index]!, new Date(historicalAt.getTime() + index * 1000));
    }
    const before = await Promise.all(names.map(async (name) => {
      const filePath = path.join(directory, name);
      return { name, content: await readFile(filePath, "utf8"), mtime: (await stat(filePath)).mtimeMs };
    }));
    await writeSuccessTelemetry(completedResult(), 2);
    await writeFailureDiagnostic(failedResult());
    for (const entry of before) {
      const filePath = path.join(directory, entry.name);
      assert.equal(await readFile(filePath, "utf8"), entry.content, entry.name);
      assert.equal((await stat(filePath)).mtimeMs, entry.mtime, entry.name);
    }
  });
});

test("success telemetry uses 0700 directories and 0600 atomic files", async () => {
  await withDiagnosticsRoot(async () => {
    const completedPath = await writeSuccessTelemetry(completedResult());
    const permissions = await diagnosticPermissions(completedPath);
    assert.equal(permissions.directory, 0o700);
    assert.equal(permissions.file, 0o600);
  });
});

test("success telemetry is refused for unsuccessful runs and quietly isolated on write failure", async () => {
  await withDiagnosticsRoot(async () => {
    await assert.rejects(
      () => writeSuccessTelemetry(failedResult()),
      /only for completed runs/,
    );
  });
  // A telemetry write failure is swallowed and never changes the outcome.
  const blocker = await mkdtemp(path.join(os.tmpdir(), "delegate-success-block-"));
  const notADirectory = path.join(blocker, "not-a-directory");
  await writeFile(notADirectory, "x");
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = notADirectory;
  try {
    await writeSuccessTelemetryQuietly(completedResult());
    await writeSuccessTelemetryQuietly(failedResult());
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(blocker, { recursive: true, force: true });
  }
});

test("retention keeps the newest records and prunes only exact success-v7 files", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    const seeded = [
      "success-v7-implementation-1000-1-1.json",
      "success-v7-implementation-1000-1-2.json",
      "success-v7-implementation-1000-1-3.json",
    ];
    for (let index = 0; index < seeded.length; index += 1) {
      await seedSuccessFile(directory, seeded[index]!, new Date(base + index * 1000));
    }
    // Pruning candidates with success-looking names that must never be
    // deleted: a symlink, a directory, a failure, and an unknown name.
    await symlink(path.join(directory, seeded[0]!), path.join(directory, "success-v7-symlink.json"));
    await mkdir(path.join(directory, "success-v7-directory.json"));
    await writeFile(path.join(directory, "failure-implementation-1000-9-9.json"), "{}\n", { mode: 0o600 });
    await writeFile(path.join(directory, "other.json"), "{}\n", { mode: 0o600 });
    // Retention limit 2: the oldest seeded success file is pruned, the two
    // newer seeded files stay, and the newly written record also stays only
    // if it is among the newest two after the sweep.
    await writeSuccessTelemetry(completedResult(), 2);
    const remaining = await successEntries(directory);
    assert.ok(remaining.length <= 2, `at most the limit survives, got ${remaining.join(",")}`);
    assert.ok(!remaining.includes(seeded[0]!), "the oldest success record must be pruned");
    // Non-record entries survive untouched (no-follow checks: the symlink
    // itself must survive even though its pruned target is gone).
    assert.ok((await lstat(path.join(directory, "success-v7-symlink.json"))).isSymbolicLink());
    assert.ok((await lstat(path.join(directory, "success-v7-directory.json"))).isDirectory());
    await stat(path.join(directory, "failure-implementation-1000-9-9.json"));
    await stat(path.join(directory, "other.json"));
  });
});

test("retention order is deterministic by write time with a filename tie-breaker", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    // Identical write times: the filename tie-breaker decides deterministically.
    const sameTime = new Date(base);
    const names = [
      "success-v7-implementation-1000-1-a.json",
      "success-v7-implementation-1000-1-b.json",
      "success-v7-implementation-1000-1-c.json",
    ];
    for (const name of names) await seedSuccessFile(directory, name, sameTime);
    const written = await writeSuccessTelemetry(completedResult(), 2);
    const remaining = await successEntries(directory);
    // Four candidates, limit two: the filename tie-breaker deletes the two
    // lexicographically smallest seeded names; the newest seeded name and
    // the freshly written record (newest mtime) survive.
    assert.equal(remaining.length, 2);
    assert.ok(remaining.includes("success-v7-implementation-1000-1-c.json"));
    assert.ok(!remaining.includes("success-v7-implementation-1000-1-a.json"));
    assert.ok(!remaining.includes("success-v7-implementation-1000-1-b.json"));
    assert.ok(remaining.includes(path.basename(written)));
  });
});

test("concurrent same-process writers settle without excess retained success records", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const writers = Array.from({ length: 8 }, () => writeSuccessTelemetry(completedResult(), 3));
    const paths = await Promise.all(writers);
    assert.equal(new Set(paths).size, 8);
    const remaining = await successEntries(directory);
    assert.equal(remaining.length, 3, `serialized write-plus-prune must cap at the limit, got ${remaining.join(",")}`);
  });
});

test("files disappearing mid-prune never fail the delegate result", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    const seeded: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const name = `success-v7-implementation-1000-1-${String(index).padStart(4, "0")}.json`;
      seeded.push(name);
      await seedSuccessFile(directory, name, new Date(base + index * 1000));
    }
    // Cross-process-style disappearance: a parallel task removes seeded files
    // while the write-plus-prune sweep runs; ENOENT is tolerated either way.
    const disappearing = (async () => {
      for (const name of seeded) {
        await rm(path.join(directory, name), { force: true });
      }
    })();
    const written = await writeSuccessTelemetry(completedResult(), 5);
    await disappearing;
    assert.ok(path.basename(written).startsWith(SUCCESS_FILE_PREFIX));
    const remaining = await successEntries(directory);
    assert.ok(remaining.length <= 5, `the limit still holds after disappearances, got ${remaining.join(",")}`);
  });
});
