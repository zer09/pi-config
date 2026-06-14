/**
 * Environment configuration parsing for the CodeGraph Pi extension.
 *
 * The extension reads environment variables once during registration so tool
 * calls within a session share the same auto-init and sync behavior.
 */

import { DEFAULT_SYNC_TTL_MS } from "./constants.ts";
import type { AutoInitPolicy } from "./types.ts";

/**
 * Read the extension-level sync TTL from CODEGRAPH_PI_SYNC_TTL_MS.
 *
 * @returns A finite millisecond TTL; defaults to 10 seconds when unset/invalid.
 * A negative value disables automatic query-time sync.
 *
 * @example
 * ```ts
 * const syncTtlMs = parseSyncTtlMs();
 * ```
 */
export function parseSyncTtlMs(): number {
  const raw = process.env.CODEGRAPH_PI_SYNC_TTL_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SYNC_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SYNC_TTL_MS;
}

/**
 * Read the auto-initialization policy from CODEGRAPH_PI_AUTO_INIT.
 *
 * @returns `confirm`, `always`, or `never`; invalid values fall back to
 * `confirm` to avoid silent state changes.
 *
 * @example
 * ```ts
 * const autoInitPolicy = parseAutoInitPolicy();
 * ```
 */
export function parseAutoInitPolicy(): AutoInitPolicy {
  const raw = (process.env.CODEGRAPH_PI_AUTO_INIT ?? "confirm").toLowerCase();
  if (raw === "always" || raw === "never" || raw === "confirm") return raw;
  return "confirm";
}
