#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Candidate only. First apply reapply-compact-after-percent-patch-0.5.12.mjs.
// Usage: node reapply-nullable-provider-headers-patch-0.5.12.mjs "$TMPDIR/isolated-package"
// No default target, live install, dependency loading, or subprocesses.
// Fingerprints come from the registry-SRI-verified pi-blackhole@0.5.12 tarball.
const patches = [
  {
    rel: "src/om/runtime.ts",
    sha256: "1d0101aa009a765f96d935d38a21e64ea9a525346479276c67960bf5488198a3",
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
    ["observer", "941b692f1c2c209a8ebeec6dc76f24d6e9142aa7ffd608961ab96d412159526a"],
    ["reflector", "2d724e83e58d54a8a9a90da03cbfaa2b1c93d778e7c0c85e5d35ab007c87cc29"],
    ["dropper", "01cc359acc02ab72967eda730467172ec621f2959980a3d9849f44355110751d"],
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
  ["package.json", "96b015dadfa14ef9acdf0af544d8406f95793f50b977859c3b11e8a2dd95a206"],
  ["src/core/unified-config.ts", "8436e3d785377e36302d4779bd4437f70b3dcf82dbf185193b48518816ec77ce"],
  ["src/om/model-budget.ts", "1e57492d628669ea602b822388b3486a27b11a0cb549eba6efaf8cdc54eb8cac"],
  ["src/commands/memory.ts", "b4046e5dbbd422d82d83ae10fc02e57efc241f85b02876c05c0dd85b2c770276"],
  ["index.ts", "4765cc3fd691352bd9b766657b7be89423b28a79de3f756dd63c4b8943770e63"],
  ["src/om/compaction-trigger.ts", "bd01cb6881beddb1a9f2894d20f471d11a188614851e9999dca4fd52144c39df"],
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
    throw new Error("Supply an explicit isolated pi-blackhole@0.5.12 package directory under the OS temp directory.");
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
  if (pkg.name !== "pi-blackhole" || pkg.version !== "0.5.12") {
    throw new Error("Expected exactly pi-blackhole@0.5.12; no files changed.");
  }
  if (!Array.isArray(pkg.pi?.extensions) || pkg.pi.extensions.length !== 1 || pkg.pi.extensions[0] !== "./index.ts") {
    throw new Error("Apply the accepted 0.5.12 percentage candidate first (pi.extensions must be ['./index.ts']); no files changed.");
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
  if (!plans[0].stock) return "already patched: isolated pi-blackhole@0.5.12 nullable ProviderHeaders";

  for (const plan of plans) writeFileSync(join(root, plan.rel), plan.patched);
  return "patched: isolated pi-blackhole@0.5.12 nullable ProviderHeaders candidate";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper $TMPDIR/isolated-pi-blackhole-0.5.12-package");
  console.log(reapplyNullableProviderHeadersPatch(process.argv[2]));
}
