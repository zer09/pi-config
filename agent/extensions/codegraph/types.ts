/**
 * Shared TypeScript contracts for the CodeGraph Pi extension.
 *
 * This module contains the extension-facing API shapes, tool result contracts,
 * graph readiness state, and parameter interfaces consumed by the focused tool
 * modules. It intentionally has no runtime imports from local modules so it can
 * be used throughout the package without creating circular dependencies.
 */

import type * as CodeGraphTypes from "@colbymchenry/codegraph";
import type { NodeKind } from "@colbymchenry/codegraph";

/** CodeGraph library instance type used by the extension runtime. */
export type CodeGraphInstance = CodeGraphTypes.CodeGraph;

/** Auto-initialization policy read from CODEGRAPH_PI_AUTO_INIT. */
export type AutoInitPolicy = "confirm" | "always" | "never";

/** Result returned by Pi's process execution helper. */
export interface ExecResult {
  /** Captured stdout from the command. */
  readonly stdout: string;
  /** Captured stderr from the command. */
  readonly stderr: string;
  /** Process exit code. */
  readonly code: number;
  /** Whether Pi terminated the process due to timeout/cancellation. */
  readonly killed: boolean;
}

/** Options accepted by Pi's process execution helper. */
export interface ExecOptions {
  /** Working directory for the process. */
  readonly cwd?: string;
  /** Millisecond timeout for the process. */
  readonly timeout?: number;
  /** Abort signal provided by the active tool call. */
  readonly signal?: AbortSignal;
}

/** Minimal Pi extension API surface used by this extension. */
export interface ExtensionAPI {
  /**
   * Register a custom Pi tool.
   *
   * @param tool - Tool definition consumed by Pi.
   * @returns Nothing.
   */
  registerTool<Params extends object>(tool: ToolDefinition<Params>): void;

  /**
   * Subscribe to a Pi lifecycle event.
   *
   * @param event - Event name, such as `session_shutdown`.
   * @param handler - Handler invoked by Pi.
   * @returns Nothing.
   */
  on(event: string, handler: (...args: unknown[]) => unknown): void;

  /**
   * Execute an external command through Pi.
   *
   * @param command - Executable name.
   * @param args - Command-line arguments.
   * @param options - Optional execution settings.
   * @returns Command result with stdout, stderr, exit code, and killed flag.
   */
  exec(command: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult>;
}

/** Minimal Pi tool-call context used by CodeGraph tools. */
export interface ExtensionContext {
  /** Current working directory for the Pi session. */
  readonly cwd: string;
  /** Whether an interactive UI is available for confirmations. */
  readonly hasUI?: boolean;
  /** Pi output mode, e.g. `tui` or `print`. */
  readonly mode?: string;
  /** Abort signal for the active tool call. */
  readonly signal?: AbortSignal;
  /** UI helpers exposed by Pi. */
  readonly ui: {
    /**
     * Ask the user to confirm a state-changing action.
     *
     * @param title - Confirmation title.
     * @param message - Confirmation message.
     * @param options - Optional UI-specific settings.
     * @returns True when the user confirms.
     */
    confirm(title: string, message: string, options?: Record<string, unknown>): Promise<boolean>;
  };
}

/** Text result returned by a Pi tool. */
export interface ToolResult {
  /** Content blocks returned to the model. */
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  /** Structured details retained by Pi for diagnostics/rendering. */
  readonly details: Record<string, unknown>;
}

/** Callback used to stream progress updates from long-running tool calls. */
export type ToolUpdateHandler = (result: ToolResult) => void;

/** Generic Pi custom tool definition used by this extension. */
export interface ToolDefinition<Params extends object = Record<string, unknown>> {
  /** Stable tool name exposed to the model. */
  readonly name: string;
  /** Human-readable label for UI surfaces. */
  readonly label: string;
  /** Tool description shown in the tool catalog. */
  readonly description: string;
  /** Short prompt snippet for system guidance. */
  readonly promptSnippet: string;
  /** Model-facing usage guidance. */
  readonly promptGuidelines: readonly string[];
  /** TypeBox schema for tool parameters. */
  readonly parameters: unknown;
  /**
   * Execute the tool.
   *
   * @param toolCallId - Pi-generated tool call id.
   * @param params - Validated parameter object.
   * @param signal - Abort signal for cancellation.
   * @param onUpdate - Optional streaming progress callback.
   * @param ctx - Pi tool execution context.
   * @returns Tool result.
   */
  execute(
    toolCallId: string,
    params: Params,
    signal: AbortSignal | undefined,
    onUpdate: ToolUpdateHandler | undefined,
    ctx: ExtensionContext,
  ): Promise<ToolResult>;
}

/** Result of truncating a text response for Pi tool output limits. */
export interface TruncationResult {
  /** Possibly truncated content. */
  readonly content: string;
  /** Whether truncation occurred. */
  readonly truncated: boolean;
  /** Total line count before truncation. */
  readonly totalLines: number;
  /** Line count after truncation. */
  readonly outputLines: number;
  /** Total byte count before truncation. */
  readonly totalBytes: number;
  /** Byte count after truncation. */
  readonly outputBytes: number;
}

/** Cached open CodeGraph instance keyed by canonical project root. */
export interface CachedGraph {
  /** Canonical CodeGraph project root. */
  readonly root: string;
  /** Open CodeGraph instance. */
  readonly cg: CodeGraphInstance;
  /** Timestamp when the instance was opened. */
  readonly openedAt: number;
  /** Timestamp of the last successful extension-triggered sync. */
  lastSyncedAt: number;
  /** In-flight sync promise used to deduplicate concurrent sync requests. */
  syncInFlight?: Promise<void>;
}

/** Graph readiness success result returned to tool implementations. */
export interface ReadyGraph {
  /** Discriminant for successful readiness. */
  readonly ok: true;
  /** Canonical project root. */
  readonly root: string;
  /** Ready CodeGraph instance. */
  readonly cg: CodeGraphInstance;
  /** Cache entry backing the instance. */
  readonly entry: CachedGraph;
  /** Status snapshot captured after readiness/sync checks. */
  readonly snapshot: StatusSnapshot;
  /** Optional freshness or initialization warning to prefix to output. */
  readonly syncWarning?: string;
}

/** Graph readiness failure result returned to tool implementations. */
export interface NotReady {
  /** Discriminant for failed readiness. */
  readonly ok: false;
  /** User-facing failure message. */
  readonly message: string;
  /** Optional status snapshot describing the failure. */
  readonly snapshot?: StatusSnapshot;
}

/** Changed-file summary returned by CodeGraph. */
export type ChangedFiles = ReturnType<CodeGraphInstance["getChangedFiles"]>;

/** Pending watcher files returned by CodeGraph. */
export type PendingFiles = ReturnType<CodeGraphInstance["getPendingFiles"]>;

/** CodeGraph statistics returned by CodeGraph. */
export type GraphStats = ReturnType<CodeGraphInstance["getStats"]>;

/** CodeGraph index build metadata returned by CodeGraph. */
export type IndexBuildInfo = ReturnType<CodeGraphInstance["getIndexBuildInfo"]>;

/** Status snapshot used by codegraph_status and internal sync decisions. */
export interface StatusSnapshot {
  /** Whether a nearest `.codegraph` directory was found. */
  readonly initialized: boolean;
  /** Absolute path resolved from user input or cwd. */
  readonly startPath: string;
  /** Existing directory used as the nearest-root search path. */
  readonly searchPath: string;
  /** Canonical initialized CodeGraph root, when found. */
  readonly root?: string;
  /** Candidate root for initialization when no index exists. */
  readonly candidateRoot?: string;
  /** Reason the candidate root is unsafe to initialize. */
  readonly unsafeReason?: string;
  /** Current CodeGraph database statistics. */
  readonly stats?: GraphStats;
  /** Current CodeGraph backend name. */
  readonly backend?: string;
  /** Current SQLite journal mode. */
  readonly journalMode?: string;
  /** Last indexed timestamp reported by CodeGraph. */
  readonly lastIndexedAt?: number | null;
  /** Build metadata for the current index. */
  readonly indexBuildInfo?: IndexBuildInfo;
  /** Whether CodeGraph says a full reindex is needed. */
  readonly indexStale?: boolean;
  /** Added/modified/removed files since the index was last synced. */
  readonly changedFiles?: ChangedFiles;
  /** Files pending in CodeGraph's watcher queue. */
  readonly pendingFiles?: PendingFiles;
  /** Whether CodeGraph is currently indexing. */
  readonly isIndexing?: boolean;
  /** Whether CodeGraph's watcher is active. */
  readonly isWatching?: boolean;
  /** Extension-level sync TTL in milliseconds; negative disables sync. */
  readonly syncTtlMs: number;
  /** Last successful extension-triggered sync timestamp. */
  readonly lastSyncedAt?: number;
  /** Whether an extension-triggered sync is in flight. */
  readonly syncInFlight?: boolean;
  /** What the next query tool would do about syncing. */
  readonly nextQuerySync?: "disabled" | "not-needed" | "in-flight" | "now" | "after-ttl";
  /** Milliseconds until the next query would sync when TTL is active. */
  readonly nextQuerySyncAfterMs?: number;
}

/** Shared optional projectPath parameter shape. */
export interface ProjectPathParam {
  /** Optional project path; defaults to Pi's current working directory. */
  readonly projectPath?: string;
}

/** Parameters for codegraph_explore. */
export interface ExploreToolParams extends ProjectPathParam {
  /** Natural-language question or symbol/file names to explore. */
  readonly query: string;
  /** Maximum indexed nodes to include. */
  readonly maxNodes?: number;
  /** Whether source blocks should be included in the result. */
  readonly includeCode?: boolean;
}

/** Parameters for codegraph_search. */
export interface SearchToolParams extends ProjectPathParam {
  /** Symbol name or text to search for. */
  readonly query: string;
  /** Optional indexed node kind filter. */
  readonly kind?: NodeKind;
  /** Maximum search results to return. */
  readonly limit?: number;
}

/** Shared parameters for symbol-centric tools. */
export interface SymbolToolParams extends ProjectPathParam {
  /** Symbol name to inspect. */
  readonly symbol: string;
  /** Optional file path/suffix used to disambiguate the symbol. */
  readonly file?: string;
  /** Maximum definitions/results to return. */
  readonly limit?: number;
}

/** Parameters for codegraph_impact. */
export interface ImpactToolParams extends SymbolToolParams {
  /** Traversal depth for impact analysis. */
  readonly depth?: number;
}

/** Parameters for codegraph_node. */
export interface NodeToolParams extends ProjectPathParam {
  /** Symbol name to inspect in symbol mode. */
  readonly symbol?: string;
  /** Indexed file path/suffix to read in file mode. */
  readonly file?: string;
  /** Whether symbol mode should include source code. */
  readonly includeCode?: boolean;
  /** 1-indexed starting line for file mode. */
  readonly offset?: number;
  /** Maximum lines/results to return. */
  readonly limit?: number;
  /** Whether file mode should return only indexed symbols. */
  readonly symbolsOnly?: boolean;
}

/** Parameters for codegraph_status. */
export type StatusToolParams = ProjectPathParam;
