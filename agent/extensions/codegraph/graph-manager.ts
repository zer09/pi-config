/**
 * Stateful CodeGraph lifecycle, readiness, initialization, and sync management.
 *
 * GraphManager owns the extension's open CodeGraph instance cache and is the
 * only module that performs CodeGraph init/open/sync/close side effects. Tool
 * modules ask it for a ready graph before performing read-only graph queries.
 */

import { CodeGraph, findNearestCodeGraphRoot } from "./codegraph-package.ts";
import {
  DEFAULT_MAX_WATCHED_ROOTS,
  DEFAULT_SYNC_TTL_MS,
  DEFAULT_WATCH_DEBOUNCE_MS,
  DEFAULT_WATCH_FLUSH_WAIT_MS,
  DEFAULT_WATCH_RETRY_MS,
} from "./constants.ts";
import {
  canonicalPath,
  existingSearchPath,
  isPathInside,
  resolveCandidateRoot,
  resolvePath,
  unsafeRootReason,
} from "./paths.ts";
import { textResult } from "./result.ts";
import type {
  CachedGraph,
  CodeGraphInstance,
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
  /** Query reconciliation interval override, primarily for focused tests. */
  readonly syncTtlMs?: number;
  /** Concurrent watched-root cap override, primarily for focused tests. */
  readonly maxWatchedRoots?: number;
  /** Watcher restart backoff override, primarily for focused tests. */
  readonly watchRetryMs?: number;
  /** Pending watcher-drain wait override, primarily for focused tests. */
  readonly watchFlushWaitMs?: number;
}

/** Options for building a status snapshot. */
export interface BuildStatusSnapshotOptions {
  /** Whether the user explicitly supplied projectPath. */
  readonly explicitProjectPath?: boolean;
  /** Include runtime graph state instead of returning only resolved location data. */
  readonly includeGraphState?: boolean;
  /** Include the git-status-based changed-file diagnostic. */
  readonly includeChangedFiles?: boolean;
}

/** Optional diagnostics requested by the caller of ensureReady. */
export interface EnsureReadyOptions {
  /** Include changed-file diagnostics in the single post-reconciliation snapshot. */
  readonly includeChangedFiles?: boolean;
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
 * const manager = new GraphManager({ pi });
 * const graph = await manager.ensureReady(params.projectPath, ctx);
 * ```
 */
export class GraphManager {
  private readonly pi: ExtensionAPI;
  private readonly syncTtlMs: number;
  private readonly maxWatchedRoots: number;
  private readonly watchRetryMs: number;
  private readonly watchFlushWaitMs: number;
  private readonly graphs = new Map<string, CachedGraph>();
  private readonly opening = new Map<string, Promise<CachedGraph>>();

  /**
   * Create a manager for one Pi extension registration.
   *
   * @param options - Pi API used for root detection and UI confirmations.
   */
  constructor(options: GraphManagerOptions) {
    this.pi = options.pi;
    this.syncTtlMs = Math.max(0, options.syncTtlMs ?? DEFAULT_SYNC_TTL_MS);
    this.maxWatchedRoots = Math.max(1, options.maxWatchedRoots ?? DEFAULT_MAX_WATCHED_ROOTS);
    this.watchRetryMs = Math.max(0, options.watchRetryMs ?? DEFAULT_WATCH_RETRY_MS);
    this.watchFlushWaitMs = Math.max(0, options.watchFlushWaitMs ?? DEFAULT_WATCH_FLUSH_WAIT_MS);
  }

  private closeGraphQuietly(cg: CodeGraphInstance): void {
    try {
      cg.unwatch();
    } catch {
      // CodeGraph.close() also unwatches; this is defensive and idempotent.
    }

    try {
      cg.close();
    } catch {
      // Ignore cleanup failures during runtime shutdown or reindex replacement.
    }
  }

  private reopenIfReplaced(entry: CachedGraph): void {
    try {
      if (entry.cg.reopenIfReplaced()) {
        entry.lastSyncedAt = 0;
        entry.watchStartAttempted = false;
        entry.watchRetryAfter = undefined;
        entry.watchError = undefined;
        entry.lastWatcherSyncedAt = undefined;
        entry.staleReindexDeclined = false;
      }
    } catch {
      // Best-effort self-heal; keep serving from the existing handle and retry later.
    }
  }

  private stopOldestWatcher(exceptRoot: string): void {
    const watched = [...this.graphs.values()]
      .filter((candidate) => {
        if (candidate.root === exceptRoot) return false;
        try {
          return candidate.cg.isWatching();
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    while (watched.length >= this.maxWatchedRoots) {
      const oldest = watched.shift();
      if (!oldest) break;
      try {
        oldest.cg.unwatch();
      } catch {
        // A later query still performs catch-up reconciliation before reuse.
      }
      oldest.lastSyncedAt = 0;
      oldest.watchStartAttempted = false;
      oldest.watchRetryAfter = undefined;
    }
  }

  private startWatching(entry: CachedGraph): void {
    const now = Date.now();
    entry.lastAccessedAt = now;
    if (entry.cg.isWatching()) return;
    if (entry.watchStartAttempted && now < (entry.watchRetryAfter ?? 0)) return;

    entry.watchStartAttempted = true;
    entry.watchRetryAfter = now + this.watchRetryMs;
    entry.watchError = undefined;

    try {
      const started = entry.cg.watch({
        debounceMs: DEFAULT_WATCH_DEBOUNCE_MS,
        onSyncComplete: () => {
          entry.lastWatcherSyncedAt = Date.now();
          entry.watchError = undefined;
        },
        onSyncError: (error) => {
          entry.watchError = error.message;
        },
        onDegraded: (reason) => {
          entry.watchError = reason;
          entry.watchRetryAfter = Date.now() + this.watchRetryMs;
        },
      });
      if (started) {
        // Do not sacrifice healthy coverage until the incoming watcher proves
        // it can occupy a slot. The cap is restored immediately after startup.
        this.stopOldestWatcher(entry.root);
      } else {
        entry.watchError = "SDK file watching is unavailable for this project; query-time reconciliation remains active.";
      }
    } catch (error) {
      entry.watchError = `SDK file watcher failed to start: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async getEntry(root: string): Promise<CachedGraph> {
    const canonicalRoot = await canonicalPath(root);
    const existing = this.graphs.get(canonicalRoot);
    if (existing) {
      this.reopenIfReplaced(existing);
      existing.lastAccessedAt = Date.now();
      return existing;
    }

    const inFlight = this.opening.get(canonicalRoot);
    if (inFlight) return inFlight;

    const openPromise = CodeGraph.open(canonicalRoot, { sync: false })
      .then((cg) => {
        const now = Date.now();
        const entry: CachedGraph = {
          root: canonicalRoot,
          cg,
          openedAt: now,
          lastSyncedAt: 0,
          lastAccessedAt: now,
          watchStartAttempted: false,
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

  private refreshStatusSnapshot(
    base: Pick<StatusSnapshot, "startPath" | "searchPath">,
    entry: CachedGraph,
    includeChangedFiles: boolean,
  ): StatusSnapshot {
    const pendingReferenceCount = entry.cg.getPendingReferenceCount();
    const pendingFiles = entry.cg.getPendingFiles();
    const sinceSync = Date.now() - entry.lastSyncedAt;
    const syncDue = entry.lastSyncedAt === 0
      || pendingFiles.length > 0
      || pendingReferenceCount > 0
      || sinceSync >= this.syncTtlMs;
    let nextQuerySync: StatusSnapshot["nextQuerySync"];
    let nextQuerySyncAfterMs: number | undefined;

    if (entry.syncInFlight) {
      nextQuerySync = "in-flight";
    } else if (syncDue) {
      nextQuerySync = "now";
    } else {
      nextQuerySync = "after-ttl";
      nextQuerySyncAfterMs = this.syncTtlMs - sinceSync;
    }

    const watcherDegraded = entry.cg.isWatcherDegraded();
    return {
      initialized: true,
      ...base,
      root: entry.root,
      stats: entry.cg.getStats(),
      backend: entry.cg.getBackend(),
      journalMode: entry.cg.getJournalMode(),
      lastIndexedAt: entry.cg.getLastIndexedAt(),
      indexBuildInfo: entry.cg.getIndexBuildInfo(),
      indexStale: entry.cg.isIndexStale(),
      indexState: entry.cg.getIndexState(),
      pendingReferenceCount,
      changedFiles: includeChangedFiles ? entry.cg.getChangedFiles() : undefined,
      pendingFiles,
      isIndexing: entry.cg.isIndexing(),
      isWatching: entry.cg.isWatching(),
      watcherDegraded,
      watcherDegradedReason: watcherDegraded ? entry.cg.getWatcherDegradedReason() ?? undefined : undefined,
      watchError: entry.watchError,
      syncTtlMs: this.syncTtlMs,
      lastSyncedAt: entry.lastSyncedAt,
      lastWatcherSyncedAt: entry.lastWatcherSyncedAt,
      syncInFlight: !!entry.syncInFlight,
      nextQuerySync,
      nextQuerySyncAfterMs,
    };
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
    const candidate = await resolveCandidateRoot(
      this.pi,
      startPath,
      ctx.cwd,
      options.explicitProjectPath ?? false,
      ctx.signal,
    );
    if (candidate.error) {
      return {
        initialized: false,
        startPath,
        searchPath,
        candidateError: candidate.error,
        syncTtlMs: this.syncTtlMs,
      };
    }

    let nearest = findNearestCodeGraphRoot(searchPath);
    if (nearest && candidate.gitRoot) {
      const nearestRoot = await canonicalPath(nearest);
      const gitRoot = await canonicalPath(candidate.gitRoot);
      if (nearestRoot !== gitRoot && isPathInside(nearestRoot, gitRoot)) {
        // A nested repository/worktree without its own index must not silently
        // borrow an ancestor project's graph. Candidate resolution preserves
        // explicit/default root semantics; Git root is isolation metadata only.
        nearest = null;
      }
    }

    if (!nearest) {
      const unsafeReason = candidate.root ? await unsafeRootReason(candidate.root) ?? undefined : undefined;
      return {
        initialized: false,
        startPath,
        searchPath,
        candidateRoot: candidate.root,
        candidateError: candidate.error,
        unsafeReason,
        syncTtlMs: this.syncTtlMs,
      };
    }

    const entry = await this.getEntry(nearest);
    if (options.includeGraphState === false) {
      return {
        initialized: true,
        startPath,
        searchPath,
        root: entry.root,
        syncTtlMs: this.syncTtlMs,
      };
    }
    return this.refreshStatusSnapshot(
      { startPath, searchPath },
      entry,
      options.includeChangedFiles ?? true,
    );
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

    if (!ctx.hasUI) {
      return { message: `CodeGraph is not initialized at ${canonicalRoot}; no UI is available to confirm initialization. Run \`codegraph init ${canonicalRoot}\`.` };
    }
    const ok = await ctx.ui.confirm("Initialize CodeGraph?", `Create .codegraph and index ${canonicalRoot}?`);
    if (!ok) return { message: `CodeGraph initialization declined for ${canonicalRoot}.` };

    onUpdate?.(textResult(`Initializing CodeGraph at ${canonicalRoot}...`));
    const cg = await CodeGraph.init(canonicalRoot, { index: false });
    const openedAt = Date.now();
    const entry: CachedGraph = {
      root: canonicalRoot,
      cg,
      openedAt,
      lastSyncedAt: 0,
      lastAccessedAt: openedAt,
      watchStartAttempted: false,
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
      // Watch first, then force one incremental pass so edits made during the
      // full index cannot fall into an index-scan-to-watcher blind spot.
      entry.lastSyncedAt = 0;
      this.startWatching(entry);
      return { entry, message: `Initialized and indexed CodeGraph at ${canonicalRoot}.` };
    } catch (error) {
      return { entry, message: `CodeGraph initialized at ${canonicalRoot}, but initial indexing failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async recreateAndIndex(
    entry: CachedGraph,
    onUpdate?: ToolUpdateHandler,
    signal?: AbortSignal,
  ): Promise<void> {
    // Stop new watcher work before replacing the database, then wait for both
    // extension-tracked and SDK-internal watcher syncs to leave the index mutex.
    try {
      entry.cg.unwatch();
    } finally {
      entry.watchStartAttempted = false;
      entry.watchRetryAfter = undefined;
    }

    if (entry.syncInFlight) {
      try {
        await entry.syncInFlight;
      } catch {
        // A full recreate supersedes a failed incremental sync.
      }
    }

    const idleDeadline = Date.now() + 30_000;
    while (entry.cg.isIndexing() && Date.now() < idleDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (entry.cg.isIndexing()) {
      throw new Error("CodeGraph is still finishing watcher/index work after 30 seconds; the database was not recreated. Retry the reindex after that work settles.");
    }

    const previousGraph = entry.cg;
    let previousClosed = false;

    if (process.platform === "win32") {
      this.closeGraphQuietly(previousGraph);
      previousClosed = true;
    }

    onUpdate?.(textResult(`Recreating CodeGraph database at ${entry.root}...`));
    let freshGraph: CodeGraphInstance;
    try {
      freshGraph = await CodeGraph.recreate(entry.root);
    } catch (error) {
      if (previousClosed) {
        try {
          entry.cg = await CodeGraph.open(entry.root, { sync: false });
        } catch {
          this.graphs.delete(entry.root);
        }
      }
      throw error;
    }

    entry.cg = freshGraph;
    entry.lastSyncedAt = 0;
    entry.watchStartAttempted = false;
    entry.watchRetryAfter = undefined;
    entry.watchError = undefined;
    entry.lastWatcherSyncedAt = undefined;
    entry.staleReindexDeclined = false;
    if (!previousClosed) this.closeGraphQuietly(previousGraph);

    onUpdate?.(textResult(`Reindexing CodeGraph at ${entry.root}...`));
    const result = await freshGraph.indexAll({
      signal,
      onProgress(progress) {
        onUpdate?.(textResult(`Reindexing ${entry.root}: ${progress.phase} ${progress.current}/${progress.total}`));
      },
    });

    if (!result.success) {
      throw new Error(result.errors.map((e) => e.message).join("; ") || "CodeGraph indexing failed.");
    }

    // The caller's following ensureFresh() installs/drains the watcher around a
    // forced incremental pass, closing the full-index-to-watcher handoff gap.
    entry.lastSyncedAt = 0;
    this.startWatching(entry);
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
        return `CodeGraph full reindex failed; the current index may be incomplete. ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const indexState = entry.cg.getIndexState();
    const incompleteIndex = indexState === "indexing" || indexState === "partial" || indexState === "failed";
    if (!entry.cg.isIndexStale()) {
      entry.staleReindexDeclined = false;
      if (incompleteIndex) {
        const stateDescription = indexState === "indexing"
          ? "the last full index run did not finish"
          : `the last full index run is marked ${indexState}`;
        return `CodeGraph reports that ${stateDescription}; results may be incomplete. Run \`codegraph index ${entry.root}\` to rebuild.`;
      }
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

    const indexPromise = this.recreateAndIndex(entry, onUpdate, signal)
      .finally(() => {
        entry.indexInFlight = undefined;
      });

    entry.indexInFlight = indexPromise;

    try {
      await indexPromise;
      return `Reindexed CodeGraph at ${entry.root}.`;
    } catch (error) {
      return `CodeGraph full reindex failed; the current index may be incomplete. ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private watcherWarning(entry: CachedGraph): string | undefined {
    if (!entry.cg.isWatcherDegraded()) return undefined;
    const reason = entry.cg.getWatcherDegradedReason();
    return `CodeGraph file watching degraded${reason ? `: ${reason}` : ""}; query-time reconciliation remains active every ${this.syncTtlMs}ms.`;
  }

  private async waitForWatcherFlush(entry: CachedGraph): Promise<boolean> {
    const deadline = Date.now() + this.watchFlushWaitMs;
    while (
      entry.cg.isWatching()
      && !entry.cg.isWatcherDegraded()
      && entry.cg.getPendingFiles().length > 0
      && Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return entry.cg.getPendingFiles().length === 0;
  }

  private async ensureFresh(entry: CachedGraph): Promise<string | undefined> {
    entry.lastAccessedAt = Date.now();
    // Install event capture before the first/full TTL reconciliation so files
    // created after its scan but before completion stay pending for follow-up.
    this.startWatching(entry);

    if (entry.syncInFlight) {
      try {
        await entry.syncInFlight;
      } catch (error) {
        this.startWatching(entry);
        return `CodeGraph sync failed; using existing index. ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    let pendingFiles = entry.cg.getPendingFiles();
    const hadWatcherPending = pendingFiles.length > 0;
    let watcherFlushWarning: string | undefined;
    if (hadWatcherPending && entry.cg.isWatching() && !entry.cg.isWatcherDegraded()) {
      const flushed = await this.waitForWatcherFlush(entry);
      pendingFiles = entry.cg.getPendingFiles();
      if (!flushed && entry.cg.isWatching() && !entry.cg.isWatcherDegraded()) {
        watcherFlushWarning = `CodeGraph watcher still has ${pendingFiles.length} pending file(s) after ${this.watchFlushWaitMs}ms; running direct reconciliation while leaving its queue intact.`;
      }
    }

    const watcherCouldNotFlush = hadWatcherPending
      && (!entry.cg.isWatching() || entry.cg.isWatcherDegraded());
    const pendingReferences = entry.cg.getPendingReferenceCount();
    const sinceSync = Date.now() - entry.lastSyncedAt;
    const syncDue = entry.lastSyncedAt === 0
      || watcherCouldNotFlush
      || pendingFiles.length > 0
      || pendingReferences > 0
      || sinceSync >= this.syncTtlMs;

    if (!syncDue) {
      this.startWatching(entry);
      return this.watcherWarning(entry);
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
      const pendingAfterSync = entry.cg.getPendingFiles();
      if (
        !watcherFlushWarning
        && pendingAfterSync.length > 0
        && entry.cg.isWatching()
        && !entry.cg.isWatcherDegraded()
      ) {
        const flushed = await this.waitForWatcherFlush(entry);
        const remaining = entry.cg.getPendingFiles();
        if (!flushed && entry.cg.isWatching() && !entry.cg.isWatcherDegraded()) {
          watcherFlushWarning = `CodeGraph watcher still has ${remaining.length} pending file(s) after ${this.watchFlushWaitMs}ms; direct reconciliation completed while its queue remains intact.`;
        }
      }
      this.startWatching(entry);
      return [watcherFlushWarning, this.watcherWarning(entry)].filter(Boolean).join(" ") || undefined;
    } catch (error) {
      this.startWatching(entry);
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
   * @param options - Optional post-reconciliation status diagnostics.
   * @returns Ready graph or a user-facing not-ready result.
   */
  async ensureReady(
    projectPath: string | undefined,
    ctx: ExtensionContext,
    onUpdate?: ToolUpdateHandler,
    signal?: AbortSignal,
    options: EnsureReadyOptions = {},
  ): Promise<ReadyGraph | NotReady> {
    const explicitProjectPath = typeof projectPath === "string" && projectPath.trim() !== "";
    const snapshot = await this.buildStatusSnapshot(projectPath, ctx, {
      explicitProjectPath,
      includeGraphState: false,
      includeChangedFiles: false,
    });

    if (!snapshot.initialized) {
      if (!snapshot.candidateRoot) {
        return { ok: false, message: `CodeGraph is not initialized and no safe candidate root could be resolved from ${snapshot.searchPath}.`, snapshot };
      }
      if (snapshot.unsafeReason) {
        return { ok: false, message: `CodeGraph is not initialized at ${snapshot.candidateRoot}, and that root looks unsafe (${snapshot.unsafeReason}).`, snapshot };
      }
      const init = await this.initializeGraph(snapshot.candidateRoot, ctx, onUpdate, signal);
      if (!init.entry) return { ok: false, message: init.message ?? `CodeGraph is not initialized at ${snapshot.candidateRoot}.`, snapshot };
      const warnings = [init.message, await this.ensureFresh(init.entry)]
        .filter((warning): warning is string => !!warning);
      const readySnapshot = this.refreshStatusSnapshot(
        { startPath: snapshot.startPath, searchPath: snapshot.searchPath },
        init.entry,
        options.includeChangedFiles ?? false,
      );
      return {
        ok: true,
        root: init.entry.root,
        cg: init.entry.cg,
        entry: init.entry,
        snapshot: readySnapshot,
        syncWarning: warnings.join(" ") || undefined,
      };
    }

    const entry = await this.getEntry(snapshot.root!);
    const warnings = [
      await this.ensureCurrentIndex(entry, ctx, onUpdate, signal),
      await this.ensureFresh(entry),
    ].filter((warning): warning is string => !!warning);
    const readySnapshot = this.refreshStatusSnapshot(
      { startPath: snapshot.startPath, searchPath: snapshot.searchPath },
      entry,
      options.includeChangedFiles ?? false,
    );
    return { ok: true, root: entry.root, cg: entry.cg, entry, snapshot: readySnapshot, syncWarning: warnings.join(" ") || undefined };
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
