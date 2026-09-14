import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPersistedPiSession } from "./persisted-session.ts";
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
    assert.equal(await session.historyReadiness("private original", "private restart"), "invalid");
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

const compaction = { ...base, type: "compaction", id: "compact", parentId: "entry-2", summary: "Summary", tokensBefore: 100 };

for (const [name, boundary, expected] of [
  ["valid inclusive", "entry-1", "usable"],
  ["valid after assignment", "entry-2", "assignment_absent"],
  ["nonexistent", "missing", "assignment_absent"],
  ["forward", "entry-3", "assignment_absent"],
  ["self", "compact", "assignment_absent"],
  ["off-branch", "other-branch", "assignment_absent"],
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
      assert.equal(await session.historyReadiness(original, restarted), postAssignment ? "usable" : expected);
    });
  }
}

for (const [name, entries, expected] of [
  ["legacy parent boundary retains assignment", [user(), { ...compaction, parentId: "entry-1", firstKeptEntryId: "entry-1" }], "usable"],
  ["retainedTail removes raw assignment", [user(), { ...compaction, parentId: "entry-1", retainedTail: [] }], "assignment_absent"],
  ["retainedTail overrides legacy boundary", [user(), { ...compaction, parentId: "entry-1", firstKeptEntryId: "entry-1", retainedTail: [user("Other work").message] }], "assignment_absent"],
  ["assignment after retainedTail", [user(), { ...compaction, parentId: "entry-1", retainedTail: [] }, { ...user(restarted), id: "after", parentId: "compact" }], "usable"],
  ["latest compaction removes earlier retainedTail", [user(), { ...compaction, parentId: "entry-1", retainedTail: [user().message] }, { ...compaction, id: "latest", parentId: "compact", retainedTail: [] }], "assignment_absent"],
  ["latest compaction retains assignment", [user(), { ...compaction, parentId: "entry-1", retainedTail: [] }, { ...compaction, id: "latest", parentId: "compact", retainedTail: [user(restarted).message] }], "usable"],
  ["latest legacy boundary removes earlier assignment", [user(), { ...compaction, parentId: "entry-1", firstKeptEntryId: "entry-1" }, { ...compaction, id: "latest", parentId: "compact", firstKeptEntryId: "missing" }], "assignment_absent"],
  ["off-branch compaction cannot remove active assignment", [user(), { ...compaction, parentId: "entry-1", retainedTail: [user().message] }, { ...compaction, id: "off-branch", parentId: "entry-1", retainedTail: [] }, { ...user("Later"), id: "after", parentId: "compact" }], "usable"],
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
      assert.equal(await session.historyReadiness(original, restarted), expected);
    });
  }
}

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
  });
}
