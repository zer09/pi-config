import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, mock, test } from "node:test";

import {
  DEFAULT_ENDPOINT,
  PROTOCOL_VERSION,
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_CATALOG_PAGES,
  USAGE,
  createClient,
  initialize,
  send,
  parseCommand,
  runCli,
  sanitizeOutput,
} from "./outpour-mcp.mjs";

const nativeFetchGuard = mock.method(globalThis, "fetch", () => {
  throw new Error("Native fetch is disabled in offline tests; inject a mock.");
});
after(() => {
  assert.equal(nativeFetchGuard.mock.callCount(), 0);
  nativeFetchGuard.mock.restore();
});

function offlineEnv() {
  return {
    OUTPOUR_API_KEY: `offline-credential-${process.pid}`,
    OUTPOUR_MCP_URL: DEFAULT_ENDPOINT,
  };
}

function response(body, { status = 200, contentType = "application/json", statusText = "OK" } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text || null, {
    status,
    statusText,
    headers: { "content-type": contentType, "mcp-session-id": "offline-session" },
  });
}

function rpc(body, id) {
  return response({ jsonrpc: "2.0", id, result: body });
}

function offlineTransport({ tools = [], callResult, overrides = {} } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, DEFAULT_ENDPOINT);
    assert.equal(init.redirect, "error");
    const requestBody = JSON.parse(init.body);
    requests.push({ init, requestBody });

    if (Object.hasOwn(overrides, requestBody.method)) {
      const override = overrides[requestBody.method];
      if (typeof override === "function") return override(requestBody, init);
      return override;
    }
    if (requestBody.method === "initialize") {
      return rpc({ protocolVersion: PROTOCOL_VERSION }, requestBody.id);
    }
    if (requestBody.method === "notifications/initialized") return response("", { status: 202 });
    if (requestBody.method === "tools/list") {
      return rpc({ tools }, requestBody.id);
    }
    if (requestBody.method === "tools/call") {
      return rpc(callResult, requestBody.id);
    }
    throw new Error(`Unexpected offline method: ${requestBody.method}`);
  };
  return { fetchImpl, requests };
}

async function execute(argv, options = {}) {
  const env = options.env || offlineEnv();
  const stdout = [];
  const stderr = [];
  const transport = options.transport || offlineTransport(options);
  const status = await runCli({
    argv,
    env,
    fetchImpl: transport.fetchImpl,
    stdin: options.stdin,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });
  return { env, status, stdout, stderr, requests: transport.requests };
}

test("pins endpoints before fetch for CLI, constructed, and directly injected clients", async () => {
  const forbidden = [
    "http://mcp.outpour.app/mcp",
    "https://elsewhere.invalid/mcp",
    "https://mcp.outpour.app/other",
    `${DEFAULT_ENDPOINT}/`,
    `${DEFAULT_ENDPOINT}?query=1`,
    `${DEFAULT_ENDPOINT}?`,
    `${DEFAULT_ENDPOINT}#fragment`,
    `${DEFAULT_ENDPOINT}#`,
    "https://user:synthetic-password@mcp.outpour.app/mcp",
    "https://mcp.outpour.app:443/mcp",
    "not a URL",
  ];
  let fetches = 0;
  const fetchImpl = async () => { fetches++; throw new Error("must not fetch"); };
  for (const endpoint of forbidden) {
    const env = { ...offlineEnv(), OUTPOUR_MCP_URL: endpoint };
    const result = await execute(["list"], { env, transport: { fetchImpl, requests: [] } });
    assert.equal(result.status, 1, endpoint);
    assert.match(result.stderr[0], /OUTPOUR_MCP_URL must be exactly/);
    assert.equal(result.stderr[0].includes("synthetic-password"), false);
    assert.throws(() => createClient({ apiKey: env.OUTPOUR_API_KEY, endpoint, fetchImpl }), /must be exactly/);
    await assert.rejects(send("tools/list", {}, {
      client: { apiKey: env.OUTPOUR_API_KEY, endpoint, fetchImpl },
    }), /must be exactly/);
  }
  assert.equal(fetches, 0);

  for (const endpoint of [undefined, "", DEFAULT_ENDPOINT]) {
    const result = await execute(["list"], { env: { ...offlineEnv(), OUTPOUR_MCP_URL: endpoint } });
    assert.equal(result.status, 0);
    assert.equal(result.requests.length, 3);
    assert.equal(createClient({ apiKey: "synthetic", endpoint, fetchImpl }).endpoint, DEFAULT_ENDPOINT);
  }
});

test("rejects redirects without retrying or sending a follow-up request", async () => {
  let fetches = 0;
  const result = await execute(["list"], {
    transport: {
      requests: [],
      fetchImpl: async (url, init) => {
        fetches++;
        assert.equal(url, DEFAULT_ENDPOINT);
        assert.equal(init.redirect, "error");
        throw new TypeError("fetch failed: unexpected redirect");
      },
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr[0], /redirect/);
  assert.equal(fetches, 1);

  for (const status of [302, 307]) {
    let redirectedFetches = 0;
    const rejected = await execute(["list"], {
      transport: {
        requests: [],
        fetchImpl: async (url, init) => {
          redirectedFetches++;
          assert.equal(url, DEFAULT_ENDPOINT);
          assert.equal(init.redirect, "error");
          return new Response(null, { status, headers: { Location: "https://forbidden.invalid/mcp" } });
        },
      },
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr[0], new RegExp(`MCP request failed \\(${status}\\)`));
    assert.equal(redirectedFetches, 1);
  }
});

function transportClient(fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS) {
  return createClient({ apiKey: offlineEnv().OUTPOUR_API_KEY, fetchImpl, timeoutMs });
}

function streamedResponse(chunks, { open = false, contentType = "text/event-stream" } = {}) {
  let cancellations = 0;
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      }
      if (!open) controller.close();
    },
    cancel() { cancellations++; },
  });
  return {
    response: new Response(body, { headers: { "content-type": contentType } }),
    cancellations: () => cancellations,
  };
}

function sse(payload, newline = "\n") {
  return `data: ${JSON.stringify(payload)}${newline}${newline}`;
}

const matchingResult = { jsonrpc: "2.0", id: 1, result: { value: "matched" } };
const unrelatedNotification = { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } };

test("validates JSON-RPC envelopes and strict request IDs", async (t) => {
  const invalid = [
    ["empty", "", /empty response/],
    ["malformed JSON", "{", /Malformed JSON/],
    ["null", null, /envelope/],
    ["batch", [matchingResult], /envelope/],
    ["missing version", { id: 1, result: {} }, /envelope/],
    ["wrong version", { ...matchingResult, jsonrpc: "1.0" }, /envelope/],
    ["missing ID", { jsonrpc: "2.0", result: {} }, /expected an ID/],
    ["null ID", { ...matchingResult, id: null }, /expected an ID/],
    ["string ID", { ...matchingResult, id: "1" }, /does not match/],
    ["wrong ID", { ...matchingResult, id: 2 }, /does not match/],
    ["neither result nor error", { jsonrpc: "2.0", id: 1 }, /exactly one/],
    ["result and error", { ...matchingResult, error: { code: -1, message: "failure" } }, /exactly one/],
    ["null error", { jsonrpc: "2.0", id: 1, error: null }, /error object/],
    ["invalid error code", { jsonrpc: "2.0", id: 1, error: { code: "-1", message: "failure" } }, /error object/],
    ["invalid error message", { jsonrpc: "2.0", id: 1, error: { code: -1, message: 7 } }, /error object/],
    ["notification", unrelatedNotification, /notification/],
  ];
  for (const [label, payload, diagnostic] of invalid) {
    await t.test(label, async () => {
      let fetches = 0;
      const client = transportClient(async () => { fetches++; return response(payload); });
      await assert.rejects(send("tools/list", {}, { client }), diagnostic);
      assert.equal(fetches, 1);
    });
  }
  for (const result of [null, false, 0, {}, []]) {
    const client = transportClient(async () => rpc(result, 1));
    assert.deepEqual(await send("tools/call", {}, { client }), result);
  }
});

test("keeps HTTP status and safe error detail without exposing direct-client credentials or fetch headers", async () => {
  const secret = offlineEnv().OUTPOUR_API_KEY;
  for (const [payload, options, expected] of [
    [{ jsonrpc: "2.0", id: 1, error: { code: -32000, message: `denied ${secret}` } }, {}, /MCP error -32000: denied \[REDACTED\]/],
    [{ error: { message: `denied ${secret}` } }, { status: 403 }, /MCP request failed \(403\): denied \[REDACTED\]/],
    [`unavailable ${secret}`, { status: 503 }, /MCP request failed \(503\): unavailable \[REDACTED\]/],
    ["", { status: 401, statusText: "Unauthorized" }, /MCP request failed \(401\): Unauthorized/],
  ]) {
    const client = transportClient(async () => response(payload, options));
    await assert.rejects(send("tools/call", {}, { client }), (error) => {
      assert.match(error.message, expected);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
  }
  const client = transportClient(async () => { throw new Error(`Authorization: Bearer ${secret}; Mcp-Session-Id: private-session`); });
  await assert.rejects(send("tools/list", {}, { client }), (error) => {
    assert.equal(error.message, "MCP fetch failed; redirects are not allowed.");
    assert.doesNotMatch(error.message, /Authorization|private-session/);
    return true;
  });
});

test("accepts empty notification acknowledgements but not empty request responses", async () => {
  const client = transportClient(async () => response("", { status: 202 }));
  assert.equal(await send("notifications/initialized", undefined, { notification: true, client }), undefined);
  await assert.rejects(send("tools/list", {}, { client }), /empty response/);
});

test("selects matching complete SSE events with notifications, CRLF, and multiline data", async (t) => {
  const result = sse(matchingResult);
  const notification = sse(unrelatedNotification);
  const multiline = ': keepalive\r\nevent: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":1,"result":{"value":"matched"}}\r\n\r\n';
  for (const [label, chunks] of [
    ["result followed by notification", [result + notification]],
    ["notification before result", [notification, result]],
    ["other ID before result", [sse({ ...matchingResult, id: 99 }), result]],
    ["CRLF and multiline data across chunks", [...multiline]],
    ["finite stream", [result]],
  ]) {
    await t.test(label, async () => {
      const stream = streamedResponse(chunks);
      const client = transportClient(async () => stream.response);
      assert.deepEqual(await send("tools/list", {}, { client }), matchingResult.result);
    });
  }
  const unicode = new TextEncoder().encode(sse({ ...matchingResult, result: { value: "café" } }));
  const stream = streamedResponse([...unicode].map((byte) => Uint8Array.of(byte)));
  assert.deepEqual(await send("tools/list", {}, { client: transportClient(async () => stream.response) }), { value: "café" });
});

test("cancels an open SSE stream promptly after the matching result", { timeout: 2000 }, async () => {
  const stream = streamedResponse([sse(matchingResult), sse(unrelatedNotification)], { open: true });
  let signal;
  const client = transportClient(async (_url, init) => { signal = init.signal; return stream.response; }, 100);
  assert.deepEqual(await send("tools/list", {}, { client }), matchingResult.result);
  assert.equal(stream.cancellations(), 1);
  assert.equal(stream.response.body.locked, false);
  assert.equal(signal.aborted, false);
});

test("rejects SSE streams without matching responses and malformed events", async (t) => {
  for (const [label, text, expected] of [
    ["wrong ID only", sse({ ...matchingResult, id: 2 }), /without a matching response/],
    ["strict ID type", sse({ ...matchingResult, id: "1" }), /without a matching response/],
    ["notification only", sse(unrelatedNotification), /without a matching response/],
    ["empty", "", /without a matching response/],
    ["partial event", `data: ${JSON.stringify(matchingResult)}\n`, /without a matching response/],
    ["invalid JSON", "data: {\n\n", /Malformed JSON/],
    ["invalid envelope", sse({ id: 1, result: {} }), /envelope/],
    ["invalid notification", sse({ ...unrelatedNotification, id: 1 }), /notification/],
    ["matching error", sse({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "stream failure" } }), /MCP error -1: stream failure/],
  ]) {
    await t.test(label, async () => {
      const open = label === "invalid JSON" || label === "matching error";
      const stream = streamedResponse([text], { open });
      await assert.rejects(send("tools/list", {}, { client: transportClient(async () => stream.response) }), expected);
      if (open) assert.equal(stream.cancellations(), 1);
    });
  }
});

test("bounds the whole request during fetch, JSON body, and an unmatched open SSE stream", { timeout: 2000 }, async (t) => {
  await t.test("stalled fetch", async () => {
    let signal;
    let fetches = 0;
    const client = transportClient((_url, init) => {
      fetches++;
      signal = init.signal;
      return new Promise(() => {});
    }, 20);
    await assert.rejects(send("tools/call", {}, { client }), /deadline exceeded after 20 ms/);
    assert.equal(signal.aborted, true);
    assert.equal(fetches, 1);
  });
  for (const contentType of ["application/json", "text/event-stream"]) {
    await t.test(contentType, async () => {
      const chunk = contentType === "application/json" ? '{"jsonrpc":' : sse(unrelatedNotification);
      const stream = streamedResponse([chunk], { contentType, open: true });
      let signal;
      const client = transportClient(async (_url, init) => { signal = init.signal; return stream.response; }, 20);
      await assert.rejects(send("tools/call", {}, { client }), /deadline exceeded after 20 ms/);
      assert.equal(signal.aborted, true);
      assert.equal(stream.cancellations(), 1);
      assert.equal(stream.response.body.locked, false);
    });
  }
});

test("clears request timers on success, parse failure, fetch failure, and timeout", async (t) => {
  const timers = new Set();
  const durations = [];
  const setTimer = globalThis.setTimeout;
  const clearTimer = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, duration) => {
    const timer = setTimer(callback, duration);
    timers.add(timer);
    durations.push(duration);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => { timers.delete(timer); clearTimer(timer); });
  for (const fetchImpl of [
    async () => rpc({}, 1),
    async () => response("not JSON"),
    async () => { throw new Error("offline failure"); },
    () => new Promise(() => {}),
  ]) {
    try {
      await send("tools/list", {}, { client: transportClient(fetchImpl, 10) });
    } catch {
      // Each failure path must clear the same deadline timer.
    }
    assert.equal(timers.size, 0);
  }
  await send("tools/list", {}, { client: transportClient(async () => rpc({}, 1)) });
  assert.equal(timers.size, 0);
  assert.deepEqual(durations, [10, 10, 10, 10, 30_000]);
});

test("limits accumulated response bytes and cancels oversized JSON, SSE, and HTTP error bodies", async () => {
  const atLimit = JSON.stringify(matchingResult).padEnd(MAX_RESPONSE_BYTES, " ");
  const accepted = streamedResponse([atLimit], { contentType: "application/json" });
  assert.deepEqual(await send("tools/list", {}, { client: transportClient(async () => accepted.response) }), matchingResult.result);
  for (const contentType of ["application/json", "text/event-stream"]) {
    const stream = streamedResponse([
      new Uint8Array(MAX_RESPONSE_BYTES / 2).fill(32),
      new Uint8Array(MAX_RESPONSE_BYTES / 2 + 1).fill(32),
    ], { open: true, contentType });
    await assert.rejects(send("tools/call", {}, { client: transportClient(async () => stream.response) }), /exceeds the 8388608-byte limit/);
    assert.equal(stream.cancellations(), 1);
  }
  const stream = streamedResponse([new Uint8Array(MAX_RESPONSE_BYTES + 1)], { open: true });
  const httpError = new Response(stream.response.body, { status: 500 });
  await assert.rejects(send("tools/list", {}, { client: transportClient(async () => httpError) }), /MCP response \(500\) exceeds/);
  assert.equal(stream.cancellations(), 1);
});

test("requires the supported initialize protocol before notification or catalog requests", async (t) => {
  for (const protocolVersion of [undefined, null, "", "2024-11-05", "2025-06-18", 20250326]) {
    await t.test(String(protocolVersion), async () => {
      const transport = offlineTransport({
        overrides: { initialize: rpc({ protocolVersion }, 1) },
      });
      const result = await execute(["list"], { transport });
      assert.equal(result.status, 1);
      assert.match(result.stderr[0], /Unsupported or missing MCP protocolVersion; expected 2025-03-26/);
      assert.deepEqual(result.stdout, []);
      assert.deepEqual(result.requests.map(({ requestBody }) => requestBody.method), ["initialize"]);
    });
  }
  const transport = offlineTransport();
  const client = transportClient(transport.fetchImpl);
  await initialize(client);
  assert.equal(client.initialized, true);
  assert.equal(client.sessionId, "offline-session");
  assert.equal(transport.requests[0].requestBody.params.protocolVersion, PROTOCOL_VERSION);
  assert.equal(transport.requests[0].init.headers["MCP-Protocol-Version"], undefined);
  assert.equal(transport.requests[1].requestBody.method, "notifications/initialized");
  assert.equal(transport.requests[1].requestBody.id, undefined);
  assert.equal(transport.requests[1].init.headers["MCP-Protocol-Version"], PROTOCOL_VERSION);
  assert.equal(transport.requests[1].init.headers["Mcp-Session-Id"], "offline-session");

  const rejected = transportClient(offlineTransport({ overrides: { initialize: rpc({}, 1) } }).fetchImpl);
  await assert.rejects(initialize(rejected), /protocolVersion/);
  assert.equal(rejected.initialized, false);
});

function catalogTransport(pages) {
  let page = 0;
  return offlineTransport({
    callResult: { structuredContent: { ok: true, nextCursor: "ministry-record-next" } },
    overrides: {
      "tools/list": (request) => {
        assert.ok(page < pages.length, "unexpected catalog request");
        return rpc(pages[page++], request.id);
      },
    },
  });
}

test("merges opaque catalog pages for list, describe, and call without changing record arguments", async () => {
  const first = { name: "first_tool", annotations: { readOnlyHint: true } };
  const later = { name: "later_tool", annotations: { readOnlyHint: true }, inputSchema: { type: "object" } };
  const cursor = " opaque:/+=?&cursor \t";
  const pages = [{ tools: [first], nextCursor: cursor }, { tools: [later] }];
  const recordArgs = { cursor: "ministry-record-cursor", limit: 2, nested: { keep: [false, null, 7] } };
  for (const argv of [
    ["list"],
    ["list", "--json"],
    ["describe", later.name],
    ["call", later.name, JSON.stringify(recordArgs)],
  ]) {
    const result = await execute(argv, { transport: catalogTransport(pages) });
    assert.equal(result.status, 0, argv.join(" "));
    assert.deepEqual(result.stderr, []);
    const catalogRequests = result.requests.filter(({ requestBody }) => requestBody.method === "tools/list");
    assert.deepEqual(catalogRequests.map(({ requestBody }) => requestBody.params), [{}, { cursor }]);
    if (argv[0] === "list" && argv.length === 1) {
      assert.deepEqual(result.stdout, ["first_tool\tread\t", "later_tool\tread\t"]);
    } else if (argv[0] === "list") {
      assert.deepEqual(JSON.parse(result.stdout[0]), [first, later]);
    } else if (argv[0] === "describe") {
      assert.deepEqual(JSON.parse(result.stdout[0]), later);
    } else {
      const calls = result.requests.filter(({ requestBody }) => requestBody.method === "tools/call");
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].requestBody.params, { name: later.name, arguments: recordArgs });
    }
  }
});

test("keeps the strict write guard for later-page tools", async () => {
  for (const readOnlyHint of [false, undefined, "true", 1, {}, []]) {
    const tool = { name: "later_write", annotations: { readOnlyHint } };
    const pages = [{ tools: [], nextCursor: "next" }, { tools: [tool] }];
    const rejected = await execute(["call", tool.name], { transport: catalogTransport(pages) });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr[0], /write tool/);
    assert.equal(rejected.requests.filter(({ requestBody }) => requestBody.method === "tools/call").length, 0);
    const allowed = await execute(["call", tool.name, "--allow-write"], { transport: catalogTransport(pages) });
    assert.equal(allowed.status, 0);
    assert.equal(allowed.requests.filter(({ requestBody }) => requestBody.method === "tools/call").length, 1);
  }
});

test("rejects malformed catalog pages, names, annotations, and cursors", async (t) => {
  const cases = [
    ["null result", null, /tools array/],
    ["array result", [], /tools array/],
    ["missing tools", {}, /tools array/],
    ["null tools", { tools: null }, /tools array/],
    ["object tools", { tools: {} }, /tools array/],
    ...[null, [], {}, { name: null }, { name: 7 }, { name: "" }, { name: " " }, { name: "bad\nname" }, { name: "bad\u0000name" }]
      .map((tool, index) => [`invalid tool ${index}`, { tools: [tool] }, /invalid tool name/]),
    ...[null, true, "read", []].map((annotations, index) => [
      `invalid annotations ${index}`, { tools: [{ name: "tool", annotations }] }, /invalid tool annotations/,
    ]),
    ...[null, "", false, 7, {}, []].map((nextCursor, index) => [
      `invalid cursor ${index}`, { tools: [], nextCursor }, /nextCursor must be a nonempty string/,
    ]),
  ];
  for (const [label, page, diagnostic] of cases) {
    await t.test(label, async () => {
      const result = await execute(["list", "--json"], { transport: catalogTransport([page]) });
      assert.equal(result.status, 1);
      assert.deepEqual(result.stdout, []);
      assert.match(result.stderr[0], diagnostic);
      assert.equal(result.requests.length, 3);
    });
  }
  const empty = await execute(["list", "--json"], { transport: catalogTransport([{ tools: [] }]) });
  assert.equal(empty.status, 0);
  assert.deepEqual(JSON.parse(empty.stdout[0]), []);
});

test("rejects duplicate tools before any call even when annotations disagree on later pages", async () => {
  const readTool = { name: "ambiguous_tool", annotations: { readOnlyHint: true } };
  for (const pages of [
    [{ tools: [readTool, readTool] }],
    [{ tools: [readTool], nextCursor: "next" }, { tools: [{ ...readTool, annotations: { readOnlyHint: false } }] }],
    [{ tools: [readTool], nextCursor: "next" }, { tools: null }],
  ]) {
    const result = await execute(["call", readTool.name, "--allow-write"], { transport: catalogTransport(pages) });
    assert.equal(result.status, 1);
    assert.deepEqual(result.stdout, []);
    assert.match(result.stderr[0], /Malformed MCP tool catalog/);
    assert.equal(result.requests.filter(({ requestBody }) => requestBody.method === "tools/call").length, 0);
  }
});

test("rejects repeated cursors and bounds runaway catalog pagination", async () => {
  for (const cursors of [["repeat", "repeat"], ["one", "two", "one"]]) {
    const result = await execute(["list"], {
      transport: catalogTransport(cursors.map((nextCursor) => ({ tools: [], nextCursor }))),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr[0], /repeated a pagination cursor/);
    assert.equal(result.requests.length, cursors.length + 2);
  }
  const pages = Array.from({ length: MAX_CATALOG_PAGES }, (_, index) => ({ tools: [], nextCursor: `page-${index}` }));
  const runaway = await execute(["list"], { transport: catalogTransport(pages) });
  assert.equal(runaway.status, 1);
  assert.match(runaway.stderr[0], /exceeds the 100-page limit/);
  assert.equal(runaway.requests.filter(({ requestBody }) => requestBody.method === "tools/list").length, MAX_CATALOG_PAGES);
  const bounded = await execute(["list", "--json"], {
    transport: catalogTransport([...pages.slice(0, -1), { tools: [] }]),
  });
  assert.equal(bounded.status, 0);
  assert.deepEqual(JSON.parse(bounded.stdout[0]), []);
});

test("does not retry a failed tool call", async () => {
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };
  const result = await execute(["call", tool.name], {
    transport: offlineTransport({
      tools: [tool],
      overrides: { "tools/call": () => response({ error: { message: "offline unavailable" } }, { status: 503 }) },
    }),
  });
  assert.equal(result.status, 1);
  assert.deepEqual(result.stdout, []);
  assert.match(result.stderr[0], /MCP request failed \(503\): offline unavailable/);
  assert.equal(result.requests.filter(({ requestBody }) => requestBody.method === "tools/call").length, 1);
});

test("passes inline, file, stdin, and omitted arguments exactly to mocked tools/call", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outpour-mcp-call-test-"));
  const file = path.join(directory, "arguments.json");
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };
  const value = { source: "arguments", limit: 2, cursor: "record-cursor", values: [false, null, { label: "keep" }] };
  try {
    fs.writeFileSync(file, JSON.stringify(value));
    for (const [source, stdin, expected] of [
      [[JSON.stringify(value)], undefined, value],
      [[`@${file}`], undefined, value],
      [["-"], JSON.stringify(value), value],
      [[], undefined, {}],
    ]) {
      const result = await execute(["call", tool.name, ...source], {
        stdin,
        tools: [tool],
        callResult: { structuredContent: { ok: true } },
      });
      assert.equal(result.status, 0);
      assert.deepEqual(result.stderr, []);
      const calls = result.requests.filter(({ requestBody }) => requestBody.method === "tools/call");
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].requestBody.params, { name: tool.name, arguments: expected });
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("parses list, describe, and all call argument sources", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outpour-mcp-test-"));
  const file = path.join(directory, "arguments.json");
  fs.writeFileSync(file, '{"from":"file","limit":2}');

  try {
    assert.deepEqual(parseCommand(["list"]), { command: "list", json: false });
    assert.deepEqual(parseCommand(["list", "--json"]), { command: "list", json: true });
    assert.deepEqual(parseCommand(["describe", "read_contacts"]), {
      command: "describe",
      name: "read_contacts",
    });
    assert.deepEqual(parseCommand(["call", "read_contacts", '{"limit":2}']), {
      command: "call",
      name: "read_contacts",
      arguments: { limit: 2 },
      allowWrite: false,
    });
    assert.deepEqual(parseCommand(["call", "read_contacts", `@${file}`]), {
      command: "call",
      name: "read_contacts",
      arguments: { from: "file", limit: 2 },
      allowWrite: false,
    });
    assert.deepEqual(parseCommand(["call", "read_contacts", "-"], { stdin: '{"from":"stdin"}' }), {
      command: "call",
      name: "read_contacts",
      arguments: { from: "stdin" },
      allowWrite: false,
    });
    assert.deepEqual(parseCommand(["call", "read_contacts"]), {
      command: "call",
      name: "read_contacts",
      arguments: {},
      allowWrite: false,
    });
    assert.deepEqual(parseCommand(["call", "add_task", "--allow-write"]), {
      command: "call",
      name: "add_task",
      arguments: {},
      allowWrite: true,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects invalid syntax and arguments before any request", async () => {
  const rejectedCommands = [
    ["describe"],
    ["list", "--json", "--json"],
    ["call"],
    ["call", "read_contacts", "--unknown"],
    ["call", "read_contacts", "--allow-write", "{}"],
    ["call", "read_contacts", "--allow-write", "--allow-write"],
    ["call", "read_contacts", "{}", "{}"],
    ["call", "read_contacts", "not-json"],
    ["call", "read_contacts", "[]"],
    ["call", "read_contacts", "null"],
  ];

  for (const argv of rejectedCommands) {
    const requests = [];
    const result = await execute(argv, {
      transport: {
        requests,
        fetchImpl: async () => {
          requests.push("unexpected request");
          throw new Error("offline transport must not be called");
        },
      },
    });
    assert.equal(result.status, 1, argv.join(" "));
    assert.equal(requests.length, 0, argv.join(" "));
  }
});

test("rejects an empty argument source before authentication but preserves omitted arguments", async (t) => {
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };
  for (const env of [offlineEnv(), {}]) {
    await t.test(env.OUTPOUR_API_KEY ? "synthetic credential" : "no credential", async () => {
      const result = await execute(["call", tool.name, ""], {
        env,
        tools: [tool],
        callResult: { structuredContent: { ok: true } },
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr[0], /^Invalid tool arguments JSON:/);
      assert.doesNotMatch(result.stderr.join("\n"), /OUTPOUR_API_KEY is not set/);
      assert.deepEqual(result.stdout, []);
      assert.deepEqual(result.requests, []);
    });
  }

  const omitted = await execute(["call", tool.name], {
    tools: [tool],
    callResult: { structuredContent: { ok: true } },
  });
  assert.equal(omitted.status, 0);
  assert.deepEqual(omitted.stderr, []);
  assert.deepEqual(JSON.parse(omitted.stdout[0]), { ok: true });
  assert.equal(omitted.requests.at(-1).requestBody.method, "tools/call");
  assert.deepEqual(omitted.requests.at(-1).requestBody.params.arguments, {});
});

test("rejects empty tool names before authentication and preserves missing-key errors for valid names", async (t) => {
  for (const command of ["describe", "call"]) {
    for (const env of [offlineEnv(), {}]) {
      const credential = env.OUTPOUR_API_KEY ? "synthetic credential" : "no credential";
      await t.test(`${command}, ${credential}`, async () => {
        const result = await execute([command, ""], { env });
        assert.equal(result.status, 1);
        assert.deepEqual(result.stderr, [`${command} requires a tool name.`]);
        assert.doesNotMatch(result.stderr.join("\n"), /OUTPOUR_API_KEY is not set/);
        assert.deepEqual(result.stdout, []);
        assert.deepEqual(result.requests, []);
      });
    }

    const missingKey = await execute([command, "read_tool"], { env: {} });
    assert.equal(missingKey.status, 2);
    assert.deepEqual(missingKey.stderr, ["OUTPOUR_API_KEY is not set."]);
    assert.deepEqual(missingKey.stdout, []);
    assert.deepEqual(missingKey.requests, []);
  }
});

test("help works without credentials or a connection, and missing keys fail before fetch", async () => {
  const help = await execute(["help"], {
    env: {},
    transport: {
      requests: [],
      fetchImpl: async () => {
        throw new Error("help must not fetch");
      },
    },
  });
  assert.equal(help.status, 0);
  assert.equal(help.stdout[0], USAGE);
  assert.deepEqual(help.requests, []);

  const missingCommand = await execute([], {
    env: {},
    transport: {
      requests: [],
      fetchImpl: async () => {
        throw new Error("help must not fetch");
      },
    },
  });
  assert.equal(missingCommand.status, 2);
  assert.equal(missingCommand.stdout[0], USAGE);
  assert.deepEqual(missingCommand.requests, []);

  const missingKey = await execute(["list"], {
    env: {},
    transport: {
      requests: [],
      fetchImpl: async () => {
        throw new Error("missing key must not fetch");
      },
    },
  });
  assert.equal(missingKey.status, 2);
  assert.deepEqual(missingKey.requests, []);
  assert.match(missingKey.stderr[0], /OUTPOUR_API_KEY is not set/);
});

test("list and describe use the established transport and preserve readable output", async () => {
  const tools = [
    {
      name: "read_contacts",
      description: "Read contacts",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object" },
    },
    { name: "add_task", description: "Add a task", annotations: { readOnlyHint: false } },
  ];

  const listed = await execute(["list"], { tools });
  assert.equal(listed.status, 0);
  assert.deepEqual(listed.stdout, ["read_contacts\tread\tRead contacts", "add_task\twrite\tAdd a task"]);
  assert.equal(listed.requests[0].init.headers.Authorization, `Bearer ${listed.env.OUTPOUR_API_KEY}`);
  assert.equal(listed.requests[2].init.headers["MCP-Protocol-Version"], PROTOCOL_VERSION);

  const listedJson = await execute(["list", "--json"], { tools });
  assert.equal(listedJson.status, 0);
  assert.deepEqual(JSON.parse(listedJson.stdout[0]), tools);

  const described = await execute(["describe", "read_contacts"], { tools });
  assert.equal(described.status, 0);
  assert.deepEqual(JSON.parse(described.stdout[0]), tools[0]);
});

test("enforces the fail-closed write guard and permits explicitly flagged mocked writes", async () => {
  const cases = [
    { name: "read_tool", annotations: { readOnlyHint: true }, requiresFlag: false },
    { name: "false_tool", annotations: { readOnlyHint: false }, requiresFlag: true },
    { name: "missing_tool", annotations: {}, requiresFlag: true },
    { name: "string_tool", annotations: { readOnlyHint: "true" }, requiresFlag: true },
    { name: "number_tool", annotations: { readOnlyHint: 1 }, requiresFlag: true },
    { name: "object_tool", annotations: { readOnlyHint: {} }, requiresFlag: true },
    { name: "array_tool", annotations: { readOnlyHint: [] }, requiresFlag: true },
  ];

  for (const tool of cases) {
    const tools = [{ name: tool.name, annotations: tool.annotations }];
    const rejected = await execute(["call", tool.name, '{"value":1}'], {
      tools,
      callResult: { structuredContent: { ok: true } },
    });
    assert.equal(rejected.status, tool.requiresFlag ? 1 : 0, tool.name);
    if (tool.requiresFlag) {
      assert.match(rejected.stderr[0], /write tool/);
      assert.equal(rejected.requests.at(-1).requestBody.method, "tools/list");
    } else {
      assert.equal(rejected.requests.at(-1).requestBody.method, "tools/call");
    }

    if (tool.requiresFlag) {
      const allowed = await execute(["call", tool.name, '{"value":1}', "--allow-write"], {
        tools,
        callResult: { structuredContent: { ok: true } },
      });
      assert.equal(allowed.status, 0, tool.name);
      assert.deepEqual(allowed.requests.at(-1).requestBody.params.arguments, { value: 1 });
    }
  }
});

test("prints successful formats and fails clearly for isError results", async () => {
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };
  const structured = await execute(["call", tool.name], {
    tools: [tool],
    callResult: { structuredContent: { ok: true } },
  });
  assert.equal(structured.status, 0);
  assert.deepEqual(JSON.parse(structured.stdout[0]), { ok: true });

  const jsonText = await execute(["call", tool.name], {
    tools: [tool],
    callResult: { content: [{ type: "text", text: '{"ok":true}' }] },
  });
  assert.equal(jsonText.status, 0);
  assert.deepEqual(JSON.parse(jsonText.stdout[0]), { ok: true });

  const normalText = await execute(["call", tool.name], {
    tools: [tool],
    callResult: { content: [{ type: "text", text: "A readable result" }] },
  });
  assert.equal(normalText.status, 0);
  assert.deepEqual(normalText.stdout, ["A readable result"]);

  const fallback = await execute(["call", tool.name], {
    tools: [tool],
    callResult: { value: "fallback", count: 1 },
  });
  assert.equal(fallback.status, 0);
  assert.deepEqual(JSON.parse(fallback.stdout[0]), { value: "fallback", count: 1 });

  const failed = await execute(["call", tool.name], {
    tools: [tool],
    callResult: {
      isError: true,
      structuredContent: { code: "FAILED" },
      content: [{ type: "text", text: "Actionable tool failure" }],
    },
  });
  assert.equal(failed.status, 1);
  assert.deepEqual(failed.stdout, []);
  assert.match(failed.stderr[0], /Tool call failed/);
  assert.match(failed.stderr[0], /Actionable tool failure/);
  assert.match(failed.stderr[0], /FAILED/);
});

test("redacts the configured credential from result, catalog, parse, and transport errors", async () => {
  const env = offlineEnv();
  const secret = env.OUTPOUR_API_KEY;
  const sensitiveTool = {
    name: "sensitive_tool",
    description: `catalog ${secret}`,
    annotations: { readOnlyHint: true },
    inputSchema: { description: `schema ${secret}` },
  };

  const commandParseError = await execute([secret], { env });
  assert.equal(commandParseError.status, 1);
  assert.equal(commandParseError.stderr.join("\n").includes(secret), false);
  assert.match(commandParseError.stderr.join("\n"), /\[REDACTED\]/);

  const list = await execute(["list"], { env, tools: [sensitiveTool] });
  assert.equal(list.status, 0);
  assert.equal(list.stdout.join("\n").includes(secret), false);
  assert.match(list.stdout.join("\n"), /\[REDACTED\]/);

  const describe = await execute(["describe", sensitiveTool.name], { env, tools: [sensitiveTool] });
  assert.equal(describe.status, 0);
  assert.equal(describe.stdout.join("\n").includes(secret), false);
  assert.match(describe.stdout.join("\n"), /\[REDACTED\]/);

  for (const callResult of [
    { content: [{ type: "text", text: `normal ${secret}` }] },
    { structuredContent: { reflected: secret } },
    { reflected: secret },
  ]) {
    const result = await execute(["call", sensitiveTool.name], {
      env,
      tools: [sensitiveTool],
      callResult,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.join("\n").includes(secret), false);
    assert.match(result.stdout.join("\n"), /\[REDACTED\]/);
  }

  const rpcError = await execute(["call", sensitiveTool.name], {
    env,
    tools: [sensitiveTool],
    transport: offlineTransport({
      tools: [sensitiveTool],
      overrides: {
        "tools/call": response({ jsonrpc: "2.0", id: 3, error: { code: -32000, message: `rpc ${secret}` } }),
      },
    }),
  });
  assert.equal(rpcError.status, 1);
  assert.equal(rpcError.stderr.join("\n").includes(secret), false);
  assert.match(rpcError.stderr.join("\n"), /\[REDACTED\]/);

  const httpError = await execute(["call", sensitiveTool.name], {
    env,
    tools: [sensitiveTool],
    transport: offlineTransport({
      tools: [sensitiveTool],
      overrides: {
        "tools/call": response("", { status: 500, statusText: `http ${secret}` }),
      },
    }),
  });
  assert.equal(httpError.status, 1);
  assert.equal(httpError.stderr.join("\n").includes(secret), false);
  assert.match(httpError.stderr.join("\n"), /\[REDACTED\]/);

  const parseError = await execute(["call", sensitiveTool.name], {
    env,
    tools: [sensitiveTool],
    transport: offlineTransport({
      tools: [sensitiveTool],
      overrides: {
        "tools/call": response(`not-json ${secret}`),
      },
    }),
  });
  assert.equal(parseError.status, 1);
  assert.equal(parseError.stderr.join("\n").includes(secret), false);
});

test("redacts escaped credentials while preserving decoded JSON and plain-text output", async (t) => {
  const credentials = [
    ["quote", 'offline-credential"'],
    ["backslash", "offline-credential\\"],
    ["control characters", "offline-credential\n\t\r\b\f\u0000\u0001"],
  ];

  for (const [label, secret] of credentials) {
    await t.test(label, async () => {
      const env = { ...offlineEnv(), OUTPOUR_API_KEY: secret };
      const tool = {
        name: "read_tool",
        description: `catalog ${secret}`,
        annotations: { readOnlyHint: true },
        inputSchema: { type: "object", description: `schema ${secret}` },
      };
      const safeTool = {
        ...tool,
        description: "catalog [REDACTED]",
        inputSchema: { type: "object", description: "schema [REDACTED]" },
      };

      for (const argv of [["list", "--json"], ["describe", tool.name]]) {
        const result = await execute(argv, { env, tools: [tool] });
        assert.equal(result.status, 0);
        assert.deepEqual(result.stderr, []);
        const expected = argv[0] === "list" ? [safeTool] : safeTool;
        assert.deepEqual(JSON.parse(result.stdout[0]), expected);
      }

      const listed = await execute(["list"], { env, tools: [tool] });
      assert.equal(listed.status, 0);
      assert.deepEqual(listed.stderr, []);
      assert.deepEqual(listed.stdout, ["read_tool\tread\tcatalog [REDACTED]"]);

      const value = {
        reflected: secret,
        detail: `echo ${secret}`,
        untouched: 'Keep "quotes", \\slashes, and\nnewlines.',
        count: 7,
      };
      const safeValue = { ...value, reflected: "[REDACTED]", detail: "echo [REDACTED]" };
      for (const callResult of [
        { structuredContent: value },
        { content: [{ type: "text", text: JSON.stringify(value) }] },
        value,
      ]) {
        const result = await execute(["call", tool.name], { env, tools: [tool], callResult });
        assert.equal(result.status, 0);
        assert.deepEqual(result.stderr, []);
        assert.deepEqual(JSON.parse(result.stdout[0]), safeValue);
      }

      const escapedSecret = JSON.stringify(secret).slice(1, -1);
      const plain = await execute(["call", tool.name], {
        env,
        tools: [tool],
        callResult: { content: [{ type: "text", text: `raw ${secret}; escaped ${escapedSecret}` }] },
      });
      assert.equal(plain.status, 0);
      assert.deepEqual(plain.stderr, []);
      assert.deepEqual(plain.stdout, ["raw [REDACTED]; escaped [REDACTED]"]);

      const failed = await execute(["call", tool.name], {
        env,
        tools: [tool],
        callResult: {
          isError: true,
          content: [{ type: "text", text: `diagnostic ${secret}` }],
          structuredContent: value,
        },
      });
      assert.equal(failed.status, 1);
      assert.deepEqual(failed.stdout, []);
      assert.equal(failed.stderr.length, 1);
      const prefix = "Tool call failed: diagnostic [REDACTED]\n";
      assert.equal(failed.stderr[0].startsWith(prefix), true);
      assert.deepEqual(JSON.parse(failed.stderr[0].slice(prefix.length)), safeValue);

      const rpcError = await execute(["call", tool.name], {
        env,
        transport: offlineTransport({
          tools: [tool],
          overrides: {
            "tools/call": response({ jsonrpc: "2.0", id: 3, error: { code: -32000, message: `rpc ${secret}` } }),
          },
        }),
      });
      assert.equal(rpcError.status, 1);
      assert.deepEqual(rpcError.stdout, []);
      assert.deepEqual(rpcError.stderr, ["MCP error -32000: rpc [REDACTED]"]);

      const parseError = await execute([secret], { env });
      assert.equal(parseError.status, 1);
      assert.deepEqual(parseError.stdout, []);
      assert.deepEqual(parseError.requests, []);
      assert.deepEqual(parseError.stderr, [`Unknown command: [REDACTED]\n\n${USAGE}`]);
    });
  }
});

test("preserves JSON boundaries for a quoted credential beside its unrelated prefix", () => {
  const secret = 'offline-credential"';
  const value = { credential: secret, unrelated: "offline-credential", count: 7 };
  const safeValue = { ...value, credential: "[REDACTED]" };
  const sanitized = sanitizeOutput(JSON.stringify(value), secret);
  assert.deepEqual(JSON.parse(sanitized), safeValue);
  assert.equal(sanitized, JSON.stringify(safeValue));
});

test("preserves JSON boundaries in direct catalog, schema, and result output", async (t) => {
  const secret = 'offline-credential"';
  const env = { ...offlineEnv(), OUTPOUR_API_KEY: secret };
  const value = { credential: secret, unrelated: "offline-credential", count: 7 };
  const safeValue = { ...value, credential: "[REDACTED]" };
  const tool = {
    name: "read_tool",
    annotations: { readOnlyHint: true },
    ...value,
    inputSchema: { type: "object", ...value },
  };
  const safeTool = { ...tool, ...safeValue, inputSchema: { type: "object", ...safeValue } };
  const cases = [
    { label: "catalog", argv: ["list", "--json"], expected: [safeTool] },
    { label: "schema", argv: ["describe", tool.name], expected: safeTool },
    { label: "structured result", callResult: { structuredContent: value }, expected: safeValue },
    {
      label: "JSON text result",
      callResult: { content: [{ type: "text", text: JSON.stringify(value) }] },
      expected: safeValue,
    },
    { label: "fallback result", callResult: value, expected: safeValue },
  ];

  for (const { label, argv = ["call", tool.name], callResult, expected } of cases) {
    await t.test(label, async () => {
      const result = await execute(argv, { env, tools: [tool], callResult });
      assert.equal(result.status, 0);
      assert.deepEqual(result.stderr, []);
      assert.equal(result.stdout.length, 1);
      assert.deepEqual(JSON.parse(result.stdout[0]), expected);
    });
  }
});

test("preserves JSON boundaries in nested success and error diagnostics", async (t) => {
  const secret = 'offline-credential"';
  const env = { ...offlineEnv(), OUTPOUR_API_KEY: secret };
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };
  const diagnostic = {
    credential: secret,
    unrelated: "offline-credential",
    count: 7,
    nested: { depth: { count: 3 } },
    values: [false, null, "safe"],
  };
  const structuredContent = {
    credential: secret,
    unrelated: "offline-credential",
    count: 7,
    diagnostic: JSON.stringify(diagnostic),
    anotherLayer: JSON.stringify(JSON.stringify(diagnostic)),
  };
  const safeDiagnostic = { ...diagnostic, credential: "[REDACTED]" };
  const safeStructuredContent = {
    ...structuredContent,
    credential: "[REDACTED]",
    diagnostic: JSON.stringify(safeDiagnostic),
    anotherLayer: JSON.stringify(JSON.stringify(safeDiagnostic)),
  };

  for (const isError of [false, true]) {
    await t.test(isError ? "error" : "success", async () => {
      const result = await execute(["call", tool.name], {
        env,
        tools: [tool],
        callResult: {
          isError,
          content: [{ type: "text", text: "nested failure" }],
          structuredContent,
        },
      });
      let output;
      if (isError) {
        assert.equal(result.status, 1);
        assert.deepEqual(result.stdout, []);
        assert.equal(result.stderr.length, 1);
        const prefix = "Tool call failed: nested failure\n";
        assert.equal(result.stderr[0].startsWith(prefix), true);
        output = result.stderr[0].slice(prefix.length);
      } else {
        assert.equal(result.status, 0);
        assert.deepEqual(result.stderr, []);
        assert.equal(result.stdout.length, 1);
        output = result.stdout[0];
      }

      const value = JSON.parse(output);
      assert.deepEqual(value, safeStructuredContent);
      assert.equal(value.unrelated, "offline-credential");
      assert.equal(typeof value.count, "number");
      const singleLayer = JSON.parse(value.diagnostic);
      assert.deepEqual(singleLayer, safeDiagnostic);
      assert.equal(typeof singleLayer.count, "number");
      const innerLayer = JSON.parse(value.anotherLayer);
      assert.equal(typeof innerLayer, "string");
      const doubleLayer = JSON.parse(innerLayer);
      assert.deepEqual(doubleLayer, safeDiagnostic);
      assert.equal(typeof doubleLayer.count, "number");
      assert.deepEqual(doubleLayer.nested, diagnostic.nested);
    });
  }
});

test("redacts JSON candidates overlapped by malformed prose quotes", async (t) => {
  const secret = "synthetic-review-key";
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };
  const cases = [
    [
      "object",
      String.raw`trace "context: {"credential":"\u0073ynthetic-review-key","count":7} :: {"code":"FAILED"}`,
      String.raw`trace "context: {"credential":"[REDACTED]","count":7} :: {"code":"FAILED"}`,
    ],
    [
      "array",
      String.raw`trace "context: ["credential","\u0073ynthetic-review-key",7] :: ["code","FAILED"]`,
      String.raw`trace "context: ["credential","[REDACTED]",7] :: ["code","FAILED"]`,
    ],
    [
      "quoted string",
      String.raw`trace "context: "\u0073ynthetic-review-key" :: {"code":"FAILED"}`,
      String.raw`trace "context: "[REDACTED]" :: {"code":"FAILED"}`,
    ],
  ];

  for (const [label, diagnostic, safeDiagnostic] of cases) {
    await t.test(`${label}: direct output and serialization layers`, () => {
      let source = diagnostic;
      let expected = safeDiagnostic;
      for (let layer = 0; layer < 4; layer++) {
        assert.equal(sanitizeOutput(source, secret), expected, `layer ${layer}`);
        source = JSON.stringify(source);
        expected = JSON.stringify(expected);
      }
    });

    await t.test(`${label}: nested mocked success and error`, async () => {
      const structuredContent = {
        diagnostic,
        nested: JSON.stringify(diagnostic),
        doubleLayer: JSON.stringify(JSON.stringify(diagnostic)),
        untouched: { code: "FAILED", count: 7 },
      };
      const safeStructuredContent = {
        ...structuredContent,
        diagnostic: safeDiagnostic,
        nested: JSON.stringify(safeDiagnostic),
        doubleLayer: JSON.stringify(JSON.stringify(safeDiagnostic)),
      };

      const success = await execute(["call", tool.name], {
        env: { ...offlineEnv(), OUTPOUR_API_KEY: secret },
        tools: [tool],
        callResult: { structuredContent: structuredContent },
      });
      assert.equal(success.status, 0);
      assert.deepEqual(success.stderr, []);
      assert.deepEqual(success.stdout, [JSON.stringify(safeStructuredContent, null, 2)]);

      const error = await execute(["call", tool.name], {
        env: { ...offlineEnv(), OUTPOUR_API_KEY: secret },
        tools: [tool],
        callResult: {
          isError: true,
          content: [{ type: "text", text: "nested failure" }],
          structuredContent,
        },
      });
      assert.equal(error.status, 1);
      assert.deepEqual(error.stdout, []);
      assert.deepEqual(error.stderr, [
        `Tool call failed: nested failure\n${JSON.stringify(safeStructuredContent, null, 2)}`,
      ]);
    });
  }

  assert.equal(
    sanitizeOutput(String.raw`control: {"credential":"\u0073ynthetic-review-key","count":7}`, secret),
    'control: {"credential":"[REDACTED]","count":7}',
  );
  assert.equal(sanitizeOutput('unrelated: {"code":"FAILED"}', secret), 'unrelated: {"code":"FAILED"}');
});

test("redacts nested prefixed JSON diagnostics without changing boundaries or output channels", async (t) => {
  const credentials = [
    ["Unicode-escaped key", "synthetic-review-key", '"\\u0073ynthetic-review-key"', "synthetic-review"],
    ["quote-ending key", 'synthetic-review-key"', JSON.stringify('synthetic-review-key"'), "synthetic-review-key"],
  ];
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };

  for (const [label, secret, credentialJson, unrelated] of credentials) {
    const json = `{"credential":${credentialJson},"unrelated":${JSON.stringify(unrelated)},"count":7}`;
    const safeValue = { credential: "[REDACTED]", unrelated, count: 7 };
    const safeJson = JSON.stringify(safeValue);
    const diagnostic = `error: ${json}`;
    const safeDiagnostic = `error: ${safeJson}`;
    const structuredContent = {
      diagnostic,
      anotherLayer: JSON.stringify(diagnostic),
      arrayDiagnostic: `warning: [${json}]`,
      unrelated,
      count: 7,
    };
    const safeStructuredContent = {
      ...structuredContent,
      diagnostic: safeDiagnostic,
      anotherLayer: JSON.stringify(safeDiagnostic),
      arrayDiagnostic: `warning: [${safeJson}]`,
    };

    await t.test(`${label}: direct sanitizer`, () => {
      for (const [source, expected] of [
        [JSON.stringify(structuredContent), JSON.stringify(safeStructuredContent)],
        [diagnostic, safeDiagnostic],
        [structuredContent.arrayDiagnostic, safeStructuredContent.arrayDiagnostic],
      ]) {
        let encodedSource = source;
        let encodedExpected = expected;
        for (let layer = 0; layer < 4; layer++) {
          assert.equal(sanitizeOutput(encodedSource, secret), encodedExpected, `layer ${layer}`);
          encodedSource = JSON.stringify(encodedSource);
          encodedExpected = JSON.stringify(encodedExpected);
        }
      }
    });

    for (const isError of [false, true]) {
      await t.test(`${label}: ${isError ? "error" : "success"}`, async () => {
        const result = await execute(["call", tool.name], {
          env: { ...offlineEnv(), OUTPOUR_API_KEY: secret },
          tools: [tool],
          callResult: {
            isError,
            content: [{ type: "text", text: "nested failure" }],
            structuredContent,
          },
        });
        let output;
        if (isError) {
          assert.equal(result.status, 1);
          assert.deepEqual(result.stdout, []);
          assert.equal(result.stderr.length, 1);
          const prefix = "Tool call failed: nested failure\n";
          assert.equal(result.stderr[0].startsWith(prefix), true);
          output = result.stderr[0].slice(prefix.length);
        } else {
          assert.equal(result.status, 0);
          assert.deepEqual(result.stderr, []);
          assert.equal(result.stdout.length, 1);
          output = result.stdout[0];
        }

        const value = JSON.parse(output);
        assert.deepEqual(value, safeStructuredContent);
        assert.deepEqual(JSON.parse(value.diagnostic.slice("error: ".length)), safeValue);
        assert.equal(JSON.parse(value.anotherLayer), safeDiagnostic);
        assert.deepEqual(JSON.parse(value.arrayDiagnostic.slice("warning: ".length)), [safeValue]);
      });
    }
  }
});

test("redacts multiple complete JSON sections without changing framing or output channels", async (t) => {
  const credentials = [
    ["Unicode-escaped key", "synthetic-review-key", String.raw`"\u0073ynthetic-review-key"`, "synthetic-review"],
    ["quote-ending key", 'synthetic-review-key"', JSON.stringify('synthetic-review-key"'), "synthetic-review-key"],
  ];
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };
  const code = { code: "FAILED" };
  const untouched = { nested: { values: [false, null, 7, 'braces } ] "quotes" \\slashes'] } };

  for (const [label, secret, credentialJson, unrelated] of credentials) {
    const json = `{"credential":${credentialJson},"unrelated":${JSON.stringify(unrelated)},"count":7}`;
    const safeJson = JSON.stringify({ credential: "[REDACTED]", unrelated, count: 7 });
    const array = `[${json},${JSON.stringify(untouched)}]`;
    const safeArray = `[${safeJson},${JSON.stringify(untouched)}]`;
    const env = { ...offlineEnv(), OUTPOUR_API_KEY: secret };

    await t.test(`${label}: single-section controls`, () => {
      for (const [section, safeSection] of [
        [credentialJson, '"[REDACTED]"'],
        [json, safeJson],
        [array, safeArray],
      ]) {
        assert.equal(sanitizeOutput(`diagnostic: ${section}`, secret), `diagnostic: ${safeSection}`);
      }
    });

    for (const [layout, sections, safeSections] of [
      ["object", [json], [safeJson]],
      ["mixed string/object/array", [credentialJson, json, array], ['"[REDACTED]"', safeJson, safeArray]],
    ]) {
      for (const prose of ["", "ordinary diagnostic text"]) {
        const separator = prose ? `\n${prose}\n` : "\n";
        const name = `${label}: ${layout}, ${prose ? "intervening prose" : "no intervening prose"}`;
        const diagnostic = [...sections, JSON.stringify(code)].join(separator);
        const safeDiagnostic = [...safeSections, JSON.stringify(code)].join(separator);

        await t.test(`${name}: direct sanitizer`, () => {
          for (const tail of ["", "\nend of diagnostic"]) {
            let source = `diagnostic: ${diagnostic}${tail}`;
            let expected = `diagnostic: ${safeDiagnostic}${tail}`;
            for (let layer = 0; layer < 4; layer++) {
              assert.equal(sanitizeOutput(source, secret), expected, `layer ${layer}`);
              source = JSON.stringify(source);
              expected = JSON.stringify(expected);
            }
          }
        });

        await t.test(`${name}: mocked tool error`, async () => {
          const content = [];
          for (const section of sections) {
            content.push({ type: "text", text: section });
            if (prose) content.push({ type: "text", text: prose });
          }
          const result = await execute(["call", tool.name], {
            env,
            tools: [tool],
            callResult: { isError: true, content, structuredContent: code },
          });
          assert.equal(result.status, 1);
          assert.deepEqual(result.stdout, []);
          assert.deepEqual(result.stderr, [
            `Tool call failed: ${[...safeSections, JSON.stringify(code, null, 2)].join(separator)}`,
          ]);
          assert.equal(result.requests.at(-1).requestBody.method, "tools/call");
        });

        await t.test(`${name}: nested mocked success`, async () => {
          const structuredContent = {
            diagnostic,
            anotherLayer: JSON.stringify(diagnostic),
            doubleLayer: JSON.stringify(JSON.stringify(diagnostic)),
            unrelated,
            count: 7,
            untouched,
          };
          const safeStructuredContent = {
            ...structuredContent,
            diagnostic: safeDiagnostic,
            anotherLayer: JSON.stringify(safeDiagnostic),
            doubleLayer: JSON.stringify(JSON.stringify(safeDiagnostic)),
          };
          const result = await execute(["call", tool.name], {
            env,
            tools: [tool],
            callResult: { structuredContent },
          });
          assert.equal(result.status, 0);
          assert.deepEqual(result.stderr, []);
          assert.deepEqual(result.stdout, [JSON.stringify(safeStructuredContent, null, 2)]);
          assert.equal(result.requests.at(-1).requestBody.method, "tools/call");
          const value = JSON.parse(result.stdout[0]);
          assert.deepEqual(value, safeStructuredContent);
          assert.equal(JSON.parse(value.anotherLayer), safeDiagnostic);
          assert.equal(JSON.parse(JSON.parse(value.doubleLayer)), safeDiagnostic);
        });
      }
    }
  }
});

test("preserves adjacent sections and plain-redacts the text between complete sections", () => {
  for (const [secret, credentialJson] of [
    ["synthetic-review-key", String.raw`"\u0073ynthetic-review-key"`],
    ['synthetic-review-key"', JSON.stringify('synthetic-review-key"')],
  ]) {
    const json = `{"credential":${credentialJson},"count":7}`;
    const safeJson = '{"credential":"[REDACTED]","count":7}';
    const escaped = JSON.stringify(secret).slice(1, -1);
    for (const [separator, safeSeparator] of [
      ["", ""],
      [` raw ${secret}; escaped ${escaped}\t\n`, " raw [REDACTED]; escaped [REDACTED]\t\n"],
    ]) {
      let source = `before ${credentialJson}${separator}${json}${separator}[${json}] after`;
      let expected = `before "[REDACTED]"${safeSeparator}${safeJson}${safeSeparator}[${safeJson}] after`;
      for (let layer = 0; layer < 4; layer++) {
        assert.equal(sanitizeOutput(source, secret), expected, `layer ${layer}`);
        source = JSON.stringify(source);
        expected = JSON.stringify(expected);
      }
    }
  }
});

test("validates JSON sections and preserves malformed-fragment plain-text fallback", () => {
  const secret = "synthetic-review-key";
  const section = String.raw`{"credential":"\u0073ynthetic-review-key","count":7}`;
  const safeSection = '{"credential":"[REDACTED]","count":7}';
  for (const malformed of [
    '{"unfinished":',
    '{"mismatched":[}',
    '{"trailingComma":true,}',
    '[false,]',
    '"unfinished',
    String.raw`"invalid\q"`,
  ]) {
    const source = `${malformed}\nraw ${secret}\nvalid: ${section}\nend`;
    const expected = `${malformed}\nraw [REDACTED]\nvalid: ${safeSection}\nend`;
    assert.equal(sanitizeOutput(source, secret), expected);
  }
});

test("keeps raw and escaped credentials whole at both ends of JSON sections", async (t) => {
  const cases = [
    ["crossing start", "synthetic-", '{"fixture":7}', ""],
    ["crossing string end", "", '"fixture"', "-synthetic"],
    ["crossing object end", "", '{"fixture":{"values":[false,null,7]}}', "-synthetic\\"],
    ["crossing array end", "", '[{"fixture":7},false,null]', "-synthetic\n"],
    ["crossing both ends", "synthetic-", '{"fixture":"quoted\\\"value"}', "-tail"],
    ["whole object section", "", '{"fixture":7}', ""],
    ["whole array section", "", '["fixture",7]', ""],
  ];

  for (const [label, prefix, section, suffix] of cases) {
    await t.test(label, () => {
      const secret = prefix + section + suffix;
      let spelling = secret;
      for (let escapeDepth = 0; escapeDepth < 3; escapeDepth++) {
        let source = `before "safe" :: ${spelling} :: {"after":[false,null,7]}`;
        let expected = 'before "safe" :: [REDACTED] :: {"after":[false,null,7]}';
        for (let layer = 0; layer < 4; layer++) {
          assert.equal(sanitizeOutput(source, secret), expected, `escape ${escapeDepth}, layer ${layer}`);
          source = JSON.stringify(source);
          expected = JSON.stringify(expected);
        }
        spelling = JSON.stringify(spelling).slice(1, -1);
      }
    });
  }
});

test("redacts nested structured credentials across bounded JSON serialization layers", async (t) => {
  const credentials = [
    ["quote", 'nested-credential"'],
    ["trailing backslash", "nested-credential\\"],
    ["control character", "nested-credential\n\t\u0000"],
    ["combined", "nested-credential\"\\\n\t\u0000"],
  ];
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };

  for (const [label, secret] of credentials) {
    await t.test(label, async () => {
      const env = { ...offlineEnv(), OUTPOUR_API_KEY: secret };
      const diagnostic = {
        credential: secret,
        other: "safe",
        nested: { label: "keep", count: 3 },
        values: ["safe", { preserved: true }],
      };
      const structuredContent = {
        diagnostic: JSON.stringify(diagnostic),
        anotherLayer: JSON.stringify(JSON.stringify(diagnostic)),
        unrelated: { message: "safe", values: [1, 2, 3] },
      };
      const safeDiagnostic = { ...diagnostic, credential: "[REDACTED]" };
      const safeStructuredContent = {
        diagnostic: JSON.stringify(safeDiagnostic),
        anotherLayer: JSON.stringify(safeDiagnostic),
        unrelated: structuredContent.unrelated,
      };

      const success = await execute(["call", tool.name], {
        env,
        tools: [tool],
        callResult: { structuredContent },
      });
      assert.equal(success.status, 0);
      assert.deepEqual(success.stderr, []);
      assert.equal(success.stdout.join("\n").includes(secret), false);
      const successValue = JSON.parse(success.stdout[0]);
      assert.deepEqual(JSON.parse(successValue.diagnostic), safeDiagnostic);
      assert.deepEqual(JSON.parse(JSON.parse(successValue.anotherLayer)), safeDiagnostic);
      assert.deepEqual(successValue.unrelated, safeStructuredContent.unrelated);

      const failure = await execute(["call", tool.name], {
        env,
        tools: [tool],
        callResult: {
          isError: true,
          content: [{ type: "text", text: "nested failure" }],
          structuredContent,
        },
      });
      assert.equal(failure.status, 1);
      assert.deepEqual(failure.stdout, []);
      assert.equal(failure.stderr.join("\n").includes(secret), false);
      const prefix = "Tool call failed: nested failure\n";
      assert.equal(failure.stderr[0].startsWith(prefix), true);
      const failureValue = JSON.parse(failure.stderr[0].slice(prefix.length));
      assert.deepEqual(JSON.parse(failureValue.diagnostic), safeDiagnostic);
      assert.deepEqual(JSON.parse(JSON.parse(failureValue.anotherLayer)), safeDiagnostic);
      assert.deepEqual(failureValue.unrelated, safeStructuredContent.unrelated);
    });
  }
});

test("redacts quoted and exact-credential JSON suffixes across output layers", async (t) => {
  const objectKey = JSON.stringify({ credential: "fixture" });
  const arrayKey = JSON.stringify(["fixture"]);
  const cases = [
    ["quoted string", "synthetic-review-key", String.raw`"\u0073ynthetic-review-key"`, '"[REDACTED]"'],
    ["exact object credential", objectKey, objectKey, "[REDACTED]"],
    ["exact array credential", arrayKey, arrayKey, "[REDACTED]"],
  ];
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };

  for (const [label, secret, suffix, safeSuffix] of cases) {
    const diagnostic = `error: ${suffix}`;
    const safeDiagnostic = `error: ${safeSuffix}`;
    const structuredContent = {
      diagnostic,
      anotherLayer: JSON.stringify(diagnostic),
      nested: {
        doubleLayer: JSON.stringify(JSON.stringify(diagnostic)),
        values: [false, null, "safe"],
        count: 7,
      },
      unrelated: 'Keep "quotes", \\slashes, and\nnewlines.',
    };
    const safeStructuredContent = {
      ...structuredContent,
      diagnostic: safeDiagnostic,
      anotherLayer: JSON.stringify(safeDiagnostic),
      nested: {
        ...structuredContent.nested,
        doubleLayer: JSON.stringify(JSON.stringify(safeDiagnostic)),
      },
    };

    await t.test(`${label}: direct sanitizer`, () => {
      for (const [source, expected] of [
        [diagnostic, safeDiagnostic],
        [JSON.stringify(structuredContent), JSON.stringify(safeStructuredContent)],
      ]) {
        let encodedSource = source;
        let encodedExpected = expected;
        for (let layer = 0; layer < 4; layer++) {
          const sanitized = sanitizeOutput(encodedSource, secret);
          assert.equal(sanitized, encodedExpected, `layer ${layer}`);
          let decoded = sanitized;
          for (let depth = 0; depth < layer; depth++) decoded = JSON.parse(decoded);
          assert.equal(decoded, expected);
          assert.equal(decoded.includes(secret), false);
          encodedSource = JSON.stringify(encodedSource);
          encodedExpected = JSON.stringify(encodedExpected);
        }
      }

      for (const unchanged of ['error: "unfinished', 'error: {"safe":', "error: [false", 'error: "safe" trailing']) {
        assert.equal(sanitizeOutput(unchanged, secret), unchanged);
      }
    });

    for (const [format, payload, expected] of [
      ["text", { content: [{ type: "text", text: diagnostic }] }, safeDiagnostic],
      ["nested", { structuredContent }, JSON.stringify(safeStructuredContent, null, 2)],
    ]) {
      for (const isError of [false, true]) {
        await t.test(`${label}: ${format} ${isError ? "error" : "success"}`, async () => {
          const result = await execute(["call", tool.name], {
            env: { ...offlineEnv(), OUTPOUR_API_KEY: secret },
            tools: [tool],
            callResult: { ...payload, isError },
          });
          const prefix = isError ? "Tool call failed: " : "";
          assert.equal(result.status, isError ? 1 : 0);
          assert.deepEqual(result.stdout, isError ? [] : [expected]);
          assert.deepEqual(result.stderr, isError ? [prefix + expected] : []);
          assert.equal(result.requests.at(-1).requestBody.method, "tools/call");

          const output = (isError ? result.stderr[0] : result.stdout[0]).slice(prefix.length);
          if (format === "nested") {
            const value = JSON.parse(output);
            assert.deepEqual(value, safeStructuredContent);
            assert.equal(value.diagnostic, safeDiagnostic);
            assert.equal(JSON.parse(value.anotherLayer), safeDiagnostic);
            assert.equal(JSON.parse(JSON.parse(value.nested.doubleLayer)), safeDiagnostic);
          } else if (safeSuffix.startsWith('"')) {
            const credential = JSON.parse(output.slice("error: ".length));
            assert.equal(credential, "[REDACTED]");
            assert.equal(credential.includes(secret), false);
          } else {
            assert.equal(output.slice("error: ".length), "[REDACTED]");
          }
        });
      }
    }
  }
});

test("redacts credentials crossing internal JSON suffix boundaries", async (t) => {
  const cases = [
    ["quoted tail", "synthetic-", '"fixture"'],
    ["quoted tail with escaped content", "synthetic-", String.raw`"fixture\"quoted"`],
    ["object tail", "synthetic-", '{"fixture":7}'],
    ["nested object tail", "synthetic-", '{"fixture":{"values":[false,null,7]}}'],
    ["array tail", "synthetic-", '["fixture"]'],
    ["nested array tail", "synthetic-", '[{"fixture":7},false,null]'],
    ["backslash prefix and empty object", "synthetic-\\", "{}"],
    ["control prefix and numeric array", "synthetic-\n", "[7,false,null]"],
    ["trailing whitespace", "synthetic-", '"fixture" \t'],
  ];
  const tool = { name: "read_tool", annotations: { readOnlyHint: true } };
  const safeDiagnostic = "echo [REDACTED]";

  for (const [label, prefix, tail] of cases) {
    const secret = prefix + tail;
    const fixtures = [];
    let spelling = secret;
    for (let escapeDepth = 0; escapeDepth < 3; escapeDepth++) {
      const diagnostic = `echo ${spelling}`;
      const structuredContent = {
        diagnostic,
        anotherLayer: JSON.stringify(diagnostic),
        nested: {
          doubleLayer: JSON.stringify(JSON.stringify(diagnostic)),
          values: [false, null, "safe"],
          count: 7,
        },
        unrelated: { prefix, tail },
      };
      const safeStructuredContent = {
        ...structuredContent,
        diagnostic: safeDiagnostic,
        anotherLayer: JSON.stringify(safeDiagnostic),
        nested: {
          ...structuredContent.nested,
          doubleLayer: JSON.stringify(JSON.stringify(safeDiagnostic)),
        },
      };
      fixtures.push({ diagnostic, structuredContent, safeStructuredContent });
      spelling = JSON.stringify(spelling).slice(1, -1);
    }

    await t.test(`${label}: direct sanitizer`, () => {
      for (const { diagnostic, structuredContent, safeStructuredContent } of fixtures) {
        for (const [source, expected] of [
          [diagnostic, safeDiagnostic],
          [JSON.stringify(structuredContent), JSON.stringify(safeStructuredContent)],
        ]) {
          let encodedSource = source;
          let encodedExpected = expected;
          for (let layer = 0; layer < 4; layer++) {
            const sanitized = sanitizeOutput(encodedSource, secret);
            assert.equal(sanitized, encodedExpected, `layer ${layer}`);
            let decoded = sanitized;
            for (let depth = 0; depth < layer; depth++) decoded = JSON.parse(decoded);
            assert.equal(decoded, expected);
            encodedSource = JSON.stringify(encodedSource);
            encodedExpected = JSON.stringify(encodedExpected);
          }
        }
      }
    });

    for (const format of ["text", "nested"]) {
      for (const isError of [false, true]) {
        await t.test(`${label}: ${format} ${isError ? "error" : "success"}`, async () => {
          for (const { diagnostic, structuredContent, safeStructuredContent } of fixtures) {
            const payload = format === "text"
              ? { content: [{ type: "text", text: diagnostic }] }
              : { structuredContent };
            const expected = format === "text"
              ? safeDiagnostic
              : JSON.stringify(safeStructuredContent, null, 2);
            const result = await execute(["call", tool.name], {
              env: { ...offlineEnv(), OUTPOUR_API_KEY: secret },
              tools: [tool],
              callResult: { ...payload, isError },
            });
            const errorPrefix = isError ? "Tool call failed: " : "";
            assert.equal(result.status, isError ? 1 : 0);
            assert.deepEqual(result.stdout, isError ? [] : [expected]);
            assert.deepEqual(result.stderr, isError ? [errorPrefix + expected] : []);
            assert.equal(result.requests.at(-1).requestBody.method, "tools/call");

            if (format === "nested") {
              const output = (isError ? result.stderr[0] : result.stdout[0]).slice(errorPrefix.length);
              const value = JSON.parse(output);
              assert.deepEqual(value, safeStructuredContent);
              assert.equal(value.diagnostic, safeDiagnostic);
              assert.equal(JSON.parse(value.anotherLayer), safeDiagnostic);
              assert.equal(JSON.parse(JSON.parse(value.nested.doubleLayer)), safeDiagnostic);
            }
          }
        });
      }
    }
  }
});
