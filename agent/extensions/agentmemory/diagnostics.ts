import { readFileSync } from "node:fs";

import { TOOL_POLICY_PATH } from "./constants.ts";
import { protectDisplayText } from "./formatting.ts";
import type { FollowupDiagnosticResponse, HealthResponse, PolicyMetadata } from "./types.ts";

const LOCAL_POLICY_METADATA = readPolicyMetadata();

function readPolicyMetadata(): PolicyMetadata {
  try {
    const parsed = JSON.parse(readFileSync(TOOL_POLICY_PATH, "utf8")) as { upstream?: PolicyMetadata };
    const upstream = parsed.upstream || {};
    return {
      lastCheckedVersion: typeof upstream.lastCheckedVersion === "string" ? upstream.lastCheckedVersion : undefined,
      lastCheckedCommit: typeof upstream.lastCheckedCommit === "string" ? upstream.lastCheckedCommit : undefined,
      toolCount: typeof upstream.toolCount === "number" ? upstream.toolCount : undefined,
    };
  } catch {
    return {};
  }
}

function normalizeVersion(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^v/i, "") : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function policyDriftWarning(health: HealthResponse | null | undefined): string | null {
  const localVersion = normalizeVersion(LOCAL_POLICY_METADATA.lastCheckedVersion);
  const serverVersion = normalizeVersion(health?.version);
  if (!localVersion || !serverVersion || localVersion === serverVersion) return null;
  return `local Pi policy last checked against AgentMemory v${localVersion}, but server reports v${serverVersion}`;
}

export function formatPolicyDriftWarning(health: HealthResponse | null | undefined): string | null {
  const warning = policyDriftWarning(health);
  return warning ? protectDisplayText(`policy drift warning: ${warning}`) : null;
}

export function isFollowupDiagnostic(value: unknown): value is FollowupDiagnosticResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as FollowupDiagnosticResponse;
  return finiteNumber(candidate.agentInitiatedSearches) !== null
    && finiteNumber(candidate.followupWithinWindow) !== null
    && finiteNumber(candidate.rate) !== null;
}

function formatFollowupDiagnostic(result: FollowupDiagnosticResponse | null): string | null {
  if (!isFollowupDiagnostic(result)) return null;
  const total = result.agentInitiatedSearches || 0;
  const followups = result.followupWithinWindow || 0;
  const windowSeconds = finiteNumber(result.windowSeconds);
  const rate = finiteNumber(result.rate);
  const rateText = rate === null ? "unknown rate" : `${(rate * 100).toFixed(1)}%`;
  const windowText = windowSeconds === null ? "the configured window" : `${windowSeconds}s`;
  const caveat = typeof result.caveat === "string" && result.caveat.trim()
    ? ` ${result.caveat.trim()}`
    : "";
  return protectDisplayText(`smart-search followup diagnostic: ${followups}/${total} agent searches followed up within ${windowText} (${rateText}).${caveat}`);
}

export function buildPiDiagnostics(health: HealthResponse | null | undefined, followup: FollowupDiagnosticResponse | null) {
  const policyWarning = policyDriftWarning(health);
  return {
    policy: {
      lastCheckedVersion: LOCAL_POLICY_METADATA.lastCheckedVersion || null,
      lastCheckedCommit: LOCAL_POLICY_METADATA.lastCheckedCommit || null,
      serverVersion: health?.version || null,
      warning: policyWarning,
    },
    followup: isFollowupDiagnostic(followup) ? followup : null,
  };
}

export function formatPiDiagnosticsFooter(health: HealthResponse | null | undefined, followup: FollowupDiagnosticResponse | null): string {
  const lines = [
    formatPolicyDriftWarning(health),
    formatFollowupDiagnostic(followup),
  ].filter((line): line is string => Boolean(line));
  return lines.length ? `Pi diagnostics:\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
}
