import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import type { TestContext } from "node:test";
import { createCodexUsageCache } from "./codex-usage-cache.ts";
import type { CodexUsageCacheOptions, CodexUsageRecord } from "./codex-usage-cache.ts";

const NOW = 1_800_000_000_000;
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function token(payload: unknown): string {
  return `test.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test`;
}

async function resolveAuth(providerId: string) {
  return { auth: { apiKey: token({ "https://api.openai.com/auth": { chatgpt_account_id: `test-${providerId}` } }) } };
}

function usage(usedPercent = 25) {
  return {
    plan_type: "plus",
    rate_limit: {
      allowed: true,
      primary_window: { used_percent: usedPercent, reset_at: NOW / 1000 + 3600 },
      secondary_window: { used_percent: 50.5, reset_at: NOW / 1000 + 7200 },
    },
  };
}

function record(providerId = "codex-a", fetchedAt = NOW): CodexUsageRecord {
  return { providerId, planType: "plus", fetchedAt, allowed: true, primary: { remainingPercent: 75 } };
}

async function sandbox(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-usage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cachePath: path.join(root, "cache", "delegated-pi-loop", "codex-usage-v2.json") };
}

function cacheAt(cachePath: string, options: Partial<CodexUsageCacheOptions> = {}) {
  return createCodexUsageCache({
    cachePath,
    now: () => NOW,
    resolveAuth,
    fetch: async () => Response.json(usage()),
    ...options,
  });
}

async function seed(cachePath: string, entries: readonly unknown[]) {
  await mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  await writeFile(cachePath, JSON.stringify({ version: 2, entries }), { mode: 0o600 });
}

async function stored(cachePath: string): Promise<{ version: number; entries: CodexUsageRecord[] }> {
  return JSON.parse(await readFile(cachePath, "utf8"));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("valid usage uses only the fixed endpoint and required auth headers", async (t) => {
  const { cachePath } = await sandbox(t);
  const auth = await resolveAuth("codex-a");
  let calls = 0;
  const cache = await cacheAt(cachePath, {
    resolveAuth: async (providerId) => {
      assert.equal(providerId, "codex-a");
      return { ...auth, baseUrl: "https://not-used.invalid", headers: { "X-Untrusted": "not-used" } };
    },
    fetch: async (url, init) => {
      calls += 1;
      assert.equal(url, USAGE_URL);
      assert.equal(init?.redirect, "manual");
      assert.ok(init?.signal instanceof AbortSignal);
      assert.deepEqual(init.headers, {
        Authorization: `Bearer ${auth.auth.apiKey}`,
        "ChatGPT-Account-Id": "test-codex-a",
        "User-Agent": "codex-cli",
      });
      return Response.json(usage());
    },
  });
  assert.equal(calls, 0, "creation and snapshots must not fetch usage");
  assert.deepEqual(Object.keys(cache.getFreshSnapshot()), []);
  await cache.refresh({ candidateProviderIds: ["codex-a"] });
  assert.equal(calls, 1);
  assert.deepEqual(cache.getFreshSnapshot()["codex-a"], {
    providerId: "codex-a", planType: "plus", fetchedAt: NOW, allowed: true,
    primary: { remainingPercent: 75, resetAt: NOW / 1000 + 3600 },
    secondary: { remainingPercent: 49.5, resetAt: NOW / 1000 + 7200 },
  });
});

test("plan labels normalize from WHAM independently of provider IDs and round-trip through v2", async (t) => {
  const { cachePath } = await sandbox(t);
  let planType = "";
  const cache = await cacheAt(cachePath, { fetch: async () => Response.json({ ...usage(), plan_type: planType }) });
  const providers = ["openai-codex", "openai-codex-pro"];
  for (const [raw, normalized] of [
    [" ProLiTe ", "prolite"], ["PRO", "pro"], [" PLUS ", "plus"], ["Team", "team"],
    ["Pro-Lite", "pro-lite"], ["Pro_Lite", "pro_lite"], ["Future-Plan_2", "future-plan_2"],
    ["A".repeat(64), "a".repeat(64)],
  ]) {
    planType = raw;
    await cache.refresh({ forcedProviderIds: providers });
    const snapshot = cache.getFreshSnapshot();
    for (const providerId of providers) assert.equal(snapshot[providerId]?.planType, normalized);
    assert.deepEqual(await stored(cachePath), { version: 2, entries: providers.map((providerId) => snapshot[providerId]) });
    assert.deepEqual((await cacheAt(cachePath)).getFreshSnapshot(), snapshot);
  }
});

test("missing or malformed plan_type cannot publish a record or replace a previous plan", async (t) => {
  const { cachePath } = await sandbox(t);
  const previous = { ...record(), planType: "prolite" };
  await seed(cachePath, [previous]);
  let planType: unknown;
  const cache = await cacheAt(cachePath, {
    fetch: async () => Response.json({ ...usage(), plan_type: planType, planType: "prolite" }),
  });
  for (const value of [
    undefined, null, true, 42, {}, ["prolite"], "", "   ", "pro lite", "prolite\nplus", "prolite\u0000",
    "prolite!", "pro.lite", "prolite/plus", "123", "_prolite", "prólite", "synthetic@example.invalid",
    "https://example.invalid", "A".repeat(65), "prolite".padEnd(65),
  ]) {
    planType = value;
    await cache.refresh({ forcedProviderIds: ["codex-a", "openai-codex-pro"] });
    assert.deepEqual(Object.values(cache.getFreshSnapshot()), [previous]);
    assert.deepEqual((await stored(cachePath)).entries, [previous]);
  }
});

test("one-window payloads support either window, absent resets, and exhausted allowed records", async (t) => {
  const { cachePath } = await sandbox(t);
  let payload: unknown;
  const cache = await cacheAt(cachePath, { fetch: async () => Response.json(payload) });
  for (const [field, storedField] of [["primary_window", "primary"], ["secondary_window", "secondary"]] as const) {
    for (const usedPercent of [0, 100, 125]) {
      payload = { plan_type: "plus", rate_limit: { allowed: true, [field]: { used_percent: usedPercent } } };
      await cache.refresh({ forcedProviderIds: ["codex-a"] });
      assert.deepEqual(cache.getFreshSnapshot()["codex-a"], {
        providerId: "codex-a", planType: "plus", fetchedAt: NOW, allowed: true,
        [storedField]: { remainingPercent: Math.max(0, 100 - usedPercent) },
      });
    }
  }
  payload = { plan_type: "plus", rate_limit: { allowed: false, primary_window: { used_percent: 10 } } };
  await cache.refresh({ forcedProviderIds: ["codex-a"] });
  assert.equal(cache.getFreshSnapshot()["codex-a"]?.allowed, false);
});

test("malformed present windows and invalid rate limits preserve the previous record", async (t) => {
  const { cachePath } = await sandbox(t);
  const previous = record();
  await seed(cachePath, [previous]);
  const valid = { used_percent: 20 };
  const invalidWindows: unknown[] = [null, [], {}, "window", { used_percent: "20" }, { used_percent: -1 },
    { used_percent: null }, { used_percent: 10, reset_at: null }, { used_percent: 10, reset_at: 0 },
    { used_percent: 10, reset_at: -1 }, { used_percent: 10, reset_at: "1800000000" }];
  const payloads: unknown[] = [null, {}, [], { plan_type: "plus", rate_limit: null }, { plan_type: "plus", rate_limit: {} },
    { plan_type: "plus", rate_limit: { allowed: true } },
    { plan_type: "plus", rate_limit: { allowed: "true", primary_window: valid } }];
  for (const window of invalidWindows) {
    payloads.push({ plan_type: "plus", rate_limit: { allowed: true, primary_window: window, secondary_window: valid } });
    payloads.push({ plan_type: "plus", rate_limit: { allowed: true, primary_window: valid, secondary_window: window } });
  }
  let body = "";
  const cache = await cacheAt(cachePath, { fetch: async () => new Response(body) });
  for (const payload of payloads) {
    body = JSON.stringify(payload);
    await cache.refresh({ forcedProviderIds: ["codex-a"] });
    assert.deepEqual(cache.getFreshSnapshot()["codex-a"], previous);
  }
  for (const window of ['{"used_percent":1e400}', '{"used_percent":1,"reset_at":1e400}']) {
    body = `{"plan_type":"plus","rate_limit":{"allowed":true,"primary_window":${window}}}`;
    await cache.refresh({ forcedProviderIds: ["codex-a"] });
    assert.deepEqual(cache.getFreshSnapshot()["codex-a"], previous);
  }
  assert.deepEqual((await stored(cachePath)).entries, [previous]);
});

test("snapshots expire at one hour or the first recorded reset, without deleting stored entries", async (t) => {
  const { cachePath } = await sandbox(t);
  const entries = [
    record("ttl"),
    { ...record("primary"), primary: { remainingPercent: 0, resetAt: NOW / 1000 + 15 }, secondary: { remainingPercent: 90 } },
    { ...record("secondary"), secondary: { remainingPercent: 10, resetAt: NOW / 1000 + 20 } },
    { ...record("past-reset"), primary: { remainingPercent: 100, resetAt: NOW / 1000 } },
    record("future", NOW + 4_000_000),
  ];
  await seed(cachePath, entries);
  let timestamp = NOW;
  const cache = await cacheAt(cachePath, { now: () => timestamp });
  assert.deepEqual(Object.keys(cache.getFreshSnapshot()), ["ttl", "primary", "secondary"]);
  timestamp = NOW + 14_999;
  assert.ok(cache.getFreshSnapshot().primary);
  timestamp += 1;
  assert.equal(cache.getFreshSnapshot().primary, undefined);
  assert.ok(cache.getFreshSnapshot().secondary);
  timestamp = NOW + 20_000;
  assert.equal(cache.getFreshSnapshot().secondary, undefined);
  timestamp = NOW + 3_599_999;
  assert.ok(cache.getFreshSnapshot().ttl);
  timestamp += 1;
  assert.deepEqual(Object.keys(cache.getFreshSnapshot()), []);
  assert.deepEqual((await stored(cachePath)).entries, entries);
});

test("missing, malformed, and unsupported cache files load as empty", async (t) => {
  const { cachePath } = await sandbox(t);
  assert.deepEqual(Object.keys((await cacheAt(cachePath)).getFreshSnapshot()), []);
  await mkdir(path.dirname(cachePath), { recursive: true });
  const legacyRecord = { providerId: "codex-a", fetchedAt: NOW, allowed: true, primary: { remainingPercent: 75 } };
  const malformed = [
    "{", "null", "[]", JSON.stringify({ version: 1, entries: [legacyRecord] }),
    JSON.stringify({ version: 1, entries: [record()] }), JSON.stringify({ version: 3, entries: [record()] }),
    JSON.stringify({ entries: [record()] }), JSON.stringify({ version: 2, entries: {} }),
    ...[undefined, null, 42, {}, ["plus"], "", "ProLite", " plus ", "plus\n", "pro lite", "prolite!", "a".repeat(65)]
      .map((planType) => JSON.stringify({ version: 2, entries: [record("valid"), { ...record(), planType }] })),
    ...[null, {}, { ...record(), fetchedAt: "now" }, { ...record(), fetchedAt: -1 },
      { ...record(), allowed: 1 }, { ...record(), providerId: "" },
      { ...record(), primary: null }, { ...record(), secondary: {} },
      { ...record(), primary: { remainingPercent: 101 } },
      { ...record(), primary: { remainingPercent: -1 } },
      { ...record(), primary: { remainingPercent: 10, resetAt: 0 } },
    ].map((entry) => JSON.stringify({ version: 2, entries: [record("valid"), entry] })),
  ];
  for (const content of malformed) {
    await writeFile(cachePath, content);
    assert.deepEqual(Object.keys((await cacheAt(cachePath)).getFreshSnapshot()), []);
    assert.equal(await readFile(cachePath, "utf8"), content, "loading must not delete or rewrite rejected documents");
  }
  assert.deepEqual(Object.keys((await cacheAt(path.dirname(cachePath))).getFreshSnapshot()), []);
});

test("loading happens once and snapshots are deeply immutable and detached from later updates", async (t) => {
  const { cachePath } = await sandbox(t);
  await seed(cachePath, [record()]);
  const cache = await cacheAt(cachePath);
  const snapshot = cache.getFreshSnapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot["codex-a"]));
  assert.ok(Object.isFrozen(snapshot["codex-a"]?.primary));
  assert.throws(() => Object.assign(snapshot, { other: record() }), TypeError);
  assert.throws(() => Object.assign(snapshot["codex-a"]!, { allowed: false }), TypeError);
  assert.throws(() => Object.assign(snapshot["codex-a"]!, { planType: "prolite" }), TypeError);
  assert.throws(() => Object.assign(snapshot["codex-a"]!.primary!, { remainingPercent: 1 }), TypeError);
  await seed(cachePath, [record("external")]);
  assert.deepEqual(Object.keys(cache.getFreshSnapshot()), ["codex-a"]);
  await cache.refresh({ forcedProviderIds: ["codex-b"] });
  assert.deepEqual(Object.keys(cache.getFreshSnapshot()), ["codex-a", "codex-b"]);
  assert.deepEqual(Object.keys(snapshot), ["codex-a"]);
  assert.equal(cache.getFreshSnapshot().toString, undefined);
});

test("default paths honor the agent directory and fall back to the home directory", async (t) => {
  const { root } = await sandbox(t);
  const previous = process.env.PI_CODING_AGENT_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  t.mock.method(os, "homedir", () => root);
  for (const directory of [path.join(root, "override"), undefined, ""]) {
    if (directory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = directory;
    const expected = path.join(directory || path.join(root, ".pi", "agent"), "cache", "delegated-pi-loop", "codex-usage-v2.json");
    const legacyPath = path.join(path.dirname(expected), "codex-usage-v1.json");
    const legacyRecord = { providerId: "legacy", fetchedAt: NOW, allowed: true, primary: { remainingPercent: 75 } };
    const legacy = JSON.stringify({ version: 1, entries: [legacyRecord] });
    await mkdir(path.dirname(expected), { recursive: true });
    await writeFile(legacyPath, legacy);
    const cache = await createCodexUsageCache({ now: () => NOW, resolveAuth, fetch: async () => Response.json(usage()) });
    assert.equal(cache.getFreshSnapshot().legacy, undefined, "v1 must not seed the new cache");
    await cache.refresh({ candidateProviderIds: ["codex-a"] });
    assert.equal((await stored(expected)).version, 2);
    assert.deepEqual((await stored(expected)).entries.map((entry) => entry.providerId), ["codex-a"]);
    assert.equal(await readFile(legacyPath, "utf8"), legacy, "the v1 file must remain untouched");
  }
});

test("persistence creates private paths and atomically replaces the cache without temporary leftovers", async (t) => {
  const { root, cachePath } = await sandbox(t);
  const cache = await cacheAt(cachePath);
  await cache.refresh({ candidateProviderIds: ["codex-a"] });
  assert.equal((await stat(path.join(root, "cache"))).mode & 0o777, 0o700);
  assert.equal((await stat(path.dirname(cachePath))).mode & 0o777, 0o700);
  assert.equal((await stat(cachePath)).mode & 0o777, 0o600);
  const original = await readFile(cachePath, "utf8");
  const oldHandle = await open(cachePath, "r");
  try {
    await chmod(path.dirname(cachePath), 0o755);
    await chmod(cachePath, 0o644);
    await cache.refresh({ forcedProviderIds: ["codex-b"] });
    assert.notEqual((await stat(cachePath)).ino, (await oldHandle.stat()).ino);
    assert.equal(await oldHandle.readFile("utf8"), original, "an open reader keeps the complete previous file");
  } finally {
    await oldHandle.close();
  }
  assert.equal((await stat(path.dirname(cachePath))).mode & 0o777, 0o700);
  assert.equal((await stat(cachePath)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(path.dirname(cachePath)), [path.basename(cachePath)]);
  assert.deepEqual((await stored(cachePath)).entries.map((entry) => entry.providerId), ["codex-a", "codex-b"]);
});

test("forced providers always refresh and ordinary candidates refresh only when missing or stale", async (t) => {
  const { cachePath } = await sandbox(t);
  await seed(cachePath, [record("fresh"), record("forced"), record("ttl", NOW - 3_600_000),
    { ...record("reset"), primary: { remainingPercent: 50, resetAt: NOW / 1000 } }]);
  const resolved: string[] = [];
  const cache = await cacheAt(cachePath, {
    resolveAuth: async (providerId) => { resolved.push(providerId); return resolveAuth(providerId); },
  });
  await cache.refresh({
    forcedProviderIds: ["forced", "forced"],
    candidateProviderIds: ["fresh", "forced", "missing", "missing", "ttl", "reset"],
  });
  assert.deepEqual(resolved, ["forced", "missing", "ttl", "reset"]);
  await cache.refresh({ candidateProviderIds: ["fresh", "forced", "missing", "ttl", "reset"] });
  await cache.refresh();
  assert.equal(resolved.length, 4);
});

test("one refresh starts auth and fetch concurrently and gives every request the same signal", async (t) => {
  const { cachePath } = await sandbox(t);
  const authGate = deferred<void>();
  const responseGate = deferred<void>();
  const authStarted: string[] = [];
  const signals: AbortSignal[] = [];
  const cache = await cacheAt(cachePath, {
    resolveAuth: async (providerId) => { authStarted.push(providerId); await authGate.promise; return resolveAuth(providerId); },
    fetch: async (_url, init) => {
      assert.ok(init?.signal);
      signals.push(init.signal);
      await responseGate.promise;
      return Response.json(usage());
    },
  });
  const refresh = cache.refresh({ candidateProviderIds: ["a", "b", "c"] });
  assert.deepEqual(authStarted, ["a", "b", "c"]);
  authGate.resolve();
  await nextTurn();
  assert.equal(signals.length, 3);
  assert.equal(signals[0], signals[1]);
  assert.equal(signals[1], signals[2]);
  responseGate.resolve();
  await refresh;
  assert.deepEqual((await stored(cachePath)).entries.map((entry) => entry.providerId).sort(), ["a", "b", "c"]);
});

test("the default overall deadline bounds auth, uncooperative fetch, and body waits together", async (t) => {
  const { cachePath } = await sandbox(t);
  await seed(cachePath, [record("auth"), record("fetch"), record("body")]);
  const lateAuth = deferred<Awaited<ReturnType<typeof resolveAuth>>>();
  const fetchStarted: string[] = [];
  const signals: AbortSignal[] = [];
  let bodyCancelled = false;
  const cache = await cacheAt(cachePath, {
    resolveAuth: (providerId) => providerId === "auth" ? lateAuth.promise : resolveAuth(providerId),
    fetch: async (_url, init) => {
      const provider = new Headers(init?.headers).get("ChatGPT-Account-Id")!;
      fetchStarted.push(provider);
      signals.push(init!.signal!);
      if (provider === "test-fetch") return new Promise<Response>(() => {});
      if (provider === "test-body") {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(Buffer.from('{"rate_limit":')); },
          cancel() { bodyCancelled = true; return new Promise<void>(() => {}); },
        }));
      }
      return Response.json(usage());
    },
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const refresh = cache.refresh({ forcedProviderIds: ["auth", "fetch", "body", "fast"] }).then(() => { settled = true; });
  await nextTurn();
  assert.deepEqual(fetchStarted, ["test-fetch", "test-body", "test-fast"]);
  t.mock.timers.tick(4999);
  await nextTurn();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  await refresh;
  await nextTurn();
  assert.ok(signals.every((signal) => signal === signals[0] && signal.aborted));
  assert.equal(bodyCancelled, true);
  assert.deepEqual(cache.getFreshSnapshot().auth, record("auth"));
  assert.deepEqual(cache.getFreshSnapshot().fetch, record("fetch"));
  assert.deepEqual(cache.getFreshSnapshot().body, record("body"));
  assert.ok(cache.getFreshSnapshot().fast);
  lateAuth.resolve(await resolveAuth("auth"));
  await nextTurn();
  assert.equal(fetchStarted.length, 3, "late auth must not start a request after the deadline");
  await cache.invalidate("absent");
  assert.equal((await stored(cachePath)).entries.length, 4);
});

test("auth time consumes the same deadline as fetch and body time", async (t) => {
  const { cachePath } = await sandbox(t);
  const authGate = deferred<void>();
  const responseGate = deferred<Response>();
  let requestSignal: AbortSignal | undefined;
  let cancelled = false;
  const cache = await cacheAt(cachePath, {
    timeoutMs: 100,
    resolveAuth: async (providerId) => { await authGate.promise; return resolveAuth(providerId); },
    fetch: async (_url, init) => { requestSignal = init!.signal!; return responseGate.promise; },
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const refresh = cache.refresh({ candidateProviderIds: ["a"] });
  t.mock.timers.tick(60);
  authGate.resolve();
  await nextTurn();
  assert.ok(requestSignal);
  t.mock.timers.tick(30);
  responseGate.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await nextTurn();
  t.mock.timers.tick(10);
  await refresh;
  await nextTurn();
  assert.equal(requestSignal.aborted, true);
  assert.equal(cancelled, true);
  assert.deepEqual(Object.keys(cache.getFreshSnapshot()), []);
});

test("missing auth, invalid JWT claims, and auth errors never start usage requests", async (t) => {
  const { cachePath } = await sandbox(t);
  const previous = record();
  await seed(cachePath, [previous]);
  const keys = [undefined, "", "not-a-jwt", "test.invalid.test", token({}),
    token({ "https://api.openai.com/auth": null }), token({ "https://api.openai.com/auth": { chatgpt_account_id: "" } }),
    token({ "https://api.openai.com/auth": { chatgpt_account_id: 42 } })];
  let calls = 0;
  for (const apiKey of keys) {
    const cache = await cacheAt(cachePath, {
      resolveAuth: async () => ({ auth: { apiKey } }),
      fetch: async () => { calls += 1; return Response.json(usage()); },
    });
    await cache.refresh({ forcedProviderIds: ["codex-a"] });
    assert.deepEqual(cache.getFreshSnapshot()["codex-a"], previous);
  }
  for (const resolver of [async () => undefined, async () => { throw new Error("synthetic-auth-error"); }]) {
    const cache = await cacheAt(cachePath, {
      resolveAuth: resolver,
      fetch: async () => { calls += 1; return Response.json(usage()); },
    });
    await cache.refresh({ forcedProviderIds: ["codex-a"] });
  }
  assert.equal(calls, 0);
  assert.deepEqual((await stored(cachePath)).entries, [previous]);
});

test("transport, redirect, JSON, and oversized body failures preserve cached data", async (t) => {
  const { cachePath } = await sandbox(t);
  const previous = record();
  await seed(cachePath, [previous]);
  let cancelled = 0;
  const cases: Array<() => Promise<Response>> = [
    async () => { throw new Error("synthetic-network-error"); },
    async () => new Response("redirect", { status: 302, headers: { Location: "https://not-used.invalid" } }),
    async () => new Response("unauthorized", { status: 401 }),
    async () => new Response("server error", { status: 500 }),
    async () => new Response("not JSON"),
    async () => new Response(null, { status: 204 }),
    async () => new Response(new ReadableStream({
      pull(controller) { controller.error(new Error("synthetic-body-error")); },
    })),
    async () => new Response(new ReadableStream({ cancel() { cancelled += 1; } }), {
      headers: { "content-length": String(64 * 1024 + 1) },
    }),
    async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.alloc(32 * 1024, " "));
        controller.enqueue(Buffer.alloc(32 * 1024 + 1, " "));
      },
      cancel() { cancelled += 1; },
    })),
    async () => new Response(" ".repeat(64 * 1024) + JSON.stringify(usage()), { headers: { "content-length": "1" } }),
  ];
  for (const fetchUsage of cases) {
    const cache = await cacheAt(cachePath, { fetch: fetchUsage });
    await cache.refresh({ forcedProviderIds: ["codex-a"] });
    assert.deepEqual(cache.getFreshSnapshot()["codex-a"], previous);
  }
  assert.equal(cancelled, 2);
  assert.deepEqual((await stored(cachePath)).entries, [previous]);
  const json = JSON.stringify(usage());
  const atLimit = await cacheAt(cachePath, { fetch: async () => new Response(json.padEnd(64 * 1024)) });
  await atLimit.refresh({ forcedProviderIds: ["codex-a"] });
  assert.ok(atLimit.getFreshSnapshot()["codex-a"]?.secondary, "a body exactly at the limit is valid");
});

test("an older request finishing last cannot replace a newer fetchedAt record", async (t) => {
  const { cachePath } = await sandbox(t);
  let timestamp = NOW;
  const responses = [deferred<Response>(), deferred<Response>()];
  let calls = 0;
  const cache = await cacheAt(cachePath, {
    now: () => timestamp,
    fetch: async () => responses[calls++].promise,
  });
  const older = cache.refresh({ forcedProviderIds: ["codex-a"] });
  await nextTurn();
  assert.equal(calls, 1);
  timestamp += 1000;
  const newer = cache.refresh({ forcedProviderIds: ["codex-a"] });
  await nextTurn();
  assert.equal(calls, 2);
  responses[1].resolve(Response.json(usage(10)));
  await newer;
  responses[0].resolve(Response.json(usage(90)));
  await older;
  assert.equal(cache.getFreshSnapshot()["codex-a"]?.fetchedAt, NOW + 1000);
  assert.equal(cache.getFreshSnapshot()["codex-a"]?.primary?.remainingPercent, 90);
  assert.deepEqual((await stored(cachePath)).entries, [cache.getFreshSnapshot()["codex-a"]]);
});

test("equal fetchedAt keeps the later-started response when an earlier request finishes last", async (t) => {
  const { cachePath } = await sandbox(t);
  const responses = [deferred<Response>(), deferred<Response>()];
  let calls = 0;
  const cache = await cacheAt(cachePath, {
    now: () => NOW,
    fetch: async () => responses[calls++].promise,
  });
  const older = cache.refresh({ forcedProviderIds: ["codex-a"] });
  await nextTurn();
  assert.equal(calls, 1);
  const newer = cache.refresh({ forcedProviderIds: ["codex-a"] });
  await nextTurn();
  assert.equal(calls, 2);
  responses[1].resolve(Response.json({ ...usage(10), plan_type: "ProLite" }));
  await newer;
  responses[0].resolve(Response.json(usage(90)));
  await older;
  const expected = {
    providerId: "codex-a", planType: "prolite", fetchedAt: NOW, allowed: true,
    primary: { remainingPercent: 90, resetAt: NOW / 1000 + 3600 },
    secondary: { remainingPercent: 49.5, resetAt: NOW / 1000 + 7200 },
  };
  assert.deepEqual(cache.getFreshSnapshot()["codex-a"], expected);
  assert.deepEqual(await stored(cachePath), { version: 2, entries: [expected] });
});

test("invalidation immediately removes an entry and rejects a response already in flight", async (t) => {
  const { cachePath } = await sandbox(t);
  await seed(cachePath, [record(), record("keep")]);
  const response = deferred<Response>();
  const started = deferred<void>();
  const cache = await cacheAt(cachePath, {
    fetch: async () => { started.resolve(); return response.promise; },
  });
  const refresh = cache.refresh({ forcedProviderIds: ["codex-a"] });
  await started.promise;
  const invalidation = cache.invalidate("codex-a");
  assert.equal(cache.getFreshSnapshot()["codex-a"], undefined);
  response.resolve(Response.json(usage()));
  await Promise.all([invalidation, refresh]);
  assert.deepEqual(Object.keys(cache.getFreshSnapshot()), ["keep"]);
  assert.deepEqual((await stored(cachePath)).entries, [record("keep")]);
});

test("a forced refresh after invalidation publishes but an older auth wait cannot restore its generation", async (t) => {
  const { cachePath } = await sandbox(t);
  const authGate = deferred<void>();
  let authCalls = 0;
  let fetchCalls = 0;
  const cache = await cacheAt(cachePath, {
    resolveAuth: async (providerId) => {
      authCalls += 1;
      if (authCalls === 1) await authGate.promise;
      return resolveAuth(providerId);
    },
    fetch: async () => Response.json(usage(++fetchCalls === 1 ? 10 : 90)),
  });
  const older = cache.refresh({ forcedProviderIds: ["codex-a"] });
  assert.equal(authCalls, 1);
  // Invalidate even a missing entry, and do not wait for its queued persistence.
  const invalidation = cache.invalidate("codex-a");
  await cache.refresh({ forcedProviderIds: ["codex-a"] });
  assert.equal(cache.getFreshSnapshot()["codex-a"]?.primary?.remainingPercent, 90);
  authGate.resolve();
  await Promise.all([invalidation, older]);
  assert.equal(fetchCalls, 2);
  assert.equal(cache.getFreshSnapshot()["codex-a"]?.primary?.remainingPercent, 90);
  assert.deepEqual((await stored(cachePath)).entries, [cache.getFreshSnapshot()["codex-a"]]);
});

test("overlapping refreshes and invalidations serialize merges without losing other providers", async (t) => {
  const { cachePath } = await sandbox(t);
  await seed(cachePath, [record("remove"), record("keep")]);
  const cache = await cacheAt(cachePath);
  await Promise.all([
    cache.refresh({ forcedProviderIds: ["a", "b"] }),
    cache.invalidate("remove"),
    cache.refresh({ forcedProviderIds: ["c", "d"] }),
  ]);
  assert.deepEqual(Object.keys(cache.getFreshSnapshot()).sort(), ["a", "b", "c", "d", "keep"]);
  const reloaded = await cacheAt(cachePath);
  assert.deepEqual(reloaded.getFreshSnapshot(), cache.getFreshSnapshot());
  assert.deepEqual(await readdir(path.dirname(cachePath)), [path.basename(cachePath)]);
});

test("persistence failures do not poison the write queue or discard usable memory state", async (t) => {
  const { root } = await sandbox(t);
  const blocker = path.join(root, "blocked");
  await writeFile(blocker, "test-owned blocker");
  const cachePath = path.join(blocker, "cache.json");
  const cache = await cacheAt(cachePath);
  await cache.refresh({ candidateProviderIds: ["a"] });
  assert.ok(cache.getFreshSnapshot().a);
  await rm(blocker);
  await cache.refresh({ candidateProviderIds: ["b"] });
  assert.deepEqual((await stored(cachePath)).entries.map((entry) => entry.providerId), ["a", "b"]);
});

test("persisted JSON contains only schema fields, including after loading extra fields", async (t) => {
  const { cachePath } = await sandbox(t);
  await seed(cachePath, [{
    ...record("loaded"), token: "synthetic-stored-token", accountId: "synthetic-stored-account",
    email: "synthetic@example.invalid", plan: "synthetic-plan", rawError: "synthetic-error",
    primary: { remainingPercent: 75, extra: "synthetic-window-metadata" },
  }]);
  const payload = { ...usage(), account_id: "synthetic-response-account", email: "synthetic@example.invalid",
    plan_type: " ProLite ", raw_response: "synthetic-raw-response", error: "synthetic-error" };
  const cache = await cacheAt(cachePath, { fetch: async () => Response.json(payload) });
  await cache.refresh({ candidateProviderIds: ["fetched"] });
  const json = await readFile(cachePath, "utf8");
  const document = JSON.parse(json);
  assert.deepEqual(Object.keys(document), ["version", "entries"]);
  assert.deepEqual(document.entries, [record("loaded"), {
    providerId: "fetched", planType: "prolite", fetchedAt: NOW, allowed: true,
    primary: { remainingPercent: 75, resetAt: NOW / 1000 + 3600 },
    secondary: { remainingPercent: 49.5, resetAt: NOW / 1000 + 7200 },
  }]);
  assert.ok(!json.includes("synthetic"));
  assert.ok(!json.includes("test-fetched"));
  assert.ok(!json.includes((await resolveAuth("fetched")).auth.apiKey));
});
