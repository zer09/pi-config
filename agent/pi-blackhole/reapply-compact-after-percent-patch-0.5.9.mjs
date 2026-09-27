#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Candidate only: no default target, live install, dependency loading, or subprocesses.
// Usage: node reapply-compact-after-percent-patch-0.5.9.mjs /tmp/isolated-package
// Fingerprints come from the registry-SRI-verified pi-blackhole@0.5.9 tarball.
const patches = [
  {
    rel: "src/core/unified-config.ts",
    sha256: "2b61f9797a7299d98edbe9dca496d739b9552a72e5b9611d282d49c98ca9b21e",
    edits: [
      [
        `  compactAfterTokens?: number;\n  /**\n   * Context-window-derived auto-compaction threshold (issue #60):`,
        `  compactAfterTokens?: number;\n  /** Local compatibility knob: derive from the active model's declared context\n   *  window, but fall back to compactAfterTokens when that declaration is absent. */\n  compactAfterPercent?: number;\n  /**\n   * Context-window-derived auto-compaction threshold (issue #60):`,
      ],
      [
        `  if (!isWindowRatio(rec.compactAfterRatio)) {\n    delete rec.compactAfterRatio;\n  }`,
        `  if (!isWindowRatio(rec.compactAfterPercent)) {\n    delete rec.compactAfterPercent;\n  }\n  if (!isWindowRatio(rec.compactAfterRatio)) {\n    delete rec.compactAfterRatio;\n  }`,
      ],
      [
        `    "compactAfterTokens",\n    "compactAfterRatio",`,
        `    "compactAfterTokens",\n    "compactAfterPercent",\n    "compactAfterRatio",`,
      ],
    ],
  },
  {
    rel: "src/om/model-budget.ts",
    sha256: "4b185043ead81f74d3a682fe88430c76f8e0d4b6cc72ffc2a2754f6fa8315645",
    edits: [
      [
        `export interface CompactThresholdConfig {\n  compactAfterTokens?: number;\n  compactAfterRatio?: number;`,
        `export interface CompactThresholdConfig {\n  compactAfterTokens?: number;\n  /** Local compatibility knob with a fixed-token fallback when the active model\n   *  does not declare a usable contextWindow. */\n  compactAfterPercent?: number;\n  compactAfterRatio?: number;`,
      ],
      [
        `/**\n * Effective context window for the session model: honors a per-model config`,
        `/** Return only a context window declared by the active model itself. */\nexport function directSessionContextWindow(model: Model<any> | undefined): number | undefined {\n  const contextWindow = model?.contextWindow;\n  return typeof contextWindow === "number" &&\n    Number.isFinite(contextWindow) &&\n    contextWindow > 0\n    ? Math.floor(contextWindow)\n    : undefined;\n}\n\n/**\n * Effective context window for the session model: honors a per-model config`,
      ],
      [
        `export function autoCompactThreshold(\n  cfg: CompactThresholdConfig & SessionWindowConfig,\n  model: Model<any> | undefined,\n): number {\n  return compactThresholdTokens(cfg, sessionContextWindow(model, cfg));\n}`,
        `export function autoCompactThreshold(\n  cfg: CompactThresholdConfig & SessionWindowConfig,\n  model: Model<any> | undefined,\n): number {\n  if (isWindowRatio(cfg.compactAfterPercent)) {\n    const contextWindow = directSessionContextWindow(model);\n    if (contextWindow !== undefined) {\n      return Math.max(1, Math.floor(contextWindow * cfg.compactAfterPercent));\n    }\n    if (isFixedTokenThreshold(cfg.compactAfterTokens)) {\n      return cfg.compactAfterTokens;\n    }\n  }\n  return compactThresholdTokens(cfg, sessionContextWindow(model, cfg));\n}`,
      ],
    ],
  },
  {
    rel: "src/commands/memory.ts",
    sha256: "911797b6657cde91ab400089f08f4d8b29f25e41bf7c39f26c4dcbb5e6c90541",
    edits: [
      [
        `  autoCompactThreshold,\n  effectivePresets,`,
        `  autoCompactThreshold,\n  directSessionContextWindow,\n  effectivePresets,`,
      ],
      [
        `function compactThresholdSuffix(cfg: CompactThresholdConfig, window: number): string {\n  // Validity (not mere presence) decides the tier — mirrors compactThresholdTokens\n  // so display and trigger cannot disagree, even for unnormalized configs.\n  if (isFixedTokenThreshold(cfg.compactAfterTokens)) return ""; // explicit fixed token threshold`,
        `function compactThresholdSuffix(cfg: CompactThresholdConfig, model: any, window: number): string {\n  // compactAfterPercent precedes the fixed fallback and uses only the active\n  // model's declaration, matching autoCompactThreshold().\n  if (isWindowRatio(cfg.compactAfterPercent)) {\n    const directWindow = directSessionContextWindow(model);\n    if (directWindow !== undefined) {\n      return \` · \${Math.round(cfg.compactAfterPercent * 100)}% of \${directWindow.toLocaleString()}-token window\`;\n    }\n    if (isFixedTokenThreshold(cfg.compactAfterTokens)) return "";\n  }\n  // Match the native tiers when the local percentage does not apply.\n  if (isFixedTokenThreshold(cfg.compactAfterTokens)) return ""; // explicit fixed token threshold`,
      ],
      [
        `compactThresholdSuffix(runtime.config, sessionContextWindow(ctx.model, runtime.config))`,
        `compactThresholdSuffix(runtime.config, ctx.model, sessionContextWindow(ctx.model, runtime.config))`,
      ],
    ],
  },
  {
    rel: "package.json",
    sha256: "3318dc8ee2cc4081edffa1369ea24738fd765c45952967e941b165a5cbcc4a21",
    edits: [
      [
        `  "pi": {\n    "extensions": [\n      "./dist/index.js"\n    ]\n  }`,
        `  "pi": {\n    "extensions": [\n      "./index.ts"\n    ]\n  }`,
      ],
    ],
  },
];

// The source entrypoint and both trigger call sites must still be the audited stock code.
const unchangedFiles = [
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
  // A copied candidate must not write through a symlink or hard link into a live package.
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path) {
    throw new Error(`Expected an unlinked regular file: ${rel}`);
  }
  return readFileSync(path, "utf8");
}

function replaceUnique(content, oldText, newText, rel) {
  if (content.split(oldText).length !== 2) {
    throw new Error(`Mixed, duplicate, or drifted patch anchor in ${rel}`);
  }
  return content.replace(oldText, newText);
}

function planPatch(patch, content) {
  const stock = sha256(content) === patch.sha256;
  let original = content;
  if (!stock) {
    // Undo only in memory. Every replacement must restore the exact published file.
    for (const [oldText, newText] of [...patch.edits].reverse()) {
      original = replaceUnique(original, newText, oldText, patch.rel);
    }
    if (sha256(original) !== patch.sha256) {
      throw new Error(`Drifted file: ${patch.rel}`);
    }
  }
  let patched = original;
  for (const [oldText, newText] of patch.edits) {
    patched = replaceUnique(patched, oldText, newText, patch.rel);
  }
  if (!stock && patched !== content) throw new Error(`Mixed patch state: ${patch.rel}`);
  return { rel: patch.rel, stock, patched };
}

export function reapplyCompactAfterPercentPatch(target) {
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

  // Preflight every file and anchor before the first write. Partial patch sets are not repaired.
  const plans = patches.map((patch) => planPatch(
    patch,
    patch.rel === "package.json" ? manifest : readIsolatedFile(root, patch.rel),
  ));
  for (const [rel, expected] of unchangedFiles) {
    if (sha256(readIsolatedFile(root, rel)) !== expected) throw new Error(`Drifted file: ${rel}`);
  }
  if (new Set(plans.map((plan) => plan.stock)).size !== 1) {
    throw new Error("Mixed stock and patched files; no files changed.");
  }
  if (!plans[0].stock) return "already patched: isolated pi-blackhole@0.5.9";

  for (const plan of plans) writeFileSync(join(root, plan.rel), plan.patched);
  return "patched: isolated pi-blackhole@0.5.9 compactAfterPercent candidate";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: helper /tmp/isolated-pi-blackhole-0.5.9-package");
  console.log(reapplyCompactAfterPercentPatch(process.argv[2]));
}
