#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Candidate only. Apply the accepted percentage and nullable-header candidates first.
// Usage: node reapply-context-edit-compaction-patch-0.5.13.mjs "$TMPDIR/isolated-package"
// No default target, live install, dependency loading, or subprocesses.
const rel = "src/hooks/before-compact.ts";
// The SRI-verified 0.5.13 hook still has the accepted 0.5.9 stock bytes.
const stockHash = "910e44fc74934293e0317eb914ac4ea94976e820043ff4dae0bde915ca5337ab";
const patchedHash = "0898de0d68af964968087a18741c69b4211dc5289d7c685422c8e632fcbbcf1b";
const patches = [
  // AgentMessage also includes non-editable messages without a content field.
  [
    "  message: { role: string; content: unknown };",
    "  message: { role: string; content?: unknown };",
  ],
  [
    'import { convertToLlm } from "@earendil-works/pi-coding-agent";',
    'import { buildSessionProjection, convertToLlm } from "@earendil-works/pi-coding-agent";',
  ],
  [
    "  // Minimal normally cuts at the last user message.",
    `  // Apply only edits selected by Pi's active projection. Keep the raw window,
  // system checkpoints and non-editable messages on Blackhole's existing path.
  // This changes fresh summary input, never stored history or earlier memory.
  const omittedIds = new Set<string>();
  if (branchEntries.some((e) => e.type === "context_edit")) {
    const projection = buildSessionProjection(branchEntries);
    const editedIds = new Set(
      projection.entries.flatMap(({ sourceEntry }) =>
        sourceEntry.type === "context_edit" ? [sourceEntry.targetId] : [],
      ),
    );
    const projectedById = new Map(
      projection.entries.map(({ sourceEntry, messages }) => [sourceEntry.id, messages]),
    );
    for (let i = liveMessages.length - 1; i >= 0; i--) {
      const { entry, message } = liveMessages[i];
      if (!editedIds.has(entry.id)) continue;
      if (!["user", "assistant", "toolResult"].includes(message.role)) continue;
      const projected = projectedById.get(entry.id)?.[0];
      if (projected) liveMessages[i] = { entry, message: projected };
      else {
        omittedIds.add(entry.id);
        liveMessages.splice(i, 1);
      }
    }
  }

  // Minimal normally cuts at the last user message.`,
  ],
  [
    '          (e: any, i: number) => i > cutInBranch && e.type === "message" && e.message,',
    `          (e: any, i: number) =>
            i > cutInBranch && e.type === "message" && e.message && !omittedIds.has(e.id),`,
  ],
];

// Pin both complete prerequisites, including the percentage candidate's unchanged guards.
const prerequisites = [
  ["package.json", "f9dfa09d0318605432a05356b38f478ca87eb1d2b493fc4eb23c87f1acc360c8"],
  ["src/core/unified-config.ts", "c656474a0f83755063ae8c9eeccb37a5e60bb73d504400d9e5ff63d1c8dc2da0"],
  ["src/om/model-budget.ts", "1e57492d628669ea602b822388b3486a27b11a0cb549eba6efaf8cdc54eb8cac"],
  ["src/commands/memory.ts", "b4046e5dbbd422d82d83ae10fc02e57efc241f85b02876c05c0dd85b2c770276"],
  ["index.ts", "61d103503ccfb3836391ddb539ccfa18c6c495376981e4ce5997a8ae40871805"],
  ["src/om/compaction-trigger.ts", "03bd6e8d7c3ed9ff19c532423cab2287be458564018445eaa6af02ac446b8bc2"],
  ["src/om/runtime.ts", "e9c0d4f61d4bcfe48c5239d25387a4f7e42f2e605f3ed2fa96a9f7086e6517e7"],
  ["src/om/provider-stream.ts", "a8ac21e75f7ab08d77acbde8ed431bed0ad2a7dad3deee90119709f9fc6ed0c3"],
  ["src/om/agents/observer/agent.ts", "1fb9c7a6459b92cb2c56f1e7d6953dfaa2b4556a33fe4f22da48cc30e3927e13"],
  ["src/om/agents/reflector/agent.ts", "197c5a8b39d78bfaa9eeff8af910287784374168aeae4de6814e640c31d53df6"],
  ["src/om/agents/dropper/agent.ts", "e4fb2257130666e53c604786c6e649adf38de5c986b41c82ca6a21955973f0e1"],
];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function isWithin(parent, path) {
  const rel = relative(parent, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function readIsolatedFile(root, rel) {
  const path = join(root, rel);
  const stat = lstatSync(path);
  // Reject shared files and linked parents before reading or writing a candidate.
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) {
    throw new Error(`Expected an unlinked regular file: ${rel}`);
  }
  return readFileSync(path, "utf8");
}

function replaceUnique(content, oldText, newText) {
  if (content.split(oldText).length !== 2) {
    throw new Error(`Mixed, partial, duplicate, or drifted patch anchor in ${rel}`);
  }
  return content.replace(oldText, newText);
}

export function reapplyContextEditCompactionPatch(target) {
  if (typeof target !== "string" || target.trim() === "") {
    throw new Error("Supply an explicit isolated pi-blackhole@0.5.13 package directory under the OS temp directory.");
  }
  const root = resolve(target);
  const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  if (
    realpathSync(root) !== root ||
    !isWithin(realpathSync(tmpdir()), root) ||
    root === repository || isWithin(repository, root) ||
    root.split(sep).includes("node_modules")
  ) {
    throw new Error("Refusing a non-isolated target; use an unlinked extracted package under the OS temp directory.");
  }

  const manifest = readIsolatedFile(root, "package.json");
  const pkg = JSON.parse(manifest);
  if (pkg.name !== "pi-blackhole" || pkg.version !== "0.5.13") {
    throw new Error("Expected exactly pi-blackhole@0.5.13; no files changed.");
  }
  if (!Array.isArray(pkg.pi?.extensions) || pkg.pi.extensions.length !== 1 || pkg.pi.extensions[0] !== "./index.ts") {
    throw new Error("Apply the accepted 0.5.13 percentage candidate first (pi.extensions must be ['./index.ts']); no files changed.");
  }

  // Preflight every prerequisite, hook byte and anchor before the only write.
  // Mixed and partial candidates are rejected, never repaired.
  for (const [file, expected] of prerequisites) {
    const content = file === "package.json" ? manifest : readIsolatedFile(root, file);
    if (sha256(content) !== expected) throw new Error(`Drifted percentage/header prerequisite: ${file}`);
  }
  const source = readIsolatedFile(root, rel);
  const stock = sha256(source) === stockHash;
  let original = source;
  if (!stock) {
    for (const [oldText, newText] of [...patches].reverse()) {
      original = replaceUnique(original, newText, oldText);
    }
    if (sha256(original) !== stockHash) throw new Error(`Drifted file: ${rel}`);
  }
  let patched = original;
  for (const [oldText, newText] of patches) patched = replaceUnique(patched, oldText, newText);
  if (sha256(patched) !== patchedHash || (!stock && patched !== source)) {
    throw new Error(`Mixed or drifted patch state: ${rel}`);
  }
  if (!stock) return `already patched: isolated pi-blackhole@0.5.13 ${rel}`;

  writeFileSync(join(root, rel), patched);
  return `patched: isolated pi-blackhole@0.5.13 context-edit compaction candidate (${rel})`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper $TMPDIR/isolated-pi-blackhole-0.5.13-package");
  console.log(reapplyContextEditCompactionPatch(process.argv[2]));
}
