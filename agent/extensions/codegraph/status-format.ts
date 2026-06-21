/**
 * Markdown formatting for CodeGraph status and sync diagnostics.
 *
 * This module keeps codegraph_status output and internal changed-file counting in
 * one place so graph freshness decisions and user-facing reports stay aligned.
 */

import { formatSize } from "./result.ts";
import type { ChangedFiles, StatusSnapshot } from "./types.ts";

/**
 * Count all added, modified, and removed files in a CodeGraph change summary.
 *
 * @param changed - CodeGraph changed-file summary.
 * @returns Total pending changed files, or zero when unknown.
 */
export function changedCount(changed?: ChangedFiles): number {
  if (!changed) return 0;
  return changed.added.length + changed.modified.length + changed.removed.length;
}

function formatTimestamp(ms?: number | null): string {
  if (!ms) return "never";
  const delta = Date.now() - ms;
  const ago = delta < 1_000 ? "just now" : `${Math.round(delta / 1_000)}s ago`;
  return `${new Date(ms).toISOString()} (${ago})`;
}

function formatBytes(bytes: number | undefined): string {
  return typeof bytes === "number" ? formatSize(bytes) : "unknown";
}

function formatChangedFiles(changed?: ChangedFiles): string[] {
  if (!changed) return ["- pending changes: unknown"];
  const total = changedCount(changed);
  const lines = [`- pending changes: ${total} (${changed.added.length} added, ${changed.modified.length} modified, ${changed.removed.length} removed)`];
  const sample = [
    ...changed.added.map((f) => `A ${f}`),
    ...changed.modified.map((f) => `M ${f}`),
    ...changed.removed.map((f) => `D ${f}`),
  ].slice(0, 20);
  for (const item of sample) lines.push(`  - ${item}`);
  if (total > sample.length) lines.push(`  - ... ${total - sample.length} more`);
  return lines;
}

/**
 * Render a status snapshot as the codegraph_status Markdown response.
 *
 * @param snapshot - Snapshot produced by GraphManager.
 * @param initMessage - Optional initialization message to show as a blockquote.
 * @returns Markdown status report.
 *
 * @example
 * ```ts
 * const body = formatStatus(snapshot, init.message);
 * ```
 */
export function formatStatus(snapshot: StatusSnapshot, initMessage?: string): string {
  const lines: string[] = ["# CodeGraph status", ""];
  if (initMessage) lines.push(`> ${initMessage}`, "");

  if (!snapshot.initialized) {
    lines.push("- initialized: no");
    lines.push(`- searched from: ${snapshot.searchPath}`);
    if (snapshot.candidateRoot) lines.push(`- candidate root: ${snapshot.candidateRoot}`);
    if (snapshot.unsafeReason) lines.push(`- blocked: candidate root looks like ${snapshot.unsafeReason}`);
    lines.push("", "CodeGraph is unavailable for this project until it is initialized. Query tools will ask before initializing safe roots.");
    return lines.join("\n");
  }

  lines.push(`- initialized: yes`);
  lines.push(`- root: ${snapshot.root}`);
  lines.push(`- backend: ${snapshot.backend ?? "unknown"}`);
  lines.push(`- journal mode: ${snapshot.journalMode ?? "unknown"}`);
  lines.push(`- watching: ${snapshot.isWatching ? "yes" : "no"}`);
  lines.push(`- indexing: ${snapshot.isIndexing ? "yes" : "no"}`);

  if (snapshot.stats) {
    lines.push(`- files: ${snapshot.stats.fileCount}`);
    lines.push(`- nodes: ${snapshot.stats.nodeCount}`);
    lines.push(`- edges: ${snapshot.stats.edgeCount}`);
    lines.push(`- database size: ${formatBytes(snapshot.stats.dbSizeBytes)}`);
    lines.push(`- stats updated: ${formatTimestamp(snapshot.stats.lastUpdated)}`);
  }

  lines.push(`- last indexed: ${formatTimestamp(snapshot.lastIndexedAt)}`);
  if (snapshot.indexBuildInfo) {
    lines.push(`- indexed with: ${snapshot.indexBuildInfo.version ?? "unknown"} / extraction ${snapshot.indexBuildInfo.extractionVersion ?? "unknown"}`);
  }
  lines.push(`- full reindex needed: ${snapshot.indexStale ? "yes" : "no"}`);
  if (snapshot.indexStale) {
    lines.push("  - Recommendation: ask the user before running a full `codegraph index` / future `codegraph_index` flow.");
  }

  lines.push(...formatChangedFiles(snapshot.changedFiles));

  const pendingWatcher = snapshot.pendingFiles ?? [];
  lines.push(`- watcher pending files: ${pendingWatcher.length}`);
  for (const pending of pendingWatcher.slice(0, 20)) {
    lines.push(`  - ${pending.path}${pending.indexing ? " (indexing)" : ""}`);
  }
  if (pendingWatcher.length > 20) lines.push(`  - ... ${pendingWatcher.length - 20} more`);

  lines.push(`- extension sync TTL: ${snapshot.syncTtlMs}ms`);
  lines.push(`- extension last sync: ${formatTimestamp(snapshot.lastSyncedAt)}`);
  lines.push(`- extension sync in flight: ${snapshot.syncInFlight ? "yes" : "no"}`);
  lines.push(`- next query sync: ${snapshot.nextQuerySync ?? "unknown"}${snapshot.nextQuerySyncAfterMs ? ` in ~${snapshot.nextQuerySyncAfterMs}ms` : ""}`);

  return lines.join("\n");
}
