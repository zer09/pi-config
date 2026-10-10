import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, ResourceLoader } from "@earendil-works/pi-coding-agent";
import { loadTargetSessionManager } from "./pi-session-projection.fixture.ts";
import { hostNodeModules } from "./typecheck.ts";

// Test-only native provider. No real credentials, discovery, or transport runs here.
export async function cancelledTargetRetry(): Promise<AgentSessionEvent[]> {
  const packages = hostNodeModules();
  await loadTargetSessionManager(path.join(packages, "@earendil-works/pi-coding-agent"));
  const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(pathToFileURL(
    path.join(packages, "@earendil-works/pi-coding-agent/dist/index.js"),
  ).href);
  const ai: typeof import("@earendil-works/pi-ai") = await import(pathToFileURL(
    path.join(packages, "@earendil-works/pi-ai/dist/index.js"),
  ).href);
  const root = await mkdtemp(path.join(os.tmpdir(), "delegate-target-retry-"));
  const model: Model<"openai-responses"> = {
    id: "retry", name: "Offline retry", provider: "delegate-offline", api: "openai-responses",
    baseUrl: "https://invalid.test", input: ["text"], reasoning: false,
    contextWindow: 10000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  let calls = 0;
  const stream = () => {
    calls += 1;
    const result: AssistantMessage = {
      role: "assistant", api: model.api, provider: model.provider, model: model.id,
      timestamp: Date.now(), content: [], stopReason: "error", errorMessage: "503 Service unavailable",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const events = ai.createAssistantMessageEventStream();
    events.push({ type: "error", reason: "error", error: result });
    events.end();
    return events;
  };
  const runtime = await sdk.ModelRuntime.create({
    authPath: path.join(root, "auth.json"), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false,
  });
  runtime.registerNativeProvider({
    id: model.provider, name: "Offline retry",
    auth: { apiKey: { name: "Offline fixture", check: async () => ({ type: "api_key" }), resolve: async () => ({ auth: {} }) } },
    getModels: () => [model], stream, streamSimple: stream,
  });
  const resources: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "Offline retry fixture", getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => {}, reload: async () => {},
  };
  const { session } = await sdk.createAgentSession({
    cwd: root, agentDir: root, model, modelRuntime: runtime, tools: [], thinkingLevel: "off",
    resourceLoader: resources, sessionManager: sdk.SessionManager.inMemory(root),
    settingsManager: sdk.SettingsManager.inMemory({
      cacheWarming: "off", compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 2, baseDelayMs: 10000 },
    }),
  });
  const events: AgentSessionEvent[] = [];
  let cancellation: Promise<void> | undefined;
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    if (event.type === "auto_retry_start") {
      // Wait until Pi installs the backoff controller, then abort before continuation.
      cancellation = new Promise<void>((resolve, reject) => {
        setImmediate(() => { session.abort().then(resolve, reject); });
      });
    }
  });
  try {
    await session.prompt("Offline retry fixture");
    await cancellation;
    assert.ok(cancellation, "the fake provider must reach retry backoff");
    assert.equal(calls, 1, "cancellation must prevent another provider call");
    assert.deepEqual(events.filter((event) => ["agent_end", "auto_retry_start", "auto_retry_end", "agent_settled"].includes(event.type))
      .map((event) => event.type), ["agent_end", "auto_retry_start", "auto_retry_end", "agent_settled"]);
    const ended = events.find((event) => event.type === "agent_end");
    assert.ok(ended?.type === "agent_end" && ended.willRetry === true);
    const retryEnd = events.find((event) => event.type === "auto_retry_end");
    assert.ok(retryEnd?.type === "auto_retry_end");
    assert.equal(retryEnd.success, false);
    assert.equal(retryEnd.attempt, 1);
    assert.equal(retryEnd.finalError, "Retry cancelled");
    const settled = events.at(-1);
    assert.ok(settled?.type === "agent_settled" && settled.aborted === true);
    return events;
  } finally {
    unsubscribe();
    session.dispose();
    await rm(root, { recursive: true, force: true });
  }
}
