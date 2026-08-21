import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runDelegate } from "./runner.ts";

const execFileAsync = promisify(execFile);
type Behavior = "complete" | "unavailable" | "tool-unavailable" | "mutate-existing";

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
  const status = JSON.parse(await readFile(result.statusPath, "utf8"));
  assert.equal(status.selectedRoute, "agentrouter/gpt-5.6-sol:max");
  assert.equal("command" in status, false);
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
});
