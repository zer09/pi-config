import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { redactSecrets, type SecretForRedaction } from "./redact.js";
import type { ContentCacheEntry, StoredSearchResponse } from "./types.js";

const SAFE_RESPONSE_ID = /^[A-Za-z0-9._-]+$/;
const CLEANUP_WRITE_INTERVAL = 25;
const cleanupWriteCounters = new Map<string, number>();

export function generateResponseId(): string {
  return `wse_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;
}

export function sanitizeResponseId(responseId: string): string {
  if (!SAFE_RESPONSE_ID.test(responseId)) throw new Error("Invalid responseId");
  return responseId;
}

export function responsesDir(cacheDir: string): string {
  return join(cacheDir, "responses");
}

export function contentsDir(cacheDir: string): string {
  return join(cacheDir, "contents");
}

export function responsePath(cacheDir: string, responseId: string): string {
  return join(responsesDir(cacheDir), `${sanitizeResponseId(responseId)}.json`);
}

export function contentPath(cacheDir: string, cacheKey: string): string {
  if (!/^[a-f0-9]{64}$/.test(cacheKey)) throw new Error("Invalid content cache key");
  return join(contentsDir(cacheDir), `${cacheKey}.json`);
}

async function atomicWriteJson(path: string, value: unknown, secrets: SecretForRedaction[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
  const redacted = redactSecrets(value, secrets);
  await writeFile(tempPath, `${JSON.stringify(redacted, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

function shouldRunCleanup(dir: string): boolean {
  const count = (cleanupWriteCounters.get(dir) ?? 0) + 1;
  if (count < CLEANUP_WRITE_INTERVAL) {
    cleanupWriteCounters.set(dir, count);
    return false;
  }
  cleanupWriteCounters.set(dir, 0);
  return true;
}

async function cleanupExpiredFiles(dir: string, now = Date.now()): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const path = join(dir, entry.name);
        try {
          const json = JSON.parse(await readFile(path, "utf8")) as { expiresAt?: unknown };
          if (typeof json.expiresAt === "number" && json.expiresAt <= now) await unlink(path);
        } catch {
          // Ignore corrupt or concurrently removed cache files during opportunistic cleanup.
        }
      }),
  );
}

export async function writeStoredResponse(
  cacheDir: string,
  record: StoredSearchResponse,
  secrets: SecretForRedaction[],
): Promise<void> {
  await atomicWriteJson(responsePath(cacheDir, record.responseId), record, secrets);
  const dir = responsesDir(cacheDir);
  if (shouldRunCleanup(dir)) await cleanupExpiredFiles(dir);
}

export async function readStoredResponse(cacheDir: string, responseId: string): Promise<StoredSearchResponse> {
  const path = responsePath(cacheDir, responseId);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Stored response ${responseId} was not found or has expired.`);
    }
    throw error;
  }

  const record = JSON.parse(text) as StoredSearchResponse;
  if (typeof record.expiresAt === "number" && record.expiresAt <= Date.now()) {
    await unlink(path).catch(() => undefined);
    throw new Error(`Stored response ${responseId} was not found or has expired.`);
  }
  return record;
}

export async function writeContentCacheEntry(
  cacheDir: string,
  cacheKey: string,
  entry: ContentCacheEntry,
  secrets: SecretForRedaction[],
): Promise<void> {
  await atomicWriteJson(contentPath(cacheDir, cacheKey), entry, secrets);
  const dir = contentsDir(cacheDir);
  if (shouldRunCleanup(dir)) await cleanupExpiredFiles(dir);
}

export async function readContentCacheEntry(cacheDir: string, cacheKey: string): Promise<ContentCacheEntry | null> {
  const path = contentPath(cacheDir, cacheKey);
  try {
    const entry = JSON.parse(await readFile(path, "utf8")) as ContentCacheEntry;
    if (typeof entry.expiresAt === "number" && entry.expiresAt > Date.now()) return entry;
    await unlink(path).catch(() => undefined);
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
