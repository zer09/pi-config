import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RESTART_AFTER_WORK_NOTE } from "./instructions.ts";
import { buildDelegateResourceSelection, readResourcesFile } from "./resources.ts";
import { validateRoutingConfig } from "./routing.ts";
import { finalizeDelegateRun } from "./result.ts";
import { isOperationalFailureState, runDelegate } from "./runner.ts";
import { terminationProbes } from "./supervisor.ts";
import type { DelegateRunResult, RunOptions, ToolResult } from "./types.ts";

const execFileAsync = promisify(execFile);
type Behavior =
  | "complete"
  | "unavailable"
  | "credit"
  | "tool-unavailable"
  | "mutate-existing"
  | "missing-recover"
  | "missing-provider"
  | "blocked"
  | "failed"
  | "hang"
  | "thinking-active"
  | "tool-active"
  | "tool-silent"
  | "invalid-stream"
  | "custom"
  | "novel-long"
  | "novel-long-fail"
  | "missing-long";

function enoent(error: NodeJS.ErrnoException): boolean {
  return error.code === "ENOENT";
}

/**
 * One owned artifact-parent sandbox per test process, injected through the
 * narrow PI_DELEGATE_ARTIFACT_PARENT seam. Every `delegated-pi-*` directory
 * the runs in this process create lands inside it, so assertions and cleanup
 * touch only paths this process owns. Another test process or a real
 * delegate's artifacts in the shared tmpdir are never enumerated or removed.
 */
const ownedArtifactParent = await mkdtemp(path.join(os.tmpdir(), "delegate-runner-artifacts-"));
process.env.PI_DELEGATE_ARTIFACT_PARENT = ownedArtifactParent;

/**
 * Owned diagnostics root: finalizeDelegateRun persists failure diagnostics
 * (including routes_unavailable) here through the existing
 * PI_CODING_AGENT_DIR seam, never in the user's real agent logs directory.
 */
const ownedDiagnosticsRoot = await mkdtemp(path.join(os.tmpdir(), "delegate-runner-diag-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = ownedDiagnosticsRoot;

/** Unique fixture roots created by fakePi/resistantPi, removed by exact path. */
const fixtureRoots: string[] = [];

/**
 * Fixture process groups whose exact pids were captured before an await, so
 * the after-hook safety net can kill them even when a test body never
 * settles on a regression.
 */
const safetyGroups: { leader: number; descendant: number }[] = [];

after(async () => {
  delete process.env.PI_DELEGATE_ARTIFACT_PARENT;
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  // Safety net: kill every captured fixture group by exact pid and group id
  // before removing the fixture roots, so a hung test cannot leak processes.
  for (const group of safetyGroups) killOwned(group.leader, group.descendant);
  await Promise.all([
    ...fixtureRoots.map((root) => rm(root, { recursive: true, force: true })),
    rm(ownedArtifactParent, { recursive: true, force: true }),
    rm(ownedDiagnosticsRoot, { recursive: true, force: true }),
  ]);
});

async function ownedArtifactDirs(): Promise<string[]> {
  const entries = await readdir(ownedArtifactParent);
  return entries
    .filter((entry) => entry.startsWith("delegated-pi-"))
    .map((entry) => path.join(ownedArtifactParent, entry));
}

async function removeOwnedArtifactDirs(): Promise<void> {
  for (const entry of await ownedArtifactDirs()) {
    await rm(entry, { recursive: true, force: true });
  }
}

async function assertNoOwnedArtifacts(message: string): Promise<void> {
  assert.deepEqual(await ownedArtifactDirs(), [], message);
}

/**
 * Asserts that a rejected runDelegate call creates no private artifact
 * directory inside the owned sandbox. The finally removes any leaked
 * directory by exact path inside that sandbox only.
 */
async function assertCreatesNoArtifact(run: () => Promise<unknown>): Promise<void> {
  try {
    await assert.rejects(run);
    await assertNoOwnedArtifacts("a rejected run must not create a private artifact directory");
  } finally {
    await removeOwnedArtifactDirs();
  }
}

/**
 * Asserts that a rejected runDelegate call propagates the caller's original
 * error and leaves no private artifact directory behind, cleaning only exact
 * paths inside the owned sandbox.
 */
async function assertRejectsWithoutArtifact(run: () => Promise<unknown>, expected: unknown): Promise<void> {
  try {
    await assert.rejects(run, (error: unknown) => {
      assert.equal(error, expected, "runDelegate must reject with the caller's original error");
      return true;
    });
    await assertNoOwnedArtifacts("a rejected run must not leave a private artifact directory");
  } finally {
    await removeOwnedArtifactDirs();
  }
}

/**
 * Awaits an already-started run and finalizes the received
 * DelegateRunResult in a finally. Ownership of the artifact directory
 * transfers to the caller only until execute-level finalization, so an
 * assertion failure inside the body must never leak the directory out of
 * the owned sandbox. The body may call the memoized finalize itself; the
 * boundary call then reuses that exact finalization.
 */
async function settleAndFinalize<T>(
  resultPromise: Promise<DelegateRunResult>,
  body: (result: DelegateRunResult, finalize: () => Promise<ToolResult>) => Promise<T>,
): Promise<T> {
  const result = await resultPromise;
  let finalizePromise: Promise<ToolResult> | undefined;
  const finalize = () => {
    finalizePromise ??= finalizeDelegateRun(result);
    return finalizePromise;
  };
  try {
    return await body(result, finalize);
  } finally {
    await finalize();
    await assertNoOwnedArtifacts("the owned artifact sandbox must be clean after finalization");
  }
}

/**
 * Runs one delegation and finalizes the received DelegateRunResult in a
 * finally. Ownership of the artifact directory transfers to the caller only
 * until execute-level finalization, so an assertion failure inside the body
 * must never leak the directory out of the owned sandbox. The body may call
 * the memoized finalize itself (for example to prove the artifacts survive
 * until finalization); the boundary call then reuses that exact finalization.
 */
async function runAndFinalize<T>(
  options: RunOptions,
  body: (result: DelegateRunResult, finalize: () => Promise<ToolResult>) => Promise<T>,
): Promise<T> {
  return settleAndFinalize(runDelegate(options), body);
}

async function fakePi(
  catalog: readonly string[],
  behaviors: Readonly<Record<string, Behavior>>,
  options: {
    catalogDelayMs?: number;
    catalogDelayRoute?: string;
    spawnMarker?: boolean;
    supervisionLog?: boolean;
    argvLog?: boolean;
    reportText?: string;
    recoveryReportText?: string;
  } = {},
): Promise<{
  root: string;
  invocation: { command: string; prefixArgs: string[] };
  spawnMarkerPath?: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-runner-test-"));
  fixtureRoots.push(root);
  const script = path.join(root, "fake-pi.mjs");
  const spawnMarkerPath = options.spawnMarker === true ? path.join(root, "spawn-marker.txt") : undefined;
  await writeFile(script, `
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const catalog = ${JSON.stringify(catalog)};
const behaviors = ${JSON.stringify(behaviors)};
const customReportText = ${JSON.stringify(options.reportText ?? null)};
const recoveryReportText = ${JSON.stringify(options.recoveryReportText ?? null)};
const catalogDelayMs = ${options.catalogDelayMs ?? 0};
const catalogDelayRoute = ${JSON.stringify(options.catalogDelayRoute ?? null)};
const spawnMarkerPath = ${JSON.stringify(spawnMarkerPath ?? null)};
const supervisionLog = ${options.supervisionLog === true};
const argvLog = ${options.argvLog === true};
if (argvLog) appendFileSync("argv.jsonl", JSON.stringify(process.argv.slice(1)) + "\\n");
if (spawnMarkerPath) writeFileSync(spawnMarkerPath, String(process.pid));
if (args.includes("--list-models")) {
  const route = args[args.indexOf("--list-models") + 1];
  const respond = () => {
    if (catalog.includes(route)) {
      const separator = route.indexOf("/");
      const provider = route.slice(0, separator);
      const model = route.slice(separator + 1);
      console.log("provider model context max-out thinking images");
      console.log(provider + " " + model + " 272K 128K yes yes");
    }
    process.exit(0);
  };
  if (catalogDelayMs > 0 && (catalogDelayRoute === null || route === catalogDelayRoute)) setTimeout(respond, catalogDelayMs);
  else respond();
} else {
  const provider = args[args.indexOf("--provider") + 1];
  const model = args[args.indexOf("--model") + 1];
  const route = provider + "/" + model;
  if (supervisionLog) appendFileSync("supervision-routes.jsonl", route + "\\n");
  const behavior = behaviors[route] ?? "complete";
  const emit = (event) => console.log(JSON.stringify(event));
  let buffer = "";
  let round = 0;
  process.stdin.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\\n")) {
      const newline = buffer.indexOf("\\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const command = JSON.parse(line);
      if (command.type !== "prompt") continue;
      round += 1;
      emit({ id: command.id, type: "response", command: "prompt", success: true });
      emit({ type: "agent_start" });
      if (behavior === "hang") continue;
      if (behavior === "missing-long" && round === 2) {
        emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Recovered.\\n\\nDELEGATE_RESULT: COMPLETED" }] } });
        emit({ type: "agent_end", willRetry: false });
        emit({ type: "agent_settled" });
        continue;
      }
      if (behavior === "novel-long" || behavior === "novel-long-fail" || behavior === "missing-long") {
        // Emits one novel authoritative message every 120 ms for about 1.6 s,
        // so every renewable progress lease is renewed many times; the route
        // then completes, fails after novel work, or settles without a valid
        // terminal marker (invalid-result recovery stays eligible).
        let count = 0;
        const timer = setInterval(() => {
          count += 1;
          emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "novel checkpoint " + count + " on " + route }] } });
          if (count < 14) return;
          clearInterval(timer);
          if (behavior === "novel-long") {
            emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Completed on " + route + ".\\n\\nDELEGATE_RESULT: COMPLETED" }] } });
            emit({ type: "agent_end", willRetry: false });
            emit({ type: "agent_settled" });
          } else if (behavior === "novel-long-fail") {
            emit({ type: "message_update", assistantMessageEvent: { type: "error", errorMessage: "503 Service unavailable" } });
            emit({ type: "agent_end", willRetry: false });
            emit({ type: "agent_settled" });
          } else {
            emit({ type: "agent_end", willRetry: false });
            emit({ type: "agent_settled" });
          }
        }, 120);
        continue;
      }
      if (behavior === "invalid-stream") {
        process.stdout.write("{malformed\\n");
        continue;
      }
      if (behavior === "thinking-active" || behavior === "tool-active" || behavior === "tool-silent") {
        let updates = 0;
        if (behavior === "tool-active") {
          emit({ type: "tool_execution_start", toolCallId: "active-1", toolName: "ctx_batch_execute", args: {} });
        }
        if (behavior === "tool-silent") {
          // One tool starts and never updates or ends: the attempt ends on
          // the active-tool idle lease with the tool still executing.
          emit({ type: "tool_execution_start", toolCallId: "silent-1", toolName: "ctx_batch_execute", args: {} });
          continue;
        }
        const timer = setInterval(() => {
          updates += 1;
          if (behavior === "thinking-active") {
            emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } });
          } else {
            // Each update carries a novel accumulated result: identical
            // accumulated updates renew nothing by contract, so a meaningful
            // tool-activity fixture must actually change the payload.
            emit({ type: "tool_execution_update", toolCallId: "active-1", toolName: "ctx_batch_execute", partialResult: { n: updates } });
          }
          if (updates < 6) return;
          clearInterval(timer);
          if (behavior === "tool-active") {
            emit({ type: "tool_execution_end", toolCallId: "active-1", toolName: "ctx_batch_execute", result: {}, isError: false });
          }
          emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Completed on " + route + ".\\n\\nDELEGATE_RESULT: COMPLETED" }] } });
          emit({ type: "agent_end", willRetry: false });
          emit({ type: "agent_settled" });
        }, 40);
        continue;
      }

      if (behavior === "tool-unavailable") {
        emit({ type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "fixture" } });
      }
      if (behavior === "unavailable" || behavior === "credit" || behavior === "tool-unavailable" || (behavior === "missing-provider" && round === 2)) {
        emit({ type: "message_update", assistantMessageEvent: {
          type: "error",
          errorMessage: behavior === "credit" ? "credit balance depleted PRIVATE" : "503 Service unavailable",
        } });
        emit({ type: "agent_end", willRetry: false });
        emit({ type: "agent_settled" });
        continue;
      }
      if ((behavior === "missing-recover" || behavior === "missing-provider") && round === 1) {
        emit({ type: "agent_end", willRetry: false });
        emit({ type: "agent_settled" });
        continue;
      }
      if (behavior === "mutate-existing") writeFileSync("existing-untracked.txt", "after");
      const text = behavior === "blocked"
        ? "Blocked on evidence.\\n\\nDELEGATE_RESULT: BLOCKED"
        : behavior === "failed"
          ? "Failed.\\n\\nDELEGATE_RESULT: FAILED"
          : behavior === "custom"
            ? (round === 2 && recoveryReportText !== null ? recoveryReportText : customReportText)
            : "Completed on " + route + ".\\n\\nDELEGATE_RESULT: COMPLETED";
      emit({
        type: "message_end",
        message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] },
      });
      emit({ type: "agent_end", willRetry: false });
      emit({ type: "agent_settled" });
    }
  });
}
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  return { root, invocation: { command: process.execPath, prefixArgs: [script] }, spawnMarkerPath };
}

function baseOptions(
  fixture: { readonly invocation: { command: string; prefixArgs: string[] }; readonly root: string },
  extra: Partial<RunOptions> = {},
): RunOptions {
  return {
    role: "solution-a",
    prompt: "Investigate the fixture without editing it.",
    cwd: fixture.root,
    piInvocation: fixture.invocation,
    activityWarningMs: 200,
    activityIdleMs: 800,
    progressWarningMs: 1500,
    progressStallMs: 4000,
    reportRecoveryIdleMs: 800,
    graceMs: 100,
    ...extra,
  };
}

/**
 * A validated config whose Oracle profile has two ordered tiers, so the
 * second tier model is reachable only through Oracle fallback.
 */
function twoTierOracleRoutingConfig() {
  return validateRoutingConfig({
    version: 2,
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    disabledProviders: [],
    models: {
      "model-x": { providers: { "prov-a": { thinking: ["low", "high", "max"], default: "max" } } },
      "model-y": { providers: { "prov-a": { thinking: ["low"], default: "low" } } },
    },
    profiles: {
      "two-tier-oracle": {
        overridePolicy: "rejected",
        tiers: [
          { model: "model-x", thinking: "high", providers: ["prov-a"] },
          { model: "model-y", thinking: "low", providers: ["prov-a"] },
        ],
      },
    },
    assignments: uniformAssignments("two-tier-oracle"),
  });
}

/**
 * Version-2 assignments mapping every derived role to one shared profile,
 * mirroring the shipped gate shape (six solution slots, five review slots).
 */
function uniformAssignments(profile: string) {
  return {
    solution: Array.from({ length: 6 }, () => profile),
    review: Array.from({ length: 5 }, () => profile),
    implementation: profile,
    remediation: profile,
    verification: profile,
    oracle: profile,
  };
}

/**
 * A validated config whose every role maps to one shared two-tier profile
 * with exactly one provider per tier, so the generic operational-fallback
 * tests get a deterministic two-route chain without depending on a shipped
 * multi-provider pool's random primary draw.
 */
function twoTierRoutingConfig() {
  return validateRoutingConfig({
    version: 2,
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    disabledProviders: [],
    models: {
      "model-x": { providers: { "prov-a": { thinking: ["low", "high", "max"], default: "high" } } },
      "model-y": { providers: { "prov-b": { thinking: ["low", "high", "max"], default: "high" } } },
    },
    profiles: {
      "two-tier": {
        overridePolicy: "rejected",
        tiers: [
          { model: "model-x", thinking: "high", providers: ["prov-a"] },
          { model: "model-y", thinking: "high", providers: ["prov-b"] },
        ],
      },
    },
    assignments: uniformAssignments("two-tier"),
  });
}

async function isGone(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

/** Safety net so a failing deadline assertion can never leak a fixture process. */
function killOwned(...pids: number[]): void {
  for (const pid of pids) {
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    for (const target of [pid, -pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // Already dead or already reaped.
      }
    }
  }
}

/**
 * Waits until the fixture records its process group, so safety kills hold
 * exact pids even when the awaited call later hangs on a regression.
 */
async function waitForFixtureGroup(
  root: string,
  fileName: string,
): Promise<{ leader: number; descendant: number }> {
  const filePath = path.join(root, fileName);
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const recorded = await readFile(filePath, "utf8")
      .then((text) => JSON.parse(text) as { leader: number; descendant: number })
      .catch(() => undefined);
    if (
      recorded !== undefined
      && Number.isSafeInteger(recorded.leader) && recorded.leader > 0
      && Number.isSafeInteger(recorded.descendant) && recorded.descendant > 0
    ) {
      return recorded;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the fixture never recorded its process group in ${fileName}`);
}

/**
 * Fake Pi whose catalog preflight and supervision can each hang while the
 * whole process group resists SIGTERM: the hanging leader traps SIGTERM and
 * spawns a descendant that traps it too and inherits the leader's stdio
 * pipes, so only SIGKILL ends the group and the runner-side close event
 * stays blocked until the whole group is dead. The second route's children
 * record, at their own spawn time, whether the first route's group was
 * already gone, which proves no two route process groups ever overlap.
 */
async function resistantPi(options: {
  readonly catalogHangRoute?: string;
  readonly supervisionHangRoute?: string;
}): Promise<{ root: string; invocation: { command: string; prefixArgs: string[] } }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-runner-resistant-"));
  fixtureRoots.push(root);
  const script = path.join(root, "fake-pi-resistant.mjs");
  await writeFile(script, `
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const groupGone = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; } catch { return true; }
};
// Second-route children record the liveness of the first route's group at
// their own spawn time. Route-one children find no group file and skip.
const record = (phase) => {
  let group;
  try { group = JSON.parse(readFileSync("resistant-group.json", "utf8")); } catch { return; }
  let seen = {};
  try { seen = JSON.parse(readFileSync("route-two-start.json", "utf8")); } catch {}
  seen[phase] = { leaderGone: groupGone(group.leader), descendantGone: groupGone(group.descendant) };
  writeFileSync("route-two-start.json", JSON.stringify(seen));
};
// The hanging leader becomes SIGTERM-resistant and spawns a SIGTERM-resistant
// descendant in the same process group.
const hangResistently = () => {
  process.on("SIGTERM", () => {});
  const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: "inherit" });
  writeFileSync("resistant-group.json", JSON.stringify({ leader: process.pid, descendant: -1 }));
  descendant.on("spawn", () => {
    writeFileSync("resistant-group.json", JSON.stringify({ leader: process.pid, descendant: descendant.pid }));
  });
};
if (args.includes("--list-models")) {
  const route = args[args.indexOf("--list-models") + 1];
  if (route === ${JSON.stringify(options.catalogHangRoute ?? null)}) {
    hangResistently();
    setInterval(() => {}, 1000);
  } else {
    record("catalog");
    const separator = route.indexOf("/");
    const provider = route.slice(0, separator);
    const model = route.slice(separator + 1);
    console.log("provider model context max-out thinking images");
    console.log(provider + " " + model + " 272K 128K yes yes");
    process.exit(0);
  }
} else {
  const provider = args[args.indexOf("--provider") + 1];
  const model = args[args.indexOf("--model") + 1];
  const route = provider + "/" + model;
  const emit = (event) => console.log(JSON.stringify(event));
  if (route === ${JSON.stringify(options.supervisionHangRoute ?? null)}) {
    hangResistently();
    let buffer = "";
    process.stdin.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\\n")) {
        const newline = buffer.indexOf("\\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const command = JSON.parse(line);
        if (command.type !== "prompt") continue;
        emit({ id: command.id, type: "response", command: "prompt", success: true });
        emit({ type: "agent_start" });
        // Hang with no further lifecycle events.
      }
    });
  } else {
    record("supervision");
    let buffer = "";
    process.stdin.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\\n")) {
        const newline = buffer.indexOf("\\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const command = JSON.parse(line);
        if (command.type !== "prompt") continue;
        emit({ id: command.id, type: "response", command: "prompt", success: true });
        emit({ type: "agent_start" });
        emit({
          type: "message_end",
          message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Completed on " + route + ".\\n\\nDELEGATE_RESULT: COMPLETED" }] },
        });
        emit({ type: "agent_end", willRetry: false });
        emit({ type: "agent_settled" });
      }
    });
  }
}
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  await execFileAsync(process.execPath, ["--check", script]);
  return { root, invocation: { command: process.execPath, prefixArgs: [script] } };
}

/**
 * Fake Pi whose catalog or supervision leader exits immediately while a
 * descendant that inherited its stdio pipes stays in the process group. The
 * descendant traps SIGTERM, so the leader is gone but the runner-side close
 * event stays blocked. Second-route children record first-route liveness.
 */
async function inheritedStdioPi(options: {
  readonly catalogExitRoute?: string;
  readonly supervisionExitRoute?: string;
}): Promise<{ root: string; invocation: { command: string; prefixArgs: string[] } }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-runner-inherited-"));
  fixtureRoots.push(root);
  const script = path.join(root, "fake-pi-inherited.mjs");
  await writeFile(script, `
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const groupGone = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; } catch { return true; }
};
// Second-route children record the liveness of the first route's group at
// their own spawn time. Route-one children find no group file and skip.
const record = (phase) => {
  let group;
  try { group = JSON.parse(readFileSync("inherited-group.json", "utf8")); } catch { return; }
  let seen = {};
  try { seen = JSON.parse(readFileSync("route-two-start.json", "utf8")); } catch {}
  seen[phase] = { leaderGone: groupGone(group.leader), descendantGone: groupGone(group.descendant) };
  writeFileSync("route-two-start.json", JSON.stringify(seen));
};
if (args.includes("--list-models")) {
  const route = args[args.indexOf("--list-models") + 1];
  if (route === ${JSON.stringify(options.catalogExitRoute ?? null)}) {
    // The descendant inherits this child's stdout and stderr pipes and traps
    // SIGTERM; the leader exits once the descendant pid is recorded, so only
    // the descendant keeps the runner-side close event blocked.
    const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: "inherit" });
    writeFileSync("inherited-group.json", JSON.stringify({ leader: process.pid, descendant: -1 }));
    descendant.on("spawn", () => {
      writeFileSync("inherited-group.json", JSON.stringify({ leader: process.pid, descendant: descendant.pid }));
      process.exit(0);
    });
    setInterval(() => {}, 1000);
  } else {
    record("catalog");
    const separator = route.indexOf("/");
    const provider = route.slice(0, separator);
    const model = route.slice(separator + 1);
    console.log("provider model context max-out thinking images");
    console.log(provider + " " + model + " 272K 128K yes yes");
    process.exit(0);
  }
} else {
  const provider = args[args.indexOf("--provider") + 1];
  const model = args[args.indexOf("--model") + 1];
  const route = provider + "/" + model;
  if (route === ${JSON.stringify(options.supervisionExitRoute ?? null)}) {
    const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: "inherit" });
    writeFileSync("inherited-group.json", JSON.stringify({ leader: process.pid, descendant: -1 }));
    descendant.on("spawn", () => {
      writeFileSync("inherited-group.json", JSON.stringify({ leader: process.pid, descendant: descendant.pid }));
      process.exit(0);
    });
  } else {
    record("supervision");
    const emit = (event) => console.log(JSON.stringify(event));
    let buffer = "";
    process.stdin.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\\n")) {
        const newline = buffer.indexOf("\\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const command = JSON.parse(line);
        if (command.type !== "prompt") continue;
        emit({ id: command.id, type: "response", command: "prompt", success: true });
        emit({ type: "agent_start" });
        emit({
          type: "message_end",
          message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Completed on " + route + ".\\n\\nDELEGATE_RESULT: COMPLETED" }] },
        });
        emit({ type: "agent_end", willRetry: false });
        emit({ type: "agent_settled" });
      }
    });
  }
}
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  await execFileAsync(process.execPath, ["--check", script]);
  return { root, invocation: { command: process.execPath, prefixArgs: [script] } };
}

test("classifies exactly the operational failure states as fallback-eligible", () => {
  for (const state of [
    "provider_failed", "stalled", "output_limit", "prompt_rejected",
    "invalid_result", "invalid_stream", "missing_report", "child_failed", "spawn_failed",
  ]) {
    assert.equal(isOperationalFailureState(state as never), true, state);
  }
  // Completed runs, intentional delegate outcomes, interruption, catalog
  // skips, and unproven process-group cleanup never take the operational
  // fallback path.
  for (const state of ["completed", "blocked", "delegate_failed", "timed_out", "interrupted", "catalog_unavailable", "cleanup_failed"]) {
    assert.equal(isOperationalFailureState(state as never), false, state);
  }
});

test("skips an uncatalogued primary and completes on a fresh fallback route", async () => {
  const fixture = await fakePi(
    ["prov-b/model-y"],
    { "prov-b/model-y": "complete" },
  );
  const updates: string[] = [];
  const toolResult = await runAndFinalize(
    baseOptions(fixture, {
      role: "solution-c",
      routingConfig: twoTierRoutingConfig(),
      onProgress: (progress) => updates.push(`${progress.lastEvent}@${progress.lastEventAt}`),
    }),
    async (result, finalize) => {
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "prov-b/model-y:high");
      assert.equal(result.attempts[0]?.state, "catalog_unavailable");
      assert.match(result.report, /Completed on prov-b\/model-y/);
      assert.ok(updates.some((update) => update.startsWith("agent_settled@")));
      assert.match(result.startedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(result.endedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(result.streamErrors, []);
      assert.equal("artifactDir" in (result.attempts[0] ?? {}), false);
      // The outcome returns in memory: no chain-level report.md or status.json is
      // written, and the temporary supervision artifacts survive until
      // execute-level finalization so the caller can act on them.
      await stat(result.artifactDir);
      await assert.rejects(() => stat(path.join(result.artifactDir, "status.json")), enoent);
      await assert.rejects(() => stat(path.join(result.artifactDir, "report.md")), enoent);
      const toolResult = await finalize();
      // After execute-level assembly every temporary artifact is gone.
      await assert.rejects(() => stat(result.artifactDir), enoent);
      return toolResult;
    },
  );
  assert.match(toolResult.content[0]!.text, /## Delegate solution-c completed/);
  assert.equal("diagnosticPath" in (toolResult.details ?? {}), false);
  assert.doesNotMatch(JSON.stringify(toolResult), /delegated-pi-solution-c/);
});

test("falls back after pre-tool provider unavailability", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-b/model-y"],
    {
      "prov-a/model-x": "unavailable",
      "prov-b/model-y": "complete",
    },
  );
  await runAndFinalize(baseOptions(fixture, { role: "solution-c", routingConfig: twoTierRoutingConfig() }), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.selectedRoute, "prov-b/model-y:high");
    assert.equal(result.attempts[0]?.state, "provider_failed");
    assert.equal(result.attempts[0]?.restartAfterWork, undefined);
    assert.equal(result.progress.restartAfterWorkCount, 0);
  });
});

test("credit exhaustion before tools advances without consuming report recovery", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-b/model-y"],
    {
      "prov-a/model-x": "credit",
      "prov-b/model-y": "complete",
    },
  );
  await runAndFinalize(baseOptions(fixture, { role: "solution-c", routingConfig: twoTierRoutingConfig() }), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.attempts[0]?.state, "provider_failed");
    assert.equal(result.progress.reportNudgeCount, 0);
  });
});

test("an exhausted operational chain ends as routes_unavailable", async () => {
  const catalog = [
    "prov-a/model-x",
    "prov-b/model-y",
  ];
  const behaviors = Object.fromEntries(catalog.map((route) => [route, "credit"])) as Record<string, Behavior>;
  const fixture = await fakePi(catalog, behaviors);
  const toolResult = await runAndFinalize(baseOptions(fixture, { role: "solution-c", routingConfig: twoTierRoutingConfig() }), async (result, finalize) => {
    assert.equal(result.state, "routes_unavailable");
    assert.equal(result.attempts.length, 2);
    assert.ok(result.attempts.every((attempt) => attempt.state === "provider_failed"));
    assert.equal(result.report, "");
    // The routes_unavailable failure diagnostic is persisted under the owned
    // diagnostics root injected for this test process, never in the user's
    // real agent logs directory.
    const diagnosticsDirectory = path.join(ownedDiagnosticsRoot, "logs", "delegated-pi-loop");
    const before = await readdir(diagnosticsDirectory).catch(() => [] as string[]);
    const toolResult = await finalize();
    const created = (await readdir(diagnosticsDirectory)).filter((entry) => !before.includes(entry));
    assert.equal(created.length, 1, "exactly one routes_unavailable diagnostic must be written");
    assert.match(created[0]!, /^failure-solution-c-/);
    const diagnosticPath = toolResult.details?.diagnosticPath;
    assert.equal(typeof diagnosticPath, "string");
    assert.ok((diagnosticPath as string).startsWith(diagnosticsDirectory + path.sep));
    return toolResult;
  });
  assert.equal(toolResult.details?.state, "routes_unavailable");
});

test("one route attempt can recover in the same session without fallback", async () => {
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    {
      "opencode-go/muse-spark-1.2-contributor": "missing-recover",
    },
  );
  await runAndFinalize(baseOptions(fixture), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.selectedRoute, "opencode-go/muse-spark-1.2-contributor:xhigh");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.progress.reportNudgeCount, 1);
    assert.equal(result.progress.reportRound, 2);
  });
});

test("operational failure after accepted report recovery falls back with the restart note", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-b/model-y"],
    {
      "prov-a/model-x": "missing-provider",
      "prov-b/model-y": "complete",
    },
  );
  await runAndFinalize(baseOptions(fixture, { role: "solution-c", routingConfig: twoTierRoutingConfig() }), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.selectedRoute, "prov-b/model-y:high");
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0]?.state, "provider_failed");
    // Recovery was accepted on the first route, so the restart note was applied.
    assert.equal(result.attempts[0]?.restartAfterWork, true);
    assert.equal(result.progress.restartAfterWorkCount, 1);
    assert.match(result.report, /Completed on prov-b\/model-y/);
    const prompt = await readFile(path.join(result.artifactDir, "prompt.md"), "utf8");
    assert.equal(prompt.split(RESTART_AFTER_WORK_NOTE).length - 1, 1);
  });
});

test("operational failure after tool execution falls back with the restart note", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-b/model-y"],
    {
      "prov-a/model-x": "tool-unavailable",
      "prov-b/model-y": "complete",
    },
  );
  await runAndFinalize(baseOptions(fixture, { role: "solution-c", routingConfig: twoTierRoutingConfig() }), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.selectedRoute, "prov-b/model-y:high");
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0]?.state, "provider_failed");
    assert.equal(result.attempts[0]?.restartAfterWork, true);
    assert.equal(result.progress.restartAfterWorkCount, 1);
    assert.match(result.report, /Completed on prov-b\/model-y/);
    // Failure data returns in memory: no chain-level status.json exists and the
    // temporary artifacts survive until execute-level finalization.
    await stat(result.artifactDir);
    await assert.rejects(() => stat(path.join(result.artifactDir, "status.json")), enoent);
  });
});

test("the restart note is private, sanitized, and never stacks across restarts", async () => {
  const catalog = [
    "prov-a/model-x",
    "prov-b/model-y",
  ];
  const behaviors: Record<string, Behavior> = {
    "prov-a/model-x": "tool-unavailable",
    "prov-b/model-y": "complete",
  };
  const fixture = await fakePi(catalog, behaviors);
  await runAndFinalize(baseOptions(fixture, { role: "solution-c", routingConfig: twoTierRoutingConfig() }), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0]?.restartAfterWork, true);
    assert.equal(result.attempts[1]?.restartAfterWork, undefined);
    assert.equal(result.progress.restartAfterWorkCount, 1);
    const prompt = await readFile(path.join(result.artifactDir, "prompt.md"), "utf8");
    // One advance happened, but the note is rebuilt from the original
    // assignment and appears exactly once.
    assert.equal(prompt.split(RESTART_AFTER_WORK_NOTE).length - 1, 1);
    // The rewritten private prompt never carries provider errors, raw output,
    // failed route identity, tool payloads, or diagnostics text beyond the
    // standard terminal marker contract every delegate prompt already has.
    for (const forbidden of [
      "503", "PRIVATE", "Service unavailable", "credit", "muse-spark", "agentrouter",
      "provider_failed", "tool_execution",
    ]) {
      assert.ok(!prompt.includes(forbidden), `restart prompt must not contain "${forbidden}"`);
    }
  });
});

test("intentional BLOCKED and FAILED delegate outcomes stay terminal without fallback", async () => {
  for (const [behavior, expectedState] of [["blocked", "blocked"], ["failed", "delegate_failed"]] as const) {
    const fixture = await fakePi(
      ["opencode-go/muse-spark-1.2-contributor"],
      {
        "opencode-go/muse-spark-1.2-contributor": behavior,
      },
    );
    await runAndFinalize(baseOptions(fixture), async (result) => {
      assert.equal(result.state, expectedState);
      assert.equal(result.attempts.length, 1);
      assert.equal(result.selectedRoute, "opencode-go/muse-spark-1.2-contributor:xhigh");
      assert.match(result.report, /DELEGATE_RESULT: (BLOCKED|FAILED)/);
      assert.equal(result.progress.restartAfterWorkCount, 0);
      // Legacy bare markers keep their terminal outcome with unspecified reason.
      assert.equal(result.delegateOutcome, behavior === "blocked" ? "blocked" : "failed");
      assert.equal(result.terminalReason, "unspecified");
      assert.equal(result.reasonStatus, "missing");
      assert.equal(result.blockedMisuseSuspected, undefined);
    });
  }
});

test("accepted reason codes propagate typed through result, progress, details, and Markdown", async () => {
  const cases = [
    ["Blocked.\n\nDELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT: BLOCKED", "blocked", "blocked", "budget_exhausted", false],
    ["Blocked.\n\nDELEGATE_REASON: finding_reported\nDELEGATE_RESULT: BLOCKED", "blocked", "blocked", "finding_reported", true],
    ["Failed.\n\nDELEGATE_REASON: execution_failure\nDELEGATE_RESULT: FAILED", "delegate_failed", "failed", "execution_failure", undefined],
  ] as const;
  for (const [reportText, expectedState, outcome, reason, misuse] of cases) {
    const fixture = await fakePi(
      ["opencode-go/muse-spark-1.2-contributor"],
      {
        "opencode-go/muse-spark-1.2-contributor": "custom",
      },
      { reportText },
    );
    const toolResult = await runAndFinalize(baseOptions(fixture), async (result, finalize) => {
      assert.equal(result.state, expectedState, reason);
      // The intentional outcome stays terminal: one attempt, no fallback.
      assert.equal(result.attempts.length, 1, reason);
      assert.equal(result.selectedRoute, "opencode-go/muse-spark-1.2-contributor:xhigh", reason);
      assert.equal(result.delegateOutcome, outcome, reason);
      assert.equal(result.terminalReason, reason, reason);
      assert.equal(result.reasonStatus, "accepted", reason);
      assert.equal(result.blockedMisuseSuspected, misuse, reason);
      assert.equal(result.progress.terminalReason, reason, reason);
      assert.equal(result.progress.reasonStatus, "accepted", reason);
      assert.equal(result.progress.blockedMisuseSuspected, misuse, reason);
      return finalize();
    });
    assert.equal(toolResult.details?.terminalReason, reason, reason);
    assert.equal(toolResult.details?.reasonStatus, "accepted", reason);
    assert.equal(toolResult.details?.blockedMisuseSuspected, misuse, reason);
    assert.match(toolResult.content[0]!.text, new RegExp(`^- terminal reason: ${reason}$`, "m"), reason);
  }
});

test("missing or rejected reasons never change BLOCKED and FAILED terminality or trigger fallback", async () => {
  const cases = [
    // Legacy bare marker: reason missing.
    ["Blocked.\n\nDELEGATE_RESULT: BLOCKED", "blocked", "missing"],
    // Rejected reason values: path-like, credential-like, and unknown code.
    ["Blocked.\n\nDELEGATE_REASON: /home/gc/SECRET-PATH/tok\nDELEGATE_RESULT: BLOCKED", "blocked", "rejected"],
    ["Failed.\n\nDELEGATE_REASON: sk-RAWTOKEN99\nDELEGATE_RESULT: FAILED", "delegate_failed", "rejected"],
    ["Failed.\n\nDELEGATE_REASON: not_a_real_code\nDELEGATE_RESULT: FAILED", "delegate_failed", "rejected"],
  ] as const;
  for (const [reportText, expectedState, reasonStatus] of cases) {
    const fixture = await fakePi(
      ["opencode-go/muse-spark-1.2-contributor"],
      {
        "opencode-go/muse-spark-1.2-contributor": "custom",
      },
      { reportText },
    );
    await runAndFinalize(baseOptions(fixture), async (result) => {
      assert.equal(result.state, expectedState, reportText);
      // The intentional terminal outcome stands and no route advances solely
      // because the reason is missing or rejected.
      assert.equal(result.attempts.length, 1, reportText);
      assert.equal(result.terminalReason, "unspecified", reportText);
      assert.equal(result.reasonStatus, reasonStatus, reportText);
      assert.equal(result.blockedMisuseSuspected, undefined, reportText);
    });
  }
});

test("a COMPLETED-with-reason response follows invalid-result recovery on the same route", async () => {
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    { "opencode-go/muse-spark-1.2-contributor": "custom" },
    {
      reportText: "Done.\n\nDELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT: COMPLETED",
      recoveryReportText: "Recovered.\n\nDELEGATE_RESULT: COMPLETED",
    },
  );
  const toolResult = await runAndFinalize(baseOptions(fixture), async (result, finalize) => {
    assert.equal(result.state, "completed");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.state, "completed");
    assert.equal(result.progress.reportRound, 2);
    assert.equal(result.progress.reportRecoveryReason, "invalid_result");
    assert.equal(result.delegateOutcome, "completed");
    assert.equal(result.terminalReason, undefined);
    assert.equal(result.reasonStatus, undefined);
    return finalize();
  });
  assert.match(toolResult.content[0]!.text, /## Delegate solution-a completed/);
});

test("raw reason values never reach statuses, Markdown, details, or diagnostics", async () => {
  const reportText = "Blocked.\n\nDELEGATE_REASON: /home/gc/SECRET-PATH/sk-RAWTOKEN99\nDELEGATE_RESULT: BLOCKED";
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    { "opencode-go/muse-spark-1.2-contributor": "custom" },
    { reportText },
  );
  const toolResult = await runAndFinalize(baseOptions(fixture), async (result, finalize) => {
    assert.equal(result.state, "blocked");
    const progressText = JSON.stringify(result.progress);
    assert.doesNotMatch(progressText, /SECRET|RAWTOKEN/);
    // The persisted per-attempt status artifact carries the typed reason only.
    const attemptStatus = JSON.parse(
      await readFile(path.join(result.artifactDir, "attempt-01", "status.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(attemptStatus.schemaVersion, 1);
    assert.equal(attemptStatus.delegateOutcome, "blocked");
    assert.equal(attemptStatus.terminalReason, "unspecified");
    assert.equal(attemptStatus.reasonStatus, "rejected");
    assert.doesNotMatch(JSON.stringify(attemptStatus), /SECRET|RAWTOKEN|DELEGATE_REASON/);
    return finalize();
  });
  const markdown = toolResult.content[0]!.text;
  assert.match(markdown, /- terminal reason: unspecified \(rejected\)/);
  assert.match(markdown, /The terminal reason line was invalid and was discarded; the outcome stands\./);
  assert.doesNotMatch(markdown, /SECRET|RAWTOKEN|DELEGATE_REASON/);
  const detailsText = JSON.stringify(toolResult.details);
  assert.doesNotMatch(detailsText, /SECRET|RAWTOKEN/);
  const diagnosticPath = toolResult.details?.diagnosticPath;
  assert.equal(typeof diagnosticPath, "string");
  const diagnostic = JSON.parse(await readFile(diagnosticPath as string, "utf8")) as Record<string, unknown>;
  assert.equal(diagnostic.schemaVersion, 6);
  assert.equal(diagnostic.delegateOutcome, "blocked");
  assert.equal(diagnostic.terminalReason, "unspecified");
  assert.equal(diagnostic.reasonStatus, "rejected");
  assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET|RAWTOKEN|DELEGATE_REASON/);
});

test("an interrupted run stays terminal without attempts or fallback", async () => {
  const fixture = await fakePi(["openai-codex/gpt-5.5"], { "openai-codex/gpt-5.5": "complete" });
  const controller = new AbortController();
  controller.abort();
  await runAndFinalize(
    baseOptions(fixture, { role: "solution-d", signal: controller.signal }),
    async (result) => {
      assert.equal(result.state, "interrupted");
      assert.equal(result.attempts.length, 0);
      assert.equal(result.report, "");
    },
  );
});

test("D draws one random primary per invocation and records the ordered chain", async () => {
  const fixture = await fakePi(
    ["openai-codex/gpt-5.5"],
    { "openai-codex/gpt-5.5": "complete" },
  );
  let randomCalls = 0;
  const toolResult = await runAndFinalize(
    baseOptions(fixture, {
      role: "solution-d",
      // The injected draw picks the primary; no provider preference exists.
      random: () => {
        randomCalls += 1;
        return 0.4; // floor(0.4 * 9) = 3 -> openai-codex-cgpt2 primary
      },
    }),
    async (result, finalize) => {
      assert.equal(randomCalls, 1);
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "openai-codex/gpt-5.5:high");
      // The uncatalogued random primary is skipped by catalog preflight; the
      // selected and remaining routes return through the existing attempt chain.
      assert.deepEqual(result.attempts.map((attempt) => attempt.route), [
        "openai-codex-cgpt2/gpt-5.5:high",
        "openai-codex/gpt-5.5:high",
      ]);
      assert.equal(result.attempts[0]?.state, "catalog_unavailable");
      return finalize();
    },
  );
  assert.match(toolResult.content[0]!.text, /## Delegate solution-d completed/);
});

test("an eligible former parent provider no longer pins the primary", async () => {
  const fixture = await fakePi(
    ["openai-codex-cgpt4/gpt-5.5"],
    { "openai-codex-cgpt4/gpt-5.5": "complete" },
  );
  let randomCalls = 0;
  await runAndFinalize(
    baseOptions(fixture, {
      role: "review-d",
      prompt: "Review only.",
      // openai-codex-cgpt4 is eligible for the tier, but no parent-provider
      // preference exists: the draw alone picks the primary, so the pinned
      // zero draw makes openai-codex the primary and cgpt4 is reached only
      // through the stable fallback order.
      random: () => {
        randomCalls += 1;
        return 0;
      },
    }),
    async (result) => {
      assert.equal(randomCalls, 1);
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "openai-codex-cgpt4/gpt-5.5:high");
      assert.equal(result.attempts[0]?.route, "openai-codex/gpt-5.5:high");
      assert.equal(result.attempts[0]?.state, "catalog_unavailable");
      // The chain reaches cgpt4 sixth: the drawn primary plus four skipped
      // uncatalogued fallbacks come first, proving no parent-preference shortcut.
      assert.equal(result.attempts.length, 6);
      assert.equal(result.attempts[5]?.route, "openai-codex-cgpt4/gpt-5.5:high");
      assert.match(result.report, /Completed on openai-codex-cgpt4\/gpt-5\.5/);
    },
  );
});

test("oracle records its fallback chain", async () => {
  const fixture = await fakePi(
    ["openai-codex/gpt-5.6-sol"],
    { "openai-codex/gpt-5.6-sol": "complete" },
  );
  let randomCalls = 0;
  const toolResult = await runAndFinalize(
    baseOptions(fixture, {
      role: "oracle",
      prompt: "Review the draft contract without editing it.",
      random: () => {
        randomCalls += 1;
        return 0.4; // floor(0.4 * 9) = 3 -> openai-codex-cgpt2 primary
      },
    }),
    async (result, finalize) => {
      assert.equal(randomCalls, 1);
      assert.equal(result.label, "oracle");
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "openai-codex/gpt-5.6-sol:high");
      // The uncatalogued random primary is skipped by catalog preflight; the
      // remaining canonical routes return through the existing attempt chain.
      assert.deepEqual(result.attempts.map((attempt) => attempt.route), [
        "openai-codex-cgpt2/gpt-5.6-sol:high",
        "openai-codex/gpt-5.6-sol:high",
      ]);
      assert.equal(result.attempts[0]?.state, "catalog_unavailable");
      assert.match(result.report, /Completed on openai-codex\/gpt-5\.6-sol/);
      return finalize();
    },
  );
  assert.match(toolResult.content[0]!.text, /## Delegate oracle completed/);
});

test("a main-Sol parent is rejected before any oracle child spawns on any provider", async () => {
  const fixture = await fakePi(
    ["openai-codex/gpt-5.6-sol"],
    { "openai-codex/gpt-5.6-sol": "complete" },
  );
  const base = baseOptions(fixture, {
    role: "oracle",
    prompt: "Review only.",
    // The skip fires even when the parent provider would be oracle-eligible:
    // detection reads the parent model id only, and delegate provider
    // selection never reads the parent provider at all.
    random: () => 0,
  });
  await assert.rejects(
    () => runDelegate({ ...base, parentModelId: "gpt-5.6-sol" }),
    (error: unknown) => {
      assert.match((error as Error).message, /Skip the oracle role.*gpt-5\.6-sol.*finalize the solution contract directly/);
      return true;
    },
  );
  // A non-Sol parent model proceeds through the same invocation.
  await runAndFinalize({ ...base, parentModelId: "gpt-5.5" }, async (result) => {
    assert.equal(result.state, "completed");
  });
});

test("a parent matching the second oracle tier model is rejected before artifacts or children", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x"],
    { "prov-a/model-x": "complete" },
    { spawnMarker: true },
  );
  assert.ok(fixture.spawnMarkerPath, "the spawn marker path must be set");
  const base = baseOptions(fixture, {
    role: "oracle",
    prompt: "Review only.",
    routingConfig: twoTierOracleRoutingConfig(),
  });
  // The two-model Oracle profile rejects a parent matching the second tier
  // before any artifact directory exists and before any child process spawns,
  // even though no provider pin ties the parent to the first tier.
  await assert.rejects(
    () => runDelegate({ ...base, parentModelId: "model-y" }),
    (error: unknown) => {
      assert.match(
        (error as Error).message,
        /Skip the oracle role.*parent session already runs model-y.*finalize the solution contract directly/,
      );
      return true;
    },
  );
  await assert.rejects(() => stat(fixture.spawnMarkerPath!), enoent);
  // The first tier model keeps rejecting under the same set contract.
  await assertCreatesNoArtifact(() => runDelegate({ ...base, parentModelId: "model-x" }));
  await assert.rejects(() => stat(fixture.spawnMarkerPath!), enoent);
  // Every nonmatching parent proceeds through the same invocation.
  for (const parentModelId of ["model-z", undefined] as const) {
    await runAndFinalize({ ...base, parentModelId }, async (result) => {
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "prov-a/model-x:high");
    });
  }
  // The proceeding runs did spawn children, so the marker proves the earlier
  // rejections were pre-spawn, not a broken fixture.
  await stat(fixture.spawnMarkerPath!);
});

/**
 * A validated single-tier single-provider config, so the role chain is
 * exactly one final route that owns the full cumulative remainder.
 */
function singleRouteRoutingConfig() {
  return validateRoutingConfig({
    version: 2,
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    disabledProviders: [],
    models: {
      "model-x": { providers: { "prov-a": { thinking: ["high"], default: "high" } } },
    },
    profiles: {
      solo: {
        overridePolicy: "rejected",
        tiers: [{ model: "model-x", thinking: "high", providers: ["prov-a"] }],
      },
    },
    assignments: uniformAssignments("solo"),
  });
}

function providerCountRoutingConfig(count: number) {
  const providers = Array.from({ length: count }, (_, index) => `prov-${index + 1}`);
  return validateRoutingConfig({
    version: 2,
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    disabledProviders: [],
    models: {
      "model-x": {
        providers: Object.fromEntries(providers.map((provider) => [provider, { thinking: ["high"], default: "high" }])),
      },
    },
    profiles: {
      counted: { overridePolicy: "rejected", tiers: [{ model: "model-x", thinking: "high", providers }] },
    },
    assignments: uniformAssignments("counted"),
  });
}

test("a delayed catalog preflight consumes no shared work budget", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x"],
    { "prov-a/model-x": "hang" },
    { catalogDelayMs: 700 },
  );
  await runAndFinalize(
    baseOptions(fixture, {
      routingConfig: singleRouteRoutingConfig(),
    }),
    async (result) => {
      // The delayed catalog preflight ran to completion inside its fixed cap
      // without consuming any shared work budget (none exists), so the
      // supervised child still received the full renewable liveness leases
      // and the single-route chain ends as the safe routes_unavailable.
      assert.equal(result.state, "routes_unavailable");
      assert.equal(result.deadlineCause, undefined);
      assert.equal(result.attempts.length, 1);
      assert.equal(result.attempts[0]?.state, "stalled");
      assert.equal(result.attempts[0]?.stallCause, "rpc_silent");
      assert.equal(result.attempts[0]?.route, "prov-a/model-x:high");
      assert.ok(result.attempts[0]!.elapsedSeconds >= 0.7, "the hanging child must receive the full idle lease");
      assert.ok(result.elapsedSeconds >= 1.4, "the delayed catalog preflight must have run in full");
    },
  );
});

test("one-route, nine-route, and added-provider configurations share no work budget field", async () => {
  for (const count of [1, 9, 10]) {
    const providers = Array.from({ length: count }, (_, index) => `prov-${index + 1}/model-x`);
    const fixture = await fakePi(providers, Object.fromEntries(providers.map((route) => [route, "complete"])));
    await runAndFinalize(baseOptions(fixture, {
      routingConfig: providerCountRoutingConfig(count),
      random: () => 0,
    }), async (result) => {
      assert.equal(result.state, "completed");
      assert.equal("workBudgetSeconds" in result, false);
      assert.equal("remainingWorkSecondsAtAttemptStart" in (result.attempts[0] ?? {}), false);
      assert.equal("timeoutMs" in baseOptions(fixture), false);
    });
  }
});

test("meaningful thinking and tool activity continue beyond the old one-ninth boundary without fallback", async () => {
  for (const behavior of ["thinking-active", "tool-active"] as const) {
    const providers = Array.from({ length: 9 }, (_, index) => `prov-${index + 1}/model-x`);
    const fixture = await fakePi(providers, {
      "prov-1/model-x": behavior,
      ...Object.fromEntries(providers.slice(1).map((route) => [route, "complete"])),
    }, { supervisionLog: true });
    await runAndFinalize(baseOptions(fixture, {
      routingConfig: providerCountRoutingConfig(9),
      activityWarningMs: 80,
      activityIdleMs: 140,
      random: () => 0,
    }), async (result) => {
      assert.equal(result.state, "completed", behavior);
      assert.equal(result.selectedRoute, "prov-1/model-x:high", behavior);
      assert.equal(result.attempts.length, 1, behavior);
      assert.ok(result.elapsedSeconds > 0.2, `activity must pass the old one-ninth boundary: ${result.elapsedSeconds}`);
      const spawned = await readFile(path.join(fixture.root, "supervision-routes.jsonl"), "utf8");
      assert.deepEqual(spawned.trim().split("\n"), ["prov-1/model-x"]);
    });
  }
});

test("a silent active tool propagates per-attempt idle telemetry through attempts and details", async () => {
  const fixture = await fakePi(["prov-1/model-x"], { "prov-1/model-x": "tool-silent" });
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: providerCountRoutingConfig(1),
    activityWarningMs: 80,
    activityIdleMs: 300,
    progressWarningMs: 1000,
    progressStallMs: 2000,
  }), async (result, finalize) => {
    assert.equal(result.attempts[0]?.state, "stalled");
    assert.equal(result.attempts[0]?.stallCause, "active_tool_idle");
    const attempt = result.attempts[0];
    assert.equal(attempt?.state, "stalled");
    assert.equal(attempt?.stallCause, "active_tool_idle");
    assert.equal(attempt?.activeToolCount, 1);
    assert.equal(attempt?.activeToolName, "ctx_batch_execute");
    assert.ok(attempt?.activeToolIdleSeconds !== undefined && attempt.activeToolIdleSeconds >= 0.2,
      `attempt idle telemetry must travel, got ${attempt?.activeToolIdleSeconds}`);
    const toolResult = await finalize();
    const details = toolResult.details as { attempts?: readonly Record<string, unknown>[] };
    const sanitized = details.attempts?.[0];
    assert.equal(sanitized?.activeToolName, "ctx_batch_execute");
    assert.equal(sanitized?.activeToolIdleSeconds, attempt?.activeToolIdleSeconds);
  });
});

test("catalog-only attempts stay without active tool idle telemetry", async () => {
  const fixture = await fakePi(
    ["prov-1/model-x", "prov-2/model-x"],
    { "prov-1/model-x": "complete", "prov-2/model-x": "complete" },
    { catalogDelayMs: 500, catalogDelayRoute: "prov-1/model-x" },
  );
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: providerCountRoutingConfig(2),
    catalogTimeoutMs: 100,
    random: () => 0,
  }), async (result) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["timed_out", "completed"]);
    // The catalog attempt never carries the field, and the completed
    // attempt had no active tool, so both stay without a finite value.
    assert.equal(result.attempts[0]?.activeToolIdleSeconds, undefined);
    assert.equal(result.attempts[1]?.activeToolIdleSeconds, undefined);
  });
});

test("catalog-only attempts omit every supervised liveness field", async () => {
  const fixture = await fakePi(
    ["prov-1/model-x", "prov-2/model-x"],
    { "prov-1/model-x": "complete", "prov-2/model-x": "complete" },
    { catalogDelayMs: 500, catalogDelayRoute: "prov-1/model-x" },
  );
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: providerCountRoutingConfig(2),
    catalogTimeoutMs: 100,
    random: () => 0,
  }), async (result, finalize) => {
    assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["timed_out", "completed"]);
    const supervisedKeys = [
      "stallCause",
      "rpcIdleSeconds",
      "activityIdleSeconds",
      "progressIdleSeconds",
      "activityEventCount",
      "structuralProgressCount",
      "duplicateCheckpointCount",
      "activityWarningCount",
      "progressWarningCount",
      "activeToolIdleSeconds",
    ] as const;
    // The catalog-only timed_out attempt fabricates no supervised evidence.
    for (const key of supervisedKeys) {
      assert.equal(result.attempts[0]?.[key], undefined, key);
    }
    const toolResult = await finalize();
    const details = toolResult.details as { attempts?: readonly Record<string, unknown>[] };
    const sanitizedCatalog = details.attempts?.[0] as Record<string, unknown>;
    for (const key of supervisedKeys) {
      assert.equal(key in sanitizedCatalog, false, key);
    }
  });
});

test("route-one supervised liveness evidence survives a completed final-route fallback", async () => {
  const fixture = await fakePi(
    ["prov-1/model-x", "prov-2/model-x"],
    { "prov-1/model-x": "tool-silent", "prov-2/model-x": "complete" },
  );
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: providerCountRoutingConfig(2),
    random: () => 0,
    activityWarningMs: 80,
    activityIdleMs: 300,
    progressWarningMs: 1000,
    progressStallMs: 2000,
  }), async (result, finalize) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["stalled", "completed"]);
    const stalled = result.attempts[0]!;
    // Every §13.2 field that settled on the stalled route-one attempt
    // travels on the chain attempt after fallback.
    assert.equal(stalled.stallCause, "active_tool_idle");
    assert.equal(stalled.deadlineCause, "idle_deadline");
    assert.ok(stalled.rpcIdleSeconds !== undefined && Number.isFinite(stalled.rpcIdleSeconds), "rpc idle evidence");
    assert.ok(stalled.activityIdleSeconds !== undefined && stalled.activityIdleSeconds >= 0.2, "activity idle evidence");
    assert.ok(stalled.progressIdleSeconds !== undefined && Number.isFinite(stalled.progressIdleSeconds), "progress idle evidence");
    assert.ok(stalled.activityEventCount !== undefined && stalled.activityEventCount >= 1, "activity counter evidence");
    assert.ok(stalled.structuralProgressCount !== undefined && stalled.structuralProgressCount >= 1, "progress counter evidence");
    assert.equal(stalled.duplicateCheckpointCount, 0);
    assert.equal(stalled.activityWarningCount, 1);
    assert.equal(stalled.progressWarningCount, 0);
    assert.ok(stalled.activeToolIdleSeconds !== undefined && stalled.activeToolIdleSeconds >= 0.2, "active tool idle evidence");
    // The completed attempt carries its own settled supervised telemetry.
    const completed = result.attempts[1]!;
    assert.ok(completed.activityEventCount !== undefined && completed.activityEventCount >= 2);
    assert.ok(completed.structuralProgressCount !== undefined && completed.structuralProgressCount >= 1);
    assert.equal(completed.duplicateCheckpointCount, 0);
    assert.ok(completed.rpcIdleSeconds !== undefined && completed.rpcIdleSeconds < stalled.rpcIdleSeconds!);
    // Final progress stays tied to the final route, never to route one.
    assert.equal(result.progress.route, completed.route);
    assert.equal(result.selectedRoute, completed.route);
    assert.equal(result.progress.state, "completed");
    assert.equal(result.progress.attempt, 2);
    assert.ok(result.progress.activityEventCount === completed.activityEventCount);
    // Sanitized ToolResult attempt details retain the finite route-one values.
    const toolResult = await finalize();
    const details = toolResult.details as { attempts?: readonly Record<string, unknown>[] };
    const sanitizedStalled = details.attempts?.[0] as Record<string, unknown>;
    assert.equal(sanitizedStalled.stallCause, "active_tool_idle");
    assert.equal(sanitizedStalled.rpcIdleSeconds, stalled.rpcIdleSeconds);
    assert.equal(sanitizedStalled.activityIdleSeconds, stalled.activityIdleSeconds);
    assert.equal(sanitizedStalled.progressIdleSeconds, stalled.progressIdleSeconds);
    assert.equal(sanitizedStalled.activityEventCount, stalled.activityEventCount);
    assert.equal(sanitizedStalled.structuralProgressCount, stalled.structuralProgressCount);
    assert.equal(sanitizedStalled.duplicateCheckpointCount, 0);
    assert.equal(sanitizedStalled.activityWarningCount, 1);
    assert.equal(sanitizedStalled.progressWarningCount, 0);
    assert.equal(sanitizedStalled.activeToolIdleSeconds, stalled.activeToolIdleSeconds);
  });
});

test("an exhausted operational chain persists full per-attempt liveness evidence", async () => {
  const catalog = [
    "prov-a/model-x",
    "prov-b/model-y",
  ];
  const behaviors = Object.fromEntries(catalog.map((route) => [route, "credit"])) as Record<string, Behavior>;
  const fixture = await fakePi(catalog, behaviors);
  await runAndFinalize(baseOptions(fixture, { role: "solution-c", routingConfig: twoTierRoutingConfig() }), async (result, finalize) => {
    assert.equal(result.state, "routes_unavailable");
    assert.ok(result.attempts.every((attempt) => attempt.state === "provider_failed"));
    const supervisedKeys = [
      "rpcIdleSeconds",
      "activityIdleSeconds",
      "progressIdleSeconds",
      "activityEventCount",
      "structuralProgressCount",
      "duplicateCheckpointCount",
      "activityWarningCount",
      "progressWarningCount",
    ] as const;
    for (const attempt of result.attempts) {
      for (const key of supervisedKeys) {
        assert.equal(typeof attempt[key], "number", key);
        assert.ok(Number.isFinite(attempt[key] as number), key);
      }
    }
    // The exhausted chain persists the schema-6 diagnostic with the same
    // per-attempt evidence on every attempt record.
    const toolResult = await finalize();
    const diagnosticPath = toolResult.details?.diagnosticPath as string;
    const parsed = JSON.parse(await readFile(diagnosticPath, "utf8")) as Record<string, unknown>;
    const attempts = parsed.attempts as Record<string, unknown>[];
    assert.equal(attempts.length, 2);
    for (const record of attempts) {
      assert.equal(record.state, "provider_failed");
      for (const key of supervisedKeys) {
        assert.equal(typeof record[key], "number", key);
        assert.ok(Number.isFinite(record[key] as number), key);
      }
      // No tool executed on these attempts, so no active-tool idle is fabricated.
      assert.equal("activeToolIdleSeconds" in record, false);
    }
  });
});

test("early provider failure falls back with no remaining-work predicate", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-a/model-y"],
    { "prov-a/model-x": "unavailable", "prov-a/model-y": "complete" },
  );
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: twoTierOracleRoutingConfig(),
  }), async (result) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["provider_failed", "completed"]);
    assert.ok(result.attempts.every((attempt) => !("remainingWorkSecondsAtAttemptStart" in attempt)));
  });
});

test("catalog preflight timeout continues with its fixed cause while work remains", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-a/model-y"],
    { "prov-a/model-x": "complete", "prov-a/model-y": "complete" },
    { catalogDelayMs: 500, catalogDelayRoute: "prov-a/model-x" },
  );
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: twoTierOracleRoutingConfig(),
    catalogTimeoutMs: 100,
  }), async (result) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["timed_out", "completed"]);
    assert.equal(result.attempts[0]?.deadlineCause, "catalog_preflight");
    assert.equal(result.attempts[0]?.stallCause, undefined);
  });
});

test("a catalog child that settles naturally ignores a later deadline and runs one cleanup", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x"],
    { "prov-a/model-x": "complete" },
  );
  // The catalog child settles almost immediately, but its positive cleanup
  // proof is stretched past the short catalog deadline through the shared
  // termination-probe seam. Natural settlement must disarm the deadline
  // timer first, so the outcome stays available instead of flipping to
  // timed_out/catalog_preflight mid-cleanup.
  const originalBuild = terminationProbes.build;
  const delayMs = 800;
  try {
    terminationProbes.build = (child) => {
      const real = originalBuild(child);
      return {
        ...real,
        waitForClose: async (timeoutMs: number) => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return real.waitForClose(Math.max(0, timeoutMs - delayMs));
        },
      };
    };
    await runAndFinalize(baseOptions(fixture, {
      routingConfig: singleRouteRoutingConfig(),
      catalogTimeoutMs: 400,
    }), async (result) => {
      assert.equal(result.state, "completed");
      assert.equal(result.attempts.length, 1);
      assert.equal(result.attempts[0]?.state, "completed");
      assert.equal(result.attempts[0]?.deadlineCause, undefined);
      // The positive cleanup proof really did finish after the deadline.
      assert.ok(result.elapsedSeconds >= delayMs / 1000, `cleanup must outlast the deadline, got ${result.elapsedSeconds}s`);
    });
  } finally {
    terminationProbes.build = originalBuild;
  }
});

test("spawn failure and invalid stream fall back with actual remaining work", async () => {
  for (const failure of ["spawn", "invalid_stream"] as const) {
    const fixture = await fakePi(
      ["prov-a/model-x", "prov-a/model-y"],
      { "prov-a/model-x": failure === "invalid_stream" ? "invalid-stream" : "complete", "prov-a/model-y": "complete" },
    );
    let commandReads = 0;
    const invocation = failure === "spawn"
      ? {
        get command() {
          commandReads += 1;
          return commandReads === 2 ? path.join(fixture.root, "missing-command") : fixture.invocation.command;
        },
        prefixArgs: fixture.invocation.prefixArgs,
      }
      : fixture.invocation;
    await runAndFinalize(baseOptions(fixture, {
      piInvocation: invocation,
      routingConfig: twoTierOracleRoutingConfig(),
    }), async (result) => {
      assert.equal(result.state, "completed", failure);
      assert.equal(result.attempts[0]?.state, failure === "spawn" ? "spawn_failed" : "invalid_stream");
      assert.equal(result.attempts[1]?.state, "completed", failure);
    });
  }
});

test("the activity warning fires once and a silent route falls back with rpc_silent", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-a/model-y"],
    { "prov-a/model-x": "hang", "prov-a/model-y": "complete" },
  );
  const updates: DelegateRunResult["progress"][] = [];
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: twoTierOracleRoutingConfig(),
    activityWarningMs: 100,
    activityIdleMs: 300,
    onProgress: (progress) => updates.push(progress),
  }), async (result) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["stalled", "completed"]);
    assert.equal(result.attempts[0]?.deadlineCause, "idle_deadline");
    assert.equal(result.attempts[0]?.stallCause, "rpc_silent");
    const warnings = updates.filter((progress) => progress.route === "prov-a/model-x:high" && progress.activityWarningCount === 1);
    assert.ok(warnings.length >= 1);
    assert.ok(updates.every((progress) => progress.activityWarningCount <= 1));
  });
});

test("fallback route starts only after positive leader and group death proof", { skip: process.platform !== "linux" }, async () => {
  const fixture = await resistantPi({ supervisionHangRoute: "prov-a/model-x" });
  const group = { leader: -1, descendant: -1 };
  try {
    const resultPromise = runDelegate(baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      activityWarningMs: 100,
      activityIdleMs: 300,
      graceMs: 100,
      cleanupTimeoutMs: 1000,
    }));
    const recorded = await waitForFixtureGroup(fixture.root, "resistant-group.json");
    group.leader = recorded.leader;
    group.descendant = recorded.descendant;
    safetyGroups.push({ ...group });
    await settleAndFinalize(resultPromise, async (result) => {
      assert.equal(result.state, "completed");
      assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["stalled", "completed"]);
      const start = JSON.parse(await readFile(path.join(fixture.root, "route-two-start.json"), "utf8")) as Record<string, {
        leaderGone: boolean;
        descendantGone: boolean;
      }>;
      for (const phase of ["catalog", "supervision"]) {
        assert.equal(start[phase]?.leaderGone, true, phase);
        assert.equal(start[phase]?.descendantGone, true, phase);
      }
    });
  } finally {
    killOwned(group.leader, group.descendant);
  }
});

test("a supervision cleanup failure fails the chain closed before route two starts", { skip: process.platform !== "linux" }, async () => {
  const fixture = await resistantPi({ supervisionHangRoute: "prov-a/model-x" });
  const group = { leader: -1, descendant: -1 };
  const originalBuild = terminationProbes.build;
  try {
    // Only the supervised RPC child (its argv has no --list-models) reports a
    // group that survives even SIGKILL; the real signals still fire, so the
    // child actually dies while the liveness proof stays negative. Catalog
    // preflights keep the real probes.
    terminationProbes.build = (child) => {
      const real = originalBuild(child);
      if (child.spawnargs.includes("--list-models")) return real;
      return { ...real, groupExists: () => true };
    };
    const resultPromise = runDelegate(baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      activityWarningMs: 400,
      activityIdleMs: 2800,
      graceMs: 300,
      cleanupTimeoutMs: 2500,
    }));
    const recorded = await waitForFixtureGroup(fixture.root, "resistant-group.json");
    group.leader = recorded.leader;
    group.descendant = recorded.descendant;
    safetyGroups.push({ ...group });
    const toolResult = await settleAndFinalize(
      resultPromise,
      async (result, finalize) => {
        // Route one reached its idle deadline, resisted SIGTERM, was SIGKilled,
        // and its group liveness stayed unproven. The chain fails closed and
        // route two never starts.
        assert.equal(result.state, "cleanup_failed");
        assert.equal(result.selectedRoute, "prov-a/model-x:high");
        assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["cleanup_failed"]);
        assert.equal(result.report, "");
        await assert.rejects(() => stat(path.join(fixture.root, "route-two-start.json")), enoent);
        const toolResult = await finalize();
        assert.match(toolResult.content[0]!.text, /## Delegate solution-a failed: cleanup_failed/);
        // The model-visible failure includes only the fixed cleanup code, with
        // no signals, pids, or raw process details.
        assert.match(toolResult.content[0]!.text, /cleanup failure: group_alive/);
        assert.doesNotMatch(toolResult.content[0]!.text, /SIGKILL|SIGTERM|pid/i);
        return toolResult;
      },
    );
    assert.equal(toolResult.details?.state, "cleanup_failed");
  } finally {
    terminationProbes.build = originalBuild;
    killOwned(group.leader, group.descendant);
  }
});

test("supervision consumes bounded cleanup failure while inherited stdio keeps close open", { skip: process.platform !== "linux" }, async () => {
  const fixture = await inheritedStdioPi({ supervisionExitRoute: "prov-a/model-x" });
  const group = { leader: -1, descendant: -1 };
  const originalBuild = terminationProbes.build;
  try {
    terminationProbes.build = (child) => {
      const real = originalBuild(child);
      if (child.spawnargs.includes("--list-models")) return real;
      // Keep both negative probes deterministic and leave the inherited-stdio
      // descendant alive until this test's exact-pid safety cleanup.
      return { ...real, groupExists: () => true, signalGroup: () => {} };
    };
    const resultPromise = runDelegate(baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      activityWarningMs: 400,
      activityIdleMs: 1000,
      graceMs: 300,
      cleanupTimeoutMs: 2500,
    }));
    const recorded = await waitForFixtureGroup(fixture.root, "inherited-group.json");
    group.leader = recorded.leader;
    group.descendant = recorded.descendant;
    safetyGroups.push({ ...group });

    const settledAt = performance.now();
    await settleAndFinalize(resultPromise, async (result) => {
      assert.equal(result.state, "cleanup_failed");
      assert.equal(result.selectedRoute, "prov-a/model-x:high");
      assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["cleanup_failed"]);
      await assert.rejects(() => stat(path.join(fixture.root, "route-two-start.json")), enoent);
    });
    assert.ok(performance.now() - settledAt < 4000, "remaining work plus cleanup must stay bounded");
    assert.ok(await isGone(group.leader), "the inherited-stdio leader must already be gone");
    assert.equal(await isGone(group.descendant), false, "the inherited-stdio descendant must still be alive before safety cleanup");
  } finally {
    terminationProbes.build = originalBuild;
    killOwned(group.leader, group.descendant);
  }
});

test("catalog consumes bounded cleanup failure while inherited stdio keeps close open", { skip: process.platform !== "linux" }, async () => {
  const fixture = await inheritedStdioPi({ catalogExitRoute: "prov-a/model-x" });
  const group = { leader: -1, descendant: -1 };
  const originalBuild = terminationProbes.build;
  try {
    terminationProbes.build = (child) => {
      const real = originalBuild(child);
      if (!child.spawnargs.includes("--list-models")) return real;
      // A no-op signal leaves close blocked. The bounded negative outcome must
      // still fail the chain closed before any second-route child can spawn.
      return { ...real, groupExists: () => true, signalGroup: () => {} };
    };
    const resultPromise = runDelegate(baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      activityWarningMs: 400,
      activityIdleMs: 1000,
      graceMs: 300,
    }));
    const recorded = await waitForFixtureGroup(fixture.root, "inherited-group.json");
    group.leader = recorded.leader;
    group.descendant = recorded.descendant;
    safetyGroups.push({ ...group });

    const settledAt = performance.now();
    await settleAndFinalize(resultPromise, async (result) => {
      assert.equal(result.state, "cleanup_failed");
      assert.equal(result.selectedRoute, undefined);
      assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["cleanup_failed"]);
      await assert.rejects(() => stat(path.join(fixture.root, "route-two-start.json")), enoent);
    });
    assert.ok(performance.now() - settledAt < 10_000, "catalog cleanup_failed must settle inside the ten-second cleanup allowance");
    assert.ok(await isGone(group.leader), "the catalog leader must already be gone");
    assert.equal(await isGone(group.descendant), false, "the inherited-stdio descendant must still be alive before safety cleanup");
  } finally {
    terminationProbes.build = originalBuild;
    killOwned(group.leader, group.descendant);
  }
});

test("a productive route completes after crossing many former total-deadline equivalents", async () => {
  // The 400 ms renewable progress lease stands in for the former 45-minute
  // ceiling: fourteen novel authoritative checkpoints renew it for about
  // 1.7 s (more than four former-deadline equivalents) and the route still
  // completes on the first provider with no fallback and no timed-out state.
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-b/model-y"],
    { "prov-a/model-x": "novel-long", "prov-b/model-y": "complete" },
    { supervisionLog: true },
  );
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: twoTierRoutingConfig(),
    activityWarningMs: 150,
    activityIdleMs: 600,
    progressWarningMs: 260,
    progressStallMs: 400,
  }), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.selectedRoute, "prov-a/model-x:high");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.state, "completed");
    assert.equal(result.deadlineCause, undefined);
    assert.equal(result.stallCause, undefined);
    assert.ok(result.elapsedSeconds >= 1.5, `several lease equivalents must elapse, got ${result.elapsedSeconds}s`);
    assert.ok(JSON.stringify(result.attempts).includes("novel") === false);
    const spawned = await readFile(path.join(fixture.root, "supervision-routes.jsonl"), "utf8");
    assert.deepEqual(spawned.trim().split("\n"), ["prov-a/model-x"]);
    assert.ok(result.progress.structuralProgressCount >= 14);
  });
});

test("fallback starts after arbitrary elapsed time with no remaining-work predicate", async () => {
  // Route one stays productively alive for about 1.7 s (several former
  // total-deadline equivalents), then fails operationally after novel work.
  // Route two must still start: no chain work budget or remaining-time
  // predicate exists anywhere.
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-b/model-y"],
    { "prov-a/model-x": "novel-long-fail", "prov-b/model-y": "complete" },
    { supervisionLog: true },
  );
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: twoTierRoutingConfig(),
    activityWarningMs: 150,
    activityIdleMs: 600,
    progressWarningMs: 260,
    progressStallMs: 400,
  }), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.selectedRoute, "prov-b/model-y:high");
    assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["provider_failed", "completed"]);
    assert.ok(result.elapsedSeconds >= 1.5, `route one must outlive any former ceiling analog, got ${result.elapsedSeconds}s`);
    assert.ok(result.attempts.every((attempt) => !("remainingWorkSecondsAtAttemptStart" in attempt)));
    // Route one executed no tools and accepted no recovery, so no restart
    // note was applied to route two's private prompt.
    assert.equal(result.attempts[0]?.restartAfterWork, undefined);
    assert.equal(result.progress.restartAfterWorkCount, 0);
    const spawned = (await readFile(path.join(fixture.root, "supervision-routes.jsonl"), "utf8")).trim().split("\n");
    assert.deepEqual(spawned, ["prov-a/model-x", "prov-b/model-y"]);
  });
});

test("report recovery remains eligible after total elapsed time exceeds any former ceiling", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x"],
    { "prov-a/model-x": "missing-long" },
  );
  await runAndFinalize(baseOptions(fixture, {
    routingConfig: singleRouteRoutingConfig(),
    activityWarningMs: 150,
    activityIdleMs: 600,
    progressWarningMs: 260,
    progressStallMs: 400,
    reportRecoveryIdleMs: 700,
  }), async (result) => {
    // Round one settled without a valid terminal marker only after about
    // 1.7 s of renewed novel checkpoints, several former-deadline
    // equivalents past the start; the same-session recovery round still ran
    // and completed.
    assert.equal(result.state, "completed");
    assert.equal(result.attempts.length, 1);
    assert.equal(result.progress.reportNudgeCount, 1);
    assert.equal(result.progress.reportRound, 2);
    assert.ok(result.elapsedSeconds >= 1.5, `the round must outlive any former ceiling analog, got ${result.elapsedSeconds}s`);
  });
});

test("an oracle routing override is rejected before any child spawns", async () => {
  const fixture = await fakePi(
    ["zai/glm-5.3", "openai-codex/gpt-5.6-sol"],
    { "zai/glm-5.3": "complete", "openai-codex/gpt-5.6-sol": "complete" },
  );
  await assert.rejects(
    () => runDelegate(baseOptions(fixture, {
      role: "oracle",
      prompt: "Review only.",
      routingOverride: { provider: "zai", model: "glm-5.3", reason: "explicit user request" },
    })),
    /routingOverride is not allowed for the oracle role/,
  );
});

test("an exceptional routing override pins an exact route for one run", async () => {
  const fixture = await fakePi(
    ["openai-codex-cgpt5/gpt-5.6-sol"],
    { "openai-codex-cgpt5/gpt-5.6-sol": "complete" },
  );
  await runAndFinalize(
    baseOptions(fixture, {
      role: "verification",
      prompt: "Verify only.",
      routingOverride: { provider: "openai-codex-cgpt5", model: "gpt-5.6-sol", thinking: "high", reason: "explicit user request" },
    }),
    async (result) => {
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "openai-codex-cgpt5/gpt-5.6-sol:high");
      assert.equal(result.attempts.length, 1);
    },
  );
});

test("a no-op routing override fails closed before any child spawns", async () => {
  const fixture = await fakePi(
    ["zai/glm-5.3"],
    { "zai/glm-5.3": "complete" },
  );
  await assert.rejects(
    () => runDelegate(baseOptions(fixture, {
      role: "implementation",
      prompt: "Implement only.",
      routingOverride: { reason: "no fields set" },
    })),
    /routingOverride is a no-op/,
  );
});

test("rejected routing overrides create no private artifact directory", async () => {
  const fixture = await fakePi(
    ["zai/glm-5.3"],
    { "zai/glm-5.3": "complete" },
  );
  const base = baseOptions(fixture, { role: "implementation", prompt: "Implement only." });
  // Route and override selection completes before createArtifactDir, so a
  // no-op override, an invalid model, and an oracle override all fail
  // without leaving a private artifact directory behind.
  await assertCreatesNoArtifact(() => runDelegate({
    ...base,
    routingOverride: { reason: "no fields set" },
  }));
  await assertCreatesNoArtifact(() => runDelegate({
    ...base,
    routingOverride: { model: "no-such-model", reason: "explicit user request" },
  }));
  await assertCreatesNoArtifact(() => runDelegate({
    ...base,
    role: "oracle",
    routingOverride: { provider: "zai", model: "glm-5.3", reason: "explicit user request" },
  }));
  // A successful run keeps its artifact directory until finalizeDelegateRun.
  await runAndFinalize(base, async (result, finalize) => {
    assert.equal(result.state, "completed");
    await stat(result.artifactDir);
    await finalize();
    await assert.rejects(() => stat(result.artifactDir), enoent);
  });
});

test("a throwing onProgress callback rejects after allocation without leaking the artifact", async () => {
  const fixture = await fakePi(
    ["zai/glm-5.3"],
    { "zai/glm-5.3": "complete" },
  );
  const base = baseOptions(fixture, { role: "implementation", prompt: "Implement only." });
  // The initial progress event fires only after prompt.md exists inside the
  // private artifact directory. A throwing sink rejects before a
  // DelegateRunResult exists, so finalizeDelegateRun never cleans the run up:
  // runDelegate itself must remove the artifact and rethrow the original error.
  const initialFailure = new Error("initial progress sink failed PRIVATE");
  await assertRejectsWithoutArtifact(
    () => runDelegate({ ...base, onProgress: () => { throw initialFailure; } }),
    initialFailure,
  );
  // A later post-allocation event must hit the same boundary: the second
  // progress event fires inside the route loop, after the private prompt was
  // written and before the catalog preflight spawns any child.
  let events = 0;
  const laterFailure = new Error("later progress sink failed PRIVATE");
  await assertRejectsWithoutArtifact(
    () => runDelegate({
      ...base,
      onProgress: () => {
        events += 1;
        if (events >= 2) throw laterFailure;
      },
    }),
    laterFailure,
  );
  assert.equal(events, 2, "the later failure must fire on the second post-allocation event");
});

test("a supervisor-owned progress sink failure rejects through runDelegate without leaking the artifact", async () => {
  const fixture = await fakePi(
    ["zai/glm-5.3"],
    { "zai/glm-5.3": "complete" },
  );
  const sinkError = new Error("supervisor progress sink failed PRIVATE");
  // Chain-owned catalog_check events reach the sink directly and stay
  // healthy. The first supervisor-owned event (RPC progress inside
  // supervisePi) throws: supervisePi must finish its normal cleanup, reject
  // with the original sink error, and runDelegate's rejection boundary must
  // remove the run directory.
  await assertRejectsWithoutArtifact(
    () => runDelegate(baseOptions(fixture, {
      role: "implementation",
      prompt: "Implement only.",
      onProgress: (progress) => {
        if (progress.lastEvent !== "catalog_check") throw sinkError;
      },
    })),
    sinkError,
  );
});

test("a successful run still retains its artifact until execute-level finalization", async () => {
  const fixture = await fakePi(
    ["zai/glm-5.3"],
    { "zai/glm-5.3": "complete" },
  );
  await runAndFinalize(baseOptions(fixture, { role: "implementation", prompt: "Implement only." }), async (result, finalize) => {
    assert.equal(result.state, "completed");
    // The exception-cleanup boundary removes artifacts only on rejection: a
    // successful return transfers ownership, so the private prompt must
    // survive until finalizeDelegateRun removes the directory.
    await stat(result.artifactDir);
    await stat(path.join(result.artifactDir, "prompt.md"));
    await finalize();
    await assert.rejects(() => stat(result.artifactDir), enoent);
  });
});

test("a read-only delegate that changes the Git tree still completes without invalidation", async () => {
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    { "opencode-go/muse-spark-1.2-contributor": "mutate-existing" },
  );
  await execFileAsync("git", ["-C", fixture.root, "init", "-q"]);
  await writeFile(path.join(fixture.root, "existing-untracked.txt"), "before");
  const toolResult = await runAndFinalize(
    baseOptions(fixture, { role: "review-a", prompt: "Review only." }),
    async (result, finalize) => {
      // The working tree changed during the read-only run, but the removed
      // global fingerprint check no longer attributes the change to the
      // delegate: the completed report survives and no invalidation state exists.
      assert.equal(result.state, "completed");
      assert.match(result.report, /Completed on opencode-go\/muse-spark-1\.2-contributor/);
      assert.notEqual(result.progress.lastEvent, "tree_fingerprint_changed");
      assert.equal("fingerprintBefore" in result, false);
      assert.equal("fingerprintAfter" in result, false);
      assert.equal(await readFile(path.join(fixture.root, "existing-untracked.txt"), "utf8"), "after");
      return finalize();
    },
  );
  assert.match(toolResult.content[0]!.text, /## Delegate review-a completed/);
});

test("a concurrently present foreign delegated-pi directory is never touched", async () => {
  // Simulates another test process or a real delegate whose artifact
  // directory is concurrently present in the shared tmpdir while this
  // process runs and cleans its own artifacts. The foreign directory is
  // created and removed by exact path only.
  const foreign = path.join(os.tmpdir(), `delegated-pi-foreign-${process.pid}-${Date.now()}`);
  await mkdir(foreign, { mode: 0o700 });
  await writeFile(path.join(foreign, "sentinel.txt"), "foreign-owned");
  try {
    // A rejected run (which must create no artifact) and a completed,
    // finalized run both exercise cleanup while the foreign directory exists.
    const rejecting = await fakePi(["zai/glm-5.3"], { "zai/glm-5.3": "complete" });
    await assertCreatesNoArtifact(() => runDelegate(baseOptions(rejecting, {
      role: "implementation",
      prompt: "Implement only.",
      routingOverride: { reason: "no fields set" },
    })));
    const completing = await fakePi(["zai/glm-5.3"], { "zai/glm-5.3": "complete" });
    await runAndFinalize(baseOptions(completing, { role: "implementation", prompt: "Implement only." }), async () => {});
    // The foreign directory survived every owned-sandbox cleanup untouched.
    assert.equal(await readFile(path.join(foreign, "sentinel.txt"), "utf8"), "foreign-owned");
    await stat(foreign);
  } finally {
    await rm(foreign, { recursive: true, force: true });
  }
});

test("the owned sandboxes are clean after success, rejection, and assertion failure", async () => {
  // Success: the run is finalized and the owned artifact sandbox is empty.
  const fixture = await fakePi(["zai/glm-5.3"], { "zai/glm-5.3": "complete" });
  await runAndFinalize(baseOptions(fixture), async () => {});
  await assertNoOwnedArtifacts("the owned artifact sandbox must be clean after success");
  // Rejection: a failed run leaves no artifact directory behind.
  const rejecting = await fakePi(["zai/glm-5.3"], { "zai/glm-5.3": "complete" });
  await assertCreatesNoArtifact(() => runDelegate(baseOptions(rejecting, {
    role: "implementation",
    prompt: "Implement only.",
    routingOverride: { model: "no-such-model", reason: "explicit user request" },
  })));
  await assertNoOwnedArtifacts("the owned artifact sandbox must be clean after rejection");
  // Assertion failure: the finally still finalizes the received result, so a
  // failing assertion can never leak the artifact directory.
  const failing = await fakePi(["zai/glm-5.3"], { "zai/glm-5.3": "complete" });
  let caught: unknown;
  try {
    await runAndFinalize(baseOptions(failing), async (result) => {
      assert.equal(result.state, "completed");
      assert.fail("deliberate assertion failure to prove finally cleanup");
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof assert.AssertionError, "the deliberate assertion failure must propagate");
  await assertNoOwnedArtifacts("the owned artifact sandbox must be clean after an assertion failure");
});

test("progress stagnation on a resistant route cleans the group and falls back", { skip: process.platform !== "linux" }, async () => {
  const fixture = await resistantPi({ supervisionHangRoute: "prov-a/model-x" });
  const group = { leader: -1, descendant: -1 };
  try {
    const resultPromise = runDelegate(baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      activityWarningMs: 400,
      activityIdleMs: 2800,
      progressWarningMs: 1500,
      progressStallMs: 2600,
      graceMs: 300,
    }));
    const recorded = await waitForFixtureGroup(fixture.root, "resistant-group.json");
    group.leader = recorded.leader;
    group.descendant = recorded.descendant;
    safetyGroups.push({ ...group });
    await settleAndFinalize(
      resultPromise,
      async (result) => {
        assert.ok(Number.isSafeInteger(group.leader) && group.leader > 0);
        assert.ok(Number.isSafeInteger(group.descendant) && group.descendant > 0, "the resistant descendant must have started");
        // Route one stopped at its renewable progress lease, not at any total
        // deadline; cleanup proved the group dead and route two completed.
        assert.equal(result.state, "completed");
        assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["stalled", "completed"]);
        assert.equal(result.attempts[0]?.stallCause, "progress_stagnation");
        assert.equal(result.attempts[0]?.deadlineCause, "idle_deadline");
        assert.ok(result.attempts[0]!.elapsedSeconds >= 2.4, "the progress lease must run first");
        assert.ok(await isGone(group.leader), "the SIGTERM-resistant leader must be dead");
        assert.ok(await isGone(group.descendant), "the SIGTERM-resistant descendant must be dead with the group");
        const start = JSON.parse(await readFile(path.join(fixture.root, "route-two-start.json"), "utf8")) as Record<string, {
          leaderGone: boolean;
          descendantGone: boolean;
        }>;
        for (const phase of ["catalog", "supervision"]) {
          assert.equal(start[phase]?.leaderGone, true, phase);
          assert.equal(start[phase]?.descendantGone, true, phase);
        }
      },
    );
  } finally {
    killOwned(group.leader, group.descendant);
  }
});

test("a fixed catalog-preflight timeout on a resistant child cleans up and continues", { skip: process.platform !== "linux" }, async () => {
  const fixture = await resistantPi({ catalogHangRoute: "prov-a/model-x" });
  const group = { leader: -1, descendant: -1 };
  try {
    const resultPromise = runDelegate(baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      catalogTimeoutMs: 500,
      graceMs: 300,
    }));
    const recorded = await waitForFixtureGroup(fixture.root, "resistant-group.json");
    group.leader = recorded.leader;
    group.descendant = recorded.descendant;
    safetyGroups.push({ ...group });
    await settleAndFinalize(
      resultPromise,
      async (result) => {
        assert.ok(Number.isSafeInteger(group.leader) && group.leader > 0);
        assert.ok(Number.isSafeInteger(group.descendant) && group.descendant > 0, "the resistant descendant must have started");
        // The resistant catalog child was stopped at its own fixed cap, its
        // group was proven dead, and the finite chain continued to route two.
        assert.equal(result.state, "completed");
        assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["timed_out", "completed"]);
        assert.equal(result.attempts[0]?.route, "prov-a/model-x:high");
        assert.equal(result.attempts[0]?.deadlineCause, "catalog_preflight");
        assert.ok(result.attempts[0]!.elapsedSeconds >= 0.4, "the fixed catalog cap must run first");
        assert.ok(await isGone(group.leader), "the SIGTERM-resistant leader must be dead");
        assert.ok(await isGone(group.descendant), "the SIGTERM-resistant descendant must be dead with the group");
      },
    );
  } finally {
    killOwned(group.leader, group.descendant);
  }
});

/**
 * A fixture resource policy that mirrors the production layout inside one
 * temporary root, so the runner can exercise alternate resource profiles.
 */
async function fixtureResourcePolicy(): Promise<{
  readonly policyDir: string;
  readonly extensionsRoot: string;
  readonly skillsRoot: string;
  readonly root: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-runner-resources-"));
  fixtureRoots.push(root);
  const extensionsRoot = path.join(root, "agent", "extensions");
  const policyDir = path.join(extensionsRoot, "delegated-pi-loop");
  const skillsRoot = path.join(root, "agent", "skills");
  for (const dir of [
    policyDir,
    path.join(extensionsRoot, "openai-codex-aliases"),
    path.join(extensionsRoot, "web-search"),
    path.join(extensionsRoot, "context-mode", "src"),
    path.join(extensionsRoot, "codegraph"),
    path.join(skillsRoot, "alpha"),
  ]) {
    await mkdir(dir, { recursive: true });
  }
  for (const file of [
    path.join(policyDir, "index.ts"),
    path.join(extensionsRoot, "openai-codex-aliases", "index.ts"),
    path.join(extensionsRoot, "web-search", "index.ts"),
    path.join(extensionsRoot, "context-mode", "src", "index.ts"),
    path.join(extensionsRoot, "codegraph", "index.ts"),
  ]) {
    await writeFile(file, "");
  }
  await writeFile(path.join(skillsRoot, "alpha", "SKILL.md"), "# alpha\n");
  await writeFile(path.join(policyDir, "resources.json"), `${JSON.stringify({
    version: 1,
    extensions: {
      catalog: ["../openai-codex-aliases/index.ts"],
      runtime: [
        "./index.ts",
        "../openai-codex-aliases/index.ts",
        "../web-search/index.ts",
        "../context-mode/src/index.ts",
        "../codegraph/index.ts",
      ],
    },
    skills: {
      allowed: { alpha: "../../skills/alpha" },
      excluded: ["delta"],
    },
  }, null, 2)}\n`);
  return { policyDir, extensionsRoot, skillsRoot, root };
}

async function argvLogLines(root: string): Promise<string[][]> {
  const text = await readFile(path.join(root, "argv.jsonl"), "utf8");
  return text.trim().split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as string[]);
}

/** The resource-argument slice of one runtime argv line, from --no-extensions up to --mode. */
function runtimeResourceSlice(argv: readonly string[]): string[] {
  const start = argv.indexOf("--no-extensions");
  const end = argv.indexOf("--mode");
  assert.ok(start >= 0 && end > start, "runtime argv must contain the resource block before --mode");
  return argv.slice(start, end);
}

test("catalog preflight uses the lean catalog resource profile", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-b/model-y"],
    {
      "prov-a/model-x": "credit",
      "prov-b/model-y": "complete",
    },
    { argvLog: true },
  );
  await runAndFinalize(baseOptions(fixture, { role: "solution-c", routingConfig: twoTierRoutingConfig() }), async () => {});
  const catalogArgv = (await argvLogLines(fixture.root)).filter((argv) => argv.includes("--list-models"));
  assert.ok(catalogArgv.length >= 1, "at least one catalog preflight must have run");
  for (const argv of catalogArgv) {
    // Invocation prefix arguments come first.
    assert.equal(argv[0], fixture.invocation.prefixArgs[0]);
    for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"]) {
      assert.equal(argv.filter((arg) => arg === flag).length, 1, flag);
    }
    // The only explicit extension is the alias provider extension.
    const entries = argv.filter((_, index) => argv[index - 1] === "-e");
    assert.equal(entries.length, 1);
    assert.ok(entries[0]!.endsWith(path.join("agent", "extensions", "openai-codex-aliases", "index.ts")), entries[0]);
    // No skills and no model-tool or delegated-loop extensions reach catalog preflight.
    assert.ok(!argv.includes("--skill"));
    for (const forbidden of ["web-search", "context-mode", "codegraph", "delegated-pi-loop"]) {
      assert.ok(!argv.some((arg) => arg.includes(forbidden)), `catalog must not load ${forbidden}`);
    }
    // The route request follows the resource arguments.
    assert.equal(argv[argv.indexOf("--list-models") - 1], entries[0]);
  }
});

test("every fallback attempt receives byte-for-byte identical runtime resource arguments", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-b/model-y"],
    {
      "prov-a/model-x": "credit",
      "prov-b/model-y": "complete",
    },
    { argvLog: true },
  );
  await runAndFinalize(baseOptions(fixture, { role: "solution-c", routingConfig: twoTierRoutingConfig() }), async (result) => {
    assert.equal(result.attempts.length, 2);
  });
  const runtimeArgv = (await argvLogLines(fixture.root)).filter((argv) => !argv.includes("--list-models"));
  assert.equal(runtimeArgv.length, 2, "two supervision attempts must have spawned");
  const first = runtimeResourceSlice(runtimeArgv[0]!);
  for (const argv of runtimeArgv) {
    assert.deepEqual(runtimeResourceSlice(argv), first);
  }
  // The default policy loads the five fixed runtime entries exactly once each.
  const entries = first.filter((_, index) => first[index - 1] === "-e");
  assert.equal(entries.length, 5);
  assert.equal(new Set(entries).size, 5);
  assert.ok(!first.includes("--no-context-files"), "runtime children keep context files enabled");
  // Provider, model, and thinking arguments remain unchanged after --mode rpc.
  const argv = runtimeArgv[0]!;
  const modeIndex = argv.indexOf("--mode");
  assert.deepEqual(argv.slice(modeIndex), [
    "--mode", "rpc", "--no-session", "--approve",
    "--provider", "prov-a", "--model", "model-x", "--thinking", "high",
  ]);
});

test("a vanished approved extension entry fails the run before artifact creation and spawn", async () => {
  const { policyDir, extensionsRoot } = await fixtureResourcePolicy();
  const resourcePolicy = readResourcesFile(path.join(policyDir, "resources.json"));
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    { "opencode-go/muse-spark-1.2-contributor": "complete" },
    { spawnMarker: true },
  );
  assert.ok(fixture.spawnMarkerPath, "the spawn marker path must be set");
  // The previously validated web-search entry file disappears before spawn.
  await rm(path.join(extensionsRoot, "web-search", "index.ts"));
  await assertCreatesNoArtifact(() => runDelegate(baseOptions(fixture, { resourcePolicy })));
  await assert.rejects(() => stat(fixture.spawnMarkerPath!), enoent);
});

test("a post-selection catalog-entry symlink swap fails the run before any spawn", { skip: process.platform === "win32" }, async () => {
  const { policyDir, extensionsRoot, root } = await fixtureResourcePolicy();
  const resourceSelection = buildDelegateResourceSelection(
    readResourcesFile(path.join(policyDir, "resources.json")),
    ["alpha"],
  );
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    { "opencode-go/muse-spark-1.2-contributor": "complete" },
    { spawnMarker: true },
  );
  // Swap the alias entry (catalog and runtime) with an outside-root symlink
  // after the immutable selection was built: the per-spawn re-verification
  // must fail closed, so neither a catalog preflight nor a runtime child
  // ever starts.
  const outside = path.join(root, "outside-alias.ts");
  await writeFile(outside, "");
  await rm(path.join(extensionsRoot, "openai-codex-aliases", "index.ts"));
  await symlink(outside, path.join(extensionsRoot, "openai-codex-aliases", "index.ts"));
  await assertCreatesNoArtifact(() => runDelegate(baseOptions(fixture, { resourceSelection })));
  await assert.rejects(() => stat(fixture.spawnMarkerPath!), enoent);
});

test("a post-selection runtime-entry symlink swap fails before the runtime spawn", { skip: process.platform === "win32" }, async () => {
  const { policyDir, extensionsRoot, root } = await fixtureResourcePolicy();
  const resourceSelection = buildDelegateResourceSelection(
    readResourcesFile(path.join(policyDir, "resources.json")),
    ["alpha"],
  );
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    { "opencode-go/muse-spark-1.2-contributor": "complete" },
    { argvLog: true },
  );
  // Swap a runtime-only entry after selection: catalog preflights may still
  // run, but no runtime child may spawn with the swapped profile.
  const outside = path.join(root, "outside-runtime.ts");
  await writeFile(outside, "");
  await rm(path.join(extensionsRoot, "web-search", "index.ts"));
  await symlink(outside, path.join(extensionsRoot, "web-search", "index.ts"));
  await assertCreatesNoArtifact(() => runDelegate(baseOptions(fixture, { resourceSelection })));
  const logged = await argvLogLines(fixture.root);
  assert.ok(logged.length >= 1, "at least the catalog preflight must have run");
  for (const argv of logged) {
    assert.ok(argv.includes("--list-models"), "no runtime child may spawn after the swap");
  }
});

test("a post-selection selected-skill symlink swap fails before any spawn", { skip: process.platform === "win32" }, async () => {
  const { policyDir, skillsRoot, root } = await fixtureResourcePolicy();
  const resourceSelection = buildDelegateResourceSelection(
    readResourcesFile(path.join(policyDir, "resources.json")),
    ["alpha"],
  );
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    { "opencode-go/muse-spark-1.2-contributor": "complete" },
    { argvLog: true, spawnMarker: true },
  );
  // Replace the selected alpha skill directory with an outside-root symlink
  // after selection: the catalog pre-spawn verifier checks the selection's
  // skills as a fail-closed precondition (the catalog argv stays alias-only),
  // so neither a catalog preflight nor a runtime child may spawn.
  const outsideDir = path.join(root, "outside-skill");
  await mkdir(outsideDir);
  await writeFile(path.join(outsideDir, "SKILL.md"), "# outside\n");
  await rm(path.join(skillsRoot, "alpha"), { recursive: true });
  await symlink(outsideDir, path.join(skillsRoot, "alpha"));
  await assertCreatesNoArtifact(() => runDelegate(baseOptions(fixture, { resourceSelection })));
  await assert.rejects(() => stat(fixture.spawnMarkerPath!), enoent);
  await assert.rejects(() => stat(path.join(fixture.root, "argv.jsonl")), enoent);
});

test("a post-selection selected-skill SKILL.md removal fails before any spawn", async () => {
  const { policyDir, skillsRoot } = await fixtureResourcePolicy();
  const resourceSelection = buildDelegateResourceSelection(
    readResourcesFile(path.join(policyDir, "resources.json")),
    ["alpha"],
  );
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    { "opencode-go/muse-spark-1.2-contributor": "complete" },
    { argvLog: true, spawnMarker: true },
  );
  // Remove the selected alpha SKILL.md after selection: the catalog
  // pre-spawn verifier must fail closed before the first catalog spawn, so
  // no catalog or runtime child command line exists.
  await rm(path.join(skillsRoot, "alpha", "SKILL.md"));
  await assertCreatesNoArtifact(() => runDelegate(baseOptions(fixture, { resourceSelection })));
  await assert.rejects(() => stat(fixture.spawnMarkerPath!), enoent);
  await assert.rejects(() => stat(path.join(fixture.root, "argv.jsonl")), enoent);
});

test("runtime sources contain no tree-fingerprint capture, read-only-mutation state, or backend schema", async () => {
  // Global pre/post Git tree fingerprints were removed because shared
  // monorepo worktrees change concurrently under unrelated agents, so a
  // before/after fingerprint cannot attribute the actor. The routine backend
  // parameter was replaced by the exceptional routingOverride. Keep the
  // runtime surface free of all three.
  for (const file of [
    "artifacts.ts", "diagnostics.ts", "index.ts", "manager.ts", "monitor.ts",
    "render.ts", "result.ts", "routes.ts", "routing.ts", "runner.ts", "supervisor.ts", "types.ts",
  ]) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    for (const forbidden of [
      "read_only_mutation", "tree_fingerprint_changed", "TreeFingerprint",
      "captureTreeFingerprint", "fingerprintsEqual", "hashUntrackedFiles",
      "fingerprintBefore", "fingerprintAfter",
      "DelegateBackend", "DELEGATE_BACKENDS",
      // The removed parent-provider option must stay absent from runtime
      // sources; the key is assembled so this scan file carries no literal.
      ["parent", "Provider"].join(""),
    ]) {
      assert.ok(!source.includes(forbidden), `${file} must not contain "${forbidden}"`);
    }
  }
});
