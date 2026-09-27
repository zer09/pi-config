#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, "..", "npm", "node_modules", "pi-blackhole");
const rel = "src/hooks/before-compact.ts";
const stockHash = "910e44fc74934293e0317eb914ac4ea94976e820043ff4dae0bde915ca5337ab";
const hash = (text) => createHash("sha256").update(text).digest("hex");
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

const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
if (pkg.name !== "pi-blackhole" || pkg.version !== "0.5.8") {
  throw new Error(`Expected pi-blackhole 0.5.8, found ${pkg.name}@${pkg.version}. Port the patch before applying it.`);
}
if (!pkg.pi?.extensions?.includes("./index.ts")) {
  throw new Error("Apply reapply-compact-after-percent-patch.mjs first so Pi loads the patched source entrypoint.");
}

const path = join(packageRoot, rel);
const source = readFileSync(path, "utf8");
let restored = source;
for (const [oldText, newText] of patches) restored = restored.replace(newText, oldText);
if (hash(source) === stockHash) {
  let patched = source;
  for (const [oldText, newText] of patches) {
    if (patched.split(oldText).length !== 2) throw new Error(`Expected one patch anchor in ${rel}.`);
    patched = patched.replace(oldText, newText);
  }
  // Validate the complete file before the only write, not just matching anchors.
  writeFileSync(path, patched);
  console.log(`patched: ${rel}`);
} else if (hash(restored) === stockHash && patches.every(([, text]) => source.split(text).length === 2)) {
  console.log(`already patched: ${rel}`);
} else {
  throw new Error(`Source drift in ${rel}. Expected stock 0.5.8 or this exact patch; no files written.`);
}
console.log("Context-edit compaction patch complete. Restart Pi or run /reload.");
