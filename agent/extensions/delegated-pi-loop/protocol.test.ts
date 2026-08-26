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

test("the recovery prompt requires the reason line with exact allowed codes for non-completed results", () => {
  assert.match(REPORT_RECOVERY_PROMPT, /one DELEGATE_REASON line directly above the marker with one exact allowed code/);
  assert.match(REPORT_RECOVERY_PROMPT, /no prose, paths, or details/);
  assert.match(REPORT_RECOVERY_PROMPT, /BLOCKED allows evidence_inaccessible,/);
  assert.match(REPORT_RECOVERY_PROMPT, /FAILED allows\s+execution_failure, verification_failure, internal_inconsistency,/);
  assert.match(REPORT_RECOVERY_PROMPT, /COMPLETED takes no reason line; reviews with findings must\s+use COMPLETED/);
  // The recovery prompt stays marker-protocol focused: it never carries raw
  // output, provider text, or paths.
  assert.doesNotMatch(REPORT_RECOVERY_PROMPT, /http|\/home\/|token=/i);
});
