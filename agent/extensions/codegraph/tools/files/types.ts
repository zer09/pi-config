import type { FileRecord } from "@colbymchenry/codegraph";
import type { FilesFormat } from "../../types.ts";

export const FILES_FORMAT_VALUES = ["tree", "flat", "grouped"] as const;
export const MAX_FILES_LIMIT = 500;
export const OFFSET_ONLY_PAGE_SIZE = 100;

export interface NormalizedFilters {
  readonly pathInput?: string;
  readonly pathFilter: string;
  readonly pattern?: string;
  readonly patternRegex?: RegExp;
  readonly query?: string;
  readonly language?: string;
  readonly errorsOnly: boolean;
}

export interface FilePage {
  readonly files: readonly FileRecord[];
  readonly offset: number;
  readonly limit?: number;
  readonly offsetOnlyDefault: boolean;
}

export interface FilesRenderOptions {
  readonly root: string;
  readonly total: number;
  readonly matched: number;
  readonly page: FilePage;
  readonly format: FilesFormat;
  readonly includeMetadata: boolean;
  readonly includeStats: boolean;
  readonly maxDepth?: number;
  readonly filters: NormalizedFilters;
}
