import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const helperPath = join(here, "reapply-model-runtime-patch.mjs");
const runtimeAuthMarker = 'parentAuthStatus.source === "runtime"';
const previousHelper = `async function createBtwModelRuntime(ctx: ExtensionCommandContext, model: SessionModel): Promise<ModelRuntime> {
  const modelRuntime = await ModelRuntime.create();
  const providerConfig = ctx.modelRegistry.getRegisteredProviderConfig(model.provider);
  if (providerConfig) {
    modelRuntime.registerProvider(model.provider, providerConfig);
  }
  return modelRuntime;
}`;

const stockFixture = `import {
  createAgentSession,
  createExtensionRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

function createBtwResourceLoader() {
  return {};
}

function extractText(parts: AssistantMessage["content"], type: "text" | "thinking"): string {
  return "";
}

async function createConversation(ctx: ExtensionCommandContext, settings: { model: SessionModel; thinkingLevel: string }) {
    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model: settings.model,
      modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
      thinkingLevel: settings.thinkingLevel,
    });
    return session;
}

async function createSummary(ctx: ExtensionCommandContext, model: SessionModel) {
    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model,
      modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
      thinkingLevel: "off",
    });
    return session;
}
`;

function makePackage(source = stockFixture) {
  const root = mkdtempSync(join(tmpdir(), "pi-btw-patch-test-"));
  const extensionDir = join(root, "extensions");
  mkdirSync(extensionDir, { recursive: true });
  writeFileSync(join(extensionDir, "btw.ts"), source);
  return root;
}

function runHelper(packageRoot) {
  return execFileSync(process.execPath, [helperPath, packageRoot], { encoding: "utf8" });
}

function assertCurrentPatch(source) {
  assert.match(source, /ModelRuntime,/);
  assert.match(source, /getProviderAuthStatus\(model\.provider\)/);
  assert.match(source, /parentAuthStatus\.source === "runtime"/);
  assert.match(source, /getApiKeyAndHeaders\(model\)/);
  assert.match(source, /setRuntimeApiKey\(model\.provider, parentAuth\.apiKey\)/);
  assert.equal((source.match(/\n      modelRuntime,\n/g) ?? []).length, 2);
  assert.doesNotMatch(source, /modelRegistry: ctx\.modelRegistry/);
}

test("patches stock pi-btw and is idempotent", () => {
  const root = makePackage();
  try {
    runHelper(root);
    const first = readFileSync(join(root, "extensions", "btw.ts"), "utf8");
    assertCurrentPatch(first);

    const output = runHelper(root);
    const second = readFileSync(join(root, "extensions", "btw.ts"), "utf8");
    assert.match(output, /already patched/);
    assert.equal(second, first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("upgrades the previous local ModelRuntime patch", () => {
  const root = makePackage();
  try {
    runHelper(root);
    const current = readFileSync(join(root, "extensions", "btw.ts"), "utf8");
    const previous = current.replace(
      /async function createBtwModelRuntime[\s\S]*?\n}\n\nfunction extractText/,
      `${previousHelper}\n\nfunction extractText`,
    );
    assert.doesNotMatch(previous, new RegExp(runtimeAuthMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    writeFileSync(join(root, "extensions", "btw.ts"), previous);

    const output = runHelper(root);
    const upgraded = readFileSync(join(root, "extensions", "btw.ts"), "utf8");
    assert.match(output, /upgraded: previous ModelRuntime patch/);
    assertCurrentPatch(upgraded);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("passes a parent --api-key runtime override to an offline BTW child", { timeout: 30_000 }, async () => {
  const installedPackage = process.env.PI_BTW_PACKAGE_ROOT ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-btw");
  const piBin = process.env.PI_BIN ?? join(homedir(), ".bun", "bin", "pi");
  assert.ok(existsSync(installedPackage), `pi-btw package missing at ${installedPackage}`);
  assert.ok(existsSync(piBin), `Pi binary missing at ${piBin}`);

  const root = mkdtempSync(join(tmpdir(), "pi-btw-runtime-auth-"));
  const agentDir = join(root, "agent");
  const packageRoot = join(agentDir, "npm", "node_modules", "pi-btw");
  const proofPath = join(root, "provider-called.txt");
  try {
    mkdirSync(dirname(packageRoot), { recursive: true });
    cpSync(installedPackage, packageRoot, { recursive: true });
    runHelper(packageRoot);
    const patchedSource = readFileSync(join(packageRoot, "extensions", "btw.ts"), "utf8");
    assertCurrentPatch(patchedSource);

    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({
      lastChangelogVersion: "0.80.10",
      packages: ["npm:pi-btw@0.4.1"],
      defaultThinkingLevel: "off",
    }, null, 2)}\n`);
    writeFileSync(join(agentDir, "extensions", "offline-runtime.ts"), `import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  pi.registerProvider("offline-runtime", {
    name: "Offline Runtime Auth",
    baseUrl: "http://127.0.0.1:1",
    api: "offline-runtime-api",
    authHeader: true,
    models: [{
      id: "offline-model",
      name: "Offline Model",
      api: "offline-runtime-api",
      provider: "offline-runtime",
      baseUrl: "http://127.0.0.1:1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100000,
      maxTokens: 1000,
    }],
    streamSimple(model) {
      appendFileSync(${JSON.stringify(proofPath)}, model.provider + "/" + model.id + "\\n");
      const message = {
        role: "assistant",
        content: [{ type: "text", text: "offline runtime auth response" }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      return {
        async *[Symbol.asyncIterator]() { yield { type: "done", reason: "stop", message }; },
        result: async () => message,
      } as any;
    },
  });
}
`);

    const child = spawn(piBin, [
      "--provider", "offline-runtime",
      "--model", "offline-model",
      "--api-key", "offline-runtime-test-key",
      "--mode", "rpc",
      "--no-session",
    ], {
      cwd: root,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const exit = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Pi RPC timed out. stdout=${stdout} stderr=${stderr}`));
      }, 20_000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.includes('"id":"btw"')) child.stdin.end();
      });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    child.stdin.write(`${JSON.stringify({ id: "btw", type: "prompt", message: "/btw runtime auth smoke" })}\n`);

    const result = await exit;
    const diagnostic = JSON.stringify({ ...result, stdout, stderr });
    assert.equal(result.code, 0, diagnostic);
    assert.match(stdout, /"id":"btw".*"success":true/);
    assert.ok(existsSync(proofPath), diagnostic);
    assert.equal(readFileSync(proofPath, "utf8"), "offline-runtime/offline-model\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
