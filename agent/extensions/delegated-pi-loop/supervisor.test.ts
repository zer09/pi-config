import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrivateDirectory } from "./artifacts.ts";
import { REPORT_RECOVERY_PROMPT } from "./instructions.ts";
import {
  supervisePi,
  terminateProcessGroupWith,
  terminationProbes,
  type TerminationProbes,
} from "./supervisor.ts";
import type { DelegateProgress, PiRoute } from "./types.ts";

const ROUTE: PiRoute = { kind: "pi", provider: "fake", model: "model", thinking: "high" };

/**
 * Minimal fixed runtime resource fixture so default runs stay valid; the
 * production arrays come from `resources.ts` and the ordering tests below
 * pass their own explicit arrays.
 */
const RUNTIME_RESOURCE_ARGS: readonly string[] = ["--no-extensions", "--no-skills"];

/** Unique fixture roots; removed by exact path after all tests. */
const fixtureRoots: string[] = [];

after(async () => {
  await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function isGone(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

async function fixture(scriptBody: string, prompt = "test"): Promise<{
  root: string;
  promptPath: string;
  invocation: { command: string; prefixArgs: string[] };
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-rpc-test-"));
  fixtureRoots.push(root);
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
    runtimeResourceArgs: RUNTIME_RESOURCE_ARGS,
    verifyRuntimeResources: () => {},
    activityWarningMs: 100,
    activityIdleMs: 500,
    progressWarningMs: 900,
    progressStallMs: 4000,
    reportRecoveryIdleMs: 400,
    maxOutputBytes: 1024 * 1024,
    graceMs: 100,
    onProgress: (value) => progress.push(value),
    ...overrides,
  });
  return { status, progress, attemptDir, root: built.root };
}

test("runtime child argv follows the fixed resource-argument ordering", async () => {
  const extensions = ["/x/delegated-pi-loop/index.ts", "/x/openai-codex-aliases/index.ts", "/x/web-search/index.ts", "/x/context-mode/src/index.ts", "/x/codegraph/index.ts"];
  const resourceArgs = [
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
    ...extensions.flatMap((entry) => ["-e", entry]),
    "--skill", "/x/skills/uv",
    "--skill", "/x/skills/ruff",
  ];
  const { root } = await run(eventScript([completed()]), { runtimeResourceArgs: resourceArgs });
  // The fixture records argv after the interpreter and the script prefix
  // argument, so the recorded argv starts with the resource arguments.
  const args = JSON.parse(await readFile(path.join(root, "args.json"), "utf8")) as string[];
  assert.deepEqual(args, [
    ...resourceArgs,
    "--mode", "rpc",
    "--no-session",
    "--approve",
    "--provider", "fake",
    "--model", "model",
    "--thinking", "high",
  ]);
  for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--mode", "--no-session", "--approve"]) {
    assert.equal(args.filter((arg) => arg === flag).length, 1, flag);
  }
  for (const entry of extensions) {
    assert.equal(args.filter((arg) => arg === entry).length, 1, entry);
  }
  // Selected skills appear exactly once, in policy order, after the fixed
  // extension entries and before the mode/provider arguments.
  const skillArgs = args.filter((_, index) => args[index - 1] === "--skill");
  assert.deepEqual(skillArgs, ["/x/skills/uv", "/x/skills/ruff"]);
  assert.ok(args.indexOf("--skill") > args.lastIndexOf("-e") + 1);
  assert.ok(args.indexOf("--skill") < args.indexOf("--mode"));
  assert.ok(!args.includes("--no-context-files"), "runtime children keep context-file discovery enabled");
});

test("omitted skills produce no --skill arguments in the runtime child", async () => {
  const resourceArgs = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "-e", "/x/web-search/index.ts"];
  const { root } = await run(eventScript([completed()]), { runtimeResourceArgs: resourceArgs });
  const args = JSON.parse(await readFile(path.join(root, "args.json"), "utf8")) as string[];
  assert.ok(!args.includes("--skill"));
});

test("report recovery stays in the same child with no second resource resolution", async () => {
  const script = `
import { appendFileSync, writeFileSync } from "node:fs";
writeFileSync("spawns.jsonl", JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }) + "\\n");
let buffer = "";
let round = 0;
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    round += 1;
    appendFileSync("commands.jsonl", JSON.stringify({ pid: process.pid, command }) + "\\n");
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    if (round === 1) {
      process.stdout.write(JSON.stringify({ type: "agent_end", willRetry: false }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
    } else {
      process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Recovered.\\n\\nDELEGATE_RESULT: COMPLETED" }] } }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_end", willRetry: false }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
    }
  }
});
setInterval(() => {}, 1000);
`;
  const resourceArgs = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "-e", "/x/web-search/index.ts", "--skill", "/x/skills/ty"];
  const { status, root } = await run(script, { runtimeResourceArgs: resourceArgs });
  assert.equal(status.state, "completed");
  assert.equal(status.reportRound, 2);
  const spawns = (await readFile(path.join(root, "spawns.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(spawns.length, 1, "recovery must not spawn a second child");
  assert.ok(spawns[0].args.includes("--skill"));
  const commands = (await readFile(path.join(root, "commands.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(commands.length, 2);
  assert.equal(commands[0].pid, commands[1].pid);
  assert.equal(spawns[0].pid, commands[0].pid);
});

test("the supervisor keeps shell spawning disabled for resource arguments", async () => {
  const source = await readFile(new URL("./supervisor.ts", import.meta.url), "utf8");
  assert.match(source, /shell: false/);
  assert.match(source, /\.\.\.options\.runtimeResourceArgs,/);
});

test("a failed pre-spawn resource verification rejects before any child spawns", async () => {
  // A post-validation symlink swap is surfaced by the resources module as
  // this exact bounded error; supervisePi must run the verification
  // immediately before spawn and propagate it without starting a child.
  const built = await fixture(eventScript([completed()]));
  const attemptDir = path.join(built.root, "attempt");
  await createPrivateDirectory(attemptDir);
  const verification = new Error(
    "delegated-pi-loop resource policy invalid: an approved extension entry no longer resolves to its validated canonical path",
  );
  await assert.rejects(
    supervisePi({
      label: "test",
      role: "review-a",
      attempt: 1,
      cwd: built.root,
      artifactDir: attemptDir,
      promptPath: built.promptPath,
      route: ROUTE,
      piInvocation: built.invocation,
      runtimeResourceArgs: RUNTIME_RESOURCE_ARGS,
      verifyRuntimeResources: () => {
        throw verification;
      },
      activityWarningMs: 100,
      activityIdleMs: 500,
      progressWarningMs: 900,
      progressStallMs: 4000,
      reportRecoveryIdleMs: 400,
      maxOutputBytes: 1024 * 1024,
      graceMs: 100,
    }),
    (error: unknown) => error === verification,
  );
  // The fixture script writes args.json as its first action, so its absence
  // proves no child process ever spawned.
  await assert.rejects(
    () => stat(path.join(built.root, "args.json")),
    (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
  );
});

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
  assert.equal(commands[1].command.message, REPORT_RECOVERY_PROMPT);
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

test("BLOCKED with an accepted reason stays terminal and records typed reason fields", async () => {
  const events = [
    { type: "agent_start" },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "Stopped.\n\nDELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT: BLOCKED" }],
      },
    },
  ];
  const { status, progress, root } = await run(eventScript([events]));
  assert.equal(status.state, "blocked");
  assert.equal(status.delegateOutcome, "blocked");
  assert.equal(status.terminalReason, "budget_exhausted");
  assert.equal(status.reasonStatus, "accepted");
  assert.equal(status.blockedMisuseSuspected, false);
  assert.ok(progress.some((item) => item.state === "blocked" && item.terminalReason === "budget_exhausted" && item.reasonStatus === "accepted"));
  // A terminal BLOCKED never spends the recovery prompt.
  const commands = (await readFile(path.join(root, "commands.jsonl"), "utf8")).trim().split("\n");
  assert.equal(commands.length, 1);
});

test("a rejected reason value never reaches status or progress surfaces", async () => {
  const events = [
    { type: "agent_start" },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "Stopped.\n\nDELEGATE_REASON: /home/gc/SECRET-PATH/sk-RAWTOKEN99\nDELEGATE_RESULT: FAILED" }],
      },
    },
  ];
  const { status, progress } = await run(eventScript([events]));
  assert.equal(status.state, "delegate_failed");
  assert.equal(status.delegateOutcome, "failed");
  assert.equal(status.terminalReason, "unspecified");
  assert.equal(status.reasonStatus, "rejected");
  assert.ok(progress.some((item) => item.state === "delegate_failed" && item.terminalReason === "unspecified" && item.reasonStatus === "rejected"));
  assert.doesNotMatch(JSON.stringify(status), /SECRET|RAWTOKEN/);
  assert.doesNotMatch(JSON.stringify(progress), /SECRET|RAWTOKEN/);
});

test("a COMPLETED-with-reason response follows invalid-result recovery in the same child", async () => {
  const withReason = [
    { type: "agent_start" },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "Done.\n\nDELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT: COMPLETED" }],
      },
    },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
  const { status, root } = await run(eventScript([withReason, completed("Recovered.\n\nDELEGATE_RESULT: COMPLETED")]));
  assert.equal(status.state, "completed");
  assert.equal(status.reportNudgeCount, 1);
  assert.equal(status.reportRecoveryReason, "invalid_result");
  assert.equal(status.reportRound, 2);
  assert.equal(status.delegateOutcome, "completed");
  assert.equal(status.terminalReason, undefined);
  const commands = (await readFile(path.join(root, "commands.jsonl"), "utf8")).trim().split("\n");
  assert.equal(commands.length, 2);
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

test("fixed interruption sources propagate and arbitrary reasons become unknown", async () => {
  for (const [reason, expected] of [
    ["delegate_stop", "delegate_stop"],
    ["session_shutdown", "session_shutdown"],
    ["tool_call_abort", "tool_call_abort"],
    ["PRIVATE arbitrary reason", "unknown"],
  ] as const) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(reason), 50);
    const { status } = await run(eventScript([[{ type: "agent_start" }]]), {
      signal: controller.signal,
      activityIdleMs: 1000,
    });
    assert.equal(status.state, "interrupted");
    assert.equal(status.interruptionSource, expected);
    assert.doesNotMatch(JSON.stringify(status), /PRIVATE/);
  }
});

test("cancellation during recovery keeps one manager attempt and kills the child", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  const { status } = await run(eventScript([missing(), [{ type: "agent_start" }]]), {
    signal: controller.signal,
    activityIdleMs: 1000,
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

test("a silent recovery round reaches its own bounded report_recovery_idle lease", async () => {
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
    }, 100);
  }
});
setInterval(() => {}, 1000);
`;
  const { status } = await run(script, {
    activityWarningMs: 150,
    activityIdleMs: 5000,
    progressWarningMs: 4000,
    progressStallMs: 9000,
    reportRecoveryIdleMs: 350,
  });
  assert.equal(status.state, "stalled");
  assert.equal(status.stallCause, "report_recovery_idle");
  assert.equal(status.deadlineCause, "idle_deadline");
  assert.equal(status.reportNudgeCount, 1);
  assert.equal(status.reportRound, 2);
  assert.ok(status.elapsedSeconds < 1.2, `recovery lease must stay bounded, got ${status.elapsedSeconds}s`);
});

test("entry_appended-only traffic stalls on activity_idle while RPC health stays fresh", async () => {
  // The child accepts the prompt, then streams only entry_appended records
  // carrying seeded payloads. Every framed record renews supervisor-level
  // RPC health, but the ignored session-log events renew no activity, so the
  // activity lease expires first and the progress lease is never reached.
  const script = `
let buffer = "";
let appended = 0;
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    setInterval(() => {
      appended += 1;
      process.stdout.write(JSON.stringify({ type: "entry_appended", entry: { content: "SECRET-ENTRY-" + appended, path: "/home/gc/SECRET-PATH-9f2a" } }) + "\\n");
    }, 60);
  }
});
setInterval(() => {}, 1000);
`;
  const { status, progress } = await run(script);
  assert.equal(status.state, "stalled");
  assert.equal(status.stallCause, "activity_idle");
  assert.equal(status.deadlineCause, "idle_deadline");
  assert.equal(status.activityEventCount, 2, "only the response-accepted pair counts as activity");
  // RPC health kept renewing on the framed records while the activity lease
  // expired, so the stall is the accepted-activity family, never rpc_silent.
  assert.ok(status.activityIdleSeconds >= 0.5, `activity lease must expire, got ${status.activityIdleSeconds}s`);
  assert.ok(status.rpcIdleSeconds < 0.5, `rpc health must stay fresh, got ${status.rpcIdleSeconds}s`);
  assert.ok(status.rpcIdleSeconds < status.activityIdleSeconds);
  const surfaces = JSON.stringify(status) + JSON.stringify(progress);
  assert.doesNotMatch(surfaces, /SECRET|ENTRY|home\/gc/);
});

test("recovery-round entry_appended traffic cannot renew the report lease", async () => {
  // Round 1 settles with a missing report, then the recovery round streams
  // only entry_appended records: they stay RPC-valid, but the reporting
  // phase's own short activity lease expires as report_recovery_idle.
  const script = `
let buffer = ""; let round = 0;
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    round += 1;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    if (round === 1) {
      process.stdout.write(JSON.stringify({ type: "agent_end", willRetry: false }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
    } else {
      let appended = 0;
      setInterval(() => {
        appended += 1;
        process.stdout.write(JSON.stringify({ type: "entry_appended", entry: { content: "SECRET-RECOVERY-" + appended } }) + "\\n");
      }, 60);
    }
  }
});
setInterval(() => {}, 1000);
`;
  const { status, progress } = await run(script, {
    activityWarningMs: 150,
    activityIdleMs: 5000,
    progressWarningMs: 4000,
    progressStallMs: 9000,
    reportRecoveryIdleMs: 400,
  });
  assert.equal(status.state, "stalled");
  assert.equal(status.stallCause, "report_recovery_idle");
  assert.equal(status.deadlineCause, "idle_deadline");
  assert.equal(status.reportNudgeCount, 1);
  assert.equal(status.reportRound, 2);
  assert.ok(status.activityIdleSeconds >= 0.4, `report lease must expire, got ${status.activityIdleSeconds}s`);
  assert.ok(status.rpcIdleSeconds < 0.5, `rpc health must stay fresh, got ${status.rpcIdleSeconds}s`);
  assert.ok(status.elapsedSeconds < 1.5, `recovery lease must stay bounded, got ${status.elapsedSeconds}s`);
  const surfaces = JSON.stringify(status) + JSON.stringify(progress);
  assert.doesNotMatch(surfaces, /SECRET|RECOVERY/);
});

test("endless model deltas keep activity fresh but stagnate structural progress", async () => {
  for (const activity of ["thinking", "text", "toolcall", "tool-changing"] as const) {
    const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  ${activity === "tool-changing" ? "process.stdout.write(JSON.stringify({ type: 'tool_execution_start', toolCallId: 'active', toolName: 'bash', args: {} }) + '\\n');" : ""}
  let updates = 0;
  setInterval(() => {
    updates += 1;
    if (${activity === "thinking"}) process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" + updates } }) + "\\n");
    else if (${activity === "text"}) process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" + updates } }) + "\\n");
    else if (${activity === "toolcall"}) process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", delta: "{}" + updates } }) + "\\n");
    else process.stdout.write(JSON.stringify({ type: "tool_execution_update", toolCallId: "active", toolName: "bash", partialResult: { n: updates } }) + "\\n");
  }, 30);
});
setInterval(() => {}, 1000);
`;
    const { status, progress } = await run(script, {
      activityWarningMs: 80,
      activityIdleMs: 3000,
      progressWarningMs: 250,
      progressStallMs: 450,
      cleanupTimeoutMs: 1000,
    });
    assert.equal(status.state, "stalled", activity);
    assert.equal(status.stallCause, "progress_stagnation", activity);
    assert.equal(status.deadlineCause, "idle_deadline", activity);
    assert.equal(status.duplicateCheckpointCount, 0, activity);
    assert.ok(status.activityEventCount >= 4, activity);
    assert.ok(status.elapsedSeconds < 1.4, `activity must not extend the progress lease for ${activity}: ${status.elapsedSeconds}s`);
    assert.equal(status.progressWarningCount, 1, activity);
    assert.ok(progress.every((item) => item.progressWarningCount <= 1), activity);
    if (activity === "tool-changing") {
      assert.equal(status.activeToolCount, 1);
      assert.equal(status.activeToolName, "bash");
    }
  }
});

test("identical accumulated tool updates renew neither activity nor tool liveness", async () => {
  const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "active", toolName: "ctx_batch_execute", args: {} }) + "\\n");
  setInterval(() => process.stdout.write(JSON.stringify({ type: "tool_execution_update", toolCallId: "active", toolName: "ctx_batch_execute", partialResult: {} }) + "\\n"), 30);
});
setInterval(() => {}, 1000);
`;
  const { status } = await run(script, {
    activityWarningMs: 100,
    activityIdleMs: 400,
    progressWarningMs: 3000,
    progressStallMs: 6000,
    cleanupTimeoutMs: 1000,
  });
  assert.equal(status.state, "stalled");
  assert.equal(status.stallCause, "active_tool_idle");
  assert.equal(status.activeToolCount, 1);
});

test("novel structural checkpoints renew the progress lease across multiple former deadlines", async () => {
  // One novel authoritative message per 150 ms renews the lease every time;
  // the 400 ms lease equivalent is crossed several times and the attempt
  // still completes. No total runtime ceiling exists.
  const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  let count = 0;
  const timer = setInterval(() => {
    count += 1;
    process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "step " + count }] } }) + "\\n");
    if (count >= 12) {
      clearInterval(timer);
      process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Final report\\n\\nDELEGATE_RESULT: COMPLETED" }] } }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_end", willRetry: false }) + "\\n");
      process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
    }
  }, 150);
});
setInterval(() => {}, 1000);
`;
  const { status } = await run(script, {
    activityWarningMs: 300,
    activityIdleMs: 1200,
    progressWarningMs: 260,
    progressStallMs: 400,
    cleanupTimeoutMs: 1000,
  });
  assert.equal(status.state, "completed");
  assert.equal(status.stallCause, undefined);
  assert.equal(status.deadlineCause, undefined);
  assert.ok(status.elapsedSeconds >= 1.5, `several lease equivalents must elapse, got ${status.elapsedSeconds}s`);
  assert.ok(status.structuralProgressCount >= 13);
});


test("exact repeated checkpoint cycles stall as repeated_cycle and never renew progress", async () => {
  for (const cycle of ["identical", "alternating"] as const) {
    const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  let count = 0;
  setInterval(() => {
    count += 1;
    const text = ${cycle === "identical"} ? "the same checkpoint" : (count % 2 === 0 ? "alpha checkpoint" : "beta checkpoint");
    process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] } }) + "\\n");
  }, 30);
});
setInterval(() => {}, 1000);
`;
    const { status, progress } = await run(script, {
      activityWarningMs: 80,
      activityIdleMs: 3000,
      progressWarningMs: 250,
      progressStallMs: 450,
      cleanupTimeoutMs: 1000,
    });
    assert.equal(status.state, "stalled", cycle);
    assert.equal(status.stallCause, "repeated_cycle", cycle);
    assert.equal(status.deadlineCause, "idle_deadline", cycle);
    assert.ok(status.duplicateCheckpointCount >= 2, cycle);
    assert.ok(status.activityEventCount >= 4, cycle);
    assert.equal(status.progressWarningCount, 1, cycle);
    assert.ok(status.elapsedSeconds < 1.4, `${cycle} cycle must not renew the lease: ${status.elapsedSeconds}s`);
    // The identical checkpoint payload and no digest material ever reach a
    // progress surface.
    assert.doesNotMatch(JSON.stringify(progress), /checkpoint|alpha|beta/);
    assert.doesNotMatch(JSON.stringify(progress), /[0-9a-f]{64}/);
  }
});

test("a silent active tool reaches the normal idle deadline", async () => {
  const events = [
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "silent", toolName: "ctx_batch_execute", args: {} },
  ];
  const { status, progress } = await run(eventScript([events]), {
    activityWarningMs: 100,
    activityIdleMs: 250,
    progressWarningMs: 3000,
    progressStallMs: 6000,
    cleanupTimeoutMs: 1000,
  });
  assert.equal(status.state, "stalled");
  assert.equal(status.stallCause, "active_tool_idle");
  assert.equal(status.deadlineCause, "idle_deadline");
  assert.equal(status.activityWarningCount, 1);
  assert.equal(status.activeToolCount, 1);
  assert.equal(status.activeToolName, "ctx_batch_execute");
  // Per-attempt tool idle telemetry: the exhausted lease age travels on the
  // final status and on every live progress callback that saw the tool.
  assert.ok(status.activeToolIdleSeconds !== undefined && status.activeToolIdleSeconds >= 0.2);
  assert.ok(progress.every((item) => item.activeToolIdleSeconds === undefined || Number.isFinite(item.activeToolIdleSeconds)));
  const withTool = progress.filter((item) => (item.activeToolCount ?? 0) > 0);
  assert.ok(withTool.length > 0);
  assert.ok(withTool.every((item) => item.activeToolIdleSeconds !== undefined));
  assert.ok(progress.every((item) => item.activityWarningCount <= 1));
});

test("a newer updating tool cannot mask an older silent tool", async () => {
  // Two tools stay active: the older one never updates, the newer one
  // produces a novel accumulated update every 30 ms. The stalest-tool
  // watchdog must stall on the older silent tool and name it.
  const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "old", toolName: "read", args: {} }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "new", toolName: "bash", args: {} }) + "\\n");
  let updates = 0;
  setInterval(() => {
    updates += 1;
    process.stdout.write(JSON.stringify({ type: "tool_execution_update", toolCallId: "new", toolName: "bash", partialResult: { n: updates } }) + "\\n");
  }, 30);
});
setInterval(() => {}, 1000);
`;
  const { status, progress } = await run(script, {
    activityWarningMs: 100,
    activityIdleMs: 400,
    progressWarningMs: 3000,
    progressStallMs: 6000,
    cleanupTimeoutMs: 1000,
  });
  assert.equal(status.state, "stalled");
  assert.equal(status.stallCause, "active_tool_idle");
  assert.equal(status.activeToolCount, 2);
  assert.equal(status.activeToolName, "read");
  // The newer tool kept renewing accepted activity until the stall: its
  // update was the last accepted event, so the stall is tool-idle-driven
  // and not an activity clock expiry.
  assert.equal(status.lastEvent, "tool_execution_update");
  const lastToolProgress = progress.filter((item) => (item.activeToolCount ?? 0) > 0).at(-1);
  assert.equal(lastToolProgress?.activeToolName, "read");
});

test("anonymous unallowlisted tool updates and ends invalidate the stream without touching the active tool", async () => {
  for (const poison of [
    { type: "tool_execution_update", toolName: "/home/gc/SECRET-fake-tool", partialResult: { n: 1 } },
    { type: "tool_execution_end", toolName: "sk-SECRET-KEY", result: { ok: true } },
  ] as const) {
    const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolName: "ctx_batch_execute", args: {} }) + "\\n");
  setInterval(() => process.stdout.write(JSON.stringify(${JSON.stringify(poison)}) + "\\n"), 30);
});
setInterval(() => {}, 1000);
`;
    const { status } = await run(script, {
      activityWarningMs: 100,
      activityIdleMs: 400,
      progressWarningMs: 3000,
      progressStallMs: 6000,
      cleanupTimeoutMs: 1000,
    });
    // The anonymous unallowlisted name maps to the literal unknown bucket,
    // which matches no allowlisted active tool: the first poisoned event is
    // a fixed unmatched-event stream error and the tool stays active.
    assert.equal(status.state, "invalid_stream", poison.type);
    const expectedError = poison.type === "tool_execution_update"
      ? "tool_execution_update_without_start"
      : "tool_execution_end_without_start";
    assert.ok(status.streamErrors.includes(expectedError), poison.type);
    assert.equal(status.activeToolCount, 1, poison.type);
    assert.equal(status.activeToolName, "ctx_batch_execute", poison.type);
    assert.equal(status.lastEvent, "tool_execution_start", poison.type);
    assert.doesNotMatch(JSON.stringify(status), /SECRET/);
  }
});

test("a no-ID same-name update or end never matches an ID-backed active tool", async () => {
  for (const poison of [
    { type: "tool_execution_update", toolName: "ctx_batch_execute", partialResult: { n: 1 } },
    { type: "tool_execution_end", toolName: "ctx_batch_execute", result: { ok: true } },
  ] as const) {
    const script = `
let buffer = "";
let updates = 0;
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "call-1", toolName: "ctx_batch_execute", args: {} }) + "\\n");
  setInterval(() => {
    updates += 1;
    const event = { ...${JSON.stringify(poison)} };
    if (event.type === "tool_execution_update") event.partialResult = { n: updates };
    process.stdout.write(JSON.stringify(event) + "\\n");
  }, 30);
});
setInterval(() => {}, 1000);
`;
    const { status } = await run(script, {
      activityWarningMs: 100,
      activityIdleMs: 400,
      progressWarningMs: 3000,
      progressStallMs: 6000,
      cleanupTimeoutMs: 1000,
    });
    // The active tool exists only under its id: key, so the no-ID event has
    // no eligible anonymous candidate even though the sanitized name is
    // identical: it follows the unmatched-event error path and the ID-backed
    // tool stays active with its counters and clocks untouched.
    assert.equal(status.state, "invalid_stream", poison.type);
    const expectedError = poison.type === "tool_execution_update"
      ? "tool_execution_update_without_start"
      : "tool_execution_end_without_start";
    assert.ok(status.streamErrors.includes(expectedError), poison.type);
    assert.equal(status.activeToolCount, 1, poison.type);
    assert.equal(status.activeToolName, "ctx_batch_execute", poison.type);
    assert.equal(status.toolExecutionCount, 1, poison.type);
    assert.equal(status.lastEvent, "tool_execution_start", poison.type);
  }
});

test("varying duplicate multiplicity stalls as repeated_cycle instead of renewing indefinitely", async () => {
  const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  let cycle = 0;
  setInterval(() => {
    cycle += 1;
    const copies = cycle;
    process.stdout.write(JSON.stringify({ type: "turn_start" }) + "\\n");
    for (let index = 0; index < copies; index += 1) {
      process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "the same checkpoint" }] } }) + "\\n");
    }
    process.stdout.write(JSON.stringify({ type: "turn_end" }) + "\\n");
  }, 30);
});
setInterval(() => {}, 1000);
`;
  const { status, progress } = await run(script, {
    activityWarningMs: 80,
    activityIdleMs: 3000,
    progressWarningMs: 250,
    progressStallMs: 450,
    cleanupTimeoutMs: 1000,
  });
  // Every cycle repeats the same single message with a strictly growing
  // copy count, so under raw occurrence-count summaries each turn identity
  // was unique and renewed the lease indefinitely. The turn identity is
  // duplicate-insensitive, so no multiplicity renews the progress lease and
  // the run reaches repeated_cycle.
  assert.equal(status.state, "stalled");
  assert.equal(status.stallCause, "repeated_cycle");
  assert.equal(status.deadlineCause, "idle_deadline");
  assert.ok(status.duplicateCheckpointCount >= 2);
  assert.ok(status.activityEventCount >= 4);
  assert.equal(status.progressWarningCount, 1);
  assert.ok(status.elapsedSeconds < 1.4, `varying multiplicity must not renew the lease: ${status.elapsedSeconds}s`);
  assert.doesNotMatch(JSON.stringify(progress), /checkpoint|[0-9a-f]{64}/);
});

test("the anonymous multi-tool watchdog stalls on the stalest silent tool by name bucket", async () => {
  const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  if (!buffer.includes("\\n")) return;
  const command = JSON.parse(buffer.slice(0, buffer.indexOf("\\n")));
  process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolName: "read", args: {} }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolName: "fake-unallowlisted-tool", args: {} }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: {} }) + "\\n");
  let updates = 0;
  setInterval(() => {
    updates += 1;
    process.stdout.write(JSON.stringify({ type: "tool_execution_update", toolName: "bash", partialResult: { n: updates } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "tool_execution_update", toolName: "other-fake-tool", partialResult: { n: updates } }) + "\\n");
  }, 30);
});
setInterval(() => {}, 1000);
`;
  const { status, progress } = await run(script, {
    activityWarningMs: 100,
    activityIdleMs: 400,
    progressWarningMs: 3000,
    progressStallMs: 6000,
    cleanupTimeoutMs: 1000,
  });
  // The bash-named and unknown-bucket tools keep renewing through anonymous
  // name-exact updates; only the silent anonymous read tool goes idle.
  assert.equal(status.state, "stalled");
  assert.equal(status.stallCause, "active_tool_idle");
  assert.equal(status.activeToolCount, 3);
  assert.equal(status.activeToolName, "read");
  assert.equal(status.lastEvent, "tool_execution_update");
  const withTools = progress.filter((item) => (item.activeToolCount ?? 0) > 0);
  assert.ok(withTools.length > 0);
  assert.ok(withTools.every((item) => item.activeToolName === "read"));
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
    activityWarningMs: 1000,
    activityIdleMs: 4000,
    progressWarningMs: 4500,
    progressStallMs: 5000,
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

/** Fixture body whose leader accepts the prompt, starts one pipe-inheriting descendant, then exits zero. */
function leaderExitScript(descendantCode: string): string {
  return `
import { spawn } from "node:child_process";
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    process.stderr.write("CHILD=" + process.pid + "\\n");
    const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantCode)}], { stdio: ["ignore", "inherit", "inherit"] });
    descendant.on("spawn", () => {
      process.stderr.write("DESCENDANT=" + descendant.pid + "\\n");
      setTimeout(() => process.exit(0), 50);
    });
  }
});
`;
}

/** Reads the CHILD and DESCENDANT pids recorded by a leaderExitScript run. */
async function fixturePids(attemptDir: string): Promise<{ readonly leader: number; readonly descendant: number }> {
  const stderr = await readFile(path.join(attemptDir, "stderr.log"), "utf8");
  const leader = Number(/CHILD=(\d+)/.exec(stderr)?.[1]);
  const descendant = Number(/DESCENDANT=(\d+)/.exec(stderr)?.[1]);
  assert.ok(Number.isSafeInteger(leader));
  assert.ok(Number.isSafeInteger(descendant));
  return { leader, descendant };
}

test("leader-exit settlement honors a descendant's late completion inside the window", { skip: process.platform !== "linux" }, async () => {
  // The leader exits zero with the stdio pipe still held by a descendant,
  // so the close event cannot fire. The descendant writes the valid terminal
  // completion inside the fixed settlement window: the stream stays active,
  // the late result completes the run, and no descendant survives cleanup.
  const late = completed("Late descendant report\n\nDELEGATE_RESULT: COMPLETED").slice(1);
  const descendantCode = `setTimeout(() => {
  for (const event of ${JSON.stringify(late)}) process.stdout.write(JSON.stringify(event) + "\\n");
}, 300);`;
  const { status, attemptDir } = await run(leaderExitScript(descendantCode));
  assert.equal(status.state, "completed");
  assert.equal(status.exitCode, 0);
  assert.equal(status.completionCleanupPerformed, true);
  assert.deepEqual(status.streamErrors, []);
  const report = await readFile(path.join(attemptDir, "report.md"), "utf8");
  assert.match(report, /Late descendant report/);
  assert.match(report, /DELEGATE_RESULT: COMPLETED/);
  const pids = await fixturePids(attemptDir);
  assert.ok(await isGone(pids.leader), "the exited leader must stay gone");
  assert.ok(await isGone(pids.descendant), "the descendant must not survive the run");
  assert.ok(status.elapsedSeconds < 5, `settlement must stay bounded, got ${status.elapsedSeconds}s`);
});

test("an inherited pipe held open beyond the settlement window fails closed and boundedly", { skip: process.platform !== "linux" }, async () => {
  // The descendant inherits the leader's stdio and holds it open far beyond
  // the settlement window without writing anything. The window expires, the
  // incomplete snapshot is classified, group termination stays inside the
  // remaining cleanup budget, and the group is proven dead before return.
  const descendantCode = "setInterval(() => {}, 1000);";
  const { status, attemptDir } = await run(leaderExitScript(descendantCode), { graceMs: 200 });
  assert.equal(status.state, "invalid_stream");
  assert.equal(status.exitCode, 0);
  assert.equal(status.cleanupFailureReason, undefined);
  assert.equal(status.reportPresent, false);
  assert.ok(status.elapsedSeconds >= 0.9, `the settlement window must run first, got ${status.elapsedSeconds}s`);
  assert.ok(
    status.elapsedSeconds < 10.5,
    `settlement plus cleanup must stay inside the cleanup budget, got ${status.elapsedSeconds}s`,
  );
  const pids = await fixturePids(attemptDir);
  assert.ok(await isGone(pids.leader), "the exited leader must stay gone");
  assert.ok(await isGone(pids.descendant), "no descendant may survive the settled run");
});

test("a late completion after the settlement window cannot flip the frozen decision", { skip: process.platform !== "linux" }, async () => {
  // The descendant traps SIGTERM and writes the valid completion only after
  // the window already froze the incomplete snapshot as invalid_stream. The
  // late record is consumed after the decision, so the terminal decision
  // stands while the group is still proven dead.
  const late = completed("Too late report\n\nDELEGATE_RESULT: COMPLETED").slice(1);
  const descendantCode = `process.on("SIGTERM", () => {});
setTimeout(() => {
  for (const event of ${JSON.stringify(late)}) process.stdout.write(JSON.stringify(event) + "\\n");
}, 1800);`;
  const { status, attemptDir } = await run(leaderExitScript(descendantCode), { graceMs: 2500 });
  assert.equal(status.state, "invalid_stream");
  assert.equal(status.exitCode, 0);
  assert.deepEqual(status.streamErrors, []);
  assert.equal(status.reportPresent, true, "the late record is still consumed as stream evidence");
  assert.ok(status.elapsedSeconds >= 1.0, `the settlement window must run first, got ${status.elapsedSeconds}s`);
  assert.ok(status.elapsedSeconds < 10.5, `bounded cleanup must hold, got ${status.elapsedSeconds}s`);
  const pids = await fixturePids(attemptDir);
  assert.ok(await isGone(pids.leader), "the exited leader must stay gone");
  assert.ok(await isGone(pids.descendant), "no descendant may survive the settled run");
});

test("late records inside the window are honored and never overwrite a terminal decision", { skip: process.platform !== "linux" }, async () => {
  const lateTerminal = {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "Stopped late\n\nDELEGATE_REASON: budget_exhausted\nDELEGATE_RESULT: BLOCKED" }],
    },
  };
  const descendantCode = `process.on("SIGTERM", () => {});
setTimeout(() => {
  process.stdout.write(JSON.stringify(${JSON.stringify(lateTerminal)}) + "\\n");
}, 300);
setTimeout(() => {
  process.stdout.write(JSON.stringify({ type: "agent_end", willRetry: false }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "entry_appended", entry: { content: "SECRET-LATE" } }) + "\\n");
}, 700);`;
  const { status, attemptDir, progress } = await run(leaderExitScript(descendantCode), { graceMs: 2000 });
  // The BLOCKED terminal inside the window is honored as the decision...
  assert.equal(status.state, "blocked");
  assert.equal(status.delegateOutcome, "blocked");
  assert.equal(status.terminalReason, "budget_exhausted");
  assert.equal(status.reasonStatus, "accepted");
  assert.deepEqual(status.streamErrors, []);
  const report = await readFile(path.join(attemptDir, "report.md"), "utf8");
  assert.match(report, /DELEGATE_RESULT: BLOCKED/);
  // ...and the later records after the decision change nothing.
  const pids = await fixturePids(attemptDir);
  assert.ok(await isGone(pids.leader), "the exited leader must stay gone");
  assert.ok(await isGone(pids.descendant), "no descendant may survive the settled run");
  assert.ok(status.elapsedSeconds < 5, `settlement must stay bounded, got ${status.elapsedSeconds}s`);
  assert.doesNotMatch(JSON.stringify(status) + JSON.stringify(progress) + report, /SECRET-LATE/);
});

test("a natural close stays immediate and never waits the settlement window", async () => {
  // The leader answers the prompt and exits zero with no descendant, so the
  // close event settles at once: no settlement-window wait, and the parser
  // is drained and finalized on the natural path.
  const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    setTimeout(() => process.exit(0), 20);
  }
});
`;
  const { status } = await run(script);
  assert.equal(status.state, "invalid_stream");
  assert.equal(status.exitCode, 0);
  assert.deepEqual(status.streamErrors, []);
  assert.ok(status.elapsedSeconds < 0.9, `natural close must settle at once, got ${status.elapsedSeconds}s`);
});

/** Shared body for progress-sink failure tests: supervisePi must reject with the exact original sink error after full cleanup. */
async function runSinkFailure(
  script: string,
  sinkError: Error,
  onProgress: (progress: DelegateProgress) => void,
  overrides: Partial<Parameters<typeof supervisePi>[0]> = {},
): Promise<{ attemptDir: string; root: string }> {
  const built = await fixture(script);
  const attemptDir = path.join(built.root, "attempt");
  await createPrivateDirectory(attemptDir);
  await assert.rejects(
    supervisePi({
      label: "test",
      role: "review-a",
      attempt: 1,
      cwd: built.root,
      artifactDir: attemptDir,
      promptPath: built.promptPath,
      route: ROUTE,
      piInvocation: built.invocation,
      runtimeResourceArgs: RUNTIME_RESOURCE_ARGS,
      verifyRuntimeResources: () => {},
      activityWarningMs: 200,
      activityIdleMs: 2300,
      progressWarningMs: 2400,
      progressStallMs: 2500,
      reportRecoveryIdleMs: 2300,
      maxOutputBytes: 1024 * 1024,
      graceMs: 100,
      onProgress,
      ...overrides,
    }),
    (error: unknown) => {
      assert.equal(error, sinkError, "supervisePi must reject with the original sink error");
      return true;
    },
  );
  return { attemptDir, root: built.root };
}

/** Reads the supervising stderr log and proves normal stderr cleanup finished. */
async function finishedStderr(attemptDir: string): Promise<string> {
  const stderrPath = path.join(attemptDir, "stderr.log");
  const permissions = await stat(stderrPath);
  assert.equal(permissions.mode & 0o777, 0o600, "stderr cleanup must end with the private chmod");
  return readFile(stderrPath, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("a sink throwing from RPC stdout activity rejects with the original error after cleanup", async () => {
  const sinkError = new Error("stdout sink failed PRIVATE");
  const deliveries: string[] = [];
  const { attemptDir, root } = await runSinkFailure(eventScript([missing()]), sinkError, (progress) => {
    deliveries.push(`${progress.lastEvent}:${progress.reportRecoveryReason ?? "-"}`);
    // Normal deliveries stay healthy; the forced emit from the recovery
    // nudge is supervisor-owned and driven by child stdout activity.
    if (progress.reportRecoveryReason !== undefined) throw sinkError;
  });
  assert.ok(
    deliveries.some((delivery) => delivery.endsWith("missing_report")),
    "the failure must fire from the stdout-driven recovery emit",
  );
  // The sink is never invoked again after its first failure.
  const callsAtRejection = deliveries.length;
  await sleep(300);
  assert.equal(deliveries.length, callsAtRejection, "the failed sink must never be invoked again");
  // Normal cleanup completed: the stderr artifact is flushed and private.
  await finishedStderr(attemptDir);
  // The child process group is dead.
  if (process.platform === "linux") {
    const commands = (await readFile(path.join(root, "commands.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { pid: number });
    assert.ok(commands.length >= 1);
    assert.ok(await isGone(commands[0]!.pid), "the child must be terminated after the sink failure");
  }
});

test("a sink throwing from interval progress rejects with the original error after group termination", { skip: process.platform !== "linux" }, async () => {
  // The child never touches stdout, so every progress delivery originates
  // from the supervisor's interval ticker.
  const script = `
import { spawn } from "node:child_process";
process.stderr.write("CHILD=" + process.pid + "\\n");
const descendant = spawn("sleep", ["30"]);
descendant.on("spawn", () => process.stderr.write("DESCENDANT=" + descendant.pid + "\\n"));
setInterval(() => {}, 1000);
`;
  const sinkError = new Error("interval sink failed PRIVATE");
  const seen: string[] = [];
  const { attemptDir } = await runSinkFailure(script, sinkError, (progress) => {
    seen.push(progress.lastEvent);
    if (seen.length >= 2) throw sinkError;
  }, { activityWarningMs: 3000, activityIdleMs: 3400, progressWarningMs: 3450, progressStallMs: 3500, reportRecoveryIdleMs: 3400 });
  // The first interval delivery reached the healthy sink unchanged; the
  // second one threw.
  assert.equal(seen[0], "process_start", "a normal interval delivery must precede the failure");
  const callsAtRejection = seen.length;
  await sleep(300);
  assert.equal(seen.length, callsAtRejection, "the failed sink must never be invoked again");
  // Normal cleanup completed and the full process group is dead.
  const stderr = await finishedStderr(attemptDir);
  const childPid = Number(/CHILD=(\d+)/.exec(stderr)?.[1]);
  const descendantPid = Number(/DESCENDANT=(\d+)/.exec(stderr)?.[1]);
  assert.ok(Number.isSafeInteger(childPid));
  assert.ok(Number.isSafeInteger(descendantPid));
  assert.ok(await isGone(childPid), "the child must be terminated after the sink failure");
  assert.ok(await isGone(descendantPid), "the descendant must be terminated with the group");
});

test("partial trailing JSON fails a completed lifecycle closed", async () => {
  const { status } = await run(eventScript([completed()], { trailing: "{" }));
  assert.equal(status.state, "invalid_stream");
  assert.ok(status.streamErrors.includes("rpc_partial_record"));
});

test("recovery-round tool lifecycle events terminate as invalid_stream for all three event types", async () => {
  const round1 = [
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "PRIVATE" } },
    { type: "tool_execution_end", toolCallId: "r1", toolName: "read", result: { ok: true } },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
  const recoveryToolEvents = [
    { type: "tool_execution_start", toolCallId: "r2", toolName: "bash", args: {} },
    { type: "tool_execution_update", toolCallId: "r2", toolName: "bash", partialResult: { n: 1 } },
    { type: "tool_execution_end", toolCallId: "r2", toolName: "bash", result: { ok: true } },
  ];
  for (const toolEvent of recoveryToolEvents) {
    const { status, root } = await run(eventScript([round1, [{ type: "agent_start" }, toolEvent]]));
    assert.equal(status.state, "invalid_stream", toolEvent.type);
    assert.ok(status.streamErrors.includes("tool_execution_in_recovery_round"), toolEvent.type);
    // The cumulative round-1 tool count and exactly one recovery prompt are
    // preserved; there is never a third round.
    assert.equal(status.toolExecutionCount, 1, toolEvent.type);
    assert.equal(status.reportNudgeCount, 1, toolEvent.type);
    assert.equal(status.reportRound, 2, toolEvent.type);
    const commands = (await readFile(path.join(root, "commands.jsonl"), "utf8")).trim().split("\n");
    assert.equal(commands.length, 2, toolEvent.type);
  }
});

test("oversized tool-call ids fail closed before buffering for all three lifecycle types", async () => {
  // Two valid tools (one id-backed, one anonymous) start at once; the
  // oversized-id event arrives later and produces only the fixed protocol
  // error, so it can never match, remove, or count either active tool and
  // never renews the valid-RPC clock on its way to invalid_stream.
  const earlyStarts = `process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "valid", toolName: "bash", args: {} }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolName: "read", args: {} }) + "\\n");`;
  const cases: ReadonlyArray<[string, string, string, number]> = [
    [
      "start",
      "",
      `{ type: "tool_execution_start", toolCallId: "x".repeat(201), toolName: "bash", args: { path: "PRIVATE" } }`,
      0,
    ],
    [
      "update",
      earlyStarts,
      `{ type: "tool_execution_update", toolCallId: "valid" + "x".repeat(196), toolName: "bash", partialResult: { n: 1 } }`,
      2,
    ],
    [
      "end",
      earlyStarts,
      `{ type: "tool_execution_end", toolCallId: "v".repeat(201), toolName: "read", result: { ok: true } }`,
      2,
    ],
  ];
  for (const [label, early, oversizedEvent, activeTools] of cases) {
    const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    ${early}
    setTimeout(() => {
      process.stdout.write(JSON.stringify(${oversizedEvent}) + "\\n");
    }, 450);
  }
});
setInterval(() => {}, 1000);
`;
    const { status } = await run(script, {
      activityIdleMs: 2000,
      progressStallMs: 8000,
    });
    assert.equal(status.state, "invalid_stream", label);
    assert.ok(status.streamErrors.includes("rpc_tool_call_id_too_long"), `${label}: ${JSON.stringify(status.streamErrors)}`);
    assert.equal(status.activeToolCount, activeTools, label);
    assert.equal(status.toolExecutionCount, activeTools, label);
    assert.ok(
      status.rpcIdleSeconds >= 0.3,
      `${label}: rpc idle ${status.rpcIdleSeconds}s must include the pre-error gap`,
    );
    assert.doesNotMatch(JSON.stringify(status), /PRIVATE/);
  }
});

test("a pre-prompt oversized tool-call id reports only the fixed rpc error", async () => {
  // The oversized lifecycle event is written before the prompt response, so
  // the bound fires while the prompt is still pending: one fixed protocol
  // error, no buffering, and no renewal of RPC health.
  const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    process.stdout.write(JSON.stringify({ type: "tool_execution_end", toolCallId: ${JSON.stringify("y".repeat(201))} }) + "\\n");
  }
});
setInterval(() => {}, 1000);
`;
  const { status } = await run(script, { activityIdleMs: 2000, progressStallMs: 8000 });
  assert.equal(status.state, "invalid_stream");
  assert.deepEqual(status.streamErrors, ["rpc_tool_call_id_too_long"]);
  assert.equal(status.sessionSeen, false);
  assert.equal(status.agentStartCount, 0);
});

test("recovery-round streamed toolcall events terminate as invalid_stream for all three subtypes", async () => {
  const round1 = [
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "r1", toolName: "read", args: { path: "PRIVATE" } },
    { type: "tool_execution_end", toolCallId: "r1", toolName: "read", result: { ok: true } },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
  const recoveryToolcallEvents = [
    { type: "message_update", assistantMessageEvent: { type: "toolcall_start" } },
    { type: "message_update", assistantMessageEvent: { type: "toolcall_delta", delta: "{}" } },
    { type: "message_update", assistantMessageEvent: { type: "toolcall_end" } },
  ];
  for (const toolcallEvent of recoveryToolcallEvents) {
    const label = `${toolcallEvent.type}:${toolcallEvent.assistantMessageEvent.type}`;
    const { status, root } = await run(eventScript([round1, [{ type: "agent_start" }, toolcallEvent]]));
    assert.equal(status.state, "invalid_stream", label);
    assert.ok(status.streamErrors.includes("tool_execution_in_recovery_round"), label);
    // Streamed tool selection is reporting-only in round 2: the cumulative
    // round-1 tool count, exactly one recovery prompt, and no third round.
    assert.equal(status.toolExecutionCount, 1, label);
    assert.equal(status.reportNudgeCount, 1, label);
    assert.equal(status.reportRound, 2, label);
    const commands = (await readFile(path.join(root, "commands.jsonl"), "utf8")).trim().split("\n");
    assert.equal(commands.length, 2, label);
  }
});

test("seeded tool names surface only as the fixed unknown label through status and progress", async () => {
  const seeded = "/home/gc/SECRET-PATH-9f2a";
  // The seeded tool starts late and then stays silent, so the interval
  // progress callbacks observe it live and the run ends on the tool-idle
  // lease with the sanitized name on every surface.
  const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    setTimeout(() => {
      process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolCallId: "1", toolName: ${JSON.stringify(seeded)}, args: { path: "PRIVATE" } }) + "\\n");
    }, 1100);
  }
});
setInterval(() => {}, 1000);
`;
  const { status, progress } = await run(script, {
    activityWarningMs: 100,
    activityIdleMs: 2500,
    progressWarningMs: 3000,
    progressStallMs: 6000,
    cleanupTimeoutMs: 1000,
  });
  assert.equal(status.state, "stalled");
  assert.equal(status.stallCause, "active_tool_idle");
  assert.equal(status.activeToolName, "unknown");
  assert.equal(status.lastEvent, "tool_execution_start");
  assert.equal(status.lastEventDetail, "unknown");
  const toolProgress = progress.filter((item) => item.lastEvent === "tool_execution_start");
  assert.ok(toolProgress.length > 0);
  assert.ok(toolProgress.every((item) => item.lastEventDetail === "unknown" && item.activeToolName === "unknown"));
  assert.doesNotMatch(JSON.stringify(status), /SECRET|PRIVATE|home\/gc/);
  assert.doesNotMatch(JSON.stringify(progress), /SECRET|PRIVATE|home\/gc/);
});

/** Child that answers round 1 validly, then emits one bad record after a delay. */
function delayedBadRecordScript(delayMs: number, badWriter: string): string {
  return `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    setTimeout(() => { ${badWriter} }, ${delayMs});
  }
});
setInterval(() => {}, 1000);
`;
}

test("protocol errors never renew the valid-RPC clock on their way to invalid_stream", async () => {
  const cases: ReadonlyArray<[string, string, string]> = [
    ["malformed", "rpc_malformed_json", `process.stdout.write("{not json\\n");`],
    ["duplicate response", "rpc_duplicate_response", `process.stdout.write(JSON.stringify({ id: "prompt-1", type: "response", command: "prompt", success: true }) + "\\n");`],
    ["unknown response", "rpc_unknown_response", `process.stdout.write(JSON.stringify({ id: "prompt-9", type: "response", command: "prompt", success: true }) + "\\n");`],
    [
      "oversized line",
      "rpc_line_too_large",
      `process.stdout.write("x".repeat(8 * 1024 * 1024 + 64));`,
    ],
  ];
  for (const [label, error, writer] of cases) {
    const { status } = await run(delayedBadRecordScript(450, writer), {
      activityIdleMs: 2000,
      progressStallMs: 8000,
      maxOutputBytes: 64 * 1024 * 1024,
    });
    assert.equal(status.state, "invalid_stream", label);
    assert.ok(status.streamErrors.includes(error), `${label}: ${JSON.stringify(status.streamErrors)}`);
    // The last valid record is the pre-gap response/event pair: the RPC idle
    // age must reflect that old renewal, proving the bad record itself did
    // not move the valid-RPC clock before termination.
    assert.ok(
      status.rpcIdleSeconds >= 0.3,
      `${label}: rpc idle ${status.rpcIdleSeconds}s must include the pre-error gap`,
    );
  }
});

/** Child that answers round 1 validly, optionally cancels one valid dialog, then emits one malformed dialog after a delay. */
function delayedDialogScript(delayMs: number, badWriter: string, earlyDialogMethod?: string): string {
  return `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    ${earlyDialogMethod ? `process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "ui-1", method: ${JSON.stringify(earlyDialogMethod)} }) + "\\n");` : ""}
    setTimeout(() => { ${badWriter} }, ${delayMs});
  }
});
setInterval(() => {}, 1000);
`;
}

test("delayed malformed extension UI dialogs fail closed with the exact rpc error and preserved RPC idle age", async () => {
  const cases: ReadonlyArray<[string, string, string, string | undefined]> = [
    ["missing dialog id", "rpc_malformed_ui_request", `process.stdout.write(JSON.stringify({ type: "extension_ui_request", method: "confirm" }) + "\\n");`, undefined],
    ["empty dialog id", "rpc_malformed_ui_request", `process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "", method: "select" }) + "\\n");`, undefined],
    ["oversized dialog id", "rpc_malformed_ui_request", `process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: ${JSON.stringify("x".repeat(201))}, method: "input" }) + "\\n");`, undefined],
    ["missing method", "rpc_malformed_ui_request", `process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "ui-1" }) + "\\n");`, undefined],
    ["oversized method", "rpc_malformed_ui_request", `process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "ui-1", method: ${JSON.stringify("m".repeat(81))} }) + "\\n");`, undefined],
    ["duplicate dialog id", "rpc_duplicate_ui_request", `process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "ui-1", method: "editor" }) + "\\n");`, "editor"],
  ];
  for (const [label, error, writer, earlyDialogMethod] of cases) {
    const { status } = await run(delayedDialogScript(450, writer, earlyDialogMethod), {
      activityIdleMs: 2000,
      progressStallMs: 8000,
    });
    assert.equal(status.state, "invalid_stream", label);
    assert.ok(status.streamErrors.includes(error), `${label}: ${JSON.stringify(status.streamErrors)}`);
    // The malformed dialog never renews the valid-RPC clock: the idle age
    // still spans the full pre-error gap back to the last valid record.
    assert.ok(
      status.rpcIdleSeconds >= 0.3,
      `${label}: rpc idle ${status.rpcIdleSeconds}s must include the pre-error gap`,
    );
  }
});

test("valid prompt responses and events still renew the valid-RPC clock once each", async () => {
  const script = `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type !== "prompt") continue;
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
    setTimeout(() => {
      for (const event of ${JSON.stringify(completed().slice(1))}) process.stdout.write(JSON.stringify(event) + "\\n");
    }, 450);
  }
});
setInterval(() => {}, 1000);
`;
  const { status } = await run(script, {
    activityIdleMs: 2000,
    progressStallMs: 8000,
  });
  assert.equal(status.state, "completed");
  // The final events after the gap renewed the clock, so the reported RPC
  // idle age covers only the short settlement tail, not the 450 ms gap.
  assert.ok(status.rpcIdleSeconds < 0.3, `rpc idle ${status.rpcIdleSeconds}s must reflect the last valid event`);
});

test("a SIGTERM-resistant group uses a separate bounded cleanup deadline", { skip: process.platform !== "linux" }, async () => {
  // The leader and descendant trap SIGTERM. Productive work stops at its own
  // progress lease, then the separate cleanup allowance proves the group dead.
  const script = `
import { spawn } from "node:child_process";
process.on("SIGTERM", () => {});
const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"]);
descendant.on("spawn", () => process.stderr.write("DESCENDANT=" + descendant.pid + "\\n"));
process.stderr.write("CHILD=" + process.pid + "\\n");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  while (buffer.includes("\\n")) {
    const i = buffer.indexOf("\\n"); const command = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
  }
});
setInterval(() => {}, 1000);
`;
  let attemptDir: string | undefined;
  try {
    const outcome = await run(script, {
      activityWarningMs: 3000,
      activityIdleMs: 5000,
      progressWarningMs: 300,
      progressStallMs: 400,
      reportRecoveryIdleMs: 5000,
      graceMs: 250,
      cleanupTimeoutMs: 1000,
    });
    attemptDir = outcome.attemptDir;
    assert.equal(outcome.status.state, "stalled");
    assert.equal(outcome.status.stallCause, "progress_stagnation");
    assert.ok(
      outcome.status.elapsedSeconds < 1.4,
      `work plus separate cleanup must stay bounded, got ${outcome.status.elapsedSeconds}s`,
    );
    assert.ok(outcome.status.elapsedSeconds >= 0.35, "the progress lease must run first");
    assert.equal(outcome.status.deadlineCause, "idle_deadline");
    const stderr = await readFile(path.join(outcome.attemptDir, "stderr.log"), "utf8");
    const childPid = Number(/CHILD=(\d+)/.exec(stderr)?.[1]);
    const descendantPid = Number(/DESCENDANT=(\d+)/.exec(stderr)?.[1]);
    assert.ok(Number.isSafeInteger(childPid));
    assert.ok(Number.isSafeInteger(descendantPid));
    assert.ok(await isGone(childPid), "the SIGTERM-resistant leader must be dead");
    assert.ok(await isGone(descendantPid), "the SIGTERM-resistant descendant must be dead with the group");
  } finally {
    // Safety net: a failing assertion must never leak a fixture process.
    if (attemptDir !== undefined) {
      const stderr = await readFile(path.join(attemptDir, "stderr.log"), "utf8").catch(() => "");
      for (const pid of [/CHILD=(\d+)/, /DESCENDANT=(\d+)/].map((pattern) => Number(pattern.exec(stderr)?.[1]))) {
        if (Number.isSafeInteger(pid) && pid > 0) {
          for (const target of [pid, -pid]) {
            try {
              process.kill(target, "SIGKILL");
            } catch {
              // Already dead or already reaped.
            }
          }
        }
      }
    }
  }
});

/** Deterministic fake-clock probes: every delay advances the clock, so bounded loops finish instantly. */
function fakeClockProbes(options: {
  readonly groupExists: () => boolean;
  readonly processIsRunning?: () => boolean;
  readonly waitForClose?: (timeoutMs: number) => Promise<boolean>;
  readonly signals?: string[];
}): { readonly probes: TerminationProbes; readonly clock: () => number } {
  let clock = 0;
  return {
    clock: () => clock,
    probes: {
      now: () => clock,
      delay: async (ms) => {
        clock += ms;
      },
      processIsRunning: options.processIsRunning ?? (() => false),
      groupExists: options.groupExists,
      signalGroup: (name) => {
        options.signals?.push(name);
      },
      waitForClose: options.waitForClose ?? (async () => true),
    },
  };
}

test("termination reports persistent liveness when the group survives SIGKILL", async () => {
  const signals: string[] = [];
  const { probes } = fakeClockProbes({ groupExists: () => true, signals });
  const outcome = await terminateProcessGroupWith(200, 3200, probes);
  // The graceful window and the full verification floor both elapsed, the
  // group still exists, and no close proof can rescue the result.
  assert.deepEqual(outcome, { ok: false, reason: "group_alive" });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("termination clamps every wait to the cleanup deadline", async () => {
  const signals: string[] = [];
  const { probes, clock } = fakeClockProbes({ groupExists: () => true, processIsRunning: () => true, signals });
  const outcome = await terminateProcessGroupWith(200, 50, probes);
  assert.deepEqual(outcome, { ok: false, reason: "group_alive" });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.ok(clock() <= 50, `no wait may extend past the cleanup deadline, fake clock reached ${clock()}`);
});

test("termination succeeds when the group disappears hundreds of milliseconds after SIGKILL", async () => {
  let clock = 0;
  let killedAt: number | undefined;
  const probes: TerminationProbes = {
    now: () => clock,
    delay: async (ms) => { clock += ms; },
    processIsRunning: () => false,
    groupExists: () => killedAt === undefined || clock - killedAt < 350,
    signalGroup: (signal) => {
      if (signal === "SIGKILL") killedAt = clock;
    },
    waitForClose: async () => true,
  };
  const outcome = await terminateProcessGroupWith(100, 3200, probes);
  assert.deepEqual(outcome, { ok: true });
  assert.ok(clock >= 450 && clock < 3200, `group proof should take hundreds of milliseconds, got ${clock}`);
});

test("termination reports an unconfirmed close when the leader never closes", async () => {
  const signals: string[] = [];
  const { probes } = fakeClockProbes({
    groupExists: () => false,
    processIsRunning: () => true,
    waitForClose: async () => false,
    signals,
  });
  const outcome = await terminateProcessGroupWith(200, 3200, probes);
  // The group is gone, but the bounded close wait timed out and the leader
  // was never provably gone, so the close proof stays negative.
  assert.deepEqual(outcome, { ok: false, reason: "close_unconfirmed" });
  assert.deepEqual(signals, []);
});

test("termination resolves positively only on close plus a final dead-group probe", async () => {
  const positive = (closeSeen: boolean, running: boolean): TerminationProbes => ({
    now: () => 0,
    delay: async () => {},
    processIsRunning: () => running,
    groupExists: () => false,
    signalGroup: () => {},
    waitForClose: async () => closeSeen,
  });
  // The close event fired and the final group probe is false.
  assert.deepEqual(await terminateProcessGroupWith(200, 3200, positive(true, false)), { ok: true });
  // The close wait timed out but the leader's exit was recorded, so the leader is provably gone.
  assert.deepEqual(await terminateProcessGroupWith(200, 3200, positive(false, false)), { ok: true });
  // A group that died at entry still needs the leader's close or recorded exit.
  assert.deepEqual(await terminateProcessGroupWith(200, 3200, positive(true, true)), { ok: true });
});

test("a cleanup failure after termination records the sanitized terminal cleanup_failed state", async () => {
  const originalBuild = terminationProbes.build;
  try {
    terminationProbes.build = (child) => {
      const real = originalBuild(child);
      // The group always reports alive, even after SIGKILL: the real signals
      // still fire so the child dies, while the liveness proof stays negative.
      return { ...real, groupExists: () => true };
    };
    const { status, progress, attemptDir } = await run(eventScript([[{ type: "agent_start" }]]), {
      activityWarningMs: 5000,
      activityIdleMs: 9000,
      progressWarningMs: 300,
      progressStallMs: 400,
      reportRecoveryIdleMs: 9000,
    });
    assert.equal(status.state, "cleanup_failed");
    assert.equal(status.reportPresent, false);
    assert.equal(status.cleanupFailureReason, "group_alive");
    assert.doesNotMatch(JSON.stringify(status), /SIGKILL|SIGTERM|pid/i);
    // Full cleanup still completed and the final progress carries the terminal state.
    const stderrStat = await stat(path.join(attemptDir, "stderr.log"));
    assert.equal(stderrStat.mode & 0o777, 0o600);
    const persisted = JSON.parse(await readFile(path.join(attemptDir, "status.json"), "utf8")) as { state: string };
    assert.equal(persisted.state, "cleanup_failed");
    assert.equal(progress.at(-1)?.state, "cleanup_failed");
  } finally {
    terminationProbes.build = originalBuild;
  }
});

test("a missing leader close proof propagates close_unconfirmed", async () => {
  const originalBuild = terminationProbes.build;
  try {
    terminationProbes.build = (child) => {
      const real = originalBuild(child);
      let probed = false;
      return {
        ...real,
        groupExists: () => {
          if (!probed) {
            probed = true;
            return true;
          }
          return false;
        },
        processIsRunning: () => true,
        waitForClose: async () => false,
      };
    };
    const { status } = await run(eventScript([[{ type: "agent_start" }]]), {
      activityWarningMs: 1000,
      activityIdleMs: 2000,
      progressWarningMs: 150,
      progressStallMs: 200,
      reportRecoveryIdleMs: 2000,
      cleanupTimeoutMs: 1000,
    });
    assert.equal(status.state, "cleanup_failed");
    assert.equal(status.cleanupFailureReason, "close_unconfirmed");
  } finally {
    terminationProbes.build = originalBuild;
  }
});

test("supervisor source contains no total-work deadline timer or budget", async () => {
  // The one-shot wall-deadline timer was removed with the productive-work
  // ceiling; the interval ticker plus the pure liveness reducer are the only
  // wall-clock authority, and total elapsed time is never a stop condition.
  const source = await readFile(new URL("./supervisor.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "DEFAULT_WORK_TIMEOUT_MS",
    "workDeadline",
    "workBudgetSeconds",
    "remainingWorkSecondsAtAttemptStart",
    "timed_out",
  ]) {
    assert.ok(!source.includes(forbidden), `supervisor.ts must not contain "${forbidden}"`);
  }
  assert.match(source, /setInterval\(/);
});
