import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_RECOVERY_PROMPT } from "./instructions.ts";
import {
  classifyProviderFailure,
  RpcJsonlProtocol,
  serializePromptCommand,
  type ProtocolRecord,
} from "./protocol.ts";

function feed(protocol: RpcJsonlProtocol, chunks: Buffer[]): ProtocolRecord[] {
  const records: ProtocolRecord[] = [];
  for (const chunk of chunks) protocol.feed(chunk, (record) => records.push(record));
  return records;
}

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
