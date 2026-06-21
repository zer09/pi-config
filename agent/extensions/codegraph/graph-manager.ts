/**
 * Stateful CodeGraph lifecycle, readiness, initialization, and sync management.
 *
 * GraphManager owns the extension's open CodeGraph instance cache and is the
 * only module that performs CodeGraph init/open/sync/close side effects. Tool
 * modules ask it for a ready graph before performing read-only graph queries.
 */

import { CodeGraph, findNearestCodeGraphRoot } from "./codegraph-package.ts";
import {
  canonicalPath,
  existingSearchPath,
  resolveCandidateRoot,
  resolvePath,
  unsafeRootReason,
} from "./paths.ts";
import { textResult } from "./result.ts";
import { changedCount } from "./status-format.ts";
import type {
  AutoInitPolicy,
  CachedGraph,
  ExtensionAPI,
  ExtensionContext,
  NotReady,
  ReadyGraph,
  StatusSnapshot,
  ToolUpdateHandler,
} from "./types.ts";

/** Options used to construct a GraphManager. */
export interface GraphManagerOptions {
  /** Pi API used for git root detection and UI confirmations. */
  readonly pi: ExtensionAPI;
  /** Query-time sync TTL in milliseconds; negative disables automatic sync. */
  readonly syncTtlMs: number;
  /** Auto-initialization policy for unindexed projects. */
  readonly autoInitPolicy: AutoInitPolicy;
}

/** Options for building a status snapshot. */
export interface BuildStatusSnapshotOptions {
  /** Whether the user explicitly supplied projectPath. */
  readonly explicitProjectPath?: boolean;
}

/** Result returned by CodeGraph initialization. */
export interface InitializeGraphResult {
  /** Cache entry when initialization opened a graph. */
  readonly entry?: CachedGraph;
  /** User-facing initialization outcome message. */
  readonly message?: string;
}

function isLockUnavailableSyncResult(result: { readonly filesChecked: number; readonly durationMs: number }): boolean {
  return result.filesChecked === 0 && result.durationMs === 0;
}

/**
 * Manage open CodeGraph instances, readiness checks, lazy sync, and cleanup.
 *
 * @example
 * ```ts
 * const manager = new GraphManager({ pi, syncTtlMs, autoInitPolicy });
 * const graph = await manager.ensureReady(params.projectPath, ctx);
 * ```
 */
export class GraphManager {
  private readonly pi: ExtensionAPI;
  private readonly syncTtlMs: number;
  private readonly autoInitPolicy: AutoInitPolicy;
  private readonly graphs = new Map<string, CachedGraph>();
  private readonly opening = new Map<string, Promise<CachedGraph>>();

  /**
   * Create a manager for one Pi extension registration.
   *
   * @param options - Pi API plus sync and auto-init configuration.
   */
  constructor(options: GraphManagerOptions) {
    this.pi = options.pi;
    this.syncTtlMs = options.syncTtlMs;
    this.autoInitPolicy = options.autoInitPolicy;
  }

  private async getEntry(root: string): Promise<CachedGraph> {
    const canonicalRoot = await canonicalPath(root);
    const existing = this.graphs.get(canonicalRoot);
    if (existing) return existing;

    const inFlight = this.opening.get(canonicalRoot);
    if (inFlight) return inFlight;

    const openPromise = CodeGraph.open(canonicalRoot, { sync: false })
      .then((cg) => {
        const entry: CachedGraph = {
          root: canonicalRoot,
          cg,
          openedAt: Date.now(),
          lastSyncedAt: 0,
        };
        this.graphs.set(canonicalRoot, entry);
        return entry;
      })
      .finally(() => {
        this.opening.delete(canonicalRoot);
      });

    this.opening.set(canonicalRoot, openPromise);
    return openPromise;
  }

  /**
   * Build a status snapshot without forcing a sync.
   *
   * @param startInput - Optional projectPath from tool parameters.
   * @param ctx - Pi tool context.
   * @param options - Snapshot behavior options.
   * @returns Status snapshot used for reporting and sync decisions.
   */
  async buildStatusSnapshot(
    startInput: string | undefined,
    ctx: ExtensionContext,
    options: BuildStatusSnapshotOptions = {},
  ): Promise<StatusSnapshot> {
    const startPath = resolvePath(startInput, ctx.cwd);
    const searchPath = await existingSearchPath(startPath);
    const nearest = findNearestCodeGraphRoot(searchPath);

    if (!nearest) {
      const candidate = await resolveCandidateRoot(this.pi, startPath, ctx.cwd, !!options.explicitProjectPath, ctx.signal);
      const unsafeReason = candidate.root ? await unsafeRootReason(candidate.root) ?? undefined : undefined;
      return {
        initialized: false,
        startPath,
        searchPath,
        candidateRoot: candidate.root,
        unsafeReason,
        syncTtlMs: this.syncTtlMs,
      };
    }

    const root = await canonicalPath(nearest);
    const entry = await this.getEntry(root);
    const changedFiles = entry.cg.getChangedFiles();
    const pending = changedCount(changedFiles);
    const sinceSync = Date.now() - entry.lastSyncedAt;
    let nextQuerySync: StatusSnapshot["nextQuerySync"];
    let nextQuerySyncAfterMs: number | undefined;

    if (this.syncTtlMs < 0) {
      nextQuerySync = "disabled";
    } else if (entry.syncInFlight) {
      nextQuerySync = "in-flight";
    } else if (pending === 0) {
      nextQuerySync = "not-needed";
    } else if (sinceSync > this.syncTtlMs) {
      nextQuerySync = "now";
    } else {
      nextQuerySync = "after-ttl";
      nextQuerySyncAfterMs = this.syncTtlMs - sinceSync;
    }

    return {
      initialized: true,
      startPath,
      searchPath,
      root,
      stats: entry.cg.getStats(),
      backend: entry.cg.getBackend(),
      journalMode: entry.cg.getJournalMode(),
      lastIndexedAt: entry.cg.getLastIndexedAt(),
      indexBuildInfo: entry.cg.getIndexBuildInfo(),
      indexStale: entry.cg.isIndexStale(),
      changedFiles,
      pendingFiles: entry.cg.getPendingFiles(),
      isIndexing: entry.cg.isIndexing(),
      isWatching: entry.cg.isWatching(),
      syncTtlMs: this.syncTtlMs,
      lastSyncedAt: entry.lastSyncedAt,
      syncInFlight: !!entry.syncInFlight,
      nextQuerySync,
      nextQuerySyncAfterMs,
    };
  }

  /**
   * Initialize and initially index CodeGraph at a safe root.
   *
   * @param root - Candidate project root.
   * @param ctx - Pi tool context used for confirmation.
   * @param onUpdate - Optional progress callback.
   * @param signal - Optional abort signal for indexing.
   * @returns Initialization result and optional user-facing message.
   * @throws Propagates CodeGraph init errors; index failures are returned as warnings.
   */
  async initializeGraph(
    root: string,
    ctx: ExtensionContext,
    onUpdate?: ToolUpdateHandler,
    signal?: AbortSignal,
  ): Promise<InitializeGraphResult> {
    const canonicalRoot = await canonicalPath(root);
    const unsafe = await unsafeRootReason(canonicalRoot);
    if (unsafe) return { message: `Refusing to initialize CodeGraph at ${canonicalRoot}: candidate root looks like ${unsafe}.` };
    if (this.autoInitPolicy === "never") return { message: `CodeGraph is not initialized at ${canonicalRoot}; auto-init is disabled by CODEGRAPH_PI_AUTO_INIT=never.` };

    if (this.autoInitPolicy === "confirm") {
      if (!ctx.hasUI) {
        return { message: `CodeGraph is not initialized at ${canonicalRoot}; no UI is available to confirm initialization. Run \`codegraph init ${canonicalRoot}\` or set CODEGRAPH_PI_AUTO_INIT=always for trusted roots.` };
      }
      const ok = await ctx.ui.confirm("Initialize CodeGraph?", `Create .codegraph and index ${canonicalRoot}?`);
      if (!ok) return { message: `CodeGraph initialization declined for ${canonicalRoot}.` };
    }

    onUpdate?.(textResult(`Initializing CodeGraph at ${canonicalRoot}...`));
    const cg = await CodeGraph.init(canonicalRoot, { index: false });
    const entry: CachedGraph = {
      root: canonicalRoot,
      cg,
      openedAt: Date.now(),
      lastSyncedAt: 0,
    };
    this.graphs.set(canonicalRoot, entry);

    onUpdate?.(textResult(`Indexing ${canonicalRoot} with CodeGraph...`));
    const indexPromise = cg.indexAll({
      signal,
      onProgress(progress) {
        onUpdate?.(textResult(`Indexing ${canonicalRoot}: ${progress.phase} ${progress.current}/${progress.total}`));
      },
    })
      .then((result) => {
        if (!result.success) {
          throw new Error(result.errors.map((e) => e.message).join("; "));
        }
        entry.lastSyncedAt = Date.now();
      })
      .finally(() => {
        entry.indexInFlight = undefined;
      });

    entry.indexInFlight = indexPromise;

    try {
      await indexPromise;
      return { entry, message: `Initialized and indexed CodeGraph at ${canonicalRoot}.` };
    } catch (error) {
      return { entry, message: `CodeGraph initialized at ${canonicalRoot}, but initial indexing failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async ensureCurrentIndex(
    entry: CachedGraph,
    ctx: ExtensionContext,
    onUpdate?: ToolUpdateHandler,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (entry.indexInFlight) {
      try {
        await entry.indexInFlight;
      } catch (error) {
        return `CodeGraph full reindex failed; using existing index. ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    if (!entry.cg.isIndexStale()) {
      entry.staleReindexDeclined = false;
      return undefined;
    }

    if (entry.staleReindexDeclined) {
      return `CodeGraph index was built with an older extraction version; full reindex was declined earlier this session. Run \`codegraph index ${entry.root}\` to rebuild.`;
    }

    if (!ctx.hasUI) {
      return `CodeGraph index was built with an older extraction version. Run \`codegraph index ${entry.root}\` to rebuild.`;
    }

    const ok = await ctx.ui.confirm("Reindex CodeGraph?", `The CodeGraph index at ${entry.root} was built with an older extraction version. Rebuild the full index now?`);
    if (!ok) {
      entry.staleReindexDeclined = true;
      return `CodeGraph index was built with an older extraction version; using existing index. Run \`codegraph index ${entry.root}\` to rebuild.`;
    }

    onUpdate?.(textResult(`Reindexing CodeGraph at ${entry.root}...`));
    const indexPromise = entry.cg.indexAll({
      signal,
      onProgress(progress) {
        onUpdate?.(textResult(`Reindexing ${entry.root}: ${progress.phase} ${progress.current}/${progress.total}`));
      },
    })
      .then((result) => {
        if (!result.success) {
          throw new Error(result.errors.map((e) => e.message).join("; ") || "CodeGraph indexing failed.");
        }
        entry.lastSyncedAt = Date.now();
        entry.staleReindexDeclined = false;
      })
      .finally(() => {
        entry.indexInFlight = undefined;
      });

    entry.indexInFlight = indexPromise;

    try {
      await indexPromise;
      return `Reindexed CodeGraph at ${entry.root}.`;
    } catch (error) {
      return `CodeGraph full reindex failed; using existing index. ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async ensureFresh(entry: CachedGraph): Promise<string | undefined> {
    if (this.syncTtlMs < 0) return undefined;

    if (entry.syncInFlight) {
      try {
        await entry.syncInFlight;
        return undefined;
      } catch (error) {
        return `CodeGraph sync failed; using existing index. ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const changed = entry.cg.getChangedFiles();
    const pending = changedCount(changed);
    if (pending === 0) return undefined;

    const sinceSync = Date.now() - entry.lastSyncedAt;
    if (sinceSync <= this.syncTtlMs) {
      return `CodeGraph has ${pending} pending change(s); sync skipped until TTL expires (~${this.syncTtlMs - sinceSync}ms).`;
    }

    entry.syncInFlight = entry.cg.sync()
      .then((result) => {
        if (isLockUnavailableSyncResult(result)) {
          throw new Error("CodeGraph sync skipped because another process holds the CodeGraph write lock.");
        }
        entry.lastSyncedAt = Date.now();
      })
      .finally(() => {
        entry.syncInFlight = undefined;
      });

    try {
      await entry.syncInFlight;
      return undefined;
    } catch (error) {
      return `CodeGraph sync failed; using existing index. ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Ensure a project has an initialized, open, and fresh-enough CodeGraph index.
   *
   * @param projectPath - Optional project path from tool parameters.
   * @param ctx - Pi tool context.
   * @param onUpdate - Optional progress callback for initialization/indexing.
   * @param signal - Optional abort signal.
   * @returns Ready graph or a user-facing not-ready result.
   */
  async ensureReady(
    projectPath: string | undefined,
    ctx: ExtensionContext,
    onUpdate?: ToolUpdateHandler,
    signal?: AbortSignal,
  ): Promise<ReadyGraph | NotReady> {
    const explicitProjectPath = typeof projectPath === "string" && projectPath.trim() !== "";
    let snapshot = await this.buildStatusSnapshot(projectPath, ctx, { explicitProjectPath });

    if (!snapshot.initialized) {
      if (!snapshot.candidateRoot) {
        return { ok: false, message: `CodeGraph is not initialized and no safe candidate root could be resolved from ${snapshot.searchPath}.`, snapshot };
      }
      if (snapshot.unsafeReason) {
        return { ok: false, message: `CodeGraph is not initialized at ${snapshot.candidateRoot}, and that root looks unsafe (${snapshot.unsafeReason}).`, snapshot };
      }
      const init = await this.initializeGraph(snapshot.candidateRoot, ctx, onUpdate, signal);
      if (!init.entry) return { ok: false, message: init.message ?? `CodeGraph is not initialized at ${snapshot.candidateRoot}.`, snapshot };
      snapshot = await this.buildStatusSnapshot(init.entry.root, ctx, { explicitProjectPath: true });
      return { ok: true, root: init.entry.root, cg: init.entry.cg, entry: init.entry, snapshot, syncWarning: init.message };
    }

    const entry = await this.getEntry(snapshot.root!);
    const warnings = [
      await this.ensureCurrentIndex(entry, ctx, onUpdate, signal),
      await this.ensureFresh(entry),
    ].filter((warning): warning is string => !!warning);
    const refreshedSnapshot = await this.buildStatusSnapshot(entry.root, ctx, { explicitProjectPath: true });
    return { ok: true, root: entry.root, cg: entry.cg, entry, snapshot: refreshedSnapshot, syncWarning: warnings.join(" ") || undefined };
  }

  /**
   * Prefix tool output with any readiness/sync warning.
   *
   * @param graph - Ready graph returned by ensureReady.
   * @param content - Tool response body.
   * @returns Content with a blockquote warning when needed.
   */
  withWarningPrefix(graph: ReadyGraph, content: string): string {
    return graph.syncWarning ? `> ${graph.syncWarning}\n\n${content}` : content;
  }

  private async closeEntry(entry: CachedGraph): Promise<void> {
    try {
      entry.cg.unwatch();
    } catch {
      // CodeGraph.close() also unwatches; this is a defensive, idempotent stop.
    }

    const operations = [entry.syncInFlight, entry.indexInFlight].filter(
      (operation): operation is Promise<void> => !!operation,
    );
    await Promise.allSettled(operations);

    try {
      const deadline = Date.now() + 5_000;
      while (entry.cg.isIndexing() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch {
      // If indexing state cannot be read during shutdown, still attempt close.
    }

    try {
      entry.cg.close();
    } catch {
      // Ignore cleanup failures during runtime shutdown.
    }
  }

  /**
   * Close all open CodeGraph instances and clear the cache.
   *
   * @returns Promise that settles after best-effort cleanup.
   */
  async closeAll(): Promise<void> {
    const opening = [...this.opening.values()];
    this.opening.clear();

    if (opening.length) {
      await Promise.allSettled(opening);
    }

    const entries = [...this.graphs.values()];
    this.graphs.clear();

    await Promise.allSettled(entries.map((entry) => this.closeEntry(entry)));
  }
}
