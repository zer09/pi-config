import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_RECOVERY_PROMPT } from "./instructions.ts";
import {
  classifyProviderFailure,
  RpcJsonlProtocol,
  serializePromptCommand,
  type ControlCommand,
  type ControlResult,
  type ProtocolRecord,
} from "./protocol.ts";

function feed(protocol: RpcJsonlProtocol, chunks: Buffer[]): ProtocolRecord[] {
  const records: ProtocolRecord[] = [];
  for (const chunk of chunks) protocol.feed(chunk, (record) => records.push(record));
  return records;
}

const CONTROL_MODEL = { provider: "fixture-provider", id: "org/fixture-model:tag" };
const NAMESPACE_CONTROL_MODELS = [
  { provider: "cloudflare-workers-ai", id: "@cf/openai/gpt-oss-120b" },
  { provider: "cloudflare-ai-gateway", id: "workers-ai/@cf/openai/gpt-oss-120b" },
  { provider: "nano-gpt", id: "~anthropic/claude-sonnet-latest" },
  { provider: "fixture-provider", id: "Org/@Scoped/Model:Tag+Variant" },
  { provider: "fixture-provider", id: `@${"m".repeat(511)}` },
  { provider: "fixture-provider", id: `~${"m".repeat(511)}` },
];
const CONTROL_STATE = {
  model: CONTROL_MODEL,
  thinkingLevel: "high" as const,
  isStreaming: false,
  isCompacting: false,
  messageCount: 4,
  pendingMessageCount: 0,
};

function controlReply(protocol: RpcJsonlProtocol, id: string, command: ControlCommand["type"], data?: unknown): ProtocolRecord[] {
  return feed(protocol, [Buffer.from(`${JSON.stringify({ id, type: "response", command, success: true, data })}\n`)]);
}

function acceptSettledPrompt(protocol: RpcJsonlProtocol, id: string, round: 1 | 2 = 1): void {
  assert.deepEqual(feed(protocol, [Buffer.from(
    `${JSON.stringify({ type: "response", id, command: "prompt", success: true })}\n{"type":"agent_settled"}\n`,
  )]), [
    { kind: "prompt_accepted", round }, { kind: "event", round, event: { type: "agent_settled" } },
  ]);
}

test("serializes all five correlated controls and emits only allowlisted results", () => {
  const protocol = new RpcJsonlProtocol();
  const results: ControlResult[] = [];
  const model = {
    ...CONTROL_MODEL,
    name: "PRIVATE_NAME",
    baseUrl: "https://private.example.invalid",
    headers: { authorization: "PRIVATE_HEADER" },
    apiKey: "PRIVATE_KEY",
    compat: { payload: "PRIVATE_PAYLOAD" },
  };
  const cases: ReadonlyArray<[ControlCommand, unknown, object]> = [
    [{ type: "get_state" }, { ...CONTROL_STATE, model, sessionFile: "/private/session.jsonl", sessionId: "PRIVATE_ID" }, CONTROL_STATE],
    [{ type: "get_available_models" }, { models: [model], extra: "PRIVATE_EXTRA" }, { models: [CONTROL_MODEL] }],
    [{ type: "set_model", provider: CONTROL_MODEL.provider, modelId: CONTROL_MODEL.id }, model, CONTROL_MODEL],
    [{ type: "get_session_stats" }, { totalMessages: 7, tokens: { input: 12 }, cost: 0.3, sessionFile: "/private/session.jsonl" }, { totalMessages: 7 }],
  ];
  for (const [command, data, expected] of cases) {
    const id = `route-2:${command.type}`;
    assert.equal(protocol.beginControl(id, command, (result) => results.push(result)), `${JSON.stringify({ id, ...command })}\n`);
    assert.deepEqual(controlReply(protocol, id, command.type, data), []);
    assert.deepEqual(results.at(-1), { id, success: true, command: command.type, data: expected });
  }
  const id = "route-2:set-thinking";
  assert.equal(
    protocol.beginControl(id, { type: "set_thinking_level", level: "xhigh" }, (result) => results.push(result)),
    '{"id":"route-2:set-thinking","type":"set_thinking_level","level":"xhigh"}\n',
  );
  assert.deepEqual(controlReply(protocol, id, "set_thinking_level"), []);
  assert.deepEqual(results.at(-1), { id, success: true, command: "set_thinking_level" });
  assert.equal(results.length, 5);
  assert.doesNotMatch(JSON.stringify([results, protocol]), /PRIVATE|private|baseUrl|apiKey|headers|compat|tokens|cost|sessionFile/);
  protocol.finish((record) => assert.fail(JSON.stringify(record)));
});

test("control state preserves busy flags, queue counts, null models, and exact thinking levels", () => {
  const protocol = new RpcJsonlProtocol();
  for (const [index, level] of ["off", "minimal", "low", "medium", "high", "xhigh", "max"].entries()) {
    const id = `route-${index}:state`;
    const state = { ...CONTROL_STATE, model: null, thinkingLevel: level, isStreaming: true, isCompacting: true, pendingMessageCount: 2 };
    protocol.beginControl(id, { type: "get_state" }, (result) => {
      assert.deepEqual(result, { id, success: true, command: "get_state", data: state });
    });
    assert.deepEqual(controlReply(protocol, id, "get_state", state), []);
    const thinkingId = `route-${index}:thinking`;
    const command = { type: "set_thinking_level", level } as ControlCommand;
    protocol.beginControl(thinkingId, command, (result) => {
      assert.deepEqual(result, { id: thinkingId, success: true, command: "set_thinking_level" });
    });
    assert.deepEqual(controlReply(protocol, thinkingId, "set_thinking_level"), []);
  }
  protocol.beginControl("unset-model", { type: "get_state" }, (result) => {
    assert.deepEqual(result, { id: "unset-model", success: true, command: "get_state", data: { ...CONTROL_STATE, model: null } });
  });
  assert.deepEqual(controlReply(protocol, "unset-model", "get_state", { ...CONTROL_STATE, model: undefined }), []);
});

test("control model catalogs allow empty arrays and the same model on distinct providers", () => {
  for (const models of [[], [CONTROL_MODEL, { ...CONTROL_MODEL, provider: "other-provider" }]]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginControl("catalog", { type: "get_available_models" }, (result) => {
      assert.deepEqual(result, { id: "catalog", success: true, command: "get_available_models", data: { models } });
    });
    assert.deepEqual(controlReply(protocol, "catalog", "get_available_models", { models }), []);
  }
});

test("set_model preserves exact bounded model namespace IDs", () => {
  for (const model of NAMESPACE_CONTROL_MODELS) {
    const protocol = new RpcJsonlProtocol();
    const results: ControlResult[] = [];
    const command = { type: "set_model", provider: model.provider, modelId: model.id } as const;
    assert.equal(protocol.beginControl("model", command, (result) => results.push(result)), `${JSON.stringify({ id: "model", ...command })}\n`);
    assert.deepEqual(controlReply(protocol, "model", "set_model", { ...model, apiKey: "PRIVATE_KEY" }), []);
    assert.deepEqual(results, [{ id: "model", command: "set_model", success: true, data: model }]);
    assert.doesNotMatch(JSON.stringify([results, protocol]), /PRIVATE|apiKey/);
  }
});

test("get_state preserves exact bounded model namespace IDs", () => {
  for (const model of NAMESPACE_CONTROL_MODELS) {
    const protocol = new RpcJsonlProtocol();
    const results: ControlResult[] = [];
    protocol.beginControl("state", { type: "get_state" }, (result) => results.push(result));
    const state = { ...CONTROL_STATE, model };
    assert.deepEqual(controlReply(protocol, "state", "get_state", { ...state, model: { ...model, apiKey: "PRIVATE_KEY" } }), []);
    assert.deepEqual(results, [{ id: "state", command: "get_state", success: true, data: state }]);
    assert.doesNotMatch(JSON.stringify([results, protocol]), /PRIVATE|apiKey/);
  }
});

test("get_available_models preserves exact bounded model namespace IDs in mixed catalogs", () => {
  const models = [CONTROL_MODEL, ...NAMESPACE_CONTROL_MODELS, { ...NAMESPACE_CONTROL_MODELS[0], provider: "other-provider" }];
  const protocol = new RpcJsonlProtocol();
  const results: ControlResult[] = [];
  protocol.beginControl("catalog", { type: "get_available_models" }, (result) => results.push(result));
  assert.deepEqual(controlReply(protocol, "catalog", "get_available_models", {
    models: models.map((model) => ({ ...model, apiKey: "PRIVATE_KEY" })),
  }), []);
  assert.deepEqual(results, [{ id: "catalog", command: "get_available_models", success: true, data: { models } }]);
  assert.doesNotMatch(JSON.stringify([results, protocol]), /PRIVATE|apiKey/);
});

test("model namespace IDs keep providers narrow and reject malformed or unsafe identities", () => {
  const invalidModels = [
    ...[
      "@", "~", "@/model", "~/model", "@@cf/model", "~~anthropic/model", "workers-ai/@/model", "workers-ai/~/model",
      "model@host", "user:PRIVATE_CREDENTIAL@private.example.invalid/model",
      "@cf/model?token=PRIVATE_KEY", "~anthropic/model#PRIVATE_FRAGMENT", "@cf/model%3Ftoken%3DPRIVATE_KEY",
      "@cf/model token", "@cf/é", "~anthropic/model\u0000", "@cf/model\n", "@cf/model\r", "~anthropic/model\u2028",
      "@cf/https://private.example.invalid", "Authorization: Bearer PRIVATE_HEADER", "token=PRIVATE_KEY",
      `@${"m".repeat(512)}`, `~${"m".repeat(512)}`,
    ].map((id) => ({ ...CONTROL_MODEL, id })),
    ...NAMESPACE_CONTROL_MODELS.map(({ id }) => ({ ...CONTROL_MODEL, provider: id })),
  ];
  for (const model of invalidModels) {
    const protocol = new RpcJsonlProtocol();
    assert.throws(() => protocol.beginControl("model", {
      type: "set_model", provider: model.provider, modelId: model.id,
    }, () => assert.fail("invalid request accepted")), { message: "RPC control command is invalid" });
    assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE|private/);
    const cases: ReadonlyArray<[ControlCommand, unknown]> = [
      [{ type: "get_state" }, { ...CONTROL_STATE, model }],
      [{ type: "get_available_models" }, { models: [CONTROL_MODEL, ...NAMESPACE_CONTROL_MODELS, model] }],
      [{ type: "set_model", provider: CONTROL_MODEL.provider, modelId: CONTROL_MODEL.id }, model],
    ];
    for (const [command, data] of cases) {
      const responseProtocol = new RpcJsonlProtocol();
      responseProtocol.beginControl("model", command, () => assert.fail("invalid identity accepted"));
      const records = controlReply(responseProtocol, "model", command.type, data);
      assert.deepEqual(records, [{ kind: "protocol_error", category: "malformed_control_data" }]);
      assert.doesNotMatch(JSON.stringify([records, responseProtocol]), /PRIVATE|private/);
    }
  }
});

test("rejected controls expose only a fixed category and consume their IDs", () => {
  const commands: ControlCommand[] = [
    { type: "get_state" }, { type: "get_available_models" }, { type: "get_session_stats" },
    { type: "set_model", provider: CONTROL_MODEL.provider, modelId: CONTROL_MODEL.id },
    { type: "set_thinking_level", level: "high" },
  ];
  for (const command of commands) {
    const protocol = new RpcJsonlProtocol();
    const results: ControlResult[] = [];
    protocol.beginControl("route-1:step", command, (result) => results.push(result));
    const records = feed(protocol, [Buffer.from(`${JSON.stringify({
      type: "response", id: "route-1:step", command: command.type, success: false,
      error: "PRIVATE_PROVIDER_ERROR 401 https://private.example.invalid PRIVATE_CREDENTIAL",
      data: { headers: "PRIVATE_HEADERS", payload: "PRIVATE_PAYLOAD" },
    })}\n`)]);
    assert.deepEqual(records, []);
    assert.deepEqual(results, [{ id: "route-1:step", command: command.type, success: false, category: "command_rejected" }]);
    assert.doesNotMatch(JSON.stringify([results, protocol]), /PRIVATE|private|401|error|headers|payload/);
    assert.throws(() => protocol.beginControl("route-1:step", command, () => {}), { message: "RPC control ID is invalid or already used" });
    protocol.beginControl("route-2:step", { type: "get_state" }, () => {});
    assert.deepEqual(controlReply(protocol, "route-2:step", "get_state", CONTROL_STATE), []);
  }
});

test("control IDs are bounded, nonblank, deterministic, and separate from prompt IDs", () => {
  for (const id of [undefined, null, 7, "", " ", "\t", "a\n", "a\r", "a\u2028", "a\u2029", "a b", "é", "a\u0000", "x".repeat(101), "prompt-1", "prompt-2", "https://private.example.invalid"]) {
    const protocol = new RpcJsonlProtocol();
    assert.throws(() => protocol.beginControl(id as string, { type: "get_state" }, () => {}), {
      message: "RPC control ID is invalid or already used",
    });
    assert.doesNotMatch(JSON.stringify(protocol), /private/);
  }
  for (const id of ["a", "r".repeat(100), "route-12.step_3:verify-state"]) {
    const protocol = new RpcJsonlProtocol();
    assert.equal(protocol.beginControl(id, { type: "get_state" }, () => {}), `${JSON.stringify({ id, type: "get_state" })}\n`);
    assert.deepEqual(controlReply(protocol, id, "get_state", CONTROL_STATE), []);
    assert.throws(() => protocol.beginControl(id, { type: "get_state" }, () => {}), {
      message: "RPC control ID is invalid or already used",
    });
  }
});

test("invalid control commands fail before serialization and never retain extra arguments", () => {
  const invalid: unknown[] = [
    undefined, null, [], "get_state", {}, { type: "prompt" }, { type: "abort" }, { type: "get_messages" },
    { type: "get_state", id: "PRIVATE_ID" }, { type: "get_available_models", headers: "PRIVATE_HEADERS" },
    { type: "get_session_stats", extra: "PRIVATE_EXTRA" },
    { type: "set_model", provider: "fixture-provider" },
    { type: "set_model", provider: "", modelId: "model" },
    { type: "set_model", provider: "provider", modelId: "model\n" },
    { type: "set_model", provider: "provider", modelId: "https://private.example.invalid" },
    { type: "set_model", provider: "provider", modelId: "model", apiKey: "PRIVATE_KEY" },
    { type: "set_thinking_level" }, { type: "set_thinking_level", level: null },
    { type: "set_thinking_level", level: "HIGH" }, { type: "set_thinking_level", level: "high " },
    { type: "set_thinking_level", level: "unknown" }, { type: "set_thinking_level", level: "off", payload: "PRIVATE_PAYLOAD" },
  ];
  for (const command of invalid) {
    const protocol = new RpcJsonlProtocol();
    assert.throws(() => protocol.beginControl("step", command as ControlCommand, () => {}), { message: "RPC control command is invalid" });
    assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE|private/);
    protocol.beginControl("step", { type: "get_state" }, () => {});
    assert.deepEqual(controlReply(protocol, "step", "get_state", CONTROL_STATE), []);
  }
});

test("control requests copy only validated command fields before correlation", () => {
  const protocol = new RpcJsonlProtocol();
  const command = { type: "set_model", provider: CONTROL_MODEL.provider, modelId: CONTROL_MODEL.id } as const;
  const results: ControlResult[] = [];
  protocol.beginControl("set-model", command, (result) => results.push(result));
  Object.assign(command, { provider: "PRIVATE_MUTATION", apiKey: "PRIVATE_KEY" });
  assert.deepEqual(controlReply(protocol, "set-model", "set_model", CONTROL_MODEL), []);
  assert.deepEqual(results, [{ id: "set-model", command: "set_model", success: true, data: CONTROL_MODEL }]);
  assert.doesNotMatch(JSON.stringify([protocol, results]), /PRIVATE/);
});

test("control responses reject malformed envelopes, wrong IDs, and wrong commands without payload leakage", () => {
  const cases: ReadonlyArray<[object, string]> = [
    [{ id: undefined }, "malformed_response"], [{ id: null }, "malformed_response"], [{ id: 1 }, "malformed_response"],
    [{ id: "" }, "malformed_response"], [{ id: " " }, "malformed_response"], [{ id: "x".repeat(101) }, "malformed_response"],
    [{ id: "route-2:future" }, "unknown_response"], [{ id: "step\n" }, "unknown_response"],
    [{ id: "prompt-1" }, "unknown_response"], [{ id: "prompt-2" }, "unknown_response"],
    [{ command: undefined }, "malformed_response"], [{ command: 1 }, "malformed_response"],
    [{ command: "get_messages" }, "malformed_response"], [{ command: "parse" }, "malformed_response"],
    [{ command: "prompt" }, "mismatched_control_response"], [{ command: "set_model" }, "mismatched_control_response"],
    [{ success: undefined }, "malformed_response"], [{ success: "true" }, "malformed_response"],
    [{ success: 1 }, "malformed_response"], [{ success: null }, "malformed_response"],
    [{ success: false }, "malformed_response"], [{ success: false, error: {} }, "malformed_response"],
    [{ success: false, error: null }, "malformed_response"], [{ success: true, error: "PRIVATE_ERROR" }, "malformed_response"],
  ];
  for (const [patch, category] of cases) {
    const protocol = new RpcJsonlProtocol();
    const results: ControlResult[] = [];
    protocol.beginControl("step", { type: "get_state" }, (result) => results.push(result));
    const records = feed(protocol, [Buffer.from(`${JSON.stringify({
      type: "response", id: "step", command: "get_state", success: true,
      data: { ...CONTROL_STATE, secret: "PRIVATE_PAYLOAD" }, ...patch,
    })}\n{"type":"PRIVATE_TRAILING_RECORD"}\n`)]);
    assert.deepEqual(records, [{ kind: "protocol_error", category }]);
    assert.deepEqual(controlReply(protocol, "step", "get_state", CONTROL_STATE), []);
    protocol.finish((record) => records.push(record));
    assert.equal(records.length, 1);
    assert.deepEqual(results, []);
    assert.doesNotMatch(JSON.stringify([records, protocol]), /PRIVATE|PRIVATE_TRAILING_RECORD/);
    assert.throws(() => protocol.beginControl("new-step", { type: "get_state" }, () => {}));
    assert.throws(() => protocol.beginPrompt(1, "task"));
  }
});

test("control responses require the documented data container or a data-free thinking acknowledgement", () => {
  for (const command of ["get_state", "get_available_models", "get_session_stats"] as const) {
    for (const data of [undefined, null, [], "PRIVATE_PAYLOAD", 3, true, {}]) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginControl("step", { type: command }, () => assert.fail("malformed data reached the callback"));
      assert.deepEqual(controlReply(protocol, "step", command, data), [{ kind: "protocol_error", category: "malformed_control_data" }]);
    }
  }
  for (const data of [null, {}, [], { level: "high" }, "PRIVATE_PAYLOAD", false, 0]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginControl("step", { type: "set_thinking_level", level: "high" }, () => assert.fail("malformed acknowledgement"));
    assert.deepEqual(controlReply(protocol, "step", "set_thinking_level", data), [{ kind: "protocol_error", category: "malformed_control_data" }]);
  }
});

test("state and history counts reject missing, coerced, negative, fractional, and unsafe values", () => {
  for (const value of [undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "1", false, {}, []]) {
    for (const field of ["messageCount", "pendingMessageCount", "totalMessages"]) {
      const protocol = new RpcJsonlProtocol();
      const command = field === "totalMessages" ? "get_session_stats" : "get_state";
      protocol.beginControl("step", { type: command }, () => assert.fail("invalid count accepted"));
      assert.deepEqual(controlReply(protocol, "step", command, { ...CONTROL_STATE, [field]: value }), [
        { kind: "protocol_error", category: "malformed_control_data" },
      ]);
    }
  }
  for (const count of [0, Number.MAX_SAFE_INTEGER]) {
    const protocol = new RpcJsonlProtocol();
    const results: ControlResult[] = [];
    protocol.beginControl("stats", { type: "get_session_stats" }, (result) => results.push(result));
    assert.deepEqual(controlReply(protocol, "stats", "get_session_stats", { totalMessages: count }), []);
    assert.deepEqual(results, [{ id: "stats", command: "get_session_stats", success: true, data: { totalMessages: count } }]);
  }
});

test("state validation never defaults malformed idle flags or thinking levels", () => {
  for (const patch of [
    ...[undefined, null, 0, 1, "false", [], {}].flatMap((value) => [{ isStreaming: value }, { isCompacting: value }]),
    ...[undefined, null, 1, "", " ", "HIGH", "high\n", "unknown"].map((thinkingLevel) => ({ thinkingLevel })),
  ]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginControl("state", { type: "get_state" }, () => assert.fail("malformed state accepted"));
    assert.deepEqual(controlReply(protocol, "state", "get_state", { ...CONTROL_STATE, ...patch }), [
      { kind: "protocol_error", category: "malformed_control_data" },
    ]);
  }
});

test("model validation rejects malformed identities in state, catalogs, and set_model", () => {
  const malformedModels: unknown[] = [
    [], "PRIVATE_PAYLOAD", 1, true, {},
    ...[undefined, null, 7, "", " ", "a\n", "a\r", "a\u2028", "a\u2029", "é", "a\u0000", "x".repeat(513), "https://private.example.invalid", "Bearer PRIVATE_HEADER", "token=PRIVATE_KEY"]
      .flatMap((value) => [{ ...CONTROL_MODEL, provider: value }, { ...CONTROL_MODEL, id: value }]),
  ];
  for (const model of malformedModels) {
    const commands: ReadonlyArray<[ControlCommand, unknown]> = [
      [{ type: "get_state" }, { ...CONTROL_STATE, model }],
      [{ type: "get_available_models" }, { models: [CONTROL_MODEL, model] }],
      [{ type: "set_model", provider: CONTROL_MODEL.provider, modelId: CONTROL_MODEL.id }, model],
    ];
    for (const [command, data] of commands) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginControl("model", command, () => assert.fail("malformed model accepted"));
      const records = controlReply(protocol, "model", command.type, data);
      assert.deepEqual(records, [{ kind: "protocol_error", category: "malformed_control_data" }]);
      assert.doesNotMatch(JSON.stringify([records, protocol]), /PRIVATE|private/);
    }
  }
  const model = { provider: "p".repeat(512), id: "m".repeat(512) };
  const protocol = new RpcJsonlProtocol();
  protocol.beginControl("model", { type: "set_model", provider: model.provider, modelId: model.id }, (result) => {
    assert.deepEqual(result, { id: "model", command: "set_model", success: true, data: model });
  });
  assert.deepEqual(controlReply(protocol, "model", "set_model", model), []);
});

test("set_model requires an exact provider and model match without normalization", () => {
  for (const model of [undefined, null, { ...CONTROL_MODEL, provider: "other" }, { ...CONTROL_MODEL, id: "other" }, { ...CONTROL_MODEL, provider: "Fixture-provider" }]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginControl("model", { type: "set_model", provider: CONTROL_MODEL.provider, modelId: CONTROL_MODEL.id }, () => assert.fail("wrong model accepted"));
    assert.deepEqual(controlReply(protocol, "model", "set_model", model), [{ kind: "protocol_error", category: "malformed_control_data" }]);
  }
});

test("model catalogs reject malformed arrays, null entries, and duplicate provider/model pairs", () => {
  for (const models of [undefined, null, {}, "models", 1, [null], [CONTROL_MODEL, CONTROL_MODEL]]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginControl("catalog", { type: "get_available_models" }, () => assert.fail("malformed catalog accepted"));
    assert.deepEqual(controlReply(protocol, "catalog", "get_available_models", { models }), [{ kind: "protocol_error", category: "malformed_control_data" }]);
  }
});

test("controls reject duplicate and stale responses after success or rejection, including across a prompt round", () => {
  for (const success of [true, false]) {
    for (const next of ["none", "control", "prompt"] as const) {
      const protocol = new RpcJsonlProtocol();
      const results: ControlResult[] = [];
      protocol.beginControl("old-step", { type: "get_state" }, (result) => results.push(result));
      const response = Buffer.from(`${JSON.stringify({
        type: "response", id: "old-step", command: "get_state", success,
        data: CONTROL_STATE, ...(success ? {} : { error: "PRIVATE_ERROR" }),
      })}\n`);
      assert.deepEqual(feed(protocol, [response]), []);
      if (next === "control") protocol.beginControl("new-step", { type: "get_state" }, () => assert.fail("stale response accepted"));
      if (next === "prompt") protocol.beginPrompt(1, "task");
      assert.deepEqual(feed(protocol, [response]), [{ kind: "protocol_error", category: "duplicate_response" }]);
      assert.equal(results.length, 1);
    }
  }
});

test("unsolicited and out-of-order controls never accept a future or prompt ID", () => {
  const unsolicited = new RpcJsonlProtocol();
  assert.deepEqual(controlReply(unsolicited, "future-step", "get_state", CONTROL_STATE), [
    { kind: "protocol_error", category: "unexpected_control_response" },
  ]);
  const pendingPrompt = new RpcJsonlProtocol();
  pendingPrompt.beginPrompt(1, "task");
  assert.deepEqual(controlReply(pendingPrompt, "prompt-1", "get_state", CONTROL_STATE), [
    { kind: "protocol_error", category: "unexpected_control_response" },
  ]);
  const pendingControl = new RpcJsonlProtocol();
  pendingControl.beginControl("first-step", { type: "get_state" }, () => assert.fail("future response accepted"));
  assert.deepEqual(controlReply(pendingControl, "second-step", "get_state", CONTROL_STATE), [
    { kind: "protocol_error", category: "unknown_response" },
  ]);
});

test("controls are exclusive with pending commands and wait for prompt settlement", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginControl("initial-state", { type: "get_state" }, () => {});
  assert.throws(() => protocol.beginControl("next-state", { type: "get_state" }, () => {}));
  assert.throws(() => protocol.beginPrompt(1, "task"));
  assert.deepEqual(controlReply(protocol, "initial-state", "get_state", CONTROL_STATE), []);
  protocol.beginPrompt(1, "task");
  assert.throws(() => protocol.beginControl("next-state", { type: "get_state" }, () => {}));
  feed(protocol, [Buffer.from('{"type":"response","id":"prompt-1","command":"prompt","success":true}\n')]);
  assert.throws(() => protocol.beginControl("next-state", { type: "get_state" }, () => {}));
  feed(protocol, [Buffer.from('{"type":"agent_start"}\n{"type":"agent_end","willRetry":false}\n')]);
  assert.throws(() => protocol.beginControl("next-state", { type: "get_state" }, () => {}));
  feed(protocol, [Buffer.from('{"type":"agent_settled"}\n')]);
  protocol.beginControl("next-state", { type: "get_state" }, () => {});
  assert.throws(() => protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT));
  assert.deepEqual(controlReply(protocol, "next-state", "get_state", CONTROL_STATE), []);
  assert.equal(protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT), serializePromptCommand(2, REPORT_RECOVERY_PROMPT));
  const records = feed(protocol, [Buffer.from(
    '{"type":"agent_start"}\n{"type":"response","id":"prompt-2","command":"prompt","success":true}\n'
      + '{"type":"agent_end","willRetry":false}\n{"type":"agent_settled"}\n',
  )]);
  assert.deepEqual(records.map((record) => record.kind), ["prompt_accepted", "event", "event", "event"]);
  for (const record of records) if (record.kind === "event" || record.kind === "prompt_accepted") assert.equal(record.round, 2);
  for (const round of [1, 2, 3]) assert.throws(() => protocol.beginPrompt(round as 1 | 2, "no third prompt"));
});

test("controls do not establish a first prompt round or turn a prompt rejection into acceptance", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginControl("state", { type: "get_state" }, () => {});
  controlReply(protocol, "state", "get_state", CONTROL_STATE);
  assert.throws(() => protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT));
  protocol.beginPrompt(1, "task");
  assert.deepEqual(feed(protocol, [Buffer.from(
    '{"type":"agent_start"}\n{"type":"response","id":"prompt-1","command":"prompt","success":false,"error":"PRIVATE"}\n',
  )]), [{ kind: "prompt_rejected", round: 1, category: "command_rejected" }]);
  assert.throws(() => protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT));
  protocol.beginControl("after-rejection", { type: "get_state" }, () => {});
  assert.deepEqual(controlReply(protocol, "after-rejection", "get_state", CONTROL_STATE), []);
});

test("every non-UI event fails closed during controls instead of becoming prompt activity", () => {
  const types = [
    "agent_start", "agent_end", "agent_settled", "turn_start", "turn_end", "message_start", "message_update", "message_end",
    "tool_execution_start", "tool_execution_update", "tool_execution_end", "queue_update", "compaction_start", "compaction_end",
    "auto_retry_start", "auto_retry_end", "summarization_retry_scheduled", "summarization_retry_attempt_start",
    "summarization_retry_finished", "extension_error", "bash_execution_update", "unknown_event", "session",
  ];
  for (const settledRound of [false, true]) {
    for (const type of types) {
      const protocol = new RpcJsonlProtocol();
      if (settledRound) {
        protocol.beginPrompt(1, "task");
        feed(protocol, [Buffer.from('{"type":"response","id":"prompt-1","command":"prompt","success":true}\n{"type":"agent_settled"}\n')]);
      }
      protocol.beginControl("state", { type: "get_state" }, () => assert.fail("event accepted during control"));
      const records = feed(protocol, [Buffer.from(`${JSON.stringify({ type, id: "state", error: "PRIVATE_ERROR", payload: "PRIVATE_PAYLOAD" })}\n`)]);
      assert.deepEqual(records, [{ kind: "protocol_error", category: "event_during_control" }]);
      assert.doesNotMatch(JSON.stringify([records, protocol]), /PRIVATE/);
      assert.deepEqual(controlReply(protocol, "state", "get_state", CONTROL_STATE), []);
    }
  }
});

for (const next of ["prompt", "control"] as const) {
  test(`decoded prompt replay rejects reentrant ${next} transitions before the final callback`, () => {
    for (const separateResponse of [false, true]) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginPrompt(1, "task");
      const events = [
        { type: "agent_start" }, { type: "agent_end", willRetry: false }, { type: "agent_settled" },
        { type: "message_update", payload: "PRIVATE_PAYLOAD" }, { type: "agent_settled" },
      ];
      const buffered = events.map((event) => `${JSON.stringify(event)}\n`).join("");
      const response = '{"type":"response","id":"prompt-1","command":"prompt","success":true}\n';
      if (separateResponse) assert.deepEqual(feed(protocol, [Buffer.from(buffered)]), []);
      const records: ProtocolRecord[] = [];
      let rejected = 0;
      // The response LF is the final raw byte, but decoded events still await replay.
      protocol.feed(Buffer.from(separateResponse ? response : buffered + response), (record) => {
        records.push(record);
        if (records.length > events.length) return;
        if (next === "prompt") {
          assert.throws(() => protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT), {
            message: "RPC prompt cannot start in the current protocol state",
          });
        } else {
          assert.throws(() => protocol.beginControl("state", { type: "get_state" }, () => assert.fail("rejected control accepted")), {
            message: "RPC control cannot start in the current protocol state",
          });
        }
        rejected += 1;
      });
      assert.equal(rejected, events.length);
      assert.deepEqual(records, [
        { kind: "prompt_accepted", round: 1 },
        ...events.map((event) => ({ kind: "event", round: 1, event })),
      ]);
      assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE/);
      // Rejection neither consumes the next ID nor leaves replay bookkeeping behind.
      if (next === "prompt") {
        assert.equal(protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT), serializePromptCommand(2, REPORT_RECOVERY_PROMPT));
        assert.deepEqual(feed(protocol, [Buffer.from(
          '{"type":"response","id":"prompt-2","command":"prompt","success":true}\n{"type":"agent_settled"}\n',
        )]), [
          { kind: "prompt_accepted", round: 2 }, { kind: "event", round: 2, event: { type: "agent_settled" } },
        ]);
      } else {
        const results: ControlResult[] = [];
        assert.equal(protocol.beginControl("state", { type: "get_state" }, (result) => results.push(result)), '{"id":"state","type":"get_state"}\n');
        assert.deepEqual(controlReply(protocol, "state", "get_state", CONTROL_STATE), []);
        assert.deepEqual(results, [{ id: "state", command: "get_state", success: true, data: CONTROL_STATE }]);
      }
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  });
}

test("decoded prompt replay permits transitions from the final callback without later old records", () => {
  for (const next of ["prompt", "control"] as const) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    const records: ProtocolRecord[] = [];
    const results: ControlResult[] = [];
    let command: string | undefined;
    protocol.feed(Buffer.from(
      '{"type":"agent_start"}\n{"type":"agent_end","willRetry":false}\n{"type":"agent_settled"}\n'
        + '{"type":"response","id":"prompt-1","command":"prompt","success":true}\n',
    ), (record) => {
      assert.equal(command, undefined, "old record emitted after a successful transition");
      records.push(record);
      if (record.kind === "event" && record.event.type === "agent_settled") {
        if (next === "prompt") command = protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT);
        else command = protocol.beginControl("state", { type: "get_state" }, (result) => results.push(result));
      }
    });
    assert.deepEqual(records, [
      { kind: "prompt_accepted", round: 1 },
      { kind: "event", round: 1, event: { type: "agent_start" } },
      { kind: "event", round: 1, event: { type: "agent_end", willRetry: false } },
      { kind: "event", round: 1, event: { type: "agent_settled" } },
    ]);
    if (next === "prompt") {
      assert.equal(command, serializePromptCommand(2, REPORT_RECOVERY_PROMPT));
      assert.deepEqual(feed(protocol, [Buffer.from('{"type":"response","id":"prompt-2","command":"prompt","success":true}\n')]), [
        { kind: "prompt_accepted", round: 2 },
      ]);
      assert.throws(() => protocol.beginControl("state", { type: "get_state" }, () => {}));
      assert.deepEqual(feed(protocol, [Buffer.from('{"type":"agent_settled"}\n')]), [
        { kind: "event", round: 2, event: { type: "agent_settled" } },
      ]);
      assert.throws(() => protocol.beginPrompt(2, "already used"));
    } else {
      assert.equal(command, '{"id":"state","type":"get_state"}\n');
      assert.throws(() => protocol.beginControl("other", { type: "get_state" }, () => {}));
      assert.deepEqual(controlReply(protocol, "state", "get_state", CONTROL_STATE), []);
      assert.deepEqual(results, [{ id: "state", command: "get_state", success: true, data: CONTROL_STATE }]);
    }
    protocol.finish((record) => assert.fail(JSON.stringify(record)));
  }
});

for (const route of [1, 2]) {
  for (const buffered of [false, true]) {
    const delivery = buffered ? "replayed" : "raw";
    test(`route ${route} recovery waits for settlement after acceptance and ${delivery} events`, () => {
      const protocol = new RpcJsonlProtocol();
      protocol.beginPrompt(1, "task");
      if (route === 2) {
        acceptSettledPrompt(protocol, "prompt-1");
        protocol.beginFallbackPromptCycle(2, "continuation");
      }
      const prefix = route === 1 ? "" : "route-2:";
      const response = `${JSON.stringify({ type: "response", id: `${prefix}prompt-1`, command: "prompt", success: true })}\n`;
      const events = [
        { type: "agent_start" }, { type: "message_update", payload: "round-1-update" },
        { type: "tool_execution_start", toolCallId: "round-1-tool", toolName: "bash" },
        { type: "tool_execution_end", toolCallId: "round-1-tool", toolName: "bash" },
        { type: "agent_end", willRetry: false }, { type: "auto_retry_start" },
        { type: "compaction_end", willRetry: false },
      ];
      const lines = events.map((event) => `${JSON.stringify(event)}\n`);
      const records: ProtocolRecord[] = [];
      const rejectRecovery = (record: ProtocolRecord): void => {
        records.push(record);
        const before = JSON.stringify(protocol);
        assert.throws(() => protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT), {
          message: "RPC prompt cannot start in the current protocol state",
        });
        assert.equal(JSON.stringify(protocol), before);
      };
      if (buffered) assert.deepEqual(feed(protocol, [Buffer.from(lines.join(""))]), []);
      protocol.feed(Buffer.from(response), rejectRecovery);
      if (!buffered) {
        // Each LF ends a chunk, so raw bytes cannot hide a missing settlement guard.
        for (const line of lines) protocol.feed(Buffer.from(line), rejectRecovery);
      }
      assert.deepEqual(records, [{ kind: "prompt_accepted", round: 1 }, ...events.map((event) => ({ kind: "event", round: 1, event }))]);
      assert.throws(() => protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT));
      assert.deepEqual(feed(protocol, [Buffer.from('{"type":"agent_settled"}\n')]), [
        { kind: "event", round: 1, event: { type: "agent_settled" } },
      ]);
      const recoveryId = `${prefix}prompt-2`;
      assert.equal(protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT), `${JSON.stringify({ id: recoveryId, type: "prompt", message: REPORT_RECOVERY_PROMPT })}\n`);
      acceptSettledPrompt(protocol, recoveryId, 2);
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    });

    test(`route ${route} recovery starts only from the final ${delivery} settled callback`, () => {
      const protocol = new RpcJsonlProtocol();
      protocol.beginPrompt(1, "task");
      if (route === 2) {
        acceptSettledPrompt(protocol, "prompt-1");
        protocol.beginFallbackPromptCycle(2, "continuation");
      }
      const prefix = route === 1 ? "" : "route-2:";
      const response = `${JSON.stringify({ type: "response", id: `${prefix}prompt-1`, command: "prompt", success: true })}\n`;
      const events = [
        { type: "agent_start" }, { type: "agent_end", willRetry: false }, { type: "agent_settled" },
        { type: "message_update", payload: "round-1-tail" }, { type: "agent_settled" },
      ];
      const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
      if (buffered) assert.deepEqual(feed(protocol, [Buffer.from(lines)]), []);
      const records: ProtocolRecord[] = [];
      let command: string | undefined;
      protocol.feed(Buffer.from(buffered ? response : response + lines), (record) => {
        assert.equal(command, undefined, "old record emitted after a successful recovery transition");
        records.push(record);
        if (records.length <= events.length) {
          assert.throws(() => protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT), {
            message: "RPC prompt cannot start in the current protocol state",
          });
        } else command = protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT);
      });
      assert.deepEqual(records, [{ kind: "prompt_accepted", round: 1 }, ...events.map((event) => ({ kind: "event", round: 1, event }))]);
      const recoveryId = `${prefix}prompt-2`;
      assert.equal(command, `${JSON.stringify({ id: recoveryId, type: "prompt", message: REPORT_RECOVERY_PROMPT })}\n`);
      acceptSettledPrompt(protocol, recoveryId, 2);
      assert.throws(() => protocol.beginPrompt(2, "already used"));
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    });
  }
}

test("decoded prompt replay clears bookkeeping before terminal errors and stops old callbacks", () => {
  for (const boundary of ["prompt_accepted", "agent_settled"]) {
    for (const category of ["malformed_json", "partial_record"]) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginPrompt(1, "task");
      const records: ProtocolRecord[] = [];
      const emit = (record: ProtocolRecord): void => {
        records.push(record);
        if (record.kind === "protocol_error") {
          assert.equal(Reflect.get(protocol, "pendingReplayRecords"), 0);
          return;
        }
        if (record.kind !== boundary && !(record.kind === "event" && record.event.type === boundary)) return;
        assert.ok(Reflect.get(protocol, "pendingReplayRecords") > 0);
        if (category === "malformed_json") protocol.feed(Buffer.from("{nope}\n"), emit);
        else {
          protocol.feed(Buffer.from("{"), emit);
          protocol.finish(emit);
        }
      };
      protocol.feed(Buffer.from(
        '{"type":"agent_settled"}\n{"type":"message_update","payload":"PRIVATE_PAYLOAD"}\n'
          + '{"type":"response","id":"prompt-1","command":"prompt","success":true}\n',
      ), emit);
      assert.deepEqual(records, [
        { kind: "prompt_accepted", round: 1 },
        ...(boundary === "agent_settled" ? [{ kind: "event", round: 1, event: { type: "agent_settled" } }] : []),
        { kind: "protocol_error", category },
      ]);
      assert.equal(Reflect.get(protocol, "pendingReplayRecords"), 0);
      assert.doesNotMatch(JSON.stringify([records, protocol]), /PRIVATE/);
      assert.deepEqual(feed(protocol, [Buffer.from('{"type":"agent_settled"}\n')]), []);
      assert.throws(() => protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT));
      assert.throws(() => protocol.beginControl("state", { type: "get_state" }, () => {}));
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

test("decoded prompt replay clears bookkeeping when a callback throws", () => {
  for (const boundary of ["prompt_accepted", "agent_settled"]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    assert.throws(() => protocol.feed(Buffer.from(
      '{"type":"agent_settled"}\n{"type":"message_update","payload":"PRIVATE_PAYLOAD"}\n'
        + '{"type":"response","id":"prompt-1","command":"prompt","success":true}\n',
    ), (record) => {
      if (record.kind === boundary || (record.kind === "event" && record.event.type === boundary)) {
        assert.ok(Reflect.get(protocol, "pendingReplayRecords") > 0);
        throw new Error("callback failed");
      }
    }), { message: "callback failed" });
    assert.equal(Reflect.get(protocol, "pendingReplayRecords"), 0);
    assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE/);
    if (boundary === "prompt_accepted") {
      assert.throws(() => protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT));
      assert.deepEqual(feed(protocol, [Buffer.from('{"type":"agent_settled"}\n')]), [
        { kind: "event", round: 1, event: { type: "agent_settled" } },
      ]);
    }
    assert.equal(protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT), serializePromptCommand(2, REPORT_RECOVERY_PROMPT));
    assert.deepEqual(feed(protocol, [Buffer.from('{"type":"response","id":"prompt-2","command":"prompt","success":true}\n')]), [
      { kind: "prompt_accepted", round: 2 },
    ]);
    protocol.finish((record) => assert.fail(JSON.stringify(record)));
  }
});

test("control callbacks cannot issue a command across already buffered response bytes", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginControl("first", { type: "get_state" }, () => {
    assert.throws(() => protocol.beginControl("second", { type: "get_state" }, () => {}));
  });
  const records = feed(protocol, [Buffer.from(
    `${JSON.stringify({ type: "response", id: "first", command: "get_state", success: true, data: CONTROL_STATE })}\n`
      + `${JSON.stringify({ type: "response", id: "second", command: "get_state", success: true, data: CONTROL_STATE })}\n`,
  )]);
  assert.deepEqual(records, [{ kind: "protocol_error", category: "unexpected_control_response" }]);
});

test("control callbacks cannot start prompts across same-chunk pre-prompt records", () => {
  const promptResponse = '{"type":"response","id":"prompt-1","command":"prompt","success":true}\n';
  const cases: ReadonlyArray<[string, string]> = [
    ['{"type":"agent_start"}\n' + promptResponse + '{"type":"agent_end","willRetry":false}\n{"type":"agent_settled"}\n', "event_without_prompt"],
    [promptResponse + '{"type":"agent_start"}\n{"type":"agent_settled"}\n', "unknown_response"],
    ['{"type":"agent_start"', "partial_record"],
  ];
  for (const [trailing, category] of cases) {
    const protocol = new RpcJsonlProtocol();
    const results: ControlResult[] = [];
    protocol.beginControl("state", { type: "get_state" }, (result) => {
      results.push(result);
      assert.throws(() => protocol.beginPrompt(1, "task"), { message: "RPC prompt cannot start in the current protocol state" });
    });
    const records = feed(protocol, [Buffer.from(
      `${JSON.stringify({ type: "response", id: "state", command: "get_state", success: true, data: CONTROL_STATE })}\n` + trailing,
    )]);
    protocol.finish((record) => records.push(record));
    assert.deepEqual(results, [{ id: "state", command: "get_state", success: true, data: CONTROL_STATE }]);
    assert.deepEqual(records, [{ kind: "protocol_error", category }]);
    assert.deepEqual(feed(protocol, [Buffer.from(promptResponse + '{"type":"agent_start"}\n')]), []);
    assert.throws(() => protocol.beginPrompt(1, "task"));
  }
});

for (const next of ["prompt", "control"] as const) {
  test(`control callbacks cannot start a ${next} across incomplete UTF-8 bytes`, () => {
    for (const success of [true, false]) {
      for (const character of ["é", "€", "😀"]) {
        const bytes = Buffer.from(character);
        for (let split = 1; split < bytes.length; split++) {
          const protocol = new RpcJsonlProtocol();
          const results: ControlResult[] = [];
          const beginNext = () => {
            if (next === "prompt") return protocol.beginPrompt(1, "task");
            return protocol.beginControl("next", { type: "get_state" }, () => assert.fail("old bytes accepted by a new control"));
          };
          protocol.beginControl("state", { type: "get_state" }, (result) => {
            results.push(result);
            assert.throws(beginNext, { message: `RPC ${next} cannot start in the current protocol state` });
          });
          const response = Buffer.from(`${JSON.stringify({
            type: "response", id: "state", command: "get_state", success,
            ...(success ? { data: CONTROL_STATE } : { error: "PRIVATE_ERROR" }),
          })}\n`);
          assert.deepEqual(feed(protocol, [Buffer.concat([response, bytes.subarray(0, split)])]), []);
          const expected: ControlResult[] = [];
          if (success) expected.push({ id: "state", command: "get_state", success: true, data: CONTROL_STATE });
          else expected.push({ id: "state", command: "get_state", success: false, category: "command_rejected" });
          assert.deepEqual(results, expected);
          assert.throws(beginNext);

          const laterActivity = Buffer.from(
            '{"type":"agent_start"}\n{"type":"response","id":"prompt-1","command":"prompt","success":true}\n'
              + `${JSON.stringify({ type: "response", id: "next", command: "get_state", success: true, data: CONTROL_STATE })}\n`,
          );
          const records = feed(protocol, [Buffer.concat([bytes.subarray(split), laterActivity])]);
          protocol.finish((record) => records.push(record));
          protocol.finish((record) => records.push(record));
          assert.deepEqual(records, [{ kind: "protocol_error", category: "malformed_json" }]);
          assert.deepEqual(results, expected);
          assert.deepEqual(feed(protocol, [laterActivity]), []);
          assert.throws(() => protocol.beginPrompt(1, "task"));
          assert.throws(() => protocol.beginControl("next", { type: "get_state" }, () => {}));
        }
      }
    }
  });
}

test("control callbacks can start prompts when no trailing bytes remain", () => {
  for (const success of [true, false]) {
    for (const ending of ["\n", "\r\n"]) {
      const protocol = new RpcJsonlProtocol();
      let promptCommand: string | undefined;
      protocol.beginControl("state", { type: "get_state" }, () => {
        promptCommand = protocol.beginPrompt(1, "task");
      });
      const response = Buffer.from(`${JSON.stringify({
        type: "response", id: "state", command: "get_state", success,
        ...(success ? { data: { ...CONTROL_STATE, ignored: "😀" } } : { error: "PRIVATE😀ERROR" }),
      })}${ending}`);
      const split = response.indexOf(0xf0) + 2;
      assert.deepEqual(feed(protocol, [response.subarray(0, split), response.subarray(split, -1)]), []);
      assert.equal(promptCommand, undefined);
      assert.deepEqual(feed(protocol, [response.subarray(-1)]), []);
      assert.equal(promptCommand, serializePromptCommand(1, "task"));
      assert.deepEqual(feed(protocol, [Buffer.from(
        '{"type":"agent_start"}\n{"type":"response","id":"prompt-1","command":"prompt","success":true}\n'
          + '{"type":"agent_end","willRetry":false}\n{"type":"agent_settled"}\n',
      )]), [
        { kind: "prompt_accepted", round: 1 },
        { kind: "event", round: 1, event: { type: "agent_start" } },
        { kind: "event", round: 1, event: { type: "agent_end", willRetry: false } },
        { kind: "event", round: 1, event: { type: "agent_settled" } },
      ]);
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

test("control callbacks can start controls when the response LF is the final received byte", () => {
  for (const success of [true, false]) {
    for (const ending of ["\n", "\r\n"]) {
      const protocol = new RpcJsonlProtocol();
      const results: ControlResult[] = [];
      let command: string | undefined;
      protocol.beginControl("state", { type: "get_state" }, () => {
        command = protocol.beginControl("next", { type: "get_state" }, (result) => results.push(result));
      });
      const response = Buffer.from(`${JSON.stringify({
        type: "response", id: "state", command: "get_state", success,
        ...(success ? { data: { ...CONTROL_STATE, ignored: "😀" } } : { error: "PRIVATE😀ERROR" }),
      })}${ending}`);
      const split = response.indexOf(0xf0) + 2;
      assert.deepEqual(feed(protocol, [response.subarray(0, split), response.subarray(split, -1)]), []);
      assert.equal(command, undefined);
      assert.deepEqual(feed(protocol, [response.subarray(-1)]), []);
      assert.equal(command, '{"id":"next","type":"get_state"}\n');
      assert.deepEqual(controlReply(protocol, "next", "get_state", CONTROL_STATE), []);
      assert.deepEqual(results, [{ id: "next", command: "get_state", success: true, data: CONTROL_STATE }]);
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

for (const next of ["prompt", "control"] as const) {
  test(`blocking UI rejects ${next} transitions until its final callback`, () => {
    for (const method of ["select", "confirm", "input", "editor"]) {
      for (const transitionAt of ["ui_response", "after_dispatch"]) {
        const protocol = new RpcJsonlProtocol();
        protocol.beginPrompt(1, "task");
        feed(protocol, [Buffer.from('{"type":"response","id":"prompt-1","command":"prompt","success":true}\n{"type":"agent_settled"}\n')]);
        const records: ProtocolRecord[] = [];
        const results: ControlResult[] = [];
        const beginNext = () => {
          if (next === "prompt") return protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT);
          return protocol.beginControl("state", { type: "get_state" }, (result) => results.push(result));
        };
        let command: string | undefined;
        protocol.feed(Buffer.from(`${JSON.stringify({ type: "extension_ui_request", id: "dialog", method })}\n`), (record) => {
          assert.equal(command, undefined, "old record emitted after a successful transition");
          records.push(record);
          if (record.kind === "ui_activity") {
            assert.throws(beginNext, { message: `RPC ${next} cannot start in the current protocol state` });
          } else if (record.kind === "ui_response" && transitionAt === "ui_response") {
            command = beginNext();
          }
        });
        assert.deepEqual(records, [
          { kind: "ui_activity", method },
          { kind: "ui_response", method, line: '{"type":"extension_ui_response","id":"dialog","cancelled":true}\n' },
        ]);
        // The rejected attempt must leave the same prompt round or control ID available.
        if (transitionAt === "after_dispatch") command = beginNext();
        if (next === "prompt") {
          assert.equal(command, serializePromptCommand(2, REPORT_RECOVERY_PROMPT));
          assert.deepEqual(feed(protocol, [Buffer.from(
            '{"type":"response","id":"prompt-2","command":"prompt","success":true}\n{"type":"agent_settled"}\n',
          )]), [
            { kind: "prompt_accepted", round: 2 }, { kind: "event", round: 2, event: { type: "agent_settled" } },
          ]);
        } else {
          assert.equal(command, '{"id":"state","type":"get_state"}\n');
          assert.deepEqual(controlReply(protocol, "state", "get_state", CONTROL_STATE), []);
          assert.deepEqual(results, [{ id: "state", command: "get_state", success: true, data: CONTROL_STATE }]);
        }
        protocol.finish((record) => assert.fail(JSON.stringify(record)));
      }
    }
  });
}

test("fire-and-forget UI still permits transitions from its only callback", () => {
  for (const next of ["prompt", "control"] as const) {
    for (const method of ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text", "customWidgetUpdate"]) {
      const protocol = new RpcJsonlProtocol();
      const records: ProtocolRecord[] = [];
      const results: ControlResult[] = [];
      let command: string | undefined;
      protocol.feed(Buffer.from(`${JSON.stringify({ type: "extension_ui_request", method })}\n`), (record) => {
        assert.equal(command, undefined, "old record emitted after a successful transition");
        records.push(record);
        if (next === "prompt") command = protocol.beginPrompt(1, "task");
        else command = protocol.beginControl("state", { type: "get_state" }, (result) => results.push(result));
      });
      assert.deepEqual(records, [{ kind: "ui_activity", method }]);
      if (next === "prompt") {
        assert.equal(command, serializePromptCommand(1, "task"));
        assert.deepEqual(feed(protocol, [Buffer.from('{"type":"response","id":"prompt-1","command":"prompt","success":true}\n')]), [
          { kind: "prompt_accepted", round: 1 },
        ]);
      } else {
        assert.equal(command, '{"id":"state","type":"get_state"}\n');
        assert.deepEqual(controlReply(protocol, "state", "get_state", CONTROL_STATE), []);
        assert.deepEqual(results, [{ id: "state", command: "get_state", success: true, data: CONTROL_STATE }]);
      }
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

test("blocking UI clears its boundary when either callback throws", () => {
  for (const boundary of ["ui_activity", "ui_response"]) {
    for (const next of ["prompt", "control"] as const) {
      const protocol = new RpcJsonlProtocol();
      const records: ProtocolRecord[] = [];
      const results: ControlResult[] = [];
      const beginNext = () => {
        if (next === "prompt") return protocol.beginPrompt(1, "task");
        return protocol.beginControl("state", { type: "get_state" }, (result) => results.push(result));
      };
      assert.throws(() => protocol.feed(Buffer.from('{"type":"extension_ui_request","id":"dialog","method":"confirm"}\n'), (record) => {
        records.push(record);
        if (record.kind === "ui_activity") {
          assert.throws(beginNext, { message: `RPC ${next} cannot start in the current protocol state` });
        }
        if (record.kind === boundary) throw new Error("callback failed");
      }), { message: "callback failed" });
      assert.deepEqual(records.map((record) => record.kind), boundary === "ui_activity" ? ["ui_activity"] : ["ui_activity", "ui_response"]);
      assert.equal(Reflect.get(protocol, "pendingUiResponses"), 0);
      if (next === "prompt") {
        assert.equal(beginNext(), serializePromptCommand(1, "task"));
        assert.deepEqual(feed(protocol, [Buffer.from('{"type":"response","id":"prompt-1","command":"prompt","success":true}\n')]), [
          { kind: "prompt_accepted", round: 1 },
        ]);
      } else {
        assert.equal(beginNext(), '{"id":"state","type":"get_state"}\n');
        assert.deepEqual(controlReply(protocol, "state", "get_state", CONTROL_STATE), []);
        assert.deepEqual(results, [{ id: "state", command: "get_state", success: true, data: CONTROL_STATE }]);
      }
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

test("blocking UI clears its boundary before terminal protocol-error callbacks", () => {
  for (const callbackThrows of [false, true]) {
    const protocol = new RpcJsonlProtocol();
    const records: ProtocolRecord[] = [];
    const emit = (record: ProtocolRecord): void => {
      records.push(record);
      if (record.kind === "ui_activity") {
        assert.equal(Reflect.get(protocol, "pendingUiResponses"), 1);
        protocol.feed(Buffer.from("{nope}\n"), emit);
      } else if (record.kind === "protocol_error") {
        assert.equal(Reflect.get(protocol, "pendingUiResponses"), 0);
        if (callbackThrows) throw new Error("callback failed");
      }
    };
    const dispatch = () => protocol.feed(Buffer.from('{"type":"extension_ui_request","id":"dialog","method":"confirm"}\n'), emit);
    if (callbackThrows) assert.throws(dispatch, { message: "callback failed" });
    else dispatch();
    assert.deepEqual(records, [
      { kind: "ui_activity", method: "confirm" }, { kind: "protocol_error", category: "malformed_json" },
    ]);
    assert.equal(Reflect.get(protocol, "pendingUiResponses"), 0);
    assert.throws(() => protocol.beginPrompt(1, "task"), { message: "RPC prompt cannot start in the current protocol state" });
    assert.throws(() => protocol.beginControl("state", { type: "get_state" }, () => {}), {
      message: "RPC control cannot start in the current protocol state",
    });
    assert.deepEqual(feed(protocol, [Buffer.from('{"type":"extension_ui_request","method":"notify"}\n')]), []);
    protocol.finish((record) => assert.fail(JSON.stringify(record)));
  }
});

test("UI requests remain independently correlated and cancellable during pending controls", () => {
  const protocol = new RpcJsonlProtocol();
  const results: ControlResult[] = [];
  protocol.beginControl("shared-id", { type: "get_state" }, (result) => results.push(result));
  for (const [index, method] of ["select", "confirm", "input", "editor"].entries()) {
    const id = index === 0 ? "shared-id" : `dialog-${index}`;
    assert.deepEqual(feed(protocol, [Buffer.from(`${JSON.stringify({ type: "extension_ui_request", id, method, message: "PRIVATE_MESSAGE" })}\n`)]), [
      { kind: "ui_activity", method }, { kind: "ui_response", method, line: `${JSON.stringify({ type: "extension_ui_response", id, cancelled: true })}\n` },
    ]);
  }
  for (const method of ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text", "customWidgetUpdate"]) {
    assert.deepEqual(feed(protocol, [Buffer.from(`${JSON.stringify({ type: "extension_ui_request", method, text: "PRIVATE_TEXT" })}\n`)]), [{ kind: "ui_activity", method }]);
  }
  assert.deepEqual(results, []);
  assert.deepEqual(controlReply(protocol, "shared-id", "get_state", CONTROL_STATE), []);
  assert.equal(results.length, 1);
  assert.doesNotMatch(JSON.stringify([results, protocol]), /PRIVATE/);
});

test("malformed and duplicate UI requests keep their existing errors during controls", () => {
  for (const duplicate of [false, true]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginControl("state", { type: "get_state" }, () => assert.fail("invalid UI accepted"));
    const dialog = Buffer.from('{"type":"extension_ui_request","id":"dialog","method":"confirm"}\n');
    if (duplicate) feed(protocol, [dialog]);
    const records = feed(protocol, [duplicate ? dialog : Buffer.from('{"type":"extension_ui_request","method":"confirm"}\n')]);
    assert.deepEqual(records, [{ kind: "protocol_error", category: duplicate ? "duplicate_ui_request" : "malformed_ui_request" }]);
    assert.deepEqual(controlReply(protocol, "state", "get_state", CONTROL_STATE), []);
  }
});

test("control responses preserve strict LF framing, CRLF, Unicode separators, and partial UTF-8", () => {
  const protocol = new RpcJsonlProtocol();
  const results: ControlResult[] = [];
  protocol.beginControl("state", { type: "get_state" }, (result) => results.push(result));
  const response = Buffer.from(`${JSON.stringify({
    type: "response", id: "state", command: "get_state", success: true,
    data: { ...CONTROL_STATE, ignored: "PRIVATE😀\u2028\u2029PAYLOAD" },
  })}\r\n`);
  const split = response.indexOf(0xf0) + 2;
  assert.deepEqual(feed(protocol, [response.subarray(0, split)]), []);
  assert.equal(results.length, 0);
  assert.deepEqual(feed(protocol, [response.subarray(split, -1)]), []);
  assert.equal(results.length, 0);
  assert.deepEqual(feed(protocol, [response.subarray(-1)]), []);
  assert.deepEqual(results, [{ id: "state", command: "get_state", success: true, data: CONTROL_STATE }]);
  protocol.finish((record) => assert.fail(JSON.stringify(record)));
  assert.doesNotMatch(JSON.stringify([results, protocol]), /PRIVATE|PAYLOAD/);
});

test("control framing and EOF errors remain terminal and bounded", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["{nope}\n", "malformed_json"], ["{}\u2028{}\n", "malformed_json"], ["{}\u2029{}\n", "malformed_json"],
    ["null\n", "malformed_record"], ["[]\n", "malformed_record"], ["{}\n", "malformed_record"],
    ["\n", "empty_record"], ["{", "partial_record"], ["", "missing_control_response"],
    ["x".repeat(101), "line_too_large"], ["x".repeat(101) + "\n", "line_too_large"],
  ];
  for (const [text, category] of cases) {
    const protocol = new RpcJsonlProtocol(100);
    protocol.beginControl("state", { type: "get_state" }, () => assert.fail("framing error accepted"));
    const records = feed(protocol, [Buffer.from(text)]);
    protocol.finish((record) => records.push(record));
    protocol.finish((record) => records.push(record));
    assert.deepEqual(records, [{ kind: "protocol_error", category }]);
    assert.deepEqual(controlReply(protocol, "state", "get_state", CONTROL_STATE), []);
  }
  const partial = new RpcJsonlProtocol();
  partial.feed(Buffer.from("{"), () => assert.fail("partial record emitted"));
  assert.throws(() => partial.beginControl("state", { type: "get_state" }, () => {}));
});

for (const [kind, value, expectedRecords, expectedResults] of [
  [
    "prompt response",
    { type: "response", id: "prompt-1", command: "prompt", success: true },
    [{ kind: "prompt_accepted", round: 1 }],
    [],
  ],
  [
    "control response",
    { type: "response", id: "state", command: "get_state", success: true, data: CONTROL_STATE },
    [],
    [{ id: "state", command: "get_state", success: true, data: CONTROL_STATE }],
  ],
  [
    "UI request",
    { type: "extension_ui_request", id: "dialog", method: "confirm", message: "😀" },
    [
      { kind: "ui_activity", method: "confirm" },
      { kind: "ui_response", method: "confirm", line: '{"type":"extension_ui_response","id":"dialog","cancelled":true}\n' },
    ],
    [],
  ],
] as const) {
  test(`exact-limit ${kind} CRLF records accept every chunk boundary`, () => {
    const line = Buffer.from(`${JSON.stringify(value)}\r\n`);
    const chunkings = [
      [line],
      ...Array.from({ length: line.length - 1 }, (_, index) => [line.subarray(0, index + 1), line.subarray(index + 1)]),
      Array.from(line, (byte) => Buffer.from([byte])),
    ];
    for (const chunks of chunkings) {
      const protocol = new RpcJsonlProtocol(line.length - 2);
      const results: ControlResult[] = [];
      if (kind === "prompt response") protocol.beginPrompt(1, "task");
      else if (kind === "control response") protocol.beginControl("state", { type: "get_state" }, (result) => results.push(result));
      const records: ProtocolRecord[] = [];
      for (const [index, chunk] of chunks.entries()) {
        protocol.feed(chunk, (record) => records.push(record));
        if (index < chunks.length - 1) {
          assert.deepEqual(records, []);
          assert.deepEqual(results, []);
        }
      }
      assert.deepEqual(records, expectedRecords);
      assert.deepEqual(results, expectedResults);
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  });

  test(`exact-limit ${kind} with pending CR remains partial_record at EOF`, () => {
    const line = Buffer.from(JSON.stringify(value));
    for (const chunks of [[Buffer.concat([line, Buffer.from("\r")])], [line, Buffer.from("\r")]]) {
      const protocol = new RpcJsonlProtocol(line.length);
      if (kind === "prompt response") protocol.beginPrompt(1, "task");
      else if (kind === "control response") protocol.beginControl("state", { type: "get_state" }, () => assert.fail("partial record accepted"));
      assert.deepEqual(feed(protocol, chunks), []);
      const records: ProtocolRecord[] = [];
      protocol.finish((record) => records.push(record));
      protocol.finish((record) => records.push(record));
      assert.deepEqual(records, [{ kind: "protocol_error", category: "partial_record" }]);
      assert.deepEqual(feed(protocol, [Buffer.from("\n")]), []);
    }
  });
}

test("exact-limit records reject non-CR extra bytes and non-LF bytes after pending CR immediately", () => {
  const line = Buffer.from('{"type":"extension_ui_request","method":"notify"}');
  for (const pendingCr of [false, true]) {
    const prefix = pendingCr ? Buffer.concat([line, Buffer.from("\r")]) : line;
    for (let byte = 0; byte <= 0xff; byte++) {
      if (byte === 0x0a || (!pendingCr && byte === 0x0d)) continue;
      const protocol = new RpcJsonlProtocol(line.length);
      assert.deepEqual(feed(protocol, [prefix]), []);
      const extra = Buffer.from([byte]);
      const expected = [{ kind: "protocol_error", category: "line_too_large" }];
      assert.deepEqual(feed(protocol, [extra]), expected);
      assert.deepEqual(feed(new RpcJsonlProtocol(line.length), [Buffer.concat([prefix, extra])]), expected);
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
      assert.deepEqual(feed(protocol, [Buffer.from("\n")]), []);
    }
  }
});

test("raw framing preserves UTF-8 replacement and the decoded line-size limit", () => {
  for (const invalid of [[0xff], [0xc2], [0xe2, 0x82], [0xf0, 0x9f, 0x98], [0xed, 0xa0, 0x80]]) {
    const bytes = Buffer.from(invalid);
    const line = Buffer.concat([
      Buffer.from('{"type":"extension_ui_request","method":"'), bytes, Buffer.from('"}\r\n'),
    ]);
    const maxLineBytes = Buffer.byteLength(line.toString("utf8")) - 2;
    const protocol = new RpcJsonlProtocol(maxLineBytes);
    assert.deepEqual(feed(protocol, [line.subarray(0, -3), line.subarray(-3)]), [
      { kind: "ui_activity", method: bytes.toString("utf8") },
    ]);
    const oversized = new RpcJsonlProtocol(maxLineBytes - 1);
    assert.deepEqual(feed(oversized, [line]), [{ kind: "protocol_error", category: "line_too_large" }]);
    assert.deepEqual(feed(new RpcJsonlProtocol(), [Buffer.concat([bytes, Buffer.from("\n")])]), [
      { kind: "protocol_error", category: "malformed_json" },
    ]);
    const partial = new RpcJsonlProtocol();
    const records = feed(partial, [bytes]);
    partial.finish((record) => records.push(record));
    partial.finish((record) => records.push(record));
    assert.deepEqual(records, [{ kind: "protocol_error", category: "partial_record" }]);
  }
});

test("line limits apply per record across tiny chunks and large multi-record chunks", () => {
  const text = JSON.stringify({ type: "extension_ui_request", method: "notify", text: "😀".repeat(512) });
  const maxLineBytes = Buffer.byteLength(text);
  for (const ending of ["\n", "\r\n"]) {
    const line = Buffer.from(text + ending);
    const protocol = new RpcJsonlProtocol(maxLineBytes);
    const chunks = Array.from(Buffer.from(text), (byte) => Buffer.from([byte]));
    chunks.push(Buffer.from(ending));
    assert.deepEqual(feed(protocol, chunks), [{ kind: "ui_activity", method: "notify" }]);
    assert.deepEqual(feed(protocol, [Buffer.concat(Array(20).fill(line))]), Array(20).fill({ kind: "ui_activity", method: "notify" }));
    protocol.finish((record) => assert.fail(JSON.stringify(record)));
    assert.deepEqual(feed(new RpcJsonlProtocol(maxLineBytes - 1), [line]), [{ kind: "protocol_error", category: "line_too_large" }]);
    const oversized = new RpcJsonlProtocol(maxLineBytes);
    assert.deepEqual(feed(oversized, [Buffer.from("x".repeat(maxLineBytes)), Buffer.from("x")]), [
      { kind: "protocol_error", category: "line_too_large" },
    ]);
  }
});

test("fallback readiness probes do not consume prompts, ordinals, or response IDs", () => {
  const protocol = new RpcJsonlProtocol();
  assert.equal(protocol.canBeginFallbackPromptCycle(2), false);
  protocol.beginPrompt(1, "task");
  acceptSettledPrompt(protocol, "prompt-1");
  for (const route of [2, 3]) {
    const before = JSON.stringify(protocol, (_key, value) => value instanceof Set ? [...value] : value);
    assert.equal(protocol.canBeginFallbackPromptCycle(route), true);
    assert.equal(protocol.canBeginFallbackPromptCycle(route), true);
    assert.equal(protocol.canBeginFallbackPromptCycle(route + 1), false);
    assert.equal(JSON.stringify(protocol, (_key, value) => value instanceof Set ? [...value] : value), before);
    // Probing the fallback must leave this route's recovery available too.
    protocol.beginPrompt(2, "recovery");
    acceptSettledPrompt(protocol, route === 2 ? "prompt-2" : "route-2:prompt-2", 2);
    assert.equal(protocol.canBeginFallbackPromptCycle(route), true);
    assert.equal(protocol.beginFallbackPromptCycle(route, "PRIVATE_PROMPT"), `${JSON.stringify({
      id: `route-${route}:prompt-1`, type: "prompt", message: "PRIVATE_PROMPT",
    })}\n`);
    assert.equal(protocol.canBeginFallbackPromptCycle(route + 1), false);
    acceptSettledPrompt(protocol, `route-${route}:prompt-1`);
  }
  assert.deepEqual(feed(protocol, [Buffer.from("malformed\n")]), [{ kind: "protocol_error", category: "malformed_json" }]);
  assert.equal(protocol.canBeginFallbackPromptCycle(4), false);
  assert.doesNotMatch(JSON.stringify(protocol.canBeginFallbackPromptCycle(4)), /PRIVATE/);
});

test("fallback readiness probes preserve partial bytes after the final control without failing the protocol", () => {
  const ui = Buffer.from(`${JSON.stringify({ type: "extension_ui_request", method: "notify", text: "PRIVATE😀" })}\r\n`);
  // Every split includes JSON prefixes, incomplete UTF-8, and a trailing CR.
  for (let split = 1; split < ui.length; split++) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    acceptSettledPrompt(protocol, "prompt-1");
    let controls = 0;
    protocol.beginControl("route-2:switch-4", { type: "get_state" }, () => {
      controls += 1;
      assert.equal(protocol.canBeginFallbackPromptCycle(2), false);
    });
    const response = Buffer.from(`${JSON.stringify({
      id: "route-2:switch-4", type: "response", command: "get_state", success: true, data: CONTROL_STATE,
    })}\n`);
    assert.deepEqual(feed(protocol, [Buffer.concat([response, ui.subarray(0, split)])]), []);
    assert.equal(controls, 1);
    const before = JSON.stringify(protocol);
    assert.equal(protocol.canBeginFallbackPromptCycle(2), false);
    assert.equal(protocol.canBeginFallbackPromptCycle(2), false);
    assert.equal(JSON.stringify(protocol), before);
    assert.deepEqual(feed(protocol, [ui.subarray(split)]), [{ kind: "ui_activity", method: "notify" }]);
    assert.equal(protocol.canBeginFallbackPromptCycle(2), true);
    assert.equal(protocol.beginFallbackPromptCycle(2, "continuation"), '{"id":"route-2:prompt-1","type":"prompt","message":"continuation"}\n');
    acceptSettledPrompt(protocol, "route-2:prompt-1");
    protocol.finish((record) => assert.fail(JSON.stringify(record)));
  }
});

test("route prompt cycles keep the initial wire format and allow one recovery per cycle", () => {
  for (const recoveryRoutes of [[], [1, 2, 3, 4], [1, 3], [2, 4]]) {
    const protocol = new RpcJsonlProtocol();
    const usedIds = new Set<string>();
    for (let route = 1; route <= 4; route++) {
      const message = "Continue \"task\"\nusing existing context 😀\u2028\u2029";
      const id = route === 1 ? "prompt-1" : `route-${route}:prompt-1`;
      const command = route === 1 ? protocol.beginPrompt(1, message) : protocol.beginFallbackPromptCycle(route, message);
      assert.equal(command, `${JSON.stringify({ id, type: "prompt", message })}\n`);
      assert.ok(!usedIds.has(id));
      assert.ok(id.length <= 31);
      usedIds.add(id);
      if (route === 1) assert.equal(command, serializePromptCommand(1, message));
      assert.throws(() => protocol.beginPrompt(1, "duplicate"));
      acceptSettledPrompt(protocol, id);
      assert.throws(() => protocol.beginPrompt(1, "duplicate"));
      if (recoveryRoutes.includes(route)) {
        const recoveryId = route === 1 ? "prompt-2" : `route-${route}:prompt-2`;
        assert.equal(protocol.beginPrompt(2, REPORT_RECOVERY_PROMPT), `${JSON.stringify({
          id: recoveryId, type: "prompt", message: REPORT_RECOVERY_PROMPT,
        })}\n`);
        assert.ok(!usedIds.has(recoveryId));
        usedIds.add(recoveryId);
        acceptSettledPrompt(protocol, recoveryId, 2);
        assert.throws(() => protocol.beginPrompt(2, "duplicate recovery"));
      }
      assert.throws(() => protocol.beginPrompt(3 as 1 | 2, "no round 3"));
    }
    assert.equal(usedIds.size, 4 + recoveryRoutes.length);
    protocol.finish((record) => assert.fail(JSON.stringify(record)));
  }
});

test("route prompt cycles require an initial prompt and contiguous safe-integer ordinals", () => {
  const protocol = new RpcJsonlProtocol();
  const stateError = { message: "RPC fallback prompt cycle cannot start in the current protocol state" };
  assert.throws(() => protocol.beginFallbackPromptCycle(2, "continuation"), stateError);
  protocol.beginControl("initial-state", { type: "get_state" }, () => {});
  assert.deepEqual(controlReply(protocol, "initial-state", "get_state", CONTROL_STATE), []);
  assert.throws(() => protocol.beginFallbackPromptCycle(2, "continuation"), stateError);
  protocol.beginPrompt(1, "task");
  acceptSettledPrompt(protocol, "prompt-1");
  const invalidOrdinals: unknown[] = [
    undefined, null, false, true, "2", "PRIVATE_ORDINAL", {}, [], new Number(2), 2n, Symbol("ordinal"),
    NaN, Infinity, -Infinity, -1, -0, 0, 1, 1.5, 2.5, 3, 1000,
    Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE,
  ];
  const ordinalError = { message: "RPC route ordinal must be the next safe integer" };
  const before = JSON.stringify(protocol);
  for (const ordinal of invalidOrdinals) {
    assert.equal(protocol.canBeginFallbackPromptCycle(ordinal as number), false);
    assert.throws(() => protocol.beginFallbackPromptCycle(ordinal as number, "PRIVATE_PROMPT"), ordinalError);
    assert.equal(JSON.stringify(protocol), before);
  }
  assert.equal(protocol.beginFallbackPromptCycle(2, "continuation"), '{"id":"route-2:prompt-1","type":"prompt","message":"continuation"}\n');
  acceptSettledPrompt(protocol, "route-2:prompt-1");
  for (const ordinal of [1, 2, 4]) assert.throws(() => protocol.beginFallbackPromptCycle(ordinal, "invalid"), ordinalError);
  assert.equal(protocol.beginPrompt(2, "recovery"), '{"id":"route-2:prompt-2","type":"prompt","message":"recovery"}\n');
  acceptSettledPrompt(protocol, "route-2:prompt-2", 2);
  protocol.beginFallbackPromptCycle(3, "next continuation");
  acceptSettledPrompt(protocol, "route-3:prompt-1");
  protocol.finish((record) => assert.fail(JSON.stringify(record)));
});

test("route prompt cycles consume rejected continuations without inheriting an accepted round", () => {
  for (const initialRecovery of [false, true]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    acceptSettledPrompt(protocol, "prompt-1");
    if (initialRecovery) {
      protocol.beginPrompt(2, "recovery");
      acceptSettledPrompt(protocol, "prompt-2", 2);
    }
    const results: ControlResult[] = [];
    for (const route of [2, 3]) {
      assert.equal(protocol.canBeginFallbackPromptCycle(route), true);
      protocol.beginFallbackPromptCycle(route, "PRIVATE_CONTINUATION");
      assert.deepEqual(feed(protocol, [Buffer.from(
        '{"type":"agent_start","payload":"PRIVATE_EVENT"}\n'
          + `${JSON.stringify({ type: "response", id: `route-${route}:prompt-1`, command: "prompt", success: false, error: "PRIVATE_ERROR" })}\n`,
      )]), [{ kind: "prompt_rejected", round: 1, category: "command_rejected" }]);
      assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE/);
      for (const round of [1, 2, 3]) assert.throws(() => protocol.beginPrompt(round as 1 | 2, "not accepted"));
      const id = `route-${route}:verify-state`;
      protocol.beginControl(id, { type: "get_state" }, (result) => results.push(result));
      assert.deepEqual(controlReply(protocol, id, "get_state", CONTROL_STATE), []);
      assert.deepEqual(results.at(-1), { id, command: "get_state", success: true, data: CONTROL_STATE });
    }
    protocol.beginFallbackPromptCycle(4, "continuation");
    acceptSettledPrompt(protocol, "route-4:prompt-1");
    assert.equal(results.length, 2);
    protocol.finish((record) => assert.fail(JSON.stringify(record)));
  }
});

test("route prompt cycles consume a rejected recovery exactly once on every route", () => {
  const protocol = new RpcJsonlProtocol();
  for (const route of [1, 2, 3]) {
    if (route === 1) protocol.beginPrompt(1, "task");
    else protocol.beginFallbackPromptCycle(route, "continuation");
    const prefix = route === 1 ? "" : `route-${route}:`;
    acceptSettledPrompt(protocol, `${prefix}prompt-1`);
    protocol.beginPrompt(2, "recovery");
    assert.deepEqual(feed(protocol, [Buffer.from(`${JSON.stringify({
      type: "response", id: `${prefix}prompt-2`, command: "prompt", success: false, error: "PRIVATE_ERROR",
    })}\n`)]), [{ kind: "prompt_rejected", round: 2, category: "command_rejected" }]);
    for (const round of [1, 2, 3]) assert.throws(() => protocol.beginPrompt(round as 1 | 2, "already used"));
    assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE/);
  }
  protocol.finish((record) => assert.fail(JSON.stringify(record)));
});

test("route prompt cycles reject collisions with either used control ID before changing state", () => {
  for (const id of ["route-2:prompt-1", "route-2:prompt-2"]) {
    for (const success of [true, false]) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginPrompt(1, "task");
      acceptSettledPrompt(protocol, "prompt-1");
      protocol.beginControl(id, { type: "get_state" }, () => {});
      assert.deepEqual(feed(protocol, [Buffer.from(`${JSON.stringify({
        type: "response", id, command: "get_state", success, data: CONTROL_STATE,
        ...(success ? {} : { error: "PRIVATE_ERROR" }),
      })}\n`)]), []);
      const before = JSON.stringify(protocol);
      assert.equal(protocol.canBeginFallbackPromptCycle(2), false);
      assert.throws(() => protocol.beginFallbackPromptCycle(2, "continuation"), { message: "RPC route prompt ID is invalid or already used" });
      assert.equal(JSON.stringify(protocol), before);
      assert.throws(() => protocol.beginFallbackPromptCycle(3, "skip collision"), { message: "RPC route ordinal must be the next safe integer" });
      assert.equal(protocol.beginPrompt(2, "recovery"), serializePromptCommand(2, "recovery"));
      acceptSettledPrompt(protocol, "prompt-2", 2);
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

test("route prompt cycles reserve their current prompt IDs from idle controls", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  acceptSettledPrompt(protocol, "prompt-1");
  for (const route of [2, 3]) {
    protocol.beginFallbackPromptCycle(route, "continuation");
    acceptSettledPrompt(protocol, `route-${route}:prompt-1`);
    for (const id of ["prompt-1", "prompt-2", `route-${route}:prompt-1`, `route-${route}:prompt-2`]) {
      assert.throws(() => protocol.beginControl(id, { type: "get_state" }, () => {}), { message: "RPC control ID is invalid or already used" });
    }
    const id = `route-${route}:state`;
    protocol.beginControl(id, { type: "get_state" }, () => {});
    assert.deepEqual(controlReply(protocol, id, "get_state", CONTROL_STATE), []);
    protocol.beginPrompt(2, "recovery");
    acceptSettledPrompt(protocol, `route-${route}:prompt-2`, 2);
  }
  protocol.finish((record) => assert.fail(JSON.stringify(record)));
});

test("fallback cycles wait for every prompt round to settle and for pending controls", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  for (const route of [1, 2]) {
    const prefix = route === 1 ? "" : `route-${route}:`;
    const beginNext = () => protocol.beginFallbackPromptCycle(route + 1, "continuation");
    for (const round of [1, 2] as const) {
      if (round === 2) protocol.beginPrompt(2, "recovery");
      assert.equal(protocol.canBeginFallbackPromptCycle(route + 1), false);
      assert.throws(beginNext);
      protocol.feed(Buffer.from(`${JSON.stringify({ type: "response", id: `${prefix}prompt-${round}`, command: "prompt", success: true })}\n`), (record) => {
        assert.deepEqual(record, { kind: "prompt_accepted", round });
        assert.equal(protocol.canBeginFallbackPromptCycle(route + 1), false);
        assert.throws(beginNext);
      });
      for (const event of [
        { type: "agent_start" }, { type: "agent_end", willRetry: false },
        { type: "auto_retry_start" }, { type: "compaction_end", willRetry: false },
      ]) {
        assert.deepEqual(feed(protocol, [Buffer.from(`${JSON.stringify(event)}\n`)]), [{ kind: "event", round, event }]);
        assert.equal(protocol.canBeginFallbackPromptCycle(route + 1), false);
        assert.throws(beginNext);
      }
      assert.deepEqual(feed(protocol, [Buffer.from('{"type":"agent_settled"}\n')]), [
        { kind: "event", round, event: { type: "agent_settled" } },
      ]);
    }
    const id = `route-${route}:state`;
    protocol.beginControl(id, { type: "get_state" }, () => {});
    assert.equal(protocol.canBeginFallbackPromptCycle(route + 1), false);
    assert.throws(beginNext);
    assert.deepEqual(controlReply(protocol, id, "get_state", CONTROL_STATE), []);
    assert.equal(protocol.canBeginFallbackPromptCycle(route + 1), true);
    assert.equal(beginNext(), `${JSON.stringify({ id: `route-${route + 1}:prompt-1`, type: "prompt", message: "continuation" })}\n`);
  }
  acceptSettledPrompt(protocol, "route-3:prompt-1");
  protocol.finish((record) => assert.fail(JSON.stringify(record)));
});

test("fallback cycles reject stale, duplicate, and out-of-order responses without current-route attribution", () => {
  for (const initialRecovery of [false, true]) {
    for (const rejectedContinuation of [false, true]) {
      const cases: ReadonlyArray<[string, string]> = [
        ["prompt-1", "duplicate_response"], ["prompt-2", initialRecovery ? "duplicate_response" : "unknown_response"],
        ["route-2:prompt-1", "duplicate_response"], ["route-2:prompt-2", rejectedContinuation ? "unknown_response" : "duplicate_response"],
        ["route-3:prompt-2", "unknown_response"], ["route-3:prompt-3", "unknown_response"],
        ["route-4:prompt-1", "unknown_response"], ["route-03:prompt-1", "unknown_response"],
      ];
      for (const [id, category] of cases) {
        const protocol = new RpcJsonlProtocol();
        protocol.beginPrompt(1, "task");
        acceptSettledPrompt(protocol, "prompt-1");
        if (initialRecovery) {
          protocol.beginPrompt(2, "recovery");
          acceptSettledPrompt(protocol, "prompt-2", 2);
        }
        protocol.beginFallbackPromptCycle(2, "continuation");
        if (rejectedContinuation) {
          assert.deepEqual(feed(protocol, [Buffer.from('{"type":"response","id":"route-2:prompt-1","command":"prompt","success":false}\n')]), [
            { kind: "prompt_rejected", round: 1, category: "command_rejected" },
          ]);
        } else {
          acceptSettledPrompt(protocol, "route-2:prompt-1");
          protocol.beginPrompt(2, "recovery");
          acceptSettledPrompt(protocol, "route-2:prompt-2", 2);
        }
        protocol.beginFallbackPromptCycle(3, "continuation");
        const response = '{"type":"response","id":"route-3:prompt-1","command":"prompt","success":true}\n';
        const records = feed(protocol, [Buffer.from(
          '{"type":"agent_start","payload":"PRIVATE_BUFFERED_EVENT"}\n'
            + `${JSON.stringify({ type: "response", id, command: "prompt", success: true, error: "PRIVATE_RESPONSE" })}\n`
            + response,
        )]);
        assert.deepEqual(records, [{ kind: "protocol_error", category }], id);
        assert.doesNotMatch(JSON.stringify([records, protocol]), /PRIVATE/);
        assert.throws(() => protocol.beginPrompt(2, "recovery"));
        assert.throws(() => protocol.beginControl("state", { type: "get_state" }, () => {}));
        assert.throws(() => protocol.beginFallbackPromptCycle(4, "continuation"));
        assert.deepEqual(feed(protocol, [Buffer.from(response)]), []);
        protocol.finish((record) => assert.fail(JSON.stringify(record)));
      }
    }
  }
});

test("fallback cycles preserve old response IDs during recovery and idle controls", () => {
  for (const next of ["recovery", "control"]) {
    for (const command of ["prompt", "get_state"] as const) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginControl("old-state", { type: "get_state" }, () => {});
      assert.deepEqual(controlReply(protocol, "old-state", "get_state", CONTROL_STATE), []);
      protocol.beginPrompt(1, "task");
      acceptSettledPrompt(protocol, "prompt-1");
      protocol.beginFallbackPromptCycle(2, "continuation");
      acceptSettledPrompt(protocol, "route-2:prompt-1");
      assert.throws(() => protocol.beginControl("old-state", { type: "get_state" }, () => {}));
      if (next === "recovery") protocol.beginPrompt(2, "recovery");
      else protocol.beginControl("new-state", { type: "get_state" }, () => assert.fail("stale response reached control callback"));
      const id = command === "prompt" ? "prompt-1" : "old-state";
      assert.deepEqual(feed(protocol, [Buffer.from(`${JSON.stringify({ type: "response", id, command, success: true, data: CONTROL_STATE })}\n`)]), [
        { kind: "protocol_error", category: "duplicate_response" },
      ]);
      assert.throws(() => protocol.beginFallbackPromptCycle(3, "continuation"));
    }
  }
});

test("fallback cycles reject non-final raw and replay callbacks but permit the final settled callback", () => {
  for (const buffered of [false, true]) {
    for (const route of [1, 2]) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginPrompt(1, "task");
      if (route === 2) {
        acceptSettledPrompt(protocol, "prompt-1");
        protocol.beginFallbackPromptCycle(2, "continuation");
      }
      const id = route === 1 ? "prompt-1" : "route-2:prompt-1";
      const response = `${JSON.stringify({ type: "response", id, command: "prompt", success: true })}\n`;
      const events = [
        { type: "agent_start" }, { type: "agent_end", willRetry: false }, { type: "agent_settled" },
        { type: "message_update", payload: "PRIVATE_EVENT" }, { type: "agent_settled" },
      ];
      const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
      if (buffered) assert.deepEqual(feed(protocol, [Buffer.from(lines)]), []);
      const records: ProtocolRecord[] = [];
      let nextCommand: string | undefined;
      protocol.feed(Buffer.from(buffered ? response : response + lines), (record) => {
        assert.equal(nextCommand, undefined, "old record emitted after a successful cycle transition");
        records.push(record);
        if (records.length <= events.length) {
          assert.equal(protocol.canBeginFallbackPromptCycle(route + 1), false);
          assert.throws(() => protocol.beginFallbackPromptCycle(route + 1, "continuation"), {
            message: "RPC fallback prompt cycle cannot start in the current protocol state",
          });
        } else {
          assert.equal(protocol.canBeginFallbackPromptCycle(route + 1), true);
          nextCommand = protocol.beginFallbackPromptCycle(route + 1, "continuation");
        }
      });
      assert.deepEqual(records, [{ kind: "prompt_accepted", round: 1 }, ...events.map((event) => ({ kind: "event", round: 1, event }))]);
      assert.equal(nextCommand, `${JSON.stringify({ id: `route-${route + 1}:prompt-1`, type: "prompt", message: "continuation" })}\n`);
      assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE/);
      acceptSettledPrompt(protocol, `route-${route + 1}:prompt-1`);
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

test("fallback cycles wait for UI cancellation callbacks and preserve process-wide dialog IDs", () => {
  for (const method of ["select", "confirm", "input", "editor", "notify", "customWidgetUpdate"]) {
    const blocking = method !== "notify" && method !== "customWidgetUpdate";
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    acceptSettledPrompt(protocol, "prompt-1");
    for (const route of [2, 3]) {
      let command: string | undefined;
      const records: ProtocolRecord[] = [];
      // UI and prompt IDs remain independent, even when their strings match.
      const id = `route-${route}:prompt-1`;
      protocol.feed(Buffer.from(`${JSON.stringify({ type: "extension_ui_request", id, method, message: "PRIVATE_UI" })}\n`), (record) => {
        assert.equal(command, undefined, "old UI callback emitted after a cycle transition");
        records.push(record);
        if (record.kind === "ui_activity" && blocking) {
          assert.equal(protocol.canBeginFallbackPromptCycle(route), false);
          assert.throws(() => protocol.beginFallbackPromptCycle(route, "continuation"));
        } else {
          assert.equal(protocol.canBeginFallbackPromptCycle(route), true);
          command = protocol.beginFallbackPromptCycle(route, "continuation");
        }
      });
      const expected: ProtocolRecord[] = [{ kind: "ui_activity", method }];
      if (blocking) expected.push({ kind: "ui_response", method, line: `${JSON.stringify({ type: "extension_ui_response", id, cancelled: true })}\n` });
      assert.deepEqual(records, expected);
      assert.equal(command, `${JSON.stringify({ id, type: "prompt", message: "continuation" })}\n`);
      acceptSettledPrompt(protocol, id);
      assert.doesNotMatch(JSON.stringify([records, protocol]), /PRIVATE/);
    }
    if (blocking) {
      assert.deepEqual(feed(protocol, [Buffer.from(`${JSON.stringify({ type: "extension_ui_request", id: "route-2:prompt-1", method })}\n`)]), [
        { kind: "protocol_error", category: "duplicate_ui_request" },
      ]);
      assert.throws(() => protocol.beginFallbackPromptCycle(4, "continuation"));
    }
    protocol.finish((record) => assert.fail(JSON.stringify(record)));
  }
});

test("fallback cycles can start from a control callback only after its final LF byte", () => {
  for (const success of [false, true]) {
    for (const ending of ["\n", "\r\n"]) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginPrompt(1, "task");
      acceptSettledPrompt(protocol, "prompt-1");
      for (const route of [2, 3]) {
        let command: string | undefined;
        const id = `route-${route}:state`;
        protocol.beginControl(id, { type: "get_state" }, () => {
          command = protocol.beginFallbackPromptCycle(route, "continuation");
        });
        const response = Buffer.from(`${JSON.stringify({
          type: "response", id, command: "get_state", success,
          ...(success ? { data: { ...CONTROL_STATE, ignored: "PRIVATE😀\u2028\u2029" } } : { error: "PRIVATE😀\u2028\u2029" }),
        })}${ending}`);
        for (const byte of response.subarray(0, -1)) {
          assert.deepEqual(feed(protocol, [Buffer.from([byte])]), []);
          assert.equal(command, undefined);
          assert.throws(() => protocol.beginFallbackPromptCycle(route, "continuation"));
        }
        assert.deepEqual(feed(protocol, [response.subarray(-1)]), []);
        assert.equal(command, `${JSON.stringify({ id: `route-${route}:prompt-1`, type: "prompt", message: "continuation" })}\n`);
        assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE/);
        acceptSettledPrompt(protocol, `route-${route}:prompt-1`);
        protocol.beginPrompt(2, "recovery");
        acceptSettledPrompt(protocol, `route-${route}:prompt-2`, 2);
      }
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

test("fallback cycles reject transitions across raw tails including incomplete UTF-8 and CR", () => {
  const tails = [Buffer.from("{"), Buffer.from("\r")];
  for (const character of ["é", "€", "😀"]) {
    const bytes = Buffer.from(character);
    for (let split = 1; split < bytes.length; split++) tails.push(bytes.subarray(0, split));
  }
  for (const boundary of ["settlement", "control", "rejection", "ui"]) {
    for (const tail of tails) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginPrompt(1, "task");
      acceptSettledPrompt(protocol, "prompt-1");
      let callbacks = 0;
      const beginNext = () => protocol.beginFallbackPromptCycle(2, "continuation");
      const rejectTransition = () => {
        callbacks += 1;
        assert.throws(beginNext, { message: "RPC fallback prompt cycle cannot start in the current protocol state" });
      };
      let line = '{"type":"agent_settled"}\n';
      if (boundary === "control") {
        protocol.beginControl("state", { type: "get_state" }, rejectTransition);
        line = `${JSON.stringify({ type: "response", id: "state", command: "get_state", success: true, data: CONTROL_STATE })}\n`;
      } else if (boundary === "rejection") {
        protocol.beginPrompt(2, "recovery");
        line = '{"type":"response","id":"prompt-2","command":"prompt","success":false}\n';
      } else if (boundary === "ui") line = '{"type":"extension_ui_request","id":"dialog","method":"confirm"}\n';
      protocol.feed(Buffer.concat([Buffer.from(line), tail]), rejectTransition);
      assert.equal(callbacks, boundary === "ui" ? 2 : 1);
      assert.throws(beginNext);
      const records: ProtocolRecord[] = [];
      protocol.finish((record) => records.push(record));
      assert.deepEqual(records, [{ kind: "protocol_error", category: "partial_record" }]);
      assert.throws(beginNext);
      assert.deepEqual(feed(protocol, [Buffer.from("\n")]), []);
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

test("fallback cycles can drain a split old UI record before starting a new prompt", () => {
  for (const ending of ["\n", "\r\n"]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    acceptSettledPrompt(protocol, "prompt-1");
    const line = Buffer.from(`${JSON.stringify({ type: "extension_ui_request", method: "notify", text: "PRIVATE😀" })}${ending}`);
    const split = line.indexOf(0xf0) + 2;
    assert.deepEqual(feed(protocol, [line.subarray(0, split)]), []);
    assert.throws(() => protocol.beginFallbackPromptCycle(2, "continuation"));
    assert.deepEqual(feed(protocol, [line.subarray(split, -1)]), []);
    assert.throws(() => protocol.beginFallbackPromptCycle(2, "continuation"));
    assert.deepEqual(feed(protocol, [line.subarray(-1)]), [{ kind: "ui_activity", method: "notify" }]);
    protocol.beginFallbackPromptCycle(2, "continuation");
    acceptSettledPrompt(protocol, "route-2:prompt-1");
    assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE/);
    protocol.finish((record) => assert.fail(JSON.stringify(record)));
  }
});

test("fallback cycle responses keep exact line limits across every LF and CRLF chunk boundary", () => {
  const value = { type: "response", id: "route-2:prompt-1", command: "prompt", success: true, ignored: "PRIVATE😀\u2028\u2029" };
  const maxLineBytes = Buffer.byteLength(JSON.stringify(value));
  for (const ending of ["\n", "\r\n"]) {
    const line = Buffer.from(JSON.stringify(value) + ending);
    const chunkings = [
      [line],
      ...Array.from({ length: line.length - 1 }, (_, index) => [line.subarray(0, index + 1), line.subarray(index + 1)]),
      Array.from(line, (byte) => Buffer.from([byte])),
    ];
    for (const chunks of chunkings) {
      const protocol = new RpcJsonlProtocol(maxLineBytes);
      protocol.beginPrompt(1, "task");
      acceptSettledPrompt(protocol, "prompt-1");
      protocol.beginFallbackPromptCycle(2, "continuation");
      const records: ProtocolRecord[] = [];
      for (const [index, chunk] of chunks.entries()) {
        protocol.feed(chunk, (record) => records.push(record));
        if (index < chunks.length - 1) assert.deepEqual(records, []);
        assert.throws(() => protocol.beginFallbackPromptCycle(3, "continuation"));
      }
      assert.deepEqual(records, [{ kind: "prompt_accepted", round: 1 }]);
      assert.deepEqual(feed(protocol, [Buffer.from('{"type":"agent_settled"}\n')]), [{ kind: "event", round: 1, event: { type: "agent_settled" } }]);
      protocol.beginFallbackPromptCycle(3, "continuation");
      assert.deepEqual(feed(protocol, [Buffer.from("x".repeat(maxLineBytes + 1))]), [{ kind: "protocol_error", category: "line_too_large" }]);
      assert.doesNotMatch(JSON.stringify(protocol), /PRIVATE/);
      assert.throws(() => protocol.beginFallbackPromptCycle(4, "continuation"));
      protocol.finish((record) => assert.fail(JSON.stringify(record)));
    }
  }
});

test("fallback cycles keep malformed responses and unfinished prompts terminal in both logical rounds", () => {
  for (const round of [1, 2] as const) {
    const cases: ReadonlyArray<[object | string, string]> = [
      [{ id: undefined }, "malformed_response"], [{ id: 2 }, "malformed_response"],
      [{ command: undefined }, "malformed_response"], [{ command: "parse" }, "malformed_response"],
      [{ success: undefined }, "malformed_response"], [{ success: "false" }, "malformed_response"],
      ["", "missing_prompt_response"], ["{", "partial_record"], ["\r", "partial_record"], ["{nope}\n", "malformed_json"],
    ];
    for (const [patch, category] of cases) {
      const protocol = new RpcJsonlProtocol();
      protocol.beginPrompt(1, "task");
      acceptSettledPrompt(protocol, "prompt-1");
      protocol.beginFallbackPromptCycle(2, "continuation");
      if (round === 2) {
        acceptSettledPrompt(protocol, "route-2:prompt-1");
        protocol.beginPrompt(2, "recovery");
      }
      const response = `${JSON.stringify({ type: "response", id: `route-2:prompt-${round}`, command: "prompt", success: true })}\n`;
      let text = patch;
      if (typeof patch !== "string") text = `${JSON.stringify({
        type: "response", id: `route-2:prompt-${round}`, command: "prompt", success: true, error: "PRIVATE_RESPONSE", ...patch,
      })}\n` + response;
      const records = feed(protocol, [Buffer.from('{"type":"agent_start","payload":"PRIVATE_BUFFER"}\n' + text)]);
      protocol.finish((record) => records.push(record));
      protocol.finish((record) => records.push(record));
      assert.deepEqual(records, [{ kind: "protocol_error", category }]);
      assert.doesNotMatch(JSON.stringify([records, protocol]), /PRIVATE/);
      assert.deepEqual(feed(protocol, [Buffer.from(response)]), []);
      assert.throws(() => protocol.beginPrompt(2, "recovery"));
      assert.throws(() => protocol.beginControl("state", { type: "get_state" }, () => {}));
      assert.throws(() => protocol.beginFallbackPromptCycle(3, "continuation"));
    }
  }
});

test("fallback cycles allow rejection callbacks to start an idle control before the next route", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  for (const route of [1, 2]) {
    const id = route === 1 ? "prompt-1" : "route-2:prompt-1";
    let command: string | undefined;
    protocol.feed(Buffer.from(`${JSON.stringify({ type: "response", id, command: "prompt", success: false, error: "PRIVATE" })}\n`), (record) => {
      assert.deepEqual(record, { kind: "prompt_rejected", round: 1, category: "command_rejected" });
      protocol.beginControl(`route-${route}:state`, { type: "get_state" }, () => {
        command = protocol.beginFallbackPromptCycle(route + 1, "continuation");
      });
    });
    assert.throws(() => protocol.beginFallbackPromptCycle(route + 1, "continuation"));
    assert.deepEqual(controlReply(protocol, `route-${route}:state`, "get_state", CONTROL_STATE), []);
    assert.equal(command, `${JSON.stringify({ id: `route-${route + 1}:prompt-1`, type: "prompt", message: "continuation" })}\n`);
  }
  acceptSettledPrompt(protocol, "route-3:prompt-1");
  protocol.finish((record) => assert.fail(JSON.stringify(record)));
});

test("serializes exact prompt-1 and prompt-2 LF commands", () => {
  assert.equal(
    serializePromptCommand(1, "task"),
    '{"id":"prompt-1","type":"prompt","message":"task"}\n',
  );
  assert.equal(
    serializePromptCommand(2, REPORT_RECOVERY_PROMPT),
    `${JSON.stringify({ id: "prompt-2", type: "prompt", message: REPORT_RECOVERY_PROMPT })}\n`,
  );
});

test("accepts LF and CRLF records with correlated responses", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  const records = feed(protocol, [Buffer.from(
    '{"id":"prompt-1","type":"response","command":"prompt","success":true}\r\n',
  )]);
  assert.deepEqual(records, [{ kind: "prompt_accepted", round: 1 }]);
});

test("preserves partial UTF-8 and partial JSON chunks", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  const line = Buffer.from('{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"😀"}}\n');
  const split = line.indexOf(0xf0) + 2;
  const records = feed(protocol, [
    line.subarray(0, split),
    line.subarray(split),
    Buffer.from('{"id":"prompt-1","type":"response","command":"prompt","success":true}\n'),
  ]);
  assert.equal(records[0]?.kind, "prompt_accepted");
  assert.equal(records[1]?.kind, "event");
  if (records[1]?.kind === "event") {
    const update = records[1].event.assistantMessageEvent as Record<string, unknown>;
    assert.equal(update.delta, "😀");
  }
});

test("buffers lifecycle events until the prompt response is accepted", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  const records = feed(protocol, [Buffer.from(
    '{"type":"agent_start"}\n'
      + '{"id":"prompt-1","type":"response","command":"prompt","success":true}\n'
      + '{"type":"agent_end","willRetry":false}\n',
  )]);
  assert.deepEqual(records.map((record) => record.kind), ["prompt_accepted", "event", "event"]);
});

test("tool-call ids at the fixed cap stay valid with opaque characters preserved", () => {
  // Exactly 200 code units, including a surrogate pair, a NUL, and accented
  // letters: the id is opaque, there is no character allowlist, and the
  // full id survives to the emitted event after prompt acceptance.
  const opaqueId = "😀\u0000éz".repeat(40);
  assert.equal(opaqueId.length, 200);
  for (const type of ["tool_execution_start", "tool_execution_update", "tool_execution_end"]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    const records = feed(protocol, [Buffer.from(
      `{"id":"prompt-1","type":"response","command":"prompt","success":true}\n`
        + `${JSON.stringify({ type, toolCallId: opaqueId, toolName: "bash" })}\n`,
    )]);
    assert.deepEqual(records.map((record) => record.kind), ["prompt_accepted", "event"], type);
    const event = records[1];
    if (event?.kind === "event") assert.equal(event.event.toolCallId, opaqueId, type);
  }
  // Missing and empty ids stay anonymous-correlatable passthrough events.
  const anonymous = new RpcJsonlProtocol();
  anonymous.beginPrompt(1, "task");
  const anonymousRecords = feed(anonymous, [Buffer.from(
    '{"id":"prompt-1","type":"response","command":"prompt","success":true}\n'
      + '{"type":"tool_execution_start","toolName":"bash"}\n'
      + '{"type":"tool_execution_update","toolCallId":"","toolName":"bash"}\n',
  )]);
  assert.deepEqual(anonymousRecords.map((record) => record.kind), ["prompt_accepted", "event", "event"]);
});

test("an oversized tool-call id is one fixed protocol error before buffering or emission", () => {
  const oversized = "x".repeat(201);
  for (const type of ["tool_execution_start", "tool_execution_update", "tool_execution_end"]) {
    // The oversized event arrives while the prompt response is still pending,
    // so the bound must fire before the event is buffered for round 1.
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    const records = feed(protocol, [Buffer.from(
      `${JSON.stringify({ type, toolCallId: oversized, toolName: "bash" })}\n`
        + '{"id":"prompt-1","type":"response","command":"prompt","success":true}\n',
    )]);
    assert.deepEqual(records, [{ kind: "protocol_error", category: "tool_call_id_too_long" }], type);
    // The failed protocol never emits the buffered prompt acceptance either.
    const after: ProtocolRecord[] = [];
    protocol.finish((record) => after.push(record));
    assert.deepEqual(after, [], type);
  }
});

test("a pre-prompt oversized tool-call id still reports only the fixed category", () => {
  // No prompt was ever sent: the id bound fires before the
  // event_without_prompt correlation check, so the category stays fixed.
  const protocol = new RpcJsonlProtocol();
  const records = feed(protocol, [Buffer.from(
    `${JSON.stringify({ type: "tool_execution_end", toolCallId: "y".repeat(201) })}\n`,
  )]);
  assert.deepEqual(records, [{ kind: "protocol_error", category: "tool_call_id_too_long" }]);
});

test("an oversized update or end is never emitted and so cannot reach the monitor", () => {
  // A valid id-backed start and a valid anonymous start are accepted first;
  // the oversized update and end produce only the fixed protocol error and
  // no event record, so nothing downstream can match or remove either tool.
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  const records = feed(protocol, [Buffer.from(
    '{"id":"prompt-1","type":"response","command":"prompt","success":true}\n'
      + '{"type":"agent_start"}\n'
      + '{"type":"tool_execution_start","toolCallId":"valid","toolName":"bash"}\n'
      + '{"type":"tool_execution_start","toolName":"read"}\n'
      + `${JSON.stringify({ type: "tool_execution_update", toolCallId: "valid" + "x".repeat(201) })}\n`,
  )]);
  assert.deepEqual(records.at(-1), { kind: "protocol_error", category: "tool_call_id_too_long" });
  const emitted = records.filter((record) => record.kind === "event");
  assert.equal(emitted.length, 3);
  const after: ProtocolRecord[] = [];
  protocol.feed(Buffer.from(
    `${JSON.stringify({ type: "tool_execution_end", toolCallId: "z".repeat(300) })}\n`,
  ), (record) => after.push(record));
  assert.deepEqual(after, []);
});

test("classifies rejected prompt commands without retaining raw errors", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "SECRET_PROMPT");
  const records = feed(protocol, [Buffer.from(
    '{"id":"prompt-1","type":"response","command":"prompt","success":false,"error":"PRIVATE BILLING TEXT"}\n',
  )]);
  assert.deepEqual(records, [{ kind: "prompt_rejected", round: 1, category: "command_rejected" }]);
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE|BILLING|SECRET/);
});

test("rejects duplicate and unknown response IDs", () => {
  const duplicate = new RpcJsonlProtocol();
  duplicate.beginPrompt(1, "task");
  const duplicateRecords = feed(duplicate, [Buffer.from(
    '{"id":"prompt-1","type":"response","command":"prompt","success":true}\n'
      + '{"id":"prompt-1","type":"response","command":"prompt","success":true}\n',
  )]);
  assert.equal(duplicateRecords.at(-1)?.kind, "protocol_error");
  assert.deepEqual(duplicateRecords.at(-1), { kind: "protocol_error", category: "duplicate_response" });

  const unknown = new RpcJsonlProtocol();
  unknown.beginPrompt(1, "task");
  const unknownRecords = feed(unknown, [Buffer.from(
    '{"id":"other","type":"response","command":"prompt","success":true}\n',
  )]);
  assert.deepEqual(unknownRecords, [{ kind: "protocol_error", category: "unknown_response" }]);
});

test("fails malformed JSON, trailing records, and oversized input with bounded categories", () => {
  const malformed = new RpcJsonlProtocol();
  malformed.beginPrompt(1, "task");
  assert.deepEqual(feed(malformed, [Buffer.from("{nope}\n")]), [
    { kind: "protocol_error", category: "malformed_json" },
  ]);

  const trailing = new RpcJsonlProtocol();
  trailing.beginPrompt(1, "task");
  const trailingRecords: ProtocolRecord[] = [];
  trailing.feed(Buffer.from("{"), (record) => trailingRecords.push(record));
  trailing.finish((record) => trailingRecords.push(record));
  assert.deepEqual(trailingRecords, [{ kind: "protocol_error", category: "partial_record" }]);

  const oversized = new RpcJsonlProtocol(10);
  oversized.beginPrompt(1, "task");
  assert.deepEqual(feed(oversized, [Buffer.from("12345678901")]), [
    { kind: "protocol_error", category: "line_too_large" },
  ]);
});

test("cancels blocking extension UI and ignores fire-and-forget requests", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  const records = feed(protocol, [Buffer.from(
    '{"type":"extension_ui_request","id":"dialog-1","method":"confirm","message":"PRIVATE"}\n'
      + '{"type":"extension_ui_request","id":"note-1","method":"notify","message":"PRIVATE"}\n',
  )]);
  assert.deepEqual(records.map((record) => record.kind), ["ui_activity", "ui_response", "ui_activity"]);
  const response = records.find((record) => record.kind === "ui_response");
  assert.deepEqual(response, {
    kind: "ui_response",
    method: "confirm",
    line: '{"type":"extension_ui_response","id":"dialog-1","cancelled":true}\n',
  });
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE/);
});

test("valid dialogs emit ui_activity then a cancellation ui_response for all four methods", () => {
  for (const method of ["select", "confirm", "input", "editor"]) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    const records = feed(protocol, [Buffer.from(
      `{"type":"extension_ui_request","id":"dialog-1","method":"${method}"}\n`,
    )]);
    assert.deepEqual(records, [
      { kind: "ui_activity", method },
      {
        kind: "ui_response",
        method,
        line: '{"type":"extension_ui_response","id":"dialog-1","cancelled":true}\n',
      },
    ], method);
  }
});

test("malformed dialog ids and methods emit only protocol_error and never ui_activity", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["missing dialog id", '{"type":"extension_ui_request","method":"confirm"}'],
    ["empty dialog id", '{"type":"extension_ui_request","id":"","method":"select"}'],
    ["non-string dialog id", '{"type":"extension_ui_request","id":7,"method":"input"}'],
    ["oversized dialog id", `{"type":"extension_ui_request","id":"${"x".repeat(201)}","method":"editor"}`],
    ["missing method", '{"type":"extension_ui_request","id":"dialog-1"}'],
    ["empty method", '{"type":"extension_ui_request","id":"dialog-1","method":""}'],
    ["non-string method", '{"type":"extension_ui_request","id":"dialog-1","method":5}'],
    ["oversized method", `{"type":"extension_ui_request","id":"dialog-1","method":"${"m".repeat(81)}"}`],
  ];
  for (const [label, line] of cases) {
    const protocol = new RpcJsonlProtocol();
    protocol.beginPrompt(1, "task");
    const records = feed(protocol, [Buffer.from(`${line}\n`)]);
    assert.deepEqual(records, [{ kind: "protocol_error", category: "malformed_ui_request" }], label);
  }
});

test("a repeated dialog id is a duplicate protocol error without a second ui_activity", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  const records = feed(protocol, [Buffer.from(
    '{"type":"extension_ui_request","id":"dialog-1","method":"confirm"}\n'
      + '{"type":"extension_ui_request","id":"dialog-1","method":"select"}\n',
  )]);
  assert.deepEqual(records.map((record) => record.kind), ["ui_activity", "ui_response", "protocol_error"]);
  assert.deepEqual(records.at(-1), { kind: "protocol_error", category: "duplicate_ui_request" });
});

test("notify and accepted fire-and-forget methods emit exactly one ui_activity", () => {
  const protocol = new RpcJsonlProtocol();
  protocol.beginPrompt(1, "task");
  const records = feed(protocol, [Buffer.from(
    '{"type":"extension_ui_request","id":"note-1","method":"notify"}\n'
      + '{"type":"extension_ui_request","method":"setStatus"}\n'
      + '{"type":"extension_ui_request","id":"x","method":"customWidgetUpdate"}\n',
  )]);
  assert.deepEqual(records, [
    { kind: "ui_activity", method: "notify" },
    { kind: "ui_activity", method: "setStatus" },
    { kind: "ui_activity", method: "customWidgetUpdate" },
  ]);
});

test("classifies credit, quota, billing, usage, auth, rate, and availability failures", () => {
  const cases = new Map<string, string>([
    ["HTTP 402 payment required", "billing_limit"],
    ["insufficient_quota", "quota_exhausted"],
    ["credit balance depleted: 12.34", "credits_exhausted"],
    ["billing limit reached", "billing_limit"],
    ["usage limit reached", "usage_limit"],
    ["401 invalid api key", "authentication"],
    ["429 rate limit", "rate_limit"],
    ["503 model unavailable", "provider_unavailable"],
  ]);
  for (const [input, expected] of cases) assert.equal(classifyProviderFailure(input), expected);
});

test("the recovery prompt requests one same-session protocol repair without repeating work", () => {
  assert.match(REPORT_RECOVERY_PROMPT, /Do not repeat work or call tools/);
  assert.match(REPORT_RECOVERY_PROMPT, /Using only existing session evidence/);
  assert.match(REPORT_RECOVERY_PROMPT, /Follow the original Final protocol/);
  assert.match(REPORT_RECOVERY_PROMPT, /one valid DELEGATE_REASON line directly above it/);
  assert.match(REPORT_RECOVERY_PROMPT, /COMPLETED has none/);
  assert.doesNotMatch(REPORT_RECOVERY_PROMPT, /evidence_inaccessible|execution_failure/);
  // The recovery prompt stays marker-protocol focused: it never carries raw
  // output, provider text, or paths.
  assert.doesNotMatch(REPORT_RECOVERY_PROMPT, /http|\/home\/|token=/i);
});
