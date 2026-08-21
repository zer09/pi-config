import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPrivateDirectory } from "./artifacts.ts";
import { superviseClaude, supervisePi } from "./supervisor.ts";
import type { ClaudeRoute, DelegateProgress, DelegateRole, PiRoute } from "./types.ts";

const ROUTE: PiRoute = { kind: "pi", provider: "fake", model: "model", thinking: "high" };
const CLAUDE_ROUTE: ClaudeRoute = { kind: "claude", model: "claude-opus-5", effort: "medium" };

async function fixture(scriptBody: string): Promise<{
  root: string;
  promptPath: string;
  invocation: { command: string; prefixArgs: string[] };
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-ts-test-"));
  const scriptPath = path.join(root, "fake-pi.mjs");
  const promptPath = path.join(root, "prompt.md");
  await writeFile(scriptPath, scriptBody, { mode: 0o700 });
  await chmod(scriptPath, 0o700);
  await writeFile(promptPath, "test", { mode: 0o600 });
  return {
    root,
    promptPath,
    invocation: { command: process.execPath, prefixArgs: [scriptPath] },
  };
}

function emitScript(events: unknown[], trailing = "", sleepMs = 0): string {
  return `
const events = ${JSON.stringify(events)};
for (const event of events) process.stdout.write(JSON.stringify(event) + "\\n");
${trailing ? `process.stdout.write(${JSON.stringify(trailing)});` : ""}
${sleepMs ? `await new Promise((resolve) => setTimeout(resolve, ${sleepMs}));` : ""}
`;
}

async function run(script: string, overrides: Partial<Parameters<typeof supervisePi>[0]> = {}) {
  const built = await fixture(script);
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
    idleTimeoutMs: 400,
    maxOutputBytes: 1024 * 1024,
    graceMs: 100,
    onProgress: (value) => progress.push(value),
    ...overrides,
  });
  return { status, progress, attemptDir };
}

test("extracts only the final report and records live last-event time", async () => {
  const events = [
    { type: "session" },
    { type: "agent_start" },
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "PRIVATE_THOUGHT" },
    },
    {
      type: "tool_execution_start",
      toolCallId: "1",
      toolName: "read",
      args: { path: "PRIVATE_PATH" },
    },
    {
      type: "tool_execution_end",
      toolCallId: "1",
      toolName: "read",
      result: { content: "PRIVATE_RESULT" },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "Final report\n\nDELEGATE_RESULT: COMPLETED" }],
      },
    },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
  const { status, progress, attemptDir } = await run(emitScript(events, "", 10_000));
  assert.equal(status.state, "completed");
  assert.equal(status.completionCleanupPerformed, true);
  assert.equal(status.agentSettledSeen, true);
  assert.match(status.lastEventAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(progress.some((item) => /^\d{4}-\d{2}-\d{2}T/.test(item.lastEventAt)));
  const report = await readFile(path.join(attemptDir, "report.md"), "utf8");
  const persisted = JSON.stringify(status) + report;
  assert.doesNotMatch(persisted, /PRIVATE_THOUGHT|PRIVATE_PATH|PRIVATE_RESULT/);
});

test("empty activity stalls and reports the last valid event", async () => {
  const events = [{ type: "session" }, { type: "agent_start" }];
  const { status } = await run(emitScript(events, "", 10_000), {
    idleWarningMs: 50,
    idleTimeoutMs: 150,
  });
  assert.equal(status.state, "stalled");
  assert.equal(status.lastEvent, "agent_start");
  assert.ok(status.idleWarningCount >= 1);
});

test("a fast output burst cannot bypass the output limit", async () => {
  const events = [
    { type: "session" },
    { type: "agent_start" },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: `${"x".repeat(5000)}\n\nDELEGATE_RESULT: COMPLETED` }],
      },
    },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
  const { status } = await run(emitScript(events), { maxOutputBytes: 100 });
  assert.equal(status.state, "output_limit");
});

test("natural completion removes a leftover descendant process", { skip: process.platform !== "linux" }, async () => {
  const built = await fixture(`
import { spawn } from "node:child_process";
const child = spawn("sleep", ["10"]);
process.stdout.write(JSON.stringify({ type: "session" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
process.stdout.write(JSON.stringify({
  type: "message_end",
  message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done\\n\\nDELEGATE_RESULT: COMPLETED" }] },
}) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", willRetry: false }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
console.error("DESCENDANT=" + child.pid);
`);
  const attemptDir = path.join(built.root, "attempt");
  await createPrivateDirectory(attemptDir);
  const status = await supervisePi({
    label: "descendant",
    role: "review-a",
    attempt: 1,
    cwd: built.root,
    artifactDir: attemptDir,
    promptPath: built.promptPath,
    route: ROUTE,
    piInvocation: built.invocation,
    timeoutMs: 2000,
    idleWarningMs: 200,
    idleTimeoutMs: 800,
    maxOutputBytes: 1024 * 1024,
    graceMs: 100,
  });
  assert.equal(status.state, "completed");
  const stderr = await readFile(path.join(attemptDir, "stderr.log"), "utf8");
  const pid = Number(/DESCENDANT=(\d+)/.exec(stderr)?.[1]);
  assert.ok(Number.isSafeInteger(pid));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test(
  "Claude supervision keeps a defensively misrouted oracle read-only while preserving role permissions",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "delegate-claude-test-"));
    const binDir = path.join(root, "bin");
    const argsPath = path.join(root, "claude-args.txt");
    const promptPath = path.join(root, "prompt.md");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      path.join(binDir, "claude"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsPath)}\nprintf 'Done\\n\\nDELEGATE_RESULT: COMPLETED\\n'\n`,
      { mode: 0o700 },
    );
    await chmod(path.join(binDir, "claude"), 0o700);
    await writeFile(promptPath, "test", { mode: 0o600 });
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
    try {
      const superviseRole = async (role: DelegateRole, attemptDir: string) => {
        await createPrivateDirectory(attemptDir);
        const status = await superviseClaude({
          label: "test",
          role,
          attempt: 1,
          cwd: root,
          artifactDir: attemptDir,
          promptPath,
          route: CLAUDE_ROUTE,
          prompt: "test",
          timeoutMs: 5000,
          idleWarningMs: 1000,
          idleTimeoutMs: 4000,
          maxOutputBytes: 1024 * 1024,
          graceMs: 100,
        });
        assert.equal(status.state, "completed");
        return (await readFile(argsPath, "utf8")).split("\n").filter(Boolean);
      };
      const argValue = (args: string[], flag: string): string => {
        const index = args.indexOf(flag);
        assert.ok(index >= 0 && index + 1 < args.length, `missing ${flag} in ${JSON.stringify(args)}`);
        return args[index + 1]!;
      };

      for (const role of ["oracle", "review-a"] as const) {
        const args = await superviseRole(role, path.join(root, `attempt-${role}`));
        assert.equal(argValue(args, "--permission-mode"), "dontAsk", `${role} must not accept edits`);
        assert.equal(argValue(args, "--allowedTools"), "Read,Glob,Grep,Bash");
        assert.equal(argValue(args, "--disallowedTools"), "Edit,Write,Agent");
        assert.match(args.at(-1)!, /read-only/);
        assert.ok(!args.includes("acceptEdits"), `${role} must not gain mutation permissions`);
      }

      const mutating = await superviseRole("implementation", path.join(root, "attempt-implementation"));
      assert.equal(argValue(mutating, "--permission-mode"), "acceptEdits");
      assert.equal(argValue(mutating, "--allowedTools"), "Read,Edit,Write,Glob,Grep,Bash");
      assert.equal(argValue(mutating, "--disallowedTools"), "Agent");
      assert.doesNotMatch(mutating.at(-1)!, /read-only/);
    } finally {
      process.env.PATH = previousPath;
    }
  },
);

test("partial trailing JSON fails a completed lifecycle closed", async () => {
  const events = [
    { type: "session" },
    { type: "agent_start" },
    {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "Done\n\nDELEGATE_RESULT: COMPLETED" }],
      },
    },
    { type: "agent_end", willRetry: false },
    { type: "agent_settled" },
  ];
  const { status } = await run(emitScript(events, "{", 10_000));
  assert.equal(status.state, "invalid_stream");
  assert.ok(status.streamErrors.some((error) => error.includes("partial line")));
});
