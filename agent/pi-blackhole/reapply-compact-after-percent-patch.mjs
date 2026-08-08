#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, "..", "npm", "node_modules", "pi-blackhole");

function readRel(rel) {
  return readFileSync(join(packageRoot, rel), "utf8");
}

function writeRel(rel, content) {
  const path = join(packageRoot, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
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

replaceOnce(
  "src/core/unified-config.ts",
  `  /** Token threshold for proactive auto-compaction. */\n  compactAfterTokens: number;\n  /** Observation pool token pressure for full fold. */`,
  `  /** Token threshold for proactive auto-compaction. */\n  compactAfterTokens: number;\n  /** Optional fraction of the session model context window for proactive auto-compaction.\n   *  When set, auto-compaction uses contextWindow * compactAfterPercent and\n   *  falls back to compactAfterTokens if the context window is unavailable. */\n  compactAfterPercent?: number;\n  /** Observation pool token pressure for full fold. */`,
);

replaceOnce(
  "src/core/unified-config.ts",
  `  // dropperPressureThreshold: fractional, must be in (0, 1]\n`,
  `  // compactAfterPercent: optional fractional auto-compaction threshold, must be in (0, 1]\n  if (\n    typeof raw.compactAfterPercent === "number" &&\n    Number.isFinite(raw.compactAfterPercent) &&\n    raw.compactAfterPercent > 0 &&\n    raw.compactAfterPercent <= 1\n  ) {\n    c.compactAfterPercent = raw.compactAfterPercent;\n  }\n\n  // dropperPressureThreshold: fractional, must be in (0, 1]\n`,
);

writeRel("src/om/compaction-budget.ts", `import type { UnifiedConfig } from "../core/unified-config.js";\n\ntype CompactBudgetConfig = Pick<\n  UnifiedConfig,\n  "compactAfterTokens" | "compactAfterPercent"\n>;\n\nexport interface EffectiveCompactThreshold {\n  tokens: number;\n  source: "percent" | "tokens";\n  percent?: number;\n  contextWindow?: number;\n}\n\nexport function sessionContextWindow(model: unknown): number | undefined {\n  if (!model || typeof model !== "object") return undefined;\n  const contextWindow = (model as { contextWindow?: unknown }).contextWindow;\n  return typeof contextWindow === "number" &&\n    Number.isFinite(contextWindow) &&\n    contextWindow > 0\n    ? Math.floor(contextWindow)\n    : undefined;\n}\n\nfunction validCompactAfterPercent(value: unknown): number | undefined {\n  return typeof value === "number" &&\n    Number.isFinite(value) &&\n    value > 0 &&\n    value <= 1\n    ? value\n    : undefined;\n}\n\nexport function effectiveCompactAfterTokens(\n  config: CompactBudgetConfig,\n  model: unknown,\n): EffectiveCompactThreshold {\n  const percent = validCompactAfterPercent(config.compactAfterPercent);\n  const contextWindow = sessionContextWindow(model);\n  if (percent !== undefined && contextWindow !== undefined) {\n    return {\n      tokens: Math.max(1, Math.floor(contextWindow * percent)),\n      source: "percent",\n      percent,\n      contextWindow,\n    };\n  }\n\n  return {\n    tokens: Math.max(1, Math.floor(config.compactAfterTokens)),\n    source: "tokens",\n    percent,\n    contextWindow,\n  };\n}\n`);
console.log("wrote: src/om/compaction-budget.ts");

replaceOnce(
  "src/om/compaction-trigger.ts",
  `import { debugLog } from "./debug-log.js";\nimport { RETRYABLE_ERROR_RE } from "./retryable-error.js";\n`,
  `import { debugLog } from "./debug-log.js";\nimport { effectiveCompactAfterTokens } from "./compaction-budget.js";\nimport { RETRYABLE_ERROR_RE } from "./retryable-error.js";\n`,
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `  const dbg = (ev: string, d?: Record<string, unknown>) =>\n    debugLog(ev, d, runtime.config.debugLog === true);\n\n  const mode = runtime.config.midRunCompaction ?? "off";\n`,
  `  const dbg = (ev: string, d?: Record<string, unknown>) =>\n    debugLog(ev, d, runtime.config.debugLog === true);\n  const compactThreshold = effectiveCompactAfterTokens(runtime.config, ctx.model);\n\n  const mode = runtime.config.midRunCompaction ?? "off";\n`,
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `  if (tokens < runtime.config.compactAfterTokens) {\n    // Pressure relieved (a compaction ran) — lift any failure suspension.\n`,
  `  if (tokens < compactThreshold.tokens) {\n    // Pressure relieved (a compaction ran) — lift any failure suspension.\n`,
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `  dbg("compaction_trigger.turn_end.threshold_reached", {\n    tokens,\n    threshold: runtime.config.compactAfterTokens,\n    mode,\n  });\n`,
  `  dbg("compaction_trigger.turn_end.threshold_reached", {\n    tokens,\n    threshold: compactThreshold.tokens,\n    compactThresholdSource: compactThreshold.source,\n    mode,\n  });\n`,
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `  const dbg = (ev: string, d?: Record<string, unknown>) =>\n    debugLog(ev, d, runtime.config.debugLog === true);\n\n  dbg("compaction_trigger.agent_end", {\n`,
  `  const dbg = (ev: string, d?: Record<string, unknown>) =>\n    debugLog(ev, d, runtime.config.debugLog === true);\n  const compactThreshold = effectiveCompactAfterTokens(runtime.config, ctx.model);\n\n  dbg("compaction_trigger.agent_end", {\n`,
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `    compactAfterTokens: runtime.config.compactAfterTokens,\n  });\n\n  // Unified + legacy compaction guards`,
  `    compactAfterTokens: runtime.config.compactAfterTokens,\n    compactAfterPercent: runtime.config.compactAfterPercent,\n    effectiveCompactAfterTokens: compactThreshold.tokens,\n    compactThresholdSource: compactThreshold.source,\n    contextWindow: compactThreshold.contextWindow,\n  });\n\n  // Unified + legacy compaction guards`,
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `  dbg("compaction_trigger.tokens", {\n    tokens,\n    compactAfterTokens: runtime.config.compactAfterTokens,\n    branchLength: entries.length,\n  });\n  if (tokens < runtime.config.compactAfterTokens) {\n    dbg("compaction_trigger.skip", {\n      reason: "below_threshold",\n      tokens,\n      threshold: runtime.config.compactAfterTokens,\n    });\n`,
  `  dbg("compaction_trigger.tokens", {\n    tokens,\n    compactAfterTokens: compactThreshold.tokens,\n    compactThresholdSource: compactThreshold.source,\n    branchLength: entries.length,\n  });\n  if (tokens < compactThreshold.tokens) {\n    dbg("compaction_trigger.skip", {\n      reason: "below_threshold",\n      tokens,\n      threshold: compactThreshold.tokens,\n      compactThresholdSource: compactThreshold.source,\n    });\n`,
);

replaceOnce(
  "src/om/compaction-trigger.ts",
  `      dbg("compaction_trigger.microtask.recheck_tokens", {\n        currentTokens,\n        threshold: runtime.config.compactAfterTokens,\n        ok: currentTokens >= runtime.config.compactAfterTokens,\n      });\n      if (currentTokens < runtime.config.compactAfterTokens) {\n        runtime.compactInFlight = false;\n        runtime.autoCompactionController = null;\n        dbg("compaction_trigger.microtask.bail", {\n          reason: "pressure_relieved",\n          currentTokens,\n          threshold: runtime.config.compactAfterTokens,\n        });\n`,
  `      dbg("compaction_trigger.microtask.recheck_tokens", {\n        currentTokens,\n        threshold: compactThreshold.tokens,\n        compactThresholdSource: compactThreshold.source,\n        ok: currentTokens >= compactThreshold.tokens,\n      });\n      if (currentTokens < compactThreshold.tokens) {\n        runtime.compactInFlight = false;\n        runtime.autoCompactionController = null;\n        dbg("compaction_trigger.microtask.bail", {\n          reason: "pressure_relieved",\n          currentTokens,\n          threshold: compactThreshold.tokens,\n          compactThresholdSource: compactThreshold.source,\n        });\n`,
);

replaceOnce(
  "src/commands/memory.ts",
  `import { readPendingState } from "../om/pending.js";\n`,
  `import {\n  effectiveCompactAfterTokens,\n  type EffectiveCompactThreshold,\n} from "../om/compaction-budget.js";\nimport { readPendingState } from "../om/pending.js";\n`,
);

replaceOnce(
  "src/commands/memory.ts",
  `function pct(current: number, total: number): number {\n  return total > 0 ? Math.round((current / total) * 100) : 0;\n}\n`,
  `function pct(current: number, total: number): number {\n  return total > 0 ? Math.round((current / total) * 100) : 0;\n}\n\nfunction formatPercent(value: number): string {\n  const percent = value * 100;\n  return Number.isInteger(percent) ? \`\${percent}%\` : \`\${percent.toFixed(1)}%\`;\n}\n\nfunction formatCompactThreshold(threshold: EffectiveCompactThreshold): string {\n  if (\n    threshold.source === "percent" &&\n    threshold.percent !== undefined &&\n    threshold.contextWindow !== undefined\n  ) {\n    return \`\${threshold.tokens.toLocaleString()} = \${formatPercent(threshold.percent)} of \${threshold.contextWindow.toLocaleString()}\`;\n  }\n  return threshold.tokens.toLocaleString();\n}\n`,
);

replaceOnce(
  "src/commands/memory.ts",
  `      let dropProgress = rawTokensSinceDropCoverage(entries);\n      const compactionProgress = rawTokensSinceLastCompaction(entries);\n\n      // In manual mode`,
  `      let dropProgress = rawTokensSinceDropCoverage(entries);\n      const compactionProgress = rawTokensSinceLastCompaction(entries);\n      const compactThreshold = effectiveCompactAfterTokens(runtime.config, ctx.model);\n\n      // In manual mode`,
);

replaceOnce(
  "src/commands/memory.ts",
  `            : \` (triggers at \${runtime.config.compactAfterTokens.toLocaleString()})\`),\n`,
  `            : \` (triggers at \${formatCompactThreshold(compactThreshold)})\`),\n`,
);

// pi-blackhole 0.4.5 publishes both source and a prebuilt bundle. Pi must load
// the patched source because local package changes do not rebuild dist/index.js.
replaceOnce(
  "package.json",
  `      "./dist/index.js"`,
  `      "./index.ts"`,
);

console.log("compactAfterPercent patch complete. Restart Pi or run /reload.");
