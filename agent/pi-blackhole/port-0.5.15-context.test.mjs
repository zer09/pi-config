import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const patched = process.env.PI_BLACKHOLE_PACKAGE_ROOT;
const stock = process.env.PI_BLACKHOLE_STOCK_ROOT;
const runtime = process.env.PI_BLACKHOLE_TEST_RUNTIME;
assert.equal(process.env.PI_OFFLINE, "1");
for (const root of [patched, stock, runtime]) {
  assert.ok(root && isAbsolute(root));
  assert.equal(realpathSync(root), root);
}
const deps = join(runtime, "node_modules");
const alias = {};
for (const name of ["pi-ai", "pi-coding-agent", "pi-agent-core", "pi-tui"]) {
  const dir = join(deps, "@earendil-works", name);
  assert.equal(JSON.parse(readFileSync(join(dir, "package.json"))).version, "1.4.0");
  alias[`@earendil-works/${name}`] = join(dir, "dist/index.js");
}
alias.typebox = join(deps, "typebox/build/index.mjs");
const pi = await import(pathToFileURL(alias["@earendil-works/pi-coding-agent"]));
const { prepareCompaction } = await import(pathToFileURL(join(deps, "@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js")));
assert.equal(pi.VERSION, "1.4.0");
const { createJiti } = await import(pathToFileURL(join(deps, "jiti/lib/jiti.mjs")));
const modules = {};
for (const [kind, root] of Object.entries({ stock, patched })) {
  const jiti = createJiti(import.meta.url, { alias, fsCache: false, moduleCache: true });
  modules[kind] = await jiti.import(join(root, "src/hooks/before-compact.ts"));
}
const state = mkdtempSync(join(tmpdir(), "context-0.5.15-"));
const timestamp = "2026-01-01T00:00:00.000Z";
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const message = (id, role, content = id) => ({ type: "message", id, timestamp, message: {
  role, content: role === "assistant" || role === "toolResult" ? [{ type: "text", text: content }] : content,
  timestamp: 1,
  ...(role === "assistant" ? { api: "test", provider: "test", model: "test", stopReason: "stop", usage } : {}),
  ...(role === "toolResult" ? { toolCallId: id, toolName: "read", isError: false } : {}),
} });
const edit = (id, targetId, content) => ({ type: "context_edit", id, targetId, replacement: content === null ? null : { content }, timestamp });
const link = entries => entries.map((entry, i) => ({ ...entry, parentId: entries[i - 1]?.id ?? null }));
const base = () => [message("u0", "user", "Implement ORIGINAL_GOAL carefully."), message("a1", "assistant", "OMITTED_CANARY"), message("u2", "user", "Check SECOND_GOAL."), message("a3", "assistant"), message("tail", "user", "Keep the tail.")];
function runHook(kind, branch, config = {}, options = {}) {
  let handler;
  const runtime = { config: { compaction: "auto", compactionEngine: "blackhole", tailBehavior: "minimal", memory: false, observationsPoolMaxTokens: 1000, reflectionsPoolMaxTokens: 0, retainedToolOutputMaxTokens: 0, debug: false, debugLog: false, ...config }, ensureConfig() {} };
  modules[kind].registerBeforeCompactHook({ on(name, fn) { if (name === "session_before_compact") handler = fn; } }, runtime);
  const ctx = { cwd: state, model: { contextWindow: options.window ?? 10000 }, getSystemPrompt: () => "", ui: { notify() {} }, sessionManager: { getEntries: () => options.all ?? branch, getSessionFile() { throw Error("No real sessions"); } } };
  const preparation = options.preparation ?? { firstKeptEntryId: options.boundary ?? "tail", previousSummary: options.previousSummary, tokensBefore: 100, settings: { reserveTokens: 100, keepRecentTokens: 400 }, fileOps: { read: new Set(), written: new Set(), edited: new Set() } };
  const before = JSON.stringify(branch);
  const result = handler({ branchEntries: branch, preparation }, ctx);
  assert.equal(JSON.stringify(branch), before, "the hook must not change raw entries");
  return result;
}
function projectedBranch(branch) {
  const byId = new Map(pi.buildSessionProjection(branch).entries.map(({ sourceEntry, messages }) => [sourceEntry.id, messages]));
  return link(branch.flatMap(entry => {
    if (entry.type === "context_edit") return [];
    const messages = byId.get(entry.id);
    if (entry.type === "custom_message") return messages?.length ? [{ ...entry, content: messages[0].content }] : [];
    if (entry.type !== "message") return [entry];
    return messages?.length ? [{ ...entry, message: messages[0] }] : [];
  }));
}

test("existing context fixture mode, bound to exact Pi 1.4.0 and the new minimal split-turn policy", () => {
  let source = readFileSync(join(here, "reapply-context-edit-compaction-patch.test.mjs"), "utf8");
  source = source.replace('const here = dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(here)};`)
    .replace('const piRoot = join(dirname(installed), "@earendil-works/pi-coding-agent");', `const piRoot = ${JSON.stringify(join(deps, "@earendil-works/pi-coding-agent"))};`)
    .replace('assert.equal(pi.VERSION, "0.87.1");', 'assert.equal(pi.VERSION, "1.4.0");');
  const fixture = join(state, "legacy-fixtures.mjs");
  writeFileSync(fixture, source);
  const result = spawnSync(process.execPath, [fixture, "--fixtures", patched, stock, state], { cwd: state, env: { ...process.env, HOME: state, PI_CODING_AGENT_DIR: join(state, "agent"), PI_BLACKHOLE_PACKAGE_ROOT: patched }, encoding: "utf8", timeout: 120000 });
  console.log(result.stdout);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fixtures and isolated Pi loader passed/);
});

test("stock no-edit cuts and cancellations preserve all three tail policies and minimal split-turn boundaries", () => {
  const sequences = [[], base().slice(0, 1), base().slice(0, 2), base(), base().filter(entry => entry.message.role !== "user"), [message("sys", "system"), ...base()]];
  for (const firstKeptEntryId of ["u0", "u2", "c0", "", "missing"]) {
    sequences.push([...base().slice(0, 4), { type: "compaction", id: "c0", firstKeptEntryId, summary: "OLD", timestamp, tokensBefore: 10 }, message("u4", "user"), message("a5", "assistant"), message("tail", "user")]);
  }
  let comparisons = 0;
  for (const sequence of sequences) {
    const branch = link(sequence);
    for (const boundary of [undefined, "missing", ...branch.map(entry => entry.id)]) {
      for (const tail of ["minimal", "pi-default", "unobserved"]) {
        assert.deepEqual(modules.patched.buildOwnCut(branch, boundary, tail), modules.stock.buildOwnCut(branch, boundary, tail));
        comparisons++;
      }
    }
  }
  const split = link(base().slice(0, 4));
  assert.equal(modules.patched.buildOwnCut(split, "a3", "minimal").firstKeptEntryId, "a3");
  console.log(`PASS stock no-edit cuts/cancellations: ${comparisons} comparisons`);
});

test("unobserved early path projects actual fresh summaries, original refs, and raw OM coverage", () => {
  const observation = { id: "abcdef123456", content: "EXISTING_MEMORY", timestamp, relevance: "high", sourceEntryIds: ["u0", "a3"], tokenCount: 5 };
  const coverage = { type: "custom", id: "coverage", customType: "om.observations.recorded", data: { observations: [observation], coversFromId: "u0", coversUpToId: "a3" }, timestamp };
  const branch = link([...base(), coverage, edit("omit", "a1", null), edit("replace", "u0", "Implement REPLACED_GOAL carefully.")]);
  const cut = modules.patched.buildOwnCut(branch, "tail", "unobserved");
  assert.equal(cut.ok, true);
  assert.deepEqual(cut.selectedIds, ["u0", "u2", "a3"]);
  assert.equal(cut.firstKeptEntryId, "tail");
  assert.equal(cut.messages[0].content, "Implement REPLACED_GOAL carefully.");
  for (const mode of ["default", "append"]) {
    const result = runHook("patched", branch, { tailBehavior: "unobserved", memory: true, fullFoldAlways: true, compactionSummaryMode: mode }, { all: [message("off", "user"), ...branch], previousSummary: "[Session Goal]\n- PREVIOUS_MEMORY" });
    assert.ok(result.compaction);
    assert.match(result.compaction.summary, /REPLACED_GOAL/);
    assert.match(result.compaction.summary, /PREVIOUS_MEMORY/);
    assert.match(result.compaction.summary, /EXISTING_MEMORY/);
    assert.match(result.compaction.summary, /#1\b/);
    assert.match(result.compaction.summary, /#3\b/);
    assert.doesNotMatch(result.compaction.summary, /ORIGINAL_GOAL|OMITTED_CANARY|#2\b/);
    assert.deepEqual(result.compaction.details["om.folded"].observations, [observation]);
  }
  // An omitted first unobserved source must not become the retained boundary.
  const gap = link([...base(), coverage, message("next", "user"), edit("drop-tail", "tail", null)]);
  assert.equal(modules.patched.buildOwnCut(gap, undefined, "unobserved").firstKeptEntryId, "next");
});

test("conversion drops do not shift fresh-summary source refs, metadata, or tool pairing", () => {
  const calls = ["one", "two"].map(id => ({ type: "toolCall", id, name: "read", arguments: { path: `${id}.txt` } }));
  const assistant = message("calls", "assistant");
  assistant.message.content = calls;
  assistant.message.stopReason = "toolUse";
  const excluded = { type: "message", id: "bash", timestamp, message: { role: "bashExecution", command: "ignored", output: "EXCLUDED_BASH", excludeFromContext: true, timestamp: 1 } };
  const branch = link([message("u0", "user", "Implement ORIGINAL_GOAL."), assistant, message("one", "toolResult"), excluded, message("two", "toolResult"), message("u2", "user", "Check SECOND_GOAL."), message("tail", "user"), edit("partial", "calls", [calls[1]]), edit("omit-one", "one", null), edit("replace", "u0", "Implement REPLACED_GOAL.")]);
  const cut = modules.patched.buildOwnCut(branch, "tail", "pi-default");
  assert.equal(cut.ok, true);
  assert.deepEqual(cut.selectedIds, ["u0", "calls", "bash", "two", "u2"]);
  assert.deepEqual(cut.messages[1], { ...assistant.message, content: [calls[1]] });
  assert.deepEqual(cut.messages.filter(m => m.role === "toolResult").map(m => m.toolCallId), ["two"]);
  const result = runHook("patched", branch, { tailBehavior: "pi-default" });
  assert.match(result.compaction.summary, /REPLACED_GOAL/);
  assert.match(result.compaction.summary, /#5\b/);
  assert.doesNotMatch(result.compaction.summary, /ORIGINAL_GOAL|EXCLUDED_BASH|#3\b/);
});

test("final unobserved, pressure and append capacity checks estimate the edited retained tail", () => {
  const entries = [message("u0", "user", "Implement ORIGINAL_GOAL."), message("a0", "assistant"), message("p1", "user", "Check REPLACED_RAW_" + "X".repeat(12000)), message("a1", "assistant", "OMITTED_RAW_" + "Y".repeat(16000)), message("tail", "user")];
  const coverage = { type: "custom", id: "coverage", customType: "om.observations.coverage", data: { coversFromId: "u0", coversUpToId: "a0" }, timestamp };
  const branch = link([...entries, coverage, edit("fresh", "u0", "Implement FRESH_APPEND_GOAL."), edit("replace", "p1", "Check PROJECTED_TAIL_GOAL."), edit("omit", "a1", null)]);
  const clean = projectedBranch(branch);
  let appendSuccesses = 0;
  for (const compactionSummaryMode of ["default", "append"]) {
    for (const cfg of [{ tailBehavior: "unobserved" }, { tailBehavior: "pi-default", contextPressureFallback: "vcc" }]) {
      for (const window of [350, 1000]) {
        const config = { ...cfg, compactionSummaryMode };
        const options = { boundary: "p1", window, all: branch };
        const actual = runHook("patched", branch, config, options);
        assert.deepEqual(actual, runHook("stock", clean, config, options));
        assert.deepEqual(runHook("patched", link(entries), config, options), runHook("stock", link(entries), config, options));
        if (window === 1000) {
          assert.ok(actual.compaction, "edited retained tail fits despite its oversized raw history");
          assert.match(actual.compaction.summary, /FRESH_APPEND_GOAL/);
          assert.doesNotMatch(actual.compaction.summary, /ORIGINAL_GOAL|REPLACED_RAW_|OMITTED_RAW_/);
          if (compactionSummaryMode === "append") {
            assert.equal(actual.compaction.details.version, 2, "exercise append's final context estimate");
            assert.match(actual.compaction.details.segment.summary, /FRESH_APPEND_GOAL/);
            assert.doesNotMatch(actual.compaction.details.segment.summary, /ORIGINAL_GOAL/);
            appendSuccesses++;
          }
        }
      }
    }
  }
  assert.equal(appendSuccesses, 2);
});

test("pressure estimation and bridged candidate reconstruction use the projected inputs", () => {
  const entries = [message("u0", "user", "Implement ORIGINAL_GOAL."), message("a0", "assistant"), message("p1", "user", "Check REPLACED_RAW_" + "X".repeat(12000)), message("a1", "assistant", "OMITTED_RAW_" + "Y".repeat(16000)), message("p2", "user", "Check NEXT_GOAL."), message("a2", "assistant"), message("tail", "user", "Keep the tail.")];
  const branch = link([...entries, edit("replace", "p1", "Check PROJECTED_PRESSURE_GOAL. " + "Z".repeat(2000)), edit("omit", "a1", null)]);
  const clean = projectedBranch(branch);
  let bridges = 0, cancellations = 0, preferred = 0;
  for (const tailBehavior of ["minimal", "pi-default", "unobserved"]) {
    for (const window of [350, 450, 600, 1000, 2000, 10000]) {
      const options = { boundary: "p1", window, all: branch };
      const cfg = { tailBehavior, contextPressureFallback: "vcc" };
      const expected = runHook("stock", clean, cfg, options);
      const actual = runHook("patched", branch, cfg, options);
      assert.deepEqual(actual, expected, `projected pressure parity: ${tailBehavior}/${window}`);
      // Independently retain exact stock behavior when no edits exist.
      assert.deepEqual(runHook("patched", link(entries), cfg, options), runHook("stock", link(entries), cfg, options));
      if (actual.cancel) { cancellations++; continue; }
      assert.doesNotMatch(actual.compaction.summary, /REPLACED_RAW_|OMITTED_RAW_/);
      if (actual.compaction.firstKeptEntryId !== "p1" && tailBehavior !== "unobserved") {
        bridges++;
        assert.match(actual.compaction.summary, /PROJECTED_PRESSURE_GOAL/);
        assert.match(actual.compaction.summary, /#2\b/);
      } else preferred++;
    }
  }
  assert.ok(bridges > 0, "exercise actual bridge reconstruction, not just the preferred tail");
  assert.ok(cancellations > 0, "exercise no-safe-fit cancellation");
  assert.ok(preferred > 0, "exercise the preferred pressure estimate");
  console.log(`PASS pressure cases: bridges=${bridges}, cancellations=${cancellations}, preferred=${preferred}; 18 projected and 18 stock comparisons`);
});

const capacitySettings = { enabled: true, reserveTokens: 100, keepRecentTokens: 1 };
const capacityConfigs = ["unobserved", "pi-default"].flatMap(tailBehavior =>
  ["default", "append"].map(compactionSummaryMode => ({ tailBehavior, compactionSummaryMode,
    ...(tailBehavior === "pi-default" ? { contextPressureFallback: "vcc" } : {}) })),
);
function customFixture(kind, customBoundary = false) {
  const manager = pi.SessionManager.inMemory(state);
  const first = manager.appendMessage({ role: "user", content: "Summarize GOAL.", timestamp: 1 });
  const answer = manager.appendMessage({ ...message("answer", "assistant", "Done.").message, timestamp: 2 });
  let tail;
  if (!customBoundary) tail = manager.appendMessage({ role: "user", content: "Keep the tail.", timestamp: 3 });
  const custom = manager.appendCustomMessageEntry("b1-synthetic", kind === "omit" ? "RAW_CUSTOM_" + "X".repeat(20000) : "small", false, { preserved: true });
  if (customBoundary) tail = manager.appendMessage({ role: "user", content: "Keep the tail.", timestamp: 3 });
  const coverage = manager.appendCustomEntry("om.observations.coverage", { coversFromId: first, coversUpToId: answer });
  return { manager, first, answer, tail, custom, coverage };
}
function projectedContextTokens(branch, result) {
  const compaction = { ...result.compaction, type: "compaction", id: "future", parentId: branch.at(-1).id, timestamp };
  return pi.convertToLlm(pi.buildSessionProjection([...branch, compaction]).messages)
    .reduce((sum, msg) => sum + pi.estimateTokens(msg), 0);
}

test("B1: public Pi custom omission/growth matches canonical stock capacity across eight cases", async () => {
  const jiti = createJiti(import.meta.url, { alias, fsCache: false, moduleCache: true });
  const { estimateEntryTokens } = await jiti.import(join(patched, "src/om/tokens.ts"));
  let comparisons = 0, controls = 0;
  for (const kind of ["omit", "grow"]) {
    const f = customFixture(kind);
    const rawCustom = JSON.stringify(f.manager.getEntry(f.custom));
    f.manager.appendContextEdit(f.custom, kind === "omit" ? null : { content: "PROJECTED_CUSTOM_" + "G".repeat(20000) });
    assert.equal(JSON.stringify(f.manager.getEntry(f.custom)), rawCustom);
    const branch = f.manager.getBranch(), clean = projectedBranch(branch);
    const before = JSON.stringify(f.manager.getEntries());
    assert.deepEqual(pi.buildSessionProjection(clean).messages, f.manager.buildSessionProjection().messages);
    const preparation = prepareCompaction(branch, capacitySettings);
    assert.ok(preparation);
    assert.equal(preparation.firstKeptEntryId, kind === "omit" ? f.tail : f.custom);
    assert.equal(prepareCompaction(clean, capacitySettings).firstKeptEntryId, preparation.firstKeptEntryId);
    const tailTokens = entries => entries.slice(entries.findIndex(entry => entry.id === f.tail))
      .reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
    assert.equal(tailTokens(branch), kind === "omit" ? 5007 : 6);
    assert.equal(tailTokens(clean), kind === "omit" ? 4 : 5009);
    for (const config of capacityConfigs) {
      const options = { preparation, window: 1000, all: f.manager.getEntries() };
      const expected = runHook("stock", clean, config, options);
      const actual = runHook("patched", branch, config, options);
      assert.deepEqual(actual, expected, `${kind}/${config.tailBehavior}/${config.compactionSummaryMode}`);
      const rawStock = runHook("stock", branch, config, options);
      assert.equal(Boolean(rawStock.cancel), kind === "omit", "the raw control must reproduce the opposite decision");
      if (kind === "omit") {
        assert.ok(actual.compaction);
        assert.equal(actual.compaction.firstKeptEntryId, f.tail);
        assert.equal(actual.compaction.details.sourceMessageCount, 2);
        assert.equal(actual.compaction.details.version, config.compactionSummaryMode === "append" ? 2 : 1);
        assert.doesNotMatch(actual.compaction.summary, /RAW_CUSTOM_|PROJECTED_CUSTOM_|small/);
        assert.ok(projectedContextTokens(branch, actual) < 900);
        const future = { ...actual.compaction, type: "compaction", id: "future", parentId: branch.at(-1).id, timestamp };
        const retained = pi.buildSessionProjection([...branch, future]).entries.map(({ sourceEntry }) => sourceEntry.id);
        assert.deepEqual(retained.slice(1), branch.slice(branch.findIndex(entry => entry.id === f.tail)).map(entry => entry.id));
      } else {
        assert.deepEqual(actual, { cancel: true });
        assert.ok(projectedContextTokens(branch, rawStock) > 900, "reject the projected context that exceeds capacity");
      }
      const noEdit = link(branch.filter(entry => entry.type !== "context_edit"));
      const noEditOptions = { ...options, preparation: prepareCompaction(noEdit, capacitySettings) };
      assert.deepEqual(runHook("patched", noEdit, config, noEditOptions), runHook("stock", noEdit, config, noEditOptions));
      console.log(JSON.stringify({ b1: kind, ...config, rawTailTokens: tailTokens(branch), projectedTailTokens: tailTokens(clean), capacity: 900,
        result: actual.cancel ? "cancel" : "compaction", projectedAfterTokens: projectedContextTokens(branch, kind === "omit" ? actual : rawStock) }));
      comparisons++;
      controls++;
    }
    assert.equal(JSON.stringify(f.manager.getEntries()), before, "raw history, IDs, edits and OM ledger stay byte-identical");
  }
  assert.equal(comparisons, 8);
  assert.equal(controls, 8);
  console.log("PASS B1: 8 canonical matches, 8 no-edit controls, zero mismatches; custom content excluded from fresh summaries");
});

test("custom capacity keeps omitted boundary anchors and selected latest edits, not off-branch edits", () => {
  for (const latest of ["omit", "grow"]) {
    const f = customFixture("omit");
    const replacement = { content: [{ type: "text", text: "PROJECTED_CUSTOM_" + "G".repeat(20000) }] };
    f.manager.appendContextEdit(f.custom, latest === "omit" ? replacement : null);
    f.manager.appendContextEdit(f.custom, latest === "omit" ? null : replacement);
    const activeLeaf = f.manager.getLeafId();
    f.manager.branch(f.coverage);
    const offBranch = f.manager.appendContextEdit(f.custom, latest === "omit" ? replacement : null);
    f.manager.branch(activeLeaf);
    const branch = f.manager.getBranch(), before = JSON.stringify(f.manager.getEntries());
    assert.ok(!branch.some(entry => entry.id === offBranch));
    const projection = f.manager.buildSessionProjection();
    assert.equal(projection.entries.find(({ sourceEntry }) => sourceEntry.id === f.custom).messages.length, latest === "omit" ? 0 : 1);
    const clean = link(branch.filter(entry => entry.type !== "context_edit").map(entry =>
      entry.id === f.custom ? { ...entry, content: latest === "omit" ? [] : replacement.content } : entry));
    for (const config of capacityConfigs) {
      const options = { boundary: f.tail, window: 1000, all: f.manager.getEntries() };
      const actual = runHook("patched", branch, config, options);
      assert.deepEqual(actual, runHook("stock", clean, config, options));
      assert.equal(Boolean(actual.cancel), latest === "grow");
      if (latest === "omit") {
        assert.equal(actual.compaction.firstKeptEntryId, f.tail);
        assert.doesNotMatch(actual.compaction.summary, /RAW_CUSTOM_|PROJECTED_CUSTOM_/);
      }
    }
    assert.equal(JSON.stringify(f.manager.getEntries()), before);
  }
  for (const oversized of [false, true]) {
    const f = customFixture("omit", true);
    f.manager.appendCustomMessageEntry("retained-after-anchor", oversized ? "Z".repeat(20000) : "tiny", false);
    f.manager.appendContextEdit(f.custom, null);
    const branch = f.manager.getBranch();
    // Keep the omitted raw boundary in the capacity control. Removing the ID
    // would make final slicing lose the later, still-visible custom content.
    const clean = link(branch.filter(entry => entry.type !== "context_edit").map(entry =>
      entry.id === f.custom ? { ...entry, content: [] } : entry));
    for (const config of capacityConfigs.filter(config => config.tailBehavior === "unobserved")) {
      const options = { window: 1000, all: f.manager.getEntries() };
      const actual = runHook("patched", branch, config, options);
      assert.deepEqual(actual, runHook("stock", clean, config, options));
      assert.equal(Boolean(actual.cancel), oversized);
      if (!oversized) assert.equal(actual.compaction.firstKeptEntryId, f.custom);
    }
  }
});
