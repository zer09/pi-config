import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const installed = resolve(process.env.PI_BLACKHOLE_PACKAGE_ROOT ?? join(here, "../npm/node_modules/pi-blackhole"));
const hookPath = "src/hooks/before-compact.ts";
const helpers = ["reapply-compact-after-percent-patch.mjs", "reapply-nullable-provider-headers-patch.mjs", "reapply-context-edit-compaction-patch.mjs"];
const read = (root, rel) => readFileSync(join(root, rel), "utf8");
const hash = (text) => createHash("sha256").update(text).digest("hex");

function snapshot(root, prefix = "") {
  const files = {};
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules") continue;
    const rel = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(files, snapshot(root, rel));
    else if (entry.isFile()) files[rel] = hash(readFileSync(join(root, rel)));
  }
  return files;
}

if (!process.argv.includes("--fixtures")) {
  test("offline stock -> all three patches -> identical second pass -> reinstall; drift guards and fixtures", () => {
    const root = mkdtempSync(join(tmpdir(), "blackhole-context-edit-test-"));
    const env = { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: join(root, "agent"), PI_BLACKHOLE_PACKAGE_ROOT: installed };
    const run = (file, args = []) => execFileSync(process.execPath, [file, ...args], { cwd: root, env, encoding: "utf8", timeout: 120000 });
    try {
      // No npm credentials or lifecycle scripts. An uncached release fails offline.
      execFileSync("npm", ["pack", "--offline", "--ignore-scripts", "--silent", "--userconfig=/dev/null", `--globalconfig=${root}/unused-npmrc`, `--cache=${join(homedir(), ".npm")}`, "pi-blackhole@0.5.8"], { cwd: root, env, encoding: "utf8", timeout: 60000 });
      execFileSync("tar", ["-xzf", "pi-blackhole-0.5.8.tgz"], { cwd: root, env });
      const stock = join(root, "package");
      const patched = join(root, "patched");
      assert.equal(hash(read(stock, hookPath)), "910e44fc74934293e0317eb914ac4ea94976e820043ff4dae0bde915ca5337ab");
      cpSync(stock, patched, { recursive: true });
      symlinkSync(dirname(installed), join(root, "node_modules"), "dir");
      for (const helper of helpers) assert.match(run(join(here, helper), [patched]), /patched:/);
      const first = snapshot(patched);
      for (const helper of helpers) assert.match(run(join(here, helper), [patched]), /already patched:/);
      assert.deepEqual(snapshot(patched), first);
      const reinstall = join(root, "reinstalled");
      cpSync(stock, reinstall, { recursive: true });
      for (const helper of helpers) run(join(here, helper), [reinstall]);
      assert.deepEqual(snapshot(reinstall), first, "a clean reinstall must produce identical files");
      const onlyHook = join(root, "only-hook");
      cpSync(stock, onlyHook, { recursive: true });
      for (const helper of helpers.slice(0, 2)) run(join(here, helper), [onlyHook]);
      const before = snapshot(onlyHook);
      run(join(here, helpers[2]), [onlyHook]);
      assert.deepEqual(Object.keys(first).filter((key) => before[key] !== first[key]), [hookPath]);

      for (const [name, base, mutate, error] of [
        ["version", patched, (p) => { const pkg = JSON.parse(read(p, "package.json")); pkg.version = "0.5.9"; writeFileSync(join(p, "package.json"), JSON.stringify(pkg)); }, /Expected pi-blackhole 0\.5\.8/],
        ["stock-drift", onlyHook, (p) => writeFileSync(join(p, hookPath), read(stock, hookPath) + "\n// drift\n"), /Source drift/],
        ["patched-drift", patched, (p) => writeFileSync(join(p, hookPath), read(p, hookPath) + "\n// drift\n"), /Source drift/],
        ["partial", patched, (p) => writeFileSync(join(p, hookPath), read(stock, hookPath).replace("{ convertToLlm }", "{ buildSessionProjection, convertToLlm }")), /Source drift/],
        ["inactive", stock, () => {}, /source entrypoint/],
      ]) {
        const target = join(root, name);
        cpSync(base, target, { recursive: true });
        mutate(target);
        const original = snapshot(target);
        const result = spawnSync(process.execPath, [join(here, helpers[2]), target], { cwd: root, env, encoding: "utf8" });
        assert.notEqual(result.status, 0, name);
        assert.match(result.stderr, error, name);
        assert.deepEqual(snapshot(target), original, `${name}: rejection must not write`);
      }
      const output = run(fileURLToPath(import.meta.url), ["--fixtures", patched, stock, root]);
      console.log(output.trim());
      assert.match(output, /fixtures and isolated Pi loader passed/);
      assert.deepEqual(snapshot(patched), first, "tests and loader must not modify package files");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
} else {
  await runFixtures(...process.argv.slice(process.argv.indexOf("--fixtures") + 1));
}

async function runFixtures(patched, stock, root) {
  // This child has only an isolated HOME/agent directory and no provider env.
  const net = await import("node:net");
  let networkCalls = 0;
  const blocked = () => { networkCalls++; throw new Error("Network is forbidden in this test"); };
  net.Socket.prototype.connect = blocked;
  globalThis.fetch = blocked;
  const require = createRequire(join(installed, "package.json"));
  const piRoot = join(dirname(installed), "@earendil-works/pi-coding-agent");
  // Resolve the import-only public root export, not a private runtime subpath.
  const piPath = join(piRoot, JSON.parse(read(piRoot, "package.json")).exports["."].import);
  const pi = await import(pathToFileURL(piPath).href);
  assert.equal(pi.VERSION, "0.87.1");
  const { createJiti } = require("jiti");
  const jiti = createJiti(import.meta.url, { fsCache: false, moduleCache: false, alias: { "@earendil-works/pi-coding-agent": piPath } });
  const original = await jiti.import(join(stock, hookPath));
  const repaired = await jiti.import(join(patched, hookPath));
  const { buildGlobalIndexById } = await jiti.import(join(patched, "src/core/global-indices.ts"));
  const { compile } = await jiti.import(join(patched, "src/core/summarize.ts"));
  const { loadAllMessages } = await jiti.import(join(patched, "src/core/load-messages.ts"));
  const timestamp = "2026-01-01T00:00:00.000Z";
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const message = (id, role, content = `${id} content`) => ({
    type: "message", id, timestamp,
    message: { role, content: role === "assistant" || role === "toolResult" ? [{ type: "text", text: content }] : content, timestamp: 1,
      ...(role === "assistant" ? { api: "test", provider: "test", model: "test", stopReason: "stop", usage } : {}),
      ...(role === "toolResult" ? { toolCallId: id, toolName: "read", isError: false } : {}),
    },
  });
  const edit = (id, targetId, content) => ({ type: "context_edit", id, targetId, replacement: content === null ? null : { content }, timestamp });
  const compact = (id, firstKeptEntryId) => ({ type: "compaction", id, firstKeptEntryId, summary: "OLD_SUMMARY", tokensBefore: 100, timestamp });
  const link = (entries) => entries.map((entry, i) => ({ parentId: entries[i - 1]?.id ?? null, ...entry }));
  const base = () => [message("u0", "user", "Implement the ORIGINAL_GOAL carefully."), message("a1", "assistant"), message("t2", "toolResult"), message("u3", "user", "Check SECOND_GOAL with tests."), message("a4", "assistant"), message("tail", "user", "Keep this tail.")];
  const selectedProjection = (branch, ids) => {
    const byId = new Map(pi.buildSessionProjection(branch).entries.map((e) => [e.sourceEntry.id, e.messages]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  };
  const check = (branch, ids, boundary, tail = "minimal") => {
    const raw = JSON.stringify(branch);
    const projection = pi.buildSessionProjection(branch);
    const result = repaired.buildOwnCut(branch, boundary, tail);
    assert.equal(result.ok, true);
    assert.deepEqual(result.selectedIds, ids);
    assert.deepEqual(result.messages, selectedProjection(branch, ids));
    assert.deepEqual(pi.buildSessionProjection(branch), projection, "checkpoint and tool state must not change");
    assert.equal(JSON.stringify(branch), raw, "raw messages/edits must not change");
    return result;
  };

  // Compare every cut against the stock function, including raw system messages.
  const sequences = [[], [message("u0", "user")], base().slice(0, 2), base(), base().filter((e) => e.message.role !== "user"), [message("sys", "system"), ...base()]];
  for (const kept of ["u0", "u3", "c0", "", "missing"]) sequences.push([...base().slice(0, 5), compact("c0", kept), ...base().slice(5), message("a6", "assistant")]);
  let comparisons = 0;
  for (const sequence of sequences) {
    const branch = link(sequence);
    for (const boundary of [undefined, "missing", ...branch.map((e) => e.id)]) {
      for (const tail of ["minimal", "pi-default"]) {
        assert.deepEqual(repaired.buildOwnCut(branch, boundary, tail), original.buildOwnCut(branch, boundary, tail));
        comparisons++;
      }
    }
  }
  console.log(`PASS stock cut/cancel parity: ${comparisons} cases`);

  for (const tail of ["minimal", "pi-default"]) {
    const branch = link([...base(), edit("omit", "a1", null), edit("replace", "u0", "Implement REPLACED_GOAL carefully."), edit("tool", "t2", "REPLACED_TOOL")]);
    const cut = check(branch, ["u0", "t2", "u3", "a4"], "tail", tail);
    assert.equal(cut.messages[0].content, "Implement REPLACED_GOAL carefully.");
    assert.deepEqual(cut.messages[1].content, [{ type: "text", text: "REPLACED_TOOL" }]);
    assert.equal(cut.firstKeptEntryId, "tail");
    const latest = link([...branch, edit("omit-u", "u0", null), edit("latest-u", "u0", "LATEST_GOAL")]);
    assert.equal(check(latest, cut.selectedIds, "tail", tail).messages[0].content, "LATEST_GOAL");
    // Resolve omitted/non-message boundaries to the next visible raw source ID.
    const withGap = link([...base().slice(0, 3), { type: "custom", id: "marker", timestamp }, ...base().slice(3), edit("omit-u3", "u3", null)]);
    const expected = tail === "pi-default" ? ["u0", "a1", "t2"] : ["u0", "a1", "t2", "a4"];
    check(withGap, expected, "marker", tail);
    check(withGap, expected, "u3", tail);
  }
  const splitTurn = link([...base().slice(0, -1), edit("split-edit", "u3", "SPLIT_REPLACEMENT")]);
  for (const tail of ["minimal", "pi-default"]) {
    assert.equal(check(splitTurn, ["u0", "a1", "t2", "u3"], "a4", tail).firstKeptEntryId, "a4");
  }
  const allOmitted = link([...base(), ...base().map((e, i) => edit(`drop${i}`, e.id, null))]);
  assert.deepEqual(repaired.buildOwnCut(allOmitted), { ok: false, reason: "no_live_messages" });
  const almostOmitted = allOmitted.slice(0, -2);
  assert.deepEqual(repaired.buildOwnCut(almostOmitted), { ok: false, reason: "too_few_live_messages" });
  console.log("PASS omission, replacement, latest edit, omitted boundaries, both tail policies and cancellation");

  const active = link([...base(), edit("active-edit", "u0", "ACTIVE_GOAL")]);
  const offBranch = { ...edit("sibling-edit", "u0", null), parentId: "tail" };
  const all = [...active, offBranch];
  const target = pi.buildSessionProjection(all, "active-edit");
  assert.deepEqual(pi.buildSessionProjection(active), target);
  check(active, ["u0", "a1", "t2", "u3", "a4"], "tail");
  assert.equal(original.buildOwnCut(link(base()), "tail").messages[0].content, "Implement the ORIGINAL_GOAL carefully.");
  console.log("PASS off-branch edit excluded and navigating before edit restores original contribution");

  const checkpoint = { role: "system", content: "CHECKPOINT", sections: { preamble: "SYSTEM" }, toolsAdded: [{ name: "read", description: "read", parameters: {} }], timestamp: 1 };
  for (const kept of ["u3", "c0", "", "missing"]) {
    const branch = link([...base().slice(0, 5), { ...compact("c0", kept), systemMessage: checkpoint }, message("u6", "user"), message("a7", "assistant"), message("t8", "toolResult"), message("tail", "user"), edit("retained-edit", "u3", "EDITED_RETAINED"), edit("fresh-edit", "a7", "EDITED_FRESH")]);
    const ids = kept === "u3" ? ["u3", "a4", "u6", "a7", "t8"] : ["u6", "a7", "t8"];
    check(branch, ids, "tail");
    assert.deepEqual(pi.buildSessionProjection(branch).messages[0], checkpoint);
  }
  const nested = link([...base().slice(0, 3), compact("c0", "u0"), message("u3", "user"), message("a4", "assistant"), compact("c1", "c0"), message("tail", "user"), edit("nested-edit", "u3", "NESTED_REPLACEMENT")]);
  check(nested, ["u3", "a4"], "tail", "pi-default");
  const excluded = link([...base(), edit("old-edit", "u0", "EXCLUDED_EDIT"), compact("c0", "c0"), message("u6", "user"), message("a7", "assistant"), message("tail2", "user")]);
  check(excluded, ["u6", "a7"], "tail2");
  console.log("PASS retained, self-ID, sentinel, orphan and nested compactions; system/tool checkpoint unchanged");

  const calls = ["one", "two"].map((id) => ({ type: "toolCall", id, name: "read", arguments: { path: `${id}.txt` } }));
  const partial = link([message("u0", "user"), { ...message("a1", "assistant"), message: { ...message("a1", "assistant").message, content: calls } }, message("one", "toolResult"), message("two", "toolResult"), message("tail", "user"), edit("partial", "a1", [calls[1]]), edit("omit-one", "one", null)]);
  assert.deepEqual(check(partial, ["u0", "a1", "two"], "tail").messages[1].content, [calls[1]]);
  console.log("PASS partial tool-call replacement and paired result omission match Pi projection");

  const custom = { type: "custom_message", id: "custom", customType: "test", content: "CUSTOM_NOT_SUMMARIZED", display: true, timestamp };
  const summary = { type: "branch_summary", id: "bs", summary: "BRANCH_NOT_SUMMARIZED", fromId: "u0", timestamp };
  const observation = { id: "abcdef123456", content: "EXISTING_MEMORY", timestamp, relevance: "high", sourceEntryIds: ["a1"], tokenCount: 5 };
  const om = { type: "custom", id: "om", customType: "om.observations.recorded", data: { observations: [observation], coversUpToId: "a1" }, timestamp };
  const branch = link([...base(), custom, summary, om, edit("omit", "a1", null), edit("replace", "u0", "Implement REPLACED_GOAL carefully.")]);
  const raw = JSON.stringify(branch);
  const off = message("off", "user", "OFF_BRANCH_NOT_SUMMARIZED");
  const entries = [off, ...branch];
  const ids = ["u0", "t2", "u3", "a4"];
  const cut = check(branch, ids, "tail");
  const global = buildGlobalIndexById(entries);
  assert.deepEqual(ids.map((id) => global.get(id)), [1, 3, 4, 5]);
  const previousSummary = "[Session Goal]\n- PREVIOUS_MEMORY\n\n---\n\nPrevious transcript.";
  const config = { compaction: "auto", compactionEngine: "blackhole", tailBehavior: "minimal", memory: true, fullFoldAlways: true, observationsPoolMaxTokens: 1000, reflectionsPoolMaxTokens: 0, retainedToolOutputMaxTokens: 0, debug: false, debugLog: false };
  const runtime = { config, ensureConfig() {} };
  const handlers = new Map();
  repaired.registerBeforeCompactHook({ on: (name, fn) => handlers.set(name, fn) }, runtime);
  const ctx = { cwd: root, ui: { notify() {} }, sessionManager: { getEntries: () => entries, getSessionFile: () => { throw new Error("Do not read real sessions"); } } };
  const event = { branchEntries: branch, preparation: { firstKeptEntryId: "tail", previousSummary, tokensBefore: 100, fileOps: { read: new Set(), written: new Set(), edited: new Set() } } };
  const result = handlers.get("session_before_compact")(event, ctx);
  assert.ok(result?.compaction);
  const expected = compile({ messages: pi.convertToLlm(cut.messages), previousSummary, fileOps: { readFiles: [], modifiedFiles: [] }, sourceIndices: ids.map((id) => global.get(id)), touchMessages: cut.messages, cwd: root, gitTags: new Map() });
  assert.ok(result.compaction.summary.startsWith(expected));
  assert.match(result.compaction.summary, /REPLACED_GOAL/);
  assert.match(result.compaction.summary, /#1\b/);
  assert.match(result.compaction.summary, /#4\b/);
  assert.doesNotMatch(result.compaction.summary, /#2\b|ORIGINAL_GOAL|CUSTOM_NOT_SUMMARIZED|BRANCH_NOT_SUMMARIZED|OFF_BRANCH_NOT_SUMMARIZED/);
  assert.match(result.compaction.summary, /PREVIOUS_MEMORY/);
  assert.match(result.compaction.summary, /EXISTING_MEMORY/);
  assert.deepEqual(result.compaction.details["om.folded"].observations, [observation]);
  assert.equal(JSON.stringify(branch), raw);
  console.log("PASS real hook/compiler: raw #N gaps, no extra entry types, previous summary and OM preserved");

  const historyFile = join(root, "synthetic-history.jsonl");
  const history = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  writeFileSync(historyFile, history);
  const recall = loadAllMessages(historyFile, true);
  assert.deepEqual(recall.entryIds, entries.filter((e) => e.type === "message").map((e) => e.id));
  assert.equal(recall.rawMessages[1].content, "Implement the ORIGINAL_GOAL carefully.");
  assert.equal(recall.entryIds[2], "a1", "omitted content remains raw-recallable");
  assert.deepEqual(recall.rawMessages[2], branch.find((e) => e.id === "a1").message);
  assert.equal(readFileSync(historyFile, "utf8"), history);
  console.log("PASS synthetic raw recall and stored JSONL unchanged");

  // Load only this package with Pi's actual public extension loader. No session
  // starts, no prompts run, and cache warming stays off in the isolated settings.
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ cacheWarming: "off" }));
  const loaded = await pi.discoverAndLoadExtensions([join(patched, "index.ts")], root, agentDir);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const loadedHook = loaded.extensions[0].handlers.get("session_before_compact")[0];
  const loadedResult = await loadedHook({ ...event, customInstructions: repaired.PI_VCC_COMPACT_INSTRUCTION }, ctx);
  assert.match(loadedResult.compaction.summary, /REPLACED_GOAL/);
  assert.doesNotMatch(loadedResult.compaction.summary, /ORIGINAL_GOAL/);
  assert.equal(JSON.parse(read(agentDir, "settings.json")).cacheWarming, "off");
  assert.equal(networkCalls, 0);
  console.log("PASS fixtures and isolated Pi loader passed; zero network calls");
}
