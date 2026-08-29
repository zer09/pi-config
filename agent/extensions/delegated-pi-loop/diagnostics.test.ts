import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  diagnosticPermissions,
  failureDiagnostic,
  isSuccessTelemetryName,
  retentionProbes,
  SCHEMA_VERSION,
  schemaEightRecord,
  SUCCESS_FILE_PREFIX,
  SUCCESS_RECORD_LIMIT,
  writeFailureDiagnostic,
  writeSuccessTelemetry,
  writeSuccessTelemetryQuietly,
} from "./diagnostics.ts";
import { DELEGATE_TOOL_OUTPUT_LIMIT } from "./artifacts.ts";
import { parseDelegateTerminal } from "./monitor.ts";
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

test("diagnostic content is bounded and sanitized except the exact bounded delegate report", async () => {
  await withDiagnosticsRoot(async () => {
    const filePath = await writeFailureDiagnostic(failedResult());
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;

    assert.equal(parsed.schemaVersion, 8);
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

    // The exact final report persists only in the failure-only delegateReport
    // field, with exact byte metadata and no truncation for a short report.
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    assert.equal(delegateReport.text, "SECRET-REPORT-BODY");
    assert.equal(delegateReport.totalBytes, Buffer.byteLength("SECRET-REPORT-BODY", "utf8"));
    assert.equal(delegateReport.truncatedBytes, 0);

    // The removed tree-fingerprint fields stay excluded if ever reintroduced.
    for (const forbidden of [
      "report", "reportPath", "statusPath", "artifactDir", "prompt", "stdout", "stderr",
      "fingerprintBefore", "fingerprintAfter", "args", "credentials",
    ]) {
      assert.equal(forbidden in parsed, false, `diagnostic must not contain key ${forbidden}`);
    }
    // Report text never appears outside the delegateReport field.
    const withoutReport = { ...parsed, delegateReport: undefined };
    assert.doesNotMatch(JSON.stringify(withoutReport), /SECRET-REPORT-BODY/);
    assert.doesNotMatch(content, /\/tmp\/|delegated-pi-implementation-x/);
  });
});

test("schema 8 records typed terminal reason fields for non-completed outcomes without raw reason text", async () => {
  await withDiagnosticsRoot(async () => {
    const report = "SECRET-REPORT-BODY\n\nDELEGATE_REASON: finding_reported\nDELEGATE_RESULT: BLOCKED";
    const accepted = await writeFailureDiagnostic(blockedResult({
      report,
      progress: blockedProgress({ delegateOutcome: "blocked", terminalReason: "finding_reported", reasonStatus: "accepted", blockedMisuseSuspected: true }),
    }));
    const acceptedContent = await readFile(accepted, "utf8");
    const acceptedParsed = JSON.parse(acceptedContent) as Record<string, unknown>;
    assert.equal(acceptedParsed.schemaVersion, 8);
    assert.equal(acceptedParsed.delegateOutcome, "blocked");
    assert.equal(acceptedParsed.terminalReason, "finding_reported");
    assert.equal(acceptedParsed.reasonStatus, "accepted");
    assert.equal(acceptedParsed.blockedMisuseSuspected, true);
    // The exact report persists verbatim, terminal markers included, while
    // the typed reason fields stay enum-only outside it.
    assert.equal((acceptedParsed.delegateReport as { text: string }).text, report);
    const acceptedWithoutReport = JSON.stringify({ ...acceptedParsed, delegateReport: undefined });
    assert.doesNotMatch(acceptedWithoutReport, /SECRET-REPORT-BODY|DELEGATE_REASON|DELEGATE_RESULT/);

    const rejected = await writeFailureDiagnostic(failedResult({
      state: "delegate_failed",
      progress: blockedProgress({ state: "delegate_failed", delegateOutcome: "failed", terminalReason: "unspecified", reasonStatus: "rejected" }),
    }));
    const rejectedContent = await readFile(rejected, "utf8");
    const rejectedParsed = JSON.parse(rejectedContent) as Record<string, unknown>;
    assert.equal(rejectedParsed.terminalReason, "unspecified");
    assert.equal(rejectedParsed.reasonStatus, "rejected");
    assert.equal(rejectedParsed.blockedMisuseSuspected, undefined);
    assert.equal((rejectedParsed.delegateReport as { text: string }).text, "SECRET-REPORT-BODY");
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

test("failure diagnostics persist the exact delegate report with its terminal markers", async () => {
  await withDiagnosticsRoot(async () => {
    const report = "Diagnostic body line.\n\nDELEGATE_REASON: external_dependency\nDELEGATE_RESULT: BLOCKED";
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(blockedResult({ report })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    // Exact preservation: the report survives byte-identical, terminal lines included.
    assert.equal(delegateReport.text, report);
    assert.ok(delegateReport.text.endsWith("DELEGATE_REASON: external_dependency\nDELEGATE_RESULT: BLOCKED"));
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    assert.equal(delegateReport.truncatedBytes, 0);
  });
});

test("an empty delegate report omits the delegateReport field entirely", async () => {
  await withDiagnosticsRoot(async () => {
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(failedResult({ report: "" })), "utf8")) as Record<string, unknown>;
    assert.equal("delegateReport" in parsed, false);
    assert.doesNotMatch(JSON.stringify(parsed), /delegateReport/);
  });
});

test("delegate report truncation is UTF-8-safe at the 50 KiB bound with exact byte metadata", async () => {
  await withDiagnosticsRoot(async () => {
    // Three-byte code points straddle the 51,200-byte bound two bytes into a
    // character, so the cut must back off to the last whole character.
    const head = "x".repeat(51_198);
    const report = `${head}${"\u{20ac}".repeat(150)}TAIL-MARKER`;
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(failedResult({ report })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    const textBytes = Buffer.byteLength(delegateReport.text, "utf8");
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    assert.ok(delegateReport.totalBytes > DELEGATE_TOOL_OUTPUT_LIMIT);
    assert.ok(textBytes <= DELEGATE_TOOL_OUTPUT_LIMIT);
    // The cut backed off to the whole-character boundary before the run.
    assert.equal(delegateReport.text, head);
    assert.equal(textBytes, 51_198);
    assert.ok(delegateReport.truncatedBytes > 0);
    assert.equal(delegateReport.truncatedBytes, delegateReport.totalBytes - textBytes);
    // The survivor never carries the dropped tail and stays valid UTF-8.
    assert.doesNotMatch(delegateReport.text, /TAIL-MARKER|\u{20ac}/u);
    assert.equal(Buffer.from(delegateReport.text, "utf8").toString("utf8"), delegateReport.text);
  });
});

test("oversized BLOCKED terminal reports keep the exact suffix and a UTF-8-safe body prefix", async () => {
  await withDiagnosticsRoot(async () => {
    // The blank line above the terminal lines is body content: only the
    // separator newline plus the terminal lines form the preserved suffix.
    const suffix = "\nDELEGATE_REASON: external_dependency\nDELEGATE_RESULT: BLOCKED\n";
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    // An ASCII body well past the bound: the whole budget left for the
    // suffix is spent on body bytes.
    const report = `${"y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT + 512)}\n\nDELEGATE_REASON: external_dependency\nDELEGATE_RESULT: BLOCKED\n`;
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(blockedResult({ report })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    // The exact terminal suffix survives verbatim at the stored end.
    assert.ok(delegateReport.text.endsWith(suffix));
    assert.equal(
      delegateReport.text,
      `${"y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT - suffixBytes)}${suffix}`,
    );
    const storedBytes = Buffer.byteLength(delegateReport.text, "utf8");
    assert.equal(storedBytes, DELEGATE_TOOL_OUTPUT_LIMIT);
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    assert.ok(delegateReport.truncatedBytes > 0);
    assert.equal(delegateReport.truncatedBytes, delegateReport.totalBytes - storedBytes);
    // Stored text stays valid UTF-8 and the body carries no terminal line.
    assert.equal(Buffer.from(delegateReport.text, "utf8").toString("utf8"), delegateReport.text);
    assert.doesNotMatch(delegateReport.text.slice(0, -suffix.length), /DELEGATE_REASON|DELEGATE_RESULT/);
  });
});

test("oversized CRLF terminal reports keep the exact suffix with the complete CRLF separator", async () => {
  await withDiagnosticsRoot(async () => {
    // Every line boundary in this report is CRLF. The blank line above the
    // terminal lines is body content: the preserved suffix must open with
    // the complete CRLF separator that ends it, never a lone LF whose CR
    // stayed behind only to be cut away with the truncated body prefix.
    const suffix = "\r\nDELEGATE_REASON: external_dependency\r\nDELEGATE_RESULT: BLOCKED\r\n";
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    const report = `${"y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT + 512)}\r\n\r\nDELEGATE_REASON: external_dependency\r\nDELEGATE_RESULT: BLOCKED\r\n`;
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(blockedResult({ report })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    // Byte-exact preservation: the stored end is the original suffix with
    // its complete leading CRLF, and the body prefix spends the rest of
    // the limit on whole ASCII bytes.
    assert.equal(delegateReport.text, `${"y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT - suffixBytes)}${suffix}`);
    const storedBytes = Buffer.byteLength(delegateReport.text, "utf8");
    assert.ok(storedBytes <= DELEGATE_TOOL_OUTPUT_LIMIT);
    assert.equal(storedBytes, DELEGATE_TOOL_OUTPUT_LIMIT);
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    assert.ok(delegateReport.truncatedBytes > 0);
    assert.equal(delegateReport.truncatedBytes, delegateReport.totalBytes - storedBytes);
    // Stored text stays valid UTF-8 and the body carries no terminal line.
    assert.equal(Buffer.from(delegateReport.text, "utf8").toString("utf8"), delegateReport.text);
    assert.doesNotMatch(delegateReport.text.slice(0, -suffix.length), /DELEGATE_REASON|DELEGATE_RESULT/);
  });
});

test("oversized LF accepted terminals keep an indented reason and Unicode whitespace around the outcome", async () => {
  await withDiagnosticsRoot(async () => {
    // Parser-accepted terminal: the reason line carries the leading and
    // surrounding Unicode whitespace line.trim()/value.trim() allow, the
    // outcome sits in Unicode whitespace, and only the result line itself
    // stays unindented. The blank line above stays body content.
    const reasonLine = "\u00a0\t DELEGATE_REASON:\u3000budget_exhausted\u00a0";
    const resultLine = "DELEGATE_RESULT:\u00a0BLOCKED";
    const suffix = `\n${reasonLine}\n${resultLine}\n\u00a0\n`;
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    const report = `${"y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT + 512)}\n\n${reasonLine}\n${resultLine}\n\u00a0\n`;
    assert.deepEqual(
      parseDelegateTerminal(report),
      { outcome: "blocked", reason: { status: "accepted", code: "budget_exhausted" } },
    );
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(blockedResult({ report })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    // Byte-exact preservation: the stored end is the verbatim separator,
    // indented reason line, and whitespace-surrounded outcome.
    assert.equal(delegateReport.text, `${"y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT - suffixBytes)}${suffix}`);
    const storedBytes = Buffer.byteLength(delegateReport.text, "utf8");
    assert.equal(storedBytes, DELEGATE_TOOL_OUTPUT_LIMIT);
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    assert.ok(delegateReport.truncatedBytes > 0);
    assert.equal(delegateReport.truncatedBytes, delegateReport.totalBytes - storedBytes);
    // Stored text stays valid UTF-8 and the body carries no terminal line.
    assert.equal(Buffer.from(delegateReport.text, "utf8").toString("utf8"), delegateReport.text);
    assert.doesNotMatch(delegateReport.text.slice(0, -suffix.length), /DELEGATE_REASON|DELEGATE_RESULT/);
  });
});

test("oversized CRLF accepted terminals keep an indented reason and Unicode whitespace around the outcome", async () => {
  await withDiagnosticsRoot(async () => {
    // Every line boundary is CRLF. The parser accepts the tab and
    // ideographic-space indent, the NBSP around the reason code, the
    // ideographic space before FAILED, and the Unicode-whitespace-only
    // trailing line; the suffix must keep all of it byte-exact with the
    // complete leading CRLF separator.
    const reasonLine = "\t\u3000DELEGATE_REASON:\u00a0verification_failure\u00a0";
    const resultLine = "DELEGATE_RESULT:\u3000FAILED";
    const suffix = `\r\n${reasonLine}\r\n${resultLine}\r\n\u3000\r\n`;
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    const report = `${"y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT + 512)}\r\n\r\n${reasonLine}\r\n${resultLine}\r\n\u3000\r\n`;
    assert.deepEqual(
      parseDelegateTerminal(report),
      { outcome: "failed", reason: { status: "accepted", code: "verification_failure" } },
    );
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(failedResult({
      report,
      state: "delegate_failed",
      progress: blockedProgress({ state: "delegate_failed", delegateOutcome: "failed", terminalReason: "verification_failure", reasonStatus: "accepted" }),
    })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    assert.equal(delegateReport.text, `${"y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT - suffixBytes)}${suffix}`);
    const storedBytes = Buffer.byteLength(delegateReport.text, "utf8");
    assert.equal(storedBytes, DELEGATE_TOOL_OUTPUT_LIMIT);
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    assert.ok(delegateReport.truncatedBytes > 0);
    assert.equal(delegateReport.truncatedBytes, delegateReport.totalBytes - storedBytes);
    // Stored text stays valid UTF-8 and the body carries no terminal line.
    assert.equal(Buffer.from(delegateReport.text, "utf8").toString("utf8"), delegateReport.text);
    assert.doesNotMatch(delegateReport.text.slice(0, -suffix.length), /DELEGATE_REASON|DELEGATE_RESULT/);
  });
});

test("an accepted-terminal report exactly at the byte limit survives byte-for-byte", async () => {
  await withDiagnosticsRoot(async () => {
    // Exactly at the 50 KiB bound the suffix machinery never engages: the
    // whole report, Unicode whitespace included, is stored verbatim.
    const suffix = "\n\u00a0DELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT:\u00a0BLOCKED\n";
    const report = `${"y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT - Buffer.byteLength(suffix, "utf8"))}${suffix}`;
    assert.equal(Buffer.byteLength(report, "utf8"), DELEGATE_TOOL_OUTPUT_LIMIT);
    assert.deepEqual(
      parseDelegateTerminal(report),
      { outcome: "blocked", reason: { status: "accepted", code: "budget_exhausted" } },
    );
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(blockedResult({ report })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    assert.equal(delegateReport.text, report);
    assert.equal(delegateReport.totalBytes, DELEGATE_TOOL_OUTPUT_LIMIT);
    assert.equal(delegateReport.truncatedBytes, 0);
    assert.equal(Buffer.from(delegateReport.text, "utf8").toString("utf8"), delegateReport.text);
  });
});

test("oversized FAILED terminal reports keep the exact suffix across a multibyte prefix boundary", async () => {
  await withDiagnosticsRoot(async () => {
    const suffix = "\nDELEGATE_REASON: verification_failure\nDELEGATE_RESULT: FAILED\n";
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    // The body budget minus one ASCII byte, then two-byte code points: the
    // raw cut lands inside the first '\u00f1' and must back off to the last
    // whole 'y', one byte below the stored limit.
    const pad = "y".repeat(DELEGATE_TOOL_OUTPUT_LIMIT - suffixBytes - 1);
    const report = `${pad}${"\u00f1".repeat(400)}\n\nDELEGATE_REASON: verification_failure\nDELEGATE_RESULT: FAILED\n`;
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(failedResult({
      report,
      state: "delegate_failed",
      progress: blockedProgress({ state: "delegate_failed", delegateOutcome: "failed", terminalReason: "verification_failure", reasonStatus: "accepted" }),
    })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    assert.equal(delegateReport.text, `${pad}${suffix}`);
    assert.ok(delegateReport.text.endsWith("DELEGATE_REASON: verification_failure\nDELEGATE_RESULT: FAILED\n"));
    const storedBytes = Buffer.byteLength(delegateReport.text, "utf8");
    assert.equal(storedBytes, DELEGATE_TOOL_OUTPUT_LIMIT - 1);
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    // Exactly the 800 dropped multibyte bytes plus the one body-side
    // blank-line newline are reported as truncated.
    assert.equal(delegateReport.truncatedBytes, 801);
    assert.equal(delegateReport.truncatedBytes, delegateReport.totalBytes - storedBytes);
    assert.doesNotMatch(delegateReport.text, /\u00f1/u);
    assert.equal(Buffer.from(delegateReport.text, "utf8").toString("utf8"), delegateReport.text);
  });
});

test("an over-limit recognized suffix falls back to whole-report prefix truncation", async () => {
  await withDiagnosticsRoot(async () => {
    // Trailing whitespace after the terminal marker is unbounded, so the
    // recognized suffix itself can exceed the limit; it can never fit, so
    // the stored text must be a plain UTF-8-safe prefix of the whole report.
    const suffix = `\nDELEGATE_REASON: external_dependency\nDELEGATE_RESULT: BLOCKED\n${"\n".repeat(60_000)}`;
    const suffixBytes = Buffer.byteLength(suffix, "utf8");
    assert.ok(suffixBytes > DELEGATE_TOOL_OUTPUT_LIMIT);
    const report = `body\n\n${suffix.slice(1)}`;
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(blockedResult({ report })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    const storedBytes = Buffer.byteLength(delegateReport.text, "utf8");
    // ASCII head: the cut lands exactly on the limit with no corruption.
    assert.equal(delegateReport.text, report.slice(0, DELEGATE_TOOL_OUTPUT_LIMIT));
    assert.equal(storedBytes, DELEGATE_TOOL_OUTPUT_LIMIT);
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    assert.ok(delegateReport.truncatedBytes > 0);
    assert.equal(delegateReport.truncatedBytes, delegateReport.totalBytes - storedBytes);
    assert.ok(!delegateReport.text.includes("\u{fffd}"));
    assert.equal(Buffer.from(delegateReport.text, "utf8").toString("utf8"), delegateReport.text);
  });
});

test("an over-limit recognized suffix over a multibyte body stays UTF-8-safe at the bound", async () => {
  await withDiagnosticsRoot(async () => {
    // Three-byte code points straddle the 50 KiB cut two bytes into a
    // character, so the fallback prefix must back off to the last whole
    // character even though a terminal suffix was recognized.
    const suffix = `\nDELEGATE_REASON: verification_failure\nDELEGATE_RESULT: FAILED\n${"\r\n".repeat(30_000)}`;
    assert.ok(Buffer.byteLength(suffix, "utf8") > DELEGATE_TOOL_OUTPUT_LIMIT);
    const body = "\u{20ac}".repeat(17_067);
    const report = `${body}\n\n${suffix.slice(1)}`;
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(failedResult({
      report,
      state: "delegate_failed",
      progress: blockedProgress({ state: "delegate_failed", delegateOutcome: "failed", terminalReason: "verification_failure", reasonStatus: "accepted" }),
    })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    const storedBytes = Buffer.byteLength(delegateReport.text, "utf8");
    assert.ok(storedBytes <= DELEGATE_TOOL_OUTPUT_LIMIT);
    // 51,200 = 3 x 17,066 + 2: the cut backs off two bytes to 51,198.
    assert.equal(storedBytes, 51_198);
    assert.equal(delegateReport.text, "\u{20ac}".repeat(17_066));
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    assert.ok(delegateReport.truncatedBytes > 0);
    assert.equal(delegateReport.truncatedBytes, delegateReport.totalBytes - storedBytes);
    assert.ok(!delegateReport.text.includes("\u{fffd}"));
    assert.equal(Buffer.from(delegateReport.text, "utf8").toString("utf8"), delegateReport.text);
  });
});

test("oversized reports with an unrecognized terminal look-alike tail keep prefix truncation only", async () => {
  await withDiagnosticsRoot(async () => {
    // The tail looks terminal but carries a reason code outside the fixed
    // enum, so no suffix is recognized and safe prefix truncation applies.
    const head = "z".repeat(DELEGATE_TOOL_OUTPUT_LIMIT + 64);
    const report = `${head}\n\nDELEGATE_REASON: not_a_fixed_code\nDELEGATE_RESULT: BLOCKED\n`;
    const parsed = JSON.parse(await readFile(await writeFailureDiagnostic(blockedResult({
      report,
      progress: blockedProgress({ terminalReason: "unspecified", reasonStatus: "rejected" }),
    })), "utf8")) as Record<string, unknown>;
    const delegateReport = parsed.delegateReport as { text: string; totalBytes: number; truncatedBytes: number };
    assert.equal(delegateReport.text, "z".repeat(DELEGATE_TOOL_OUTPUT_LIMIT));
    const storedBytes = Buffer.byteLength(delegateReport.text, "utf8");
    assert.equal(delegateReport.totalBytes, Buffer.byteLength(report, "utf8"));
    assert.ok(delegateReport.truncatedBytes > 0);
    assert.equal(delegateReport.truncatedBytes, delegateReport.totalBytes - storedBytes);
    assert.doesNotMatch(delegateReport.text, /DELEGATE_REASON|DELEGATE_RESULT/);
  });
});

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

test("truncated attempt histories retain the terminal attempt within the attempt cap", () => {
  // Twelve attempts: eleven failed fallbacks, then a terminal completion.
  // The routing parser imposes no route-count limit, so the bounded slice
  // must keep the completion the analyzer's eligible sample depends on.
  const attempts = [
    ...Array.from({ length: 11 }, (_, index) => ({
      route: `provider/model-${index}:max`,
      state: "stalled" as const,
      elapsedSeconds: index + 1,
    })),
    {
      route: "zai/glm-5.3:max",
      state: "completed" as const,
      elapsedSeconds: 42,
      maxProgressIdleSeconds: 321.5,
    },
  ];
  const record = schemaEightRecord(failedResult({ attempts }));
  const serialized = record.attempts as Record<string, unknown>[];
  assert.equal(serialized.length, 10);
  assert.deepEqual(
    serialized.slice(0, 9).map((attempt) => attempt.route),
    Array.from({ length: 9 }, (_, index) => `provider/model-${index}:max`),
  );
  assert.equal(serialized[9]!.route, "zai/glm-5.3:max");
  assert.equal(serialized[9]!.state, "completed");
  assert.equal(serialized[9]!.maxProgressIdleSeconds, 321.5);
  assert.ok(!JSON.stringify(record).includes("provider/model-9"));
  assert.ok(!JSON.stringify(record).includes("provider/model-10"));
  // At or under the cap, every attempt serializes in full order.
  const shortHistory = [
    { route: "provider/one:max", state: "stalled" as const, elapsedSeconds: 1 },
    { route: "provider/two:max", state: "completed" as const, elapsedSeconds: 2, maxProgressIdleSeconds: 5.5 },
  ];
  const shortRecord = schemaEightRecord(failedResult({ attempts: shortHistory }));
  assert.deepEqual(
    (shortRecord.attempts as Record<string, unknown>[]).map((attempt) => attempt.state),
    ["stalled", "completed"],
  );
});

test("schema 8 rejects seeded paths, credentials, payloads, signals, pids, digests, and raw errors", () => {
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

test("schema 8 attempt records drop malformed non-finite supervised values", () => {
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

test("schema 8 omits invalid provider categories and keeps every valid category", async () => {
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
        report: "",
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

test("schema version is exactly 8 and the maximum field has the bounded shape", async () => {
  await withDiagnosticsRoot(async () => {
    assert.equal(SCHEMA_VERSION, 8);
    assert.equal(SUCCESS_RECORD_LIMIT, 4096);
    const record = failureDiagnostic(failedResult());
    assert.equal(record.schemaVersion, 8);
    assert.equal(record.maxProgressIdleSeconds, 431.2);
    assert.equal((record.attempts as Record<string, unknown>[])[0]!.maxProgressIdleSeconds, 431.2);
  });
});

test("completed and unsuccessful records share the same safe schema-8 shape except the failure-only delegate report", async () => {
  await withDiagnosticsRoot(async () => {
    const completedPath = await writeSuccessTelemetry(completedResult());
    const completed = JSON.parse(await readFile(completedPath, "utf8")) as Record<string, unknown>;
    // Same builder, same optionals-absent comparison shape: the unsuccessful
    // twin clears exactly the optional fields the completed fixture clears.
    const unsuccessful = serializedRecord(failureDiagnostic(failedResult({
      deadlineCause: undefined,
      stallCause: undefined,
      cleanupFailureReason: undefined,
      interruptionSource: undefined,
      progress: { ...failedResult().progress, reportRecoveryReason: undefined },
    })));
    // The failure view adds exactly one key: the bounded delegate report.
    assert.deepEqual(
      Object.keys(unsuccessful).filter((key) => key !== "delegateReport").sort(),
      Object.keys(completed).sort(),
    );
    assert.equal("delegateReport" in unsuccessful, true);
    assert.equal("delegateReport" in completed, false);
    assert.equal(completed.schemaVersion, 8);
    assert.equal(completed.state, "completed");
    assert.equal(completed.maxProgressIdleSeconds, 300.4);
    assert.equal((completed.attempts as Record<string, unknown>[])[0]!.maxProgressIdleSeconds, 300.4);
  });
});

test("success records contain no delegate report, prompt, path, or provider text", async () => {
  await withDiagnosticsRoot(async (root) => {
    // A label outside the bounded identifier alphabet is omitted entirely;
    // the bounded record itself never carries report or prompt material.
    const result = completedResult({ label: "SECRET LABEL /PRIVATE report" });
    const completedPath = await writeSuccessTelemetry(result);
    const content = await readFile(completedPath, "utf8");
    assert.ok(path.basename(completedPath).startsWith(SUCCESS_FILE_PREFIX));
    assert.ok(completedPath.startsWith(path.join(root, "logs", "delegated-pi-loop")));
    // Successful telemetry never gains the failure-only delegate report.
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.equal("delegateReport" in parsed, false);
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
  const record = schemaEightRecord(completedResult({
    progress: { ...completedResult().progress, maxProgressIdleSeconds: 0 },
    attempts: [{ route: "zai/glm-5.3:max", state: "completed", elapsedSeconds: 1, maxProgressIdleSeconds: 0 }],
  }));
  assert.equal(record.maxProgressIdleSeconds, 0);
  assert.equal((record.attempts as Record<string, unknown>[])[0]!.maxProgressIdleSeconds, 0);
});

test("invalid top-level and attempt maximum values fail closed by omission", () => {
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const record = serializedRecord(schemaEightRecord(completedResult({
      progress: { ...completedResult().progress, maxProgressIdleSeconds: invalid },
      attempts: [{ route: "zai/glm-5.3:max", state: "completed", elapsedSeconds: 1, maxProgressIdleSeconds: invalid }],
    })));
    assert.equal(record.maxProgressIdleSeconds, undefined, String(invalid));
    assert.ok(!JSON.stringify(record).includes("maxProgressIdleSeconds"), String(invalid));
  }
});

test("catalog-only attempts omit the maximum in schema-8 records", () => {
  const record = serializedRecord(schemaEightRecord(completedResult({
    attempts: [{ route: "zai/glm-5.3:max", state: "catalog_unavailable", elapsedSeconds: 0.4 }],
  })));
  const attempt = (record.attempts as Record<string, unknown>[])[0]!;
  assert.equal("maxProgressIdleSeconds" in attempt, false);
});

test("historical schema 3-7 files are never rewritten or pruned", async () => {
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
      // A genuine old-writer schema-7 success name: historical files stay
      // unmigrated and are never pruning candidates for the v8 writer.
      "success-v7-implementation-1000-5-5.json",
    ];
    assert.equal(isSuccessTelemetryName("success-v7-implementation-1000-5-5.json"), false);
    for (let index = 0; index < names.length; index += 1) {
      await seedSuccessFile(directory, names[index]!, new Date(historicalAt.getTime() + index * 1000));
    }
    const before = await Promise.all(names.map(async (name) => {
      const filePath = path.join(directory, name);
      return { name, content: await readFile(filePath, "utf8"), mtime: (await stat(filePath)).mtimeMs };
    }));
    // Retention limit 1: with the correct v8-only matcher the single new
    // record is the only candidate, so nothing is pruned; a matcher that
    // wrongly accepted the historical v7 name would prune it as the oldest.
    await writeSuccessTelemetry(completedResult(), 1);
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

test("retention keeps the newest records and prunes only exact success-v8 files", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    const seeded = [
      "success-v8-implementation-1000-1-1.json",
      "success-v8-implementation-1000-1-2.json",
      "success-v8-implementation-1000-1-3.json",
    ];
    for (let index = 0; index < seeded.length; index += 1) {
      await seedSuccessFile(directory, seeded[index]!, new Date(base + index * 1000));
    }
    // Pruning candidates with success-looking names that must never be
    // deleted: a symlink, a directory, a failure, and an unknown name.
    await symlink(path.join(directory, seeded[0]!), path.join(directory, "success-v8-symlink.json"));
    await mkdir(path.join(directory, "success-v8-directory.json"));
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
    assert.ok((await lstat(path.join(directory, "success-v8-symlink.json"))).isSymbolicLink());
    assert.ok((await lstat(path.join(directory, "success-v8-directory.json"))).isDirectory());
    await stat(path.join(directory, "failure-implementation-1000-9-9.json"));
    await stat(path.join(directory, "other.json"));
  });
});

test("nothing is pruned while the exact-name candidate count is at or under the limit", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    const seeded = [
      "success-v8-implementation-1000-1-1.json",
      "success-v8-implementation-1000-1-2.json",
    ];
    for (let index = 0; index < seeded.length; index += 1) {
      await seedSuccessFile(directory, seeded[index]!, new Date(base + index * 1000));
    }
    // Two seeded files plus one new write against limit three: the sweep
    // cannot prune anything and every exact success record stays in place.
    const written = await writeSuccessTelemetry(completedResult(), 3);
    const remaining = await successEntries(directory);
    assert.equal(remaining.length, 3);
    for (const name of seeded) assert.ok(remaining.includes(name), name);
    assert.ok(remaining.includes(path.basename(written)));
  });
});

test("retention order is deterministic by write time with a filename tie-breaker", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    // Identical write times: the filename tie-breaker decides deterministically.
    // The seeded names use the full writer-generated shape (numeric timestamp,
    // pid, and counter segments) because only writer-owned names are candidates.
    const sameTime = new Date(base);
    const names = [
      "success-v8-implementation-1000-1-1.json",
      "success-v8-implementation-1000-1-2.json",
      "success-v8-implementation-1000-1-3.json",
    ];
    for (const name of names) await seedSuccessFile(directory, name, sameTime);
    const written = await writeSuccessTelemetry(completedResult(), 2);
    const remaining = await successEntries(directory);
    // Four candidates, limit two: the filename tie-breaker deletes the two
    // lexicographically smallest seeded names; the newest seeded name and
    // the freshly written record (newest mtime) survive.
    assert.equal(remaining.length, 2);
    assert.ok(remaining.includes("success-v8-implementation-1000-1-3.json"));
    assert.ok(!remaining.includes("success-v8-implementation-1000-1-1.json"));
    assert.ok(!remaining.includes("success-v8-implementation-1000-1-2.json"));
    assert.ok(remaining.includes(path.basename(written)));
  });
});

test("near-miss success-v8-looking names are never pruning candidates and survive retention", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    // Regular files whose names only look extension-owned: too few segments,
    // a non-numeric timestamp/pid/counter segment, empty numeric segments.
    const foreign = [
      "success-v8-not-owned.json",
      "success-v8-abc.json",
      "success-v8-label-notatime-123-4.json",
      "success-v8-label-123-x-4.json",
      "success-v8-label-123-4-x.json",
      "success-v8-label--123-4.json",
      "success-v8-label-123--4.json",
      "success-v8-label-123-4-.json",
    ];
    for (const name of foreign) assert.equal(isSuccessTelemetryName(name), false, name);
    // The foreign files are seeded as the oldest regular files: under a
    // prefix-plus-suffix check they would be the first pruning victims.
    const foreignBefore: { name: string; mtimeMs: number }[] = [];
    for (let index = 0; index < foreign.length; index += 1) {
      await seedSuccessFile(directory, foreign[index]!, new Date(base - 60_000 + index));
      const filePath = path.join(directory, foreign[index]!);
      foreignBefore.push({ name: foreign[index]!, mtimeMs: (await stat(filePath)).mtimeMs });
    }
    const seeded = [
      "success-v8-implementation-1000-1-1.json",
      "success-v8-implementation-1000-1-2.json",
      "success-v8-implementation-1000-1-3.json",
      "success-v8-implementation-1000-1-4.json",
      "success-v8-implementation-1000-1-5.json",
    ];
    for (let index = 0; index < seeded.length; index += 1) {
      await seedSuccessFile(directory, seeded[index]!, new Date(base + index * 1000));
    }
    await writeSuccessTelemetry(completedResult(), 2);
    // Genuine writer-shaped records are still pruned down to the limit.
    const remaining = await successEntries(directory);
    const genuine = remaining.filter(isSuccessTelemetryName);
    assert.equal(genuine.length, 2, `genuine records must be pruned to the limit, got ${genuine.join(",")}`);
    for (const name of seeded.slice(0, 4)) assert.ok(!remaining.includes(name), name);
    assert.ok(remaining.includes(seeded[4]!), "the newest genuine record must survive");
    // Every foreign regular file survives untouched with identical bytes and mtime.
    for (const entry of foreignBefore) {
      const filePath = path.join(directory, entry.name);
      assert.equal(await readFile(filePath, "utf8"), "{}\n", entry.name);
      assert.equal((await stat(filePath)).mtimeMs, entry.mtimeMs, entry.name);
    }
  });
});

test("a writer-shaped name with a 65-character label is not writer-owned and never pruned", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    // `safeLabel` always truncates to 64 characters, so a 65-character label
    // remainder cannot be writer-owned regardless of its characters.
    const overLength = `success-v8-${"a".repeat(65)}-1000-1-1.json`;
    assert.equal(isSuccessTelemetryName(overLength), false);
    // Seeded as the oldest regular file: under an unbounded label check it
    // would be the first pruning victim.
    await seedSuccessFile(directory, overLength, new Date(base - 60_000));
    const seeded = [
      "success-v8-implementation-1000-1-1.json",
      "success-v8-implementation-1000-1-2.json",
      "success-v8-implementation-1000-1-3.json",
      "success-v8-implementation-1000-1-4.json",
    ];
    for (let index = 0; index < seeded.length; index += 1) {
      await seedSuccessFile(directory, seeded[index]!, new Date(base + index * 1000));
    }
    await writeSuccessTelemetry(completedResult(), 2);
    // Genuine records still prune to the limit while the over-length name
    // survives untouched as a foreign file.
    const remaining = await successEntries(directory);
    const genuine = remaining.filter(isSuccessTelemetryName);
    assert.equal(genuine.length, 2, `genuine records must be pruned to the limit, got ${genuine.join(",")}`);
    assert.ok(remaining.includes(overLength), "the 65-character-label file must survive the sweep");
    assert.equal(await readFile(path.join(directory, overLength), "utf8"), "{}\n");
  });
});

test("label remainders safeLabel can never emit are rejected by the name matcher", () => {
  // safeLabel strips leading [-.]+ before its slice, so writer output can
  // never start with - or .
  const rejected = [
    "success-v8--foreign-1000-1-1.json",
    "success-v8-.foreign-1000-1-1.json",
  ];
  for (const name of rejected) assert.equal(isSuccessTelemetryName(name), false, name);
});

test("foreign leading-punctuation files survive an over-limit sweep", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    // The two leading-punctuation probes: remainders outside safeLabel's
    // emission shape, seeded as the oldest regular files so an over-broad
    // matcher would delete them first.
    const foreign = [
      "success-v8--foreign-1000-1-1.json",
      "success-v8-.foreign-1000-1-1.json",
    ];
    for (const name of foreign) assert.equal(isSuccessTelemetryName(name), false, name);
    const foreignBefore: { name: string; mtimeMs: number }[] = [];
    for (let index = 0; index < foreign.length; index += 1) {
      await seedSuccessFile(directory, foreign[index]!, new Date(base - 60_000 + index));
      const filePath = path.join(directory, foreign[index]!);
      foreignBefore.push({ name: foreign[index]!, mtimeMs: (await stat(filePath)).mtimeMs });
    }
    const seeded = [
      "success-v8-implementation-1000-1-1.json",
      "success-v8-implementation-1000-1-2.json",
      "success-v8-implementation-1000-1-3.json",
      "success-v8-implementation-1000-1-4.json",
      "success-v8-implementation-1000-1-5.json",
    ];
    for (let index = 0; index < seeded.length; index += 1) {
      await seedSuccessFile(directory, seeded[index]!, new Date(base + index * 1000));
    }
    await writeSuccessTelemetry(completedResult(), 2);
    // Genuine writer-shaped records still prune down to the limit.
    const remaining = await successEntries(directory);
    const genuine = remaining.filter(isSuccessTelemetryName);
    assert.equal(genuine.length, 2, `genuine records must be pruned to the limit, got ${genuine.join(",")}`);
    for (const name of seeded.slice(0, 4)) assert.ok(!remaining.includes(name), name);
    assert.ok(remaining.includes(seeded[4]!), "the newest genuine record must survive");
    // Every foreign file survives untouched with identical bytes and mtime.
    for (const entry of foreignBefore) {
      const filePath = path.join(directory, entry.name);
      assert.equal(await readFile(filePath, "utf8"), "{}\n", entry.name);
      assert.equal((await stat(filePath)).mtimeMs, entry.mtimeMs, entry.name);
    }
  });
});

test("exact-64 label remainders ending in - or . are writer-emittable and accepted", async () => {
  await withDiagnosticsRoot(async () => {
    // slice(0, 64) can cut right after a - or ., so a trailing - or . is
    // writer-emittable exactly at the 64-character bound; rejecting these
    // names would silently disable retention for genuine writer output.
    const hyphenEnd = `success-v8-${"a".repeat(63)}--1000-1-1.json`;
    const dotEnd = `success-v8-${"a".repeat(63)}.-1000-1-1.json`;
    const alnumEnd = `success-v8-${"a".repeat(64)}-1000-1-1.json`;
    assert.equal(isSuccessTelemetryName(hyphenEnd), true);
    assert.equal(isSuccessTelemetryName(dotEnd), true);
    assert.equal(isSuccessTelemetryName(alnumEnd), true);
    // The real writer emits exactly these shapes from longer inputs: the
    // strip leaves both ends intact, then the slice cuts at 64.
    const hyphenWritten = await writeSuccessTelemetry(completedResult({ label: `${"a".repeat(63)}-a` }), 4);
    const dotWritten = await writeSuccessTelemetry(completedResult({ label: `${"a".repeat(63)}.a` }), 4);
    assert.ok(isSuccessTelemetryName(path.basename(hyphenWritten)));
    assert.ok(isSuccessTelemetryName(path.basename(dotWritten)));
    assert.ok(path.basename(hyphenWritten).includes(`${"a".repeat(63)}--`));
    assert.ok(path.basename(dotWritten).includes(`${"a".repeat(63)}.-`));
  });
});

test("every writer-generated success filename matches the name filter across varied labels", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    // Labels that exercise every safeLabel edge: plain, hyphenated, dotted,
    // interior sanitization, the empty-after-sanitization fallback, and the
    // 64-character slice bound.
    const labels = [
      "implementation",
      "schema-8-fix",
      "progress.gap.telemetry",
      "fix.7 schema v2",
      "/// ??? !!!",
      "a".repeat(100),
    ];
    for (const label of labels) {
      const filePath = await writeSuccessTelemetry(completedResult({ label }), 3);
      const name = path.basename(filePath);
      // A false rejection would silently disable retention and break the bound.
      assert.ok(isSuccessTelemetryName(name), `writer output must stay a retention candidate: ${name}`);
    }
    const names = await successEntries(directory);
    // The sanitization fallback still produces a bounded, writer-owned name.
    assert.ok(names.some((name) => name.startsWith(`${SUCCESS_FILE_PREFIX}delegate-`)), "the empty-after-sanitization fallback must produce a delegate-labeled name");
    // Retention still prunes genuine writer output down to the injectable limit.
    assert.equal(names.length, 3, `varied-label writes must still prune to the limit, got ${names.join(",")}`);
    assert.ok(names.every(isSuccessTelemetryName));
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
      const name = `success-v8-implementation-1000-1-${String(index).padStart(4, "0")}.json`;
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

/** Installs recording retention probes and returns their restore function plus every rm call. */
function installRecordingProbes(): { restore: () => void; rmCalls: string[] } {
  const rmCalls: string[] = [];
  const originalLstat = retentionProbes.lstat;
  const originalRm = retentionProbes.rm;
  retentionProbes.rm = async (filePath) => {
    rmCalls.push(filePath);
    return originalRm(filePath);
  };
  return {
    rmCalls,
    restore: () => {
      retentionProbes.lstat = originalLstat;
      retentionProbes.rm = originalRm;
    },
  };
}

test("a symlink replacement between validation and deletion survives untouched", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    const seeded = [
      "success-v8-implementation-3000-1-1.json",
      "success-v8-implementation-3000-1-2.json",
      "success-v8-implementation-3000-1-3.json",
    ];
    for (let index = 0; index < seeded.length; index += 1) {
      await seedSuccessFile(directory, seeded[index]!, new Date(base + index * 1000));
    }
    const target = path.join(directory, seeded[0]!);
    const saved = `${target}.saved`;
    const originalLstat = retentionProbes.lstat;
    const { restore, rmCalls } = await installRecordingProbes();
    retentionProbes.lstat = async (filePath) => {
      if (filePath === target) {
        // Cross-process replacement after the batched validation: another
        // same-user process moves the validated regular file aside and puts
        // a symlink at the same pathname before the deletion check runs.
        await rename(target, saved);
        await symlink(saved, target);
      }
      return originalLstat(filePath);
    };
    try {
      await writeSuccessTelemetry(completedResult(), 2);
    } finally {
      restore();
    }
    assert.ok((await lstat(target)).isSymbolicLink(), "the replacement symlink must survive");
    await stat(saved);
    assert.ok(!rmCalls.includes(target), "rm must not be called for the replaced entry");
    assert.ok(!rmCalls.includes(saved), "the moved-aside validated file must not be deleted either");
    // The sweep still prunes the next-oldest over-limit candidate.
    assert.ok(rmCalls.includes(path.join(directory, seeded[1]!)));
    const remaining = await successEntries(directory);
    assert.ok(remaining.length <= 2, `at most the limit survives, got ${remaining.join(",")}`);
  });
});

test("a foreign regular-file replacement survives the dev/ino identity check", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    const seeded = [
      "success-v8-implementation-3100-1-1.json",
      "success-v8-implementation-3100-1-2.json",
      "success-v8-implementation-3100-1-3.json",
    ];
    for (let index = 0; index < seeded.length; index += 1) {
      await seedSuccessFile(directory, seeded[index]!, new Date(base + index * 1000));
    }
    const target = path.join(directory, seeded[0]!);
    const moved = `${target}.moved`;
    const validatedIno = (await lstat(target)).ino;
    const originalLstat = retentionProbes.lstat;
    const { restore, rmCalls } = await installRecordingProbes();
    retentionProbes.lstat = async (filePath) => {
      if (filePath === target) {
        // Cross-process replacement with an unrelated regular file: a new
        // inode occupies the validated pathname before deletion runs.
        await rename(target, moved);
        await writeFile(filePath, "{\"foreign\":true}\n", { mode: 0o600 });
      }
      return originalLstat(filePath);
    };
    try {
      await writeSuccessTelemetry(completedResult(), 2);
    } finally {
      restore();
    }
    const fresh = await lstat(target);
    assert.ok(fresh.isFile(), "the foreign replacement regular file must survive");
    assert.notEqual(fresh.ino, validatedIno, "the replacement must occupy a different inode");
    assert.equal(await readFile(target, "utf8"), "{\"foreign\":true}\n");
    assert.ok(!rmCalls.includes(target), "rm must not be called for the replaced entry");
    await stat(moved);
    assert.ok(rmCalls.includes(path.join(directory, seeded[1]!)));
    // The preserved replacement is itself a regular success-named file, so
    // this sweep ends one entry over the limit; a later sweep re-validates
    // it as its own candidate and restores the bound. The pruned record is
    // gone and the newest records survive.
    const remaining = await successEntries(directory);
    assert.ok(!remaining.includes(seeded[1]!));
    assert.ok(remaining.includes(seeded[0]!));
    assert.ok(remaining.includes(seeded[2]!));
    assert.equal(remaining.length, 3);
  });
});

test("a candidate vanishing before the deletion check is skipped without failing the sweep", async () => {
  await withDiagnosticsRoot(async (root) => {
    const directory = path.join(root, "logs", "delegated-pi-loop");
    const base = Date.now() - 3_600_000;
    const seeded = [
      "success-v8-implementation-3200-1-1.json",
      "success-v8-implementation-3200-1-2.json",
      "success-v8-implementation-3200-1-3.json",
    ];
    for (let index = 0; index < seeded.length; index += 1) {
      await seedSuccessFile(directory, seeded[index]!, new Date(base + index * 1000));
    }
    const target = path.join(directory, seeded[0]!);
    const originalLstat = retentionProbes.lstat;
    const { restore, rmCalls } = await installRecordingProbes();
    retentionProbes.lstat = async (filePath) => {
      if (filePath === target) {
        // Another local Pi process prunes the file between the batched
        // validation and the deletion check: the final lstat sees ENOENT.
        await rm(filePath, { force: true });
      }
      return originalLstat(filePath);
    };
    let written: string | undefined;
    try {
      written = await writeSuccessTelemetry(completedResult(), 2);
    } finally {
      restore();
    }
    await assert.rejects(() => lstat(target), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    assert.ok(!rmCalls.includes(target), "rm must not be called for the vanished entry");
    assert.ok(rmCalls.includes(path.join(directory, seeded[1]!)));
    const remaining = await successEntries(directory);
    assert.ok(remaining.length <= 2, `at most the limit survives, got ${remaining.join(",")}`);
    assert.ok(remaining.includes(path.basename(written!)));
  });
});
