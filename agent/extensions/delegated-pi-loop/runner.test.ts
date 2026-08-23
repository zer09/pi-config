import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RESTART_AFTER_WORK_NOTE } from "./routes.ts";
import { validateRoutingConfig } from "./routing.ts";
import { finalizeDelegateRun } from "./result.ts";
import { isOperationalFailureState, runDelegate } from "./runner.ts";
import { terminationProbes } from "./supervisor.ts";
import { DELEGATE_ROLES } from "./types.ts";
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
  | "hang";

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
  options: { catalogDelayMs?: number; catalogDelayRoute?: string; spawnMarker?: boolean; supervisionLog?: boolean } = {},
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
const catalogDelayMs = ${options.catalogDelayMs ?? 0};
const catalogDelayRoute = ${JSON.stringify(options.catalogDelayRoute ?? null)};
const spawnMarkerPath = ${JSON.stringify(spawnMarkerPath ?? null)};
const supervisionLog = ${options.supervisionLog === true};
if (spawnMarkerPath) writeFileSync(spawnMarkerPath, String(process.pid));
if (args.includes("--list-models")) {
  const route = args[args.indexOf("--list-models") + 1];
  const respond = () => {
    if (catalog.includes(route)) {
      const [provider, model] = route.split("/", 2);
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
    timeoutMs: 3000,
    idleWarningMs: 200,
    idleTimeoutMs: 800,
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
    version: 1,
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
    roles: Object.fromEntries(DELEGATE_ROLES.map((role) => [role, { profile: "two-tier-oracle" }])),
    oracleSafety: { selfReviewModelIds: ["model-x", "model-y"] },
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
    const [provider, model] = route.split("/", 2);
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
    const [provider, model] = route.split("/", 2);
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
    "provider_failed", "stalled", "timed_out", "output_limit", "prompt_rejected",
    "invalid_result", "invalid_stream", "missing_report", "child_failed", "spawn_failed",
  ]) {
    assert.equal(isOperationalFailureState(state as never), true, state);
  }
  // Completed runs, intentional delegate outcomes, interruption, catalog
  // skips, and unproven process-group cleanup never take the operational
  // fallback path.
  for (const state of ["completed", "blocked", "delegate_failed", "interrupted", "catalog_unavailable", "cleanup_failed"]) {
    assert.equal(isOperationalFailureState(state as never), false, state);
  }
});

test("skips an uncatalogued primary and completes on a fresh fallback route", async () => {
  const fixture = await fakePi(
    ["agentrouter/gpt-5.6-sol"],
    { "agentrouter/gpt-5.6-sol": "complete" },
  );
  const updates: string[] = [];
  const toolResult = await runAndFinalize(
    baseOptions(fixture, {
      onProgress: (progress) => updates.push(`${progress.lastEvent}@${progress.lastEventAt}`),
    }),
    async (result, finalize) => {
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "agentrouter/gpt-5.6-sol:max");
      assert.equal(result.attempts[0]?.state, "catalog_unavailable");
      assert.match(result.report, /Completed on agentrouter\/gpt-5\.6-sol/);
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
  assert.match(toolResult.content[0]!.text, /## Delegate solution-a completed/);
  assert.equal("diagnosticPath" in (toolResult.details ?? {}), false);
  assert.doesNotMatch(JSON.stringify(toolResult), /delegated-pi-solution-a/);
});

test("falls back after pre-tool provider unavailability", async () => {
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "unavailable",
      "agentrouter/gpt-5.6-sol": "complete",
    },
  );
  await runAndFinalize(baseOptions(fixture), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.selectedRoute, "agentrouter/gpt-5.6-sol:max");
    assert.equal(result.attempts[0]?.state, "provider_failed");
    assert.equal(result.attempts[0]?.restartAfterWork, undefined);
    assert.equal(result.progress.restartAfterWorkCount, 0);
  });
});

test("credit exhaustion before tools advances without consuming report recovery", async () => {
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "credit",
      "agentrouter/gpt-5.6-sol": "complete",
    },
  );
  await runAndFinalize(baseOptions(fixture), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.attempts[0]?.state, "provider_failed");
    assert.equal(result.progress.reportNudgeCount, 0);
  });
});

test("an exhausted operational chain ends as routes_unavailable", async () => {
  const catalog = [
    "opencode-go/muse-spark-1.2-contributor",
    "agentrouter/gpt-5.6-sol",
    "tabitoken/claude-opus-5-thinking",
    "seekai/claude-opus-5",
    "gorouter/claude-opus-5-thinking",
  ];
  const behaviors = Object.fromEntries(catalog.map((route) => [route, "credit"])) as Record<string, Behavior>;
  const fixture = await fakePi(catalog, behaviors);
  const toolResult = await runAndFinalize(baseOptions(fixture), async (result, finalize) => {
    assert.equal(result.state, "routes_unavailable");
    assert.equal(result.attempts.length, 5);
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
    assert.match(created[0]!, /^failure-solution-a-/);
    const diagnosticPath = toolResult.details?.diagnosticPath;
    assert.equal(typeof diagnosticPath, "string");
    assert.ok((diagnosticPath as string).startsWith(diagnosticsDirectory + path.sep));
    return toolResult;
  });
  assert.equal(toolResult.details?.state, "routes_unavailable");
});

test("one route attempt can recover in the same session without fallback", async () => {
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "missing-recover",
      "agentrouter/gpt-5.6-sol": "complete",
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
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "missing-provider",
      "agentrouter/gpt-5.6-sol": "complete",
    },
  );
  await runAndFinalize(baseOptions(fixture), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.selectedRoute, "agentrouter/gpt-5.6-sol:max");
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0]?.state, "provider_failed");
    // Recovery was accepted on the first route, so the restart note was applied.
    assert.equal(result.attempts[0]?.restartAfterWork, true);
    assert.equal(result.progress.restartAfterWorkCount, 1);
    assert.match(result.report, /Completed on agentrouter\/gpt-5\.6-sol/);
    const prompt = await readFile(path.join(result.artifactDir, "prompt.md"), "utf8");
    assert.equal(prompt.split(RESTART_AFTER_WORK_NOTE).length - 1, 1);
  });
});

test("operational failure after tool execution falls back with the restart note", async () => {
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "tool-unavailable",
      "agentrouter/gpt-5.6-sol": "complete",
    },
  );
  await runAndFinalize(baseOptions(fixture), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.selectedRoute, "agentrouter/gpt-5.6-sol:max");
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0]?.state, "provider_failed");
    assert.equal(result.attempts[0]?.restartAfterWork, true);
    assert.equal(result.progress.restartAfterWorkCount, 1);
    assert.match(result.report, /Completed on agentrouter\/gpt-5\.6-sol/);
    // Failure data returns in memory: no chain-level status.json exists and the
    // temporary artifacts survive until execute-level finalization.
    await stat(result.artifactDir);
    await assert.rejects(() => stat(path.join(result.artifactDir, "status.json")), enoent);
  });
});

test("the restart note is private, sanitized, and never stacks across restarts", async () => {
  const catalog = [
    "opencode-go/muse-spark-1.2-contributor",
    "agentrouter/gpt-5.6-sol",
    "tabitoken/claude-opus-5-thinking",
  ];
  const behaviors: Record<string, Behavior> = {
    "opencode-go/muse-spark-1.2-contributor": "tool-unavailable",
    "agentrouter/gpt-5.6-sol": "tool-unavailable",
    "tabitoken/claude-opus-5-thinking": "complete",
  };
  const fixture = await fakePi(catalog, behaviors);
  await runAndFinalize(baseOptions(fixture), async (result) => {
    assert.equal(result.state, "completed");
    assert.equal(result.attempts.length, 3);
    assert.equal(result.attempts[0]?.restartAfterWork, true);
    assert.equal(result.attempts[1]?.restartAfterWork, true);
    assert.equal(result.attempts[2]?.restartAfterWork, undefined);
    assert.equal(result.progress.restartAfterWorkCount, 2);
    const prompt = await readFile(path.join(result.artifactDir, "prompt.md"), "utf8");
    // Two advances happened, but the note is rebuilt from the original
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
      ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
      {
        "opencode-go/muse-spark-1.2-contributor": behavior,
        "agentrouter/gpt-5.6-sol": "complete",
      },
    );
    await runAndFinalize(baseOptions(fixture), async (result) => {
      assert.equal(result.state, expectedState);
      assert.equal(result.attempts.length, 1);
      assert.equal(result.selectedRoute, "opencode-go/muse-spark-1.2-contributor:xhigh");
      assert.match(result.report, /DELEGATE_RESULT: (BLOCKED|FAILED)/);
      assert.equal(result.progress.restartAfterWorkCount, 0);
    });
  }
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
      // cursor is ineligible, so the injected draw must pick the primary.
      parentProvider: "cursor",
      random: () => {
        randomCalls += 1;
        return 0.45; // floor(0.45 * 7) = 3 -> openai-codex-cgpt2 primary
      },
    }),
    async (result, finalize) => {
      assert.equal(randomCalls, 1);
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "openai-codex/gpt-5.5:medium");
      // The uncatalogued random primary is skipped by catalog preflight; the
      // selected and remaining routes return through the existing attempt chain.
      assert.deepEqual(result.attempts.map((attempt) => attempt.route), [
        "openai-codex-cgpt2/gpt-5.5:medium",
        "openai-codex/gpt-5.5:medium",
      ]);
      assert.equal(result.attempts[0]?.state, "catalog_unavailable");
      return finalize();
    },
  );
  assert.match(toolResult.content[0]!.text, /## Delegate solution-d completed/);
});

test("D inherits the parent's eligible provider as its primary", async () => {
  const fixture = await fakePi(
    ["openai-codex-cgpt4/gpt-5.5"],
    { "openai-codex-cgpt4/gpt-5.5": "complete" },
  );
  await runAndFinalize(
    baseOptions(fixture, {
      role: "review-d",
      prompt: "Review only.",
      parentProvider: "openai-codex-cgpt4",
      random: () => 0.99,
    }),
    async (result) => {
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "openai-codex-cgpt4/gpt-5.5:medium");
      assert.equal(result.attempts.length, 1);
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
      parentProvider: "cursor",
      random: () => {
        randomCalls += 1;
        return 0.45; // floor(0.45 * 7) = 3 -> openai-codex-cgpt2 primary
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
    // The skip fires even though the serving parent provider is oracle-eligible:
    // detection reads the parent model id only.
    parentProvider: "openai-codex",
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
    version: 1,
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
    roles: Object.fromEntries(DELEGATE_ROLES.map((role) => [role, { profile: "solo" }])),
    oracleSafety: { selfReviewModelIds: ["model-x"] },
  });
}

test("catalog preflight time is deducted from the shared wall deadline", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x"],
    { "prov-a/model-x": "hang" },
    { catalogDelayMs: 700 },
  );
  await runAndFinalize(
    baseOptions(fixture, {
      routingConfig: singleRouteRoutingConfig(),
      timeoutMs: 1200,
      idleWarningMs: 200,
      idleTimeoutMs: 1100,
    }),
    async (result) => {
      // The delayed catalog preflight consumed most of the 1200 ms wall budget,
      // so the supervisor ran the hanging child on the recomputed remainder and
      // the total stayed near the shared deadline instead of budget plus delay.
      // A single-route chain is exhausted after its supervised timeout, so the
      // chain outcome is the safe routes_unavailable; chain-level timed_out is
      // reserved for cumulative-deadline exhaustion.
      assert.equal(result.state, "routes_unavailable");
      assert.equal(result.attempts.length, 1);
      assert.equal(result.attempts[0]?.state, "timed_out");
      assert.equal(result.attempts[0]?.route, "prov-a/model-x:high");
      assert.ok(
        result.attempts[0]!.elapsedSeconds < 0.9,
        `the supervisor must run on the recomputed budget, got ${result.attempts[0]!.elapsedSeconds}`,
      );
      assert.ok(
        result.elapsedSeconds < 1.7,
        `total elapsed must stay near the shared deadline, got ${result.elapsedSeconds}`,
      );
      assert.ok(result.elapsedSeconds >= 0.7, "the delayed catalog preflight must have run");
    },
  );
});

test("a timed-out non-final route advances to complete within the cumulative deadline", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-a/model-y"],
    { "prov-a/model-x": "hang", "prov-a/model-y": "complete" },
  );
  await runAndFinalize(
    baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      timeoutMs: 2000,
      idleWarningMs: 400,
      idleTimeoutMs: 1900,
    }),
    async (result) => {
      // The first route hangs. Its soft share is half of the current cumulative
      // remainder (about 1000 ms), so it records timed_out while cumulative time
      // remains and the second route still completes on its reserved share. The
      // total stays inside the cumulative deadline plus scheduler and
      // termination tolerance instead of one route spending the whole budget.
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "prov-a/model-y:low");
      assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["timed_out", "completed"]);
      assert.equal(result.attempts[0]?.route, "prov-a/model-x:high");
      assert.equal(result.attempts[0]?.restartAfterWork, undefined);
      assert.ok(
        result.attempts[0]!.elapsedSeconds >= 0.8,
        `the hanging route must run until its soft share, got ${result.attempts[0]!.elapsedSeconds}`,
      );
      assert.ok(
        result.attempts[0]!.elapsedSeconds < 1.6,
        `the hanging route must not exceed its soft share plus termination tolerance, got ${result.attempts[0]!.elapsedSeconds}`,
      );
      assert.ok(
        result.elapsedSeconds < 3.0,
        `total must stay within the cumulative deadline plus tolerance, got ${result.elapsedSeconds}`,
      );
    },
  );
});

test("a share that cannot fit the mandatory reserve records a soft timeout and advances", async () => {
  // Route one's catalog preflight is delayed until its remaining supervision
  // share is smaller than the mandatory forced-kill-plus-cleanup reserve, so
  // supervisePi must record the soft timeout without spawning any child; the
  // non-final route then advances and route two completes on its reserved
  // share.
  const fixture = await fakePi(
    ["prov-a/model-x", "prov-a/model-y"],
    { "prov-a/model-x": "hang", "prov-a/model-y": "complete" },
    { catalogDelayMs: 220, catalogDelayRoute: "prov-a/model-x", supervisionLog: true },
  );
  await runAndFinalize(
    baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      timeoutMs: 570,
      idleWarningMs: 150,
      idleTimeoutMs: 500,
    }),
    async (result) => {
      assert.equal(result.state, "completed");
      assert.equal(result.selectedRoute, "prov-a/model-y:low");
      assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["timed_out", "completed"]);
      assert.equal(result.attempts[0]?.route, "prov-a/model-x:high");
      // Exactly one supervised child ever spawned: route two's. Route one
      // never started a child because its share could not fit the reserve.
      const supervisionLog = await readFile(path.join(fixture.root, "supervision-routes.jsonl"), "utf8");
      assert.deepEqual(supervisionLog.trim().split("\n"), ["prov-a/model-y"]);
      assert.ok(result.elapsedSeconds < 0.9, `total must stay near the shared deadline, got ${result.elapsedSeconds}`);
    },
  );
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
      timeoutMs: 3000,
      idleWarningMs: 400,
      idleTimeoutMs: 2800,
      graceMs: 300,
    }));
    const recorded = await waitForFixtureGroup(fixture.root, "resistant-group.json");
    group.leader = recorded.leader;
    group.descendant = recorded.descendant;
    safetyGroups.push({ ...group });
    const toolResult = await settleAndFinalize(
      resultPromise,
      async (result, finalize) => {
        // Route one ran to its soft share, resisted SIGTERM, was SIGKilled,
        // and its group liveness stayed unproven: the chain fails closed with
        // the sanitized terminal state and route two never starts.
        assert.equal(result.state, "cleanup_failed");
        assert.equal(result.selectedRoute, "prov-a/model-x:high");
        assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["cleanup_failed"]);
        assert.equal(result.report, "");
        await assert.rejects(() => stat(path.join(fixture.root, "route-two-start.json")), enoent);
        const toolResult = await finalize();
        assert.match(toolResult.content[0]!.text, /## Delegate solution-a failed: cleanup_failed/);
        // The model-visible failure stays sanitized: no signals, pids, or raw
        // process details from the failed cleanup proof.
        assert.doesNotMatch(toolResult.content[0]!.text, /SIGKILL|SIGTERM|pid|group_alive|close_unconfirmed/i);
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
      timeoutMs: 1200,
      idleWarningMs: 400,
      idleTimeoutMs: 1000,
      graceMs: 300,
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
    assert.ok(performance.now() - settledAt < 1200, "cleanup_failed must settle inside the bounded route share");
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
      timeoutMs: 1200,
      idleWarningMs: 400,
      idleTimeoutMs: 1000,
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
    assert.ok(performance.now() - settledAt < 1200, "catalog cleanup_failed must settle inside the bounded route share");
    assert.ok(await isGone(group.leader), "the catalog leader must already be gone");
    assert.equal(await isGone(group.descendant), false, "the inherited-stdio descendant must still be alive before safety cleanup");
  } finally {
    terminationProbes.build = originalBuild;
    killOwned(group.leader, group.descendant);
  }
});

test("chain-level timed_out occurs only when the cumulative deadline itself is exhausted", async () => {
  const fixture = await fakePi(
    ["prov-a/model-x"],
    { "prov-a/model-x": "hang" },
    { catalogDelayMs: 2000 },
  );
  await runAndFinalize(
    baseOptions(fixture, {
      routingConfig: singleRouteRoutingConfig(),
      timeoutMs: 1200,
      idleWarningMs: 200,
      idleTimeoutMs: 1100,
    }),
    async (result) => {
      // The single final route owns the full remainder; its catalog preflight is
      // stopped at the cumulative deadline, so the chain-level outcome is
      // timed_out and the attempt records the route-budget stop distinct from
      // catalog unavailability.
      assert.equal(result.state, "timed_out");
      assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["timed_out"]);
      assert.equal(result.attempts[0]?.route, "prov-a/model-x:high");
      assert.ok(result.elapsedSeconds >= 1.1, "the catalog preflight must run to the cumulative deadline");
      assert.ok(result.elapsedSeconds < 1.9, `total must stay near the deadline, got ${result.elapsedSeconds}`);
    },
  );
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
      parentProvider: "zai",
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

test("a SIGTERM-resistant supervised route is killed inside its share before route two starts", { skip: process.platform !== "linux" }, async () => {
  const fixture = await resistantPi({ supervisionHangRoute: "prov-a/model-x" });
  const group = { leader: -1, descendant: -1 };
  try {
    const resultPromise = runDelegate(baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      timeoutMs: 3000,
      idleWarningMs: 400,
      idleTimeoutMs: 2800,
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
        // Route one ran to its soft share, resisted SIGTERM, and was SIGKILLed
        // inside the reserved cleanup budget; route two then received its
        // reserved share and completed, all inside the cumulative deadline.
        assert.equal(result.state, "completed");
        assert.equal(result.selectedRoute, "prov-a/model-y:low");
        assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["timed_out", "completed"]);
        assert.ok(
          result.attempts[0]!.elapsedSeconds >= 0.8,
          `the resistant route must run until its soft share, got ${result.attempts[0]!.elapsedSeconds}`,
        );
        assert.ok(
          result.attempts[0]!.elapsedSeconds < 1.9,
          `the resistant route must stay inside its share plus the reserved termination budget, got ${result.attempts[0]!.elapsedSeconds}`,
        );
        // Ordering proof: route two's catalog and supervision children both
        // observed route one's whole process group already dead at their own
        // spawn time, so no two route process groups ever overlapped.
        const start = JSON.parse(await readFile(path.join(fixture.root, "route-two-start.json"), "utf8")) as Record<string, {
          leaderGone: boolean;
          descendantGone: boolean;
        }>;
        for (const phase of ["catalog", "supervision"]) {
          assert.ok(start[phase], `route two's ${phase} child must have recorded the group check`);
          assert.equal(start[phase]!.leaderGone, true, `route one's leader must be dead before route two's ${phase} child starts`);
          assert.equal(start[phase]!.descendantGone, true, `route one's descendant must be dead before route two's ${phase} child starts`);
        }
        assert.ok(
          result.elapsedSeconds < 3.3,
          `total must stay within the cumulative deadline plus scheduler tolerance, got ${result.elapsedSeconds}`,
        );
        assert.ok(result.elapsedSeconds >= 1.2, "route one must have consumed its soft share first");
        assert.ok(await isGone(group.leader), "the SIGTERM-resistant leader must be dead");
        assert.ok(await isGone(group.descendant), "the SIGTERM-resistant descendant must be dead");
      },
    );
  } finally {
    killOwned(group.leader, group.descendant);
  }
});

test("a SIGTERM-resistant catalog preflight is killed at its share before route two starts", { skip: process.platform !== "linux" }, async () => {
  const fixture = await resistantPi({ catalogHangRoute: "prov-a/model-x" });
  const group = { leader: -1, descendant: -1 };
  try {
    const resultPromise = runDelegate(baseOptions(fixture, {
      routingConfig: twoTierOracleRoutingConfig(),
      timeoutMs: 3000,
      idleWarningMs: 400,
      idleTimeoutMs: 2800,
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
        // The hanging catalog preflight is stopped at its soft share: the
        // graceful window cannot fit before the route deadline, so termination
        // escalates immediately to SIGKILL, the group's disappearance is
        // verified, and only then does route two start and complete.
        assert.equal(result.state, "completed");
        assert.equal(result.selectedRoute, "prov-a/model-y:low");
        assert.deepEqual(result.attempts.map((attempt) => attempt.state), ["timed_out", "completed"]);
        assert.equal(result.attempts[0]?.route, "prov-a/model-x:high");
        assert.ok(
          result.attempts[0]!.elapsedSeconds >= 1.3,
          `the catalog preflight must run to its soft share, got ${result.attempts[0]!.elapsedSeconds}`,
        );
        assert.ok(
          result.attempts[0]!.elapsedSeconds < 2.1,
          `the catalog stop and verified group kill must stay near the share, got ${result.attempts[0]!.elapsedSeconds}`,
        );
        const start = JSON.parse(await readFile(path.join(fixture.root, "route-two-start.json"), "utf8")) as Record<string, {
          leaderGone: boolean;
          descendantGone: boolean;
        }>;
        for (const phase of ["catalog", "supervision"]) {
          assert.ok(start[phase], `route two's ${phase} child must have recorded the group check`);
          assert.equal(start[phase]!.leaderGone, true, `route one's leader must be dead before route two's ${phase} child starts`);
          assert.equal(start[phase]!.descendantGone, true, `route one's descendant must be dead before route two's ${phase} child starts`);
        }
        assert.ok(
          result.elapsedSeconds < 3.3,
          `total must stay within the cumulative deadline plus scheduler tolerance, got ${result.elapsedSeconds}`,
        );
        assert.ok(await isGone(group.leader), "the SIGTERM-resistant leader must be dead");
        assert.ok(await isGone(group.descendant), "the SIGTERM-resistant descendant must be dead");
      },
    );
  } finally {
    killOwned(group.leader, group.descendant);
  }
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
    ]) {
      assert.ok(!source.includes(forbidden), `${file} must not contain "${forbidden}"`);
    }
  }
});
