#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Candidate only. First apply reapply-compact-after-percent-patch-0.5.15.mjs.
// Usage: node reapply-nullable-provider-headers-patch-0.5.15.mjs "$TMPDIR/isolated-package"
// No default target, live install, dependency loading, or subprocesses.
// Fingerprints come from the registry-SRI-verified pi-blackhole@0.5.15 tarball.
const patches = [
  {
    rel: "src/om/runtime.ts",
    sha256: "9a5f2acdf23ddf2bc8bb221ed23d7130c47707e86595e2707e3c722248a67edf",
    edits: [
      [
        `import type { AuthResult } from "@earendil-works/pi-ai";`,
        `import type { AuthResult, ProviderHeaders } from "@earendil-works/pi-ai";`,
      ],
      [`  headers?: Record<string, string>;`, `  headers?: ProviderHeaders;`],
      [
        `        headers: auth.headers as Record<string, string> | undefined,`,
        `        headers: auth.headers,`,
        2,
      ],
    ],
  },
  {
    rel: "src/om/provider-stream.ts",
    sha256: "f87b6f7435f2e6a22ddf1940cc9c94c4fd74b44717464e9adf48c3ac7730e08b",
    edits: [
      [
        `interface RegisteredProviderConfig {`,
        `import type { ProviderHeaders } from "@earendil-works/pi-ai";\n\ninterface RegisteredProviderConfig {`,
      ],
      [
        `  headers: Record<string, string> | undefined,\n  sessionId: string | undefined,\n): Record<string, string> | undefined {`,
        `  headers: ProviderHeaders | undefined,\n  sessionId: string | undefined,\n): ProviderHeaders | undefined {`,
      ],
      [
        `export type AttributionTransform = (\n  headers: Record<string, string>,\n) => Record<string, string> | Promise<Record<string, string>>;`,
        `export type AttributionTransform = (\n  headers: ProviderHeaders,\n) => ProviderHeaders | Promise<ProviderHeaders>;`,
      ],
      [
        `  return async (headers: Record<string, string>) => {`,
        `  return async (headers: ProviderHeaders) => {`,
      ],
    ],
  },
  ...[
    ["observer", "b7da719bd2c43253fdbca56cf78e013776b63f28599ff91c6516e1c496d0196e"],
    ["reflector", "0a9baca0adadcf8dbacde4b68ac5f7797f2f45c5c1860b2494b1c9149a7bd3ae"],
    ["dropper", "1413d112c78b180de002596395ef44e3c1cb2d550b44c035cc28f0626bbc2ff3"],
  ].map(([stage, sha256]) => ({
    rel: `src/om/agents/${stage}/agent.ts`,
    sha256,
    edits: [
      [
        `import type { CacheRetention, Message, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";`,
        `import type {\n  CacheRetention,\n  Message,\n  Model,\n  ModelThinkingLevel,\n  ProviderHeaders,\n} from "@earendil-works/pi-ai";`,
      ],
      [`  headers?: Record<string, string>;`, `  headers?: ProviderHeaders;`],
    ],
  })),
];

// Require the complete accepted percentage candidate, not just a manually changed entrypoint.
const prerequisites = [
  ["package.json", "6f24eea7e887cffa5937b68bfb7708908d4b4f158809a93d2c636b8c7b35732f"],
  ["src/core/unified-config.ts", "3c3ac82c39b14585067a5628dcec27e00937192ac24f53570169567125dbeb0b"],
  ["src/om/model-budget.ts", "1e57492d628669ea602b822388b3486a27b11a0cb549eba6efaf8cdc54eb8cac"],
  ["src/commands/memory.ts", "992d30725b044b4021d2589fd29767bdff4ef1abeb6a81d325e91e87e4b409f6"],
  ["index.ts", "fd386003c4f88da2ca25c0de97042294ed4b8b6621cf3ce550180b58621b0637"],
  ["src/om/compaction-trigger.ts", "03bd6e8d7c3ed9ff19c532423cab2287be458564018445eaa6af02ac446b8bc2"],
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

function replaceExact(content, oldText, newText, count, rel) {
  if (content.split(oldText).length - 1 !== count) {
    throw new Error(`Mixed, partial, duplicate, or drifted patch anchor in ${rel}`);
  }
  return content.replaceAll(oldText, newText);
}

function planPatch(patch, content) {
  const stock = sha256(content) === patch.sha256;
  let original = content;
  if (!stock) {
    // Reverse only in memory; a complete patch must restore the published bytes.
    for (const [oldText, newText, count = 1] of [...patch.edits].reverse()) {
      original = replaceExact(original, newText, oldText, count, patch.rel);
    }
    if (sha256(original) !== patch.sha256) throw new Error(`Drifted file: ${patch.rel}`);
  }
  let patched = original;
  for (const [oldText, newText, count = 1] of patch.edits) {
    patched = replaceExact(patched, oldText, newText, count, patch.rel);
  }
  if (!stock && patched !== content) throw new Error(`Mixed patch state: ${patch.rel}`);
  return { rel: patch.rel, stock, patched };
}

export function reapplyNullableProviderHeadersPatch(target) {
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

  // Preflight all prerequisites, affected files, and anchors before ANY write.
  // Mixed and partial patch sets are rejected, never repaired.
  for (const [rel, expected] of prerequisites) {
    const content = rel === "package.json" ? manifest : readIsolatedFile(root, rel);
    if (sha256(content) !== expected) throw new Error(`Drifted percentage prerequisite: ${rel}`);
  }
  const plans = patches.map((patch) => planPatch(patch, readIsolatedFile(root, patch.rel)));
  if (new Set(plans.map((plan) => plan.stock)).size !== 1) {
    throw new Error("Mixed stock and patched files; no files changed.");
  }
  if (!plans[0].stock) return "already patched: isolated pi-blackhole@0.5.15 nullable ProviderHeaders";

  for (const plan of plans) writeFileSync(join(root, plan.rel), plan.patched);
  return "patched: isolated pi-blackhole@0.5.15 nullable ProviderHeaders candidate";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper $TMPDIR/isolated-pi-blackhole-0.5.15-package");
  console.log(reapplyNullableProviderHeadersPatch(process.argv[2]));
}
