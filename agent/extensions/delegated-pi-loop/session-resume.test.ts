import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chmodSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDelegatePrompt, LIVE_CONTINUATION_PROMPT, REPORT_RECOVERY_PROMPT, RESTART_AFTER_WORK_NOTE } from "./instructions.ts";
import { finalizeDelegateRun } from "./result.ts";
import { requireRole, validateRoutingConfig } from "./routing.ts";
import { runDelegate } from "./runner.ts";
import { terminationProbes } from "./supervisor.ts";
import type { AttemptStatus, DelegateProgress, DelegateRunResult, RunOptions } from "./types.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "delegate-resume-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_DELEGATE_ARTIFACT_PARENT = root;
process.env.PI_CODING_AGENT_DIR = path.join(root, "diagnostics");
after(async () => {
  delete process.env.PI_DELEGATE_ARTIFACT_PARENT;
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

const routes = ["prov-a/model-a", "prov-b/model-b", "prov-c/model-c"];
const levels = ["high", "low", "off"];
const sentinel = "PERSISTED-CONTEXT-SENTINEL";
const sessionId = "fixture-private-session-id";
const routingConfig = validateRoutingConfig({
  version: 2, thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"], disabledProviders: [],
  models: Object.fromEntries(routes.map((route, i) => {
    const [provider, model] = route.split("/");
    return [model, { providers: { [provider!]: { thinking: [levels[i]], default: levels[i] } } }];
  })),
  profiles: { chain: { overridePolicy: "rejected", tiers: routes.map((route, i) => ({ model: route.split("/")[1], thinking: levels[i] })) } },
  assignments: { solution: ["chain"], review: ["chain"], implementation: "chain", remediation: "chain", verification: "chain", oracle: "chain" },
});

type Trace = {
  kind: string; pid: number; route: string; args?: string[]; file?: string; directory?: string;
  fileMode?: number; directoryMode?: number; initialSize?: number; context?: boolean; priorGone?: boolean;
  descendant?: number; command?: { id: string; type: string; message?: string }; bytes?: number;
};
interface Settings {
  behaviors?: string[];
  switchFaultRoutes?: number[];
  faultStep?: number;
  tamper?: string;
  catalog?: string[];
  history?: string[];
  restartAttempts?: number[];
}

async function fixture(settings: Settings = {}) {
  const cwd = await mkdtemp(path.join(root, "fixture-"));
  const script = path.join(cwd, "fake-pi.mjs");
  await writeFile(path.join(cwd, "outside"), "unchanged fixture", { mode: 0o600 });
  await writeFile(script, `
import { appendFileSync, chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const settings = ${JSON.stringify(settings)};
const routes = ${JSON.stringify(routes)};
const sentinel = ${JSON.stringify(sentinel)};
const args = process.argv.slice(2);
const trace = (entry) => appendFileSync("trace.jsonl", JSON.stringify({ pid: process.pid, ...entry }) + "\\n", { mode: 0o600 });
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
if (args.includes("--list-models")) {
  const route = args[args.indexOf("--list-models") + 1];
  trace({ kind: "catalog", route, args });
  if ((settings.catalog ?? routes).includes(route)) console.log(route.replace("/", " ") + " 100 100 yes yes");
  process.exit(0);
}
let provider = args[args.indexOf("--provider") + 1];
let model = args[args.indexOf("--model") + 1];
let thinking = args[args.indexOf("--thinking") + 1];
const route = () => provider + "/" + model;
const directory = args[args.indexOf("--session-dir") + 1];
const file = args[args.indexOf("--session") + 1];
const previous = readFileSync("trace.jsonl", "utf8").trim().split("\\n").map(JSON.parse).filter((entry) => entry.kind === "start");
const initialSize = lstatSync(file).size;
const header = { type: "session", version: 3, id: ${JSON.stringify(sessionId)}, timestamp: "2026-08-01T00:00:00.000Z", cwd: process.cwd() };
if (initialSize === 0) appendFileSync(file, JSON.stringify(header) + "\\n");
const entries = readFileSync(file, "utf8").split("\\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
// Pi repairs a missing final LF on load, after validating the first parsed header.
if (!readFileSync(file, "utf8").endsWith("\\n")) appendFileSync(file, "\\n");
const byId = new Map(entries.filter((entry) => entry.type !== "session").map((entry) => [entry.id, entry]));
let leaf = entries.at(-1)?.id;
let context = false;
const visited = new Set();
while (byId.has(leaf) && !visited.has(leaf)) {
  visited.add(leaf);
  const entry = byId.get(leaf);
  if (entry.type === "message" && entry.message?.role === "user" && typeof entry.message.content === "string"
    && entry.message.content.startsWith("# Task:") && entry.message.content.includes("ORIGINAL-ASSIGNMENT:")) context = true;
  leaf = entry.parentId;
}
let parentId = entries.filter((entry) => entry.type !== "session").at(-1)?.id ?? null;
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
trace({ kind: "start", route: route(), args, file, directory, context, initialSize,
  fileMode: lstatSync(file).mode & 0o7777, directoryMode: lstatSync(directory).mode & 0o7777,
  priorGone: previous.every((entry) => gone(-entry.pid) && gone(entry.descendant)), descendant: descendant.pid });
process.on("exit", () => trace({ kind: "exit", route: route() }));
const exit = (code) => {
  if (descendant.exitCode === null) { descendant.once("close", () => process.exit(code)); descendant.kill(); }
  else process.exit(code);
};
process.on("SIGTERM", () => {
  if (settings.tamper && previous.length === 0) {
    if (settings.tamper === "mode") chmodSync(file, 0o644);
    else {
      rmSync(file);
      if (settings.tamper === "symlink") symlinkSync(process.cwd() + "/outside", file);
      if (settings.tamper === "directory") mkdirSync(file, { mode: 0o600 });
    }
  }
  exit(0);
});
const emit = (event, tail = "") => {
  const line = JSON.stringify(event) + "\\n" + tail;
  trace({ kind: "output", route: route(), bytes: Buffer.byteLength(line) });
  process.stdout.write(line);
};
const settle = () => { emit({ type: "agent_end", willRetry: false }); emit({ type: "agent_settled" }); };
let round = 0;
let step = 0;
let switchOrigin = 0;
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  while (buffer.includes("\\n")) {
    const newline = buffer.indexOf("\\n");
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    const command = JSON.parse(line);
    trace({ kind: command.type === "prompt" ? "prompt" : "control", route: route(), command, context, bytes: Buffer.byteLength(line + "\\n") });
    if (command.type !== "prompt") {
      if (step % 4 === 0) switchOrigin = routes.indexOf(route());
      step += 1;
      const fault = (settings.switchFaultRoutes ?? [0]).includes(switchOrigin) && (step - 1) % 4 + 1 === (settings.faultStep ?? 1);
      const response = { id: command.id, type: "response", command: command.type, success: true };
      if (fault && (settings.faultStep ?? 1) !== 4) { emit({ ...response, success: false, error: "503 PRIVATE-PROVIDER-ERROR " + file + " " + sentinel }); continue; }
      if (command.type === "get_state") response.data = { model: { provider, id: model }, thinkingLevel: thinking,
        isStreaming: false, isCompacting: false, pendingMessageCount: 0, messageCount: 3,
        sessionId: ${JSON.stringify(sessionId)}, sessionFile: file };
      else if (command.type === "set_model") { provider = command.provider; model = command.modelId; round = 0; response.data = { provider, id: model }; }
      else if (command.type === "set_thinking_level") thinking = command.level;
      emit(response, fault ? "{" : "");
      continue;
    }
    round += 1;
    const behavior = (settings.behaviors ?? ["provider", "complete"])[routes.indexOf(route())] ?? "complete";
    if (behavior === "reject") { emit({ id: command.id, type: "response", command: "prompt", success: false }); continue; }
    // Pi accepts preflight before appending the user message.
    emit({ id: command.id, type: "response", command: "prompt", success: true });
    trace({ kind: "ack", route: route() });
    if (behavior === "ack-exit") { exit(3); continue; }
    const message = { type: "message", id: process.pid + "-" + step + "-" + round, parentId, timestamp: header.timestamp,
      message: { role: "user", content: command.message, timestamp: 1 }, context: sentinel };
    const history = round === 1 ? settings.history?.[previous.length] : undefined;
    if (history === "truncated") appendFileSync(file, JSON.stringify(message).slice(0, -10));
    else if (history === "header-only") { /* No durable assignment yet. */ }
    else if (history === "continuation-only") appendFileSync(file, JSON.stringify({ ...message, message: { ...message.message, content: ${JSON.stringify(LIVE_CONTINUATION_PROMPT)} } }) + "\\n");
    else if (history === "off-branch") {
      appendFileSync(file, JSON.stringify(message) + "\\n");
      appendFileSync(file, JSON.stringify({ ...message, id: "other-branch", parentId: null, message: { ...message.message, content: "Other work" } }) + "\\n");
    } else if (history === "malformed-header") writeFileSync(file, JSON.stringify({ ...header, id: null, private: sentinel }) + "\\n");
    else if (history === "identity-change") writeFileSync(file, JSON.stringify({ ...header, id: "CHANGED-PRIVATE-ID" }) + "\\n" + JSON.stringify({ ...message, parentId: null }) + "\\n");
    else if (history === "unsafe-tree") appendFileSync(file, JSON.stringify({ ...message, parentId: "MISSING-PRIVATE-ID" }) + "\\n");
    else if (history === "over-bytes") truncateSync(file, 64 * 1024 * 1024 + 1);
    else if (history === "over-line") appendFileSync(file, "x".repeat(4 * 1024 * 1024 + 1));
    else if (history === "over-records") appendFileSync(file, "\\n".repeat(100000));
    else {
      appendFileSync(file, JSON.stringify(message) + "\\n");
      if (history === "malformed-tail") appendFileSync(file, '{"type":"message"');
    }
    parentId = message.id;
    context = true;
    trace({ kind: "persist", route: route() });
    emit({ type: "agent_start" });
    if (behavior === "dead") { exit(3); continue; }
    if (behavior === "stalled") continue;
    if (behavior === "invalid-stream") { process.stdout.write("{invalid\\n"); continue; }
    if (behavior === "output") { process.stdout.write("x".repeat(20000)); continue; }
    if (behavior === "active-tool" || behavior === "tools-provider") {
      emit({ type: "tool_execution_start", toolCallId: "work", toolName: "read", args: {} });
      if (behavior === "tools-provider") emit({ type: "tool_execution_end", toolCallId: "work", toolName: "read", result: {}, isError: false });
    }
    if (["provider", "active-tool", "tools-provider"].includes(behavior) || (behavior === "recovery-provider" && round === 2)) {
      emit({ type: "message_update", assistantMessageEvent: { type: "error", errorMessage: "503 PRIVATE-PROVIDER-ERROR " + sentinel + " " + file } });
    } else if (!(["recovery-provider", "recover"].includes(behavior) && round === 1)) {
      const outcome = behavior === "blocked" ? "BLOCKED" : "COMPLETED";
      emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Finished.\\n\\nDELEGATE_RESULT: " + outcome }] } });
    }
    settle();
  }
});
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  const options: RunOptions = {
    role: "solution-a", prompt: "ORIGINAL-ASSIGNMENT: complete the single increment.", cwd, routingConfig,
    piInvocation: { command: process.execPath, prefixArgs: [script] },
    resourceSelection: { catalogArgs: ["--no-extensions"], runtimeArgs: ["--no-extensions", "--no-skills"], verifyCatalogSpawn() {}, verifyRuntimeSpawn() {} },
    activityWarningMs: 250, activityIdleMs: 800, progressWarningMs: 1500, progressStallMs: 3000,
    reportRecoveryIdleMs: 600, graceMs: 150, cleanupTimeoutMs: 1500, catalogTimeoutMs: 1000, liveSwitchTimeoutMs: 500,
    maxOutputBytes: 12000,
  };
  return { cwd, options, trace: async (): Promise<Trace[]> => {
    try { return (await readFile(path.join(cwd, "trace.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line)); }
    catch { return []; }
  } };
}

function gone(pid: number): boolean {
  try { process.kill(pid, 0); return false; } catch { return true; }
}

async function check(settings: Settings, body: (result: DelegateRunResult, trace: Trace[], status: AttemptStatus[]) => void | Promise<void>, overrides: Partial<RunOptions> = {}) {
  const f = await fixture(settings);
  const progress: DelegateProgress[] = [];
  let result: DelegateRunResult | undefined;
  try {
    result = await runDelegate({ ...f.options, ...overrides, onProgress: (entry) => progress.push(entry) });
    const trace = await f.trace();
    const starts = trace.filter((entry) => entry.kind === "start");
    const statuses: AttemptStatus[] = await Promise.all((await readdir(result.artifactDir)).filter((name) => name.startsWith("attempt-")).sort()
      .map(async (name) => JSON.parse(await readFile(path.join(result!.artifactDir, name, "status.json"), "utf8"))));
    await body(result, trace, statuses);
    assert.ok(starts.every((entry) => entry.priorGone && gone(entry.pid) && gone(entry.descendant!)), "positive old-group cleanup precedes replacement");
    assert.equal(new Set(starts.map((entry) => entry.file)).size, 1);
    assert.equal(starts[0]!.initialSize, 0);
    assert.ok(starts.every((entry) => entry.fileMode === 0o600 && entry.directoryMode === 0o700));
    assert.equal(starts[0]!.directory, result.artifactDir);
    assert.equal(starts[0]!.file, path.join(result.artifactDir, "session.jsonl"));
    assert.ok(starts.every((entry) => !entry.args!.includes("--no-session") && !entry.args!.includes("--session-id")));
    assert.ok(trace.filter((entry) => entry.kind === "catalog").every((entry) => !entry.args!.some((arg) => arg.startsWith("--session") || arg === "--no-session")));
    const restarted = settings.restartAttempts ?? [];
    assert.deepEqual(result.attempts.flatMap((entry, i) => entry.restartAfterWork ? [i] : []), restarted);
    assert.equal(result.progress.restartAfterWorkCount, restarted.length);
    assert.ok(progress.every((entry) => entry.restartAfterWorkCount <= restarted.length));
    assert.ok(progress.every((entry, i) => i === 0 || entry.restartAfterWorkCount >= progress[i - 1]!.restartAfterWorkCount));
    for (const entry of trace.filter((entry) => entry.kind === "persist")) {
      assert.ok(trace.slice(0, trace.indexOf(entry)).some((prior) => prior.kind === "ack" && prior.pid === entry.pid));
    }
    const original = buildDelegatePrompt(requireRole(routingConfig, f.options.role), f.cwd, f.options.prompt);
    const prompts = trace.filter((entry) => entry.kind === "prompt");
    assert.equal(prompts[0]!.command!.message, original);
    assert.ok(prompts.every((entry) => entry.command!.message!.split(RESTART_AFTER_WORK_NOTE).length <= 2));
    if (restarted.length === 0) assert.ok(prompts.every((entry) => !entry.command!.message!.includes(RESTART_AFTER_WORK_NOTE)));
    const toolResult = await finalizeDelegateRun(result);
    let diagnostic = "";
    const diagnosticPath = toolResult.details?.diagnosticPath;
    if (typeof diagnosticPath === "string") diagnostic = await readFile(diagnosticPath, "utf8");
    const exposed = JSON.stringify({ result, progress, statuses, toolResult, diagnostic });
    for (const privateValue of [sentinel, sessionId, "CHANGED-PRIVATE-ID", "MISSING-PRIVATE-ID", starts[0]!.file!, f.options.prompt, "PRIVATE-PROVIDER-ERROR", ...starts.map((entry) => String(entry.pid))]) {
      assert.ok(!exposed.includes(privateValue), "private session data must not escape supervision");
    }
    await assert.rejects(lstat(starts[0]!.file!), { code: "ENOENT" });
    await assert.rejects(lstat(result.artifactDir), { code: "ENOENT" });
  } finally {
    if (result) await rm(result.artifactDir, { recursive: true, force: true });
    for (const entry of await f.trace()) {
      if (entry.kind !== "start" || gone(entry.pid)) continue;
      try { process.kill(-entry.pid, "SIGKILL"); } catch {}
    }
  }
}

for (const [behavior, state] of [
  ["provider", "provider_failed"], ["tools-provider", "provider_failed"], ["stalled", "stalled"],
  ["invalid-stream", "invalid_stream"], ["output", "output_limit"], ["dead", "child_failed"],
  ["active-tool", "provider_failed"], ["recovery-provider", "provider_failed"], ["reject", "prompt_rejected"],
] as const) {
  test(`persisted replacement after ${behavior} reads prior context before the correct prompt`, async () => {
    await check({ behaviors: [behavior, "recover"] }, (result, trace, status) => {
      assert.equal(result.state, "completed");
      assert.deepEqual(result.attempts.map((entry) => entry.state), [state, "completed"]);
      assert.deepEqual(result.attempts.map((entry) => entry.route), routes.slice(0, 2).map((route, i) => `${route}:${levels[i]}`));
      assert.equal(result.selectedRoute, `${routes[1]}:${levels[1]}`);
      const starts = trace.filter((entry) => entry.kind === "start");
      assert.deepEqual(starts.map((entry) => entry.route), routes.slice(0, 2));
      assert.notEqual(starts[0]!.pid, starts[1]!.pid);
      assert.equal(starts[1]!.context, behavior !== "reject");
      const replacement = trace.filter((entry) => entry.kind === "prompt" && entry.pid === starts[1]!.pid);
      assert.equal(replacement[0]!.command!.id, "prompt-1");
      assert.equal(replacement[0]!.command!.message, behavior === "reject" ? trace.find((entry) => entry.kind === "prompt")!.command!.message : LIVE_CONTINUATION_PROMPT);
      assert.ok(trace.indexOf(starts[1]!) < trace.indexOf(replacement[0]!), "replacement loads the sentinel before continuation");
      assert.equal(replacement[1]!.command!.message, REPORT_RECOVERY_PROMPT);
      assert.deepEqual(status.map((entry) => entry.reportNudgeCount), [behavior === "recovery-provider" ? 1 : 0, 1]);
      assert.equal(status[1]!.providerFailureCategory, undefined);
      assert.equal(status[1]!.toolExecutionCount, 0);
      assert.ok(status.every((entry) => entry.outputBytes <= 12000 || entry.state === "output_limit"));
      if (["stalled", "invalid-stream", "output", "dead", "active-tool"].includes(behavior)) {
        assert.equal(trace.filter((entry) => entry.kind === "control").length, 0);
      } else assert.equal(trace.filter((entry) => entry.kind === "control").length, 1);
    });
  });
}

test("failed final live-switch boundary resumes the same target without a synthetic attempt", async () => {
  await check({ behaviors: ["recovery-provider", "complete"], faultStep: 4 }, (result, trace) => {
    assert.equal(result.state, "completed");
    assert.equal(result.attempts.length, 2);
    assert.equal(result.selectedRoute, `${routes[1]}:${levels[1]}`);
    const starts = trace.filter((entry) => entry.kind === "start");
    assert.deepEqual(starts.map((entry) => entry.route), routes.slice(0, 2));
    assert.equal(starts[1]!.context, true);
    assert.equal(trace.filter((entry) => entry.kind === "control").length, 4);
    assert.equal(trace.filter((entry) => entry.kind === "prompt").at(-1)!.command!.message, LIVE_CONTINUATION_PROMPT);
  });
});

for (const settings of [
  { behaviors: ["provider", "reject", "complete"], switchFaultRoutes: [0, 1] },
  { behaviors: ["provider", "reject", "complete"], switchFaultRoutes: [0] },
  { behaviors: ["tools-provider", "provider", "complete"], switchFaultRoutes: [1] },
]) {
  test(`chain acceptance survives replacement, live reuse, and later rejection: ${JSON.stringify(settings)}`, async () => {
    await check(settings, (result, trace) => {
      assert.equal(result.state, "completed");
      assert.equal(result.attempts.length, 3);
      const prompts = trace.filter((entry) => entry.kind === "prompt");
      assert.ok(prompts.slice(1).every((entry) => entry.command!.message === LIVE_CONTINUATION_PROMPT));
      assert.ok(trace.filter((entry) => entry.kind === "start").slice(1).every((entry) => entry.context));
    });
  });
}

test("replacement skips unavailable catalogs without consuming acceptance or prefetching", async () => {
  await check({ behaviors: ["invalid-stream"], catalog: [routes[0]!, routes[2]!] }, (result, trace) => {
    assert.deepEqual(result.attempts.map((entry) => entry.state), ["invalid_stream", "catalog_unavailable", "completed"]);
    assert.deepEqual(trace.filter((entry) => entry.kind === "start").map((entry) => entry.route), [routes[0], routes[2]]);
    const nextCatalog = trace.findIndex((entry) => entry.kind === "catalog" && entry.route === routes[1]);
    assert.ok(trace.findIndex((entry) => entry.kind === "prompt") < nextCatalog);
    assert.equal(trace.filter((entry) => entry.kind === "prompt").at(-1)!.command!.message, LIVE_CONTINUATION_PROMPT);
  });
});

for (const history of ["header-only", "truncated", "off-branch", "continuation-only"]) {
  test(`acknowledged ${history} replays on the selected route with one attributed restart`, async () => {
    await check({ history: [history], restartAttempts: [0] }, (result, trace) => {
      assert.equal(result.state, "completed");
      assert.deepEqual(result.attempts.map((entry) => entry.route), routes.slice(0, 2).map((route, i) => `${route}:${levels[i]}`));
      const starts = trace.filter((entry) => entry.kind === "start");
      assert.deepEqual(starts.map((entry) => entry.route), routes.slice(0, 2));
      assert.equal(starts[1]!.context, false);
      const replacement = trace.filter((entry) => entry.kind === "prompt")[1]!;
      const original = trace.find((entry) => entry.kind === "prompt")!.command!.message!;
      assert.equal(replacement.command!.message, original.replace("\n\n## Attempt limits", `\n\n${RESTART_AFTER_WORK_NOTE}\n\n## Attempt limits`));
      assert.equal(replacement.command!.id, "prompt-1");
    });
  });
}

test("exit between acknowledgement and append deliberately replays, then durable replay permits continuation", async () => {
  await check({ behaviors: ["ack-exit", "provider", "complete"], switchFaultRoutes: [1], restartAttempts: [0] }, (result, trace) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((entry) => entry.state), ["child_failed", "provider_failed", "completed"]);
    const prompts = trace.filter((entry) => entry.kind === "prompt");
    assert.equal(prompts[1]!.command!.message!.split(RESTART_AFTER_WORK_NOTE).length, 2);
    assert.equal(prompts[2]!.command!.message, LIVE_CONTINUATION_PROMPT);
    assert.deepEqual(trace.filter((entry) => entry.kind === "start").map((entry) => entry.context), [false, false, true]);
    assert.equal(trace.filter((entry) => entry.kind === "persist" && entry.pid === prompts[0]!.pid).length, 0);
  });
});

for (const history of ["header-only", "truncated", "off-branch", "continuation-only"]) {
  test(`durable replay after ${history} permits a further fresh continuation`, async () => {
    await check({ history: [history], behaviors: ["provider", "provider", "complete"], switchFaultRoutes: [0, 1], restartAttempts: [0] }, (result, trace) => {
      assert.equal(result.state, "completed");
      assert.equal(result.attempts.length, 3);
      const prompts = trace.filter((entry) => entry.kind === "prompt");
      assert.ok(prompts[1]!.command!.message!.includes(RESTART_AFTER_WORK_NOTE));
      assert.equal(prompts[2]!.command!.message, LIVE_CONTINUATION_PROMPT);
      assert.deepEqual(trace.filter((entry) => entry.kind === "start").map((entry) => entry.context), [false, false, true]);
    });
  });
}

test("repeated proven-unavailable history rebuilds one note and counts each fresh replay once", async () => {
  await check({ history: ["header-only", "header-only"], behaviors: ["provider", "provider", "complete"], switchFaultRoutes: [0, 1], restartAttempts: [0, 1] }, (result, trace) => {
    assert.equal(result.state, "completed");
    assert.equal(result.attempts.length, 3);
    const prompts = trace.filter((entry) => entry.kind === "prompt");
    assert.equal(prompts[1]!.command!.message, prompts[2]!.command!.message);
    assert.equal(prompts[2]!.command!.message!.split(RESTART_AFTER_WORK_NOTE).length, 2);
  });
});

for (const reuse of ["live", "fresh"] as const) {
  test(`a rejected replay retains the selected restart assignment through ${reuse} fallback`, async () => {
    await check({ history: ["header-only"], behaviors: ["provider", "reject", "complete"],
      switchFaultRoutes: reuse === "live" ? [0] : [0, 1], restartAttempts: [0] }, (result, trace, status) => {
      assert.equal(result.state, "completed");
      assert.deepEqual(result.attempts.map((entry) => entry.state), ["provider_failed", "prompt_rejected", "completed"]);
      assert.deepEqual(result.attempts.map((entry) => entry.route), routes.map((route, i) => `${route}:${levels[i]}`));
      assert.deepEqual(result.attempts.map((entry) => entry.restartAfterWork ?? false), [true, false, false]);
      assert.equal(result.progress.restartAfterWorkCount, 1);
      assert.deepEqual(status.map((entry) => entry.sessionSeen), [true, false, true]);
      const starts = trace.filter((entry) => entry.kind === "start");
      assert.deepEqual(starts.map((entry) => entry.route), reuse === "live" ? routes.slice(0, 2) : routes);
      assert.equal(new Set(starts.map((entry) => entry.pid)).size, reuse === "live" ? 2 : 3);
      const prompts = trace.filter((entry) => entry.kind === "prompt");
      const original = prompts[0]!.command!.message!;
      const restart = original.replace("\n\n## Attempt limits", `\n\n${RESTART_AFTER_WORK_NOTE}\n\n## Attempt limits`);
      assert.deepEqual(prompts.map((entry) => entry.command!.message), [original, restart, restart]);
      assert.equal(restart.split(RESTART_AFTER_WORK_NOTE).length, 2);
      assert.deepEqual(prompts.map((entry) => entry.command!.id), ["prompt-1", "prompt-1", reuse === "live" ? "route-2:prompt-1" : "prompt-1"]);
      assert.equal(prompts[1]!.pid === prompts[2]!.pid, reuse === "live");
      const controls = trace.filter((entry) => entry.kind === "control");
      assert.deepEqual(controls.map((entry) => entry.command!.type), reuse === "live"
        ? ["get_state", "get_state", "set_model", "set_thinking_level", "get_state"] : ["get_state", "get_state"]);
      assert.equal(starts[1]!.context, false, "route A acknowledged without durable assignment");
    });
  });
}

test("restart attribution skips a later rejected live attempt", async () => {
  await check({ history: ["header-only"], behaviors: ["provider", "reject", "complete"], switchFaultRoutes: [1], restartAttempts: [0] }, (result, trace) => {
    assert.equal(result.state, "completed");
    assert.deepEqual(result.attempts.map((entry) => entry.state), ["provider_failed", "prompt_rejected", "completed"]);
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 2);
    const prompts = trace.filter((entry) => entry.kind === "prompt");
    assert.equal(prompts[1]!.command!.message, LIVE_CONTINUATION_PROMPT);
    assert.ok(prompts[2]!.command!.message!.includes(RESTART_AFTER_WORK_NOTE));
  });
});

test("restart attribution skips unavailable catalogs without consuming another route", async () => {
  await check({ history: ["header-only"], behaviors: ["invalid-stream"], catalog: [routes[0]!, routes[2]!], restartAttempts: [0] }, (result, trace) => {
    assert.deepEqual(result.attempts.map((entry) => entry.state), ["invalid_stream", "catalog_unavailable", "completed"]);
    assert.deepEqual(trace.filter((entry) => entry.kind === "start").map((entry) => entry.route), [routes[0], routes[2]]);
    assert.ok(trace.filter((entry) => entry.kind === "prompt")[1]!.command!.message!.includes(RESTART_AFTER_WORK_NOTE));
  });
});

test("retained live switching uses accepted memory without inspecting unsafe disk history", async () => {
  await check({ history: ["malformed-header"], switchFaultRoutes: [] }, (result, trace) => {
    assert.equal(result.state, "completed");
    assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    assert.equal(trace.filter((entry) => entry.kind === "prompt")[1]!.command!.message, LIVE_CONTINUATION_PROMPT);
  });
});

test("valid active assignment with a malformed tail still continues", async () => {
  await check({ history: ["malformed-tail"] }, (result, trace) => {
    assert.equal(result.state, "completed");
    assert.equal(result.attempts.length, 2);
    assert.equal(trace.filter((entry) => entry.kind === "prompt")[1]!.command!.message, LIVE_CONTINUATION_PROMPT);
  });
});

for (const history of ["malformed-header", "identity-change", "unsafe-tree", "over-bytes", "over-line", "over-records"]) {
  test(`${history} fails closed before replacement spawn without exposing private history`, async () => {
    const identityChange = history === "identity-change";
    const f = await fixture({ behaviors: ["provider", "provider", "complete"], switchFaultRoutes: [0, 1],
      history: identityChange ? ["valid", history] : [history] });
    const progress: DelegateProgress[] = [];
    await assert.rejects(runDelegate({ ...f.options, onProgress: (entry) => progress.push(entry) }), { message: "Delegated session history validation failed" });
    const trace = await f.trace();
    const starts = trace.filter((entry) => entry.kind === "start");
    assert.equal(starts.length, identityChange ? 2 : 1);
    assert.equal(trace.filter((entry) => entry.kind === "prompt").length, starts.length);
    assert.ok(starts.every((entry) => entry.priorGone && gone(entry.pid) && gone(entry.descendant!)));
    for (const value of [sentinel, sessionId, "CHANGED-PRIVATE-ID", "MISSING-PRIVATE-ID", starts[0]!.file!]) assert.ok(!JSON.stringify(progress).includes(value));
    assert.ok(!(await readdir(root)).some((name) => name.startsWith("delegated-pi-")));
  });
}

test("failure diagnostics never read persisted history", async () => {
  await check({ behaviors: ["provider", "blocked"] }, (result) => {
    assert.equal(result.state, "blocked");
    assert.equal(result.attempts.length, 2);
  });
});

for (const fault of ["symlink", "directory", "mode", "missing"]) {
  test(`unsafe ${fault} replacement fails closed before spawn and removes children and artifacts`, async () => {
    const f = await fixture({ tamper: fault });
    let executions = 0;
    await assert.rejects(runDelegate({ ...f.options, resourceSelection: {
      ...f.options.resourceSelection!, verifyRuntimeSpawn() { executions += 1; },
    } }), { message: "Delegated session validation failed" });
    const starts = (await f.trace()).filter((entry) => entry.kind === "start");
    assert.equal(executions, 3, "two checks before the first spawn, then resource verification before unsafe session validation");
    assert.equal(starts.length, 1);
    assert.ok(gone(starts[0]!.pid) && gone(starts[0]!.descendant!));
    assert.ok(!(await readdir(root)).some((name) => name.startsWith("delegated-pi-")));
    assert.equal(await readFile(path.join(f.cwd, "outside"), "utf8"), "unchanged fixture");
  });
}

for (const fault of ["symlink", "directory", "mode"]) {
  test(`unsafe ${fault} before first execution is rejected after resource verification`, async () => {
    const f = await fixture();
    await assert.rejects(runDelegate({ ...f.options, resourceSelection: {
      ...f.options.resourceSelection!, verifyRuntimeSpawn() {
        const directory = readdirSync(root).find((name) => name.startsWith("delegated-pi-"))!;
        const file = path.join(root, directory, "session.jsonl");
        if (fault === "mode") chmodSync(file, 0o644);
        else {
          rmSync(file);
          if (fault === "directory") mkdirSync(file, { mode: 0o600 });
          else symlinkSync(path.join(f.cwd, "outside"), file);
        }
      },
    } }), { message: "Delegated session validation failed" });
    assert.equal((await f.trace()).filter((entry) => entry.kind === "start").length, 0);
    assert.ok(!(await readdir(root)).some((name) => name.startsWith("delegated-pi-")));
  });
}

for (const failure of ["callback", "cancel", "spawn-throw", "resource-throw"] as const) {
  test(`${failure} at replacement cleans up the run-owned session and process groups`, async () => {
    const f = await fixture({ behaviors: ["provider", "stalled"] });
    const controller = new AbortController();
    const error = new Error("fixture caller error");
    let executions = 0;
    const running = runDelegate({ ...f.options, signal: controller.signal,
      resourceSelection: { ...f.options.resourceSelection!, verifyRuntimeSpawn() {
        if (++executions !== 3) return; // Early verification for the replacement, after two checks for the first spawn.
        if (failure === "resource-throw") throw error;
        if (failure === "spawn-throw") Object.defineProperty(f.options.piInvocation!, "command", { get() { throw error; } });
      } },
      onProgress(progress) {
        if (progress.attempt !== 2 || progress.state !== "running") return;
        if (failure === "callback") throw error;
        if (failure === "cancel") controller.abort("PRIVATE-CANCEL");
      },
    });
    if (failure === "cancel") {
      const result = await running;
      assert.equal(result.state, "interrupted");
      assert.equal(result.progress.restartAfterWorkCount, 0);
      await finalizeDelegateRun(result);
    } else if (failure === "spawn-throw") await assert.rejects(running, { message: "Delegated child spawn failed" });
    else await assert.rejects(running, (caught) => caught === error);
    const starts = (await f.trace()).filter((entry) => entry.kind === "start");
    assert.ok(starts.length >= 1 && starts.every((entry) => gone(entry.pid) && gone(entry.descendant!)));
    assert.ok(!(await readdir(root)).some((name) => name.startsWith("delegated-pi-")));
  });
}

test("finalization exceptions still remove the private session after persisted replacement", async () => {
  const f = await fixture();
  const result = await runDelegate(f.options);
  const error = new Error("fixture assembly failure");
  await assert.rejects(finalizeDelegateRun({ ...result, get report(): string { throw error; } }), (caught) => caught === error);
  await assert.rejects(lstat(result.artifactDir), { code: "ENOENT" });
  const starts = (await f.trace()).filter((entry) => entry.kind === "start");
  assert.equal(starts.length, 2);
  assert.ok(starts.every((entry) => gone(entry.pid) && gone(entry.descendant!)));
});

test("negative cleanup proof prohibits persisted replacement", async () => {
  const original = terminationProbes.build;
  terminationProbes.build = (child) => {
    const probes = original(child);
    if (child.spawnargs.includes("--list-models")) return probes;
    let now = performance.now();
    return { ...probes, now: () => now, groupExists: () => true,
      delay: async (ms) => { now += ms; await new Promise<void>((resolve) => setTimeout(resolve, 10)); } };
  };
  try {
    await check({ history: ["malformed-header"] }, (result, trace) => {
      assert.equal(result.state, "cleanup_failed");
      assert.equal(result.cleanupFailureReason, "group_alive");
      assert.equal(trace.filter((entry) => entry.kind === "start").length, 1);
    });
  } finally { terminationProbes.build = original; }
});
