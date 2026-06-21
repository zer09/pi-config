import path from "node:path";
import type { FileRecord } from "@colbymchenry/codegraph";
import { expandHome, isPathInside, normalizeSlashes, stripAtPath } from "../../paths.ts";
import type { FilesToolParams } from "../../types.ts";
import type { NormalizedFilters } from "./types.ts";

export function normalizeFilters(params: FilesToolParams, root: string): NormalizedFilters {
  const pattern = params.pattern?.trim() ? normalizeSlashes(params.pattern.trim()) : undefined;
  const query = normalizeQuery(params.query);
  const language = params.language?.trim().toLowerCase() || undefined;
  const pathInput = params.path?.trim() || undefined;
  return {
    pathInput,
    pathFilter: normalizeFilesPathFilter(pathInput, root),
    pattern,
    patternRegex: pattern ? globToRegex(pattern) : undefined,
    query,
    language,
    errorsOnly: params.errorsOnly === true,
  };
}

function normalizeQuery(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return normalizeSlashes(stripAtPath(value.trim())).toLowerCase();
}

function normalizeFilesPathFilter(value: string | undefined, root: string): string {
  const stripped = stripAtPath(value?.trim() || "");
  if (isRootishPath(stripped)) return "";

  let raw = expandHome(stripped);
  if (path.isAbsolute(raw)) {
    const absolute = path.resolve(raw);
    if (isPathInside(root, absolute)) {
      raw = path.relative(root, absolute);
    }
  }

  let normalized = normalizeSlashes(raw.trim());
  if (isRootishPath(normalized)) return "";
  normalized = normalized
    .replace(/^(?:\.?\/+)+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function isRootishPath(value: string): boolean {
  const normalized = normalizeSlashes(value.trim());
  return normalized === "" || normalized === "." || /^\.?\/+$/u.test(normalized);
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(escaped);
}

export function matchesFilters(file: FileRecord, filters: NormalizedFilters): boolean {
  const filePath = normalizeSlashes(file.path);
  if (filters.pathFilter && !fileUnderPath(filePath, filters.pathFilter)) return false;
  if (filters.patternRegex && !filters.patternRegex.test(filePath)) return false;
  if (filters.query && !filePath.toLowerCase().includes(filters.query)) return false;
  if (filters.language && String(file.language).toLowerCase() !== filters.language) return false;
  if (filters.errorsOnly && errorCount(file) === 0) return false;
  return true;
}

function fileUnderPath(filePath: string, filter: string): boolean {
  return filePath === filter || filePath.startsWith(`${filter}/`);
}

function errorCount(file: FileRecord): number {
  return file.errors?.length ?? 0;
}

export function detailsFilters(filters: NormalizedFilters): Record<string, unknown> {
  return {
    path: filters.pathFilter || undefined,
    pathInput: filters.pathInput,
    pattern: filters.pattern,
    query: filters.query,
    language: filters.language,
    errorsOnly: filters.errorsOnly || undefined,
  };
}
