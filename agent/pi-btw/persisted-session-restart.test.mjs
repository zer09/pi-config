import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";

function snapshot(path) {
  const stat = lstatSync(path, { bigint: true });
  const result = { mtimeNs: stat.mtimeNs, mode: stat.mode };
  if (stat.isDirectory()) {
    result.children = readdirSync(path).sort().map((name) => [name, snapshot(join(path, name))]);
  } else if (stat.isSymbolicLink()) {
    result.target = readlinkSync(path);
  } else {
    result.hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  return result;
}

function sessionFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sessionFiles(child);
    return entry.name.endsWith(".jsonl") ? [child] : [];
  }).sort();
}

function readRecords(path) {
  assert.ok(existsSync(path), "private fixture record file exists");
  assert.equal(statSync(path).mode & 0o777, 0o600, "fixture records are private");
  const text = readFileSync(path, "utf8");
  assert.ok(text.endsWith("\n"), "record file ends at a complete JSONL boundary");
  try {
    return text.trimEnd().split("\n").map((line) => JSON.parse(line));
  } catch {
    assert.fail("private fixture records are not valid JSON");
  }
}

function ordinaryMessages(messages) {
  return messages.filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      text: typeof message.content === "string" ? message.content :
        message.content.filter((part) => part.type === "text").map((part) => part.text).join(""),
    }));
}

// This uses two real CLI processes, not a SessionManager.open() simulation or an in-process switch.
test("restores a persisted hidden BTW thread after an offline Pi process restart", { timeout: 60_000 }, async () => {
  const installedPackage =
    process.env.PI_BTW_PACKAGE_ROOT ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-btw");
  const piBin = process.env.PI_BIN ?? join(homedir(), ".bun", "bin", "pi");
  assert.ok(existsSync(installedPackage), "live pi-btw package is available");
  assert.ok(existsSync(piBin), "published Pi CLI is available");
  assert.equal(JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8")).version, "0.6.1");
  const installedTarget = join(installedPackage, "extensions", "btw.ts");
  const liveSource = readFileSync(installedTarget);
  const patchMarker = "setRuntimeApiKey(model.provider, auth.apiKey, { signal: ctx.signal })";
  assert.equal(liveSource.toString().split(patchMarker).length - 1, 1, "live 0.6.1 has the cancellation-aware auth patch");
  const piCli = realpathSync(piBin);
  const piPackageRoot = dirname(dirname(dirname(piCli)));
  const piManifest = join(piPackageRoot, "package.json");
  const piPackage = JSON.parse(readFileSync(piManifest, "utf8"));
  assert.equal(piPackage.name, "@earendil-works/pi-coding-agent");
  assert.equal(piPackage.version, "0.87.1", "use only the installed published Pi 0.87.1 CLI");
  assert.equal(piCli, join(piPackageRoot, piPackage.bin.pi));
  const protectedPaths = [installedPackage, piManifest, piCli];
  const beforeLive = protectedPaths.map(snapshot);

  const turns = [
    { question: "persisted BTW first question", answer: "persisted BTW first answer" },
    { question: "persisted BTW follow-up", answer: "restored BTW saw the first exchange exactly once" },
  ];
  const parentMessages = [
    { role: "user", text: "persisted parent kept" },
    { role: "user", text: "persisted parent replacement" },
    { role: "assistant", text: "persisted parent answer" },
  ];
  const expectedRequests = [
    [...parentMessages, { role: "user", text: turns[0].question }],
    [
      ...parentMessages,
      { role: "user", text: "[The following is a separate side conversation. Continue this thread.]" },
      { role: "assistant", text: "Understood, continuing our side conversation." },
      { role: "user", text: turns[0].question },
      { role: "assistant", text: turns[0].answer },
      { role: "user", text: turns[1].question },
    ],
  ];
  const root = mkdtempSync(join(tmpdir(), "pi-btw-persisted-restart-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  const sessionDir = join(root, "sessions");
  const packageRoot = join(root, "pi-btw");
  const proofPath = join(root, "proof.ndjson");
  const deniedPath = join(root, "external-operation-attempted");
  const guardPath = join(root, "offline-guard.mjs");
  const providerPath = join(root, "offline-restart.ts");
  try {
    assert.equal(statSync(root).mode & 0o777, 0o700);
    for (const path of [agentDir, cwd, sessionDir, join(root, "home")]) mkdirSync(path, { mode: 0o700 });
    // Copy the live patched package unchanged. Never run the reapply helper against either installation.
    cpSync(installedPackage, packageRoot, { recursive: true, dereference: true });
    const copiedTarget = join(packageRoot, "extensions", "btw.ts");
    assert.ok(readFileSync(copiedTarget).equals(liveSource), "the fixture runs the exact live target bytes");
    const beforeCopy = snapshot(packageRoot);
    writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({
      lastChangelogVersion: "0.87.1",
      defaultThinkingLevel: "off",
      cacheWarming: "off",
      compaction: { enabled: false },
      retry: { enabled: false },
      defaultProjectTrust: "never",
    })}\n`, { mode: 0o600 });
    writeFileSync(guardPath, `import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import childProcess from "node:child_process";
process.umask(0o077);
function blocked() {
  writeFileSync(${JSON.stringify(deniedPath)}, "blocked", { mode: 0o600 });
  throw new Error("External work disabled in offline BTW restart fixture");
}
http.request = http.get = https.request = https.get = http2.connect = blocked;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = blocked;
dgram.createSocket = globalThis.fetch = blocked;
for (const object of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (const name of Object.getOwnPropertyNames(object)) {
    if (/^(?:resolve|lookup|reverse)/.test(name)) object[name] = blocked;
  }
}
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[name] = blocked;
}
childProcess.ChildProcess.prototype.spawn = blocked;
syncBuiltinESMExports();
const dnsExports = await import("node:dns");
const dnsPromisesExports = await import("node:dns/promises");
if (dnsExports.promises !== dns.promises || dnsExports.Resolver !== dns.Resolver ||
    dnsPromisesExports.Resolver !== dns.promises.Resolver) {
  throw new Error("Offline DNS guard ESM namespace identity check failed");
}
for (const [label, object, exported] of [
  ["dns", dns, dnsExports],
  ["dns.promises", dns.promises, dnsPromisesExports],
  ["dns.Resolver.prototype", dns.Resolver.prototype, dnsExports.Resolver.prototype],
  ["dns.promises.Resolver.prototype", dns.promises.Resolver.prototype, dnsPromisesExports.Resolver.prototype],
]) {
  for (const name of Object.getOwnPropertyNames(object)) {
    if (/^(?:resolve|lookup|reverse)/.test(name) &&
        (object[name] !== blocked || exported[name] !== object[name])) {
      throw new Error("Offline DNS guard export identity check failed: " + label + "." + name);
    }
  }
}
`, { mode: 0o600 });
    writeFileSync(providerPath, `import { appendFileSync } from "node:fs";
import { contentText, getCurrentSystemPrompt, getCurrentTools, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
const phase = process.env.BTW_RESTART_PHASE;
const index = phase === "create" ? 0 : 1;
const turns = ${JSON.stringify(turns)};
const expectedRequests = ${JSON.stringify(expectedRequests)};
const model = {
  id: "offline-restart-model", name: "Offline Restart Model",
  api: "offline-native-api", provider: "offline-native", baseUrl: "http://127.0.0.1:1",
  reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000, maxTokens: 1000,
} as const;
let callCount = 0;
function record(data: any) {
  appendFileSync(${JSON.stringify(proofPath)}, JSON.stringify({ phase, pid: process.pid, ...data }) + "\\n", { mode: 0o600 });
}
function makeAssistant(text: string) {
  return {
    role: "assistant", content: [{ type: "text", text }],
    api: model.api, provider: model.provider, model: model.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: 5,
  } as const;
}
function stream(selectedModel: typeof model, context: any, options: any) {
  callCount++;
  const messages = context.messages;
  const ordinary = messages.filter((message: any) => message.role === "user" || message.role === "assistant")
    .map((message: any) => ({ role: message.role, text: contentText(message.content) }));
  const runtimeKeyMatched = options?.apiKey === "offline-restart-test-key-" + phase;
  const modelMatched = selectedModel.provider === model.provider && selectedModel.id === model.id &&
    selectedModel.api === model.api && selectedModel.baseUrl === model.baseUrl;
  const normalized = !Object.hasOwn(context, "systemPrompt") && !Object.hasOwn(context, "tools");
  const historyMatched = JSON.stringify(ordinary) === JSON.stringify(expectedRequests[index]);
  record({ kind: "request", callCount, messages, runtimeKeyMatched, modelMatched, normalized, historyMatched,
    systemPrompt: getCurrentSystemPrompt(messages), tools: getCurrentTools(messages).map((tool: any) => tool.name).sort() });
  if (callCount !== 1 || !runtimeKeyMatched || !modelMatched || !normalized || !historyMatched) {
    throw new Error("Offline restart provider contract failed");
  }
  const message = makeAssistant(turns[index].answer);
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [], stopReason: "pending" } };
      yield { type: "done", reason: "stop", message };
    },
    result: async () => message,
  } as any;
}
function state(stage: string, ctx: any, reason?: string) {
  record({ kind: "state", stage, reason, callCount,
    sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(),
    leafId: ctx.sessionManager.getLeafId(), entries: ctx.sessionManager.getEntries(),
    branch: ctx.sessionManager.getBranch(), messages: ctx.sessionManager.buildSessionContext().messages,
    authSource: ctx.modelRegistry.getProviderAuthStatus(model.provider).source,
  });
}
export default function (pi: ExtensionAPI) {
  pi.registerProvider({
    id: model.provider, name: "Offline Native Restart Auth",
    auth: { apiKey: { name: "Synthetic restart key", async resolve({ credential }: any) {
      return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
    } } },
    getModels: () => [model], stream, streamSimple: stream,
  } as any);
  const parentOnlyTools = ["delegate_to_pi", "delegate_to_codex"].map((name) => ({
    name, description: "Parent-only fixture tool", parameters: Type.Object({}),
  }));
  for (const tool of parentOnlyTools) {
    pi.registerTool({ ...tool, label: tool.name, async execute() {
      throw new Error("Fixture tools must not execute");
    } });
  }
  pi.on("tool_call", () => { throw new Error("Fixture tools must not execute"); });
  pi.on("session_start", (event, ctx) => state("session_start", ctx, event.reason));
  pi.on("session_shutdown", (event, ctx) => state("session_shutdown", ctx, event.reason));
  pi.registerCommand("offline-seed", {
    description: "Seed one disposable persisted parent without model work",
    handler: async (_args, ctx) => {
      if (phase !== "create" || ctx.sessionManager.getEntries().some((entry) => entry.type === "message")) {
        throw new Error("Offline seed is allowed only once, before the first BTW turn");
      }
      await ctx.newSession({ setup: async (manager) => {
        manager.appendMessage({ role: "system", content: "persisted parent system", timestamp: 1,
          toolsAdded: [{ name: "read", description: "Seeded read tool", parameters: Type.Object({}) }, ...parentOnlyTools] });
        manager.appendMessage({ role: "user", content: "persisted parent kept", timestamp: 2 });
        const omitted = manager.appendMessage({ role: "user", content: "persisted parent omitted", timestamp: 3 });
        const replaced = manager.appendMessage({ role: "user", content: "persisted parent original", timestamp: 4 });
        manager.appendContextEdit(omitted, null);
        manager.appendContextEdit(replaced, { content: "persisted parent replacement" });
        // Pi flushes a new session only after an assistant entry exists. The unused startup session stays unpersisted.
        manager.appendMessage(makeAssistant("persisted parent answer"));
      } });
    },
  });
  pi.registerCommand("offline-proof", {
    description: "Record canonical parent and hidden entries without printing RPC data",
    handler: async (args, ctx) => state(args.trim(), ctx),
  });
}
`, { mode: 0o600 });

    async function runCli(phase, messages, sessionPath) {
      const args = [
        "--import", guardPath, piCli,
        "--no-extensions", "--extension", copiedTarget, "--extension", providerPath,
        "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
        "--no-approve", "--provider", "offline-native", "--model", "offline-restart-model",
        "--api-key", `offline-restart-test-key-${phase}`, "--mode", "rpc", "--session-dir", sessionDir,
      ];
      if (sessionPath) args.push("--session", sessionPath);
      const child = spawn(process.execPath, args, {
        cwd,
        env: {
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          HOME: join(root, "home"), TMPDIR: root, XDG_CACHE_HOME: join(root, "cache"),
          PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: sessionDir,
          PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", BTW_RESTART_PHASE: phase,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const commands = messages.map((message, index) => ({ id: `${phase}-${index}`, type: "prompt", message }));
      let completed = 0;
      let pending = "";
      let timedOut = false;
      let transportFailed = false;
      let extensionFailed = false;
      let ordinaryRpcMessages = 0;
      let toolEvents = 0;
      let stderrBytes = 0;
      const failTransport = () => { transportFailed = true; child.kill("SIGKILL"); };
      const sendNext = () => child.stdin.write(`${JSON.stringify(commands[completed])}\n`);
      const exit = new Promise((resolve) => {
        const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 25_000);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          pending += chunk;
          if (pending.length > 1_000_000) { failTransport(); return; }
          let newline;
          while ((newline = pending.indexOf("\n")) !== -1) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            let record;
            try { record = JSON.parse(line); } catch { failTransport(); return; }
            if (record.type === "extension_error" || (record.method === "notify" && record.notifyType === "error")) {
              extensionFailed = true;
            }
            if ((record.type === "message_start" || record.type === "message_end") &&
                (record.message?.role === "user" || record.message?.role === "assistant")) ordinaryRpcMessages++;
            if (record.type.startsWith("tool_execution_")) toolEvents++;
            if (record.type !== "response") continue;
            if (record.id !== commands[completed]?.id || record.command !== "prompt" || record.success !== true) {
              failTransport(); return;
            }
            completed++;
            // Extension-command responses follow the awaited BTW work. EOF then requests a clean idle shutdown.
            if (completed === commands.length) child.stdin.end();
            else sendNext();
          }
        });
        // Count diagnostics, but never print or attach raw RPC records, stderr, or credentials to failures.
        child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; });
        child.stdin.on("error", failTransport);
        child.on("error", failTransport);
        child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
      });
      try {
        sendNext();
        const result = await exit;
        assert.equal(timedOut, false, `${phase}: bounded RPC deadline`);
        assert.equal(transportFailed, false, `${phase}: RPC command/transport failure`);
        assert.equal(result.code, 0, `${phase}: clean Pi exit`);
        assert.equal(result.signal, null, `${phase}: shutdown did not require a signal`);
        assert.equal(completed, commands.length, `${phase}: all commands completed sequentially`);
        assert.equal(pending.length, 0, `${phase}: complete RPC framing`);
        assert.equal(extensionFailed, false, `${phase}: no extension errors`);
        assert.equal(stderrBytes, 0, `${phase}: no startup or runtime diagnostics`);
        assert.equal(ordinaryRpcMessages, 0, `${phase}: no ordinary parent RPC message leakage`);
        assert.equal(toolEvents, 0, `${phase}: no parent tool execution`);
        assert.equal(existsSync(deniedPath), false, `${phase}: no network, subprocess, or browser attempt`);
        return child.pid;
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exit;
        }
      }
    }

    const firstPid = await runCli("create", [
      "/offline-seed", "/offline-proof seed", `/btw ${turns[0].question}`, "/offline-proof created",
    ]);
    const firstProof = readRecords(proofPath);
    const seed = firstProof.find((record) => record.stage === "seed");
    const created = firstProof.find((record) => record.stage === "created");
    assert.ok(seed && created, "first process recorded the seeded parent and completed hidden turn");
    const sessionPath = created.sessionFile;
    assert.equal(dirname(sessionPath), sessionDir, "Pi owns the session in the isolated session directory");
    assert.equal(realpathSync(sessionPath), sessionPath, "persisted session is not a link to another location");
    assert.deepEqual(sessionFiles(root), [sessionPath], "first process created exactly one persisted session file");
    const beforeRestart = readFileSync(sessionPath);
    const beforeStat = statSync(sessionPath);
    assert.equal(beforeStat.uid, process.getuid(), "session belongs to the test user");
    assert.equal(beforeStat.gid, process.getgid(), "session belongs to the test group");
    assert.equal(beforeStat.nlink, 1, "session is not a hard link to another file");
    const firstEntries = readRecords(sessionPath);
    assert.ok(isDeepStrictEqual(firstEntries.slice(1), created.entries), "first process persisted its exact entries before exit");
    assert.deepEqual(firstEntries[0], {
      type: "session", version: 3, id: created.sessionId, timestamp: firstEntries[0].timestamp, cwd,
    }, "one standalone current-format session header, with no parent session");
    assert.equal(firstEntries.filter((entry) => entry.type === "session").length, 1);

    // Nothing is copied, seeded, or rewritten between processes. Only --session points the fresh CLI at this file.
    const secondPid = await runCli("resume", [
      "/offline-proof resumed", `/btw ${turns[1].question}`, "/offline-proof continued",
    ], sessionPath);
    assert.notEqual(secondPid, firstPid, "follow-up ran in a fresh OS process");
    assert.deepEqual(sessionFiles(root), [sessionPath], "restart and child sessions created no alternate session file");
    const afterRestart = readFileSync(sessionPath);
    const afterStat = statSync(sessionPath);
    assert.ok(afterRestart.length > beforeRestart.length, "follow-up appended persisted entries");
    assert.ok(afterRestart.subarray(0, beforeRestart.length).equals(beforeRestart), "the pre-restart file is an exact byte prefix");
    for (const field of ["dev", "ino", "uid", "gid", "mode", "nlink"]) {
      assert.equal(afterStat[field], beforeStat[field], `restart preserved session file ${field}`);
    }
    const finalEntries = readRecords(sessionPath);
    const records = readRecords(proofPath);
    const resumed = records.find((record) => record.stage === "resumed");
    const continued = records.find((record) => record.stage === "continued");
    assert.ok(resumed && continued, "fresh process recorded state before and after its follow-up");
    assert.ok(isDeepStrictEqual(resumed.entries, created.entries), "startup restored every persisted entry without appending or duplicating");
    assert.ok(isDeepStrictEqual(resumed.messages, created.messages), "canonical parent context survived relaunch exactly");
    assert.ok(isDeepStrictEqual(finalEntries.slice(1), continued.entries), "follow-up proof matches the exact final persisted file");
    assert.ok(isDeepStrictEqual(finalEntries[0], firstEntries[0]), "restart preserved the original session header");
    assert.deepEqual(finalEntries.slice(firstEntries.length).map((entry) => [entry.type, entry.customType]), [
      ["custom", "btw-thread-entry"], ["custom_message", "btw-note"],
    ], "follow-up appends only one hidden exchange and its RPC-visible note");

    const states = [seed, created, resumed, continued];
    const ordinaryEntries = (entries) => entries.filter((entry) => entry.type === "message" &&
      (entry.message.role === "user" || entry.message.role === "assistant"));
    const hiddenEntries = (entries) => entries.filter((entry) => entry.type === "custom");
    assert.equal(ordinaryEntries(seed.entries).length, 4, "seed has three raw users and one synthetic assistant");
    assert.equal(seed.entries.filter((entry) => entry.type === "context_edit").length, 2);
    assert.deepEqual(ordinaryMessages(seed.messages), parentMessages, "canonical parent applies omission and replacement");
    assert.equal(seed.messages.length, 4, "canonical seed contains one system message and three ordinary messages");
    assert.equal(seed.messages[0].content, "persisted parent system");
    assert.deepEqual(seed.messages[0].toolsAdded.map((tool) => tool.name), ["read", "delegate_to_pi", "delegate_to_codex"]);
    for (const [index, state] of states.entries()) {
      const turnCount = [0, 1, 1, 2][index];
      assert.equal(state.sessionId, created.sessionId, "all proof stages own the same session ID");
      assert.equal(state.sessionFile, sessionPath, "all proof stages own the exact resumed file");
      assert.equal(state.authSource, "runtime", "synthetic auth stays runtime-only on both launches");
      assert.ok(isDeepStrictEqual(ordinaryEntries(state.entries), ordinaryEntries(seed.entries)), "BTW never changes ordinary parent entries");
      assert.deepEqual(ordinaryMessages(state.messages), parentMessages, "canonical parent user/assistant state never gains BTW content");
      assert.ok(isDeepStrictEqual(state.messages.filter((message) => message.role !== "custom"), seed.messages),
        "canonical parent system and context edits remain intact");
      assert.ok(isDeepStrictEqual(state.branch, state.entries), "no abandoned or alternate hidden branch exists");
      assert.equal(state.leafId, state.entries.at(-1).id);
      const hidden = hiddenEntries(state.entries);
      assert.deepEqual(hidden.map((entry) => entry.customType), Array(turnCount).fill("btw-thread-entry"), "no reset, duplicate, or alternate hidden entry");
      assert.deepEqual(hidden.map((entry) => ({ question: entry.data.question, answer: entry.data.answer })), turns.slice(0, turnCount));
      const notes = state.entries.filter((entry) => entry.type === "custom_message");
      assert.deepEqual(notes.map((entry) => entry.customType), Array(turnCount).fill("btw-note"), "RPC notes are intentional, not ordinary parent messages");
      assert.deepEqual(notes.map((entry) => ({ question: entry.details.question, answer: entry.details.answer })), turns.slice(0, turnCount));
      assert.equal(state.messages.filter((message) => message.role === "custom").length, turnCount);
      const ids = new Set();
      for (const [position, entry] of state.entries.entries()) {
        assert.equal(ids.has(entry.id), false, "persisted entry IDs are unique");
        assert.equal(entry.parentId, position === 0 ? null : state.entries[position - 1].id, "persisted entries form one append-only branch");
        ids.add(entry.id);
      }
    }
    assert.ok(isDeepStrictEqual(hiddenEntries(continued.entries)[0], hiddenEntries(created.entries)[0]), "the first hidden exchange retains its exact identity and data");

    const requests = records.filter((record) => record.kind === "request");
    assert.deepEqual(requests.map((request) => [request.phase, request.pid, request.callCount]), [
      ["create", firstPid, 1], ["resume", secondPid, 1],
    ], "only one fake child request per process; no parent, summary, retry, or background inference");
    for (const [index, request] of requests.entries()) {
      assert.equal(request.runtimeKeyMatched, true, "each child received its launch-specific synthetic API key");
      assert.equal(request.modelMatched, true, "only the offline native model was selected");
      assert.equal(request.normalized, true, "system prompt and tools use transcript-based state");
      assert.equal(request.historyMatched, true, "fake provider accepted only the exact expected parent and BTW history");
      assert.deepEqual(ordinaryMessages(request.messages), expectedRequests[index], "restored exchange appears once, in order, before the follow-up");
      assert.ok(isDeepStrictEqual(request.messages.slice(0, seed.messages.length), seed.messages), "each fresh child is seeded from canonical parent context");
      assert.equal(request.messages.filter((message) => message.role === "system" && message.content === "persisted parent system").length, 1);
      assert.ok(request.systemPrompt.includes("persisted parent system"), "parent system survives child prompt deltas");
      assert.deepEqual(request.tools, ["bash", "edit", "read", "write"], "child cannot inherit parent delegation tools");
      assert.ok(request.messages.every((message) => ["system", "user", "assistant"].includes(message.role)), "no note or tool result leaks into child history");
      for (const message of request.messages.filter((message) => message.role === "assistant")) {
        assert.equal(message.provider, "offline-native");
        assert.equal(message.model, "offline-restart-model");
        assert.equal(message.api, "offline-native-api");
      }
    }
    const lifecycle = records.filter((record) => ["session_start", "session_shutdown"].includes(record.stage));
    assert.deepEqual(lifecycle.map((record) => [record.phase, record.stage, record.reason]), [
      ["create", "session_start", "startup"], ["create", "session_shutdown", "new"],
      ["create", "session_start", "new"], ["create", "session_shutdown", "quit"],
      ["resume", "session_start", "startup"], ["resume", "session_shutdown", "quit"],
    ], "real Pi startup/restoration and orderly EOF shutdown events ran in both processes");
    const [initial, replaced, seeded, firstQuit, restarted, secondQuit] = lifecycle;
    assert.equal(initial.sessionId, replaced.sessionId);
    assert.notEqual(initial.sessionId, created.sessionId, "the unused startup session is not the persisted parent");
    assert.equal(existsSync(initial.sessionFile), false, "the replaced empty startup session was never persisted");
    for (const state of [seeded, firstQuit, restarted, secondQuit]) {
      assert.equal(state.sessionId, created.sessionId);
      assert.equal(state.sessionFile, sessionPath);
    }
    assert.ok(isDeepStrictEqual(firstQuit.entries, created.entries), "clean first shutdown did not append or lose entries");
    assert.ok(isDeepStrictEqual(restarted.entries, created.entries), "session_start observes the exact persisted history");
    assert.equal(restarted.callCount, 0, "restoration performs no model work");
    assert.ok(isDeepStrictEqual(secondQuit.entries, continued.entries), "clean final shutdown preserved the completed follow-up");
    assert.equal(afterRestart.includes(Buffer.from("offline-restart-test-key-")), false, "runtime credentials are not persisted in the session");
    const authPath = join(agentDir, "auth.json");
    if (existsSync(authPath)) {
      assert.deepEqual(JSON.parse(readFileSync(authPath, "utf8")), {}, "synthetic runtime auth was not saved to auth.json");
    }
    assert.ok(isDeepStrictEqual(snapshot(packageRoot), beforeCopy), "copied live package bytes and mtimes remain unchanged");
  } finally {
    rmSync(root, { recursive: true, force: true });
    assert.ok(isDeepStrictEqual(protectedPaths.map(snapshot), beforeLive), "live package, target, and Pi CLI bytes/mtimes remain unchanged");
  }
});
