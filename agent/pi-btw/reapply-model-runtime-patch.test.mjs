import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const helperPath = join(here, "reapply-model-runtime-patch.mjs");
const cancellableAuthMarker = "setRuntimeApiKey(model.provider, auth.apiKey, { signal: ctx.signal })";

function runHelper(packageRoot) {
  return execFileSync(process.execPath, [helperPath, packageRoot], { encoding: "utf8" });
}

function assertCurrentPatch(source) {
  assert.match(source, /getRegisteredNativeProvider\(model\.provider\)/);
  assert.match(source, /registerNativeProvider\(nativeProvider\)/);
  assert.match(source, /getRegisteredProviderConfig\(model\.provider\)/);
  assert.match(source, /ModelRuntime\.create\(\{ allowModelNetwork: false \}\)/);
  assert.match(source, /modelRuntime\.refresh\(\{ allowNetwork: false \}\)/);
  assert.ok(source.includes(cancellableAuthMarker));
  assert.match(source, /sessionManager\.appendMessage\(message\)/);
  assert.equal((source.match(/\.\.\.modelRuntimeOptions,/g) ?? []).length, 2);
  assert.doesNotMatch(source, /modelRegistry: ctx\.modelRegistry/);
}

test("ports the remaining runtime-auth patch to pi-btw 0.6.1 and is idempotent", () => {
  const installedPackage =
    process.env.PI_BTW_PACKAGE_ROOT ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-btw");
  assert.ok(existsSync(installedPackage), `pi-btw package missing at ${installedPackage}`);
  const packageJson = JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8"));
  assert.equal(packageJson.version, "0.6.1");

  const root = mkdtempSync(join(tmpdir(), "pi-btw-patch-test-"));
  const packageRoot = join(root, "pi-btw");
  try {
    cpSync(installedPackage, packageRoot, { recursive: true });
    const extensionPath = join(packageRoot, "extensions", "btw.ts");
    const source = readFileSync(extensionPath, "utf8");
    const stockCall = "await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey);";
    const patchedCall = `await modelRuntime.${cancellableAuthMarker};`;
    const stockCalls = source.split(stockCall).length - 1;
    const patchedCalls = source.split(patchedCall).length - 1;
    assert.equal(stockCalls + patchedCalls, 1, "expected exactly one stock or patched runtime-auth call");
    // Reconstruct stock 0.6.1 only in the copy so the first run must apply the patch.
    writeFileSync(extensionPath, source.replace(patchedCall, stockCall));
    const stock = readFileSync(extensionPath, "utf8");
    assert.equal(stock.split(stockCall).length - 1, 1, "fixture has exactly one stock runtime-auth call");
    assert.equal(stock.includes(cancellableAuthMarker), false, "fixture starts unpatched");

    const firstOutput = runHelper(packageRoot);
    const first = readFileSync(extensionPath, "utf8");
    assert.match(firstOutput, /^patched: runtime-only auth propagation is cancellation-aware$/m);
    assertCurrentPatch(first);
    assert.equal(first, stock.replace(stockCall, patchedCall), "only the runtime-auth call changes");

    const output = runHelper(packageRoot);
    const second = readFileSync(extensionPath, "utf8");
    assert.match(output, /^already patched: runtime-only auth propagation is cancellation-aware$/m);
    assert.equal(second, first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("passes native runtime auth and canonical parent context through two offline BTW turns", { timeout: 30_000 }, async () => {
  const installedPackage =
    process.env.PI_BTW_PACKAGE_ROOT ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-btw");
  const piBin = process.env.PI_BIN ?? join(homedir(), ".bun", "bin", "pi");
  assert.ok(existsSync(installedPackage), `pi-btw package missing at ${installedPackage}`);
  assert.ok(existsSync(piBin), `Pi binary missing at ${piBin}`);

  const piCli = realpathSync(piBin);
  const piPackageRoot = dirname(dirname(dirname(piCli)));
  const piPackage = JSON.parse(readFileSync(join(piPackageRoot, "package.json"), "utf8"));
  assert.equal(piPackage.name, "@earendil-works/pi-coding-agent");
  assert.equal(piPackage.version, "0.87.1", "fixture requires the published Pi 0.87.1 CLI");
  assert.equal(piCli, join(piPackageRoot, piPackage.bin.pi));

  const root = mkdtempSync(join(tmpdir(), "pi-btw-runtime-auth-"));
  const agentDir = join(root, "agent");
  const packageRoot = join(agentDir, "npm", "node_modules", "pi-btw");
  const proofPath = join(root, "child-transcripts.jsonl");
  const parentPath = join(root, "parent-context.json");
  const turnsPath = join(root, "completed-turns.json");
  const networkPath = join(root, "network-attempted");
  const guardPath = join(root, "offline-guard.mjs");
  try {
    assert.equal(statSync(root).mode & 0o777, 0o700);
    mkdirSync(join(root, "home"));
    mkdirSync(dirname(packageRoot), { recursive: true });
    cpSync(installedPackage, packageRoot, { recursive: true });
    runHelper(packageRoot);
    assertCurrentPatch(readFileSync(join(packageRoot, "extensions", "btw.ts"), "utf8"));

    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      `${JSON.stringify({
        lastChangelogVersion: "0.87.1",
        packages: ["npm:pi-btw@0.6.1"],
        defaultThinkingLevel: "off",
        cacheWarming: "off",
        compaction: { enabled: false },
        retry: { enabled: false },
        defaultProjectTrust: "never",
      }, null, 2)}\n`,
    );
    writeFileSync(guardPath, `import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
function blocked() {
  writeFileSync(${JSON.stringify(networkPath)}, "blocked", { mode: 0o600 });
  throw new Error("Network disabled in offline BTW fixture");
}
http.request = http.get = https.request = https.get = blocked;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = blocked;
globalThis.fetch = blocked;
syncBuiltinESMExports();
`);
    writeFileSync(join(agentDir, "extensions", "offline-native.ts"), `import { appendFileSync, writeFileSync } from "node:fs";
import { contentText, getCurrentSystemPrompt, getCurrentTools, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
const model = {
  id: "offline-model",
  name: "Offline Model",
  api: "offline-native-api",
  provider: "offline-native",
  baseUrl: "http://127.0.0.1:1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 1000,
} as const;
const firstQuestion = "runtime auth smoke";
const secondQuestion = "runtime auth follow-up";
const firstAnswer = "offline native response";
const secondAnswer = "offline native follow-up saw the first turn once";
function stream(selectedModel: typeof model, context: any, options: any) {
  const messages = context.messages;
  const count = (role: string, text: string) => messages.filter(
    (message: any) => message.role === role && contentText(message.content) === text,
  ).length;
  const lastQuestion = contentText(messages.at(-1)?.content ?? "");
  const firstTurn = lastQuestion === firstQuestion && count("user", firstQuestion) === 1 && count("assistant", firstAnswer) === 0;
  const secondTurn = lastQuestion === secondQuestion && count("user", firstQuestion) === 1 &&
    count("assistant", firstAnswer) === 1 && count("user", secondQuestion) === 1;
  const runtimeKeyMatched = options?.apiKey === "offline-native-test-key";
  const modelMatched = selectedModel.provider === model.provider && selectedModel.id === model.id &&
    selectedModel.api === model.api && selectedModel.baseUrl === model.baseUrl;
  const normalized = !Object.hasOwn(context, "systemPrompt") && !Object.hasOwn(context, "tools");
  appendFileSync(${JSON.stringify(proofPath)}, JSON.stringify({
    messages, runtimeKeyMatched, modelMatched, normalized,
    systemPrompt: getCurrentSystemPrompt(messages),
    tools: getCurrentTools(messages).map((tool: any) => tool.name).sort(),
  }) + "\\n", { mode: 0o600 });
  if (!runtimeKeyMatched || !modelMatched || !normalized || (!firstTurn && !secondTurn)) {
    throw new Error("Offline BTW request contract failed");
  }
  const message = {
    role: "assistant",
    content: [{ type: "text", text: firstTurn ? firstAnswer : secondAnswer }],
    api: selectedModel.api,
    provider: selectedModel.provider,
    model: selectedModel.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [], stopReason: "pending" } };
      yield { type: "done", reason: "stop", message };
    },
    result: async () => message,
  } as any;
}
export default function (pi: ExtensionAPI) {
  pi.registerProvider({
    id: "offline-native",
    name: "Offline Native Auth",
    auth: {
      apiKey: {
        name: "Offline native API key",
        async resolve({ credential }: any) {
          return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
        },
      },
    },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  } as any);
  const parentOnlyTools = ["delegate_to_pi", "delegate_to_codex"].map((name) => ({
    name, description: "Parent-only fixture tool", parameters: Type.Object({}),
  }));
  for (const tool of parentOnlyTools) {
    pi.registerTool({ ...tool, label: tool.name, async execute() {
      throw new Error("Parent-only fixture tool must not execute");
    } });
  }
  pi.registerCommand("offline-seed", {
    description: "Seed synthetic parent history without a model request",
    handler: async (_args, ctx) => {
      await ctx.newSession({ setup: async (manager) => {
        manager.appendMessage({
          role: "system", content: "offline parent system", timestamp: 1,
          toolsAdded: [{ name: "read", description: "Seeded read tool", parameters: Type.Object({}) }, ...parentOnlyTools],
        });
        manager.appendMessage({ role: "user", content: "offline parent kept", timestamp: 2 });
        const omitted = manager.appendMessage({ role: "user", content: "offline parent omitted", timestamp: 3 });
        const replaced = manager.appendMessage({ role: "user", content: "offline parent original", timestamp: 4 });
        manager.appendContextEdit(omitted, null);
        manager.appendContextEdit(replaced, { content: "offline parent replacement" });
        writeFileSync(${JSON.stringify(parentPath)}, JSON.stringify({
          entries: manager.getEntries(), messages: manager.buildSessionContext().messages,
        }), { mode: 0o600 });
      } });
    },
  });
  pi.registerCommand("offline-proof", {
    description: "Record completed BTW turns and parent messages without emitting session data",
    handler: async (_args, ctx) => {
      const entries = ctx.sessionManager.getEntries();
      const turns = entries.filter(
        (entry) => entry.type === "custom" && entry.customType === "btw-thread-entry",
      ).map((entry: any) => ({ question: entry.data.question, answer: entry.data.answer }));
      const parentEntries = entries.filter(
        (entry) => entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant"),
      );
      writeFileSync(${JSON.stringify(turnsPath)}, JSON.stringify({ turns, parentEntries }), { mode: 0o600 });
    },
  });
}
`);

    const child = spawn(
      process.execPath,
      [
        "--import",
        guardPath,
        piCli,
        "--provider",
        "offline-native",
        "--model",
        "offline-model",
        "--api-key",
        "offline-native-test-key",
        "--mode",
        "rpc",
        "--no-session",
      ],
      {
        cwd: root,
        env: {
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          HOME: join(root, "home"),
          TMPDIR: root,
          XDG_CACHE_HOME: join(root, "cache"),
          PI_CODING_AGENT_DIR: agentDir,
          PI_OFFLINE: "1",
          PI_SKIP_VERSION_CHECK: "1",
          PI_TELEMETRY: "0",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const commands = [
      { id: "seed", type: "prompt", message: "/offline-seed" },
      { id: "btw-1", type: "prompt", message: "/btw runtime auth smoke" },
      { id: "btw-2", type: "prompt", message: "/btw runtime auth follow-up" },
      { id: "proof", type: "prompt", message: "/offline-proof" },
    ];
    let completed = 0;
    let pending = "";
    let timedOut = false;
    let transportFailed = false;
    let extensionFailed = false;
    const failTransport = () => {
      transportFailed = true;
      child.kill("SIGKILL");
    };
    const sendNext = () => child.stdin.write(`${JSON.stringify(commands[completed])}\n`);
    const exit = new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 20_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        pending += chunk;
        let newline;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          let record;
          try { record = JSON.parse(line); } catch { failTransport(); return; }
          if (record.type === "extension_error" || (record.method === "notify" && record.notifyType === "error")) {
            extensionFailed = true;
          }
          if (record.type !== "response") continue;
          if (record.id !== commands[completed]?.id || record.command !== "prompt" || record.success !== true) {
            failTransport();
            return;
          }
          completed++;
          // Extension command responses follow the awaited BTW turn, not just model acceptance.
          if (completed === commands.length) child.stdin.end();
          else sendNext();
        }
      });
      // Never attach raw RPC records or stderr to assertion failures.
      child.stderr.resume();
      child.stdin.on("error", failTransport);
      child.on("error", failTransport);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    sendNext();

    const code = await exit;
    assert.equal(timedOut, false, "offline RPC deadline");
    assert.equal(transportFailed, false, "offline RPC command/transport failure");
    assert.equal(code, 0, "offline Pi CLI exit code");
    assert.equal(completed, commands.length, "all fixture commands completed sequentially");
    assert.equal(existsSync(networkPath), false, "fixture attempted network access");
    assert.equal(extensionFailed, false, "fixture reported an extension error");
    for (const [label, path] of [["parent", parentPath], ["turns", turnsPath], ["transcripts", proofPath]]) {
      assert.ok(existsSync(path), `private ${label} proof missing`);
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
    let requests;
    let parent;
    let turns;
    let finalParentEntries;
    try {
      requests = readFileSync(proofPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      parent = JSON.parse(readFileSync(parentPath, "utf8"));
      ({ turns, parentEntries: finalParentEntries } = JSON.parse(readFileSync(turnsPath, "utf8")));
    } catch {
      assert.fail("private fixture proof is not valid JSON");
    }
    const text = (message) => typeof message.content === "string" ? message.content :
      message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
    const count = (messages, role, value) => messages.filter((message) => message.role === role && text(message) === value).length;
    assert.equal(requests.length, 2, "only the two BTW requests reached the fake provider");
    const [first, second] = requests;
    const rawParent = parent.entries.filter((entry) => entry.type === "message").map((entry) => entry.message);
    // RPC btw-note messages and hidden BTW entries are intentional, but ordinary parent messages must not change.
    const originalParentEntries = parent.entries.filter(
      (entry) => entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant"),
    );
    assert.ok(isDeepStrictEqual(finalParentEntries, originalParentEntries), "BTW turns preserve ordinary parent user/assistant entries exactly");
    assert.equal(count(rawParent, "user", "offline parent omitted"), 1, "omitted source remains in raw parent history");
    assert.equal(count(rawParent, "user", "offline parent original"), 1, "replaced source remains in raw parent history");
    assert.equal(parent.entries.filter((entry) => entry.type === "context_edit").length, 2);
    assert.equal(parent.messages.length, 3, "canonical parent consists of system, retained user and replacement");
    assert.equal(parent.messages[0].role, "system");
    assert.ok(isDeepStrictEqual(parent.messages[0].toolsAdded.map((tool) => tool.name), ["read", "delegate_to_pi", "delegate_to_codex"]));
    assert.ok(isDeepStrictEqual(first.messages.slice(0, parent.messages.length), parent.messages), "initial child seed equals canonical parent context");
    for (const request of requests) {
      assert.equal(request.runtimeKeyMatched, true, "transient parent API key reached the child");
      assert.equal(request.modelMatched, true, "only the offline native model is used");
      assert.equal(request.normalized, true, "provider receives transcript-based system/tool state");
      assert.equal(request.messages[0].role, "system");
      assert.equal(count(request.messages, "system", "offline parent system"), 1, "leading parent system survives once");
      assert.ok(request.systemPrompt.includes("offline parent system"), "parent system survives tool/prompt deltas");
      // Historical declarations survive the seed; replayed tools must exclude parent-only delegates.
      assert.ok(isDeepStrictEqual(request.tools, ["bash", "edit", "read", "write"]), "child has only BTW built-in tools");
      assert.equal(count(request.messages, "user", "offline parent kept"), 1);
      assert.equal(count(request.messages, "user", "offline parent replacement"), 1);
      assert.equal(count(request.messages, "user", "offline parent omitted"), 0);
      assert.equal(count(request.messages, "user", "offline parent original"), 0);
      assert.equal(count(request.messages, "user", "runtime auth smoke"), 1);
    }
    assert.equal(count(first.messages, "assistant", "offline native response"), 0);
    assert.equal(count(first.messages, "user", "runtime auth follow-up"), 0);
    assert.ok(isDeepStrictEqual(second.messages.slice(0, first.messages.length), first.messages), "second turn preserves the first request prefix");
    assert.equal(count(second.messages, "assistant", "offline native response"), 1, "second request sees the first answer once");
    assert.equal(count(second.messages, "user", "runtime auth follow-up"), 1);
    assert.ok(isDeepStrictEqual(turns, [
      { question: "runtime auth smoke", answer: "offline native response" },
      { question: "runtime auth follow-up", answer: "offline native follow-up saw the first turn once" },
    ]), "both fake responses completed and were recorded by BTW");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("summarizes a complete hidden BTW thread and preserves it across a failed retry", { timeout: 30_000 }, async () => {
  const installedPackage =
    process.env.PI_BTW_PACKAGE_ROOT ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-btw");
  const piBin = process.env.PI_BIN ?? join(homedir(), ".bun", "bin", "pi");
  assert.ok(existsSync(installedPackage), `pi-btw package missing at ${installedPackage}`);
  assert.ok(existsSync(piBin), `Pi binary missing at ${piBin}`);

  const piCli = realpathSync(piBin);
  const piPackageRoot = dirname(dirname(dirname(piCli)));
  const piPackage = JSON.parse(readFileSync(join(piPackageRoot, "package.json"), "utf8"));
  assert.equal(piPackage.name, "@earendil-works/pi-coding-agent");
  assert.equal(piPackage.version, "0.87.1", "fixture requires the published Pi 0.87.1 CLI");
  assert.equal(piCli, join(piPackageRoot, piPackage.bin.pi));

  const root = mkdtempSync(join(tmpdir(), "pi-btw-summarize-"));
  const agentDir = join(root, "agent");
  const packageRoot = join(agentDir, "npm", "node_modules", "pi-btw");
  const callsPath = join(root, "provider-calls.jsonl");
  const failurePath = join(root, "failure-state.json");
  const successPath = join(root, "success-state.json");
  const mainDonePath = join(root, "main-provider-done");
  const networkPath = join(root, "network-attempted");
  const guardPath = join(root, "offline-guard.mjs");
  try {
    assert.equal(statSync(root).mode & 0o777, 0o700);
    mkdirSync(join(root, "home"));
    mkdirSync(dirname(packageRoot), { recursive: true });
    cpSync(installedPackage, packageRoot, { recursive: true });
    runHelper(packageRoot);
    assertCurrentPatch(readFileSync(join(packageRoot, "extensions", "btw.ts"), "utf8"));

    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      `${JSON.stringify({
        lastChangelogVersion: "0.87.1",
        packages: ["npm:pi-btw@0.6.1"],
        defaultThinkingLevel: "off",
        cacheWarming: "off",
        compaction: { enabled: false },
        retry: { enabled: false },
        defaultProjectTrust: "never",
      }, null, 2)}\n`,
    );
    writeFileSync(guardPath, `import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
function blocked() {
  writeFileSync(${JSON.stringify(networkPath)}, "blocked", { mode: 0o600 });
  throw new Error("Network disabled in offline BTW summarize fixture");
}
http.request = http.get = https.request = https.get = blocked;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = blocked;
globalThis.fetch = blocked;
syncBuiltinESMExports();
`);
    writeFileSync(join(agentDir, "extensions", "offline-summary.ts"), `import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { contentText, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
const model = {
  id: "offline-summary-model",
  name: "Offline Summary Model",
  api: "offline-native-api",
  provider: "offline-native",
  baseUrl: "http://127.0.0.1:1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 1000,
} as const;
const firstQuestion = "summarize hidden first";
const secondQuestion = "summarize hidden second";
const firstAnswer = "hidden first answer";
const secondAnswer = "hidden second answer";
const expectedThread = "User: " + firstQuestion + "\\nAssistant: " + firstAnswer +
  "\\n\\n---\\n\\nUser: " + secondQuestion + "\\nAssistant: " + secondAnswer;
const summary = "summary includes both hidden BTW exchanges";
const injected = "Here is a summary of a side conversation I had:\\n\\n" + summary;
let summaryAttempts = 0;
function messageText(message: any) {
  return contentText(message?.content ?? "");
}
function makeAssistant(text: string, selectedModel: typeof model) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: selectedModel.api,
    provider: selectedModel.provider,
    model: selectedModel.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
function stream(selectedModel: typeof model, context: any, options: any) {
  const messages = context.messages;
  const lastText = messageText(messages.at(-1));
  const userTexts = messages.filter((message: any) => message.role === "user").map(messageText);
  let kind;
  if (lastText === firstQuestion) {
    kind = "btw-first";
  } else if (lastText === secondQuestion) {
    kind = "btw-second";
  } else if (lastText === expectedThread) {
    summaryAttempts++;
    kind = summaryAttempts === 1 ? "summarize-failure" : "summarize-success";
  } else if (lastText === injected) {
    kind = "main-after-injection";
  } else {
    kind = "unexpected";
  }
  const runtimeKeyMatched = options?.apiKey === "offline-summary-test-key";
  const modelMatched = selectedModel.provider === model.provider && selectedModel.id === model.id &&
    selectedModel.api === model.api && selectedModel.baseUrl === model.baseUrl;
  const normalized = !Object.hasOwn(context, "systemPrompt") && !Object.hasOwn(context, "tools");
  appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({
    kind, userTexts, runtimeKeyMatched, modelMatched, normalized,
    selectedModel: { provider: selectedModel.provider, id: selectedModel.id, api: selectedModel.api },
    systemPrompt: getCurrentSystemPrompt(messages),
    tools: getCurrentTools(messages).map((tool: any) => tool.name).sort(),
  }) + "\\n", { mode: 0o600 });
  if (kind === "unexpected" || !runtimeKeyMatched || !modelMatched || !normalized) {
    throw new Error("Unexpected offline BTW summarize provider request");
  }
  if (kind === "summarize-failure") {
    throw new Error("planned summary failure");
  }
  if (kind === "main-after-injection") {
    writeFileSync(${JSON.stringify(mainDonePath)}, "done", { mode: 0o600 });
  }
  const answer = kind === "btw-first" ? firstAnswer : kind === "btw-second" ? secondAnswer :
    kind === "summarize-success" ? summary : "main accepted summary";
  const message = makeAssistant(answer, selectedModel);
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [], stopReason: "pending" } };
      yield { type: "done", reason: "stop", message };
    },
    result: async () => message,
  } as any;
}
function snapshot(stage: string, ctx: any) {
  const entries = ctx.sessionManager.getEntries();
  const threadEntries = entries.filter((entry: any) => entry.type === "custom" && entry.customType === "btw-thread-entry")
    .map((entry: any) => ({ question: entry.data.question, answer: entry.data.answer }));
  const resetIndexes = entries.flatMap((entry: any, index: number) =>
    entry.type === "custom" && entry.customType === "btw-thread-reset" ? [index] : []);
  const lastReset = resetIndexes.at(-1) ?? -1;
  const threadEntriesAfterReset = entries.slice(lastReset + 1)
    .filter((entry: any) => entry.type === "custom" && entry.customType === "btw-thread-entry").length;
  const userMessages = entries.filter((entry: any) => entry.type === "message" && entry.message.role === "user")
    .map((entry: any) => messageText(entry.message));
  writeFileSync(stage === "failure" ? ${JSON.stringify(failurePath)} : ${JSON.stringify(successPath)}, JSON.stringify({
    userMessages, threadEntries, resetCount: resetIndexes.length, threadEntriesAfterReset,
  }), { mode: 0o600 });
}
async function waitForMain() {
  for (let attempt = 0; attempt < 500 && !existsSync(${JSON.stringify(mainDonePath)}); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!existsSync(${JSON.stringify(mainDonePath)})) {
    throw new Error("main provider did not run after summary injection");
  }
}
export default function (pi: ExtensionAPI) {
  pi.registerProvider({
    id: "offline-native",
    name: "Offline Native Summary Auth",
    auth: {
      apiKey: {
        name: "Offline summary API key",
        async resolve({ credential }: any) {
          return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
        },
      },
    },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  } as any);
  pi.registerCommand("offline-proof", {
    description: "Record BTW summary state without exposing RPC output",
    handler: async (args, ctx) => {
      if (args.trim() === "success") {
        await waitForMain();
        await ctx.waitForIdle();
      }
      snapshot(args.trim(), ctx);
    },
  });
}
`);

    const child = spawn(
      process.execPath,
      [
        "--import",
        guardPath,
        piCli,
        "--provider",
        "offline-native",
        "--model",
        "offline-summary-model",
        "--api-key",
        "offline-summary-test-key",
        "--mode",
        "rpc",
        "--no-session",
      ],
      {
        cwd: root,
        env: {
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          HOME: join(root, "home"),
          TMPDIR: root,
          XDG_CACHE_HOME: join(root, "cache"),
          PI_CODING_AGENT_DIR: agentDir,
          PI_OFFLINE: "1",
          PI_SKIP_VERSION_CHECK: "1",
          PI_TELEMETRY: "0",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const commands = [
      { id: "btw-1", type: "prompt", message: "/btw summarize hidden first" },
      { id: "btw-2", type: "prompt", message: "/btw summarize hidden second" },
      { id: "summary-fail", type: "prompt", message: "/btw:summarize" },
      { id: "failure-proof", type: "prompt", message: "/offline-proof failure" },
      { id: "summary-retry", type: "prompt", message: "/btw:summarize" },
      { id: "success-proof", type: "prompt", message: "/offline-proof success" },
      { id: "clear-check", type: "prompt", message: "/btw:summarize" },
    ];
    let completed = 0;
    let pending = "";
    let timedOut = false;
    let transportFailed = false;
    const failTransport = () => {
      transportFailed = true;
      child.kill("SIGKILL");
    };
    const sendNext = () => child.stdin.write(`${JSON.stringify(commands[completed])}\n`);
    const exit = new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 25_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        pending += chunk;
        let newline;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          let record;
          try { record = JSON.parse(line); } catch { failTransport(); return; }
          if (record.type !== "response") continue;
          if (record.id !== commands[completed]?.id || record.command !== "prompt" || record.success !== true) {
            failTransport();
            return;
          }
          completed++;
          if (completed === commands.length) child.stdin.end();
          else sendNext();
        }
      });
      // Keep protocol records and diagnostics out of assertion failures.
      child.stderr.resume();
      child.stdin.on("error", failTransport);
      child.on("error", failTransport);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    sendNext();

    const code = await exit;
    assert.equal(timedOut, false, "offline summarize RPC deadline");
    assert.equal(transportFailed, false, "offline summarize RPC command/transport failure");
    assert.equal(code, 0, "offline summarize Pi CLI exit code");
    assert.equal(completed, commands.length, "all summarize fixture commands completed sequentially");
    assert.equal(existsSync(networkPath), false, "summarize fixture attempted network access");
    for (const [label, path] of [["calls", callsPath], ["failure", failurePath], ["success", successPath]]) {
      assert.ok(existsSync(path), `private ${label} proof missing`);
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }

    let calls;
    let failure;
    let success;
    try {
      calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      failure = JSON.parse(readFileSync(failurePath, "utf8"));
      success = JSON.parse(readFileSync(successPath, "utf8"));
    } catch {
      assert.fail("private summarize fixture proof is not valid JSON");
    }
    const expectedThread = [
      "User: summarize hidden first",
      "Assistant: hidden first answer",
      "",
      "---",
      "",
      "User: summarize hidden second",
      "Assistant: hidden second answer",
    ].join("\n");
    const expectedInjected = "Here is a summary of a side conversation I had:\n\nsummary includes both hidden BTW exchanges";
    assert.equal(calls.length, 5, "only two BTW turns, two summarize attempts, and one main turn reached the fake provider");
    assert.deepEqual(calls.map((call) => call.kind), [
      "btw-first",
      "btw-second",
      "summarize-failure",
      "summarize-success",
      "main-after-injection",
    ], "no unexpected provider call occurred");
    for (const call of calls) {
      assert.equal(call.runtimeKeyMatched, true, "synthetic current auth reached every provider child");
      assert.equal(call.modelMatched, true, "every provider call used the current model");
      assert.equal(call.normalized, true, "provider context is transcript-based");
      assert.deepEqual(call.selectedModel, {
        provider: "offline-native",
        id: "offline-summary-model",
        api: "offline-native-api",
      });
    }
    const summarizeCalls = calls.filter((call) => call.kind.startsWith("summarize-"));
    assert.equal(summarizeCalls.length, 2, "failure and retry both used the summarize child");
    for (const call of summarizeCalls) {
      assert.deepEqual(call.userTexts, [expectedThread], "summarize child receives the complete hidden BTW thread");
      assert.deepEqual(call.tools, [], "summarize child has no tools");
      assert.match(call.systemPrompt, /Summarize the side conversation concisely/);
    }
    const mainCalls = calls.filter((call) => call.kind === "main-after-injection");
    assert.equal(mainCalls.length, 1, "successful summary triggered exactly one main provider call");
    assert.deepEqual(mainCalls[0].userTexts.filter((text) => text === expectedInjected), [expectedInjected]);

    assert.deepEqual(failure, {
      userMessages: [],
      threadEntries: [
        { question: "summarize hidden first", answer: "hidden first answer" },
        { question: "summarize hidden second", answer: "hidden second answer" },
      ],
      resetCount: 0,
      threadEntriesAfterReset: 2,
    }, "failed summary injected nothing and preserved the hidden thread");
    assert.deepEqual(success, {
      userMessages: [expectedInjected],
      threadEntries: [
        { question: "summarize hidden first", answer: "hidden first answer" },
        { question: "summarize hidden second", answer: "hidden second answer" },
      ],
      resetCount: 1,
      threadEntriesAfterReset: 0,
    }, "successful summary injected once and cleared the hidden thread");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restores only the selected BTW branch after real offline session_tree events", { timeout: 30_000 }, async () => {
  const installedPackage =
    process.env.PI_BTW_PACKAGE_ROOT ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-btw");
  const piBin = process.env.PI_BIN ?? join(homedir(), ".bun", "bin", "pi");
  assert.ok(existsSync(installedPackage), `pi-btw package missing at ${installedPackage}`);
  assert.ok(existsSync(piBin), `Pi binary missing at ${piBin}`);
  assert.equal(JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8")).version, "0.6.1");

  const piCli = realpathSync(piBin);
  const piPackageRoot = dirname(dirname(dirname(piCli)));
  const piPackage = JSON.parse(readFileSync(join(piPackageRoot, "package.json"), "utf8"));
  assert.equal(piPackage.name, "@earendil-works/pi-coding-agent");
  assert.equal(piPackage.version, "0.87.1", "fixture requires the published Pi 0.87.1 CLI");
  assert.equal(piCli, join(piPackageRoot, piPackage.bin.pi));

  const parentMessages = [
    { role: "user", text: "restore parent question" },
    { role: "assistant", text: "restore parent answer" },
  ];
  const turns = [
    { question: "restore original first", answer: "original first answer", previous: [] },
    { question: "restore original second", answer: "original second answer", previous: [0] },
    { question: "restore alternate first", answer: "alternate first answer", previous: [] },
    { question: "restore alternate after reset", answer: "alternate reset answer", previous: [] },
    { question: "restore original resumed", answer: "original restored answer", previous: [0, 1], restored: true },
    { question: "restore reset resumed", answer: "reset restored answer", previous: [3], restored: true },
  ];
  // Rebuilt children include BTW's continuation marker before the restored exchanges, not duplicate parent history.
  const continuationMessages = [
    { role: "user", text: "[The following is a separate side conversation. Continue this thread.]" },
    { role: "assistant", text: "Understood, continuing our side conversation." },
  ];
  const expectedMessages = turns.map((turn) => [
    ...parentMessages,
    ...(turn.restored ? continuationMessages : []),
    ...turn.previous.flatMap((index) => [
      { role: "user", text: turns[index].question },
      { role: "assistant", text: turns[index].answer },
    ]),
    { role: "user", text: turn.question },
  ]);
  const root = mkdtempSync(join(tmpdir(), "pi-btw-restore-"));
  const agentDir = join(root, "agent");
  const packageRoot = join(agentDir, "npm", "node_modules", "pi-btw");
  const callsPath = join(root, "provider-calls.jsonl");
  const statesPath = join(root, "branch-states.jsonl");
  const eventsPath = join(root, "session-events.jsonl");
  const networkPath = join(root, "network-attempted");
  const guardPath = join(root, "offline-guard.mjs");
  try {
    assert.equal(statSync(root).mode & 0o777, 0o700);
    mkdirSync(join(root, "home"));
    mkdirSync(dirname(packageRoot), { recursive: true });
    // Load the installed package copy without changing its restore code or event handlers.
    cpSync(installedPackage, packageRoot, { recursive: true });
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({
      lastChangelogVersion: "0.87.1",
      packages: ["npm:pi-btw@0.6.1"],
      defaultThinkingLevel: "off",
      cacheWarming: "off",
      compaction: { enabled: false },
      retry: { enabled: false },
      defaultProjectTrust: "never",
    }, null, 2)}\n`);
    writeFileSync(guardPath, `import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
function blocked() {
  writeFileSync(${JSON.stringify(networkPath)}, "blocked", { mode: 0o600 });
  throw new Error("Network disabled in offline BTW restore fixture");
}
http.request = http.get = https.request = https.get = blocked;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = blocked;
globalThis.fetch = blocked;
syncBuiltinESMExports();
`);
    writeFileSync(join(agentDir, "extensions", "offline-restore.ts"), `import { appendFileSync } from "node:fs";
import { contentText } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
const model = {
  id: "offline-restore-model",
  name: "Offline Restore Model",
  api: "offline-native-api",
  provider: "offline-native",
  baseUrl: "http://127.0.0.1:1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 1000,
} as const;
const parentMessages = ${JSON.stringify(parentMessages)};
const turns = ${JSON.stringify(turns)};
const expectedMessages = ${JSON.stringify(expectedMessages)};
let callIndex = 0;
function makeAssistant(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  } as const;
}
function ordinaryMessages(messages: any[]) {
  return messages.filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, text: contentText(message.content) }));
}
function stream(selectedModel: typeof model, context: any, options: any) {
  const index = callIndex++;
  const turn = turns[index];
  const question = contentText(context.messages.at(-1)?.content ?? "");
  const messages = ordinaryMessages(context.messages);
  const runtimeKeyMatched = options?.apiKey === "offline-restore-test-key";
  const modelMatched = selectedModel.provider === model.provider && selectedModel.id === model.id &&
    selectedModel.api === model.api && selectedModel.baseUrl === model.baseUrl;
  const normalized = !Object.hasOwn(context, "systemPrompt") && !Object.hasOwn(context, "tools");
  const historyMatched = JSON.stringify(messages) === JSON.stringify(expectedMessages[index]);
  appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({
    question, messages, runtimeKeyMatched, modelMatched, normalized, historyMatched,
  }) + "\\n", { mode: 0o600 });
  if (!turn || question !== turn.question || !runtimeKeyMatched || !modelMatched || !normalized || !historyMatched) {
    throw new Error("Unexpected offline BTW restore request or branch history");
  }
  const message = makeAssistant(turn.answer);
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: { ...message, content: [], stopReason: "pending" } };
      yield { type: "done", reason: "stop", message };
    },
    result: async () => message,
  } as any;
}
function recordEvent(event: any, ctx: any) {
  appendFileSync(${JSON.stringify(eventsPath)}, JSON.stringify({
    type: event.type, sessionId: ctx.sessionManager.getSessionId(),
    oldLeafId: event.oldLeafId, newLeafId: event.newLeafId,
    selectedLeafId: ctx.sessionManager.getLeafId(),
    ephemeral: ctx.sessionManager.getSessionFile() === undefined,
  }) + "\\n", { mode: 0o600 });
}
export default function (pi: ExtensionAPI) {
  pi.registerProvider({
    id: "offline-native",
    name: "Offline Native Restore Auth",
    auth: {
      apiKey: {
        name: "Offline restore API key",
        async resolve({ credential }: any) {
          return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
        },
      },
    },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  } as any);
  pi.on("session_start", recordEvent);
  pi.on("session_tree", recordEvent);
  pi.registerCommand("offline-seed", {
    description: "Seed disposable ordinary parent messages without a provider request",
    handler: async (_args, ctx) => {
      await ctx.newSession({ setup: async (manager) => {
        manager.appendMessage({ role: "system", content: "offline restore parent system", timestamp: 1 });
        manager.appendMessage({ role: "user", content: parentMessages[0].text, timestamp: 2 });
        manager.appendMessage(makeAssistant(parentMessages[1].text));
      } });
    },
  });
  pi.registerCommand("offline-branch", {
    description: "Navigate through Pi's command context and await its real session_tree event",
    handler: async (args, ctx) => {
      const destination = args.trim();
      const question = { original: turns[1].question, reset: turns[3].question }[destination];
      const target = ctx.sessionManager.getEntries().find((entry: any) => {
        if (destination === "base") {
          return entry.type === "message" && entry.message.role === "assistant" &&
            contentText(entry.message.content) === parentMessages[1].text;
        }
        return entry.type === "custom" && entry.customType === "btw-thread-entry" && entry.data.question === question;
      });
      if (!target) throw new Error("Missing offline branch target");
      // Non-user targets select that entry, unlike user/custom-message targets which select their parent.
      const result = await ctx.navigateTree(target.id, { summarize: false });
      if (result.cancelled || ctx.sessionManager.getLeafId() !== target.id) {
        throw new Error("Offline tree navigation did not select its target");
      }
    },
  });
  pi.registerCommand("offline-proof", {
    description: "Record branch state separately from provider-observed restoration",
    handler: async (args, ctx) => {
      const entries = ctx.sessionManager.getEntries();
      const branch = ctx.sessionManager.getBranch();
      const lastReset = branch.findLastIndex((entry: any) => entry.type === "custom" && entry.customType === "btw-thread-reset");
      const thread = (list: any[]) => list.filter((entry) => entry.type === "custom" && entry.customType === "btw-thread-entry")
        .map((entry) => ({ id: entry.id, question: entry.data.question, answer: entry.data.answer }));
      appendFileSync(${JSON.stringify(statesPath)}, JSON.stringify({
        stage: args.trim(), sessionId: ctx.sessionManager.getSessionId(), leafId: ctx.sessionManager.getLeafId(),
        ephemeral: ctx.sessionManager.getSessionFile() === undefined,
        ordinaryEntries: entries.filter((entry) => entry.type === "message" &&
          (entry.message.role === "user" || entry.message.role === "assistant")),
        parentMessages: ordinaryMessages(ctx.sessionManager.buildSessionContext().messages),
        activeTurns: thread(branch.slice(lastReset + 1)), allTurns: thread(entries),
        resetCount: branch.filter((entry: any) => entry.type === "custom" && entry.customType === "btw-thread-reset").length,
      }) + "\\n", { mode: 0o600 });
    },
  });
}
`);

    const child = spawn(process.execPath, [
      "--import", guardPath, piCli,
      "--provider", "offline-native", "--model", "offline-restore-model",
      "--api-key", "offline-restore-test-key", "--mode", "rpc", "--no-session",
    ], {
      cwd: root,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: join(root, "home"),
        TMPDIR: root,
        XDG_CACHE_HOME: join(root, "cache"),
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    // RPC has no tree-navigation command. This extension uses the supported command-context API instead.
    const commands = [
      ["seed", "/offline-seed"],
      ["seed-proof", "/offline-proof seed"],
      ["btw-1", `/btw ${turns[0].question}`],
      ["btw-2", `/btw ${turns[1].question}`],
      ["original-proof", "/offline-proof original"],
      ["branch-away", "/offline-branch base"],
      ["alternate", `/btw ${turns[2].question}`],
      ["alternate-proof", "/offline-proof alternate"],
      ["clear", "/btw:clear"],
      ["after-reset", `/btw ${turns[3].question}`],
      ["reset-proof", "/offline-proof reset"],
      ["return-original", "/offline-branch original"],
      ["resume-original", `/btw ${turns[4].question}`],
      ["restored-proof", "/offline-proof restored"],
      ["return-reset", "/offline-branch reset"],
      ["resume-reset", `/btw ${turns[5].question}`],
      ["reset-restored-proof", "/offline-proof reset-restored"],
    ].map(([id, message]) => ({ id, type: "prompt", message }));
    let completed = 0;
    let pending = "";
    let timedOut = false;
    let transportFailed = false;
    let extensionFailed = false;
    const failTransport = () => {
      transportFailed = true;
      child.kill("SIGKILL");
    };
    const sendNext = () => child.stdin.write(`${JSON.stringify(commands[completed])}\n`);
    const exit = new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 25_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        pending += chunk;
        let newline;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          let record;
          try { record = JSON.parse(line); } catch { failTransport(); return; }
          if (record.type === "extension_error" || (record.method === "notify" && record.notifyType === "error")) {
            extensionFailed = true;
          }
          if (record.type !== "response") continue;
          if (record.id !== commands[completed]?.id || record.command !== "prompt" || record.success !== true) {
            failTransport();
            return;
          }
          completed++;
          // These are awaited extension commands, not ordinary prompts whose work continues after acceptance.
          if (completed === commands.length) child.stdin.end();
          else sendNext();
        }
      });
      // Keep raw protocol records, diagnostics, and auth values out of assertion failures.
      child.stderr.resume();
      child.stdin.on("error", failTransport);
      child.on("error", failTransport);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    sendNext();

    const code = await exit;
    assert.equal(timedOut, false, "offline restore RPC deadline");
    assert.equal(transportFailed, false, "offline restore RPC command/transport failure");
    assert.equal(code, 0, "offline restore Pi CLI exit code");
    assert.equal(completed, commands.length, "all restore commands completed sequentially");
    assert.equal(existsSync(networkPath), false, "restore fixture attempted network access");
    for (const [label, path] of [["calls", callsPath], ["states", statesPath], ["events", eventsPath]]) {
      assert.ok(existsSync(path), `private ${label} proof missing`);
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
    let calls;
    let states;
    let events;
    try {
      [calls, states, events] = [callsPath, statesPath, eventsPath].map((path) =>
        readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line)));
    } catch {
      assert.fail("private restore fixture proof is not valid JSON");
    }
    assert.equal(calls.length, 6, "only six BTW requests reached the fake provider; navigation and reset made none");
    assert.deepEqual(calls.map((call) => call.question), turns.map((turn) => turn.question));
    for (const [index, call] of calls.entries()) {
      assert.equal(call.runtimeKeyMatched, true, "transient synthetic auth reached each new or restored child");
      assert.equal(call.modelMatched, true, "every call used the current offline native model");
      assert.equal(call.normalized, true, "provider context is transcript-based");
      assert.equal(call.historyMatched, true, `fake provider accepted only the expected branch history for request ${index + 1}`);
      assert.ok(isDeepStrictEqual(call.messages, expectedMessages[index]),
        `BTW request ${index + 1} has exactly its selected thread and one copy of each ordinary parent message`);
    }
    assert.equal(extensionFailed, false, "restore fixture reported an extension error");
    assert.deepEqual(states.map((state) => state.stage), ["seed", "original", "alternate", "reset", "restored", "reset-restored"]);
    const [seed, original, alternate, reset, restored, resetRestored] = states;
    assert.equal(seed.ordinaryEntries.length, 2, "seed contains one ordinary user/assistant exchange");
    for (const state of states) {
      assert.equal(state.ephemeral, true, "no session file is needed for in-memory tree navigation");
      assert.equal(state.sessionId, seed.sessionId, "tree navigation stays in the seeded disposable session");
      assert.ok(isDeepStrictEqual(state.ordinaryEntries, seed.ordinaryEntries), "BTW operations do not duplicate or change ordinary parent entries");
      assert.ok(isDeepStrictEqual(state.parentMessages, parentMessages), "canonical parent user/assistant messages remain unchanged");
    }
    const exchanges = (indexes) => indexes.map((index) => ({ question: turns[index].question, answer: turns[index].answer }));
    const withoutIds = (entries) => entries.map(({ question, answer }) => ({ question, answer }));
    assert.deepEqual(seed.activeTurns, []);
    assert.deepEqual(withoutIds(original.activeTurns), exchanges([0, 1]), "two BTW exchanges were recorded before leaving");
    assert.deepEqual(withoutIds(alternate.activeTurns), exchanges([2]), "alternate branch excludes the original exchanges");
    assert.deepEqual(withoutIds(reset.activeTurns), exchanges([3]), "clear starts a new thread on the alternate branch");
    assert.deepEqual(withoutIds(restored.activeTurns), exchanges([0, 1, 4]), "returning to the original branch restores both exchanges");
    assert.deepEqual(withoutIds(resetRestored.activeTurns), exchanges([3, 5]), "restoring the reset branch excludes pre-reset and original exchanges");
    assert.deepEqual(withoutIds(resetRestored.allTurns), exchanges([0, 1, 2, 3, 4, 5]), "all abandoned exchanges remain stored but cannot leak into restored children");
    assert.deepEqual(states.map((state) => state.resetCount), [0, 0, 0, 1, 0, 1], "reset markers apply only to their selected branch");

    assert.deepEqual(events.map((event) => event.type), [
      "session_start", "session_start", "session_tree", "session_tree", "session_tree",
    ], "published Pi dispatched startup, replacement startup, and all three tree events");
    assert.notEqual(events[0].sessionId, seed.sessionId, "seeding replaced the initial disposable session");
    assert.equal(events[1].sessionId, seed.sessionId);
    assert.ok(events.every((event) => event.ephemeral), "all observed sessions are in memory");
    const treeEvents = events.slice(2);
    assert.deepEqual(treeEvents.map((event) => event.oldLeafId), [original.leafId, reset.leafId, restored.leafId]);
    assert.deepEqual(treeEvents.map((event) => event.newLeafId), [
      seed.ordinaryEntries[1].id, original.activeTurns[1].id, reset.activeTurns[0].id,
    ], "tree events select the exact branch targets, not the latest appended entry");
    for (const event of treeEvents) {
      assert.equal(event.sessionId, seed.sessionId);
      assert.equal(event.selectedLeafId, event.newLeafId);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("aborts an in-flight BTW child on session_shutdown replacement and permits a fresh turn", { timeout: 30_000 }, async () => {
  const installedPackage =
    process.env.PI_BTW_PACKAGE_ROOT ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-btw");
  const piBin = process.env.PI_BIN ?? join(homedir(), ".bun", "bin", "pi");
  assert.ok(existsSync(installedPackage), `pi-btw package missing at ${installedPackage}`);
  assert.ok(existsSync(piBin), `Pi binary missing at ${piBin}`);
  assert.equal(JSON.parse(readFileSync(join(installedPackage, "package.json"), "utf8")).version, "0.6.1");
  const piCli = realpathSync(piBin);
  const piPackageRoot = dirname(dirname(dirname(piCli)));
  const piPackage = JSON.parse(readFileSync(join(piPackageRoot, "package.json"), "utf8"));
  assert.equal(piPackage.name, "@earendil-works/pi-coding-agent");
  assert.equal(piPackage.version, "0.87.1", "fixture requires the published Pi 0.87.1 CLI");
  assert.equal(piCli, join(piPackageRoot, piPackage.bin.pi));

  const root = mkdtempSync(join(tmpdir(), "pi-btw-shutdown-"));
  const agentDir = join(root, "agent");
  const packageRoot = join(root, "pi-btw");
  const proofPath = join(root, "shutdown-proof.jsonl");
  const deniedPath = join(root, "external-operation-attempted");
  const guardPath = join(root, "offline-guard.mjs");
  const providerPath = join(root, "offline-shutdown.ts");
  let child;
  let exit;
  try {
    assert.equal(statSync(root).mode & 0o777, 0o700);
    mkdirSync(join(root, "home"));
    mkdirSync(agentDir);
    // Exercise the installed source unchanged, including its real shutdown handler.
    cpSync(installedPackage, packageRoot, { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({
      lastChangelogVersion: "0.87.1",
      defaultThinkingLevel: "off",
      cacheWarming: "off",
      compaction: { enabled: false },
      retry: { enabled: false },
      defaultProjectTrust: "never",
    }, null, 2)}\n`);
    writeFileSync(guardPath, `import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import childProcess from "node:child_process";
function blocked() {
  writeFileSync(${JSON.stringify(deniedPath)}, "blocked", { mode: 0o600 });
  throw new Error("Network, subprocesses, and browser launches disabled in offline BTW shutdown fixture");
}
http.request = http.get = https.request = https.get = blocked;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = blocked;
dgram.createSocket = globalThis.fetch = blocked;
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[name] = blocked;
}
childProcess.ChildProcess.prototype.spawn = blocked;
syncBuiltinESMExports();
`);
    writeFileSync(providerPath, `import { appendFileSync } from "node:fs";
import { contentText, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
const pendingQuestion = "shutdown pending BTW";
const freshQuestion = "shutdown fresh BTW";
const freshAnswer = "fresh BTW completed after replacement";
const model = {
  id: "offline-shutdown-model", name: "Offline Shutdown Model",
  api: "offline-native-api", provider: "offline-native", baseUrl: "http://127.0.0.1:1",
  reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000, maxTokens: 1000,
} as const;
function record(value: any) {
  appendFileSync(${JSON.stringify(proofPath)}, JSON.stringify(value) + "\\n", { mode: 0o600 });
}
export default function (pi: ExtensionAPI) {
  const active = new Set<string>();
  let notifyPending: () => void;
  function snapshot(stage: string, reason: string | undefined, ctx: any) {
    const entries = ctx.sessionManager.getEntries();
    record({
      kind: "state", stage, reason, sessionId: ctx.sessionManager.getSessionId(),
      ephemeral: ctx.sessionManager.getSessionFile() === undefined, active: [...active],
      ordinaryEntries: entries.filter((entry: any) => entry.type === "message" &&
        (entry.message.role === "user" || entry.message.role === "assistant")),
      ordinaryContext: ctx.sessionManager.buildSessionContext().messages.filter((message: any) =>
        message.role === "user" || message.role === "assistant"),
      turns: entries.filter((entry: any) => entry.type === "custom" && entry.customType === "btw-thread-entry")
        .map((entry: any) => ({ question: entry.data.question, answer: entry.data.answer })),
      notes: entries.filter((entry: any) => entry.type === "custom_message" && entry.customType === "btw-note")
        .map((entry: any) => ({ question: entry.details.question, answer: entry.details.answer })),
    });
  }
  function stream(selectedModel: typeof model, context: any, options: any) {
    const messages = context.messages.filter((message: any) => message.role === "user" || message.role === "assistant")
      .map((message: any) => ({ role: message.role, text: contentText(message.content) }));
    const question = messages.at(-1)?.text;
    const runtimeKeyMatched = options?.apiKey === "offline-shutdown-test-key";
    const modelMatched = selectedModel.provider === model.provider && selectedModel.id === model.id &&
      selectedModel.api === model.api && selectedModel.baseUrl === model.baseUrl;
    const normalized = !Object.hasOwn(context, "systemPrompt") && !Object.hasOwn(context, "tools");
    const signal = options?.signal;
    record({ kind: "request", question, messages, runtimeKeyMatched, modelMatched, normalized,
      signalReady: !!signal && !signal.aborted });
    if (!runtimeKeyMatched || !modelMatched || !normalized || !signal || signal.aborted ||
        (question !== pendingQuestion && question !== freshQuestion) || active.size !== 0) {
      throw new Error("Unexpected offline BTW shutdown request");
    }
    active.add(question);
    const output = createAssistantMessageEventStream();
    const message: any = {
      role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "pending", timestamp: Date.now(),
    };
    output.push({ type: "start", partial: message });
    if (question === pendingQuestion) {
      // Only Pi's child AbortSignal can finish this request. There is no timer-based completion.
      const onAbort = () => {
        record({ kind: "abort", question, signalAborted: signal.aborted });
        signal.removeEventListener("abort", onAbort);
        message.stopReason = "aborted";
        message.errorMessage = "synthetic BTW request aborted";
        output.push({ type: "error", reason: "aborted", error: message });
        output.end();
        active.delete(question);
        record({ kind: "released", question, stopReason: message.stopReason, active: [...active] });
      };
      signal.addEventListener("abort", onAbort, { once: true });
      notifyPending();
    } else {
      message.content = [{ type: "text", text: freshAnswer }];
      message.stopReason = "stop";
      output.push({ type: "done", reason: "stop", message });
      output.end();
      active.delete(question);
      record({ kind: "released", question, stopReason: message.stopReason, active: [...active] });
    }
    return output;
  }
  pi.registerProvider({
    id: "offline-native", name: "Offline Native Shutdown Auth",
    auth: { apiKey: { name: "Offline shutdown API key", async resolve({ credential }: any) {
      return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
    } } },
    getModels: () => [model], stream, streamSimple: stream,
  } as any);
  pi.on("session_start", (event, ctx) => {
    notifyPending = () => ctx.ui.notify("offline-btw-stream-pending", "info");
    snapshot(event.type, event.reason, ctx);
  });
  pi.on("session_before_switch", (event, ctx) => snapshot(event.type, event.reason, ctx));
  // Explicit CLI extension order puts this observer after BTW's awaited shutdown cleanup.
  pi.on("session_shutdown", (event, ctx) => snapshot(event.type, event.reason, ctx));
  pi.registerCommand("offline-proof", {
    description: "Record settled replacement state without exposing RPC data",
    handler: async (_args, ctx) => snapshot("proof", undefined, ctx),
  });
}
`);

    child = spawn(process.execPath, [
      "--import", guardPath, piCli,
      "--no-extensions", "--extension", join(packageRoot, "extensions", "btw.ts"), "--extension", providerPath,
      "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
      "--provider", "offline-native", "--model", "offline-shutdown-model",
      "--api-key", "offline-shutdown-test-key", "--mode", "rpc", "--no-session",
    ], {
      cwd: root,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: join(root, "home"), TMPDIR: root, XDG_CACHE_HOME: join(root, "cache"),
        PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const sent = new Map();
    const completed = new Set();
    let pending = "";
    let timedOut = false;
    let transportFailed = false;
    let extensionFailed = false;
    let ordinaryRpcMessages = 0;
    let ready = false;
    const failTransport = () => {
      transportFailed = true;
      child.kill("SIGKILL");
    };
    const send = (id, type, message) => {
      sent.set(id, type);
      child.stdin.write(`${JSON.stringify({ id, type, message })}\n`);
    };
    exit = new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 25_000);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        pending += chunk;
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
              (record.message?.role === "user" || record.message?.role === "assistant")) {
            ordinaryRpcMessages++;
          }
          if (record.type === "extension_ui_request" && record.method === "notify" &&
              record.message === "offline-btw-stream-pending") {
            if (ready || completed.has("btw-pending")) { failTransport(); return; }
            ready = true;
            // Keep stdin open: new_session, not EOF, must dispatch session_shutdown(reason: "new").
            send("replace", "new_session");
          }
          if (record.type !== "response") continue;
          if (!sent.has(record.id) || completed.has(record.id) || record.command !== sent.get(record.id) ||
              record.success !== true || (record.id === "replace" && record.data?.cancelled !== false) ||
              (record.id === "btw-pending" && !ready)) {
            failTransport();
            return;
          }
          completed.add(record.id);
          // Replacement and the aborted extension command can respond in either order.
          if (completed.has("btw-pending") && completed.has("replace") && !sent.has("btw-fresh")) {
            send("btw-fresh", "prompt", "/btw shutdown fresh BTW");
          } else if (record.id === "btw-fresh") {
            send("proof", "prompt", "/offline-proof");
          } else if (record.id === "proof") {
            // EOF is only final idle cleanup. It produces a separate shutdown(reason: "quit").
            child.stdin.end();
          }
        }
      });
      // Never include raw RPC records, stderr, or auth values in assertion failures.
      child.stderr.resume();
      child.stdin.on("error", failTransport);
      child.on("error", failTransport);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    send("btw-pending", "prompt", "/btw shutdown pending BTW");
    const code = await exit;
    assert.equal(timedOut, false, "offline shutdown RPC deadline");
    assert.equal(transportFailed, false, "offline shutdown RPC command/transport failure");
    assert.equal(code, 0, "offline shutdown Pi CLI exit code");
    assert.equal(ready, true, "replacement was triggered by an in-flight provider event, not a delay");
    assert.equal(completed.size, 4, "pending BTW, replacement, fresh BTW, and proof commands all completed");
    assert.equal(pending.length, 0, "RPC ended on a complete JSONL record");
    assert.equal(extensionFailed, false, "shutdown fixture reported an extension error");
    assert.equal(ordinaryRpcMessages, 0, "no ordinary user/assistant messages leaked onto parent RPC events");
    assert.equal(existsSync(deniedPath), false, "fixture attempted network, subprocess, or browser access");
    assert.ok(existsSync(proofPath), "private shutdown proof missing");
    assert.equal(statSync(proofPath).mode & 0o777, 0o600);
    let records;
    try {
      records = readFileSync(proofPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    } catch {
      assert.fail("private shutdown proof is not valid JSON");
    }
    // Pi 0.87.1 rebinds in runtime replacement and again in the RPC new_session handler.
    assert.deepEqual(records.map((record) => record.stage ?? record.kind), [
      "session_start", "request", "session_before_switch", "abort", "released", "session_shutdown",
      "session_start", "session_start", "request", "released", "proof", "session_shutdown",
    ], "real replacement waits for child abort and release before the new session starts");
    const requests = records.filter((record) => record.kind === "request");
    assert.equal(requests.length, 2, "only the pending child and fresh child reached the fake provider");
    for (const [index, request] of requests.entries()) {
      const question = index === 0 ? "shutdown pending BTW" : "shutdown fresh BTW";
      assert.equal(request.question, question);
      assert.equal(request.runtimeKeyMatched, true, "synthetic runtime auth reached the child");
      assert.equal(request.modelMatched, true, "only the fake native model was used");
      assert.equal(request.normalized, true, "provider context is transcript-based");
      assert.equal(request.signalReady, true, "each child starts with a live AbortSignal");
      assert.deepEqual(request.messages, [{ role: "user", text: question }], "new child cannot inherit the aborted turn");
    }
    assert.deepEqual(records.filter((record) => record.kind === "abort"), [
      { kind: "abort", question: "shutdown pending BTW", signalAborted: true },
    ], "Pi aborted the first child stream exactly once");
    assert.deepEqual(records.filter((record) => record.kind === "released"), [
      { kind: "released", question: "shutdown pending BTW", stopReason: "aborted", active: [] },
      { kind: "released", question: "shutdown fresh BTW", stopReason: "stop", active: [] },
    ], "every fake request released its resources; no pending provider request remains");
    const states = records.filter((record) => record.kind === "state");
    const [initial, beforeSwitch, replaced, fresh, rebound, proof, quit] = states;
    assert.deepEqual(states.map((state) => state.active), [[], ["shutdown pending BTW"], [], [], [], [], []]);
    assert.equal(initial.reason, "startup");
    assert.deepEqual(rebound, fresh, "the second RPC bind starts the same replacement session, not another session");
    assert.equal(beforeSwitch.reason, "new");
    assert.equal(replaced.reason, "new", "in-flight cancellation used Pi's real session_shutdown event");
    assert.equal(fresh.reason, "new");
    assert.equal(quit.reason, "quit", "stdin EOF is distinct final idle cleanup, not the in-flight trigger");
    assert.equal(beforeSwitch.sessionId, initial.sessionId);
    assert.equal(replaced.sessionId, initial.sessionId);
    assert.notEqual(fresh.sessionId, initial.sessionId);
    assert.equal(proof.sessionId, fresh.sessionId);
    assert.equal(quit.sessionId, fresh.sessionId);
    for (const state of states) {
      assert.equal(state.ephemeral, true, "all sessions are disposable and in memory");
      assert.deepEqual(state.ordinaryEntries, [], "no ordinary parent user/assistant entry was appended");
      assert.deepEqual(state.ordinaryContext, [], "no ordinary parent user/assistant message entered context");
    }
    for (const state of [initial, beforeSwitch, replaced, fresh, rebound]) {
      assert.deepEqual(state.turns, [], "the aborted request never became a completed hidden BTW turn");
      assert.deepEqual(state.notes, [], "the aborted request never became a visible BTW note");
    }
    const completedTurn = [{ question: "shutdown fresh BTW", answer: "fresh BTW completed after replacement" }];
    for (const state of [proof, quit]) {
      assert.deepEqual(state.turns, completedTurn, "only the later successful turn was recorded");
      assert.deepEqual(state.notes, completedTurn, "RPC displays only the later successful BTW note");
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      if (exit) await exit;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
