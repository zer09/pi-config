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
type Behavior = "complete" | "unavailable" | "tool-unavailable" | "mutate-existing";

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
emit({ type: "session" });
emit({ type: "agent_start" });
if (behavior === "tool-unavailable") {
  emit({ type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "fixture" } });
}
if (behavior === "unavailable" || behavior === "tool-unavailable") {
  emit({
    type: "message_end",
    message: { role: "assistant", stopReason: "error", content: [], errorMessage: "503 Service unavailable" },
  });
  emit({ type: "agent_end", willRetry: false });
  process.exit(1);
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

test("oracle records its fallback chain and stays read-only through fingerprints", async () => {
  const fixture = await fakePi(
    ["openai-codex/gpt-5.6-sol"],
    { "openai-codex/gpt-5.6-sol": "complete" },
  );
  await execFileAsync("git", ["-C", fixture.root, "init", "-q"]);
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
  // The oracle is read-only: pre/post Git fingerprints are captured and equal.
  assert.ok(result.fingerprintBefore);
  assert.ok(result.fingerprintAfter);
  assert.equal(result.fingerprintBefore?.status, result.fingerprintAfter?.status);
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
  for (const backend of ["zai", "claude"] as const) {
    await assert.rejects(
      () => runDelegate({
        role: "oracle",
        backend,
        prompt: "Review only.",
        cwd: fixture.root,
        parentProvider: "zai",
        piInvocation: fixture.invocation,
        timeoutMs: 3000,
        idleWarningMs: 200,
        idleTimeoutMs: 800,
        graceMs: 100,
      }),
      new RegExp(`backend=${backend} must not replace gpt-5\\.6-sol`),
    );
  }
});

test("invalidates a read-only delegate that changes the Git tree", async () => {
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
  assert.equal(result.state, "read_only_mutation");
  assert.equal(result.progress.lastEvent, "tree_fingerprint_changed");
  // The fingerprint-invalidated run is unsuccessful: its artifacts survive
  // until execute-level finalization and are removed with a diagnostic.
  await stat(result.artifactDir);
  await assert.rejects(() => stat(path.join(result.artifactDir, "status.json")), enoent);
  await withDiagnosticsRoot(async () => {
    const toolResult = await finalizeDelegateRun(result);
    assert.equal(typeof toolResult.details?.diagnosticPath, "string");
  });
  await assert.rejects(() => stat(result.artifactDir), enoent);
});
