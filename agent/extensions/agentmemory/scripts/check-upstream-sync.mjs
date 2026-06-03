#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractUpstreamTools, resolveUpstreamRoot } from "./extract-upstream-tools.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = resolve(SCRIPT_DIR, "..");
const PROJECT_ROOT = resolve(EXTENSION_DIR, "../../..");
const POLICY_PATH = join(EXTENSION_DIR, "tool-policy.json");
const GATED_DEFAULT_DENY = new Set([
  "memory_lesson_save",
  "memory_consolidate",
  "memory_reflect",
  "memory_insight_list",
  "memory_audit",
  "memory_export",
  "memory_governance_delete",
  "memory_heal",
  "memory_slot_create",
  "memory_slot_append",
  "memory_slot_replace",
  "memory_slot_delete",
]);
const WORKFLOW_STATE_DEFAULT_DENY = new Set([
  "memory_action_create",
  "memory_action_update",
  "memory_frontier",
  "memory_next",
  "memory_lease",
  "memory_signal_send",
  "memory_signal_read",
  "memory_checkpoint",
  "memory_sentinel_create",
  "memory_sentinel_trigger",
  "memory_routine_run",
  "memory_sketch_create",
  "memory_sketch_promote",
  "memory_crystallize",
]);
const EXTERNAL_INTEGRATION_DEFAULT_DENY = new Set([
  "memory_claude_bridge_sync",
  "memory_vision_search",
  "memory_team_share",
  "memory_team_feed",
  "memory_mesh_sync",
  "memory_obsidian_export",
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function entryName(entry) {
  return typeof entry === "string" ? entry : entry?.name;
}

function sorted(values) {
  return [...values].sort();
}

function sameSet(left, right) {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function rel(filePath) {
  return filePath.startsWith(`${PROJECT_ROOT}/`) ? filePath.slice(PROJECT_ROOT.length + 1) : filePath;
}

function displayPath(filePath) {
  const home = process.env.HOME;
  if (home && filePath === home) return "~";
  if (home && filePath.startsWith(`${home}/`)) return `~/${filePath.slice(home.length + 1)}`;
  return rel(filePath);
}

function extractLocalMemoryToolNames(localText) {
  return new Set([...localText.matchAll(/name:\s*"(memory_[^"]+)"/g)].map((match) => match[1]));
}

function main() {
  const upstreamRoot = resolveUpstreamRoot();
  const summary = extractUpstreamTools(upstreamRoot);
  const policy = readJson(POLICY_PATH);
  const localIndexPath = join(EXTENSION_DIR, "index.ts");
  const localIndexText = readFileSync(localIndexPath, "utf8");
  const localMemoryToolNames = extractLocalMemoryToolNames(localIndexText);
  const failures = [];
  const warnings = [];
  const upstreamNames = summary.tools.map((tool) => tool.name);
  const upstreamNameSet = new Set(upstreamNames);
  const toolByName = new Map(summary.tools.map((tool) => [tool.name, tool]));

  if (policy.upstream?.toolCount !== summary.registryCount) {
    failures.push(`tool-policy upstream.toolCount=${policy.upstream?.toolCount} but registry has ${summary.registryCount}`);
  }

  if (summary.registryCount !== summary.serverCaseCount || summary.serverMissingCases.length || summary.serverExtraCases.length) {
    failures.push(`registry/server case mismatch: registry=${summary.registryCount} serverCases=${summary.serverCaseCount} missing=${summary.serverMissingCases.join(",") || "none"} extra=${summary.serverExtraCases.join(",") || "none"}`);
  }

  const categories = {
    defaultTools: policy.defaultTools || [],
    gatedTools: policy.gatedTools || [],
    notExposedTools: policy.notExposedTools || [],
  };
  const memberships = new Map();
  for (const [category, entries] of Object.entries(categories)) {
    for (const entry of entries) {
      const name = entryName(entry);
      if (!name) {
        failures.push(`${category} contains an entry without a name`);
        continue;
      }
      memberships.set(name, [...(memberships.get(name) || []), category]);
      if (!upstreamNameSet.has(name)) failures.push(`${category} lists unknown upstream tool ${name}`);
    }
  }

  for (const name of upstreamNames) {
    const listedIn = memberships.get(name) || [];
    if (listedIn.length !== 1) failures.push(`${name} must appear in exactly one policy category, found ${listedIn.length ? listedIn.join(",") : "none"}`);
  }

  for (const name of sorted(memberships.keys())) {
    const listedIn = memberships.get(name) || [];
    if (listedIn.length > 1) failures.push(`${name} appears in multiple policy categories: ${listedIn.join(",")}`);
  }

  const notExposedNames = new Set(categories.notExposedTools.map(entryName).filter(Boolean));
  for (const name of sorted(WORKFLOW_STATE_DEFAULT_DENY)) {
    if (!upstreamNameSet.has(name)) continue;
    if (!notExposedNames.has(name)) failures.push(`${name} is AgentMemory workflow/task-state policy and must stay not exposed until an ADR explicitly adopts it`);
  }
  for (const name of sorted(EXTERNAL_INTEGRATION_DEFAULT_DENY)) {
    if (!upstreamNameSet.has(name)) continue;
    if (!notExposedNames.has(name)) failures.push(`${name} is AgentMemory external-integration policy and must stay not exposed until an active client/workflow policy adopts it`);
  }

  for (const entry of categories.defaultTools) {
    const name = entryName(entry);
    if (!name || !upstreamNameSet.has(name)) continue;
    if (GATED_DEFAULT_DENY.has(name)) failures.push(`${name} is gated/destructive/broad-private and must not be default-exposed`);
    const upstream = toolByName.get(name);
    if (Array.isArray(entry.required) && !sameSet(entry.required, upstream.required || [])) {
      failures.push(`${name} required fields drifted: policy=${sorted(entry.required).join(",") || "none"} upstream=${sorted(upstream.required || []).join(",") || "none"}`);
    }
    if (Array.isArray(entry.properties) && !sameSet(entry.properties, upstream.propertyNames || [])) {
      failures.push(`${name} properties drifted: policy=${sorted(entry.properties).join(",") || "none"} upstream=${sorted(upstream.propertyNames || []).join(",") || "none"}`);
    }
  }

  const localToolNames = new Set((policy.localTools || []).map(entryName).filter(Boolean));
  for (const name of localToolNames) {
    if (upstreamNameSet.has(name)) failures.push(`localTools lists upstream tool ${name}; classify it under defaultTools, gatedTools, or notExposedTools instead`);
    if (!localMemoryToolNames.has(name)) failures.push(`localTools lists ${name}, but index.ts does not register it`);
  }
  for (const name of sorted(localMemoryToolNames)) {
    if (upstreamNameSet.has(name)) continue;
    if (!localToolNames.has(name)) failures.push(`index.ts registers local-only tool ${name}, but tool-policy localTools does not document it`);
  }

  for (const invariant of policy.localInvariants || []) {
    const file = invariant.file ? join(PROJECT_ROOT, invariant.file) : "";
    if (!file || !existsSync(file)) {
      failures.push(`local invariant ${invariant.id || "unknown"} file missing: ${invariant.file || "UNKNOWN"}`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    if (typeof invariant.contains === "string" && !text.includes(invariant.contains)) {
      failures.push(`local invariant ${invariant.id || "unknown"} missing text in ${rel(file)}: ${invariant.contains}`);
    }
  }

  for (const mention of summary.docsCountMentions) {
    if (mention.count !== summary.registryCount) {
      warnings.push(`${mention.file} mentions ${mention.text}, but registry has ${summary.registryCount} tools`);
    }
  }

  const upstreamPiIndex = join(upstreamRoot, "integrations/pi/index.ts");
  if (existsSync(upstreamPiIndex)) {
    const upstreamText = readFileSync(upstreamPiIndex, "utf8");
    const upstreamLines = upstreamText.split("\n").length;
    const localLines = localIndexText.split("\n").length;
    warnings.push(`upstream integrations/pi/index.ts lines=${upstreamLines}; local index.ts lines=${localLines}; review local safety deltas before syncing`);
  }

  console.log(`AgentMemory upstream: ${displayPath(upstreamRoot)}`);
  console.log(`registry tools: ${summary.registryCount}`);
  console.log(`server cases: ${summary.serverCaseCount}`);
  console.log(`standalone cases: ${summary.standaloneCaseCount}`);
  console.log(`policy categories: default=${categories.defaultTools.length} gated=${categories.gatedTools.length} notExposed=${categories.notExposedTools.length}`);

  if (warnings.length) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (failures.length) {
    console.error("\nFailures:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("\nAgentMemory upstream sync check passed.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
