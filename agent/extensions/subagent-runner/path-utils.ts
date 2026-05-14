import { basename, join, resolve } from "node:path";
import { HOME_PREFIX, SUBAGENT_ROOT } from "./constants.ts";

export function sanitizeSlug(value: string, fallback = "default"): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return slug && slug !== "." && slug !== ".." ? slug : fallback;
}

export function deriveWorkstream(
  cwd: string,
  task: string,
  explicit?: string,
): string {
  if (explicit?.trim()) return sanitizeSlug(explicit.trim(), "default");
  const cwdName = sanitizeSlug(
    basename(cwd).replace(/^\.+/, "") || "root",
    "root",
  );
  const taskSlug = sanitizeSlug(
    task.split(/\s+/).slice(0, 6).join("-"),
    "task",
  );
  return sanitizeSlug(`${cwdName}-${taskSlug}`, "default");
}

export function expandHomePath(value: string): string {
  return value === "~"
    ? HOME_PREFIX
    : value.startsWith("~/")
      ? join(HOME_PREFIX, value.slice(2))
      : value;
}

export function resolveCwd(input: string | undefined, base: string): string {
  const expandedBase = expandHomePath(base);
  const raw = input?.trim() || expandedBase;
  return resolve(expandedBase, expandHomePath(raw));
}

export function buildSessionDir(workstream: string, agent: string): string {
  const safeWorkstream = sanitizeSlug(workstream, "default");
  const safeAgent = sanitizeSlug(agent, "agent");
  const dir = resolve(SUBAGENT_ROOT, safeWorkstream, safeAgent);
  const root = resolve(SUBAGENT_ROOT);
  if (dir !== root && dir.startsWith(`${root}/`)) return dir;
  throw new Error("Invalid sub-agent session directory");
}

export function replaceHome(value: string): string {
  const replaced = value.startsWith(HOME_PREFIX)
    ? `~${value.slice(HOME_PREFIX.length)}`
    : value.replaceAll(HOME_PREFIX, "~");
  return replaced.replace(/(["'`])~(\/[^"'`]*?)\1/g, "~$2");
}
