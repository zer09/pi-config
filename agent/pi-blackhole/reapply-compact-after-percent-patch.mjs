#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..", "npm", "node_modules", "pi-blackhole");

function readRel(rel) {
  return readFileSync(join(packageRoot, rel), "utf8");
}

function writeRel(rel, content) {
  const path = join(packageRoot, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function replaceOnce(rel, oldText, newText, marker) {
  const path = join(packageRoot, rel);
  let content = readFileSync(path, "utf8");
  if (marker && content.includes(marker)) {
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

replaceOnce(
  "src/core/unified-config.ts",
  `\t/** Token threshold for proactive auto-compaction. */\n\tcompactAfterTokens: number;\n\t/** Observation pool token pressure for full fold. */`,
  `\t/** Token threshold for proactive auto-compaction. */\n\tcompactAfterTokens: number;\n\t/** Optional fraction of the session model context window for proactive auto-compaction.\n\t *  When set, auto-compaction uses contextWindow * compactAfterPercent and\n\t *  falls back to compactAfterTokens if the context window is unavailable. */\n\tcompactAfterPercent?: number;\n\t/** Observation pool token pressure for full fold. */`,
  "compactAfterPercent?: number;",
);

replaceOnce(
  "src/core/unified-config.ts",
  `\t// Numeric fields — use nonNegativeInt for observerPreambleMaxTokens (0 = auto)\n\tconst numKeys = ["observeAfterTokens", "reflectAfterTokens", "compactAfterTokens", "observationsPoolMaxTokens", "observationsPoolTargetTokens", "reflectorInputMaxTokens", "dropperInputMaxTokens", "observerChunkMaxTokens", "observerPreambleMaxTokens", "agentMaxTurns"] as const;\n\n\t// dropperPressureThreshold: fractional, must be in (0, 1]\n`,
  `\t// Numeric fields — use nonNegativeInt for observerPreambleMaxTokens (0 = auto)\n\tconst numKeys = ["observeAfterTokens", "reflectAfterTokens", "compactAfterTokens", "observationsPoolMaxTokens", "observationsPoolTargetTokens", "reflectorInputMaxTokens", "dropperInputMaxTokens", "observerChunkMaxTokens", "observerPreambleMaxTokens", "agentMaxTurns"] as const;\n\n\t// compactAfterPercent: optional fractional auto-compaction threshold, must be in (0, 1]\n\tif (typeof raw.compactAfterPercent === "number" && Number.isFinite(raw.compactAfterPercent) && raw.compactAfterPercent > 0 && raw.compactAfterPercent <= 1) {\n\t\tc.compactAfterPercent = raw.compactAfterPercent;\n\t}\n\n\t// dropperPressureThreshold: fractional, must be in (0, 1]\n`,
  "raw.compactAfterPercent",
);

writeRel("src/om/compaction-budget.ts", `import type { UnifiedConfig } from "../core/unified-config.js";\n\ntype CompactBudgetConfig = Pick<UnifiedConfig, "compactAfterTokens" | "compactAfterPercent">;\n\nexport interface EffectiveCompactThreshold {\n\ttokens: number;\n\tsource: "percent" | "tokens";\n\tpercent?: number;\n\tcontextWindow?: number;\n}\n\nexport function sessionContextWindow(model: unknown): number | undefined {\n\tif (!model || typeof model !== "object") return undefined;\n\tconst contextWindow = (model as { contextWindow?: unknown }).contextWindow;\n\treturn typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0\n\t\t? Math.floor(contextWindow)\n\t\t: undefined;\n}\n\nfunction validCompactAfterPercent(value: unknown): number | undefined {\n\treturn typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1\n\t\t? value\n\t\t: undefined;\n}\n\nexport function effectiveCompactAfterTokens(\n\tconfig: CompactBudgetConfig,\n\tmodel: unknown,\n): EffectiveCompactThreshold {\n\tconst percent = validCompactAfterPercent(config.compactAfterPercent);\n\tconst contextWindow = sessionContextWindow(model);\n\tif (percent !== undefined && contextWindow !== undefined) {\n\t\treturn {\n\t\t\ttokens: Math.max(1, Math.floor(contextWindow * percent)),\n\t\t\tsource: "percent",\n\t\t\tpercent,\n\t\t\tcontextWindow,\n\t\t};\n\t}\n\n\treturn {\n\t\ttokens: Math.max(1, Math.floor(config.compactAfterTokens)),\n\t\tsource: "tokens",\n\t\tpercent,\n\t\tcontextWindow,\n\t};\n}\n`);
console.log("wrote: src/om/compaction-budget.ts");

replaceOnce(
  "src/om/compaction-trigger.ts",
  `import { debugLog } from "./debug-log.js";\nimport { RETRYABLE_ERROR_RE } from "./retryable-error.js";\n`,
  `import { debugLog } from "./debug-log.js";\nimport { effectiveCompactAfterTokens } from "./compaction-budget.js";\nimport { RETRYABLE_ERROR_RE } from "./retryable-error.js";\n`,
  "./compaction-budget.js",
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `\t\tconst dbg = (ev: string, d?: Record<string, unknown>) => debugLog(ev, d, runtime.config.debugLog === true);\n\n\t\tdbg("compaction_trigger.agent_end", {\n\t\t\tpassive: runtime.config.passive,\n\t\t\tmemory: runtime.config.memory,\n\t\t\tnoAutoCompact: runtime.config.noAutoCompact,\n\t\t\toverrideDefaultCompaction: runtime.config.overrideDefaultCompaction,\n\t\t\tcompactInFlight: runtime.compactInFlight,\n\t\t\tcompactAfterTokens: runtime.config.compactAfterTokens,\n\t\t});\n`,
  `\t\tconst dbg = (ev: string, d?: Record<string, unknown>) => debugLog(ev, d, runtime.config.debugLog === true);\n\t\tconst compactThreshold = effectiveCompactAfterTokens(runtime.config, ctx.model);\n\n\t\tdbg("compaction_trigger.agent_end", {\n\t\t\tpassive: runtime.config.passive,\n\t\t\tmemory: runtime.config.memory,\n\t\t\tnoAutoCompact: runtime.config.noAutoCompact,\n\t\t\toverrideDefaultCompaction: runtime.config.overrideDefaultCompaction,\n\t\t\tcompactInFlight: runtime.compactInFlight,\n\t\t\tcompactAfterTokens: runtime.config.compactAfterTokens,\n\t\t\tcompactAfterPercent: runtime.config.compactAfterPercent,\n\t\t\teffectiveCompactAfterTokens: compactThreshold.tokens,\n\t\t\tcompactThresholdSource: compactThreshold.source,\n\t\t\tcontextWindow: compactThreshold.contextWindow,\n\t\t});\n`,
  "effectiveCompactAfterTokens: compactThreshold.tokens",
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `\t\tdbg("compaction_trigger.tokens", { tokens, compactAfterTokens: runtime.config.compactAfterTokens, branchLength: entries.length });\n\t\tif (tokens < runtime.config.compactAfterTokens) {\n\t\t\tdbg("compaction_trigger.skip", { reason: "below_threshold", tokens, threshold: runtime.config.compactAfterTokens });\n\t\t\treturn;\n\t\t}\n`,
  `\t\tdbg("compaction_trigger.tokens", { tokens, compactAfterTokens: compactThreshold.tokens, compactThresholdSource: compactThreshold.source, branchLength: entries.length });\n\t\tif (tokens < compactThreshold.tokens) {\n\t\t\tdbg("compaction_trigger.skip", { reason: "below_threshold", tokens, threshold: compactThreshold.tokens, compactThresholdSource: compactThreshold.source });\n\t\t\treturn;\n\t\t}\n`,
  "compactThresholdSource: compactThreshold.source, branchLength",
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `\t\t\tconst currentTokens = rawTokensSinceLastCompaction(currentEntries);\n\t\t\tdbg("compaction_trigger.microtask.recheck_tokens", { currentTokens, threshold: runtime.config.compactAfterTokens, ok: currentTokens >= runtime.config.compactAfterTokens });\n\t\t\tif (currentTokens < runtime.config.compactAfterTokens) {\n\t\t\t\truntime.compactInFlight = false;\n\t\t\t\truntime.autoCompactionController = null;\n\t\t\t\tdbg("compaction_trigger.microtask.bail", { reason: "pressure_relieved", currentTokens, threshold: runtime.config.compactAfterTokens });\n`,
  `\t\t\tconst currentTokens = rawTokensSinceLastCompaction(currentEntries);\n\t\t\tdbg("compaction_trigger.microtask.recheck_tokens", { currentTokens, threshold: compactThreshold.tokens, compactThresholdSource: compactThreshold.source, ok: currentTokens >= compactThreshold.tokens });\n\t\t\tif (currentTokens < compactThreshold.tokens) {\n\t\t\t\truntime.compactInFlight = false;\n\t\t\t\truntime.autoCompactionController = null;\n\t\t\t\tdbg("compaction_trigger.microtask.bail", { reason: "pressure_relieved", currentTokens, threshold: compactThreshold.tokens, compactThresholdSource: compactThreshold.source });\n`,
  "compaction_trigger.microtask.recheck_tokens\", { currentTokens, threshold: compactThreshold.tokens",
);

replaceOnce(
  "src/commands/memory.ts",
  `import { readPendingState } from "../om/pending.js";\n`,
  `import { effectiveCompactAfterTokens, type EffectiveCompactThreshold } from "../om/compaction-budget.js";\nimport { readPendingState } from "../om/pending.js";\n`,
  "EffectiveCompactThreshold",
);

replaceOnce(
  "src/commands/memory.ts",
  `function pct(current: number, total: number): number {\n\treturn total > 0 ? Math.round((current / total) * 100) : 0;\n}\n`,
  `function pct(current: number, total: number): number {\n\treturn total > 0 ? Math.round((current / total) * 100) : 0;\n}\n\nfunction formatPercent(value: number): string {\n\tconst percent = value * 100;\n\treturn Number.isInteger(percent) ? \`\${percent}%\` : \`\${percent.toFixed(1)}%\`;\n}\n\nfunction formatCompactThreshold(threshold: EffectiveCompactThreshold): string {\n\tif (threshold.source === "percent" && threshold.percent !== undefined && threshold.contextWindow !== undefined) {\n\t\treturn \`\${threshold.tokens.toLocaleString()} = \${formatPercent(threshold.percent)} of \${threshold.contextWindow.toLocaleString()}\`;\n\t}\n\treturn threshold.tokens.toLocaleString();\n}\n`,
  "formatCompactThreshold",
);

replaceOnce(
  "src/commands/memory.ts",
  `\t\t\tlet dropProgress = rawTokensSinceDropCoverage(entries);\n\t\t\tconst compactionProgress = rawTokensSinceLastCompaction(entries);\n\n\t\t\t// In noAutoCompact mode, pending coversUpToId entries act as virtual coverage markers\n`,
  `\t\t\tlet dropProgress = rawTokensSinceDropCoverage(entries);\n\t\t\tconst compactionProgress = rawTokensSinceLastCompaction(entries);\n\t\t\tconst compactThreshold = effectiveCompactAfterTokens(runtime.config, ctx.model);\n\n\t\t\t// In noAutoCompact mode, pending coversUpToId entries act as virtual coverage markers\n`,
  "const compactThreshold = effectiveCompactAfterTokens(runtime.config, ctx.model);",
);

replaceOnce(
  "src/commands/memory.ts",
  `\t\t\t\t\`Dropper:        ~\${dropProgress.toLocaleString()} tokens (triggers at \${runtime.config.reflectAfterTokens.toLocaleString()})\`,\n\t\t\t\t\`Compaction:     ~\${compactionProgress.toLocaleString()} tokens\` + (runtime.config.noAutoCompact ? " [auto-disabled]" : \` (triggers at \${runtime.config.compactAfterTokens.toLocaleString()})\`),\n`,
  `\t\t\t\t\`Dropper:        ~\${dropProgress.toLocaleString()} tokens (triggers at \${runtime.config.reflectAfterTokens.toLocaleString()})\`,\n\t\t\t\t\`Compaction:     ~\${compactionProgress.toLocaleString()} tokens\` + (runtime.config.noAutoCompact ? " [auto-disabled]" : \` (triggers at \${formatCompactThreshold(compactThreshold)})\`),\n`,
  "formatCompactThreshold(compactThreshold)",
);

console.log("compactAfterPercent patch complete. Restart Pi or run /reload.");
