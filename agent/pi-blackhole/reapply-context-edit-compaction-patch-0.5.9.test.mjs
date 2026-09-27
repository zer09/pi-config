import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync, cpSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { reapplyCompactAfterPercentPatch } from "./reapply-compact-after-percent-patch-0.5.9.mjs";
import { reapplyNullableProviderHeadersPatch } from "./reapply-nullable-provider-headers-patch-0.5.9.mjs";
import { reapplyContextEditCompactionPatch } from "./reapply-context-edit-compaction-patch-0.5.9.mjs";

// Run: node --test <this-file>. No package acquisition, install, or real sessions.
// Override PI_BLACKHOLE_0_5_9_TARBALL only with the identical verified archive.
const registryIntegrity = "sha512-VlCdj0Dy7T+Qx9tZKjExpCcJ77vZNMWi4qvPddo7ed9dVCUn3Npjub3kveYOsj8gCNvoWpviIe0UBywlTu6irQ==";
const tarballPath = process.env.PI_BLACKHOLE_0_5_9_TARBALL ??
  "/tmp/pi-blackhole-0.5.9-increment1-aqrwBx/pi-blackhole-0.5.9.tgz";
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../..");
const installed = join(repository, "agent/npm/node_modules/pi-blackhole");
const globalModules = "/home/gc/.bun/install/global/node_modules";
const hookPath = "src/hooks/before-compact.ts";
const stockHash = "910e44fc74934293e0317eb914ac4ea94976e820043ff4dae0bde915ca5337ab";
const patchedHash = "0898de0d68af964968087a18741c69b4211dc5289d7c685422c8e632fcbbcf1b";
const percentageFiles = ["package.json", "src/core/unified-config.ts", "src/om/model-budget.ts", "src/commands/memory.ts"];
const headerFiles = ["src/om/runtime.ts", "src/om/provider-stream.ts",
  ...["observer", "reflector", "dropper"].map((stage) => `src/om/agents/${stage}/agent.ts`)];
const prerequisites = [...percentageFiles, "index.ts", "src/om/compaction-trigger.ts", ...headerFiles];
const read = (root, rel) => readFileSync(join(root, rel), "utf8");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function snapshot(root, includeWriteTimes = false) {
  const files = {};
  function visit(path, rel) {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink()) files[rel] = `link:${readlinkSync(path)}`;
    else if (stat.isDirectory()) {
      files[rel] = "directory";
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${rel}/${name}`);
    } else {
      files[rel] = hash(readFileSync(path));
      if (includeWriteTimes) files[rel] += `:${stat.mtimeNs}:${stat.ctimeNs}`;
    }
  }
  visit(root, "");
  return files;
}

function protectedSnapshot() {
  const paths = [
    installed, join(repository, "agent/settings.json"), join(here, "pi-blackhole-config.json"),
    ...readdirSync(here).filter((name) => /\.(mjs|md)$/.test(name) &&
      !name.startsWith("reapply-context-edit-compaction-patch-0.5.9."))
      .sort().map((name) => join(here, name)),
  ];
  return Object.fromEntries(paths.map((path) => [path, snapshot(path)]));
}

function stockArchive(tarball) {
  assert.equal(`sha512-${createHash("sha512").update(tarball).digest("base64")}`, registryIntegrity,
    "tarball must match the pinned npm registry SRI before extraction");
  // This pinned archive contains only ordinary files, with no links or extensions.
  const tar = gunzipSync(tarball);
  const files = new Map();
  for (let offset = 0; tar[offset];) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).split("\0")[0];
    assert.equal(header.toString("utf8", 156, 157), "0");
    assert.equal(header[345], 0);
    assert.ok(name.startsWith("package/"));
    const rel = name.slice("package/".length);
    assert.ok(rel && !rel.split("/").some((part) => part === ".." || part === ""));
    assert.ok(!files.has(rel));
    const size = Number.parseInt(header.toString("utf8", 124, 136), 8);
    assert.ok(Number.isInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    files.set(rel, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(files.size, 132);
  return files;
}

if (process.argv.includes("--fixtures")) {
  await runFixtures(...process.argv.slice(process.argv.indexOf("--fixtures") + 1));
} else {
  test("isolated pi-blackhole@0.5.9 context-edit compaction candidate", async (t) => {
    const protectedBefore = protectedSnapshot();
    assert.equal(JSON.parse(read(installed, "package.json")).version, "0.5.8");
    const root = mkdtempSync(join(realpathSync(tmpdir()), "pi-blackhole-0.5.9-context-edit-test-"));
    t.after(() => {
      try {
        assert.deepEqual(protectedSnapshot(), protectedBefore,
          "installed 0.5.8, settings, config, earlier helpers/tests/docs, and increments 1/2 must remain byte-identical");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
    const env = {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, TMPDIR: realpathSync(tmpdir()),
      PI_CODING_AGENT_DIR: join(root, "agent"), JITI_FS_CACHE: "false",
    };
    const archive = readFileSync(tarballPath);
    const files = stockArchive(archive);
    const stock = join(root, "stock");
    for (const [rel, bytes] of files) {
      mkdirSync(dirname(join(stock, rel)), { recursive: true });
      writeFileSync(join(stock, rel), bytes);
    }
    assert.equal(hash(read(stock, hookPath)), stockHash);
    const stockBefore = snapshot(stock);
    function candidate(from) {
      const target = join(mkdtempSync(join(root, "case-")), "package");
      cpSync(from, target, { recursive: true });
      return target;
    }
    const percent = candidate(stock);
    assert.match(reapplyCompactAfterPercentPatch(percent), /^patched:/);
    const ready = candidate(percent);
    assert.match(reapplyNullableProviderHeadersPatch(ready), /^patched:/);
    const readyBefore = snapshot(ready);
    const patched = candidate(ready);
    let rejections = 0;
    function rejects(target, expected = /Mixed|Drifted|drifted|Expected|ENOENT|non-isolated/) {
      const before = snapshot(root, true);
      assert.throws(() => reapplyContextEditCompactionPatch(target), expected);
      assert.deepEqual(snapshot(root, true), before, "rejection must change zero bytes and zero file write times");
      rejections++;
      if (typeof target === "string" && target.startsWith(join(root, "case-")) &&
          ![percent, ready, patched].includes(target)) rmSync(dirname(target), { recursive: true, force: true });
    }

    await t.test("only the hook changes; exact accepted projection bytes; idempotence and clean reapply", () => {
      assert.match(reapplyContextEditCompactionPatch(patched), /^patched:/);
      const after = snapshot(patched);
      assert.deepEqual(Object.keys(after).filter((key) => readyBefore[key] !== after[key]), [`/${hookPath}`]);
      assert.equal(hash(read(patched, hookPath)), patchedHash);
      const before = snapshot(patched, true);
      for (const apply of [reapplyCompactAfterPercentPatch, reapplyNullableProviderHeadersPatch, reapplyContextEditCompactionPatch]) {
        assert.match(apply(patched), /^already patched:/);
      }
      assert.deepEqual(snapshot(patched, true), before, "all three helpers must be write-free on the second pass");
      const fresh = candidate(stock);
      reapplyCompactAfterPercentPatch(fresh);
      reapplyNullableProviderHeadersPatch(fresh);
      reapplyContextEditCompactionPatch(fresh);
      assert.deepEqual(snapshot(fresh), after);
      rmSync(dirname(fresh), { recursive: true, force: true });
    });

    await t.test("explicit temp-only target, version, entrypoint and both complete prerequisites are required", () => {
      for (const target of [undefined, "", " "]) rejects(target, /explicit isolated/);
      for (const target of [installed, repository]) rejects(target, /non-isolated/);
      rejects(join(root, "missing"), /ENOENT/);
      const alias = join(root, "alias");
      symlinkSync(ready, alias, "dir");
      rejects(alias, /non-isolated/);
      const moduleRoot = join(root, "node_modules/pi-blackhole");
      cpSync(ready, moduleRoot, { recursive: true });
      rejects(moduleRoot, /non-isolated/);
      for (const change of [{ name: "other" }, { version: "0.5.8" }, { version: "0.5.10" }, { version: "0.5.9-beta" }]) {
        const target = candidate(ready);
        writeFileSync(join(target, "package.json"), JSON.stringify({ ...JSON.parse(read(ready, "package.json")), ...change }));
        rejects(target, /Expected exactly pi-blackhole@0\.5\.9/);
      }
      rejects(candidate(stock), /percentage candidate first/);
      rejects(candidate(percent), /percentage\/header prerequisite/);
      const spoofed = candidate(stock);
      writeFileSync(join(spoofed, "package.json"), read(ready, "package.json"));
      rejects(spoofed, /percentage\/header prerequisite/);
      for (const extensions of [undefined, [], ["./index.ts", "./dist/index.js"], "./index.ts"]) {
        const target = candidate(ready);
        const pkg = JSON.parse(read(target, "package.json"));
        pkg.pi.extensions = extensions;
        writeFileSync(join(target, "package.json"), JSON.stringify(pkg));
        rejects(target, /percentage candidate first/);
      }
      for (const args of [[], [ready, "unexpected"]]) {
        const before = snapshot(root, true);
        const result = spawnSync(process.execPath, [join(here, "reapply-context-edit-compaction-patch-0.5.9.mjs"), ...args],
          { cwd: root, env, encoding: "utf8", timeout: 10000 });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Usage:/);
        assert.deepEqual(snapshot(root, true), before);
      }
    });

    await t.test("every missing, drifted or mixed prerequisite/hook rejects before any write in either state", () => {
      for (const from of [ready, patched]) {
        for (const rel of [...prerequisites, hookPath]) {
          const missing = candidate(from);
          unlinkSync(join(missing, rel));
          rejects(missing, /ENOENT/);
          const drifted = candidate(from);
          writeFileSync(join(drifted, rel), `${read(drifted, rel)}\n`);
          rejects(drifted);
        }
        for (const rel of [...percentageFiles, ...headerFiles]) {
          const mixed = candidate(from);
          writeFileSync(join(mixed, rel), read(stock, rel));
          rejects(mixed, /percentage candidate first|percentage\/header prerequisite/);
        }
      }
    });

    await t.test("all partial hook combinations and duplicate/deleted anchors reject without repair", () => {
      const original = read(ready, hookPath);
      const repaired = read(patched, hookPath);
      const marker = "  // Minimal normally cuts at the last user message.";
      const projection = repaired.slice(repaired.indexOf("  // Apply only edits selected"), repaired.indexOf(marker));
      assert.ok(projection.includes("buildSessionProjection(branchEntries)"));
      const anchors = [
        ["  message: { role: string; content: unknown };", "  message: { role: string; content?: unknown };"],
        ['import { convertToLlm } from "@earendil-works/pi-coding-agent";',
          'import { buildSessionProjection, convertToLlm } from "@earendil-works/pi-coding-agent";'],
        [marker, projection + marker],
        ['          (e: any, i: number) => i > cutInBranch && e.type === "message" && e.message,',
          '          (e: any, i: number) =>\n            i > cutInBranch && e.type === "message" && e.message && !omittedIds.has(e.id),'],
      ];
      for (let mask = 1; mask < 15; mask++) {
        const target = candidate(ready);
        let partial = original;
        for (let i = 0; i < anchors.length; i++) if (mask & (1 << i)) partial = partial.replace(...anchors[i]);
        writeFileSync(join(target, hookPath), partial);
        rejects(target);
      }
      for (const [from, index] of [[ready, 0], [patched, 1]]) {
        for (const pair of anchors) {
          const anchor = pair[index];
          assert.equal(read(from, hookPath).split(anchor).length, 2);
          for (const replacement of [anchor + anchor, ""]) {
            const target = candidate(from);
            writeFileSync(join(target, hookPath), read(from, hookPath).replace(anchor, replacement));
            rejects(target);
          }
        }
      }
    });

    await t.test("linked prerequisites, hook and parent directories cannot modify shared files", () => {
      for (const rel of [...prerequisites, hookPath]) {
        for (const kind of ["symlink", "hardlink"]) {
          const target = candidate(ready);
          const shared = join(mkdtempSync(join(root, "shared-")), "file");
          cpSync(join(target, rel), shared);
          unlinkSync(join(target, rel));
          if (kind === "hardlink") linkSync(shared, join(target, rel));
          else symlinkSync(shared, join(target, rel), "file");
          rejects(target, /unlinked regular file/);
          rmSync(dirname(shared), { recursive: true, force: true });
        }
      }
      const target = candidate(ready);
      const shared = join(root, "shared-hooks");
      cpSync(join(target, "src/hooks"), shared, { recursive: true });
      rmSync(join(target, "src/hooks"), { recursive: true });
      symlinkSync(shared, join(target, "src/hooks"), "dir");
      rejects(target, /unlinked regular file/);
      console.log(`PASS zero-write rejection matrix: ${rejections} cases`);
    });

    await t.test("Pi 0.87.1 public projection, compiler, synthetic history and explicit source loader without inference", () => {
      const before = snapshot(patched, true);
      const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--fixtures", patched, stock, root],
        { cwd: root, env, encoding: "utf8", timeout: 120000 });
      console.log(output.trim());
      assert.match(output, /fixtures and isolated Pi loader passed/);
      assert.deepEqual(snapshot(patched, true), before, "runtime checks must not write to the candidate");
    });

    await t.test("corrupt archive fails closed; stock, prerequisite reference and protected files remain identical", () => {
      const corrupt = Buffer.from(archive);
      corrupt[0] ^= 1;
      assert.throws(() => stockArchive(corrupt), /pinned npm registry SRI/);
      assert.deepEqual(snapshot(stock), stockBefore);
      assert.deepEqual(snapshot(ready), readyBefore);
      assert.deepEqual(protectedSnapshot(), protectedBefore);
    });
  });
}

async function runFixtures(patched, stock, root) {
  // Only this child imports Pi. Its HOME, cwd, settings and history are disposable.
  const require = createRequire(join(globalModules, "@earendil-works/pi-coding-agent/package.json"));
  let networkCalls = 0;
  let inferenceCalls = 0;
  let otherProcesses = 0;
  const blocked = () => { networkCalls++; throw new Error("Network is forbidden in this test"); };
  require("node:net").Socket.prototype.connect = blocked;
  require("node:tls").connect = blocked;
  require("node:dgram").createSocket = blocked;
  for (const protocol of ["node:http", "node:https"]) {
    require(protocol).request = blocked;
    require(protocol).get = blocked;
  }
  globalThis.fetch = blocked;
  globalThis.WebSocket = blocked;
  const childProcess = require("node:child_process");
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "fork"]) {
    childProcess[name] = () => { otherProcesses++; throw new Error("Subprocess forbidden in fixture child"); };
  }
  childProcess.execFileSync = (file, args) => {
    // Keep the compiler's local git probe deterministic without starting any process.
    if (file === "git" && JSON.stringify(args) === '["rev-parse","--show-toplevel"]') {
      throw new Error("Fixture has no git repository");
    }
    otherProcesses++;
    throw new Error("Subprocess forbidden in fixture child");
  };
  syncBuiltinESMExports();
  assert.equal(process.env.HOME, root);
  assert.equal(process.cwd(), root);
  assert.equal(process.env.PI_CODING_AGENT_DIR, join(root, "agent"));
  const piRoot = join(globalModules, "@earendil-works/pi-coding-agent");
  const piPath = join(piRoot, JSON.parse(read(piRoot, "package.json")).exports["."].import);
  // Resolve Pi's public root export, never a private projection implementation.
  const pi = await import(pathToFileURL(piPath).href);
  assert.equal(pi.VERSION, "0.87.1");
  const { createJiti } = require("jiti");
  const jiti = createJiti(import.meta.url, {
    fsCache: false, moduleCache: false,
    alias: {
      "@earendil-works/pi-coding-agent": piPath,
      "@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui"),
    },
  });
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
  assert.equal(comparisons, 162);
  console.log(`PASS stock cut/cancel parity: ${comparisons} cases`);

  for (const tail of ["minimal", "pi-default"]) {
    const branch = link([...base(), edit("omit", "a1", null), edit("replace", "u0", "Implement REPLACED_GOAL carefully."), edit("tool", "t2", "REPLACED_TOOL")]);
    const cut = check(branch, ["u0", "t2", "u3", "a4"], "tail", tail);
    assert.equal(cut.messages[0].content, "Implement REPLACED_GOAL carefully.");
    assert.deepEqual(cut.messages[1].content, [{ type: "text", text: "REPLACED_TOOL" }]);
    assert.equal(cut.firstKeptEntryId, "tail");
    const omitted = link([...branch, edit("omit-u", "u0", null)]);
    check(omitted, ["t2", "u3", "a4"], "tail", tail);
    const latest = link([...omitted, edit("latest-u", "u0", "LATEST_GOAL")]);
    assert.equal(check(latest, cut.selectedIds, "tail", tail).messages[0].content, "LATEST_GOAL");
    const withGap = link([...base().slice(0, 3), { type: "custom", id: "marker", timestamp }, ...base().slice(3), edit("omit-u3", "u3", null)]);
    const expected = tail === "pi-default" ? ["u0", "a1", "t2"] : ["u0", "a1", "t2", "a4"];
    const boundary = tail === "pi-default" ? "a4" : "tail";
    assert.equal(check(withGap, expected, "marker", tail).firstKeptEntryId, boundary);
    assert.equal(check(withGap, expected, "u3", tail).firstKeptEntryId, boundary);
  }
  const splitTurn = link([...base().slice(0, -1), edit("split-edit", "u3", "SPLIT_REPLACEMENT")]);
  for (const tail of ["minimal", "pi-default"]) {
    assert.equal(check(splitTurn, ["u0", "a1", "t2", "u3"], "a4", tail).firstKeptEntryId, "a4");
  }
  const allOmitted = link([...base(), ...base().map((e, i) => edit(`drop${i}`, e.id, null))]);
  assert.deepEqual(repaired.buildOwnCut(allOmitted), { ok: false, reason: "no_live_messages" });
  assert.deepEqual(repaired.buildOwnCut(allOmitted.slice(0, -2)), { ok: false, reason: "too_few_live_messages" });
  console.log("PASS omission, replacement, latest edit, omitted boundaries, both tail policies and cancellation");

  const active = link([...base(), edit("active-edit", "u0", "ACTIVE_GOAL")]);
  const offBranch = { ...edit("sibling-edit", "u0", null), parentId: "tail" };
  assert.deepEqual(pi.buildSessionProjection(active), pi.buildSessionProjection([...active, offBranch], "active-edit"));
  assert.equal(check(active, ["u0", "a1", "t2", "u3", "a4"], "tail").messages[0].content, "ACTIVE_GOAL");
  assert.equal(repaired.buildOwnCut(link(base()), "tail").messages[0].content, "Implement the ORIGINAL_GOAL carefully.");
  console.log("PASS active branch excludes sibling edit; navigating before edit restores original contribution");

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
  // The raw collector keeps non-editable messages even when projection folds system state.
  const system = { ...message("sys", "system"), message: checkpoint };
  const bash = { ...message("bash", "bashExecution"), message: { role: "bashExecution", command: "fixture", output: "RAW_OUTPUT", exitCode: 0, timestamp: 1 } };
  const rawCollector = link([system, ...base().slice(0, 3), bash, ...base().slice(3), edit("fresh", "u0", "EDITED")]);
  const collected = repaired.buildOwnCut(rawCollector, "tail");
  assert.deepEqual(collected.selectedIds, ["sys", "u0", "a1", "t2", "bash", "u3", "a4"]);
  assert.equal(collected.messages[0], checkpoint);
  assert.equal(collected.messages[4], bash.message);
  console.log("PASS retained, self-ID, sentinel, orphan/nested compactions; raw collector and system/tool checkpoint unchanged");

  const calls = ["one", "two"].map((id) => ({ type: "toolCall", id, name: "read", arguments: { path: `${id}.txt` } }));
  const partial = link([message("u0", "user"), { ...message("a1", "assistant"), message: { ...message("a1", "assistant").message, content: calls } }, message("one", "toolResult"), message("two", "toolResult"), message("tail", "user"), edit("partial", "a1", [calls[1]]), edit("omit-one", "one", null)]);
  assert.deepEqual(check(partial, ["u0", "a1", "two"], "tail").messages[1].content, [calls[1]]);
  console.log("PASS partial tool-call replacement and paired result omission match Pi projection");

  const custom = { type: "custom_message", id: "custom", customType: "test", content: "CUSTOM_NOT_SUMMARIZED", display: true, timestamp };
  const summary = { type: "branch_summary", id: "bs", summary: "BRANCH_NOT_SUMMARIZED", fromId: "u0", timestamp };
  const observation = { id: "abcdef123456", content: "EXISTING_MEMORY", timestamp, relevance: "high", sourceEntryIds: ["a1"], tokenCount: 5 };
  const om = { type: "custom", id: "om", customType: "om.observations.recorded", data: { observations: [observation], coversUpToId: "a1" }, timestamp };
  const branch = link([...base(), custom, summary, om, edit("omit", "a1", null), edit("replace", "u0", "Implement REPLACED_GOAL carefully."), edit("kept-edit", "tail", "KEPT_EDIT")]);
  const raw = JSON.stringify(branch);
  const entries = [message("off", "user", "OFF_BRANCH_NOT_SUMMARIZED"), ...branch];
  const ids = ["u0", "t2", "u3", "a4"];
  const cut = check(branch, ids, "tail");
  const global = buildGlobalIndexById(entries);
  assert.deepEqual(ids.map((id) => global.get(id)), [1, 3, 4, 5]);
  const previousSummary = "[Session Goal]\n- PREVIOUS_MEMORY\n\n---\n\nPrevious transcript.";
  const config = { compaction: "auto", compactionEngine: "blackhole", tailBehavior: "minimal", memory: true, fullFoldAlways: true, observationsPoolMaxTokens: 1000, reflectionsPoolMaxTokens: 0, retainedToolOutputMaxTokens: 0, debug: false, debugLog: false };
  const runtime = { config, ensureConfig() {} };
  const handlers = new Map();
  repaired.registerBeforeCompactHook({ on: (name, fn) => handlers.set(name, fn) }, runtime);
  const modelRegistry = new Proxy({}, { get: () => () => { inferenceCalls++; throw new Error("Inference/auth forbidden in fixture child"); } });
  const ctx = { cwd: root, ui: { notify() {} }, modelRegistry, sessionManager: { getEntries: () => entries, getSessionFile: () => { throw new Error("Do not read real sessions"); } } };
  const event = { branchEntries: branch, preparation: { firstKeptEntryId: "tail", previousSummary, tokensBefore: 100, fileOps: { read: new Set(), written: new Set(), edited: new Set() } } };
  const result = handlers.get("session_before_compact")(event, ctx);
  assert.ok(result?.compaction);
  const expected = compile({ messages: pi.convertToLlm(cut.messages), previousSummary, fileOps: { readFiles: [], modifiedFiles: [] }, sourceIndices: ids.map((id) => global.get(id)), touchMessages: cut.messages, cwd: root, gitTags: new Map() });
  assert.ok(result.compaction.summary.startsWith(expected));
  assert.match(result.compaction.summary, /REPLACED_GOAL/);
  assert.match(result.compaction.summary, /#1\b/);
  assert.match(result.compaction.summary, /#4\b/);
  assert.doesNotMatch(result.compaction.summary, /#2\b|ORIGINAL_GOAL|CUSTOM_NOT_SUMMARIZED|BRANCH_NOT_SUMMARIZED|OFF_BRANCH_NOT_SUMMARIZED|KEPT_EDIT/);
  assert.match(result.compaction.summary, /PREVIOUS_MEMORY/);
  assert.match(result.compaction.summary, /EXISTING_MEMORY/);
  assert.deepEqual(result.compaction.details["om.folded"].observations, [observation]);
  assert.equal(result.compaction.firstKeptEntryId, "tail");
  assert.equal(JSON.stringify(branch), raw);
  console.log("PASS real hook/compiler: raw #N gaps, collector boundaries, previous summary and OM preserved");

  const historyFile = join(root, "synthetic-history.jsonl");
  const history = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  writeFileSync(historyFile, history);
  const recall = loadAllMessages(historyFile, true);
  assert.deepEqual(recall.entryIds, entries.filter((e) => e.type === "message").map((e) => e.id));
  assert.equal(recall.rawMessages[1].content, "Implement the ORIGINAL_GOAL carefully.");
  assert.equal(recall.entryIds[2], "a1", "omitted content remains raw-recallable");
  assert.deepEqual(recall.rawMessages[2], branch.find((e) => e.id === "a1").message);
  assert.equal(readFileSync(historyFile, "utf8"), history);
  const appended = { ...compact("new-compaction", result.compaction.firstKeptEntryId), ...result.compaction,
    parentId: branch.at(-1).id, systemMessage: checkpoint };
  appendFileSync(historyFile, `${JSON.stringify(appended)}\n`);
  const persisted = readFileSync(historyFile, "utf8");
  assert.equal(persisted.slice(0, history.length), history, "append must leave every earlier raw byte unchanged");
  const projected = pi.buildSessionProjection(persisted.trim().split("\n").map((line) => JSON.parse(line)), appended.id);
  assert.deepEqual(projected.messages[0], checkpoint);
  assert.equal(projected.messages.find((m) => m.role === "compactionSummary").summary, result.compaction.summary);
  assert.equal(projected.entries.find((e) => e.sourceEntry.id === "tail").messages[0].content, "KEPT_EDIT");
  assert.ok(!projected.entries.some((e) => ids.includes(e.sourceEntry.id) || e.sourceEntry.id === "a1"));
  assert.deepEqual(loadAllMessages(historyFile, true), recall, "compaction must not change raw recall");
  assert.equal(readFileSync(historyFile, "utf8"), persisted);
  assert.equal(JSON.stringify(branch), raw);
  console.log("PASS synthetic append/reprojection preserves checkpoint, edited tail, original JSONL and raw recall");

  // Direct source loading only. Package discovery and settled lifecycle are deferred.
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  mkdirSync(join(agentDir, "pi-blackhole"), { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ cacheWarming: "off" }));
  writeFileSync(join(agentDir, "pi-blackhole/pi-blackhole-config.json"), JSON.stringify(config));
  const loaded = await pi.discoverAndLoadExtensions([join(patched, "index.ts")], root, agentDir);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const loadedHook = loaded.extensions[0].handlers.get("session_before_compact")[0];
  const loadedResult = await loadedHook({ ...event, customInstructions: repaired.PI_VCC_COMPACT_INSTRUCTION }, ctx);
  assert.deepEqual(loadedResult, result);
  assert.equal(JSON.parse(read(agentDir, "settings.json")).cacheWarming, "off");
  assert.equal(networkCalls, 0);
  assert.equal(inferenceCalls, 0);
  assert.equal(otherProcesses, 0);
  assert.equal(JSON.stringify(branch), raw);
  console.log("PASS fixtures and isolated Pi loader passed; zero network, inference/auth or subprocess calls");
}
