import assert from "node:assert/strict";
import { after, test } from "node:test";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeProgressGaps,
  analyzeRecords,
  eligibleGap,
  formatProgressGapAnalysis,
  nearestRankPercentile,
  P99_MINIMUM_SAMPLES,
  SCAN_MAX_RECORD_BYTES,
  scanProgressGapRecords,
} from "./analyze-progress-gaps.ts";

/** Owned synthetic-diagnostics root; never the user's real diagnostics directory. */
const ownedRoot = await mkdtemp(path.join(os.tmpdir(), "delegate-analyzer-test-"));
const ownedDirectory = path.join(ownedRoot, "logs", "delegated-pi-loop");

after(async () => {
  await rm(ownedRoot, { recursive: true, force: true });
});

async function writeRecord(name: string, record: unknown, writtenAt?: Date): Promise<void> {
  await mkdir(ownedDirectory, { mode: 0o700, recursive: true });
  const filePath = path.join(ownedDirectory, name);
  await writeFile(filePath, typeof record === "string" ? record : `${JSON.stringify(record)}\n`, { mode: 0o600 });
  if (writtenAt !== undefined) await utimes(filePath, writtenAt, writtenAt);
}

function completedRecord(maxProgressIdleSeconds: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 7,
    state: "completed",
    attempts: [{ route: "prov/model:high", state: "completed", elapsedSeconds: 10, maxProgressIdleSeconds }],
    ...extra,
  };
}

test("nearest-rank percentiles use rank = ceil(p * n) exactly", () => {
  // n = 100: p50 rank 50, p95 rank 95, p99 rank 99.
  const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(nearestRankPercentile(hundred, 0.5), 50);
  assert.equal(nearestRankPercentile(hundred, 0.95), 95);
  assert.equal(nearestRankPercentile(hundred, 0.99), 99);
  // n = 1: every percentile rank clamps up to the single value.
  assert.equal(nearestRankPercentile([42], 0.5), 42);
  assert.equal(nearestRankPercentile([42], 0.99), 42);
  // n = 200: p95 rank 190, p99 rank 198.
  const twoHundred = Array.from({ length: 200 }, (_, index) => index + 1);
  assert.equal(nearestRankPercentile(twoHundred, 0.95), 190);
  assert.equal(nearestRankPercentile(twoHundred, 0.99), 198);
  // Values are selected unrounded: the selected element is exact.
  assert.equal(nearestRankPercentile([1.25, 2.5, 9.75], 0.5), 2.5);
  assert.equal(nearestRankPercentile([], 0.5), undefined);
});

test("eligible records require schema 7, completed invocation, and a completed attempt with a valid maximum", () => {
  assert.deepEqual(eligibleGap(completedRecord(12.3)), { status: "eligible", value: 12.3 });
  // Zero is a valid measurement.
  assert.deepEqual(eligibleGap(completedRecord(0)), { status: "eligible", value: 0 });
  // Historical schema 3-6 and unknown versions.
  for (const schemaVersion of [3, 4, 5, 6]) {
    assert.deepEqual(
      eligibleGap({ ...completedRecord(1), schemaVersion }),
      { status: "ignored", reason: "historicalSchema" },
      `schema ${schemaVersion}`,
    );
  }
  for (const schemaVersion of [1, 2, 8, 99]) {
    assert.deepEqual(
      eligibleGap({ ...completedRecord(1), schemaVersion }),
      { status: "ignored", reason: "unknownSchemaVersion" },
      `schema ${schemaVersion}`,
    );
  }
  assert.deepEqual(eligibleGap({ ...completedRecord(1), schemaVersion: "7" }), { status: "ignored", reason: "unknownSchemaVersion" });
  // Unsuccessful records never contribute.
  assert.deepEqual(eligibleGap({ ...completedRecord(1), state: "stalled" }), { status: "ignored", reason: "unsuccessfulRecords" });
  // Catalog-only histories form their own ignored category, taking
  // precedence over the unsuccessful and no-completed-attempt checks they
  // would otherwise fall into: the writer-reachable routes_unavailable shape
  // (only catalog-unavailable attempts) and the synthetic completed shape.
  assert.deepEqual(
    eligibleGap({
      schemaVersion: 7,
      state: "routes_unavailable",
      attempts: [{ route: "prov/a:high", state: "catalog_unavailable", elapsedSeconds: 1 }],
    }),
    { status: "ignored", reason: "catalogOnly" },
  );
  assert.deepEqual(
    eligibleGap({ ...completedRecord(1), attempts: [{ state: "catalog_unavailable" }] }),
    { status: "ignored", reason: "catalogOnly" },
  );
  // A completed invocation without any completed attempt (fallback-only
  // history) contributes nothing.
  assert.deepEqual(
    eligibleGap({ ...completedRecord(1), attempts: [{ state: "stalled", maxProgressIdleSeconds: 900 }] }),
    { status: "ignored", reason: "noCompletedAttempt" },
  );
  // Missing, negative, and non-finite maxima on the completed attempt.
  for (const invalid of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      eligibleGap({ ...completedRecord(1), attempts: [{ state: "completed", maxProgressIdleSeconds: invalid }] }),
      { status: "ignored", reason: "invalidMaximum" },
      String(invalid),
    );
  }
  // Non-object records count as malformed.
  assert.deepEqual(eligibleGap(null), { status: "ignored", reason: "malformedJson" });
  assert.deepEqual(eligibleGap([1, 2]), { status: "ignored", reason: "malformedJson" });
});

test("the default sample takes the completed attempt and ignores fallback attempts", () => {
  // A stalled fallback attempt carries a huge value, but only the completed
  // supervised attempt defines the eligible sample.
  const record = {
    schemaVersion: 7,
    state: "completed",
    attempts: [
      { route: "prov/a:high", state: "stalled", maxProgressIdleSeconds: 9999 },
      { route: "prov/b:high", state: "completed", maxProgressIdleSeconds: 123.4 },
    ],
  };
  assert.deepEqual(eligibleGap(record), { status: "eligible", value: 123.4 });
  // A catalog skip before the completed attempt never makes the history
  // catalog-only: the mixed chain stays eligible through its completed
  // supervised attempt.
  const mixed = {
    schemaVersion: 7,
    state: "completed",
    attempts: [
      { route: "prov/a:high", state: "catalog_unavailable", elapsedSeconds: 1 },
      { route: "prov/b:high", state: "completed", maxProgressIdleSeconds: 45.6 },
    ],
  };
  assert.deepEqual(eligibleGap(mixed), { status: "eligible", value: 45.6 });
});

test("records shaped like the bounded writer stay eligible through their retained terminal attempt", () => {
  // Fixed-writer shape for a twelve-attempt history: the bounded slice
  // keeps nine earlier attempts plus the terminal completed attempt.
  const fixedWriter = {
    schemaVersion: 7,
    state: "completed",
    attempts: [
      ...Array.from({ length: 9 }, () => ({
        route: "prov/a:high",
        state: "stalled",
        maxProgressIdleSeconds: 9999,
      })),
      { route: "prov/b:high", state: "completed", maxProgressIdleSeconds: 321.5 },
    ],
  };
  assert.deepEqual(eligibleGap(fixedWriter), { status: "eligible", value: 321.5 });
  // Legacy pre-fix shape: ten serialized attempts whose completed tail was
  // truncated away stays ignored as noCompletedAttempt, never guessed at.
  const legacyTruncated = {
    schemaVersion: 7,
    state: "completed",
    attempts: Array.from({ length: 10 }, () => ({
      route: "prov/a:high",
      state: "stalled",
      maxProgressIdleSeconds: 9999,
    })),
  };
  assert.deepEqual(eligibleGap(legacyTruncated), { status: "ignored", reason: "noCompletedAttempt" });
});

test("analyzeRecords reports counts, extrema, percentiles, and thresholds", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 299, 301, 599, 601, 899, 901, 1199, 1201, 1799, 2700];
  const analysis = analyzeRecords(values.map((value) => completedRecord(value)));
  assert.equal(analysis.eligibleCount, 20);
  assert.equal(analysis.recordsScanned, 20);
  assert.equal(analysis.minimumSeconds, 1);
  assert.equal(analysis.maximumSeconds, 2700);
  // rank = ceil(0.5*20) = 10 -> sorted[9] = 10; ceil(0.95*20) = 19 -> 2700's
  // neighbor: sorted[18] = 2699? No: sorted ascending index 18 is 1799... the
  // fixture is already ascending: p95 = value at rank 19 = 1799.
  assert.equal(analysis.p50Seconds, 10);
  assert.equal(analysis.p95Seconds, 1799);
  assert.equal(analysis.p99Seconds, 2700);
  assert.equal(analysis.p99Sufficient, false);
  const thresholds = new Map(analysis.thresholds.map((entry) => [entry.minutes, entry]));
  assert.equal(thresholds.get(5)!.count, 9);
  assert.equal(thresholds.get(5)!.percentage, 45);
  assert.equal(thresholds.get(10)!.count, 7);
  assert.equal(thresholds.get(15)!.count, 5);
  assert.equal(thresholds.get(20)!.count, 3);
  assert.equal(thresholds.get(30)!.count, 1);
  assert.equal(thresholds.get(45)!.count, 1);
});

test("analyzeRecords counts every ignored category separately", () => {
  const analysis = analyzeRecords([
    completedRecord(10),
    { ...completedRecord(10), schemaVersion: 6 },
    { ...completedRecord(10), schemaVersion: 5 },
    { ...completedRecord(10), schemaVersion: 9 },
    { ...completedRecord(10), state: "stalled" },
    { ...completedRecord(10), attempts: [] },
    { ...completedRecord(10), attempts: [{ state: "completed" }] },
    { ...completedRecord(10), state: "routes_unavailable", attempts: [{ state: "catalog_unavailable" }] },
    null,
  ]);
  assert.equal(analysis.eligibleCount, 1);
  assert.equal(analysis.ignored.historicalSchema, 2);
  assert.equal(analysis.ignored.unknownSchemaVersion, 1);
  assert.equal(analysis.ignored.unsuccessfulRecords, 1);
  assert.equal(analysis.ignored.catalogOnly, 1);
  assert.equal(analysis.ignored.noCompletedAttempt, 1);
  assert.equal(analysis.ignored.invalidMaximum, 1);
  assert.equal(analysis.ignored.malformedJson, 1);
  assert.equal(analysis.recordsScanned, 9);
  // The formatted report shows the catalog-only count as its own category.
  assert.match(formatProgressGapAnalysis(analysis), /catalog-only 1/);
});

test("an empty sample reports unavailable aggregates without failing", () => {
  const analysis = analyzeRecords([]);
  assert.equal(analysis.eligibleCount, 0);
  assert.equal(analysis.minimumSeconds, undefined);
  assert.equal(analysis.p50Seconds, undefined);
  assert.equal(analysis.p99Seconds, undefined);
  assert.equal(analysis.p99Sufficient, false);
  const text = formatProgressGapAnalysis(analysis);
  assert.match(text, /eligible samples: 0/);
  assert.match(text, /minimum: unavailable/);
});

test("fewer than 100 eligible samples label p99 as insufficient; 100 or more do not", () => {
  const below = analyzeRecords(Array.from({ length: P99_MINIMUM_SAMPLES - 1 }, () => completedRecord(5)));
  assert.equal(below.p99Sufficient, false);
  assert.match(formatProgressGapAnalysis(below), /p99: [^\n]*\(insufficient: fewer than 100 eligible samples\)/);
  const atMinimum = analyzeRecords(Array.from({ length: P99_MINIMUM_SAMPLES }, (_, index) => completedRecord(index + 1)));
  assert.equal(atMinimum.p99Sufficient, true);
  assert.doesNotMatch(formatProgressGapAnalysis(atMinimum), /insufficient/);
  // Exact nearest rank at exactly 100 samples: rank 99 -> sorted[98] = 99.
  assert.equal(atMinimum.p99Seconds, 99);
});

test("scan tolerates malformed JSON and vanished files and keeps directory contents unchanged", async () => {
  await writeRecord("a-completed.json", completedRecord(120));
  await writeRecord("b-malformed.json", "{not json");
  await writeRecord("c-historical.json", { ...completedRecord(9), schemaVersion: 4 });
  const before = new Map(await Promise.all((await readdir(ownedDirectory)).map(async (name) => {
    const filePath = path.join(ownedDirectory, name);
    return [name, { content: await readFile(filePath, "utf8"), mtime: (await lstat(filePath)).mtimeMs }] as const;
  })));
  const analysis = await scanProgressGapRecords(ownedDirectory, async (filePath) => {
    // Cross-process-style disappearance: one file vanishes mid-scan.
    if (filePath.endsWith("a-completed.json")) {
      const error = new Error("vanished") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return readFile(filePath, "utf8");
  });
  assert.equal(analysis.eligibleCount, 0);
  assert.equal(analysis.ignored.readFailures, 1);
  assert.equal(analysis.ignored.malformedJson, 1);
  assert.equal(analysis.ignored.historicalSchema, 1);
  // Read-only: byte content and mtimes are unchanged.
  for (const [name, entry] of before) {
    const filePath = path.join(ownedDirectory, name);
    assert.equal(await readFile(filePath, "utf8"), entry.content, name);
    assert.equal((await lstat(filePath)).mtimeMs, entry.mtime, name);
  }
  await rm(ownedDirectory, { recursive: true, force: true });
});

test("scan skips symlinks and oversized regular files without reading them", async () => {
  await writeRecord("a-completed.json", completedRecord(120));
  // A symlink to a real record, a dangling symlink, and a sparse oversized
  // file (truncated to just above the cap, not megabytes of real data).
  await symlink(path.join(ownedDirectory, "a-completed.json"), path.join(ownedDirectory, "b-symlink.json"));
  await symlink(path.join(ownedDirectory, "does-not-exist.json"), path.join(ownedDirectory, "c-dangling.json"));
  const oversized = path.join(ownedDirectory, "d-oversized.json");
  await writeFile(oversized, "{}\n", { mode: 0o600 });
  await truncate(oversized, SCAN_MAX_RECORD_BYTES + 1);
  const readFiles: string[] = [];
  const analysis = await scanProgressGapRecords(ownedDirectory, async (filePath) => {
    readFiles.push(path.basename(filePath));
    return readFile(filePath, "utf8");
  });
  // Only the one regular in-bounds record is opened; the three skipped
  // entries count as unreadable and the aggregates stay correct.
  assert.deepEqual(readFiles, ["a-completed.json"]);
  assert.equal(analysis.recordsScanned, 4);
  assert.equal(analysis.eligibleCount, 1);
  assert.equal(analysis.ignored.readFailures, 3);
  assert.equal(analysis.minimumSeconds, 120);
  assert.equal(analysis.p50Seconds, 120);
  // Read-only scan: the skipped entries themselves are untouched.
  assert.ok((await lstat(path.join(ownedDirectory, "b-symlink.json"))).isSymbolicLink());
  assert.ok((await lstat(path.join(ownedDirectory, "c-dangling.json"))).isSymbolicLink());
  assert.equal((await lstat(oversized)).size, SCAN_MAX_RECORD_BYTES + 1);
  await rm(ownedDirectory, { recursive: true, force: true });
});

test("scan over a missing directory yields an empty aggregate", async () => {
  const analysis = await scanProgressGapRecords(path.join(ownedRoot, "does-not-exist"));
  assert.equal(analysis.recordsScanned, 0);
  assert.equal(analysis.eligibleCount, 0);
});

test("at least 100 samples scan end to end with exact aggregate output and no privacy leaks", async () => {
  // 120 eligible values plus poisoned extra fields that must never surface.
  const poison = {
    label: "/home/gc/PRIVATE_PATH",
    role: "sk-SECRET_TOKEN",
    providerFailureCategory: "provider-body PRIVATE",
    lastEvent: "SECRET-PROMPT-TEXT",
    lastEventDetail: "SECRET-REPORT-BODY",
    digest: "4f2a9c1b8e7d",
    hmacKey: "RAW-KEY-MATERIAL",
    writtenAt: "2026-01-01T00:00:00.000Z",
    rawError: "TypeError: SECRET stack trace",
  };
  for (let index = 0; index < 120; index += 1) {
    await writeRecord(`success-v7-run-${String(index).padStart(3, "0")}.json`, completedRecord(index + 1, poison));
  }
  await writeRecord("failure-run.json", { ...completedRecord(50, poison), state: "stalled" });
  const before = await readdir(ownedDirectory);
  const analysis = await analyzeProgressGaps(ownedDirectory);
  const text = formatProgressGapAnalysis(analysis);
  assert.equal(analysis.eligibleCount, 120);
  assert.equal(analysis.recordsScanned, 121);
  assert.equal(analysis.ignored.unsuccessfulRecords, 1);
  assert.equal(analysis.minimumSeconds, 1);
  assert.equal(analysis.maximumSeconds, 120);
  assert.equal(analysis.p50Seconds, 60);
  assert.equal(analysis.p95Seconds, 114);
  assert.equal(analysis.p99Seconds, 119);
  assert.equal(analysis.p99Sufficient, true);
  // Aggregate-only output: aggregates and category counts, nothing else.
  for (const forbidden of [
    "PRIVATE_PATH",
    "SECRET",
    "TOKEN",
    "provider-body",
    "PROMPT",
    "REPORT",
    "4f2a9c1b8e7d",
    "RAW-KEY",
    "2026-01-01",
    "TypeError",
    "success-v7-run",
    "failure-run",
    "prov/model",
  ]) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
  assert.match(text, /records scanned: 121/);
  assert.match(text, /eligible samples: 120/);
  assert.match(text, /p99: 119\.0s/);
  // Every fixture value stays below five minutes: the first threshold
  // bucket proves the count-and-percentage surface without huge fixtures.
  assert.match(text, /5min 0 \(0\.0%\)/);
  // Read-only scan: the directory is byte-for-byte unchanged.
  assert.deepEqual(await readdir(ownedDirectory), before);
  await rm(ownedDirectory, { recursive: true, force: true });
});

test("formatted output rounds display values to one decimal without pre-rounding selection", () => {
  const analysis = analyzeRecords([
    completedRecord(1.25),
    completedRecord(2.44),
    completedRecord(400),
  ]);
  assert.equal(analysis.p50Seconds, 2.44);
  const text = formatProgressGapAnalysis(analysis);
  assert.match(text, /p50: 2\.4s/);
  assert.match(text, /maximum: 400\.0s/);
  // Percentage display also uses one decimal.
  assert.match(text, /5min 1 \(33\.3%\)/);
});
