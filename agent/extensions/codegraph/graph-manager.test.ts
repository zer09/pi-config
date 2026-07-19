import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodeGraph } from "./codegraph-package.ts";
import { GraphManager } from "./graph-manager.ts";
import type { CodeGraphInstance, ExtensionAPI, ExtensionContext } from "./types.ts";

type WatchCallbacks = {
  onSyncComplete?: (result: { filesChanged: number; durationMs: number }) => void;
  onSyncError?: (error: Error) => void;
  onDegraded?: (reason: string) => void;
};

class FakeGraph {
  syncCalls = 0;
  watchCalls = 0;
  unwatchCalls = 0;
  changedFileChecks = 0;
  graphStateReads = 0;
  pendingFiles: Array<{ path: string; firstSeenMs: number; lastSeenMs: number; indexing: boolean }> = [];
  pendingReferences = 0;
  watching = false;
  degraded = false;
  stale = false;
  indexing = false;
  indexAllCalls = 0;
  degradedReason: string | null = null;
  watchCallbacks: WatchCallbacks | undefined;
  onExternalSync: ((call: number) => void) | undefined;
  syncGate: Promise<void> | undefined;

  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async sync() {
    this.syncCalls++;
    this.onExternalSync?.(this.syncCalls);
    if (this.syncGate) await this.syncGate;
    const filesChanged = this.pendingFiles.length;
    // External cg.sync() updates the DB but does not clear the watcher-owned
    // pending queue; only unwatch()/the watcher's own flush does that.
    this.pendingReferences = 0;
    return {
      filesChecked: 1,
      filesAdded: filesChanged,
      filesModified: 0,
      filesRemoved: 0,
      nodesUpdated: filesChanged,
      durationMs: 1,
    };
  }

  watch(options: WatchCallbacks) {
    this.watchCalls++;
    this.watchCallbacks = options;
    this.watching = true;
    this.degraded = false;
    this.degradedReason = null;
    return true;
  }

  degradeWatcher(reason: string) {
    this.degraded = true;
    this.degradedReason = reason;
    this.watchCallbacks?.onDegraded?.(reason);
    this.watching = false;
    this.pendingFiles = [];
  }

  unwatch() {
    this.unwatchCalls++;
    this.watching = false;
    this.pendingFiles = [];
  }

  isWatching() { return this.watching; }
  isWatcherDegraded() { return this.degraded; }
  getWatcherDegradedReason() { return this.degradedReason; }
  getPendingFiles() { return this.pendingFiles; }
  getPendingReferenceCount() { return this.pendingReferences; }
  getChangedFiles() {
    this.changedFileChecks++;
    return { added: [], modified: [], removed: [] };
  }

  completeWatcherSync(pendingAfter: FakeGraph["pendingFiles"] = []) {
    this.syncCalls++;
    this.pendingFiles = pendingAfter;
    this.watchCallbacks?.onSyncComplete?.({ filesChanged: 1, durationMs: 1 });
  }

  getStats() {
    this.graphStateReads++;
    return { fileCount: 1, nodeCount: 1, edgeCount: 0, dbSizeBytes: 1, lastUpdated: Date.now() };
  }
  getBackend() { return "node-sqlite"; }
  getJournalMode() { return "wal"; }
  getLastIndexedAt() { return Date.now(); }
  getIndexBuildInfo() { return { version: "1.4.1", extractionVersion: 24 }; }
  isIndexStale() { return this.stale; }
  getIndexState() { return "complete" as const; }
  isIndexing() { return this.indexing; }
  reopenIfReplaced() { return false; }
  async indexAll() {
    this.indexAllCalls++;
    return { success: true, errors: [] };
  }
  close() {}
}

function context(cwd: string, hasUI = false): ExtensionContext {
  return {
    cwd,
    hasUI,
    signal: new AbortController().signal,
    ui: hasUI ? { confirm: async () => true } : undefined,
  } as ExtensionContext;
}

function piForGitRoot(gitRoot: string): ExtensionAPI {
  return {
    async exec() {
      return { code: 0, stdout: `${gitRoot}\n`, stderr: "" };
    },
  } as unknown as ExtensionAPI;
}

function piWithoutGitRoot(): ExtensionAPI {
  return {
    async exec() {
      return { code: 1, stdout: "", stderr: "not a git repository" };
    },
  } as unknown as ExtensionAPI;
}

async function indexedRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(root, ".codegraph"));
  await writeFile(path.join(root, ".codegraph", "codegraph.db"), "");
  return root;
}

function replaceOpen(graphs: Map<string, FakeGraph>): () => void {
  const original = CodeGraph.open;
  Object.defineProperty(CodeGraph, "open", {
    configurable: true,
    writable: true,
    value: async (root: string) => {
      const graph = graphs.get(root);
      if (!graph) throw new Error(`Missing fake graph for ${root}`);
      return graph as unknown as CodeGraphInstance;
    },
  });
  return () => {
    Object.defineProperty(CodeGraph, "open", {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

function replaceRecreate(recreate: (root: string) => Promise<FakeGraph>): () => void {
  const original = CodeGraph.recreate;
  Object.defineProperty(CodeGraph, "recreate", {
    configurable: true,
    writable: true,
    value: async (root: string) => recreate(root) as unknown as CodeGraphInstance,
  });
  return () => {
    Object.defineProperty(CodeGraph, "recreate", {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

test("uses catch-up, watcher events, and TTL without getChangedFiles freshness polling", async () => {
  const root = await indexedRoot("pi-codegraph-freshness-");
  const graph = new FakeGraph(root);
  const restoreOpen = replaceOpen(new Map([[root, graph]]));
  const manager = new GraphManager({ pi: piForGitRoot(root), syncTtlMs: 10_000 });

  try {
    const first = await manager.ensureReady(root, context(root));
    assert.equal(first.ok, true);
    assert.equal(graph.syncCalls, 1, "first query must run a full catch-up reconciliation");
    assert.equal(graph.watchCalls, 1);
    assert.equal(graph.graphStateReads, 1, "ensureReady should carry location state and capture freshness once after reconciliation");
    assert.equal(graph.changedFileChecks, 0, "query freshness must not use git-status diagnostics");
    const queryReconciledAt = first.ok ? first.entry.lastSyncedAt : 0;

    await manager.ensureReady(root, context(root));
    assert.equal(graph.syncCalls, 1, "a query inside the TTL should not rescan a quiet watched root");

    graph.pendingFiles = [{ path: "src/changed.ts", firstSeenMs: 1, lastSeenMs: 1, indexing: false }];
    const unwatchCallsBeforePending = graph.unwatchCalls;
    setTimeout(() => {
      graph.completeWatcherSync([{ path: "src/newer.ts", firstSeenMs: 2, lastSeenMs: 2, indexing: false }]);
    }, 5);
    setTimeout(() => { graph.completeWatcherSync(); }, 15);

    await manager.ensureReady(root, context(root));
    assert.equal(graph.syncCalls, 3, "ensureReady should wait for the watcher and its mid-sync follow-up");
    assert.equal(graph.pendingFiles.length, 0);
    assert.equal(graph.watchCalls, 1, "query freshness must not restart an active watcher");
    assert.equal(graph.unwatchCalls, unwatchCallsBeforePending, "mid-sync watcher events must never be cleared by unwatch");
    if (first.ok) {
      assert.equal(first.entry.lastSyncedAt, queryReconciledAt, "watcher syncs must not postpone the independent TTL clock");
      assert.ok((first.entry.lastWatcherSyncedAt ?? 0) >= queryReconciledAt);
    }

    await manager.ensureReady(root, context(root));
    assert.equal(graph.syncCalls, 3, "another query inside the debounce/TTL window must not repeat the full sync");

    if (first.ok) first.entry.lastSyncedAt = Date.now() - 20_000;
    await manager.ensureReady(root, context(root));
    assert.equal(graph.syncCalls, 4, "the TTL safety net must reconcile even without watcher events");

    await manager.buildStatusSnapshot(root, context(root), { explicitProjectPath: true });
    assert.equal(graph.changedFileChecks, 1, "getChangedFiles remains available only to codegraph_status diagnostics");
  } finally {
    await manager.closeAll();
    restoreOpen();
    await rm(root, { recursive: true, force: true });
  }
});

test("starts watching before catch-up and drains events observed during that sync", async () => {
  const root = await indexedRoot("pi-codegraph-catchup-gap-");
  const graph = new FakeGraph(root);
  const restoreOpen = replaceOpen(new Map([[root, graph]]));
  const manager = new GraphManager({ pi: piForGitRoot(root) });
  let watcherActiveDuringCatchup = false;

  graph.onExternalSync = (call) => {
    if (call !== 1) return;
    watcherActiveDuringCatchup = graph.watching;
    graph.pendingFiles = [{ path: "src/during-catchup.ts", firstSeenMs: 1, lastSeenMs: 1, indexing: false }];
    setTimeout(() => { graph.completeWatcherSync(); }, 5);
  };

  try {
    const ready = await manager.ensureReady(root, context(root));
    assert.equal(ready.ok, true);
    assert.equal(watcherActiveDuringCatchup, true, "watcher must capture files created during initial reconciliation");
    assert.equal(graph.syncCalls, 2, "ensureReady must wait for the watcher follow-up before returning");
    assert.equal(graph.pendingFiles.length, 0);
  } finally {
    await manager.closeAll();
    restoreOpen();
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent readiness waits for watcher events captured during the shared sync", async () => {
  const root = await indexedRoot("pi-codegraph-concurrent-drain-");
  const graph = new FakeGraph(root);
  const restoreOpen = replaceOpen(new Map([[root, graph]]));
  const manager = new GraphManager({ pi: piForGitRoot(root) });
  let releaseSync: (() => void) | undefined;
  graph.syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
  graph.onExternalSync = (call) => {
    if (call === 1) {
      graph.pendingFiles = [{ path: "src/concurrent.ts", firstSeenMs: 1, lastSeenMs: 1, indexing: false }];
    }
  };

  try {
    const first = manager.ensureReady(root, context(root));
    while (graph.syncCalls === 0) await new Promise((resolve) => setTimeout(resolve, 1));

    let secondSettled = false;
    const second = manager.ensureReady(root, context(root)).finally(() => { secondSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseSync?.();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(secondSettled, false, "a waiter must not query before the shared sync's watcher follow-up");

    graph.completeWatcherSync();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.equal(graph.pendingFiles.length, 0);
  } finally {
    await manager.closeAll();
    restoreOpen();
    await rm(root, { recursive: true, force: true });
  }
});

test("retries a degraded watcher after bounded backoff", async () => {
  const root = await indexedRoot("pi-codegraph-watcher-retry-");
  const graph = new FakeGraph(root);
  const restoreOpen = replaceOpen(new Map([[root, graph]]));
  const manager = new GraphManager({ pi: piForGitRoot(root), watchRetryMs: 100 });

  try {
    const first = await manager.ensureReady(root, context(root));
    assert.equal(first.ok, true);
    assert.equal(graph.watchCalls, 1);

    graph.degradeWatcher("temporary lock contention");
    const duringBackoff = await manager.ensureReady(root, context(root));
    assert.equal(duringBackoff.ok, true);
    assert.equal(graph.watchCalls, 1, "degradation must not cause per-query restart hammering");
    if (duringBackoff.ok) assert.match(duringBackoff.syncWarning ?? "", /temporary lock contention/);

    await new Promise((resolve) => setTimeout(resolve, 110));
    const recovered = await manager.ensureReady(root, context(root));
    assert.equal(recovered.ok, true);
    assert.equal(graph.watchCalls, 2, "an inactive degraded watcher should retry after backoff");
    assert.equal(graph.watching, true);
    assert.equal(graph.degraded, false);
  } finally {
    await manager.closeAll();
    restoreOpen();
    await rm(root, { recursive: true, force: true });
  }
});

test("limits concurrent watchers and catches up an evicted root when it becomes active again", async () => {
  const roots = await Promise.all([
    indexedRoot("pi-codegraph-lru-a-"),
    indexedRoot("pi-codegraph-lru-b-"),
    indexedRoot("pi-codegraph-lru-c-"),
  ]);
  const graphs = new Map(roots.map((root) => [root, new FakeGraph(root)] as const));
  const restoreOpen = replaceOpen(graphs);
  const manager = new GraphManager({ pi: piForGitRoot(roots[0]!), maxWatchedRoots: 2 });

  try {
    for (const root of roots) await manager.ensureReady(root, context(root));

    assert.equal(graphs.get(roots[0]!)!.watching, false);
    assert.equal(graphs.get(roots[1]!)!.watching, true);
    assert.equal(graphs.get(roots[2]!)!.watching, true);

    await manager.ensureReady(roots[0], context(roots[0]!));
    assert.equal(graphs.get(roots[0]!)!.syncCalls, 2, "an evicted root must catch up before it is queried again");
    assert.equal([...graphs.values()].filter((graph) => graph.watching).length, 2);
  } finally {
    await manager.closeAll();
    restoreOpen();
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  }
});

test("waits for watcher syncs to become idle before recreating the database", async () => {
  const root = await indexedRoot("pi-codegraph-recreate-");
  const oldGraph = new FakeGraph(root);
  const freshGraph = new FakeGraph(root);
  const restoreOpen = replaceOpen(new Map([[root, oldGraph]]));
  let recreateObservedBusyGraph = false;
  const restoreRecreate = replaceRecreate(async () => {
    recreateObservedBusyGraph = oldGraph.indexing;
    return freshGraph;
  });
  const manager = new GraphManager({ pi: piForGitRoot(root) });

  try {
    const initial = await manager.ensureReady(root, context(root));
    assert.equal(initial.ok, true);
    assert.equal(oldGraph.watching, true);

    oldGraph.stale = true;
    oldGraph.indexing = true;
    setTimeout(() => { oldGraph.indexing = false; }, 20);

    const reindexed = await manager.ensureReady(
      root,
      context(root, true),
      undefined,
      undefined,
      { includeChangedFiles: true },
    );
    assert.equal(reindexed.ok, true);
    assert.equal(recreateObservedBusyGraph, false, "database recreation must wait for invisible watcher sync work");
    assert.ok(oldGraph.unwatchCalls >= 1, "watcher must stop before recreation");
    assert.equal(freshGraph.indexAllCalls, 1);
    assert.equal(freshGraph.syncCalls, 1, "full reindex must receive a watched catch-up pass before readiness");
    assert.equal(freshGraph.watching, true);
    assert.equal(freshGraph.changedFileChecks, 1, "status-oriented readiness must retain changed-file diagnostics");
  } finally {
    await manager.closeAll();
    restoreRecreate();
    restoreOpen();
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps an explicit non-Git subdirectory on its initialized ancestor graph", async () => {
  const parent = await indexedRoot("pi-codegraph-nongit-parent-");
  const child = path.join(parent, "src");
  await mkdir(child);
  const parentGraph = new FakeGraph(parent);
  const restoreOpen = replaceOpen(new Map([[parent, parentGraph]]));
  const manager = new GraphManager({ pi: piWithoutGitRoot() });

  try {
    const result = await manager.ensureReady(child, context(parent));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.root, parent);
    assert.equal(parentGraph.syncCalls, 1);
    assert.equal(parentGraph.watchCalls, 1);
  } finally {
    await manager.closeAll();
    restoreOpen();
    await rm(parent, { recursive: true, force: true });
  }
});

test("uses an initialized monorepo graph for an explicit subdirectory in the same Git root", async () => {
  const parent = await indexedRoot("pi-codegraph-monorepo-parent-");
  const child = path.join(parent, "packages", "api");
  await mkdir(child, { recursive: true });
  const parentGraph = new FakeGraph(parent);
  const restoreOpen = replaceOpen(new Map([[parent, parentGraph]]));
  const manager = new GraphManager({ pi: piForGitRoot(parent) });

  try {
    const result = await manager.ensureReady(child, context(parent));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.root, parent);
    assert.equal(parentGraph.syncCalls, 1);
  } finally {
    await manager.closeAll();
    restoreOpen();
    await rm(parent, { recursive: true, force: true });
  }
});

test("keeps an explicit Git subproject as the initialization candidate", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "pi-codegraph-monorepo-unindexed-"));
  const child = path.join(parent, "packages", "api");
  await mkdir(child, { recursive: true });
  const manager = new GraphManager({ pi: piForGitRoot(parent) });

  try {
    const snapshot = await manager.buildStatusSnapshot(child, context(parent), {
      explicitProjectPath: true,
      includeGraphState: false,
      includeChangedFiles: false,
    });
    assert.equal(snapshot.initialized, false);
    assert.equal(snapshot.candidateRoot, child, "Git metadata must not replace the explicitly requested index root");
  } finally {
    await manager.closeAll();
    await rm(parent, { recursive: true, force: true });
  }
});

test("uses the current Git repository index when no projectPath is supplied", async () => {
  const parent = await indexedRoot("pi-codegraph-default-root-");
  const child = path.join(parent, "src");
  await mkdir(child);
  const parentGraph = new FakeGraph(parent);
  const restoreOpen = replaceOpen(new Map([[parent, parentGraph]]));
  const manager = new GraphManager({ pi: piForGitRoot(parent) });

  try {
    const result = await manager.ensureReady(undefined, context(child));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.root, parent);
  } finally {
    await manager.closeAll();
    restoreOpen();
    await rm(parent, { recursive: true, force: true });
  }
});

test("does not let default cwd in an unindexed nested repository borrow its ancestor graph", async () => {
  const parent = await indexedRoot("pi-codegraph-default-nested-parent-");
  const nested = path.join(parent, "nested-worktree");
  await mkdir(nested);
  const parentGraph = new FakeGraph(parent);
  const restoreOpen = replaceOpen(new Map([[parent, parentGraph]]));
  const manager = new GraphManager({ pi: piForGitRoot(nested) });

  try {
    const result = await manager.ensureReady(undefined, context(nested));
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(`CodeGraph is not initialized at ${nested.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(parentGraph.syncCalls, 0);
  } finally {
    await manager.closeAll();
    restoreOpen();
    await rm(parent, { recursive: true, force: true });
  }
});

test("does not let an unindexed nested repository borrow its ancestor graph", async () => {
  const parent = await indexedRoot("pi-codegraph-parent-");
  const nested = path.join(parent, "nested-worktree");
  await mkdir(nested);
  const parentGraph = new FakeGraph(parent);
  const restoreOpen = replaceOpen(new Map([[parent, parentGraph]]));
  const manager = new GraphManager({ pi: piForGitRoot(nested) });

  try {
    const result = await manager.ensureReady(nested, context(parent));
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(`CodeGraph is not initialized at ${nested.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(parentGraph.syncCalls, 0);
    assert.equal(parentGraph.watchCalls, 0);
  } finally {
    await manager.closeAll();
    restoreOpen();
    await rm(parent, { recursive: true, force: true });
  }
});
