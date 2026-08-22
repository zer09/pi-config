import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPrivateDirectory } from "./artifacts.ts";
import { RECOVERY_PROMPT } from "./protocol.ts";
import { supervisePi } from "./supervisor.ts";
import type { DelegateProgress, PiRoute } from "./types.ts";

const ROUTE: PiRoute = { kind: "pi", provider: "fake", model: "model", thinking: "high" };

async function fixture(scriptBody: string, prompt = "test"): Promise<{
  root: string;
  promptPath: string;
  invocation: { command: string; prefixArgs: string[] };
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-rpc-test-"));
  const scriptPath = path.join(root, "fake-pi.mjs");
  const promptPath = path.join(root, "prompt.md");
  await writeFile(scriptPath, scriptBody, { mode: 0o700 });
  await chmod(scriptPath, 0o700);
  await writeFile(promptPath, prompt, { mode: 0o600 });
  return { root, promptPath, invocation: { command: process.execPath, prefixArgs: [scriptPath] } };
}

function eventScript(rounds: readonly (readonly unknown[])[], options: {
  rejectRound?: number;
  trailing?: string;
  earlyEvents?: boolean;
  keepAlive?: boolean;
} = {}): string {
  return `
import { appendFileSync, writeFileSync } from "node:fs";
writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));
let buffer = "";
let round = 0;
const rounds = ${JSON.stringify(rounds)};
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    round += 1;
    appendFileSync("commands.jsonl", JSON.stringify({ pid: process.pid, command }) + "\\n");
    const events = rounds[round - 1] ?? [];
    if (${options.earlyEvents === true}) for (const event of events) process.stdout.write(JSON.stringify(event) + "\\n");
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: round !== ${options.rejectRound ?? -1}, ...(round === ${options.rejectRound ?? -1} ? { error: "PRIVATE PROVIDER BILLING TEXT" } : {}) }) + "\\n");
    if (!${options.earlyEvents === true} && round !== ${options.rejectRound ?? -1}) for (const event of events) process.stdout.write(JSON.stringify(event) + "\\n");
    ${options.trailing ? `if (round === rounds.length) process.stdout.write(${JSON.stringify(options.trailing)});` : ""}
  }
});
${options.keepAlive === false ? "" : "setInterval(() => {}, 1000);"}
`;
}

function completed(report = "Final report\n\nDELEGATE_RESULT: COMPLETED"): unknown[] {
  return [
    { type: "agent_start" },
    { type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: report }] } },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
}

function missing(): unknown[] {
  return [{ type: "agent_start" }, { type: "agent_end", willRetry: false }, { type: "agent_settled" }];
}

async function run(script: string, overrides: Partial<Parameters<typeof supervisePi>[0]> = {}, prompt = "test") {
  const built = await fixture(script, prompt);
  const attemptDir = path.join(built.root, "attempt");
  await createPrivateDirectory(attemptDir);
  const progress: DelegateProgress[] = [];
  const status = await supervisePi({
    label: "test",
    role: "review-a",
    attempt: 1,
    cwd: built.root,
    artifactDir: attemptDir,
    promptPath: built.promptPath,
    route: ROUTE,
    piInvocation: built.invocation,
    timeoutMs: 2000,
    idleWarningMs: 100,
    idleTimeoutMs: 500,
    maxOutputBytes: 1024 * 1024,
    graceMs: 100,
    onProgress: (value) => progress.push(value),
    ...overrides,
  });
  return { status, progress, attemptDir, root: built.root };
}

test("uses Pi RPC arguments and one prompt for normal success", async () => {
  const events = [
    { type: "agent_start" },
    { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "PRIVATE_THOUGHT" } },
    { type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "PRIVATE_PATH" } },
    { type: "tool_execution_end", toolCallId: "1", toolName: "read", result: { content: "PRIVATE_RESULT" } },
    ...completed().slice(1),
  ];
  const { status, root, attemptDir } = await run(eventScript([events]));
  assert.equal(status.state, "completed");
  assert.equal(status.protocol, "pi-rpc");
  assert.equal(status.reportNudgeCount, 0);
  const args = JSON.parse(await readFile(path.join(root, "args.json"), "utf8")) as string[];
  assert.ok(args.includes("rpc"));
  assert.ok(args.includes("--no-session"));
  assert.ok(args.includes("--approve"));
  assert.ok(!args.some((arg) => arg.startsWith("@")));
  const commands = (await readFile(path.join(root, "commands.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command.id, "prompt-1");
  const persisted = JSON.stringify(status) + await readFile(path.join(attemptDir, "report.md"), "utf8");
  assert.doesNotMatch(persisted, /PRIVATE_THOUGHT|PRIVATE_PATH|PRIVATE_RESULT/);
});

test("one persistent child PID handles exact initial and recovery prompts", async () => {
  const { status, root, attemptDir, progress } = await run(eventScript([
    completed("first invalid report"),
    completed("Recovered report\n\nDELEGATE_RESULT: COMPLETED"),
  ]), {}, "ORIGINAL PRIVATE TASK");
  assert.equal(status.state, "completed");
  assert.equal(status.reportNudgeCount, 1);
  assert.equal(status.reportRecoveryReason, "invalid_result");
  assert.equal(status.reportRound, 2);
  assert.equal(status.agentStartCount, 2);
  assert.ok(progress.some((item) => item.reportRound === 2));
  const commands = (await readFile(path.join(root, "commands.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(commands.length, 2);
  assert.equal(commands[0].pid, commands[1].pid);
  assert.deepEqual(commands.map((item) => item.command.id), ["prompt-1", "prompt-2"]);
  assert.equal(commands[0].command.message, "ORIGINAL PRIVATE TASK");
  assert.equal(commands[1].command.message, RECOVERY_PROMPT);
  const report = await readFile(path.join(attemptDir, "report.md"), "utf8");
  assert.match(report, /^Recovered report/m);
  assert.doesNotMatch(report, /first invalid/);
});

test("accepts bounded lifecycle events that arrive before prompt acceptance", async () => {
  const { status } = await run(eventScript([completed()], { earlyEvents: true }));
  assert.equal(status.state, "completed");
  assert.equal(status.streamErrors.length, 0);
});

test("missing report twice receives exactly one recovery prompt", async () => {
  const { status, root } = await run(eventScript([missing(), missing()]));
  assert.equal(status.state, "missing_report");
  assert.equal(status.reportNudgeCount, 1);
  assert.equal(status.reportRound, 2);
  const commands = (await readFile(path.join(root, "commands.jsonl"), "utf8")).trim().split("\n");
  assert.equal(commands.length, 2);
});

test("rejected initial and recovery prompts fail closed without another nudge", async () => {
  const initial = await run(eventScript([], { rejectRound: 1 }));
  assert.equal(initial.status.state, "prompt_rejected");
  assert.equal(initial.status.reportNudgeCount, 0);

  const recovery = await run(eventScript([missing()], { rejectRound: 2 }));
  assert.equal(recovery.status.state, "prompt_rejected");
  assert.equal(recovery.status.reportNudgeCount, 1);
  assert.equal(recovery.status.reportRecoveryAccepted, false);
});

test("typed depleted-credit failure gets no recovery prompt", async () => {
  const events = [
    { type: "agent_start" },
    { type: "message_update", assistantMessageEvent: { type: "error", errorMessage: "credit balance depleted PRIVATE 4.21" } },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
  const { status, root } = await run(eventScript([events]));
  assert.equal(status.state, "provider_failed");
  assert.equal(status.providerFailureCategory, "credits_exhausted");
  assert.equal(status.reportNudgeCount, 0);
  assert.equal((await readFile(path.join(root, "commands.jsonl"), "utf8")).trim().split("\n").length, 1);
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE|4\.21/);
});

test("provider failure after a tool remains provider_failed and records work", async () => {
  const events = [
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "PRIVATE" } },
    { type: "message_update", assistantMessageEvent: { type: "error" } },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
  const { status } = await run(eventScript([events]));
  assert.equal(status.state, "provider_failed");
  assert.equal(status.toolExecutionCount, 1);
  assert.equal(status.reportNudgeCount, 0);
});

test("extension UI dialog requests are cancelled and cannot block", async () => {
  const script = `
import { appendFileSync } from "node:fs";
let buffer = "";
let prompted = false;
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const i = buffer.indexOf("\\n"); const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    if (!line) continue;
    const value = JSON.parse(line);
    appendFileSync("input.jsonl", JSON.stringify(value) + "\\n");
    if (value.type === "prompt" && !prompted) {
      prompted = true;
      process.stdout.write(JSON.stringify({ id: value.id, type: "response", command: "prompt", success: true }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "ui-1", method: "confirm", message: "PRIVATE" }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "ui-2", method: "notify", message: "PRIVATE" }) + "\\n");
    } else if (value.type === "extension_ui_response") {
      for (const event of ${JSON.stringify(completed())}) process.stdout.write(JSON.stringify(event) + "\\n");
    }
  }
});
setInterval(() => {}, 1000);
`;
  const { status, root } = await run(script);
  assert.equal(status.state, "completed");
  const input = await readFile(path.join(root, "input.jsonl"), "utf8");
  assert.match(input, /"type":"extension_ui_response","id":"ui-1","cancelled":true/);
  assert.equal((input.match(/extension_ui_response/g) ?? []).length, 1);
});

test("cancellation during a round terminates the process group", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const { status } = await run(eventScript([[{ type: "agent_start" }]]), { signal: controller.signal, idleTimeoutMs: 1000 });
  assert.equal(status.state, "interrupted");
});

test("cancellation during recovery keeps one manager attempt and kills the child", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  const { status } = await run(eventScript([missing(), [{ type: "agent_start" }]]), {
    signal: controller.signal,
    idleTimeoutMs: 1000,
  });
  assert.equal(status.state, "interrupted");
  assert.equal(status.reportNudgeCount, 1);
  assert.equal(status.reportRound, 2);
});

test("child exit during recovery fails closed", async () => {
  const script = `
let buffer = ""; let round = 0;
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const i = buffer.indexOf("\\n"); const command = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    round += 1;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    if (round === 1) {
      process.stdout.write(JSON.stringify({ type: "agent_end", willRetry: false }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
    } else process.exit(1);
  }
});
`;
  const { status } = await run(script);
  assert.equal(status.reportNudgeCount, 1);
  assert.notEqual(status.state, "completed");
  assert.notEqual(status.state, "routes_unavailable");
});

test("the wall deadline does not reset for recovery", async () => {
  const script = `
let buffer = ""; let round = 0;
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const i = buffer.indexOf("\\n"); const command = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    round += 1;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    if (round === 1) setTimeout(() => {
      process.stdout.write(JSON.stringify({ type: "agent_end", willRetry: false }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
    }, 150);
  }
});
setInterval(() => {}, 1000);
`;
  const { status } = await run(script, { timeoutMs: 300, idleWarningMs: 200, idleTimeoutMs: 1000 });
  assert.equal(status.state, "timed_out");
  assert.equal(status.reportNudgeCount, 1);
  assert.ok(status.elapsedSeconds < 0.45, `deadline reset unexpectedly: ${status.elapsedSeconds}s`);
});

test("output bytes accumulate across the initial and recovery commands", async () => {
  const { status } = await run(eventScript([
    completed(`${"x".repeat(600)} invalid`),
    missing(),
  ]), { maxOutputBytes: 1400 });
  assert.equal(status.state, "output_limit");
  assert.equal(status.reportNudgeCount, 1);
});

test("a fast burst exceeding 50 MiB cannot bypass the cumulative output limit", async () => {
  const script = `
let buffer = "";
process.stdout.on("error", () => {});
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  const delta = "x".repeat(1024 * 1024);
  const event = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } }) + "\\n";
  for (let index = 0; index < 51; index += 1) process.stdout.write(event);
});
setInterval(() => {}, 1000);
`;
  const { status } = await run(script, {
    timeoutMs: 5000,
    idleTimeoutMs: 4000,
    maxOutputBytes: 50 * 1024 * 1024,
  });
  assert.equal(status.state, "output_limit");
  assert.ok(status.outputBytes > 50 * 1024 * 1024);
});

test("natural completion removes a leftover descendant process", { skip: process.platform !== "linux" }, async () => {
  const script = `
import { spawn } from "node:child_process";
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  const child = spawn("sleep", ["10"]);
  console.error("DESCENDANT=" + child.pid);
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  for (const event of ${JSON.stringify(completed())}) process.stdout.write(JSON.stringify(event) + "\\n");
});
setInterval(() => {}, 1000);
`;
  const { status, attemptDir } = await run(script);
  assert.equal(status.state, "completed");
  const stderr = await readFile(path.join(attemptDir, "stderr.log"), "utf8");
  const pid = Number(/DESCENDANT=(\d+)/.exec(stderr)?.[1]);
  assert.ok(Number.isSafeInteger(pid));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test("partial trailing JSON fails a completed lifecycle closed", async () => {
  const { status } = await run(eventScript([completed()], { trailing: "{" }));
  assert.equal(status.state, "invalid_stream");
  assert.ok(status.streamErrors.includes("rpc_partial_record"));
});
