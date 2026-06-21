import type { FileRecord } from "@colbymchenry/codegraph";
import type { FilesToolParams } from "../../types.ts";
import { MAX_FILES_LIMIT, OFFSET_ONLY_PAGE_SIZE } from "./types.ts";
import type { FilePage } from "./types.ts";

export function paginateFiles(files: readonly FileRecord[], params: FilesToolParams): FilePage {
  const offset = coerceOffset(params.offset);
  let limit = coerceOptionalLimit(params.limit);
  let offsetOnlyDefault = false;
  if (limit === undefined && offset > 0) {
    limit = OFFSET_ONLY_PAGE_SIZE;
    offsetOnlyDefault = true;
  }
  const pageFiles = limit === undefined ? files.slice(offset) : files.slice(offset, offset + limit);
  return { files: pageFiles, offset, limit, offsetOnlyDefault };
}

function coerceOffset(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, n);
}

function coerceOptionalLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(MAX_FILES_LIMIT, Math.floor(value)));
}
