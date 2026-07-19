/**
 * Path normalization, project-root resolution, and safety checks.
 *
 * CodeGraph indexes whole project roots, so this module isolates filesystem and
 * git probing from the graph-management and tool-execution layers.
 */

import { access, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_GIT_TIMEOUT_MS } from "./constants.ts";
import type { ExtensionAPI } from "./types.ts";

/** Candidate project-root resolution result. */
export interface CandidateRootResult {
  /** Canonical root suitable for initialization, when resolution succeeds. */
  readonly root?: string;
  /** User-facing resolution error, when resolution fails. */
  readonly error?: string;
}

/**
 * Normalize Windows path separators to forward slashes for CodeGraph records.
 *
 * @param value - Path-like string.
 * @returns String with `\\` replaced by `/`.
 *
 * @example
 * ```ts
 * normalizeSlashes("src\\index.ts"); // "src/index.ts"
 * ```
 */
export function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * Remove Pi's `@file` prefix when a path argument is copied from a prompt.
 *
 * @param value - User-supplied path.
 * @returns Path without one leading `@`.
 */
export function stripAtPath(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

/**
 * Expand a leading `~` or `~/` to the current user's home directory.
 *
 * @param value - User-supplied path.
 * @returns Path with home expansion applied.
 */
export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

/**
 * Resolve a user path relative to Pi's current working directory.
 *
 * @param value - Optional user path; empty values fall back to `cwd`.
 * @param cwd - Pi current working directory.
 * @returns Absolute path.
 */
export function resolvePath(value: string | undefined, cwd: string): string {
  const raw = expandHome(stripAtPath(value?.trim() || cwd));
  return path.resolve(cwd, raw);
}

/**
 * Return the nearest existing directory to use for root discovery.
 *
 * @param resolvedPath - Absolute path that may point to a file, directory, or missing path.
 * @returns Directory path when `resolvedPath` is an existing file; otherwise `resolvedPath`.
 */
export async function existingSearchPath(resolvedPath: string): Promise<string> {
  try {
    const s = await stat(resolvedPath);
    const canonical = await canonicalPath(resolvedPath);
    return s.isFile() ? path.dirname(canonical) : canonical;
  } catch {
    return resolvedPath;
  }
}

/**
 * Canonicalize a path with realpath, falling back to path.resolve when missing.
 *
 * @param value - Path to canonicalize.
 * @returns Real path when available; otherwise resolved absolute path.
 */
export async function canonicalPath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch {
    return path.resolve(value);
  }
}

/**
 * Check whether `child` is equal to or contained by `parent`.
 *
 * @param parent - Candidate parent directory.
 * @param child - Candidate child path.
 * @returns True when `child` is inside `parent` or equal to it.
 */
export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Explain why a project root is unsafe to initialize, if applicable.
 *
 * @param projectRoot - Candidate CodeGraph root.
 * @returns A short reason string, or null when the root is safe.
 */
export async function unsafeRootReason(projectRoot: string): Promise<string | null> {
  const root = await canonicalPath(projectRoot);
  const fsRoot = path.parse(root).root;
  if (root === fsRoot) return "filesystem root";

  const home = await canonicalPath(os.homedir());
  if (root === home) return "home directory";
  if (isPathInside(root, home)) return "parent of the home directory";

  return null;
}

/**
 * Resolve the root that should be initialized when no `.codegraph` exists.
 *
 * @param pi - Pi extension API used to ask git for the repository root.
 * @param startPath - Absolute user/cwd-derived path.
 * @param cwd - Pi current working directory.
 * @param explicitProjectPath - Whether the user explicitly supplied projectPath.
 * @param signal - Optional abort signal from the active tool call.
 * @returns Candidate root or a user-facing error.
 */
export async function resolveCandidateRoot(
  pi: ExtensionAPI,
  startPath: string,
  cwd: string,
  explicitProjectPath: boolean,
  signal?: AbortSignal,
): Promise<CandidateRootResult> {
  const searchPath = await existingSearchPath(startPath);

  if (explicitProjectPath) {
    try {
      const s = await stat(searchPath);
      if (!s.isDirectory()) return { error: `projectPath is not a directory: ${searchPath}` };
    } catch {
      return { error: `projectPath does not exist or is not accessible: ${searchPath}` };
    }
  }

  const git = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd: searchPath,
    timeout: DEFAULT_GIT_TIMEOUT_MS,
    signal,
  }).catch(() => undefined);

  if (git?.code === 0 && git.stdout.trim()) {
    return { root: await canonicalPath(git.stdout.trim()) };
  }

  return { root: await canonicalPath(searchPath || cwd) };
}

/**
 * Check whether a filesystem path is accessible.
 *
 * @param filePath - Path to probe.
 * @returns True when the path can be accessed.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
