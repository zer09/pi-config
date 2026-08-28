#!/usr/bin/env node
/**
 * Local read-only percentile analyzer for delegated structural-progress gaps.
 *
 *   npm --prefix agent/extensions/delegated-pi-loop run analyze:progress-gaps
 *
 * Scans the delegated-pi-loop diagnostics directory (resolved from the same
 * `PI_CODING_AGENT_DIR` rules as the writer), selects the default eligible
 * sample (schema-7 records of completed invocations, using the completed
 * supervised attempt; fallback attempts are ignored), and reports aggregate
 * nearest-rank p50/p95/p99 statistics plus threshold exceedance counts.
 *
 * Output is aggregate-only: no file paths, timestamps, labels, roles, routes,
 * providers, per-run values, prompts, reports, or raw errors are printed.
 * The analyzer performs no writes and no network calls.
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { diagnosticsDirectory } from "./diagnostics.ts";

/** Eligible samples below this count label p99 as insufficient. */
export const P99_MINIMUM_SAMPLES = 100;

/** Threshold edges in minutes reported as counts and percentages at or above. */
export const THRESHOLD_MINUTES: readonly number[] = [5, 10, 15, 20, 30, 45];

/**
 * Scan-input safety cap in bytes: a schema-7 record is a few KB, so a
 * regular file larger than this 1 MiB cap is skipped rather than read.
 */
export const SCAN_MAX_RECORD_BYTES = 1024 * 1024;

/** Reasons one scanned record is excluded from the eligible sample. */
export type IgnoredReason =
  | "historicalSchema"
  | "malformedJson"
  | "unknownSchemaVersion"
  | "unsuccessfulRecords"
  | "catalogOnly"
  | "noCompletedAttempt"
  | "invalidMaximum"
  | "readFailures";

export type IgnoredCounts = Readonly<Record<IgnoredReason, number>>;

export interface ProgressGapAnalysis {
  readonly eligibleCount: number;
  readonly recordsScanned: number;
  readonly ignored: IgnoredCounts;
  readonly minimumSeconds?: number;
  readonly maximumSeconds?: number;
  readonly p50Seconds?: number;
  readonly p95Seconds?: number;
  readonly p99Seconds?: number;
  readonly p99Sufficient: boolean;
  readonly thresholds: ReadonlyArray<{ readonly minutes: number; readonly count: number; readonly percentage: number }>;
}

/**
 * Exact nearest-rank percentile over ascending-sorted unrounded values:
 * rank = ceil(percentile * count), value = sorted[rank - 1].
 */
export function nearestRankPercentile(
  sortedAscending: readonly number[],
  percentile: number,
): number | undefined {
  if (sortedAscending.length === 0) return undefined;
  const rank = Math.max(1, Math.ceil(percentile * sortedAscending.length));
  return sortedAscending[rank - 1];
}

function emptyIgnored(): Record<IgnoredReason, number> {
  return {
    historicalSchema: 0,
    malformedJson: 0,
    unknownSchemaVersion: 0,
    unsuccessfulRecords: 0,
    catalogOnly: 0,
    noCompletedAttempt: 0,
    invalidMaximum: 0,
    readFailures: 0,
  };
}

/**
 * Classifies one parsed diagnostic record for the default eligible sample:
 * schema version exactly 7, completed invocation, one completed supervised
 * attempt (fallback and catalog-only attempts are ignored), and a finite
 * non-negative `maxProgressIdleSeconds` on that attempt.
 */
export function eligibleGap(record: unknown): { status: "eligible"; value: number } | { status: "ignored"; reason: IgnoredReason } {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return { status: "ignored", reason: "malformedJson" };
  }
  const candidate = record as Record<string, unknown>;
  const schemaVersion = candidate.schemaVersion;
  if (typeof schemaVersion === "number" && schemaVersion >= 3 && schemaVersion <= 6) {
    return { status: "ignored", reason: "historicalSchema" };
  }
  if (schemaVersion !== 7) return { status: "ignored", reason: "unknownSchemaVersion" };
  const attempts = Array.isArray(candidate.attempts) ? candidate.attempts : [];
  // A catalog-only history (attempts exist and every one is a catalog
  // preflight skip) carries no supervised evidence at all, so it forms its
  // own ignored category ahead of the unsuccessful and no-completed-attempt
  // checks it would otherwise fall into.
  if (
    attempts.length > 0
    && attempts.every((attempt) =>
      typeof attempt === "object" && attempt !== null
      && (attempt as Record<string, unknown>).state === "catalog_unavailable")
  ) {
    return { status: "ignored", reason: "catalogOnly" };
  }
  if (candidate.state !== "completed") return { status: "ignored", reason: "unsuccessfulRecords" };
  // One completed supervised attempt per completed invocation: the final
  // normal completion. Fallback attempts (operational failures) never match.
  let completedAttempt: Record<string, unknown> | undefined;
  for (const attempt of attempts) {
    if (typeof attempt === "object" && attempt !== null && (attempt as Record<string, unknown>).state === "completed") {
      completedAttempt = attempt as Record<string, unknown>;
    }
  }
  if (completedAttempt === undefined) return { status: "ignored", reason: "noCompletedAttempt" };
  const maximum = completedAttempt.maxProgressIdleSeconds;
  if (typeof maximum !== "number" || !Number.isFinite(maximum) || maximum < 0) {
    return { status: "ignored", reason: "invalidMaximum" };
  }
  return { status: "eligible", value: maximum };
}

/**
 * Analyzes parsed records into the aggregate report. Values are kept
 * unrounded for percentile selection; formatting rounds for display only.
 * `scanIgnored` carries scan-layer exclusions (malformed JSON, vanished or
 * unreadable files) that never produce a parsed record.
 */
export function analyzeRecords(
  records: readonly unknown[],
  scanIgnored: Partial<Record<IgnoredReason, number>> = {},
): ProgressGapAnalysis {
  const ignored = emptyIgnored();
  const values: number[] = [];
  for (const record of records) {
    const outcome = eligibleGap(record);
    if (outcome.status === "eligible") values.push(outcome.value);
    else ignored[outcome.reason] += 1;
  }
  // Scanned records are parsed entries plus scan-layer exclusions; the
  // classified malformed count below must not be added twice.
  const scanned = records.length + (scanIgnored.malformedJson ?? 0) + (scanIgnored.readFailures ?? 0);
  for (const reason of Object.keys(ignored) as IgnoredReason[]) {
    ignored[reason] += scanIgnored[reason] ?? 0;
  }
  values.sort((left, right) => left - right);
  const thresholds = THRESHOLD_MINUTES.map((minutes) => {
    const seconds = minutes * 60;
    const count = values.filter((value) => value >= seconds).length;
    return {
      minutes,
      count,
      percentage: values.length === 0 ? 0 : Math.round((count / values.length) * 1000) / 10,
    };
  });
  return {
    eligibleCount: values.length,
    recordsScanned: scanned,
    ignored,
    minimumSeconds: values.length > 0 ? values[0] : undefined,
    maximumSeconds: values.length > 0 ? values[values.length - 1] : undefined,
    p50Seconds: nearestRankPercentile(values, 0.5),
    p95Seconds: nearestRankPercentile(values, 0.95),
    p99Seconds: nearestRankPercentile(values, 0.99),
    p99Sufficient: values.length >= P99_MINIMUM_SAMPLES,
    thresholds,
  };
}

function secondsText(value: number | undefined): string {
  return value === undefined ? "unavailable" : `${(Math.round(value * 10) / 10).toFixed(1)}s`;
}

/** Aggregate-only report text; contains no paths, timestamps, labels, or per-run values. */
export function formatProgressGapAnalysis(analysis: ProgressGapAnalysis): string {
  const lines = [
    "delegated structural-progress gap analysis",
    `records scanned: ${analysis.recordsScanned}`,
    `eligible samples: ${analysis.eligibleCount}`,
    `ignored: historical schema 3-6 ${analysis.ignored.historicalSchema}`
      + `, malformed ${analysis.ignored.malformedJson}`
      + `, unknown schema ${analysis.ignored.unknownSchemaVersion}`
      + `, unsuccessful ${analysis.ignored.unsuccessfulRecords}`
      + `, catalog-only ${analysis.ignored.catalogOnly}`
      + `, no completed attempt ${analysis.ignored.noCompletedAttempt}`
      + `, invalid maximum ${analysis.ignored.invalidMaximum}`
      + `, unreadable or vanished ${analysis.ignored.readFailures}`,
    `minimum: ${secondsText(analysis.minimumSeconds)}`,
    `maximum: ${secondsText(analysis.maximumSeconds)}`,
    `p50: ${secondsText(analysis.p50Seconds)}`,
    `p95: ${secondsText(analysis.p95Seconds)}`,
  ];
  const p99Suffix = analysis.p99Sufficient ? "" : " (insufficient: fewer than 100 eligible samples)";
  lines.push(`p99: ${secondsText(analysis.p99Seconds)}${p99Suffix}`);
  lines.push(`at or above thresholds: ${analysis.thresholds
    .map((threshold) => `${threshold.minutes}min ${threshold.count} (${threshold.percentage.toFixed(1)}%)`)
    .join(" · ")}`);
  lines.push(
    "even 100 local runs can be unrepresentative: role, model, provider, tool, and workload mix affect the distribution; threshold changes require human review",
  );
  return lines.join("\n");
}

/**
 * Scans one diagnostics directory read-only. A file that vanishes mid-scan
 * (another local Pi process pruning it) or a malformed JSON file never fails
 * the scan; both are counted separately. Every `*.json` entry is `lstat`ed
 * with no-follow semantics before it is read: non-regular entries (symlinks,
 * FIFOs) are never opened, and regular files over the byte cap are never
 * read into memory.
 */
export async function scanProgressGapRecords(
  directory: string,
  readFileText: (filePath: string) => Promise<string> = (filePath) => readFile(filePath, "utf8"),
): Promise<ProgressGapAnalysis> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    // A missing or unreadable directory yields an empty aggregate, never an error.
    return analyzeRecords([]);
  }
  const parsed: unknown[] = [];
  const ignored: Partial<Record<IgnoredReason, number>> = { malformedJson: 0, readFailures: 0 };
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(directory, name);
    let info;
    try {
      // No-follow check: a symlink or FIFO named *.json is never followed
      // or opened (a FIFO could block the scan indefinitely).
      info = await lstat(filePath);
    } catch {
      // A vanished file (ENOENT from concurrent pruning) and any other
      // metadata failure are excluded without failing the scan.
      ignored.readFailures = (ignored.readFailures ?? 0) + 1;
      continue;
    }
    // Skipped non-regular or over-cap entries count as read failures, the
    // closest existing ignored category, so the aggregate output is unchanged.
    if (!info.isFile() || info.size > SCAN_MAX_RECORD_BYTES) {
      ignored.readFailures = (ignored.readFailures ?? 0) + 1;
      continue;
    }
    let text: string;
    try {
      text = await readFileText(filePath);
    } catch {
      // A vanished file (ENOENT from concurrent pruning) and any other read
      // failure are excluded without failing the scan.
      ignored.readFailures = (ignored.readFailures ?? 0) + 1;
      continue;
    }
    try {
      parsed.push(JSON.parse(text));
    } catch {
      ignored.malformedJson = (ignored.malformedJson ?? 0) + 1;
    }
  }
  return analyzeRecords(parsed, ignored);
}

/** Full analysis over the delegated-pi-loop diagnostics directory. */
export async function analyzeProgressGaps(directory: string = diagnosticsDirectory()): Promise<ProgressGapAnalysis> {
  return scanProgressGapRecords(directory);
}

const isDirectExecution = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  console.log(formatProgressGapAnalysis(await analyzeProgressGaps()));
}
