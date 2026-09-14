import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_AGE_MS = 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export interface CodexUsageWindow {
  readonly remainingPercent: number;
  /** Epoch seconds, as returned by the usage endpoint. */
  readonly resetAt?: number;
}

export interface CodexUsageRecord {
  readonly providerId: string;
  readonly fetchedAt: number;
  readonly allowed: boolean;
  readonly primary?: CodexUsageWindow;
  readonly secondary?: CodexUsageWindow;
}

export interface CodexUsageCacheOptions {
  readonly cachePath?: string;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly resolveAuth: (providerId: string) => Promise<{
    readonly auth: { readonly apiKey?: string };
  } | undefined>;
}

export interface CodexUsageCache {
  getFreshSnapshot(): Readonly<Partial<Record<string, CodexUsageRecord>>>;
  invalidate(providerId: string): Promise<void>;
  refresh(request?: {
    readonly forcedProviderIds?: readonly string[];
    readonly candidateProviderIds?: readonly string[];
  }): Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseWindow(value: unknown): CodexUsageWindow | undefined {
  if (!isObject(value) || !isNonNegative(value.remainingPercent) || value.remainingPercent > 100) return;
  if (Object.hasOwn(value, "resetAt") && (!isNonNegative(value.resetAt) || value.resetAt === 0)) return;
  return Object.freeze({
    remainingPercent: value.remainingPercent,
    ...(typeof value.resetAt === "number" ? { resetAt: value.resetAt } : {}),
  });
}

function parseRecord(value: unknown): CodexUsageRecord | undefined {
  if (
    !isObject(value)
    || typeof value.providerId !== "string" || !value.providerId.trim()
    || !isNonNegative(value.fetchedAt) || typeof value.allowed !== "boolean"
  ) return;
  const primary = parseWindow(value.primary);
  const secondary = parseWindow(value.secondary);
  if (Object.hasOwn(value, "primary") && !primary) return;
  if (Object.hasOwn(value, "secondary") && !secondary) return;
  if (!primary && !secondary) return;
  return Object.freeze({
    providerId: value.providerId,
    fetchedAt: value.fetchedAt,
    allowed: value.allowed,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
  });
}

function parseUsage(providerId: string, fetchedAt: number, payload: unknown): CodexUsageRecord | undefined {
  if (!isObject(payload) || !isObject(payload.rate_limit)) return;
  const rateLimit = payload.rate_limit;
  const record: Record<string, unknown> = { providerId, fetchedAt, allowed: rateLimit.allowed };
  for (const [source, target] of [["primary_window", "primary"], ["secondary_window", "secondary"]]) {
    if (!Object.hasOwn(rateLimit, source)) continue;
    const window = rateLimit[source];
    if (!isObject(window) || !isNonNegative(window.used_percent)) return;
    record[target] = {
      remainingPercent: Math.max(0, Math.min(100, 100 - window.used_percent)),
      ...(Object.hasOwn(window, "reset_at") ? { resetAt: window.reset_at } : {}),
    };
  }
  return parseRecord(record);
}

function isFresh(record: CodexUsageRecord, now: number): boolean {
  if (now < record.fetchedAt || now - record.fetchedAt >= MAX_AGE_MS) return false;
  return [record.primary, record.secondary].every((window) =>
    window?.resetAt === undefined || now / 1000 < window.resetAt);
}

async function loadRecords(cachePath: string): Promise<Map<string, CodexUsageRecord>> {
  try {
    const document: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (!isObject(document) || document.version !== 1 || !Array.isArray(document.entries)) return new Map();
    const records = new Map<string, CodexUsageRecord>();
    for (const value of document.entries) {
      const record = parseRecord(value);
      if (!record) return new Map();
      const previous = records.get(record.providerId);
      if (!previous || record.fetchedAt >= previous.fetchedAt) records.set(record.providerId, record);
    }
    return records;
  } catch {
    return new Map();
  }
}

async function persistRecords(cachePath: string, records: Map<string, CodexUsageRecord>): Promise<void> {
  const directory = path.dirname(cachePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = path.join(directory, `.${path.basename(cachePath)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify({ version: 1, entries: [...records.values()] }, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, cachePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

function accountIdFromToken(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return;
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!isObject(payload) || !isObject(payload["https://api.openai.com/auth"])) return;
    const accountId = payload["https://api.openai.com/auth"].chatgpt_account_id;
    if (typeof accountId === "string" && accountId.trim()) return accountId;
  } catch {
    return;
  }
}

async function readUsageBody(response: Response, signal: AbortSignal, deadline: Promise<never>): Promise<unknown> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    return;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return;
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } finally {
    // Cancellation must not extend the deadline if a stream refuses to settle.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fetchRecord(
  providerId: string,
  resolveAuth: CodexUsageCacheOptions["resolveAuth"],
  fetchUsage: typeof fetch,
  now: () => number,
  signal: AbortSignal,
  deadline: Promise<never>,
): Promise<CodexUsageRecord | undefined> {
  try {
    const resolved = await Promise.race([resolveAuth(providerId), deadline]);
    signal.throwIfAborted();
    const token = resolved?.auth.apiKey;
    if (!token) return;
    const accountId = accountIdFromToken(token);
    if (!accountId) return;
    // A slow older request must not overwrite a sample from a newer request.
    const fetchedAt = now();
    const response = await Promise.race([fetchUsage(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "ChatGPT-Account-Id": accountId,
        "User-Agent": "codex-cli",
      },
      redirect: "manual",
      signal,
    }), deadline]);
    const payload = await readUsageBody(response, signal, deadline);
    signal.throwIfAborted();
    return parseUsage(providerId, fetchedAt, payload);
  } catch {
    // Auth, transport, and body failures leave the previous record untouched.
    return;
  }
}

/** Create one service per cache path; snapshots never read files or resolve auth. */
export async function createCodexUsageCache(options: CodexUsageCacheOptions): Promise<CodexUsageCache> {
  const cachePath = options.cachePath ?? path.join(
    process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"),
    "cache", "delegated-pi-loop", "codex-usage-v1.json",
  );
  const now = options.now ?? Date.now;
  const fetchUsage = options.fetch ?? fetch;
  const records = await loadRecords(cachePath);
  const generations = new Map<string, number>();
  const publishedOrdinals = new Map<string, number>();
  let nextRequestOrdinal = 0;
  let writeQueue = Promise.resolve();

  function update(change: () => boolean): Promise<void> {
    // Queue the merge too, so overlapping refreshes cannot write old snapshots.
    writeQueue = writeQueue.then(async () => {
      if (change()) await persistRecords(cachePath, records);
    }).catch(() => {
      // This cache is best effort. Keep usable memory state without exposing errors.
    });
    return writeQueue;
  }

  return {
    getFreshSnapshot() {
      const timestamp = now();
      const snapshot: Record<string, CodexUsageRecord> = Object.create(null);
      for (const [providerId, record] of records) {
        if (isFresh(record, timestamp)) snapshot[providerId] = record;
      }
      return Object.freeze(snapshot);
    },
    invalidate(providerId) {
      // Reject in-flight samples immediately, even if a disk write is still queued.
      generations.set(providerId, (generations.get(providerId) ?? 0) + 1);
      const deleted = records.delete(providerId);
      return update(() => deleted);
    },
    async refresh({ forcedProviderIds = [], candidateProviderIds = [] } = {}) {
      const timestamp = now();
      const providers = new Set(forcedProviderIds);
      for (const providerId of candidateProviderIds) {
        const record = records.get(providerId);
        if (!record || !isFresh(record, timestamp)) providers.add(providerId);
      }
      if (providers.size === 0) return;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Codex usage refresh timed out"));
        }, options.timeoutMs ?? REFRESH_TIMEOUT_MS);
      });
      try {
        await Promise.race([
          Promise.all([...providers].map(async (providerId) => {
            const generation = generations.get(providerId) ?? 0;
            const requestOrdinal = ++nextRequestOrdinal;
            const record = await fetchRecord(providerId, options.resolveAuth, fetchUsage, now, controller.signal, deadline);
            if (!record) return;
            await update(() => {
              if ((generations.get(providerId) ?? 0) !== generation) return false;
              const previous = records.get(providerId);
              if (previous && previous.fetchedAt > record.fetchedAt) return false;
              // Only a later successful request supersedes an earlier one, even when timestamps tie.
              if ((publishedOrdinals.get(providerId) ?? 0) > requestOrdinal) return false;
              records.set(providerId, record);
              publishedOrdinals.set(providerId, requestOrdinal);
              return true;
            });
          })),
          deadline,
        ]);
      } catch {
        // The shared deadline also bounds waiting for the write queue.
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
