#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Candidate only. First apply reapply-compact-after-percent-patch-0.5.9.mjs.
// Usage: node reapply-nullable-provider-headers-patch-0.5.9.mjs /tmp/isolated-package
// No default target, live install, dependency loading, or subprocesses.
// Fingerprints come from the registry-SRI-verified pi-blackhole@0.5.9 tarball.
const patches = [
  {
    rel: "src/om/runtime.ts",
    sha256: "a8b7c92eda7d3e03f3a77d99b5ad7459761bb4e0ad44094d486893423b0e48d5",
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
    sha256: "81555068d310423136dbc94555375ee01c9cdf9fce4e98625817dafc5e87c5c6",
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
    ["observer", "b10748549df16b661580b884f5f277eb123bef2fb88525991f1aad9fc37d8427"],
    ["reflector", "d49845ae232eaa881c20121d6c97d3d16f1d8b3d17a09d91a7ec3a9f3fc879fe"],
    ["dropper", "8a7b9d31d4896d131c5697e1a092673e9d58c54d1322c46940015793f537d556"],
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
  ["package.json", "697e544b95730f4a46af31ed96e4985b209246554ef06ac82e41874450712b48"],
  ["src/core/unified-config.ts", "8805209b9c910373288831232abe51e0578ee4004afc2feb72879058a4a2191b"],
  ["src/om/model-budget.ts", "1e57492d628669ea602b822388b3486a27b11a0cb549eba6efaf8cdc54eb8cac"],
  ["src/commands/memory.ts", "b4046e5dbbd422d82d83ae10fc02e57efc241f85b02876c05c0dd85b2c770276"],
  ["index.ts", "4765cc3fd691352bd9b766657b7be89423b28a79de3f756dd63c4b8943770e63"],
  ["src/om/compaction-trigger.ts", "68d5c9fc69a816b9e6705fc554d50ad7d7f3e5282ad129876006241864340db1"],
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
    throw new Error("Supply an explicit isolated pi-blackhole@0.5.9 package directory under the OS temp directory.");
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
  if (pkg.name !== "pi-blackhole" || pkg.version !== "0.5.9") {
    throw new Error("Expected exactly pi-blackhole@0.5.9; no files changed.");
  }
  if (!Array.isArray(pkg.pi?.extensions) || pkg.pi.extensions.length !== 1 || pkg.pi.extensions[0] !== "./index.ts") {
    throw new Error("Apply the accepted 0.5.9 percentage candidate first (pi.extensions must be ['./index.ts']); no files changed.");
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
  if (!plans[0].stock) return "already patched: isolated pi-blackhole@0.5.9 nullable ProviderHeaders";

  for (const plan of plans) writeFileSync(join(root, plan.rel), plan.patched);
  return "patched: isolated pi-blackhole@0.5.9 nullable ProviderHeaders candidate";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper /tmp/isolated-pi-blackhole-0.5.9-package");
  console.log(reapplyNullableProviderHeadersPatch(process.argv[2]));
}
