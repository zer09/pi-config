#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, "..", "npm", "node_modules", "pi-blackhole");

function readRel(rel) {
  return readFileSync(join(packageRoot, rel), "utf8");
}

function replaceOnce(rel, oldText, newText) {
  const path = join(packageRoot, rel);
  let content = readFileSync(path, "utf8");
  if (content.includes(newText)) {
    console.log(`already patched: ${rel}`);
    return;
  }
  if (!content.includes(oldText)) {
    throw new Error(`Patch anchor not found in ${rel}. pi-blackhole changed; port patch manually.`);
  }
  content = content.replace(oldText, newText);
  writeFileSync(path, content);
  console.log(`patched: ${rel}`);
}

if (!existsSync(packageRoot)) {
  throw new Error(`pi-blackhole package not found at ${packageRoot}`);
}

const packageJson = JSON.parse(readRel("package.json"));
if (packageJson.version !== "0.5.8") {
  throw new Error(`Expected pi-blackhole 0.5.8, found ${packageJson.version ?? "unknown"}. Port the patch before applying it.`);
}

replaceOnce(
  "src/core/unified-config.ts",
  `  compactAfterTokens?: number;\n  /**\n   * Context-window-derived auto-compaction threshold (issue #60):`,
  `  compactAfterTokens?: number;\n  /** Local compatibility knob: derive from the active model's declared context\n   *  window, but fall back to compactAfterTokens when that declaration is absent. */\n  compactAfterPercent?: number;\n  /**\n   * Context-window-derived auto-compaction threshold (issue #60):`,
);

replaceOnce(
  "src/core/unified-config.ts",
  `  if (!isWindowRatio(rec.compactAfterRatio)) {\n    delete rec.compactAfterRatio;\n  }`,
  `  if (!isWindowRatio(rec.compactAfterPercent)) {\n    delete rec.compactAfterPercent;\n  }\n  if (!isWindowRatio(rec.compactAfterRatio)) {\n    delete rec.compactAfterRatio;\n  }`,
);

replaceOnce(
  "src/core/unified-config.ts",
  `    "compactAfterTokens",\n    "compactAfterRatio",`,
  `    "compactAfterTokens",\n    "compactAfterPercent",\n    "compactAfterRatio",`,
);

replaceOnce(
  "src/om/model-budget.ts",
  `export interface CompactThresholdConfig {\n  compactAfterTokens?: number;\n  compactAfterRatio?: number;`,
  `export interface CompactThresholdConfig {\n  compactAfterTokens?: number;\n  /** Local compatibility knob with a fixed-token fallback when the active model\n   *  does not declare a usable contextWindow. */\n  compactAfterPercent?: number;\n  compactAfterRatio?: number;`,
);

replaceOnce(
  "src/om/model-budget.ts",
  `/**\n * Effective context window for the session model: honors a per-model config`,
  `/** Return only a context window declared by the active model itself. */\nexport function directSessionContextWindow(model: Model<any> | undefined): number | undefined {\n  const contextWindow = model?.contextWindow;\n  return typeof contextWindow === "number" &&\n    Number.isFinite(contextWindow) &&\n    contextWindow > 0\n    ? Math.floor(contextWindow)\n    : undefined;\n}\n\n/**\n * Effective context window for the session model: honors a per-model config`,
);

replaceOnce(
  "src/om/model-budget.ts",
  `export function autoCompactThreshold(\n  cfg: CompactThresholdConfig & SessionWindowConfig,\n  model: Model<any> | undefined,\n): number {\n  return compactThresholdTokens(cfg, sessionContextWindow(model, cfg));\n}`,
  `export function autoCompactThreshold(\n  cfg: CompactThresholdConfig & SessionWindowConfig,\n  model: Model<any> | undefined,\n): number {\n  if (isWindowRatio(cfg.compactAfterPercent)) {\n    const contextWindow = directSessionContextWindow(model);\n    if (contextWindow !== undefined) {\n      return Math.max(1, Math.floor(contextWindow * cfg.compactAfterPercent));\n    }\n    if (isFixedTokenThreshold(cfg.compactAfterTokens)) {\n      return cfg.compactAfterTokens;\n    }\n  }\n  return compactThresholdTokens(cfg, sessionContextWindow(model, cfg));\n}`,
);

replaceOnce(
  "src/commands/memory.ts",
  `  autoCompactThreshold,\n  effectivePresets,`,
  `  autoCompactThreshold,\n  directSessionContextWindow,\n  effectivePresets,`,
);

replaceOnce(
  "src/commands/memory.ts",
  `function compactThresholdSuffix(cfg: CompactThresholdConfig, window: number): string {\n  // Validity (not mere presence) decides the tier — mirrors compactThresholdTokens\n  // so display and trigger cannot disagree, even for unnormalized configs.\n  if (isFixedTokenThreshold(cfg.compactAfterTokens)) return ""; // explicit fixed token threshold`,
  `function compactThresholdSuffix(cfg: CompactThresholdConfig, model: any, window: number): string {\n  // compactAfterPercent intentionally precedes the fixed fallback. It uses only\n  // the active model's declaration, matching autoCompactThreshold().\n  if (isWindowRatio(cfg.compactAfterPercent)) {\n    const directWindow = directSessionContextWindow(model);\n    if (directWindow !== undefined) {\n      return \` · \${Math.round(cfg.compactAfterPercent * 100)}% of \${directWindow.toLocaleString()}-token window\`;\n    }\n    if (isFixedTokenThreshold(cfg.compactAfterTokens)) return "";\n  }\n  // Validity (not mere presence) decides the native tier — mirrors compactThresholdTokens\n  // so display and trigger cannot disagree, even for unnormalized configs.\n  if (isFixedTokenThreshold(cfg.compactAfterTokens)) return ""; // explicit fixed token threshold`,
);

replaceOnce(
  "src/commands/memory.ts",
  `compactThresholdSuffix(runtime.config, sessionContextWindow(ctx.model, runtime.config))`,
  `compactThresholdSuffix(runtime.config, ctx.model, sessionContextWindow(ctx.model, runtime.config))`,
);

// The published bundle cannot include local source patches. Load the patched
// source entrypoint, as the prior 0.5.1 deployment did, instead of leaving a
// source-only patch inactive behind dist/index.js.
replaceOnce(
  "package.json",
  `      "./dist/index.js"`,
  `      "./index.ts"`,
);

console.log("compactAfterPercent patch complete. Restart Pi or run /reload.");
