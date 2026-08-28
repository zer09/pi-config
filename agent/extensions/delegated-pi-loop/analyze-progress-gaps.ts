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
import { constants as fsConstants } from "node:fs";
import { open, readdir } from "node:fs/promises";
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

/**
 * Open flags for one scanned `*.json` entry: read-only, no-follow (a
 * symlink entry fails with ELOOP instead of being followed), and
 * non-blocking (a FIFO entry cannot block the open indefinitely; harmless
 * for regular files).
 */
const SCAN_OPEN_FLAGS: number =
  fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;

/**
 * Minimal structural read-only handle shape the scan uses from one opened
 * `*.json` entry: `stat` for the fstat validation, `read` for the bounded
 * accumulating read loop, and `close` for cleanup. A real `FileHandle`
 * satisfies this shape; tests supply minimal fakes that simulate short
 * reads before EOF and mid-scan growth past the cap.
 */
export interface ReadOnlyEntryHandle {
  stat(): Promise<{ isFile(): boolean; size: number }>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/**
 * Seam for opening one scanned entry with the scan flags above. The
 * analyzer default uses `fs/promises.open`; tests override it with
 * fake read-only handles.
 */
export type OpenEntry = (filePath: string, flags: number) => Promise<ReadOnlyEntryHandle>;

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
 * Streaming fold state: the eligible numeric maximum values plus the
 * per-category ignored counts. Only these aggregates are retained across
 * records, so parsed record objects stay confined to one loop iteration.
 */
interface GapFold {
  readonly values: number[];
  readonly ignored: Record<IgnoredReason, number>;
}

function emptyGapFold(): GapFold {
  return { values: [], ignored: emptyIgnored() };
}

/** Classifies one parsed record into the fold without retaining the record. */
function foldGapRecord(fold: GapFold, record: unknown): void {
  const outcome = eligibleGap(record);
  if (outcome.status === "eligible") fold.values.push(outcome.value);
  else fold.ignored[outcome.reason] += 1;
}

/** Builds the final aggregate from a completed fold. */
function finalizeGapAnalysis(fold: GapFold, scanned: number): ProgressGapAnalysis {
  const { values, ignored } = fold;
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

/**
 * Analyzes parsed records into the aggregate report through the same fold
 * the directory scan streams through, so both entry points produce
 * identical aggregates. Values are kept unrounded for percentile
 * selection; formatting rounds for display only. `scanIgnored` carries
 * scan-layer exclusions (malformed JSON, vanished or unreadable files)
 * that never produce a parsed record.
 */
export function analyzeRecords(
  records: readonly unknown[],
  scanIgnored: Partial<Record<IgnoredReason, number>> = {},
): ProgressGapAnalysis {
  const fold = emptyGapFold();
  for (const record of records) {
    foldGapRecord(fold, record);
  }
  // Scanned records are parsed entries plus scan-layer exclusions; the
  // classified malformed count below must not be added twice.
  const scanned = records.length + (scanIgnored.malformedJson ?? 0) + (scanIgnored.readFailures ?? 0);
  for (const reason of Object.keys(fold.ignored) as IgnoredReason[]) {
    fold.ignored[reason] += scanIgnored[reason] ?? 0;
  }
  return finalizeGapAnalysis(fold, scanned);
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
 * Opens one `*.json` entry once and reads at most `SCAN_MAX_RECORD_BYTES`
 * bytes from that same handle. The handle itself is `fstat`-validated, so a
 * symlink, FIFO, or over-cap entry is never read, and a same-user process
 * replacing or growing the pathname mid-scan cannot change what is read.
 * The read API may return short before EOF, so reads continue from the
 * same handle into the same buffer at advancing offsets until one returns
 * zero bytes (EOF) or the accumulated total passes the cap. Returns
 * `undefined` for a skipped (non-regular or over-cap) entry; any open,
 * fstat, or read failure (including ELOOP and ENOENT) throws.
 */
async function readCappedEntryText(
  openEntry: OpenEntry,
  filePath: string,
): Promise<string | undefined> {
  const handle = await openEntry(filePath, SCAN_OPEN_FLAGS);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > SCAN_MAX_RECORD_BYTES) return undefined;
    // The cap-plus-one buffer lets the accumulating loop below detect an
    // entry that grew past the cap after the fstat above, across partial
    // reads: the cap applies to the accumulated total, not per call.
    const buffer = Buffer.alloc(SCAN_MAX_RECORD_BYTES + 1);
    let totalBytesRead = 0;
    for (;;) {
      const { bytesRead } = await handle.read(
        buffer,
        totalBytesRead,
        buffer.length - totalBytesRead,
        totalBytesRead,
      );
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
      if (totalBytesRead > SCAN_MAX_RECORD_BYTES) return undefined;
    }
    return buffer.subarray(0, totalBytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Scans one diagnostics directory read-only. A file that vanishes mid-scan
 * (another local Pi process pruning it) or a malformed JSON file never fails
 * the scan; both are counted separately. Every `*.json` entry is opened with
 * no-follow, non-blocking, read-only flags and validated by fstat on that
 * same handle before the bounded accumulating read, so the scan never follows
 * a symlink, never blocks on a FIFO, and never reads past the byte cap.
 * Each record is classified during the scan and only its eligible numeric
 * value or ignored-category count is retained, so parsed record objects are
 * never held beyond the current loop iteration.
 */
export async function scanProgressGapRecords(
  directory: string,
  openEntry: OpenEntry = (filePath, flags) => open(filePath, flags),
): Promise<ProgressGapAnalysis> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    // A missing or unreadable directory yields an empty aggregate, never an error.
    return finalizeGapAnalysis(emptyGapFold(), 0);
  }
  const fold = emptyGapFold();
  let scanned = 0;
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(directory, name);
    scanned += 1;
    let text: string | undefined;
    try {
      text = await readCappedEntryText(openEntry, filePath);
    } catch {
      // A vanished file (ENOENT from concurrent pruning), a symlink entry
      // (ELOOP from O_NOFOLLOW), and any other open/fstat/read failure are
      // excluded without failing the scan.
      fold.ignored.readFailures += 1;
      continue;
    }
    if (text === undefined) {
      // Skipped non-regular or over-cap entries count as read failures, the
      // closest existing ignored category, so the aggregate output is unchanged.
      fold.ignored.readFailures += 1;
      continue;
    }
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      fold.ignored.malformedJson += 1;
      continue;
    }
    foldGapRecord(fold, record);
  }
  // `scanned` counts every entry that reached the read attempt, which is
  // exactly parsed records plus malformed JSON plus read failures.
  return finalizeGapAnalysis(fold, scanned);
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
