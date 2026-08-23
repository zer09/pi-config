import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPrivateDirectory } from "./artifacts.ts";
import { RECOVERY_PROMPT } from "./protocol.ts";
import {
  supervisePi,
  terminateProcessGroupWith,
  terminationProbes,
  type TerminationProbes,
} from "./supervisor.ts";
import type { DelegateProgress, PiRoute } from "./types.ts";

const ROUTE: PiRoute = { kind: "pi", provider: "fake", model: "model", thinking: "high" };

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
      timeoutMs: 2500,
      idleWarningMs: 200,
      idleTimeoutMs: 2300,
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
  }, { timeoutMs: 3500, idleWarningMs: 3000, idleTimeoutMs: 3400 });
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

test("a SIGTERM-resistant group is force-killed inside the cleanup-inclusive deadline", { skip: process.platform !== "linux" }, async () => {
  // The leader and its descendant both trap SIGTERM, so only the bounded
  // escalation to SIGKILL can end the group. supervisePi receives an absolute
  // cleanup-inclusive deadline: the soft supervision cutoff fires early
  // enough that graceful-then-forced termination and group verification all
  // fit inside it.
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
  const deadline = performance.now() + 1500;
  let attemptDir: string | undefined;
  try {
    const outcome = await run(script, {
      timeoutMs: 400,
      graceMs: 250,
      idleWarningMs: 3000,
      idleTimeoutMs: 5000,
      deadline,
    });
    attemptDir = outcome.attemptDir;
    assert.equal(outcome.status.state, "timed_out");
    assert.ok(
      outcome.status.elapsedSeconds < 1.4,
      `supervision plus termination must fit inside the deadline, got ${outcome.status.elapsedSeconds}s`,
    );
    assert.ok(outcome.status.elapsedSeconds >= 0.35, "the soft supervision cutoff must have run first");
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
  const outcome = await terminateProcessGroupWith(200, undefined, probes);
  // The graceful window and the full verification floor both elapsed, the
  // group still exists, and no close proof can rescue the result.
  assert.deepEqual(outcome, { ok: false, reason: "group_alive" });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("termination clamps every wait to the absolute deadline with no verification floor", async () => {
  const signals: string[] = [];
  const { probes, clock } = fakeClockProbes({ groupExists: () => true, processIsRunning: () => true, signals });
  const outcome = await terminateProcessGroupWith(200, 50, probes);
  assert.deepEqual(outcome, { ok: false, reason: "group_alive" });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.ok(clock() <= 50, `no wait may extend past the deadline, fake clock reached ${clock()}`);
});

test("termination reports an unconfirmed close when the leader never closes", async () => {
  const signals: string[] = [];
  const { probes } = fakeClockProbes({
    groupExists: () => false,
    processIsRunning: () => true,
    waitForClose: async () => false,
    signals,
  });
  const outcome = await terminateProcessGroupWith(200, undefined, probes);
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
  assert.deepEqual(await terminateProcessGroupWith(200, undefined, positive(true, false)), { ok: true });
  // The close wait timed out but the leader's exit was recorded, so the leader is provably gone.
  assert.deepEqual(await terminateProcessGroupWith(200, undefined, positive(false, false)), { ok: true });
  // A group that died at entry still needs the leader's close or recorded exit.
  assert.deepEqual(await terminateProcessGroupWith(200, undefined, positive(true, true)), { ok: true });
});

test("a share that cannot fit the mandatory reserve records a soft timeout without spawning", async () => {
  const built = await fixture(eventScript([completed()]));
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
    // The whole share is smaller than the mandatory forced-kill verification
    // plus final cleanup reserve, so no child may spawn at all.
    timeoutMs: 20,
    deadline: performance.now() + 20,
    idleWarningMs: 5000,
    idleTimeoutMs: 9000,
    maxOutputBytes: 1024 * 1024,
    graceMs: 5000,
    onProgress: (value) => progress.push(value),
  });
  assert.equal(status.state, "timed_out");
  assert.equal(status.exitCode, null);
  assert.equal(status.reportPresent, false);
  assert.ok(status.elapsedSeconds < 0.05, `the no-spawn path must return immediately, got ${status.elapsedSeconds}s`);
  // No child ever ran: the fixture leaves no args.json behind.
  await assert.rejects(() => stat(path.join(built.root, "args.json")));
  // Bounded sanitized cleanup still completed before returning.
  const stderrStat = await stat(path.join(attemptDir, "stderr.log"));
  assert.equal(stderrStat.mode & 0o777, 0o600);
  const persisted = JSON.parse(await readFile(path.join(attemptDir, "status.json"), "utf8")) as { state: string };
  assert.equal(persisted.state, "timed_out");
  assert.equal(progress.at(-1)?.state, "timed_out");
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
      timeoutMs: 400,
      idleWarningMs: 5000,
      idleTimeoutMs: 9000,
    });
    assert.equal(status.state, "cleanup_failed");
    assert.equal(status.reportPresent, false);
    // The persisted status is sanitized: no signal, pid, or failure reason detail.
    assert.doesNotMatch(JSON.stringify(status), /SIGKILL|SIGTERM|group_alive|close_unconfirmed/i);
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

test("a sub-100 ms share still enforces its deadline with one-shot precision", { skip: process.platform !== "linux" }, async () => {
  // A shell fixture is SIGTERM-resistant within milliseconds of spawn and
  // keeps a descendant in the same process group. The supervision share is
  // 95 ms; the 100 ms interval's first possible deadline check is far too
  // late, so only the one-shot soft-deadline timer can cut the route off in
  // time and still prove a dead group plus completed cleanup inside the share.
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-sub100-"));
  fixtureRoots.push(root);
  const scriptPath = path.join(root, "resist.sh");
  const promptPath = path.join(root, "prompt.md");
  await writeFile(scriptPath, [
    "#!/bin/sh",
    "trap 'echo TERM_AT=$(date +%s%3N) >&2' TERM",
    "node -e \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\" &",
    'echo "DESCENDANT=$!" >&2',
    'echo "CHILD=$$" >&2',
    'echo "START_AT=$(date +%s%3N)" >&2',
    "while :; do sleep 3600; done",
    "",
  ].join("\n"), { mode: 0o700 });
  await chmod(scriptPath, 0o700);
  await writeFile(promptPath, "test", { mode: 0o600 });
  const attemptDir = path.join(root, "attempt");
  await createPrivateDirectory(attemptDir);
  const progress: DelegateProgress[] = [];
  try {
    const deadline = performance.now() + 95;
    const supervisionStarted = performance.now();
    const status = await supervisePi({
      label: "test",
      role: "review-a",
      attempt: 1,
      cwd: root,
      artifactDir: attemptDir,
      promptPath,
      route: ROUTE,
      piInvocation: { command: scriptPath, prefixArgs: [] },
      timeoutMs: 95,
      deadline,
      idleWarningMs: 5000,
      idleTimeoutMs: 9000,
      maxOutputBytes: 1024 * 1024,
      graceMs: 400,
      onProgress: (value) => progress.push(value),
    });
    assert.equal(status.state, "timed_out");
    const wallMs = performance.now() - supervisionStarted;
    // The soft supervision cutoff ran first (the share is not cut short at
    // spawn), the whole kill-plus-cleanup finished inside the share plus
    // scheduler tolerance, and the 100 ms ticker alone could not have
    // stopped the route this early.
    assert.ok(wallMs >= 25, `the soft supervision cutoff must run before termination, wall ${wallMs.toFixed(1)}ms`);
    assert.ok(
      wallMs < 150,
      `the sub-100 ms share must complete its kill and cleanup inside the share plus tolerance, wall ${wallMs.toFixed(1)}ms`,
    );
    assert.ok(status.elapsedSeconds <= 0.1, `elapsed must stay at or under the share, got ${status.elapsedSeconds}s`);
    const stderr = await readFile(path.join(attemptDir, "stderr.log"), "utf8");
    const childPid = Number(/CHILD=(\d+)/.exec(stderr)?.[1]);
    const descendantPid = Number(/DESCENDANT=(\d+)/.exec(stderr)?.[1]);
    assert.ok(Number.isSafeInteger(childPid), "the resistant leader must have started");
    assert.ok(Number.isSafeInteger(descendantPid), "the resistant descendant must have started");
    const startAt = Number(/START_AT=(\d+)/.exec(stderr)?.[1]);
    const termAt = Number(/TERM_AT=(\d+)/.exec(stderr)?.[1]);
    if (Number.isSafeInteger(startAt) && Number.isSafeInteger(termAt)) {
      assert.ok(
        termAt - startAt < 95,
        `SIGTERM must come from the one-shot timer before the interval could fire, waited ${termAt - startAt}ms`,
      );
    }
    // The whole process group is dead and cleanup fully completed.
    assert.ok(await isGone(childPid), "the SIGTERM-resistant leader must be dead inside the share");
    assert.ok(await isGone(descendantPid), "the SIGTERM-resistant descendant must be dead with the group");
    const stderrStat = await stat(path.join(attemptDir, "stderr.log"));
    assert.equal(stderrStat.mode & 0o777, 0o600);
    const persisted = JSON.parse(await readFile(path.join(attemptDir, "status.json"), "utf8")) as { state: string };
    assert.equal(persisted.state, "timed_out");
    assert.equal(progress.at(-1)?.state, "timed_out");
    return;
  } finally {
    // Safety net: a failing assertion must never leak a fixture process.
    const stderr = await readFile(path.join(attemptDir, "stderr.log"), "utf8").catch(() => "");
    for (const pid of [/CHILD=(\d+)/, /DESCENDANT=(\d+)/].map((pattern) => Number(pattern.exec(stderr)?.[1]))) {
      for (const target of [pid, -pid]) {
        try {
          process.kill(target, "SIGKILL");
        } catch {
          // Already dead or already reaped.
        }
      }
    }
  }
});
