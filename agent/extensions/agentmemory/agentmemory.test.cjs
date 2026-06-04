const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

function resolveGlobalNodeModules() {
  const candidates = [];
  try {
    candidates.push(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim());
  } catch {
    // npm may be unavailable in minimal validation environments.
  }
  if (process.env.HOME) candidates.push(path.join(process.env.HOME, ".bun", "install", "global", "node_modules"));
  candidates.push(path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules"));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "@earendil-works", "pi-coding-agent"))) return candidate;
  }
  return candidates[0];
}

const globalNodeModules = resolveGlobalNodeModules();
const piPackageRoot = path.join(globalNodeModules, "@earendil-works", "pi-coding-agent");
process.env.NODE_PATH = [
  path.join(piPackageRoot, "node_modules"),
  globalNodeModules,
  process.env.NODE_PATH,
].filter(Boolean).join(path.delimiter);
Module._initPaths();

function requirePiDependency(name) {
  try {
    return require(path.join(piPackageRoot, "node_modules", name));
  } catch (error) {
    if (error?.code !== "MODULE_NOT_FOUND") throw error;
    return require(name);
  }
}

const { createJiti } = requirePiDependency("jiti");

const extensionPath = path.join(__dirname, "index.ts");
const securityPath = path.join(__dirname, "security.ts");
const MANAGED_ENV_KEYS = [
  "AGENTMEMORY_URL",
  "AGENTMEMORY_SECRET",
  "AGENTMEMORY_REQUIRE_HTTPS",
  "AGENTMEMORY_PI_ENABLE_GATED",
  "PI_AGENTMEMORY_SECURITY_ENABLED",
  "PI_DELEGATE_CHILD",
];
const DEFAULT_TOOL_NAMES = [
  "memory_health",
  "memory_search",
  "memory_save",
  "memory_smart_search",
  "memory_recall",
  "memory_sessions",
  "memory_file_history",
  "memory_timeline",
  "memory_patterns",
  "memory_profile",
  "memory_commit_lookup",
  "memory_commits",
  "memory_diagnose",
  "memory_verify",
  "memory_lesson_recall",
  "memory_slot_list",
  "memory_slot_get",
  "memory_mcp_resources",
  "memory_mcp_resource_read",
  "memory_mcp_prompts",
  "memory_mcp_prompt_get",
];
const GATED_TOOL_NAMES = [
  "memory_lesson_save",
  "memory_consolidate",
  "memory_reflect",
  "memory_insight_list",
  "memory_audit",
  "memory_export",
  "memory_governance_delete",
  "memory_heal",
  "memory_slot_create",
  "memory_slot_append",
  "memory_slot_replace",
  "memory_slot_delete",
];

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function loadExtension() {
  const jiti = createJiti(extensionPath, { interopDefault: false, moduleCache: false });
  const mod = jiti(extensionPath);
  return mod.default ?? mod;
}

function loadSecurity() {
  const jiti = createJiti(securityPath, { interopDefault: false, moduleCache: false });
  return jiti(securityPath);
}

function jsonResponse(body, options = {}) {
  const ok = options.ok ?? true;
  return {
    ok,
    status: options.status ?? (ok ? 200 : 500),
    statusText: options.statusText ?? (ok ? "OK" : "ERR"),
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

function createHarness(options = {}) {
  const oldFetch = global.fetch;
  const oldEnv = new Map();
  for (const key of MANAGED_ENV_KEYS) oldEnv.set(key, process.env[key]);
  for (const key of MANAGED_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(options.env || {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const fetchCalls = [];
  global.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    if (options.fetchHandler) return await options.fetchHandler(String(url), init, fetchCalls);
    throw new Error("unexpected fetch");
  };

  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const statuses = new Map();
  const notifications = [];

  const pi = {
    on(event, handler) {
      const list = handlers.get(event) || [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
  };

  try {
    loadExtension()(pi);
  } catch (error) {
    cleanup();
    throw error;
  }

  const ctx = {
    hasUI: true,
    cwd: "/tmp/project",
    sessionManager: {
      getSessionFile: () => "/tmp/session-file.json",
    },
    ui: {
      setStatus(key, text) {
        statuses.set(key, text);
      },
      notify(message, level) {
        notifications.push({ message, level });
      },
    },
  };

  function cleanup() {
    if (oldFetch === undefined) delete global.fetch;
    else global.fetch = oldFetch;
    for (const key of MANAGED_ENV_KEYS) {
      const value = oldEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  async function emit(event, payload = {}, customCtx = ctx) {
    let result;
    for (const handler of handlers.get(event) || []) {
      const handlerResult = await handler(payload, customCtx);
      if (handlerResult !== undefined) result = handlerResult;
    }
    return result;
  }

  async function callTool(name, params = {}, customCtx = ctx) {
    const tool = tools.get(name);
    assert.equal(typeof tool?.execute, "function", `${name} should be registered`);
    return await tool.execute("tool-1", params, undefined, undefined, customCtx);
  }

  return {
    handlers,
    tools,
    commands,
    statuses,
    notifications,
    fetchCalls,
    ctx,
    emit,
    callTool,
    cleanup,
  };
}

function parseBody(call) {
  return JSON.parse(call.init.body);
}

function textContent(result) {
  return result.content.map((block) => block.text).join("\n");
}

test("registers curated default tools and bundled skill discovery", async () => {
  const harness = createHarness();
  try {
    assert.deepEqual([...harness.tools.keys()].sort(), [...DEFAULT_TOOL_NAMES].sort());
    for (const gated of GATED_TOOL_NAMES) assert.equal(harness.tools.has(gated), false, `${gated} should not be registered by default`);

    const resources = await harness.emit("resources_discover", { reason: "startup", cwd: "/tmp/project" });
    assert.deepEqual(resources.skillPaths, [path.join(__dirname, "skills")]);
  } finally {
    harness.cleanup();
  }
});

test("AGENTMEMORY_PI_ENABLE_GATED registers gated tools", () => {
  const harness = createHarness({ env: { AGENTMEMORY_PI_ENABLE_GATED: "1" } });
  try {
    assert.deepEqual(
      [...harness.tools.keys()].sort(),
      [...DEFAULT_TOOL_NAMES, ...GATED_TOOL_NAMES].sort(),
    );
  } finally {
    harness.cleanup();
  }
});

test("delegate child sessions register no tools hooks commands or skills", () => {
  const harness = createHarness({ env: { PI_DELEGATE_CHILD: "1", AGENTMEMORY_PI_ENABLE_GATED: "1" } });
  try {
    assert.equal(harness.tools.size, 0);
    assert.equal(harness.commands.size, 0);
    assert.equal(harness.handlers.size, 0);
  } finally {
    harness.cleanup();
  }
});

test("memory_health failure reports configured URL", async () => {
  const harness = createHarness({
    env: { AGENTMEMORY_URL: "http://localhost:5999" },
    fetchHandler: async () => { throw new Error("offline"); },
  });
  try {
    const result = await harness.callTool("memory_health");
    assert.match(textContent(result), /http:\/\/localhost:5999/);
  } finally {
    harness.cleanup();
  }
});

test("memory_health reports policy drift and followup diagnostics", async () => {
  const harness = createHarness({
    fetchHandler: async (url) => {
      if (url.endsWith("/agentmemory/health")) return jsonResponse({ status: "healthy", version: "0.9.27" });
      if (url.endsWith("/agentmemory/diagnostics/followup")) {
        return jsonResponse({
          success: true,
          windowSeconds: 120,
          agentInitiatedSearches: 4,
          followupWithinWindow: 1,
          rate: 0.25,
          caveat: "Directional signal only.",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  try {
    const result = await harness.callTool("memory_health");
    const text = textContent(result);
    assert.match(text, /agentmemory status: healthy \(v0\.9\.27\)/);
    assert.match(text, /policy drift warning: local Pi policy last checked against AgentMemory v0\.9\.26, but server reports v0\.9\.27/);
    assert.match(text, /smart-search followup diagnostic: 1\/4 agent searches followed up within 120s \(25\.0%\)/);
    assert.match(text, /Directional signal only/);
    assert.equal(harness.fetchCalls.length, 2);
    assert.equal(result.details.piDiagnostics.policy.lastCheckedVersion, "0.9.26");
    assert.equal(result.details.piDiagnostics.policy.serverVersion, "0.9.27");
    assert.equal(result.details.piDiagnostics.followup.rate, 0.25);
  } finally {
    harness.cleanup();
  }
});

test("memory_health formats followup diagnostics with unknown rate and configured window", async () => {
  const harness = createHarness({
    fetchHandler: async (url) => {
      if (url.endsWith("/agentmemory/health")) return jsonResponse({ status: "healthy", version: "0.9.26" });
      if (url.endsWith("/agentmemory/diagnostics/followup")) {
        return jsonResponse({
          success: true,
          windowSeconds: null,
          agentInitiatedSearches: 3,
          followupWithinWindow: 0,
          rate: null,
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  try {
    const result = await harness.callTool("memory_health");
    const text = textContent(result);
    assert.match(text, /smart-search followup diagnostic: 0\/3 agent searches followed up within the configured window \(unknown rate\)\./);
    assert.equal(result.details.piDiagnostics.followup.rate, null);
    assert.equal(result.details.piDiagnostics.followup.windowSeconds, null);
  } finally {
    harness.cleanup();
  }
});

test("agentmemory-status reports policy drift without leaking raw health text", async () => {
  const harness = createHarness({
    fetchHandler: async () => jsonResponse({ status: "healthy", version: "0.9.27" }),
  });
  try {
    const command = harness.commands.get("agentmemory-status");
    await command.handler("", harness.ctx);
    assert.equal(harness.notifications.length, 1);
    assert.match(harness.notifications[0].message, /agentmemory healthy v0\.9\.27; policy drift warning:/);
  } finally {
    harness.cleanup();
  }
});

test("memory_diagnose appends policy and followup diagnostics", async () => {
  const harness = createHarness({
    fetchHandler: async (url, init) => {
      if (url.endsWith("/agentmemory/mcp/call")) {
        assert.deepEqual(JSON.parse(init.body), { name: "memory_diagnose", arguments: { categories: "sessions" } });
        return jsonResponse({ content: [{ type: "text", text: "diagnostics ok" }] });
      }
      if (url.endsWith("/agentmemory/health")) return jsonResponse({ status: "healthy", version: "0.9.27" });
      if (url.endsWith("/agentmemory/diagnostics/followup")) {
        return jsonResponse({ success: true, windowSeconds: 60, agentInitiatedSearches: 2, followupWithinWindow: 1, rate: 0.5 });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  try {
    const result = await harness.callTool("memory_diagnose", { categories: "sessions" });
    const text = textContent(result);
    assert.match(text, /diagnostics ok/);
    assert.match(text, /policy drift warning: local Pi policy last checked against AgentMemory v0\.9\.26, but server reports v0\.9\.27/);
    assert.match(text, /smart-search followup diagnostic: 1\/2 agent searches followed up within 60s \(50\.0%\)/);
    assert.equal(harness.fetchCalls.length, 3);
  } finally {
    harness.cleanup();
  }
});

test("memory_smart_search calls the MCP REST bridge", async () => {
  const harness = createHarness({
    fetchHandler: async (url) => {
      assert.match(url, /\/agentmemory\/mcp\/call$/);
      return jsonResponse({ content: [{ type: "text", text: "search ok" }] });
    },
  });
  try {
    const result = await harness.callTool("memory_smart_search", { query: "prior decision", limit: 3 });
    assert.equal(textContent(result), "search ok");
    assert.deepEqual(parseBody(harness.fetchCalls[0]), {
      name: "memory_smart_search",
      arguments: { query: "prior decision", limit: 3 },
    });
  } finally {
    harness.cleanup();
  }
});

test("MCP isError responses are surfaced as failures", async () => {
  const harness = createHarness({
    fetchHandler: async () => jsonResponse({ isError: true, content: [{ type: "text", text: "upstream denied request" }] }),
  });
  try {
    const result = await harness.callTool("memory_smart_search", { query: "prior decision" });
    assert.equal(textContent(result), "memory_smart_search failed: upstream denied request");
    assert.equal(result.details.ok, false);
  } finally {
    harness.cleanup();
  }
});

test("MCP HTTP errors surface upstream errors instead of unreachable", async () => {
  const harness = createHarness({
    fetchHandler: async () => jsonResponse({ error: "Internal error" }, { ok: false, status: 500 }),
  });
  try {
    const result = await harness.callTool("memory_slot_list");
    assert.equal(textContent(result), "memory_slot_list failed: Internal error");
    assert.equal(result.details.ok, false);
    assert.equal(result.details.result.httpStatus, 500);
    assert.doesNotMatch(textContent(result), /unreachable/);
  } finally {
    harness.cleanup();
  }
});

test("memory_smart_search rejects empty queries before network calls", async () => {
  const harness = createHarness({
    fetchHandler: async () => { throw new Error("empty query should not fetch"); },
  });
  try {
    const result = await harness.callTool("memory_smart_search", { query: "   " });
    assert.equal(textContent(result), "Refusing memory_smart_search: query must be a non-empty string.");
    assert.equal(harness.fetchCalls.length, 0);
  } finally {
    harness.cleanup();
  }
});

test("MCP tools strip null optional arguments before upstream calls", async () => {
  const harness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "recall ok" }] }),
  });
  try {
    const result = await harness.callTool("memory_recall", { query: "prior decision", format: null, token_budget: null, limit: 1 });
    assert.equal(textContent(result), "recall ok");
    assert.deepEqual(parseBody(harness.fetchCalls[0]), {
      name: "memory_recall",
      arguments: { query: "prior decision", limit: 1 },
    });
  } finally {
    harness.cleanup();
  }
});

test("memory_recall narrative empty content returns a clear explanation", async () => {
  const harness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "" }] }),
  });
  try {
    const result = await harness.callTool("memory_recall", { query: "prior decision", format: "narrative", token_budget: 10 });
    assert.equal(textContent(result), "No recall narrative returned; no observations fit within the token budget.");
    assert.equal(result.details.reason, "empty-recall-narrative");
  } finally {
    harness.cleanup();
  }
});

test("memory_slot_list and memory_slot_get call read-only slot tools", async () => {
  const harness = createHarness({
    fetchHandler: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.name === "memory_slot_list") {
        return jsonResponse({ content: [{ type: "text", text: JSON.stringify({ slots: [{ label: "project_context" }] }) }] });
      }
      if (body.name === "memory_slot_get") {
        assert.deepEqual(body.arguments, { label: "project_context" });
        return jsonResponse({ content: [{ type: "text", text: "see https://user:pass@example.invalid/path" }] });
      }
      throw new Error(`unexpected ${body.name}`);
    },
  });
  try {
    const listResult = await harness.callTool("memory_slot_list");
    assert.match(textContent(listResult), /project_context/);
    assert.deepEqual(parseBody(harness.fetchCalls[0]), { name: "memory_slot_list", arguments: {} });

    const getResult = await harness.callTool("memory_slot_get", { label: "project_context" });
    assert.equal(textContent(getResult), "see https://<redacted>@example.invalid/path");
    assert.deepEqual(parseBody(harness.fetchCalls[1]), { name: "memory_slot_get", arguments: { label: "project_context" } });
    assert.doesNotMatch(JSON.stringify(getResult), /user|pass/);
  } finally {
    harness.cleanup();
  }
});

test("memory_slot_get unavailable responses are clear failures", async () => {
  const harness = createHarness({
    fetchHandler: async () => jsonResponse({ isError: true, content: [{ type: "text", text: "slots disabled" }] }),
  });
  try {
    const result = await harness.callTool("memory_slot_get", { label: "project_context" });
    assert.equal(textContent(result), "memory_slot_get failed: slots disabled");
    assert.equal(result.details.ok, false);
  } finally {
    harness.cleanup();
  }
});

test("gated memory_export requires confirmation and strips local guard params", async () => {
  const harness = createHarness({
    env: { AGENTMEMORY_PI_ENABLE_GATED: "1" },
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "export ok" }] }),
  });
  try {
    const refused = await harness.callTool("memory_export");
    assert.match(textContent(refused), /confirm.*export agentmemory/);
    assert.equal(harness.fetchCalls.length, 0);

    const result = await harness.callTool("memory_export", { confirm: "export agentmemory" });
    assert.equal(textContent(result), "export ok");
    assert.deepEqual(parseBody(harness.fetchCalls[0]), { name: "memory_export", arguments: {} });
  } finally {
    harness.cleanup();
  }
});

test("gated governance delete requires normalized confirmation", async () => {
  const harness = createHarness({
    env: { AGENTMEMORY_PI_ENABLE_GATED: "1" },
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "deleted" }] }),
  });
  try {
    const refused = await harness.callTool("memory_governance_delete", { memoryIds: "mem_b, mem_a", reason: "duplicate" });
    assert.match(textContent(refused), /delete memories:mem_a,mem_b/);
    assert.equal(harness.fetchCalls.length, 0);

    const result = await harness.callTool("memory_governance_delete", {
      memoryIds: "mem_b, mem_a",
      reason: "duplicate",
      confirm: "delete memories:mem_a,mem_b",
    });
    assert.equal(textContent(result), "deleted");
    assert.deepEqual(parseBody(harness.fetchCalls[0]), {
      name: "memory_governance_delete",
      arguments: { memoryIds: "mem_b, mem_a", reason: "duplicate" },
    });
  } finally {
    harness.cleanup();
  }
});

test("gated memory_heal confirmation is skipped only for dry runs", async () => {
  const harness = createHarness({
    env: { AGENTMEMORY_PI_ENABLE_GATED: "1" },
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "heal ok" }] }),
  });
  try {
    const dryRun = await harness.callTool("memory_heal", { dryRun: true });
    assert.equal(textContent(dryRun), "heal ok");
    assert.deepEqual(parseBody(harness.fetchCalls[0]), { name: "memory_heal", arguments: { dryRun: true } });

    const refused = await harness.callTool("memory_heal");
    assert.match(textContent(refused), /heal agentmemory/);
    assert.equal(harness.fetchCalls.length, 1);

    await harness.callTool("memory_heal", { categories: "sessions", confirm: "heal agentmemory" });
    assert.deepEqual(parseBody(harness.fetchCalls[1]), { name: "memory_heal", arguments: { categories: "sessions" } });
  } finally {
    harness.cleanup();
  }
});

test("gated slot writes require confirmation and reject secret-looking content", async () => {
  const harness = createHarness({
    env: { AGENTMEMORY_PI_ENABLE_GATED: "1" },
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "slot updated" }] }),
  });
  try {
    const refused = await harness.callTool("memory_slot_replace", { label: "project_context", content: "safe content" });
    assert.match(textContent(refused), /replace slot:project_context/);
    assert.equal(harness.fetchCalls.length, 0);

    const missingLabel = await harness.callTool("memory_slot_create", { content: "safe content", confirm: "create slot:" });
    assert.match(textContent(missingLabel), /label is required before confirmation/);
    assert.equal(harness.fetchCalls.length, 0);

    const secretRefused = await harness.callTool("memory_slot_append", {
      label: "project_context",
      text: "see https://user:pass@example.invalid/path",
      confirm: "append slot:project_context",
    });
    assert.match(textContent(secretRefused), /secret-looking value/);
    assert.equal(harness.fetchCalls.length, 0);

    const result = await harness.callTool("memory_slot_replace", {
      label: "project_context",
      content: "safe content",
      confirm: "replace slot:project_context",
    });
    assert.equal(textContent(result), "slot updated");
    assert.deepEqual(parseBody(harness.fetchCalls[0]), {
      name: "memory_slot_replace",
      arguments: { label: "project_context", content: "safe content" },
    });
  } finally {
    harness.cleanup();
  }
});

test("gated memory_lesson_save refuses secret-looking content before network calls", async () => {
  const harness = createHarness({
    env: { AGENTMEMORY_PI_ENABLE_GATED: "1" },
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "unexpected" }] }),
  });
  try {
    const result = await harness.callTool("memory_lesson_save", { content: "see https://user:pass@example.invalid/path" });
    assert.match(textContent(result), /secret-looking value/);
    assert.equal(harness.fetchCalls.length, 0);
  } finally {
    harness.cleanup();
  }
});

test("memory_mcp_resources lists read-only MCP resources", async () => {
  const harness = createHarness({
    fetchHandler: async (url, init) => {
      assert.match(url, /\/agentmemory\/mcp\/resources$/);
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      return jsonResponse({
        resources: [
          {
            uri: "agentmemory://status",
            name: "Agent Memory Status",
            description: "Current counts",
            mimeType: "application/json",
          },
        ],
      });
    },
  });
  try {
    const result = await harness.callTool("memory_mcp_resources");
    assert.match(textContent(result), /Agent Memory Status/);
    assert.match(textContent(result), /agentmemory:\/\/status/);
  } finally {
    harness.cleanup();
  }
});

test("memory_mcp_resource_read validates URIs and redacts output", async () => {
  const harness = createHarness({
    fetchHandler: async (url, init) => {
      assert.match(url, /\/agentmemory\/mcp\/resources\/read$/);
      assert.deepEqual(JSON.parse(init.body), { uri: "agentmemory://status" });
      return jsonResponse({ contents: [{ uri: "agentmemory://status", mimeType: "text/plain", text: "see https://user:pass@example.invalid/path" }] });
    },
  });
  try {
    const result = await harness.callTool("memory_mcp_resource_read", { uri: "agentmemory://status" });
    assert.equal(textContent(result), "see https://<redacted>@example.invalid/path");
    assert.doesNotMatch(JSON.stringify(result), /user|pass/);
  } finally {
    harness.cleanup();
  }

  const invalidHarness = createHarness({
    fetchHandler: async () => { throw new Error("invalid URI should not fetch"); },
  });
  try {
    const result = await invalidHarness.callTool("memory_mcp_resource_read", { uri: "agentmemory://project/{name}/profile" });
    assert.match(textContent(result), /Refusing to read AgentMemory MCP resource/);
    assert.equal(invalidHarness.fetchCalls.length, 0);
  } finally {
    invalidHarness.cleanup();
  }
});

test("memory_mcp_resource_read retries basename project profile resources with cwd path", async () => {
  const harness = createHarness({
    fetchHandler: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.uri === "agentmemory://project/project/profile") {
        return jsonResponse({ contents: [{ uri: body.uri, mimeType: "application/json", text: JSON.stringify({ profile: null, reason: "no_sessions" }) }] });
      }
      assert.equal(body.uri, "agentmemory://project/%2Ftmp%2Fproject/profile");
      return jsonResponse({ contents: [{ uri: body.uri, mimeType: "application/json", text: JSON.stringify({ profile: { project: "/tmp/project" } }) }] });
    },
  });
  try {
    const result = await harness.callTool("memory_mcp_resource_read", { uri: "agentmemory://project/project/profile" });
    assert.match(textContent(result), /"project": "\/tmp\/project"/);
    assert.equal(harness.fetchCalls.length, 2);
    assert.equal(result.details.uri, "agentmemory://project/%2Ftmp%2Fproject/profile");
    assert.equal(result.details.requestedUri, "agentmemory://project/project/profile");
  } finally {
    harness.cleanup();
  }
});

test("memory_mcp_prompts lists MCP prompt templates", async () => {
  const harness = createHarness({
    fetchHandler: async (url, init) => {
      assert.match(url, /\/agentmemory\/mcp\/prompts$/);
      assert.equal(init.method, "GET");
      return jsonResponse({
        prompts: [
          {
            name: "recall_context",
            description: "Search observations",
            arguments: [{ name: "task_description", required: true }],
          },
        ],
      });
    },
  });
  try {
    const result = await harness.callTool("memory_mcp_prompts");
    assert.match(textContent(result), /recall_context/);
    assert.match(textContent(result), /task_description required/);
  } finally {
    harness.cleanup();
  }
});

test("memory_mcp_prompt_get validates prompt names and parses JSON arguments", async () => {
  const harness = createHarness({
    fetchHandler: async (url, init) => {
      assert.match(url, /\/agentmemory\/mcp\/prompts\/get$/);
      assert.deepEqual(JSON.parse(init.body), {
        name: "recall_context",
        arguments: { task_description: "restore context" },
      });
      return jsonResponse({ messages: [{ role: "user", content: { type: "text", text: "Use recalled context only after review." } }] });
    },
  });
  try {
    const result = await harness.callTool("memory_mcp_prompt_get", {
      name: "recall_context",
      arguments: '{"task_description":"restore context"}',
    });
    assert.equal(textContent(result), "Use recalled context only after review.");
  } finally {
    harness.cleanup();
  }

  const invalidHarness = createHarness({
    fetchHandler: async () => { throw new Error("invalid prompt should not fetch"); },
  });
  try {
    const result = await invalidHarness.callTool("memory_mcp_prompt_get", { name: "forget" });
    assert.match(textContent(result), /name must be recall_context/);
    const missingArgsResult = await invalidHarness.callTool("memory_mcp_prompt_get", { name: "recall_context" });
    assert.match(textContent(missingArgsResult), /task_description argument is required/);
    assert.equal(invalidHarness.fetchCalls.length, 0);
  } finally {
    invalidHarness.cleanup();
  }
});

test("memory_mcp_prompt_get reports missing session handoffs clearly", async () => {
  const harness = createHarness({
    fetchHandler: async (_url, init) => {
      const sessionId = JSON.parse(init.body).arguments.session_id;
      if (sessionId === "missing-session") {
        return jsonResponse({
          messages: [{ role: "user", content: { type: "text", text: "## Session Handoff\n\n### Session\nundefined\n\n### Summary\n\"No summary available\"" } }],
        });
      }
      if (sessionId === "null-session") {
        return jsonResponse({
          messages: [{ role: "user", content: { type: "text", text: "## Session Handoff\n\n### Session\nnull\n\n### Summary\nNo summary available" } }],
        });
      }
      return jsonResponse({
        messages: [{ role: "user", content: { type: "text", text: "## Session Handoff\n\n### Session\nother-session\n\n### Summary\nNo summary available" } }],
      });
    },
  });
  try {
    const result = await harness.callTool("memory_mcp_prompt_get", {
      name: "session_handoff",
      arguments: { session_id: "missing-session" },
    });
    assert.equal(textContent(result), "Session not found: missing-session.");
    assert.equal(result.details.ok, false);
    assert.equal(result.details.reason, "session-not-found");

    const nullResult = await harness.callTool("memory_mcp_prompt_get", {
      name: "session_handoff",
      arguments: { session_id: "null-session" },
    });
    assert.equal(textContent(nullResult), "Session not found: null-session.");

    const differentResult = await harness.callTool("memory_mcp_prompt_get", {
      name: "session_handoff",
      arguments: { session_id: "requested-session" },
    });
    assert.equal(textContent(differentResult), "Session not found: requested-session.");
  } finally {
    harness.cleanup();
  }
});

test("security helpers redact protocol-relative URLs and shared secret-context objects", () => {
  const security = loadSecurity();
  assert.equal(security.isSecurityEnabled({}), true);
  assert.equal(security.isSecurityEnabled({ PI_AGENTMEMORY_SECURITY_ENABLED: "1" }), true);
  assert.equal(security.isSecurityEnabled({ PI_AGENTMEMORY_SECURITY_ENABLED: "enabled" }), true);
  assert.equal(security.isSecurityEnabled({ PI_AGENTMEMORY_SECURITY_ENABLED: "0" }), false);
  assert.equal(security.isSecurityEnabled({ PI_AGENTMEMORY_SECURITY_ENABLED: "false" }), false);
  assert.equal(security.isSecurityEnabled({ PI_AGENTMEMORY_SECURITY_ENABLED: "unexpected" }), true);
  assert.equal(security.sanitizeTextForDisplay("see //user:pass@example.invalid/path"), "see //<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("http://outer.invalid//user:pass@example.invalid/path"), "http://outer.invalid//<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("see https:\\\\user:pass@example.invalid\\\\path"), "see https:\\\\<redacted>@example.invalid\\\\path");
  assert.equal(security.sanitizeTextForDisplay("see https://example.invalid/path/user:pass@host/more"), "see https://example.invalid/path/<redacted>@host/more");
  assert.equal(security.sanitizeTextForDisplay("https%3A%2F%2Fuser%3Apass%40example.invalid%2Fpath"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("https%3A%2F%2Fuser%ZZ%3Apass%40example.invalid%2Fpath"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("https\\u003a\\u002f\\u002fuser\\u003apass\\u0040example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("https\\x3a\\x2f\\x2fuser\\x3apass\\x40example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("https\\u{3a}\\u{2f}\\u{2f}user\\u{3a}pass\\u{40}example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("https&colon;&sol;&sol;user&colon;pass&commat;example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("https&colon&sol&soluser&colonpass&commat;example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("https&#x3a;&#x2f;&#x2f;user&#x3a;pass&#x40;example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("https&#58&#47&#47user&#58pass&#64example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.containsSecretLikeContent("https://user:pass@example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("https%3A%2F%2Fuser%3Apass%40example.invalid%2Fpath"), true);
  assert.equal(security.containsSecretLikeContent("https%3A%2F%2Fuser%ZZ%3Apass%40example.invalid%2Fpath"), true);
  assert.equal(security.containsSecretLikeContent("https\\u003a\\u002f\\u002fuser\\u003apass\\u0040example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("https\\x3a\\x2f\\x2fuser\\x3apass\\x40example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("https\\u{3a}\\u{2f}\\u{2f}user\\u{3a}pass\\u{40}example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("https&colon;&sol;&sol;user&colon;pass&commat;example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("https&colon&sol&soluser&colonpass&commat;example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("https&#58&#47&#47user&#58pass&#64example.invalid/path"), true);
  assert.equal(security.sanitizeTextForDisplay("API&#95;KEY&#61;abcdefghijklmnop"), "API_KEY=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("api&hyphen;key&equals;abcdefghijklmnop"), "api-key=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("SECRET&equals;&quot;short word&quot;"), 'SECRET="<redacted>"');
  assert.equal(security.sanitizeTextForDisplay("TOKEN%ZZ%3Aabcdefghijklmnop"), "TOKEN:<redacted>");
  assert.equal(security.sanitizeTextForDisplay("ＡＰＩ＿ＫＥＹ＝abcdefghijklmnop"), "API_KEY=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("https：／／user：pass＠example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("TOK\u200bEN=abcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(
    security.sanitizeTextForDisplay("https%255Cu003a%2526%252347%25EF%25BC%258Fuser%25EF%25BC%259Apass%2526%252364example.invalid%25EF%25BC%258Fpath SECRET%ZZ%3A＂abcdefghijklmnop&quot"),
    'https://<redacted>@example.invalid/path SECRET:"<redacted>"',
  );
  assert.equal(security.sanitizeTextForDisplay("https\\072\\057\\057user\\072pass\\100example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("https\\58\\47\\47user\\58pass\\64example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("ｈｔｔｐｓ％３Ａ％２Ｆ％２Ｆuser％３Ａpass％４０example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("TOKEN%_%3Aabcdefghijklmnop"), "TOKEN:<redacted>");
  assert.equal(security.sanitizeTextForDisplay("API\\137KEY\\075abcdefghijklmnop"), "API_KEY=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("https\\3a\\2f\\2fuser\\3apass\\40example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("API\\00005fKEY\\00003dabcdefghijklmnop"), "API_KEY=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("\\54 OKEN\\3a abcdefghijklmnop"), "TOKEN:<redacted>");
  assert.equal(security.sanitizeTextForDisplay("https\\3a\\2f\\2f\\75 ser\\3a\\70 ass\\40example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("Bearer\\20 abcdefghijklmnop"), "Bearer <redacted>");
  assert.equal(security.sanitizeTextForDisplay("&#84;&#79;&#75;&#69;&#78;&#61;abcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("&#x54;&#x4f;&#x4b;&#x45;&#x4e;&#x3d;abcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;user&#58;pass&#64;example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("\\84\\79\\75\\69\\78\\61abcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("\\104\\116\\116\\112\\115\\58\\47\\47user\\58pass\\64example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("\\124\\117\\113\\105\\116\\075abcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("\\150\\164\\164\\160\\163\\072\\057\\057user\\072pass\\100example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("T\u0338OKEN=abcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("h\u0338t\u0338t\u0338p\u0338s://user:pass@example.invalid/path"), "https://<redacted>@example.invalid/path");
  assert.equal(security.sanitizeTextForDisplay("\\U00000054\\U0000004F\\U0000004B\\U00000045\\U0000004E\\U0000003Dabcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("%u0054%u004F%u004B%u0045%u004E%u003Dabcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("&amp;#84;&amp;#79;&amp;#75;&amp;#69;&amp;#78;&amp;#61;abcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("\\54\\4f\\4b\\45\\4e\\3d abcdefghijklmnop"), "TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay("https\\3a\\2f\\2fuser\\3apass\\40example\\2einvalid\\2fpath CREDENTIAL\\3dabcdefghijklmnop"), "https://<redacted>@example.invalid/path CREDENTIAL=<redacted>");
  assert.doesNotMatch(security.sanitizeTextForDisplay("https\\3a\\2f\\2fuser\\3apass\\40example\\2einvalid\\2fpath PRIVATE\\5fKEY\\3dabcdefghijklmnop"), /user|pass|abcdefghijklmnop/);
  assert.doesNotMatch(security.sanitizeTextForDisplay("https://user:pass example.invalid/path"), /user|pass/);
  assert.equal(security.sanitizeTextForDisplay('{"TOKEN=abcdefghijklmnop":"short"}'), '{\n  "TOKEN=<redacted>": "short"\n}');
  assert.equal(security.sanitizeTextForDisplay("\\42 \\65 \\61\\72 \\65\\72\\20\\57\\6b CREDENTIAL\\3aabcdefghijklmnop"), "Bearer <redacted>");
  assert.equal(security.sanitizeTextForDisplay("TOKEN='abcdefghijklmnop AUTH_TOKEN:'qrstuvwxyzabcdef'"), "TOKEN='<redacted> AUTH_TOKEN:'<redacted>'");
  assert.doesNotMatch(security.sanitizeTextForDisplay('SECRET:"abcdefghijklmnop TOKEN="qrstuvwxyzabcdef"'), /abcdefghijklmnop|qrstuvwxyzabcdef/);
  assert.doesNotMatch(security.sanitizeTextForDisplay('TOKEN="abcdefghijklmnop"TOKEN="qrstuvwxyzabcdef"'), /abcdefghijklmnop|qrstuvwxyzabcdef/);
  assert.equal(security.sanitizeTextForDisplay("Bearer abcdefghijklmnop qrstuvwxyzabcdef"), "Bearer <redacted>");
  assert.equal(security.sanitizeTextForDisplay("Bearer abcdefghijklbearer-token:'qrstuvwxyzabcdef'"), "Bearer <redacted>");
  assert.equal(security.sanitizeTextForDisplay("pathBearer abcdefghijklmnop"), "pathBearer <redacted>");
  assert.equal(security.sanitizeTextForDisplay("`Bearer abcdefghijklmnop`"), "`Bearer <redacted>`");
  assert.equal(security.sanitizeTextForDisplay("(Bearer abcdefghijklmnop)"), "(Bearer <redacted>)");
  assert.equal(security.sanitizeTextForDisplay("keyboard=shortcuts"), "keyboard=shortcuts");
  assert.equal(security.sanitizeTextForDisplay("author=Alice"), "author=Alice");
  assert.equal(security.sanitizeTextForDisplay("private: false"), "private: false");
  assert.equal(security.sanitizeTextForDisplay('{"author":"Alice","authoredBy":"Bob","private":false}'), '{\n  "author": "Alice",\n  "authoredBy": "Bob",\n  "private": false\n}');
  assert.equal(security.sanitizeTextForDisplay("Use AWS_SECRET_ACCESS_KEY from the environment"), "Use AWS_SECRET_ACCESS_KEY from the environment");
  assert.equal(security.sanitizeTextForDisplay("AUTH_TOKEN=abcdefghijklmnop"), "AUTH_TOKEN=<redacted>");
  assert.equal(security.sanitizeTextForDisplay('{"accessToken":"short value","clientSecret":"another value","dbPassword":"pw"}'), '{\n  "accessToken": "<redacted>",\n  "clientSecret": "<redacted>",\n  "dbPassword": "<redacted>"\n}');
  assert.equal(security.sanitizeTextForDisplay("--api-key sk-abcdefghijklmnop"), "--api-key <redacted>");
  assert.equal(security.sanitizeTextForDisplay("tool --token abcdefghijklmnop --safe next"), "tool --token <redacted> --safe next");
  assert.equal(security.sanitizeTextForDisplay("tool --api-key $AWS_SECRET_ACCESS_KEY"), "tool --api-key $AWS_SECRET_ACCESS_KEY");
  assert.equal(security.sanitizeTextForDisplay("Authorization: Basic dXNlcjpwYXNz"), "Authorization: Basic <redacted>");
  assert.equal(security.sanitizeTextForDisplay("token sk-abcdefghijklmnop done"), "token <redacted token> done");
  assert.equal(security.sanitizeTextForDisplay("ghp_abcdefghijklmnopqrst"), "<redacted token>");
  assert.equal(security.sanitizeTextForDisplay("-----BEGIN PRIVATE KEY-----\nabc123"), "<redacted private key>");
  assert.equal(security.sanitizeTextForDisplay('"token: abcdefghijklmnop" done'), '"token: <redacted>" done');
  assert.equal(security.sanitizeTextForDisplay('curl -H "Authorization: Bearer abcdefghijklmnop" https://example.invalid'), 'curl -H "Authorization: Bearer <redacted>" https://example.invalid');
  assert.equal(security.sanitizeTextForDisplay('{"monkey":"banana"}'), '{\n  "monkey": "banana"\n}');
  assert.equal(security.containsSecretLikeContent("API&#95;KEY&#61;abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("api&hyphen;key&equals;abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("SECRET&equals;&quot;short word&quot;"), true);
  assert.equal(security.containsSecretLikeContent("TOKEN%ZZ%3Aabcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("ＡＰＩ＿ＫＥＹ＝abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("https：／／user：pass＠example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("TOK\u200bEN=abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("https%255Cu003a%2526%252347%25EF%25BC%258Fuser%25EF%25BC%259Apass%2526%252364example.invalid%25EF%25BC%258Fpath SECRET%ZZ%3A＂abcdefghijklmnop&quot"), true);
  assert.equal(security.containsSecretLikeContent("https\\072\\057\\057user\\072pass\\100example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("https\\58\\47\\47user\\58pass\\64example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("ｈｔｔｐｓ％３Ａ％２Ｆ％２Ｆuser％３Ａpass％４０example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("TOKEN%_%3Aabcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("API\\137KEY\\075abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("https\\3a\\2f\\2fuser\\3apass\\40example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("API\\00005fKEY\\00003dabcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("\\54 OKEN\\3a abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("https\\3a\\2f\\2f\\75 ser\\3a\\70 ass\\40example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("Bearer\\20 abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("&#84;&#79;&#75;&#69;&#78;&#61;abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("&#x54;&#x4f;&#x4b;&#x45;&#x4e;&#x3d;abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;user&#58;pass&#64;example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("\\84\\79\\75\\69\\78\\61abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("\\104\\116\\116\\112\\115\\58\\47\\47user\\58pass\\64example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("\\124\\117\\113\\105\\116\\075abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("\\150\\164\\164\\160\\163\\072\\057\\057user\\072pass\\100example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("T\u0338OKEN=abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("h\u0338t\u0338t\u0338p\u0338s://user:pass@example.invalid/path"), true);
  assert.equal(security.containsSecretLikeContent("\\U00000054\\U0000004F\\U0000004B\\U00000045\\U0000004E\\U0000003Dabcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("%u0054%u004F%u004B%u0045%u004E%u003Dabcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("&amp;#84;&amp;#79;&amp;#75;&amp;#69;&amp;#78;&amp;#61;abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("\\54\\4f\\4b\\45\\4e\\3d abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("https\\3a\\2f\\2fuser\\3apass\\40example\\2einvalid\\2fpath CREDENTIAL\\3dabcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent({ "TOKEN=abcdefghijklmnop": "short" }), true);
  assert.equal(security.containsSecretLikeContent("\\42 \\65 \\61\\72 \\65\\72\\20\\57\\6b CREDENTIAL\\3aabcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("TOKEN='abcdefghijklmnop AUTH_TOKEN:'qrstuvwxyzabcdef'"), true);
  assert.equal(security.containsSecretLikeContent("`Bearer abcdefghijklmnop`"), true);
  assert.equal(security.containsSecretLikeContent("(Bearer abcdefghijklmnop)"), true);
  assert.equal(security.containsSecretLikeContent("keyboard=shortcuts"), false);
  assert.equal(security.containsSecretLikeContent("author=Alice"), false);
  assert.equal(security.containsSecretLikeContent("private: false"), false);
  assert.equal(security.containsSecretLikeContent({ author: "Alice", authoredBy: "Bob", private: false }), false);
  assert.equal(security.containsSecretLikeContent("SECRET_KEY"), false);
  assert.equal(security.containsSecretLikeContent("Use AWS_SECRET_ACCESS_KEY from the environment"), false);
  assert.equal(security.containsSecretLikeContent("AUTH_TOKEN=abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent({ accessToken: "short", refreshToken: "short", secretKey: "short", dbPassword: "short" }), true);
  assert.equal(security.containsSecretLikeContent("--api-key sk-abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("tool --token abcdefghijklmnop --safe next"), true);
  assert.equal(security.containsSecretLikeContent("tool --api-key $AWS_SECRET_ACCESS_KEY"), false);
  assert.equal(security.containsSecretLikeContent("Authorization: Basic dXNlcjpwYXNz"), true);
  assert.equal(security.containsSecretLikeContent("token sk-abcdefghijklmnop done"), true);
  assert.equal(security.containsSecretLikeContent("ghp_abcdefghijklmnopqrst"), true);
  assert.equal(security.containsSecretLikeContent("-----BEGIN PRIVATE KEY-----\nabc123"), true);
  assert.equal(security.containsSecretLikeContent('"token: abcdefghijklmnop" done'), true);
  assert.equal(security.containsSecretLikeContent({ monkey: "banana" }), false);
  assert.equal(security.containsSecretLikeContent({ "ＴＯＫＥＮ": "short" }), true);
  assert.equal(security.containsSecretLikeContent({ "TO\u200bKEN": "short" }), true);
  assert.equal(security.containsSecretLikeContent({ "api&hyphen;key": "short" }), true);
  assert.equal(security.containsSecretLikeContent("РАSSWORD=actual_credential_value_1234567890"), true);
  assert.equal(security.containsSecretLikeContent("АUTH=real_bearer_token_abcdefghijklmnop"), true);
  assert.equal(security.containsSecretLikeContent("СREDENTIAL=non_obvious_secret_abcdefgh12345"), true);
  assert.equal(security.containsSecretLikeContent("АРІ_КЕY=secret_value"), true);
  assert.equal(security.containsSecretLikeContent("SЕCRET=sneaky_value_that_looks_normal"), true);
  assert.equal(security.containsSecretLikeContent("ΑΡΙ_ΚΕΥ=sneaky_greek_homoglyph_value"), true);
  assert.equal(security.containsSecretLikeContent("ΤΟΚΕΝ=greek_token_bypass_test"), true);
  assert.equal(security.containsSecretLikeContent("ΡΑSSWΟRD=mixed_cyrillic_greek_latin"), true);
  assert.equal(security.containsSecretLikeContent({ "РАSSWORD": "short" }), true);
  assert.equal(security.containsSecretLikeContent({ "ΤΟΚΕΝ": "short" }), true);
  assert.deepEqual(security.redactSecretLikeValue({ "ＴＯＫＥＮ": "short", safe: "value" }), { "ＴＯＫＥＮ": "<redacted>", safe: "value" });
  assert.deepEqual(security.redactSecretLikeValue({ "TO\u200bKEN": "short" }), { "TO\u200bKEN": "<redacted>" });

  const shared = { value: "opaque" };
  assert.deepEqual(security.redactSecretLikeValue({ safe: shared, token: shared }), {
    safe: "<redacted>",
    token: { value: "<redacted>" },
  });
});

test("tool outputs redact secret-looking upstream text", async () => {
  const smartSearchHarness = createHarness({
    fetchHandler: async () => jsonResponse({
      results: [{ title: "API_KEY=abcdefghijklmnop", narrative: "TOKEN=qrstuvwxyzabcdef", type: "fact" }],
    }),
  });
  try {
    const result = await smartSearchHarness.callTool("memory_search", { query: "legacy secret", limit: 1 });
    const text = textContent(result);
    assert.match(text, /API_KEY=<redacted>/);
    assert.match(text, /TOKEN=<redacted>/);
    assert.doesNotMatch(text, /abcdefghijklmnop|qrstuvwxyzabcdef/);
    assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnop|qrstuvwxyzabcdef/);
  } finally {
    smartSearchHarness.cleanup();
  }

  const searchUrlHarness = createHarness({
    fetchHandler: async () => jsonResponse({
      results: [{ title: "See https://user:pass@example.invalid/path", narrative: "safe", type: "fact" }],
    }),
  });
  try {
    const result = await searchUrlHarness.callTool("memory_search", { query: "legacy url", limit: 1 });
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/path/);
    assert.doesNotMatch(JSON.stringify(result), /user|pass/);
  } finally {
    searchUrlHarness.cleanup();
  }

  const mcpHarness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "SECRET=abcdefghijklmnop" }] }),
  });
  try {
    const result = await mcpHarness.callTool("memory_smart_search", { query: "legacy secret" });
    assert.equal(textContent(result), "SECRET=<redacted>");
    assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnop/);
  } finally {
    mcpHarness.cleanup();
  }

  const quotedMcpHarness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: 'SECRET="short word"' }] }),
  });
  try {
    const result = await quotedMcpHarness.callTool("memory_smart_search", { query: "legacy secret" });
    assert.equal(textContent(result), 'SECRET="<redacted>"');
    assert.doesNotMatch(JSON.stringify(result), /short word/);
  } finally {
    quotedMcpHarness.cleanup();
  }

  const escapedQuoteHarness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: 'SECRET="abc\\" def ghi"' }] }),
  });
  try {
    const result = await escapedQuoteHarness.callTool("memory_smart_search", { query: "legacy secret" });
    assert.equal(textContent(result), 'SECRET="<redacted>"');
    assert.doesNotMatch(JSON.stringify(result), /abc|def|ghi/);
  } finally {
    escapedQuoteHarness.cleanup();
  }

  const unquotedRemainderHarness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "SECRET=abc def ghi" }] }),
  });
  try {
    const result = await unquotedRemainderHarness.callTool("memory_smart_search", { query: "legacy secret" });
    assert.equal(textContent(result), "SECRET=<redacted>");
    assert.doesNotMatch(JSON.stringify(result), /abc|def|ghi/);
  } finally {
    unquotedRemainderHarness.cleanup();
  }

  const jsonStringMcpHarness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: '[{"token":"short value","url":"https://user:pass@example.invalid/path"}]' }] }),
  });
  try {
    const result = await jsonStringMcpHarness.callTool("memory_smart_search", { query: "legacy secret" });
    assert.match(textContent(result), /"token": "<redacted>"/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/path/);
    assert.doesNotMatch(JSON.stringify(result), /short value|user|pass/);
  } finally {
    jsonStringMcpHarness.cleanup();
  }

  const urlMcpHarness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "see https://user:pass@example.invalid/path and //user:pass@example.invalid/other and https%3A%2F%2Fuser%3Apass%40example.invalid%2Fencoded and https%3A%2F%2Fuser%ZZ%3Apass%40example.invalid%2Fmalformed and https\\u003a\\u002f\\u002fuser\\u003apass\\u0040example.invalid/unicode and https\\x3a\\x2f\\x2fuser\\x3apass\\x40example.invalid/hex and https\\u{3a}\\u{2f}\\u{2f}user\\u{3a}pass\\u{40}example.invalid/codepoint and https&colon;&sol;&sol;user&colon;pass&commat;example.invalid/entity and https&colon&sol&soluser&colonpass&commat;example.invalid/entity-nosmi and https&#58&#47&#47user&#58pass&#64example.invalid/decimal-nosmi and https%5Cx3a%5Cx2f%5Cx2fuser%5Cx3apass%5Cx40example.invalid/percent-hex" }] }),
  });
  try {
    const result = await urlMcpHarness.callTool("memory_smart_search", { query: "legacy url" });
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/path/);
    assert.match(textContent(result), /\/\/<redacted>@example.invalid\/other/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/encoded/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/malformed/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/unicode/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/hex/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/codepoint/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/entity/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/entity-nosmi/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/decimal-nosmi/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/percent-hex/);
    assert.doesNotMatch(JSON.stringify(result), /user|pass|%ZZ|u003a|u002f|u0040|x3a|x2f|x40|u\{|&colon|&sol|&commat|&#58|&#47|&#64/);
  } finally {
    urlMcpHarness.cleanup();
  }

  const structuredMcpHarness = createHarness({
    fetchHandler: async () => jsonResponse({ isError: true, meta: { "api–key": "short", url: "https://user:pass@example.invalid/path" } }),
  });
  try {
    const result = await structuredMcpHarness.callTool("memory_smart_search", { query: "legacy secret" });
    assert.match(textContent(result), /"api–key": "<redacted>"/);
    assert.match(textContent(result), /https:\/\/<redacted>@example.invalid\/path/);
    assert.doesNotMatch(JSON.stringify(result), /short|user|pass/);
  } finally {
    structuredMcpHarness.cleanup();
  }
});

test("memory_file_history maps file arrays to upstream comma-separated input", async () => {
  const harness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "history ok" }] }),
  });
  try {
    await harness.callTool("memory_file_history", { files: ["a.ts", "b.ts"], sessionId: "current" });
    assert.deepEqual(parseBody(harness.fetchCalls[0]), {
      name: "memory_file_history",
      arguments: { files: "a.ts,b.ts", sessionId: "current" },
    });
  } finally {
    harness.cleanup();
  }
});

test("memory_save refuses secret-looking content before network calls", async () => {
  for (const content of [
    "API_KEY=abcdefghijklmnop",
    "https://user:pass@example.invalid/path",
    "https%3A%2F%2Fuser%3Apass%40example.invalid%2Fpath",
    "https%3A%2F%2Fuser%ZZ%3Apass%40example.invalid%2Fpath",
    "https\\u003a\\u002f\\u002fuser\\u003apass\\u0040example.invalid/path",
    "https\\x3a\\x2f\\x2fuser\\x3apass\\x40example.invalid/path",
    "https\\u{3a}\\u{2f}\\u{2f}user\\u{3a}pass\\u{40}example.invalid/path",
    "https&colon;&sol;&sol;user&colon;pass&commat;example.invalid/path",
    "https&colon&sol&soluser&colonpass&commat;example.invalid/path",
    "https&#58&#47&#47user&#58pass&#64example.invalid/path",
    "https%5Cx3a%5Cx2f%5Cx2fuser%5Cx3apass%5Cx40example.invalid/path",
    "API&#95;KEY&#61;abcdefghijklmnop",
    "api&hyphen;key&equals;abcdefghijklmnop",
    "SECRET&equals;&quot;short word&quot;",
    "TOKEN%ZZ%3Aabcdefghijklmnop",
    "ＡＰＩ＿ＫＥＹ＝abcdefghijklmnop",
    "РАSSWORD=actual_credential_value_1234567890",
    "АUTH=real_bearer_token_abcdefghijklmnop",
    "СREDENTIAL=non_obvious_secret_abcdefgh12345",
    "АРІ_КЕY=secret_value",
    "SЕCRET=sneaky_value_that_looks_normal",
    "ΑΡΙ_ΚΕΥ=sneaky_greek_homoglyph_value",
    "ΤΟΚΕΝ=greek_token_bypass_test",
    "ΡΑSSWΟRD=mixed_cyrillic_greek_latin",
    "https：／／user：pass＠example.invalid/path",
    "TOK\u200bEN=abcdefghijklmnop",
    "https%255Cu003a%2526%252347%25EF%25BC%258Fuser%25EF%25BC%259Apass%2526%252364example.invalid%25EF%25BC%258Fpath SECRET%ZZ%3A＂abcdefghijklmnop&quot",
    "https\\072\\057\\057user\\072pass\\100example.invalid/path",
    "https\\58\\47\\47user\\58pass\\64example.invalid/path",
    "ｈｔｔｐｓ％３Ａ％２Ｆ％２Ｆuser％３Ａpass％４０example.invalid/path",
    "TOKEN%_%3Aabcdefghijklmnop",
    "API\\137KEY\\075abcdefghijklmnop",
    "https\\3a\\2f\\2fuser\\3apass\\40example.invalid/path",
    "https\\00003a\\00002f\\00002fuser\\00003apass\\000040example.invalid/path",
    "API\\00005fKEY\\00003dabcdefghijklmnop",
    "SECRET\\00003a\\000022short word\\000022",
    "\\54 OKEN\\3a abcdefghijklmnop",
    "https\\3a\\2f\\2f\\75 ser\\3a\\70 ass\\40example.invalid/path",
    "Bearer\\20 abcdefghijklmnop",
    "&#84;&#79;&#75;&#69;&#78;&#61;abcdefghijklmnop",
    "&#x54;&#x4f;&#x4b;&#x45;&#x4e;&#x3d;abcdefghijklmnop",
    "&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;user&#58;pass&#64;example.invalid/path",
    "\\84\\79\\75\\69\\78\\61abcdefghijklmnop",
    "\\104\\116\\116\\112\\115\\58\\47\\47user\\58pass\\64example.invalid/path",
    "\\124\\117\\113\\105\\116\\075abcdefghijklmnop",
    "\\150\\164\\164\\160\\163\\072\\057\\057user\\072pass\\100example.invalid/path",
    "T\u0338OKEN=abcdefghijklmnop",
    "h\u0338t\u0338t\u0338p\u0338s://user:pass@example.invalid/path",
    "\\U00000054\\U0000004F\\U0000004B\\U00000045\\U0000004E\\U0000003Dabcdefghijklmnop",
    "%u0054%u004F%u004B%u0045%u004E%u003Dabcdefghijklmnop",
    "&amp;#84;&amp;#79;&amp;#75;&amp;#69;&amp;#78;&amp;#61;abcdefghijklmnop",
    "\\54\\4f\\4b\\45\\4e\\3d abcdefghijklmnop",
    "https\\3a\\2f\\2fuser\\3apass\\40example\\2einvalid\\2fpath CREDENTIAL\\3dabcdefghijklmnop",
    "--api-key sk-abcdefghijklmnop",
    "tool --token abcdefghijklmnop --safe next",
    "Authorization: Basic dXNlcjpwYXNz",
    "token sk-abcdefghijklmnop done",
    "ghp_abcdefghijklmnopqrst",
    "-----BEGIN PRIVATE KEY-----\nabc123",
  ]) {
    const harness = createHarness({
      fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "unexpected" }] }),
    });
    try {
      const result = await harness.callTool("memory_save", { content, type: "fact" });
      assert.match(textContent(result), /Refusing to save memory/);
      assert.equal(harness.fetchCalls.length, 0);
    } finally {
      harness.cleanup();
    }
  }
});

test("PI_AGENTMEMORY_SECURITY_ENABLED=0 disables save guard and display redaction", async () => {
  const rawSecret = "API_KEY=abcdefghijklmnop";
  const harness = createHarness({
    env: { PI_AGENTMEMORY_SECURITY_ENABLED: "0" },
    fetchHandler: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.name === "memory_smart_search") return jsonResponse({ content: [{ type: "text", text: rawSecret }] });
      if (body.name === "memory_save") return jsonResponse({ content: [{ type: "text", text: "saved" }] });
      return jsonResponse({ content: [{ type: "text", text: "unexpected" }] });
    },
  });
  try {
    const searchResult = await harness.callTool("memory_smart_search", { query: rawSecret });
    assert.equal(textContent(searchResult), rawSecret);
    assert.equal(parseBody(harness.fetchCalls[0]).arguments.query, rawSecret);

    const saveResult = await harness.callTool("memory_save", { content: rawSecret, type: "fact" });
    assert.equal(textContent(saveResult), "Saved memory (fact).");
    assert.equal(parseBody(harness.fetchCalls[1]).arguments.content, rawSecret);
  } finally {
    harness.cleanup();
  }
});

test("memory_save refuses JSON-style secret-looking content", async () => {
  for (const content of [
    '{"API_KEY":"abcdefghijklmnop"}',
    '{"token":["abcdefghijklmnop"]}',
    '{"token":{"value":"abcdefghijklmnop"}}',
    '{"api–key":"abcdefghijklmnop"}',
    '{"TOKEN=abcdefghijklmnop":"short"}',
    '{"accessToken":"short","clientSecret":"short","dbPassword":"short"}',
    'API_KEY="short word"',
    "SECRET='short word'",
    [{ "api–key": "abcdefghijklmnop" }],
  ]) {
    const harness = createHarness({
      fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "unexpected" }] }),
    });
    try {
      const result = await harness.callTool("memory_save", { content, type: "fact" });
      assert.match(textContent(result), /Refusing to save memory/);
      assert.equal(harness.fetchCalls.length, 0);
    } finally {
      harness.cleanup();
    }
  }
});

test("memory_save refuses unicode dash secret separators", async () => {
  for (const content of [
    "API_KEY–abcdefghijklmnop",
    "API_KEY—abcdefghijklmnop",
    "API_KEY‑abcdefghijklmnop",
  ]) {
    const harness = createHarness({
      fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "unexpected" }] }),
    });
    try {
      const result = await harness.callTool("memory_save", { content });
      assert.match(textContent(result), /Refusing to save memory/);
      assert.equal(harness.fetchCalls.length, 0);
    } finally {
      harness.cleanup();
    }
  }
});

test("memory_save refuses secret-looking metadata fields", async () => {
  for (const params of [
    { content: "safe durable fact", concepts: "API_KEY=abcdefghijklmnop" },
    { content: "safe durable fact", concepts: '{"api-key":"abcdefghijklmnop"}' },
    { content: "safe durable fact", concepts: { "api–key": "abcdefghijklmnop" } },
    { content: "safe durable fact", concepts: { "ＴＯＫＥＮ": "short" } },
    { content: "safe durable fact", concepts: { "TO\u200bKEN": "short" } },
    { content: "safe durable fact", concepts: { "api&hyphen;key": "short" } },
    { content: "safe durable fact", concepts: { "РАSSWORD": "short" } },
    { content: "safe durable fact", files: ["TOKEN=abcdefghijklmnop"] },
    { content: "safe durable fact", files: [{ nest: [{ my_SECRET_x: "abcdefghijklmnop" }] }] },
    { content: "safe durable fact", files: [{ nest: [{ my_SECRET_x: "short" }] }] },
    { content: "safe durable fact", project: "SECRET=abcdefghijklmnop" },
    { content: "safe durable fact", project: "my_SECRET=abcdefghijklmnop" },
    { content: "safe durable fact", project: '{"token":["abcdefghijklmnop"]}' },
  ]) {
    const harness = createHarness({
      fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "unexpected" }] }),
    });
    try {
      const result = await harness.callTool("memory_save", params);
      assert.match(textContent(result), /Refusing to save memory/);
      assert.equal(harness.fetchCalls.length, 0);
    } finally {
      harness.cleanup();
    }
  }
});

test("memory_save refuses invalid metadata before network calls", async () => {
  const circular = { safe: "metadata" };
  circular.self = circular;
  const circularArray = ["safe"];
  circularArray.push(circularArray);
  for (const params of [
    { content: "safe durable fact", concepts: circular },
    { content: "safe durable fact", concepts: circularArray },
    { content: "safe durable fact", files: ["safe.ts", { nested: "value" }] },
    { content: "safe durable fact", project: { name: "project" } },
    { content: "safe durable fact", type: "123" },
    { content: "safe durable fact", type: "null" },
    { content: "safe durable fact", concepts: ["valid", "42"] },
    { content: "safe durable fact", concepts: ["valid", "false"] },
    { content: "safe durable fact", files: ["/valid", "true", "/also-valid"] },
  ]) {
    const harness = createHarness({
      fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "unexpected" }] }),
    });
    try {
      const result = await harness.callTool("memory_save", params);
      assert.match(textContent(result), /metadata fields must be strings or string arrays/);
      assert.equal(harness.fetchCalls.length, 0);
    } finally {
      harness.cleanup();
    }
  }
});

test("agentmemory-status command is safe without UI", async () => {
  const harness = createHarness({
    fetchHandler: async () => { throw new Error("command should not fetch without UI"); },
  });
  try {
    const command = harness.commands.get("agentmemory-status");
    await command.handler("", { hasUI: false });
    assert.equal(harness.fetchCalls.length, 0);
  } finally {
    harness.cleanup();
  }
});

test("memory_health display and fetch URL redact configured URL secrets", async () => {
  const harness = createHarness({
    env: { AGENTMEMORY_URL: "https://user:pass@example.invalid:3111/path?token=abcdefghijklmnop#secret" },
    fetchHandler: async (url) => {
      assert.equal(url, "https://example.invalid:3111/path/agentmemory/health");
      throw new Error("offline");
    },
  });
  try {
    const result = await harness.callTool("memory_health");
    const text = textContent(result);
    assert.match(text, /https:\/\/example.invalid:3111\/path/);
    assert.doesNotMatch(text, /user|pass|token=|abcdefghijklmnop|#secret/);
  } finally {
    harness.cleanup();
  }

  const malformedHarness = createHarness({
    env: { AGENTMEMORY_URL: "not a url https://user:pass@example.invalid/path?token=abcdefghijklmnop#secret" },
    fetchHandler: async (url) => {
      assert.doesNotMatch(url, /user|pass|token=|abcdefghijklmnop|#secret/);
      throw new Error("offline");
    },
  });
  try {
    const result = await malformedHarness.callTool("memory_health");
    const text = textContent(result);
    assert.match(text, /not a url https:\/\/example.invalid\/path/);
    assert.doesNotMatch(text, /user|pass|token=|abcdefghijklmnop|#secret/);
  } finally {
    malformedHarness.cleanup();
  }

  const embeddedUrlHarness = createHarness({
    env: { AGENTMEMORY_URL: "http://outer.invalid/https://user:pass@example.invalid/path?token=abcdefghijklmnop#secret" },
    fetchHandler: async (url) => {
      assert.equal(url, "http://outer.invalid/https://example.invalid/path/agentmemory/health");
      assert.doesNotMatch(url, /user|pass|token=|abcdefghijklmnop|#secret/);
      throw new Error("offline");
    },
  });
  try {
    const result = await embeddedUrlHarness.callTool("memory_health");
    const text = textContent(result);
    assert.match(text, /http:\/\/outer.invalid\/https:\/\/example.invalid\/path/);
    assert.doesNotMatch(text, /user|pass|token=|abcdefghijklmnop|#secret/);
  } finally {
    embeddedUrlHarness.cleanup();
  }

  const maliciousHealthHarness = createHarness({
    fetchHandler: async () => jsonResponse({ status: "ok TOKEN=abcdefghijklmnop", version: "https\\x3a\\x2f\\x2fuser\\x3apass\\x40example.invalid/path" }),
  });
  try {
    const result = await maliciousHealthHarness.callTool("memory_health");
    const text = textContent(result);
    assert.match(text, /TOKEN=<redacted>/);
    assert.match(text, /https:\/\/<redacted>@example.invalid\/path/);
    assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnop|user|pass/);
  } finally {
    maliciousHealthHarness.cleanup();
  }

  const maliciousCommandHarness = createHarness({
    fetchHandler: async () => jsonResponse({ status: "ok TOKEN=abcdefghijklmnop", version: "https&colon&sol&soluser&colonpass&commat;example.invalid/path" }),
  });
  try {
    const command = maliciousCommandHarness.commands.get("agentmemory-status");
    await command.handler("", maliciousCommandHarness.ctx);
    assert.equal(maliciousCommandHarness.notifications.length, 1);
    const notification = maliciousCommandHarness.notifications[0].message;
    assert.match(notification, /TOKEN=<redacted>/);
    assert.match(notification, /https:\/\/<redacted>@example.invalid\/path/);
    assert.doesNotMatch(notification, /abcdefghijklmnop|user|pass/);
  } finally {
    maliciousCommandHarness.cleanup();
  }
});

test("memory_save success output omits saved content", async () => {
  const harness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "safe durable fact" }], id: "mem_1" }),
  });
  try {
    const result = await harness.callTool("memory_save", { content: "safe durable fact", type: "fact" });
    assert.equal(textContent(result), "Saved memory (fact).");
    assert.doesNotMatch(JSON.stringify(result), /safe durable fact/);

    const authorResult = await harness.callTool("memory_save", { content: "author=Alice", type: "fact" });
    assert.equal(textContent(authorResult), "Saved memory (fact).");
    assert.equal(parseBody(harness.fetchCalls[1]).arguments.content, "author=Alice");

    const privateResult = await harness.callTool("memory_save", { content: "private: false", type: "fact" });
    assert.equal(textContent(privateResult), "Saved memory (fact).");
    assert.equal(parseBody(harness.fetchCalls[2]).arguments.content, "private: false");
  } finally {
    harness.cleanup();
  }
});

test("memory_save trims metadata fields before upstream calls", async () => {
  const harness = createHarness({
    fetchHandler: async () => jsonResponse({ content: [{ type: "text", text: "saved" }] }),
  });
  try {
    const result = await harness.callTool("memory_save", {
      content: "safe durable fact",
      type: "  preference  ",
      concepts: [" durable ", " workflow ", "  "],
      files: [" src/index.ts ", " docs/adr.md "],
      project: "  agentmemory  ",
    });
    assert.equal(textContent(result), "Saved memory (preference).");
    assert.deepEqual(parseBody(harness.fetchCalls[0]).arguments, {
      content: "safe durable fact",
      type: "preference",
      concepts: "durable,workflow",
      files: "src/index.ts,docs/adr.md",
      project: "agentmemory",
    });
  } finally {
    harness.cleanup();
  }
});

test("memory_save falls back to legacy remember endpoint when MCP save is unavailable", async () => {
  const harness = createHarness({
    fetchHandler: async (url) => {
      if (url.endsWith("/agentmemory/mcp/call")) return jsonResponse({ error: "missing" }, { ok: false, status: 404 });
      if (url.endsWith("/agentmemory/remember")) return jsonResponse({ ok: true, id: "mem_1" });
      throw new Error(`unexpected ${url}`);
    },
  });
  try {
    const result = await harness.callTool("memory_save", { content: "Remember this durable preference", type: "preference" });
    assert.equal(textContent(result), "Saved memory (preference).");
    assert.doesNotMatch(JSON.stringify(result), /Remember this durable preference/);
    assert.equal(harness.fetchCalls.length, 2);
    assert.equal(parseBody(harness.fetchCalls[1]).content, "Remember this durable preference");
  } finally {
    harness.cleanup();
  }
});

test("before_agent_start prepends non-empty recall block", async () => {
  const harness = createHarness({
    fetchHandler: async (url, init) => {
      if (url.endsWith("/agentmemory/smart-search")) {
        assert.equal(JSON.parse(init.body).query, "What should I remember?");
        return jsonResponse({
          results: [{ title: "Prior decision", narrative: "Use Context Watcher first", type: "decision", combinedScore: 0.875 }],
        });
      }
      if (url.endsWith("/agentmemory/health")) return jsonResponse({ status: "healthy", version: "0.9.26" });
      throw new Error(`unexpected ${url}`);
    },
  });
  try {
    const result = await harness.emit("before_agent_start", {
      systemPrompt: "base",
      systemPromptOptions: { cwd: "/tmp/project" },
      prompt: "What should I remember?",
    });
    assert.match(result.systemPrompt, /^base\n\n/);
    assert.match(result.systemPrompt, /Relevant long-term memory from agentmemory:\n- Prior decision \(decision\) \[score=0\.875\]: Use Context Watcher first/);
    assert.equal(harness.fetchCalls.length, 2);
  } finally {
    harness.cleanup();
  }
});

test("agent_end observe uses tool_input/tool_output and redacts secret-looking values", async () => {
  const harness = createHarness({
    fetchHandler: async (url, init) => {
      if (url.endsWith("/agentmemory/health")) return jsonResponse({ status: "healthy", version: "0.9.24" });
      if (url.endsWith("/agentmemory/smart-search")) return jsonResponse({ results: [] });
      if (url.endsWith("/agentmemory/observe")) return jsonResponse({ ok: true, body: JSON.parse(init.body) }, { status: 201 });
      throw new Error(`unexpected ${url}`);
    },
  });
  try {
    await harness.emit("session_start");
    await harness.emit("before_agent_start", {
      systemPrompt: "base",
      systemPromptOptions: { cwd: "/tmp/project" },
      prompt: "Please review https://user:pass@example.invalid/path and use API_KEY=abcdefghijklmnop safely",
    });
    await harness.emit("agent_end", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "Used https://user:pass@example.invalid/path and Bearer abcdefghijklmnop carefully" }] }],
    });
    await new Promise((resolve) => setImmediate(resolve));

    const smartSearch = harness.fetchCalls.find((call) => call.url.endsWith("/agentmemory/smart-search"));
    assert.ok(smartSearch, "smart-search call should be made");
    assert.equal(parseBody(smartSearch).query, "Please review https://<redacted>@example.invalid/path and use API_KEY=<redacted>");

    const observe = harness.fetchCalls.find((call) => call.url.endsWith("/agentmemory/observe"));
    assert.ok(observe, "observe call should be made");
    const data = parseBody(observe).data;
    assert.equal(data.input, undefined);
    assert.equal(data.output, undefined);
    assert.equal(data.tool_input, "Please review https://<redacted>@example.invalid/path and use API_KEY=<redacted>");
    assert.equal(data.tool_output, "Used https://<redacted>@example.invalid/path and Bearer <redacted> carefully");
    assert.doesNotMatch(JSON.stringify(data), /user|pass|abcdefghijklmnop/);
  } finally {
    harness.cleanup();
  }
});

test("AGENTMEMORY_REQUIRE_HTTPS rejects plaintext bearer auth to non-loopback hosts", () => {
  assert.throws(
    () => createHarness({
      env: {
        AGENTMEMORY_URL: "http://example.com:3111",
        AGENTMEMORY_SECRET: "test",
        AGENTMEMORY_REQUIRE_HTTPS: "1",
      },
    }),
    /plaintext HTTP/,
  );
});

async function main() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(error.stack || error.message || error);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${tests.length} tests failed`);
    process.exit(1);
  }
  console.log(`${tests.length}/${tests.length} tests passed`);
}

main();
