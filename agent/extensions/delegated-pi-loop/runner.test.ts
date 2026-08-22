import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { finalizeDelegateRun } from "./result.ts";
import { runDelegate } from "./runner.ts";
import type { ToolResult } from "./types.ts";

const execFileAsync = promisify(execFile);
type Behavior = "complete" | "unavailable" | "credit" | "tool-unavailable" | "mutate-existing" | "missing-recover" | "missing-provider";

function enoent(error: NodeJS.ErrnoException): boolean {
  return error.code === "ENOENT";
}

async function withDiagnosticsRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-runner-diag-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    return await run(root);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
}

async function fakePi(
  catalog: readonly string[],
  behaviors: Readonly<Record<string, Behavior>>,
): Promise<{ root: string; invocation: { command: string; prefixArgs: string[] } }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-runner-test-"));
  const script = path.join(root, "fake-pi.mjs");
  await writeFile(script, `
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const catalog = ${JSON.stringify(catalog)};
const behaviors = ${JSON.stringify(behaviors)};
if (args.includes("--list-models")) {
  const route = args[args.indexOf("--list-models") + 1];
  if (catalog.includes(route)) {
    const [provider, model] = route.split("/", 2);
    console.log("provider model context max-out thinking images");
    console.log(provider + " " + model + " 272K 128K yes yes");
  }
  process.exit(0);
}
const provider = args[args.indexOf("--provider") + 1];
const model = args[args.indexOf("--model") + 1];
const route = provider + "/" + model;
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
    emit({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "Completed on " + route + ".\\n\\nDELEGATE_RESULT: COMPLETED" }],
      },
    });
    emit({ type: "agent_end", willRetry: false });
    emit({ type: "agent_settled" });
  }
});
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  return { root, invocation: { command: process.execPath, prefixArgs: [script] } };
}

async function runFixture(
  catalog: readonly string[],
  behaviors: Readonly<Record<string, Behavior>>,
) {
  const fixture = await fakePi(catalog, behaviors);
  const updates: string[] = [];
  const result = await runDelegate({
    role: "solution-a",
    backend: "default",
    prompt: "Investigate the fixture without editing it.",
    cwd: fixture.root,
    piInvocation: fixture.invocation,
    timeoutMs: 3000,
    idleWarningMs: 200,
    idleTimeoutMs: 800,
    graceMs: 100,
    onProgress: (progress) => updates.push(`${progress.lastEvent}@${progress.lastEventAt}`),
  });
  return { fixture, result, updates };
}

test("skips an uncatalogued primary and completes on a fresh fallback route", async () => {
  const { result, updates } = await runFixture(
    ["agentrouter/gpt-5.6-sol"],
    { "agentrouter/gpt-5.6-sol": "complete" },
  );
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
  const toolResult = await finalizeDelegateRun(result);
  assert.match(toolResult.content[0]!.text, /## Delegate solution-a completed/);
  assert.equal("diagnosticPath" in (toolResult.details ?? {}), false);
  assert.doesNotMatch(JSON.stringify(toolResult), /delegated-pi-solution-a/);
  // After execute-level assembly every temporary artifact is gone.
  await assert.rejects(() => stat(result.artifactDir), enoent);
});

test("falls back after pre-tool provider unavailability", async () => {
  const { result } = await runFixture(
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "unavailable",
      "agentrouter/gpt-5.6-sol": "complete",
    },
  );
  assert.equal(result.state, "completed");
  assert.equal(result.selectedRoute, "agentrouter/gpt-5.6-sol:max");
  assert.equal(result.attempts[0]?.fallbackReason, "provider_unavailable_before_tools");
});

test("credit exhaustion before tools advances without consuming report recovery", async () => {
  const { result } = await runFixture(
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "credit",
      "agentrouter/gpt-5.6-sol": "complete",
    },
  );
  assert.equal(result.state, "completed");
  assert.equal(result.attempts[0]?.state, "provider_failed");
  assert.equal(result.attempts[0]?.fallbackReason, "provider_unavailable_before_tools");
  assert.equal(result.progress.reportNudgeCount, 0);
});

test("all depleted routes end as routes_unavailable", async () => {
  const catalog = [
    "opencode-go/muse-spark-1.2-contributor",
    "agentrouter/gpt-5.6-sol",
    "tabitoken/claude-opus-5-thinking",
    "seekai/claude-opus-5",
    "gorouter/claude-opus-5-thinking",
  ];
  const behaviors = Object.fromEntries(catalog.map((route) => [route, "credit"])) as Record<string, Behavior>;
  const { result } = await runFixture(catalog, behaviors);
  assert.equal(result.state, "routes_unavailable");
  assert.equal(result.attempts.length, 5);
  assert.ok(result.attempts.every((attempt) => attempt.state === "provider_failed"));
});

test("one route attempt can recover in the same session without fallback", async () => {
  const { result } = await runFixture(
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "missing-recover",
      "agentrouter/gpt-5.6-sol": "complete",
    },
  );
  assert.equal(result.state, "completed");
  assert.equal(result.selectedRoute, "opencode-go/muse-spark-1.2-contributor:xhigh");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.progress.reportNudgeCount, 1);
  assert.equal(result.progress.reportRound, 2);
});

test("no fallback occurs after recovery starts even when the provider then fails", async () => {
  const { result } = await runFixture(
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "missing-provider",
      "agentrouter/gpt-5.6-sol": "complete",
    },
  );
  assert.equal(result.state, "provider_failed");
  assert.equal(result.selectedRoute, "opencode-go/muse-spark-1.2-contributor:xhigh");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.progress.reportNudgeCount, 1);
});

test("does not fall back after any tool execution", async () => {
  const { result } = await runFixture(
    ["opencode-go/muse-spark-1.2-contributor", "agentrouter/gpt-5.6-sol"],
    {
      "opencode-go/muse-spark-1.2-contributor": "tool-unavailable",
      "agentrouter/gpt-5.6-sol": "complete",
    },
  );
  assert.notEqual(result.state, "completed");
  assert.equal(result.selectedRoute, "opencode-go/muse-spark-1.2-contributor:xhigh");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.fallbackReason, undefined);
  // Failure data returns in memory: no chain-level status.json exists and the
  // temporary artifacts survive until execute-level finalization.
  await stat(result.artifactDir);
  await assert.rejects(() => stat(path.join(result.artifactDir, "status.json")), enoent);
  await withDiagnosticsRoot(async (root) => {
    const toolResult: ToolResult = await finalizeDelegateRun(result);
    const diagnosticPath = toolResult.details?.diagnosticPath;
    assert.equal(typeof diagnosticPath, "string");
    assert.ok((diagnosticPath as string).startsWith(path.join(root, "logs", "delegated-pi-loop")));
    assert.match(toolResult.content[0]!.text, /## Delegate solution-a failed: /);
    assert.doesNotMatch(toolResult.content[0]!.text, /\/tmp\/|diagnostic log/);
    assert.doesNotMatch(JSON.stringify(toolResult.details?.attempts), /artifactDir|\/tmp\//);
    const diagnostic = JSON.parse(await readFile(diagnosticPath as string, "utf8")) as Record<string, unknown>;
    assert.equal("artifactDir" in diagnostic, false);
    assert.doesNotMatch(JSON.stringify(diagnostic), /\/tmp\/|delegated-pi-solution-a/);
  });
  // After diagnostic persistence and tool-result assembly every temporary
  // artifact is gone, including the unsuccessful run's artifacts.
  await assert.rejects(() => stat(result.artifactDir), enoent);
});

test("D draws one random primary per invocation and records the ordered chain", async () => {
  const fixture = await fakePi(
    ["openai-codex/gpt-5.5"],
    { "openai-codex/gpt-5.5": "complete" },
  );
  let randomCalls = 0;
  const result = await runDelegate({
    role: "solution-d",
    backend: "default",
    prompt: "Investigate the fixture without editing it.",
    cwd: fixture.root,
    // cursor is ineligible, so the injected draw must pick the primary.
    parentProvider: "cursor",
    random: () => {
      randomCalls += 1;
      return 0.7; // floor(0.7 * 5) = 3 -> openai-codex-cgpt2 primary
    },
    piInvocation: fixture.invocation,
    timeoutMs: 3000,
    idleWarningMs: 200,
    idleTimeoutMs: 800,
    graceMs: 100,
  });
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
  const toolResult = await finalizeDelegateRun(result);
  assert.match(toolResult.content[0]!.text, /## Delegate solution-d completed/);
});

test("D inherits the parent's eligible provider as its primary", async () => {
  const fixture = await fakePi(
    ["openai-codex-cgpt3/gpt-5.5"],
    { "openai-codex-cgpt3/gpt-5.5": "complete" },
  );
  const result = await runDelegate({
    role: "review-d",
    backend: "default",
    prompt: "Review only.",
    cwd: fixture.root,
    parentProvider: "openai-codex-cgpt3",
    random: () => 0.99,
    piInvocation: fixture.invocation,
    timeoutMs: 3000,
    idleWarningMs: 200,
    idleTimeoutMs: 800,
    graceMs: 100,
  });
  assert.equal(result.state, "completed");
  assert.equal(result.selectedRoute, "openai-codex-cgpt3/gpt-5.5:medium");
  assert.equal(result.attempts.length, 1);
  assert.match(result.report, /Completed on openai-codex-cgpt3\/gpt-5\.5/);
  await finalizeDelegateRun(result);
});

test("oracle records its fallback chain", async () => {
  const fixture = await fakePi(
    ["openai-codex/gpt-5.6-sol"],
    { "openai-codex/gpt-5.6-sol": "complete" },
  );
  let randomCalls = 0;
  const result = await runDelegate({
    role: "oracle",
    backend: "default",
    prompt: "Review the draft contract without editing it.",
    cwd: fixture.root,
    parentProvider: "cursor",
    random: () => {
      randomCalls += 1;
      return 0.7; // floor(0.7 * 5) = 3 -> openai-codex-cgpt2 primary
    },
    piInvocation: fixture.invocation,
    timeoutMs: 3000,
    idleWarningMs: 200,
    idleTimeoutMs: 800,
    graceMs: 100,
  });
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
  const toolResult = await finalizeDelegateRun(result);
  assert.match(toolResult.content[0]!.text, /## Delegate oracle completed/);
});

test("a main-Sol parent is rejected before any oracle child spawns on any provider", async () => {
  const fixture = await fakePi(
    ["openai-codex/gpt-5.6-sol"],
    { "openai-codex/gpt-5.6-sol": "complete" },
  );
  // The skip fires even though the serving parent provider is oracle-eligible:
  // detection reads the parent model id only.
  await assert.rejects(
    () => runDelegate({
      role: "oracle",
      backend: "default",
      prompt: "Review only.",
      cwd: fixture.root,
      parentProvider: "openai-codex",
      parentModelId: "gpt-5.6-sol",
      piInvocation: fixture.invocation,
      timeoutMs: 3000,
      idleWarningMs: 200,
      idleTimeoutMs: 800,
      graceMs: 100,
    }),
    (error: unknown) => {
      assert.match((error as Error).message, /Skip the oracle role.*gpt-5\.6-sol.*finalize the solution contract directly/);
      return true;
    },
  );
  // A non-Sol parent model proceeds through the same invocation.
  const allowed = await runDelegate({
    role: "oracle",
    backend: "default",
    prompt: "Review only.",
    cwd: fixture.root,
    parentProvider: "openai-codex",
    parentModelId: "gpt-5.5",
    piInvocation: fixture.invocation,
    timeoutMs: 3000,
    idleWarningMs: 200,
    idleTimeoutMs: 800,
    graceMs: 100,
  });
  assert.equal(allowed.state, "completed");
  await finalizeDelegateRun(allowed);
});

test("an explicit oracle backend is rejected before any child spawns", async () => {
  const fixture = await fakePi(
    ["zai/glm-5.3", "openai-codex/gpt-5.6-sol"],
    { "zai/glm-5.3": "complete", "openai-codex/gpt-5.6-sol": "complete" },
  );
  await assert.rejects(
    () => runDelegate({
      role: "oracle",
      backend: "zai",
      prompt: "Review only.",
      cwd: fixture.root,
      parentProvider: "zai",
      piInvocation: fixture.invocation,
      timeoutMs: 3000,
      idleWarningMs: 200,
      idleTimeoutMs: 800,
      graceMs: 100,
    }),
    /backend=zai must not replace gpt-5\.6-sol/,
  );
});

test("a read-only delegate that changes the Git tree still completes without invalidation", async () => {
  const fixture = await fakePi(
    ["opencode-go/muse-spark-1.2-contributor"],
    { "opencode-go/muse-spark-1.2-contributor": "mutate-existing" },
  );
  await execFileAsync("git", ["-C", fixture.root, "init", "-q"]);
  await writeFile(path.join(fixture.root, "existing-untracked.txt"), "before");
  const result = await runDelegate({
    role: "review-a",
    backend: "default",
    prompt: "Review only.",
    cwd: fixture.root,
    piInvocation: fixture.invocation,
    timeoutMs: 3000,
    idleWarningMs: 200,
    idleTimeoutMs: 800,
    graceMs: 100,
  });
  // The working tree changed during the read-only run, but the removed
  // global fingerprint check no longer attributes the change to the
  // delegate: the completed report survives and no invalidation state exists.
  assert.equal(result.state, "completed");
  assert.match(result.report, /Completed on opencode-go\/muse-spark-1\.2-contributor/);
  assert.notEqual(result.progress.lastEvent, "tree_fingerprint_changed");
  assert.equal("fingerprintBefore" in result, false);
  assert.equal("fingerprintAfter" in result, false);
  assert.equal(await readFile(path.join(fixture.root, "existing-untracked.txt"), "utf8"), "after");
  const toolResult = await finalizeDelegateRun(result);
  assert.match(toolResult.content[0]!.text, /## Delegate review-a completed/);
});

test("runtime sources contain no tree-fingerprint capture or read-only-mutation state", async () => {
  // Global pre/post Git tree fingerprints were removed because shared
  // monorepo worktrees change concurrently under unrelated agents, so a
  // before/after fingerprint cannot attribute the actor. Keep the runtime
  // surface free of reintroduced capture, comparison, and result plumbing.
  for (const file of [
    "artifacts.ts", "diagnostics.ts", "index.ts", "manager.ts", "monitor.ts",
    "render.ts", "result.ts", "routes.ts", "runner.ts", "supervisor.ts", "types.ts",
  ]) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    for (const forbidden of [
      "read_only_mutation", "tree_fingerprint_changed", "TreeFingerprint",
      "captureTreeFingerprint", "fingerprintsEqual", "hashUntrackedFiles",
      "fingerprintBefore", "fingerprintAfter",
    ]) {
      assert.ok(!source.includes(forbidden), `${file} must not contain "${forbidden}"`);
    }
  }
});
