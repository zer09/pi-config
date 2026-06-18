/**
 * Constants shared by the CodeGraph Pi extension.
 *
 * This module centralizes user-visible limits, default timings, and fixed
 * CodeGraph node-kind values so tool definitions and formatting helpers remain
 * consistent across files.
 */

/** Maximum bytes returned in one tool response before head truncation. */
export const DEFAULT_MAX_BYTES = 50 * 1024;

/** Maximum lines returned in one tool response before head truncation. */
export const DEFAULT_MAX_LINES = 2_000;

/** Default TTL for extension-triggered CodeGraph syncs, in milliseconds. */
export const DEFAULT_SYNC_TTL_MS = 10_000;

/** Timeout for `git rev-parse --show-toplevel` used in root detection. */
export const DEFAULT_GIT_TIMEOUT_MS = 2_000;

/** Default maximum number of tool results accepted by shared schemas. */
export const MAX_TOOL_RESULTS = 100;

/** Maximum query/symbol characters passed to SQLite-backed CodeGraph search APIs. */
export const MAX_CODEGRAPH_QUERY_CHARS = 4_096;

/** Fixed set of CodeGraph node kinds exposed by the search tool schema. */
export const NODE_KIND_VALUES = [
  "file",
  "module",
  "class",
  "struct",
  "interface",
  "trait",
  "protocol",
  "function",
  "method",
  "property",
  "field",
  "variable",
  "constant",
  "enum",
  "enum_member",
  "type_alias",
  "namespace",
  "parameter",
  "import",
  "export",
  "route",
  "component",
] as const;
