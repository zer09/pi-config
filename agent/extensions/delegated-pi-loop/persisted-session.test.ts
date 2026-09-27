import assert from "node:assert/strict";
import { after, test } from "node:test";
import { renameSync, writeFileSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SystemMessage, Tool, Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { createPersistedPiSession } from "./persisted-session.ts";
import { loadTargetSessionManager } from "./pi-session-projection.fixture.ts";
import { buildDelegatePrompt, LIVE_CONTINUATION_PROMPT, RESTART_AFTER_WORK_NOTE } from "./instructions.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "delegate-session-test-"));
after(async () => { await rm(root, { recursive: true, force: true }); });

test("session creation precreates one empty private file and keeps acceptance only in memory", async () => {
  const directory = await mkdtemp(path.join(root, "private-"));
  const session = await createPersistedPiSession(directory);
  assert.deepEqual(session.args, ["--session-dir", directory, "--session", path.join(directory, "session.jsonl")]);
  assert.ok(Object.isFrozen(session.args));
  const file = await lstat(session.args[3]!);
  assert.equal(file.size, 0);
  assert.equal(file.mode & 0o7777, 0o600);
  assert.ok(file.isFile());
  assert.equal((await lstat(directory)).mode & 0o7777, 0o700);
  assert.equal(session.assignmentAccepted, false);
  session.assignmentAccepted = true;
  session.verifySpawn();
  assert.equal((await lstat(session.args[3]!)).size, 0, "acceptance never writes session content");
});

for (const fault of ["symlink", "directory", "mode", "missing", "parent-mode", "parent-replaced", "parent-symlink"]) {
  test(`session metadata validation fails closed for ${fault}`, async () => {
    const directory = await mkdtemp(path.join(root, "unsafe-"));
    const session = await createPersistedPiSession(directory);
    const file = session.args[3]!;
    if (fault === "mode") await chmod(file, 0o640);
    else if (fault === "parent-mode") await chmod(directory, 0o750);
    else if (fault.startsWith("parent-")) {
      await rename(directory, `${directory}-old`);
      if (fault === "parent-symlink") await symlink(`${directory}-old`, directory);
      else {
        await mkdir(directory, { mode: 0o700 });
        await writeFile(file, "", { mode: 0o600 });
      }
    } else {
      await rm(file);
      if (fault === "directory") await mkdir(file, { mode: 0o600 });
      if (fault === "symlink") await symlink(path.join(root, "never-read"), file);
    }
    assert.throws(() => session.verifySpawn(), { message: "Delegated session validation failed" });
    assert.equal(session.historyFailureCategory, undefined, "spawn validation cannot set a history category");
    assert.equal(await session.historyReadiness("private original", "private restart"), "invalid");
    assert.equal(session.historyFailureCategory, "file_integrity");
  });
}

test("session initialization sanitizes errors and never overwrites an existing file", async () => {
  const directory = await mkdtemp(path.join(root, "existing-"));
  const file = path.join(directory, "session.jsonl");
  await writeFile(file, "fixture only", { mode: 0o600 });
  const before = await lstat(file);
  await assert.rejects(createPersistedPiSession(directory), { message: "Delegated session initialization failed" });
  assert.equal((await lstat(file)).size, before.size);
});

const role = { id: "remediation", family: "remediation", profile: "fixture" } as const;
const original = buildDelegatePrompt(role, root, "PRIVATE-ASSIGNMENT\nUnicode 終");
const restarted = buildDelegatePrompt(role, root, "PRIVATE-ASSIGNMENT\nUnicode 終", { restartAfterWork: true });
const header = { type: "session", version: 3, id: "private-header-id", timestamp: "2026-08-01T00:00:00.000Z", cwd: root };
const base = { type: "message", id: "entry-1", parentId: null, timestamp: header.timestamp };
const user = (content: unknown = original) => ({ ...base, message: { role: "user", content, timestamp: 1 } });
const jsonl = (...entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";

for (const [name, text] of [
  ["complete string", jsonl(header, user())],
  ["text blocks", jsonl(header, user([{ type: "text", text: original.slice(0, 30) }, { type: "text", text: original.slice(30) }]))],
  ["canonical restart", jsonl(header, user(restarted))],
  ["missing final LF", jsonl(header, user()).trimEnd()],
  ["malformed prefix and tail", "\n{torn\n" + jsonl(header, user()) + '{"type":"message"'],
  ["malformed middle", jsonl(header) + "{bad\n\n" + jsonl(user())],
  ["administrative leaf", jsonl(header, user(), { ...base, type: "model_change", id: "entry-2", parentId: "entry-1", provider: "fixture", modelId: "fixture" })],
  ["compacted active branch", jsonl(header, user(), { ...base, type: "compaction", id: "entry-2", parentId: "entry-1", firstKeptEntryId: "entry-1", summary: "Summary", tokensBefore: 100 })],
] as const) {
  test(`readiness accepts ${name} without modifying private history or acknowledgement`, async () => {
    const directory = await mkdtemp(path.join(root, "ready-"));
    const session = await createPersistedPiSession(directory);
    await writeFile(session.args[3]!, text);
    session.assignmentAccepted = true;
    const before = await lstat(session.args[3]!);
    assert.equal(await session.historyReadiness(original, restarted), "usable");
    assert.equal(session.historyFailureCategory, undefined);
    assert.equal(session.assignmentAccepted, true);
    assert.equal(await readFile(session.args[3]!, "utf8"), text);
    assert.equal((await lstat(session.args[3]!)).mtimeMs, before.mtimeMs);
  });
}

for (const [name, text] of [
  ["header only", jsonl(header)],
  ["truncated assignment JSON", jsonl(header) + JSON.stringify(user()).slice(0, -10)],
  ["complete JSON with partial assignment text", jsonl(header, user(original.slice(0, -1)))],
  ["continuation only", jsonl(header, user(LIVE_CONTINUATION_PROMPT))],
  ["restart note only", jsonl(header, user(RESTART_AFTER_WORK_NOTE))],
  ["extra text", jsonl(header, user(original + " extra"))],
  ["custom entry", jsonl(header, { ...base, type: "custom", customType: "fixture", data: user() })],
  ["custom message entry", jsonl(header, { ...base, type: "custom_message", customType: "fixture", content: original, display: true })],
  ["custom role", jsonl(header, { ...user(), message: { role: "custom", content: original, timestamp: 1, customType: "fixture", display: true } })],
  ["assistant role", jsonl(header, { ...user(), message: { role: "assistant", content: [{ type: "text", text: original }], timestamp: 1, provider: "fixture", model: "fixture", stopReason: "stop" } })],
  ["off-branch assignment", jsonl(header, user(), { ...user("Other work"), id: "entry-2" })],
  ["off-branch assignment before administrative leaf", jsonl(header, user(), { ...base, type: "thinking_level_change", id: "entry-2", thinkingLevel: "off" })],
] as const) {
  test(`readiness distinguishes valid history without assignment: ${name}`, async () => {
    const directory = await mkdtemp(path.join(root, "absent-"));
    const session = await createPersistedPiSession(directory);
    await writeFile(session.args[3]!, text);
    assert.equal(await session.historyReadiness(original, restarted), "assignment_absent");
    assert.equal(session.historyFailureCategory, undefined);
  });
}

for (const [name, text] of [
  ["empty", ""], ["unparsed", "\n{torn\n"], ["null header", jsonl(null, header, user())],
  ["array header", jsonl([], header)], ["header after entry", jsonl(user(), header)],
  ["missing header identity", jsonl({ ...header, id: null }, user())],
  ["invalid header timestamp", jsonl({ ...header, timestamp: "PRIVATE-BAD-TIMESTAMP" }, user())],
  ["invalid header version", jsonl({ ...header, version: 1 }, user())],
  ["invalid header cwd", jsonl({ ...header, cwd: null }, user())],
  ["second header", jsonl(header, user(), header)],
  ["duplicate ID", jsonl(header, user(), user())],
  ["orphan", jsonl(header, { ...user(), parentId: "PRIVATE-MISSING-ID" })],
  ["self cycle", jsonl(header, { ...user(), parentId: "entry-1" })],
  ["forward cycle", jsonl(header, { ...user(), parentId: "entry-2" }, { ...user(), id: "entry-2", parentId: "entry-1" })],
  ["bad off-branch tree", jsonl(header, { ...user(), parentId: "missing" }, { ...user(), id: "entry-2" })],
  ["bad parent type", jsonl(header, { ...user(), parentId: 0 })],
  ["bad entry timestamp", jsonl(header, { ...user(), timestamp: null })],
  ["bad message", jsonl(header, { ...user(), message: null })],
  ["bad content block", jsonl(header, user([{ type: "text", text: original }, { type: "text" }]))],
  ["missing message timestamp", jsonl(header, { ...user(), message: { role: "user", content: original } })],
  ["unknown entry", jsonl(header, { ...user(), type: "PRIVATE-UNKNOWN" })],
] as const) {
  test(`readiness returns only invalid for unsafe ${name}`, async () => {
    const directory = await mkdtemp(path.join(root, "invalid-"));
    const session = await createPersistedPiSession(directory);
    await writeFile(session.args[3]!, text);
    assert.equal(await session.historyReadiness(original, restarted), "invalid");
  });
}

const toolDefinition = { name: "read", description: "Read a fixture", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } satisfies Tool;
const system = { role: "system", content: "Fixture system prompt", timestamp: 2 } satisfies SystemMessage;

for (const [name, changes] of [
  ["string", {}],
  ["text blocks", { content: [{ type: "text", text: "Fixture", textSignature: "fixture-signature" }, { type: "text", text: " prompt" }] }],
  ["empty changes", { content: [], sections: {}, toolsAdded: [], toolsRemoved: [] }],
  ["sections and tool changes", { content: "", sections: { preamble: "Fixture", removed: null }, toolsAdded: [toolDefinition], toolsRemoved: [{ name: "write" }] }],
  ["unconstrained tool", { toolsAdded: [{ ...toolDefinition, parameters: {}, constrainedSampling: false }] }],
  ["grammar with one required string property", {
    toolsAdded: [{ ...toolDefinition, constrainedSampling: { type: "grammar", variants: { openai_regex: "ok" } } }],
  }],
  ...["prefer", "require"].map((strict) => [
    `json_schema ${strict}`, { toolsAdded: [{ ...toolDefinition, constrainedSampling: { type: "json_schema", strict } }] },
  ] as const),
  ...[{ openai_lark: " \t\n", openai_regex: " ok " }, { openai_lark: 'start: "ok"' }, { openai_regex: "ok" }, { openai_lark: 'start: "ok"', openai_regex: "ok" }].map((variants, index) => [
    `grammar ${index}`, { toolsAdded: [{ ...toolDefinition, constrainedSampling: { type: "grammar", variants } }] },
  ] as const),
  ["original impersonation", { content: original, sections: { assignment: original }, toolsAdded: [{ ...toolDefinition, description: original }] }],
  ["restart impersonation", { content: [{ type: "text", text: restarted }], sections: { assignment: restarted } }],
] as const) {
  for (const position of ["before", "after", "alone"] as const) {
    test(`system ${name} ${position} assignment preserves user-only identity`, async () => {
      const directory = await mkdtemp(path.join(root, "system-"));
      const session = await createPersistedPiSession(directory);
      const entry = { ...base, id: "system", message: { ...system, ...changes } };
      let entries: unknown[] = [entry];
      if (position === "before") entries.push({ ...user(), parentId: "system" });
      else if (position === "after") entries = [user(restarted), { ...entry, parentId: "entry-1" }];
      const text = jsonl(header, ...entries);
      await writeFile(session.args[3]!, text);
      assert.equal(await session.historyReadiness(original, restarted), position === "alone" ? "assignment_absent" : "usable");
      assert.equal(session.assignmentAccepted, false);
      assert.equal(await readFile(session.args[3]!, "utf8"), text);
    });
  }
}

for (const [name, changes] of [
  ["missing content", { content: undefined }], ["null content", { content: null }], ["numeric content", { content: 1 }],
  ["missing text", { content: [{ type: "text" }] }], ["non-string signature", { content: [{ type: "text", text: "", textSignature: 1 }] }],
  ["image block", { content: [{ type: "image", data: "fixture", mimeType: "image/png" }] }],
  ["thinking block", { content: [{ type: "thinking", thinking: original }] }],
  ["toolCall block", { content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }] }],
  ["unknown block", { content: [{ type: "unknown", text: original }] }], ["null block", { content: [null] }],
  ["missing timestamp", { timestamp: undefined }], ["negative timestamp", { timestamp: -1 }], ["string timestamp", { timestamp: "2" }],
  ["null sections", { sections: null }], ["array sections", { sections: [] }], ["non-string section", { sections: { preamble: 1 } }],
  ["null toolsAdded", { toolsAdded: null }], ["object toolsAdded", { toolsAdded: toolDefinition }], ["null tool", { toolsAdded: [null] }],
  ...["name", "description", "parameters"].map((key) => [
    `missing tool ${key}`, { toolsAdded: [{ ...toolDefinition, [key]: undefined }] },
  ] as const),
  ["non-string tool name", { toolsAdded: [{ ...toolDefinition, name: 1 }] }],
  ["non-string tool description", { toolsAdded: [{ ...toolDefinition, description: 1 }] }],
  ...[null, [], "schema"].map((parameters) => [
    `invalid parameters ${JSON.stringify(parameters)}`, { toolsAdded: [{ ...toolDefinition, parameters }] },
  ] as const),
  ...[true, null, {}, { type: "unknown" }, { type: "json_schema" }, { type: "json_schema", strict: true },
    { type: "grammar" }, { type: "grammar", variants: [] }, { type: "grammar", variants: { openai_regex: 1 } },
    { type: "grammar", variants: { unknown: "ok" } }].map((constrainedSampling, index) => [
    `invalid constrained sampling ${index}`, { toolsAdded: [{ ...toolDefinition, constrainedSampling }] },
  ] as const),
  ["empty grammar variants", { toolsAdded: [{ ...toolDefinition, constrainedSampling: { type: "grammar", variants: {} } }] }],
  ["whitespace-only grammar variants", { toolsAdded: [{ ...toolDefinition, constrainedSampling: { type: "grammar", variants: { openai_lark: " \t\n", openai_regex: "" } } }] }],
  ["grammar non-object root", {
    toolsAdded: [{ ...toolDefinition, parameters: { type: "string" }, constrainedSampling: { type: "grammar", variants: { openai_regex: "ok" } } }],
  }],
  ["grammar zero required properties", {
    toolsAdded: [{ ...toolDefinition, parameters: { type: "object", properties: { path: { type: "string" } }, required: [] },
      constrainedSampling: { type: "grammar", variants: { openai_regex: "ok" } } }],
  }],
  ["grammar two required properties", {
    toolsAdded: [{ ...toolDefinition, parameters: { type: "object", properties: { path: { type: "string" }, mode: { type: "string" } }, required: ["path", "mode"] },
      constrainedSampling: { type: "grammar", variants: { openai_regex: "ok" } } }],
  }],
  ["grammar missing required property schema", {
    toolsAdded: [{ ...toolDefinition, parameters: { type: "object", properties: {}, required: ["path"] },
      constrainedSampling: { type: "grammar", variants: { openai_regex: "ok" } } }],
  }],
  ["grammar non-string property", {
    toolsAdded: [{ ...toolDefinition, parameters: { type: "object", properties: { path: { type: "number" } }, required: ["path"] },
      constrainedSampling: { type: "grammar", variants: { openai_regex: "ok" } } }],
  }],
  ["json_schema require missing root type", { toolsAdded: [{ ...toolDefinition, parameters: {}, constrainedSampling: { type: "json_schema", strict: "require" } }] }],
  ["json_schema require non-object root", { toolsAdded: [{ ...toolDefinition, parameters: { type: "string" }, constrainedSampling: { type: "json_schema", strict: "require" } }] }],
  ["null toolsRemoved", { toolsRemoved: null }], ["object toolsRemoved", { toolsRemoved: { name: "read" } }],
  ["string reference", { toolsRemoved: ["read"] }], ["missing reference name", { toolsRemoved: [{}] }],
  ["non-string reference name", { toolsRemoved: [{ name: 1 }] }],
] as const) {
  test(`malformed system ${name} fails closed even after assignment`, async () => {
    const directory = await mkdtemp(path.join(root, "invalid-system-"));
    const session = await createPersistedPiSession(directory);
    await writeFile(session.args[3]!, jsonl(header, user(), { ...base, id: "system", parentId: "entry-1", message: { ...system, ...changes } }));
    assert.equal(await session.historyReadiness(original, restarted), "invalid");
  });
}

// Synthetic schemas pin Pi 0.87.1 acceptance without a Pi runtime import or resolver.
for (const [name, schema, expected] of [
  ["empty object", { type: "object" }, "usable"],
  ["optional property auto-fixed by Pi", { type: "object", properties: { path: { type: "string" } } }, "usable"],
  ["optional structured properties auto-fixed by Pi", { type: "object", properties: {
    options: { type: "object", properties: { flag: { type: "boolean" } } },
    paths: { type: "array", items: { type: "object", properties: { path: { type: "string" } } } },
  } }, "usable"],
  ["nullable type union", { type: ["string", "null"] }, "usable"],
  ["nullable anyOf", { anyOf: [{ type: "string" }, { anyOf: [{ type: "number" }, { type: "null" }] }] }, "usable"],
  ["nullable const and enum", { type: "object", properties: { fixed: { const: null }, choice: { enum: ["ok", null] } } }, "usable"],
  ["closed object and duplicate required", { type: "object", properties: { path: { type: "string" } }, required: ["path", "path"], additionalProperties: false }, "usable"],
  ["object with scalar anyOf", { type: "object", anyOf: [{ type: "string" }, { type: "null" }] }, "usable"],
  ["untyped property", {}, "usable"],
  ["array without items", { type: "array" }, "usable"],
  ["nullable array type with items", { type: ["array", "null"], items: { type: "string" } }, "usable"],
  ["non-object keywords left unchanged by Pi", { type: "string", required: 1, additionalProperties: true }, "usable"],
  ["annotation is not a schema", { type: "string", default: { $ref: "fixture", additionalProperties: true } }, "usable"],
  ["nested additionalProperties true", { type: "object", properties: { inner: { type: "object", additionalProperties: true } } }, "invalid"],
  ...[true, {}, null].map((additionalProperties) => [
    `additionalProperties ${JSON.stringify(additionalProperties)}`, { type: "object", additionalProperties }, "invalid",
  ] as const),
  ...["$ref", "$defs", "definitions", "allOf", "oneOf", "patternProperties", "dependentSchemas", "dependencies",
    "unevaluatedProperties", "propertyNames", "contains", "prefixItems", "not", "if", "then", "else"].map((key) => [
    `unsupported ${key}`, { [key]: null }, "invalid",
  ] as const),
  ["unsupported key in items", { type: "array", items: { $ref: "fixture" } }, "invalid"],
  ["unsupported key in anyOf", { anyOf: [{ type: "string" }, { not: {} }] }, "invalid"],
  ...[[], {}, null].map((anyOf) => [`malformed anyOf ${JSON.stringify(anyOf)}`, { anyOf }, "invalid"] as const),
  ...[{ type: "object" }, { type: "array" }, { type: ["object", "null"] }, { type: ["array", "null"] },
    { properties: {} }, { items: {} }].map((variant) => [
    `structured anyOf ${JSON.stringify(variant)}`, { anyOf: [{ type: "null" }, variant] }, "invalid",
  ] as const),
  ["nested structured anyOf", { anyOf: [{ anyOf: [{ type: "object" }] }] }, "invalid"],
  ["boolean property schema", false, "invalid"],
  ["null property schema", null, "invalid"],
  ["boolean anyOf schema", { anyOf: [true] }, "invalid"],
  ...[[], [{ type: "string" }], false, null].map((items) => [
    `invalid items ${JSON.stringify(items)}`, { type: "array", items }, "invalid",
  ] as const),
  ...[undefined, "string", ["object", "null"]].map((type) => [
    `properties without object type ${JSON.stringify(type)}`, { type, properties: {} }, "invalid",
  ] as const),
  ...[null, [], "invalid"].map((properties) => [
    `malformed properties ${JSON.stringify(properties)}`, { type: "object", properties }, "invalid",
  ] as const),
  ...[null, "path", {}, [1], ["missing"], ["toString"]].map((required) => [
    `malformed required ${JSON.stringify(required)}`, { type: "object", properties: { path: { type: "string" } }, required }, "invalid",
  ] as const),
] as const) {
  for (const strict of ["require", "prefer"] as const) {
    test(`strict ${strict} schema ${name} matches Pi 0.87.1 readiness`, async () => {
      const directory = await mkdtemp(path.join(root, "strict-schema-"));
      const session = await createPersistedPiSession(directory);
      const message = { ...system, toolsAdded: [{ ...toolDefinition,
        parameters: { type: "object", properties: { value: schema } }, constrainedSampling: { type: "json_schema", strict },
      }] };
      for (const entry of [
        { ...base, id: "system", parentId: "entry-1", message },
        { ...base, type: "compaction", id: "compact", parentId: "entry-1", summary: "Fixture", tokensBefore: 1,
          firstKeptEntryId: "entry-1", retainedTail: [user().message, message] },
      ]) {
        const text = jsonl(header, user(), entry);
        await writeFile(session.args[3]!, text);
        const before = await lstat(session.args[3]!);
        assert.equal(await session.historyReadiness(original, restarted), strict === "require" ? expected : "usable");
        assert.equal(session.assignmentAccepted, false);
        assert.equal(await readFile(session.args[3]!, "utf8"), text);
        assert.equal((await lstat(session.args[3]!)).mtimeMs, before.mtimeMs);
      }
    });
  }
}

test("non-finite system timestamp fails closed even after assignment", async () => {
  const directory = await mkdtemp(path.join(root, "invalid-system-"));
  const session = await createPersistedPiSession(directory);
  const text = jsonl(header, user(), { ...base, id: "system", parentId: "entry-1", message: system });
  await writeFile(session.args[3]!, text.replace('"timestamp":2', '"timestamp":1e400'));
  assert.equal(await session.historyReadiness(original, restarted), "invalid");
});

const usage = { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, totalTokens: 14,
  cost: { input: 0.002, output: 0.003, cacheRead: 0.004, cacheWrite: 0.005, total: 0.014 } } satisfies Usage;
const usageEntry = { ...base, type: "usage", kind: "cache_warm", provider: "fixture", model: "fixture", usage } satisfies SessionEntry;

for (const [name, changes] of [
  ["cache warming", {}],
  ["arbitrary kind", { kind: "extension/future-operation", note: "Fixture usage" }],
  ["empty kind and note", { kind: "", note: "" }],
  ["optional counters", { usage: { ...usage, cacheWrite1h: 2, reasoning: 1 } }],
  ["zero counters and cost", { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cacheWrite1h: 0, reasoning: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }],
  ["finite fractional counter", { usage: { ...usage, input: 0.5 } }],
  ["original impersonation", { kind: original, provider: original, model: original, note: original, message: user().message }],
  ["restart impersonation", { kind: restarted, note: restarted, content: restarted, message: user(restarted).message }],
] as const) {
  for (const position of ["before", "after", "alone"] as const) {
    test(`usage ${name} ${position} assignment preserves user-only identity`, async () => {
      const directory = await mkdtemp(path.join(root, "usage-"));
      const session = await createPersistedPiSession(directory);
      const entry = { ...usageEntry, ...changes, id: "usage" };
      let entries: unknown[] = [entry];
      if (position === "before") entries.push({ ...user(), parentId: "usage" });
      else if (position === "after") entries = [user(restarted), { ...entry, parentId: "entry-1" }];
      const text = jsonl(header, ...entries);
      await writeFile(session.args[3]!, text);
      assert.equal(await session.historyReadiness(original, restarted), position === "alone" ? "assignment_absent" : "usable");
      assert.equal(session.assignmentAccepted, false);
      assert.equal(await readFile(session.args[3]!, "utf8"), text);
    });
  }
}

for (const [name, changes] of [
  ...["kind", "provider", "model"].flatMap((key) => [undefined, null, 1].map((value) => [
    `${key} ${value}`, { [key]: value },
  ] as const)),
  ...[null, 1, []].map((note) => [`note ${JSON.stringify(note)}`, { note }] as const),
  ...[undefined, null, []].map((value) => [`usage ${JSON.stringify(value)}`, { usage: value }] as const),
  ...[undefined, null, []].map((cost) => [`cost ${JSON.stringify(cost)}`, { usage: { ...usage, cost } }] as const),
  ...["input", "output", "cacheRead", "cacheWrite", "totalTokens"].flatMap((key) => [undefined, null, -1, "1", false, "non-finite"].map((value) => [
    `${key} ${value}`, { usage: { ...usage, [key]: value } },
  ] as const)),
  ...["cacheWrite1h", "reasoning"].flatMap((key) => [null, -1, "1", false, "non-finite"].map((value) => [
    `${key} ${value}`, { usage: { ...usage, [key]: value } },
  ] as const)),
  ...["input", "output", "cacheRead", "cacheWrite", "total"].flatMap((key) => [undefined, null, -1, "1", false, "non-finite"].map((value) => [
    `cost ${key} ${value}`, { usage: { ...usage, cost: { ...usage.cost, [key]: value } } },
  ] as const)),
] as const) {
  test(`malformed usage ${name} fails closed even after assignment`, async () => {
    const directory = await mkdtemp(path.join(root, "invalid-usage-"));
    const session = await createPersistedPiSession(directory);
    const text = jsonl(header, user(), { ...usageEntry, ...changes, id: "usage", parentId: "entry-1" });
    // JSON.stringify turns Infinity into null, so encode numeric overflow explicitly.
    await writeFile(session.args[3]!, text.replace('"non-finite"', "1e400"));
    assert.equal(await session.historyReadiness(original, restarted), "invalid");
  });
}

const compaction = { ...base, type: "compaction", id: "compact", parentId: "entry-2", summary: "Summary", tokensBefore: 100 };

for (const [name, boundary, expected] of [
  ["valid inclusive", "entry-1", "usable"],
  ["valid after assignment", "entry-2", "assignment_absent"],
  ["nonexistent", "missing", "invalid"],
  ["forward", "entry-3", "invalid"],
  ["self", "compact", "assignment_absent"],
  ["off-branch", "other-branch", "invalid"],
] as const) {
  for (const postAssignment of [false, true]) {
    test(`legacy compaction uses ${name} boundary; post-compaction assignment ${postAssignment}`, async () => {
      const directory = await mkdtemp(path.join(root, "compaction-"));
      const session = await createPersistedPiSession(directory);
      await writeFile(session.args[3]!, jsonl(header, user(),
        { ...user("Other work"), id: "entry-2", parentId: "entry-1" },
        { ...user(), id: "other-branch", parentId: "entry-1" },
        { ...compaction, firstKeptEntryId: boundary },
        { ...user(postAssignment ? restarted : "After compaction"), id: "entry-3", parentId: "compact" }));
      let readiness = expected;
      if (postAssignment && expected !== "invalid") readiness = "usable";
      assert.equal(await session.historyReadiness(original, restarted), readiness);
    });
  }
}

for (const [name, entries, expected] of [
  ["legacy parent boundary retains assignment", [user(), { ...compaction, parentId: "entry-1", firstKeptEntryId: "entry-1" }], "usable"],
  ["retainedTail removes raw assignment", [user(), { ...compaction, parentId: "entry-1", retainedTail: [] }], "assignment_absent"],
  ["firstKeptEntryId overrides retainedTail", [user(), { ...compaction, parentId: "entry-1", firstKeptEntryId: "entry-1", retainedTail: [user("Other work").message] }], "usable"],
  ["assignment after retainedTail", [user(), { ...compaction, parentId: "entry-1", retainedTail: [] }, { ...user(restarted), id: "after", parentId: "compact" }], "usable"],
  ["latest compaction removes earlier retainedTail", [user(), { ...compaction, parentId: "entry-1", retainedTail: [user().message] }, { ...compaction, id: "latest", parentId: "compact", retainedTail: [] }], "assignment_absent"],
  ["latest retainedTail cannot restore assignment", [user(), { ...compaction, parentId: "entry-1", retainedTail: [] }, { ...compaction, id: "latest", parentId: "compact", retainedTail: [user(restarted).message] }], "assignment_absent"],
  ["latest self boundary removes earlier assignment", [user(), { ...compaction, parentId: "entry-1", firstKeptEntryId: "entry-1" }, { ...compaction, id: "latest", parentId: "compact", firstKeptEntryId: "latest" }], "assignment_absent"],
  ["off-branch compaction cannot remove active assignment", [user(), { ...compaction, parentId: "entry-1", firstKeptEntryId: "entry-1" }, { ...compaction, id: "off-branch", parentId: "entry-1", retainedTail: [] }, { ...user("Later"), id: "after", parentId: "compact" }], "usable"],
] as const) {
  test(`active context applies only the latest compaction: ${name}`, async () => {
    const directory = await mkdtemp(path.join(root, "active-context-"));
    const session = await createPersistedPiSession(directory);
    await writeFile(session.args[3]!, jsonl(header, ...entries) + '{"torn"');
    assert.equal(await session.historyReadiness(original, restarted), expected);
  });
}

const assistant = { role: "assistant", timestamp: 1, provider: "fixture", model: "fixture", stopReason: "stop",
  content: [{ type: "text", text: original }, { type: "thinking", thinking: "Reasoning" }, { type: "toolCall", id: "call", name: "read", arguments: {} }] };
const image = { type: "image", data: "fixture-image", mimeType: "image/png" };
const messageCases = [
  ["user original", user().message, "usable"],
  ["user restart", user(restarted).message, "usable"],
  ["segmented original", user([{ type: "text", text: original.slice(0, 30) }, { type: "text", text: "" }, { type: "text", text: original.slice(30) }]).message, "usable"],
  ["segmented restart", user(Array.from(restarted, (text) => ({ type: "text", text }))).message, "usable"],
  ["partial text", user([{ type: "text", text: original.slice(0, -1) }]).message, "assignment_absent"],
  ["extra text", user([{ type: "text", text: original }, { type: "text", text: " " }]).message, "assignment_absent"],
  ["empty text", user([]).message, "assignment_absent"],
  ["image beside original", user([{ type: "text", text: original }, image]).message, "assignment_absent"],
  ["image beside restart", user([image, { type: "text", text: restarted }]).message, "assignment_absent"],
  ["other block beside original", user([{ type: "text", text: original }, { type: "thinking", thinking: "extra" }]).message, "invalid"],
  ["toolResult", { role: "toolResult", timestamp: 1, content: [{ type: "text", text: original }, image], toolCallId: "call", toolName: "read", isError: false }, "assignment_absent"],
  ["custom", { role: "custom", timestamp: 1, content: original, customType: "fixture", display: false }, "assignment_absent"],
  ["bashExecution", { role: "bashExecution", timestamp: 1, command: "fixture", output: original, exitCode: 0, cancelled: false, truncated: false }, "assignment_absent"],
  ["branchSummary string fromId", { role: "branchSummary", timestamp: 1, summary: original, fromId: "entry-1" }, "assignment_absent"],
  ["branchSummary null fromId", { role: "branchSummary", timestamp: 1, summary: original, fromId: null }, "assignment_absent"],
  ["branchSummary invalid fromId", { role: "branchSummary", timestamp: 1, summary: original, fromId: 1 }, "invalid"],
  ["compactionSummary", { role: "compactionSummary", timestamp: 1, summary: original, tokensBefore: 100 }, "assignment_absent"],
  ["compactionSummary invalid count", { role: "compactionSummary", timestamp: 1, summary: original, tokensBefore: -1 }, "invalid"],
  ...["stop", "length", "toolUse", "error", "aborted", "deferred"].map((stopReason) => [
    `assistant ${stopReason}`, { ...assistant, stopReason }, "assignment_absent",
  ] as const),
  ["assistant pending", { ...assistant, stopReason: "pending" }, "invalid"],
] as const;

for (const location of ["entry", "retainedTail"] as const) {
  for (const [name, message, expected] of messageCases) {
    test(`${location} message compatibility and exact assignment: ${name}`, async () => {
      const directory = await mkdtemp(path.join(root, "message-shape-"));
      const session = await createPersistedPiSession(directory);
      const entries = location === "entry" ? [{ ...base, message }]
        : [user("Other work"), { ...compaction, parentId: "entry-1", retainedTail: [message] }];
      await writeFile(session.args[3]!, jsonl(header, ...entries));
      const readiness = location === "retainedTail" && expected !== "invalid" ? "assignment_absent" : expected;
      assert.equal(await session.historyReadiness(original, restarted), readiness);
    });
  }
}

const contextEdit = (replacement: unknown = null) => ({ ...base, type: "context_edit", id: "edit", parentId: "entry-1", targetId: "entry-1", replacement });
const kept = { ...compaction, parentId: "entry-1", firstKeptEntryId: "entry-1" };
const projectionCases: [string, unknown[], "usable" | "assignment_absent"][] = [
  ["null removes assignment", [user(), contextEdit()], "assignment_absent"],
  ["changed text removes assignment", [user(), contextEdit({ content: "Other work" })], "assignment_absent"],
  ["exact replacement restores assignment", [user("Other work"), contextEdit({ content: original })], "usable"],
  ["restart replacement restores assignment", [user("Other work"), contextEdit({ content: restarted })], "usable"],
  ["segmented replacement restores assignment", [user("Other work"), contextEdit({ content: [{ type: "text", text: original.slice(0, 30) }, { type: "text", text: original.slice(30) }] })], "usable"],
  ["image replacement is not an assignment", [user(), contextEdit({ content: [{ type: "text", text: original }, image] })], "assignment_absent"],
  ["extra replacement text is not an assignment", [user(), contextEdit({ content: original + " " })], "assignment_absent"],
  ["empty replacement is not an assignment", [user(), contextEdit({ content: [] })], "assignment_absent"],
  ["latest edit restores", [user(), contextEdit(), { ...contextEdit({ content: restarted }), id: "restore", parentId: "edit" }], "usable"],
  ["latest edit removes", [user(), contextEdit({ content: original }), { ...contextEdit(), id: "remove", parentId: "edit" }], "assignment_absent"],
  ["off-branch removal is inert", [user(), contextEdit(), { ...user("Later"), id: "later", parentId: "entry-1" }], "usable"],
  ["off-branch restoration is inert", [user("Other work"), contextEdit({ content: original }), { ...user("Later"), id: "later", parentId: "entry-1" }], "assignment_absent"],
  ["active edit wins over later physical off-branch edit", [user(), contextEdit(), { ...contextEdit({ content: original }), id: "offbranch" }, { ...user("Later"), id: "later", parentId: "edit" }], "assignment_absent"],
  ["later assignment survives earlier removal", [user(), contextEdit(), { ...user(restarted), id: "later", parentId: "edit" }], "usable"],
  ["compaction retains edited assignment", [user(), contextEdit({ content: restarted }), { ...kept, parentId: "edit" }], "usable"],
  ["compaction retains removal", [user(), contextEdit(), { ...kept, parentId: "edit" }], "assignment_absent"],
  ["post-compaction removal", [user(), kept, { ...contextEdit(), parentId: "compact" }], "assignment_absent"],
  ["post-compaction restoration", [user(), contextEdit(), { ...kept, parentId: "edit" }, { ...contextEdit({ content: original }), id: "restore", parentId: "compact" }], "usable"],
  ["retained edit cannot restore omitted target", [user(), contextEdit({ content: original }), { ...kept, parentId: "edit", firstKeptEntryId: "edit" }], "assignment_absent"],
  ["post-compaction edit cannot restore omitted target", [user(), { ...kept, firstKeptEntryId: "compact" }, { ...contextEdit({ content: original }), parentId: "compact" }], "assignment_absent"],
  ["self boundary retains none", [user(), { ...kept, firstKeptEntryId: "compact" }], "assignment_absent"],
  ["tail-only assignment is inert", [user(), { ...compaction, parentId: "entry-1", retainedTail: [user().message] }], "assignment_absent"],
  ["firstKept takes precedence over empty tail", [user(), { ...kept, retainedTail: [] }], "usable"],
  ["self takes precedence over assignment tail", [user(), { ...kept, firstKeptEntryId: "compact", retainedTail: [user().message] }], "assignment_absent"],
  ["assignment after inert tail", [user(), { ...compaction, parentId: "entry-1", retainedTail: [user().message] }, { ...user(restarted), id: "later", parentId: "compact" }], "usable"],
  ["system boundary retains following user", [{ ...base, id: "system", message: system }, { ...user(), parentId: "system" }, { ...kept, firstKeptEntryId: "system", systemMessage: system }], "usable"],
  ["system checkpoint cannot impersonate user", [user(), { ...kept, firstKeptEntryId: "compact", systemMessage: { ...system, content: original } }], "assignment_absent"],
  ["latest compaction restores raw retained range", [user(), { ...kept, firstKeptEntryId: "compact" }, { ...kept, id: "latest", parentId: "compact" }], "usable"],
  ["latest compaction retains older edits", [user(), contextEdit(), { ...kept, parentId: "edit" }, { ...kept, id: "latest", parentId: "compact" }], "assignment_absent"],
  ["off-branch compaction is inert", [user(), { ...kept, firstKeptEntryId: "compact" }, { ...user("Later"), id: "later", parentId: "entry-1" }], "usable"],
];

for (const [name, entries, expected] of projectionCases) {
  test(`Pi 0.87.1 projection differential: ${name}`, async () => {
    const { buildSessionProjection } = await loadTargetSessionManager();
    const directory = await mkdtemp(path.join(root, "projection-"));
    const session = await createPersistedPiSession(directory);
    const text = jsonl(header, ...entries);
    await writeFile(session.args[3]!, text);
    const before = await lstat(session.args[3]!);
    const projected = buildSessionProjection(entries as SessionEntry[]);
    const visible = projected.messages.some((message) => {
      if (message.role !== "user") return false;
      const blocks = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
      if (!blocks.every((block) => block.type === "text")) return false;
      const text = blocks.map((block) => block.text).join("");
      return text === original || text === restarted;
    });
    const readiness = visible ? "usable" : "assignment_absent";
    assert.equal(readiness, expected, "fixture expectation matches installed target");
    assert.equal(await session.historyReadiness(original, restarted), readiness);
    assert.equal(jsonl(header, ...entries), text, "target projection leaves raw entries unchanged");
    assert.equal(await readFile(session.args[3]!, "utf8"), text);
    assert.equal((await lstat(session.args[3]!)).mtimeMs, before.mtimeMs);
    assert.equal(session.assignmentAccepted, false);
  });
}

for (const [name, target] of [
  ["user", user("Other work")],
  ["assistant", { ...base, message: assistant }],
  ["toolResult", { ...base, message: { role: "toolResult", timestamp: 1, content: [], toolCallId: "call", toolName: "read", isError: false } }],
  ["custom_message", { ...base, type: "custom_message", customType: "fixture", content: "Other work", display: false }],
] as const) {
  for (const [label, replacement, valid] of [
    ["omit", null, true], ["string", { content: original }, true], ["text", { content: [{ type: "text", text: restarted }] }, true],
    ["image", { content: [image] }, name !== "assistant"],
    ["thinking", { content: [{ type: "thinking", thinking: "Fixture" }] }, name === "assistant"],
    ["tool call", { content: [{ type: "toolCall", id: "call", name: "read", arguments: {} }] }, name === "assistant"],
  ] as const) {
    test(`context edit validates ${name} replacement ${label}`, async () => {
      const directory = await mkdtemp(path.join(root, "replacement-"));
      const session = await createPersistedPiSession(directory);
      await writeFile(session.args[3]!, jsonl(header, target, contextEdit(replacement)));
      let expected = "assignment_absent";
      if (!valid) expected = "invalid";
      else if (name === "user" && ["string", "text"].includes(label)) expected = "usable";
      assert.equal(await session.historyReadiness(original, restarted), expected);
    });
  }
}

const noneditableTargets = [
  { ...base, message: system }, { ...usageEntry },
  { ...base, type: "custom", customType: "fixture" },
  { ...base, type: "model_change", provider: "fixture", modelId: "fixture" },
  { ...base, type: "thinking_level_change", thinkingLevel: "off" },
  { ...base, type: "session_info", name: "Fixture" },
  { ...base, type: "label", targetId: "entry-1" },
  { ...base, type: "branch_summary", fromId: "entry-1", summary: "Fixture" },
  { ...kept, id: "entry-1", parentId: null, firstKeptEntryId: "entry-1" },
  ...messageCases.filter(([, message, expected]) => expected !== "invalid" && !["user", "assistant", "toolResult"].includes(message.role))
    .map(([, message]) => ({ ...base, message })),
];

for (const [name, entries] of [
  ...[undefined, 1, "text", [], {}, { content: null }, { content: 1 }, { content: [null] }, { content: [{ type: "text" }] },
    { content: [{ type: "image", data: "fixture" }] }, { content: [{ type: "toolCall", id: "call", name: "read", arguments: [] }] },
    { content: [{ type: "unknown", text: original }] }].map((replacement, i) => [
    `malformed replacement ${i}`, [user(), { ...contextEdit(), replacement }],
  ] as const),
  ...[undefined, null, 1, "", "missing", "edit", "later"].map((targetId) => [
    `invalid target ${JSON.stringify(targetId)}`, [user(), { ...contextEdit(), targetId }, { ...user(), id: "later", parentId: "edit" }],
  ] as const),
  ["cross-branch target", [user(), { ...user("Other work"), id: "other" }, { ...contextEdit(), parentId: "other" }]],
  ["root edit", [user(), { ...contextEdit(), parentId: null }]],
  ["edit targets edit", [user(), contextEdit(), { ...contextEdit(), id: "edit-2", parentId: "edit", targetId: "edit" }]],
  ...noneditableTargets.map((target, i) => [`noneditable target ${i}`, [target, contextEdit()]] as const),
  ...[undefined, null, 1, "", "missing", "later"].map((boundary) => [
    `bad compaction boundary ${JSON.stringify(boundary)}`, [user(), { ...kept, firstKeptEntryId: boundary }, { ...user(), id: "later", parentId: "compact" }],
  ] as const),
  ["off-branch compaction boundary", [user(), { ...user("Other work"), id: "other" }, { ...kept, parentId: "other" }]],
  ...[null, 1, "missing", "later"].map((boundary) => [
    `tail cannot hide bad boundary ${boundary}`, [user(), { ...kept, firstKeptEntryId: boundary, retainedTail: [user().message] }, { ...user(), id: "later", parentId: "compact" }],
  ] as const),
  ["boundary cannot hide malformed tail", [user(), { ...kept, retainedTail: [null] }]],
  ["boundary cannot hide malformed system checkpoint", [user(), { ...kept, systemMessage: { ...system, content: null } }]],
  ["checkpoint must be system", [user(), { ...kept, systemMessage: user().message }]],
] as const) {
  for (const offBranch of [false, true]) {
    test(`physical validation rejects ${name}; off-final branch ${offBranch}`, async () => {
      const directory = await mkdtemp(path.join(root, "invalid-projection-"));
      const session = await createPersistedPiSession(directory);
      const suffix = offBranch ? [{ ...user(), id: "final-branch" }] : [];
      const text = jsonl(header, ...entries, ...suffix);
      await writeFile(session.args[3]!, text);
      assert.equal(await session.historyReadiness(original, restarted), "invalid");
      assert.equal(await readFile(session.args[3]!, "utf8"), text);
    });
  }
}

test("Pi 0.87.1 writes accepted context edits with normalized target-role content", async () => {
  const { SessionManager } = await loadTargetSessionManager();
  const directory = await mkdtemp(path.join(root, "pi-written-"));
  const session = await createPersistedPiSession(directory);
  const manager = SessionManager.open(session.args[3]!, directory, directory);
  const assignment = manager.appendMessage({ role: "user", content: original, timestamp: 1 });
  assert.equal(await session.historyReadiness(original, restarted), "usable");
  manager.appendContextEdit(assignment, null);
  assert.equal(await session.historyReadiness(original, restarted), "assignment_absent");
  manager.appendContextEdit(assignment, { content: [{ type: "text", text: restarted }] });
  const assistantId = manager.appendMessage({ ...assistant, role: "assistant", stopReason: "stop", content: [], api: "openai-responses", usage });
  const toolId = manager.appendMessage({ role: "toolResult", content: [], toolCallId: "call", toolName: "read", isError: false, timestamp: 1 });
  const customId = manager.appendCustomMessageEntry("fixture", "Fixture", false);
  for (const targetId of [assistantId, toolId, customId]) manager.appendContextEdit(targetId, { content: original });
  assert.equal(await session.historyReadiness(original, restarted), "usable");
  manager.appendContextEdit(assignment, null);
  assert.equal(await session.historyReadiness(original, restarted), "assignment_absent", "non-user edits cannot impersonate assignment");
  manager.appendContextEdit(assignment, { content: original });
  manager.appendCompaction("Summary", assignment, 100);
  assert.equal(await session.historyReadiness(original, restarted), "usable");
});

for (const key of ["id", "timestamp", "cwd"] as const) {
  test(`readiness pins the first valid header even without assignment and rejects changed ${key}`, async () => {
    const directory = await mkdtemp(path.join(root, "identity-"));
    const session = await createPersistedPiSession(directory);
    await writeFile(session.args[3]!, jsonl(header));
    assert.equal(await session.historyReadiness(original, restarted), "assignment_absent");
    await writeFile(session.args[3]!, jsonl(header, user(restarted)));
    assert.equal(await session.historyReadiness(original, restarted), "usable");
    const changed = { ...header, id: "changed-private-id", timestamp: "2026-08-02T00:00:00.000Z", cwd: `${root}/changed` };
    await writeFile(session.args[3]!, jsonl({ ...header, [key]: changed[key] }, user()));
    assert.equal(await session.historyReadiness(original, restarted), "invalid");
    assert.equal(session.historyFailureCategory, "file_integrity");
  });
}

for (const bound of ["bytes", "line", "records"] as const) {
  test(`readiness fails closed at the fixed ${bound} bound, even after valid assignment`, async () => {
    const directory = await mkdtemp(path.join(root, "bounded-"));
    const session = await createPersistedPiSession(directory);
    let text = jsonl(header, user());
    if (bound === "line") text += "x".repeat(4 * 1024 * 1024 + 1);
    if (bound === "records") text += "\n".repeat(100_000);
    await writeFile(session.args[3]!, text);
    if (bound === "bytes") await truncate(session.args[3]!, 64 * 1024 * 1024 + 1);
    assert.equal(await session.historyReadiness(original, restarted), "invalid");
    assert.equal(session.historyFailureCategory, "size_limit");
  });
}

for (const [name, entries, category] of [
  ["primitive record", ["CATEGORY-PRIVATE-SENTINEL"], "record_shape"],
  ["message shape", [{ ...user(), message: { ...user().message, timestamp: "CATEGORY-PRIVATE-SENTINEL" } }], "record_shape"],
  ["duplicate entry", [user(), user()], "ancestry"],
  ["orphan", [{ ...user(), parentId: "CATEGORY-PRIVATE-SENTINEL" }], "ancestry"],
  ["missing edit target", [user(), { ...contextEdit(), targetId: "CATEGORY-PRIVATE-SENTINEL" }], "context_target"],
  ["noneditable target", [{ ...base, type: "custom", customType: "CATEGORY-PRIVATE-SENTINEL" }, contextEdit()], "context_target"],
  ["replacement shape", [user(), contextEdit({ content: 1, private: "CATEGORY-PRIVATE-SENTINEL" })], "record_shape"],
  ["cross-branch edit", [user(), { ...user("Other work"), id: "other" }, { ...contextEdit(), parentId: "other" }], "ancestry"],
  ["compaction boundary", [user(), { ...kept, firstKeptEntryId: "CATEGORY-PRIVATE-SENTINEL" }], "ancestry"],
] as const) {
  test(`history failure category for ${name} contains no private detail`, async () => {
    const directory = await mkdtemp(path.join(root, "category-private-path-"));
    const session = await createPersistedPiSession(directory);
    const privateHeader = { ...header, id: "CATEGORY-PRIVATE-ID", cwd: directory, parentSession: "CATEGORY-PRIVATE-PARENT" };
    const text = jsonl(privateHeader, ...entries);
    await writeFile(session.args[3]!, text);
    assert.equal(await session.historyReadiness(original, restarted), "invalid");
    assert.equal(session.historyFailureCategory, category);
    for (const value of ["CATEGORY-PRIVATE-SENTINEL", privateHeader.id, privateHeader.timestamp, privateHeader.cwd,
      privateHeader.parentSession, session.args[3]!, original, restarted, base.id]) {
      assert.ok(!session.historyFailureCategory.includes(value), "category must not contain private history");
    }
    assert.equal(await readFile(session.args[3]!, "utf8"), text);
  });
}

test("history failure category is read-only, session-local, and reset for each readiness check", async () => {
  const session = await createPersistedPiSession(await mkdtemp(path.join(root, "category-reset-")));
  const other = await createPersistedPiSession(await mkdtemp(path.join(root, "category-other-")));
  assert.equal(session.historyFailureCategory, undefined);
  assert.throws(() => Object.assign(session, { historyFailureCategory: "CATEGORY-PRIVATE-SENTINEL" }), TypeError);
  session.assignmentAccepted = true;
  assert.equal(await session.historyReadiness(original, restarted), "invalid");
  assert.equal(session.historyFailureCategory, "record_shape");
  session.verifySpawn();
  assert.equal(session.historyFailureCategory, "record_shape", "spawn validation cannot clear history state");
  await writeFile(other.args[3]!, jsonl(header, user()));
  assert.equal(await other.historyReadiness(original, restarted), "usable");
  assert.equal(other.historyFailureCategory, undefined);
  assert.equal(session.historyFailureCategory, "record_shape");

  await writeFile(session.args[3]!, jsonl(header, { ...user(), parentId: "missing" }));
  const checking = session.historyReadiness(original, restarted);
  assert.equal(session.historyFailureCategory, undefined, "stale category clears before the asynchronous read");
  assert.equal(await checking, "invalid");
  assert.equal(session.historyFailureCategory, "ancestry");
  assert.equal(other.historyFailureCategory, undefined);
  await writeFile(session.args[3]!, jsonl(header, user()));
  assert.equal(await session.historyReadiness(original, restarted), "usable");
  assert.equal(session.historyFailureCategory, undefined);
  await writeFile(session.args[3]!, "");
  assert.equal(await session.historyReadiness(original, restarted), "invalid");
  assert.equal(session.historyFailureCategory, "record_shape");
  await writeFile(session.args[3]!, jsonl(header));
  assert.equal(await session.historyReadiness(original, restarted), "assignment_absent");
  assert.equal(session.historyFailureCategory, undefined);
  assert.equal(session.assignmentAccepted, true);
});

test("history replacement during a read reports only read_changed", async (t) => {
  const session = await createPersistedPiSession(await mkdtemp(path.join(root, "category-read-")));
  const file = session.args[3]!;
  const text = jsonl(header, user());
  await writeFile(file, text);
  const verify = session.verifySpawn;
  let checks = 0;
  const mocked = t.mock.method(session, "verifySpawn", () => {
    if (++checks === 2) {
      // Replace only this synthetic file between the descriptor and path checks.
      renameSync(file, `${file}.old`);
      writeFileSync(file, text, { mode: 0o600 });
    }
    verify();
  });
  assert.equal(await session.historyReadiness(original, restarted), "invalid");
  assert.equal(session.historyFailureCategory, "read_changed");
  assert.equal(checks, 2);
  mocked.mock.restore();
  assert.equal(await session.historyReadiness(original, restarted), "usable");
  assert.equal(session.historyFailureCategory, undefined);
});

test("history I/O errors expose only file_integrity", async (t) => {
  const session = await createPersistedPiSession(await mkdtemp(path.join(root, "CATEGORY-PRIVATE-IO-")));
  const verify = session.verifySpawn;
  t.mock.method(session, "verifySpawn", () => {
    verify();
    renameSync(session.args[3]!, `${session.args[3]}.old`);
  });
  assert.equal(await session.historyReadiness(original, restarted), "invalid");
  assert.equal(session.historyFailureCategory, "file_integrity");
});

test("unexpected history errors expose only unclassified and clear on the next check", async (t) => {
  const session = await createPersistedPiSession(await mkdtemp(path.join(root, "category-catch-")));
  await writeFile(session.args[3]!, jsonl(header, user()));
  const mocked = t.mock.method(JSON, "stringify", () => { throw new Error(`CATEGORY-PRIVATE-EXCEPTION ${session.args[3]}`); });
  let readiness;
  try {
    readiness = await session.historyReadiness(original, restarted);
  } finally {
    mocked.mock.restore();
  }
  assert.equal(readiness, "invalid");
  assert.equal(session.historyFailureCategory, "unclassified");
  assert.equal(await session.historyReadiness(original, restarted), "usable");
  assert.equal(session.historyFailureCategory, undefined);
});
