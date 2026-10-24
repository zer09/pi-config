#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Isolated preparation only. Apply the accepted percentage and header helpers first.
// Usage: node reapply-context-edit-compaction-patch-0.5.15.mjs "$TMPDIR/isolated-package"
// No default target, live install, dependency loading, or subprocesses.
const rel = "src/hooks/before-compact.ts";
const stockHash = "8bf4a1eeb40fe2016b911aaa1b0f178d9a53da594644bbe0f7e69cdf0e83afaa";
const patchedHash = "b9f771eb57d8d0580ced08553a5241d72c478f9b0632db21e8b0873381fdc823";
const patches = [
  [
    'import { convertToLlm, estimateTokens } from "@earendil-works/pi-coding-agent";',
    'import { buildSessionProjection, convertToLlm, estimateTokens } from "@earendil-works/pi-coding-agent";',
  ],
  [
    'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
    'import type { ExtensionAPI, SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";',
  ],
  [
    '  entry: { id: string; type: string };\n  message: { role: string; content: unknown };',
    '  entry: SessionMessageEntry;\n  message: SessionMessageEntry["message"];',
  ],
  [
    'export type OwnCutCancelReason =',
    `// Keep raw entries as the source of identity and ledger coverage. Only fresh
// summary messages use Pi's selected edits, never earlier summaries or recall.
function projectFreshSummaryMessages(branchEntries: any[], entries: any[]): EntryWithMessage[] {
  let editedIds = new Set<string>();
  let projectedById = new Map<string, SessionMessageEntry["message"][]>();
  if (branchEntries.some((entry) => entry.type === "context_edit")) {
    const projection = buildSessionProjection(branchEntries);
    editedIds = new Set(
      projection.entries.flatMap(({ sourceEntry }) =>
        sourceEntry.type === "context_edit" ? [sourceEntry.targetId] : [],
      ),
    );
    projectedById = new Map(
      projection.entries.map(({ sourceEntry, messages }) => [sourceEntry.id, messages]),
    );
  }
  return entries.flatMap((entry) => {
    if (entry.type !== "message" || !entry.message) return [];
    let message = entry.message;
    if (editedIds.has(entry.id) && ["user", "assistant", "toolResult"].includes(message.role)) {
      message = projectedById.get(entry.id)?.[0];
      if (!message) return [];
    }
    return [{ entry, message }];
  });
}

export type OwnCutCancelReason =`,
  ],
  [
    `    const messages = branchEntries
      .slice(liveStart)
      .filter((entry) => entry.type === "message" && entry.message);`,
    `    const messages = projectFreshSummaryMessages(branchEntries, branchEntries.slice(liveStart));`,
  ],
  [
    '    let cut = messages.findIndex((entry) => branchEntries.indexOf(entry) > boundary);',
    '    let cut = messages.findIndex(({ entry }) => branchEntries.indexOf(entry) > boundary);',
  ],
  [
    '!isToolSafeCut(branchEntries, branchEntries.indexOf(messages[cut])))',
    '!isToolSafeCut(branchEntries, branchEntries.indexOf(messages[cut].entry)))',
  ],
  [
    `      selectedIds: messages.slice(0, cut).map((entry) => entry.id),`,
    `      selectedIds: messages.slice(0, cut).map(({ entry }) => entry.id),`,
  ],
  [
    `            index < branchEntries.indexOf(messages[cut]) &&
            isSourceEntry(entry),
        )?.id ?? messages[cut].id,`,
    `            index < branchEntries.indexOf(messages[cut].entry) &&
            isSourceEntry(entry) &&
            (entry.type !== "message" || messages.some((message) => message.entry === entry)),
        )?.id ?? messages[cut].entry.id,`,
  ],
  [
    '  const liveMessages: EntryWithMessage[] = [];',
    '  let liveMessages: EntryWithMessage[] = [];',
  ],
  [
    '  // Minimal normally cuts at the last user message. If Pi found a later safe',
    `  const projected = projectFreshSummaryMessages(branchEntries, liveMessages.map(({ entry }) => entry));
  const visibleIds = new Set(projected.map(({ entry }) => entry.id));
  const omittedIds = new Set(liveMessages.filter(({ entry }) => !visibleIds.has(entry.id)).map(({ entry }) => entry.id));
  liveMessages = projected;

  // Minimal normally cuts at the last user message. If Pi found a later safe`,
  ],
  [
    '          (e: any, i: number) => i > cutInBranch && e.type === "message" && e.message,',
    `          (e: any, i: number) =>
            i > cutInBranch && e.type === "message" && e.message && !omittedIds.has(e.id),`,
  ],
  [
    '    const pressureEnabled = omRuntime.config.contextPressureFallback === "vcc";',
    `    const summaryMessages = projectFreshSummaryMessages(branchEntries, branchEntries);
    const summaryById = new Map(summaryMessages.map(({ entry, message }) => [entry.id, message]));
    const projectedCustomById = new Map(
      branchEntries.some((entry) => entry.type === "context_edit")
        ? buildSessionProjection(branchEntries).entries
            .filter(({ sourceEntry }) => sourceEntry.type === "custom_message")
            .map(({ sourceEntry, messages }) => [sourceEntry.id, messages])
        : [],
    );
    // Capacity includes custom context, but fresh summaries stay message-only.
    // Empty content keeps omitted custom IDs available as raw cut anchors.
    const summaryEntries = branchEntries.flatMap<SessionEntry>((entry) => {
      if (entry.type === "custom_message" && projectedCustomById.has(entry.id)) {
        const message = projectedCustomById.get(entry.id)?.[0];
        return [{ ...entry, content: message?.role === "custom" ? message.content : [] }];
      }
      if (entry.type !== "message") return [entry];
      const message = summaryById.get(entry.id);
      return message ? [{ ...entry, message }] : [];
    });
    const pressureEnabled = omRuntime.config.contextPressureFallback === "vcc";`,
  ],
  [
    `        return branchEntries.filter(
          (entry, index) =>
            entry.type === "message" &&
            (originalSelected.has(entry.id) ||
              (preferredIndex >= 0 && index >= preferredIndex && index < end)),
        );`,
    `        return summaryMessages.filter(({ entry }) => {
          const index = branchEntries.indexOf(entry);
          return originalSelected.has(entry.id) ||
            (preferredIndex >= 0 && index >= preferredIndex && index < end);
        });`,
  ],
  [
    '        entries: branchEntries,',
    '        entries: summaryEntries,',
  ],
  [
    `          const messages = sources.flatMap((entry) =>
            entry.type === "message" ? convertToLlm([entry.message]) : [],
          );`,
    `          const messages = sources.flatMap(({ message }) => convertToLlm([message]));`,
  ],
  [
    `          messages: selected.flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
          selectedIds: selected.map((entry) => entry.id),`,
    `          messages: selected.map(({ message }) => message),
          selectedIds: selected.map(({ entry }) => entry.id),`,
  ],
  [
    '    const keptChars = keptEntries.reduce((sum: number, e: any) => {',
    `    const summaryKeptIdx = summaryEntries.findIndex((entry) => entry.id === firstKeptEntryId);
    const summaryTailEntries = summaryKeptIdx >= 0 ? summaryEntries.slice(summaryKeptIdx) : [];
    const keptChars = keptEntries.reduce((sum: number, e: any) => {`,
  ],
  [
    `        (keptIdx >= 0 ? branchEntries.slice(keptIdx) : []).reduce(
          (total, entry) => total + estimateEntryTokens(entry),
          0,
        );`,
    `        summaryTailEntries.reduce((total, entry) => total + estimateEntryTokens(entry), 0);`,
    2,
  ],
  [
    `      const rawTokens = (keptIdx >= 0 ? branchEntries.slice(keptIdx) : []).reduce(`,
    `      const rawTokens = summaryTailEntries.reduce(`,
  ],
];

// Pin both complete prerequisites, including their unchanged entry/trigger guards.
const prerequisites = [
  ["package.json", "6f24eea7e887cffa5937b68bfb7708908d4b4f158809a93d2c636b8c7b35732f"],
  ["src/core/unified-config.ts", "3c3ac82c39b14585067a5628dcec27e00937192ac24f53570169567125dbeb0b"],
  ["src/om/model-budget.ts", "1e57492d628669ea602b822388b3486a27b11a0cb549eba6efaf8cdc54eb8cac"],
  ["src/commands/memory.ts", "992d30725b044b4021d2589fd29767bdff4ef1abeb6a81d325e91e87e4b409f6"],
  ["index.ts", "fd386003c4f88da2ca25c0de97042294ed4b8b6621cf3ce550180b58621b0637"],
  ["src/om/compaction-trigger.ts", "03bd6e8d7c3ed9ff19c532423cab2287be458564018445eaa6af02ac446b8bc2"],
  ["src/om/runtime.ts", "cc069e93cc31c3ecdbcf41b4a937fc785ff91cc035463533edcb598273f1f3ab"],
  ["src/om/provider-stream.ts", "a8ac21e75f7ab08d77acbde8ed431bed0ad2a7dad3deee90119709f9fc6ed0c3"],
  ["src/om/agents/observer/agent.ts", "52040416b3d459a18e1298b108a2eb2e257f5471ae56e2f154dfba3a5f408ae5"],
  ["src/om/agents/reflector/agent.ts", "6c718611adc60b9e92f5e6a4d831e617997b119b7d9dd7bf0e7e82b359ff9cd0"],
  ["src/om/agents/dropper/agent.ts", "8beab0c5cc7c134c8c17af2a983f9b39b4ae3d832b73989b99a10fe93d1f7dec"],
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
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) {
    throw new Error(`Expected an unlinked regular file: ${rel}`);
  }
  return readFileSync(path, "utf8");
}
function replaceUnique(content, oldText, newText, count = 1) {
  if (content.split(oldText).length !== count + 1) {
    throw new Error(`Mixed, partial, duplicate, or drifted patch anchor in ${rel}`);
  }
  return content.replaceAll(oldText, newText);
}
export function reapplyContextEditCompactionPatch(target) {
  if (typeof target !== "string" || target.trim() === "") {
    throw new Error("Supply an explicit isolated pi-blackhole@0.5.15 package directory under the OS temp directory.");
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
  if (pkg.name !== "pi-blackhole" || pkg.version !== "0.5.15") {
    throw new Error("Expected exactly pi-blackhole@0.5.15; no files changed.");
  }
  if (!Array.isArray(pkg.pi?.extensions) || pkg.pi.extensions.length !== 1 || pkg.pi.extensions[0] !== "./index.ts") {
    throw new Error("Apply the accepted 0.5.15 percentage candidate first (pi.extensions must be ['./index.ts']); no files changed.");
  }
  // Preflight all prerequisites and hook bytes before the only write.
  for (const [file, expected] of prerequisites) {
    const content = file === "package.json" ? manifest : readIsolatedFile(root, file);
    if (sha256(content) !== expected) throw new Error(`Drifted percentage/header prerequisite: ${file}`);
  }
  const source = readIsolatedFile(root, rel);
  const stock = sha256(source) === stockHash;
  let original = source;
  if (!stock) {
    for (const [oldText, newText, count] of [...patches].reverse()) original = replaceUnique(original, newText, oldText, count);
    if (sha256(original) !== stockHash) throw new Error(`Drifted file: ${rel}`);
  }
  let patched = original;
  for (const [oldText, newText, count] of patches) patched = replaceUnique(patched, oldText, newText, count);
  if (sha256(patched) !== patchedHash || (!stock && patched !== source)) {
    throw new Error(`Mixed or drifted patch state: ${rel}`);
  }
  if (!stock) return `already patched: isolated pi-blackhole@0.5.15 ${rel}`;
  writeFileSync(join(root, rel), patched);
  return `patched: isolated pi-blackhole@0.5.15 context-edit compaction candidate (${rel})`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper $TMPDIR/isolated-pi-blackhole-0.5.15-package");
  console.log(reapplyContextEditCompactionPatch(process.argv[2]));
}
