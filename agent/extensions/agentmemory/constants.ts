import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_URL = process.env.AGENTMEMORY_URL || "http://localhost:3111";
export const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
export const SKILLS_DIR = join(EXTENSION_DIR, "skills");
export const TOOL_POLICY_PATH = join(EXTENSION_DIR, "tool-policy.json");

export const TOOL_GUIDANCE = [
  "agentmemory is available for cross-session memory.",
  "Use memory_search or memory_smart_search to recall prior decisions, preferences, bugs, and workflows.",
  "Use memory_file_history for file-specific prior work and memory_commit_lookup for commit provenance.",
  "Use memory_save only for durable non-secret facts worth remembering beyond this session.",
].join(" ");

export const KNOWN_MCP_RESOURCE_PATTERNS: RegExp[] = [
  /^agentmemory:\/\/status$/,
  /^agentmemory:\/\/project\/[^/{}]+\/profile$/,
  /^agentmemory:\/\/project\/[^/{}]+\/recent$/,
  /^agentmemory:\/\/memories\/latest$/,
  /^agentmemory:\/\/graph\/stats$/,
];

export const KNOWN_MCP_PROMPTS = new Set(["recall_context", "session_handoff", "detect_patterns"]);
