import { access, readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import type * as CodeGraphTypes from "@colbymchenry/codegraph";
import type {
  Edge,
  FileRecord,
  Node,
  NodeKind,
  SearchResult,
  Subgraph,
} from "@colbymchenry/codegraph";

const require = createRequire(import.meta.url);
const codegraphModule = require("@colbymchenry/codegraph") as typeof CodeGraphTypes & {
  default?: typeof CodeGraphTypes.CodeGraph;
};
const CodeGraph = (codegraphModule.CodeGraph ?? codegraphModule.default) as typeof CodeGraphTypes.CodeGraph;
const { findNearestCodeGraphRoot } = codegraphModule;

type CodeGraphInstance = CodeGraphTypes.CodeGraph;

type ExtensionAPI = {
  registerTool(tool: Record<string, unknown>): void;
  on(event: string, handler: (...args: any[]) => unknown): void;
  exec(command: string, args: string[], options?: { cwd?: string; timeout?: number; signal?: AbortSignal }): Promise<{
    stdout: string;
    stderr: string;
    code: number;
    killed: boolean;
  }>;
};

type ExtensionContext = {
  cwd: string;
  hasUI?: boolean;
  mode?: string;
  signal?: AbortSignal;
  ui: {
    confirm(title: string, message: string, options?: Record<string, unknown>): Promise<boolean>;
  };
};

const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2_000;

type TruncationResult = {
  content: string;
  truncated: boolean;
  totalLines: number;
  outputLines: number;
  totalBytes: number;
  outputBytes: number;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}

function truncateHead(content: string, options: { maxBytes: number; maxLines: number }): TruncationResult {
  const totalBytes = Buffer.byteLength(content, "utf8");
  const totalLines = content.length === 0 ? 0 : content.split("\n").length;
  if (totalBytes <= options.maxBytes && totalLines <= options.maxLines) {
    return { content, truncated: false, totalLines, outputLines: totalLines, totalBytes, outputBytes: totalBytes };
  }

  const lines = content.split("\n");
  const output: string[] = [];
  let outputBytes = 0;
  for (const line of lines) {
    if (output.length >= options.maxLines) break;
    const prefix = output.length === 0 ? "" : "\n";
    const chunk = `${prefix}${line}`;
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    if (outputBytes + chunkBytes > options.maxBytes) {
      const remaining = Math.max(0, options.maxBytes - outputBytes);
      if (remaining > 0) output.push(Buffer.from(chunk).subarray(0, remaining).toString("utf8"));
      break;
    }
    output.push(chunk);
    outputBytes += chunkBytes;
  }
  const truncated = output.join("");
  const finalBytes = Buffer.byteLength(truncated, "utf8");
  const outputLines = truncated.length === 0 ? 0 : truncated.split("\n").length;
  return { content: truncated, truncated: true, totalLines, outputLines, totalBytes, outputBytes: finalBytes };
}

function StringEnum<T extends readonly string[]>(values: T, options: Record<string, unknown> = {}) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

type CachedGraph = {
  root: string;
  cg: CodeGraphInstance;
  openedAt: number;
  lastSyncedAt: number;
  syncInFlight?: Promise<void>;
};

type ReadyGraph = {
  ok: true;
  root: string;
  cg: CodeGraphInstance;
  entry: CachedGraph;
  snapshot: StatusSnapshot;
  syncWarning?: string;
};

type NotReady = {
  ok: false;
  message: string;
  snapshot?: StatusSnapshot;
};

type StatusSnapshot = {
  initialized: boolean;
  startPath: string;
  searchPath: string;
  root?: string;
  candidateRoot?: string;
  unsafeReason?: string;
  stats?: ReturnType<CodeGraphInstance["getStats"]>;
  backend?: string;
  journalMode?: string;
  lastIndexedAt?: number | null;
  indexBuildInfo?: ReturnType<CodeGraphInstance["getIndexBuildInfo"]>;
  indexStale?: boolean;
  changedFiles?: ReturnType<CodeGraphInstance["getChangedFiles"]>;
  pendingFiles?: ReturnType<CodeGraphInstance["getPendingFiles"]>;
  isIndexing?: boolean;
  isWatching?: boolean;
  syncTtlMs: number;
  lastSyncedAt?: number;
  syncInFlight?: boolean;
  nextQuerySync?: "disabled" | "not-needed" | "in-flight" | "now" | "after-ttl";
  nextQuerySyncAfterMs?: number;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const NODE_KIND_VALUES = [
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

const DEFAULT_SYNC_TTL_MS = 10_000;
const DEFAULT_GIT_TIMEOUT_MS = 2_000;
const MAX_TOOL_RESULTS = 100;

const ProjectPath = Type.Optional(Type.String({
  description: "Optional project path. Defaults to Pi's current working directory. A leading @ is accepted and ignored.",
}));

const Limit = (defaultValue: number, max = MAX_TOOL_RESULTS) => Type.Optional(Type.Integer({
  description: `Maximum results to return (default ${defaultValue}, max ${max}).`,
  minimum: 1,
  maximum: max,
  default: defaultValue,
}));

function parseSyncTtlMs(): number {
  const raw = process.env.CODEGRAPH_PI_SYNC_TTL_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SYNC_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SYNC_TTL_MS;
}

function parseAutoInitPolicy(): "confirm" | "always" | "never" {
  const raw = (process.env.CODEGRAPH_PI_AUTO_INIT ?? "confirm").toLowerCase();
  if (raw === "always" || raw === "never" || raw === "confirm") return raw;
  return "confirm";
}

function textResult(content: string, details: Record<string, unknown> = {}): ToolResult {
  const truncation = truncateHead(content, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  let body = truncation.content;
  if (truncation.truncated) {
    body += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
    body += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
    body += ` Reduce the query/limit or use a narrower codegraph_node/codegraph_search call.]`;
  }
  return {
    content: [{ type: "text", text: body }],
    details: { ...details, truncation },
  };
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function stripAtPath(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolvePath(value: string | undefined, cwd: string): string {
  const raw = expandHome(stripAtPath(value?.trim() || cwd));
  return path.resolve(cwd, raw);
}

async function existingSearchPath(resolvedPath: string): Promise<string> {
  try {
    const s = await stat(resolvedPath);
    return s.isFile() ? path.dirname(resolvedPath) : resolvedPath;
  } catch {
    return resolvedPath;
  }
}

async function canonicalPath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch {
    return path.resolve(value);
  }
}

function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

async function unsafeRootReason(projectRoot: string): Promise<string | null> {
  const root = await canonicalPath(projectRoot);
  const fsRoot = path.parse(root).root;
  if (root === fsRoot) return "filesystem root";

  const home = await canonicalPath(os.homedir());
  if (root === home) return "home directory";
  if (isPathInside(root, home)) return "parent of the home directory";

  return null;
}

async function resolveCandidateRoot(
  pi: ExtensionAPI,
  startPath: string,
  cwd: string,
  explicitProjectPath: boolean,
  signal?: AbortSignal,
): Promise<{ root?: string; error?: string }> {
  const searchPath = await existingSearchPath(startPath);

  if (explicitProjectPath) {
    try {
      const s = await stat(searchPath);
      if (!s.isDirectory()) return { error: `projectPath is not a directory: ${searchPath}` };
      return { root: await canonicalPath(searchPath) };
    } catch (error) {
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

function changedCount(changed?: ReturnType<CodeGraphInstance["getChangedFiles"]>): number {
  if (!changed) return 0;
  return changed.added.length + changed.modified.length + changed.removed.length;
}

function formatTimestamp(ms?: number | null): string {
  if (!ms) return "never";
  const delta = Date.now() - ms;
  const ago = delta < 1_000 ? "just now" : `${Math.round(delta / 1_000)}s ago`;
  return `${new Date(ms).toISOString()} (${ago})`;
}

function formatBytes(bytes: number | undefined): string {
  return typeof bytes === "number" ? formatSize(bytes) : "unknown";
}

function coerceLimit(value: unknown, defaultValue: number, max = MAX_TOOL_RESULTS): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : defaultValue;
  return Math.max(1, Math.min(max, n));
}

function normalizeFileFilter(file: string | undefined): string | undefined {
  if (!file?.trim()) return undefined;
  return normalizeSlashes(stripAtPath(file.trim())).replace(/^\.\//, "");
}

function fileMatches(filePath: string, filter: string): boolean {
  const file = normalizeSlashes(filePath);
  const wanted = normalizeSlashes(filter).replace(/^\.\//, "");
  return file === wanted || file.endsWith(`/${wanted}`) || path.posix.basename(file) === wanted;
}

function nodeLocation(node: Node, lineOverride?: number): string {
  const line = lineOverride ?? node.startLine;
  const end = node.endLine && node.endLine !== line ? `-${node.endLine}` : "";
  return `${node.filePath}:${line}${end}`;
}

function nodeTitle(node: Node): string {
  const sig = node.signature ? ` — ${node.signature}` : "";
  return `${node.kind} ${node.qualifiedName || node.name} — ${nodeLocation(node)}${sig}`;
}

function formatNodeLine(node: Node, options: { score?: number; line?: number; label?: string } = {}): string {
  const label = options.label ? ` [${options.label}]` : "";
  const score = typeof options.score === "number" ? ` score=${options.score.toFixed(2)}` : "";
  const sig = node.signature ? ` — ${node.signature}` : "";
  return `- ${node.kind} ${node.qualifiedName || node.name}${label} — ${nodeLocation(node, options.line)}${sig}${score}`;
}

function formatReferenceLine(ref: { node: Node; edge: Edge }, label?: string): string {
  const edgeLabel = label ?? ref.edge.kind;
  return formatNodeLine(ref.node, { line: ref.edge.line ?? ref.node.startLine, label: edgeLabel });
}

function groupNodesByFile(nodes: Node[]): Map<string, Node[]> {
  const grouped = new Map<string, Node[]>();
  for (const node of nodes) {
    const list = grouped.get(node.filePath) ?? [];
    list.push(node);
    grouped.set(node.filePath, list);
  }
  return grouped;
}

function formatChangedFiles(changed?: ReturnType<CodeGraphInstance["getChangedFiles"]>): string[] {
  if (!changed) return ["- pending changes: unknown"];
  const total = changedCount(changed);
  const lines = [`- pending changes: ${total} (${changed.added.length} added, ${changed.modified.length} modified, ${changed.removed.length} removed)`];
  const sample = [
    ...changed.added.map((f) => `A ${f}`),
    ...changed.modified.map((f) => `M ${f}`),
    ...changed.removed.map((f) => `D ${f}`),
  ].slice(0, 20);
  for (const item of sample) lines.push(`  - ${item}`);
  if (total > sample.length) lines.push(`  - ... ${total - sample.length} more`);
  return lines;
}

function formatStatus(snapshot: StatusSnapshot, initMessage?: string): string {
  const lines: string[] = ["# CodeGraph status", ""];
  if (initMessage) lines.push(`> ${initMessage}`, "");

  if (!snapshot.initialized) {
    lines.push("- initialized: no");
    lines.push(`- searched from: ${snapshot.searchPath}`);
    if (snapshot.candidateRoot) lines.push(`- candidate root: ${snapshot.candidateRoot}`);
    if (snapshot.unsafeReason) lines.push(`- blocked: candidate root looks like ${snapshot.unsafeReason}`);
    lines.push("", "CodeGraph is unavailable for this project until it is initialized. Query tools will ask before initializing safe roots unless `CODEGRAPH_PI_AUTO_INIT=always` or `never` changes that policy.");
    return lines.join("\n");
  }

  lines.push(`- initialized: yes`);
  lines.push(`- root: ${snapshot.root}`);
  lines.push(`- backend: ${snapshot.backend ?? "unknown"}`);
  lines.push(`- journal mode: ${snapshot.journalMode ?? "unknown"}`);
  lines.push(`- watching: ${snapshot.isWatching ? "yes" : "no"}`);
  lines.push(`- indexing: ${snapshot.isIndexing ? "yes" : "no"}`);

  if (snapshot.stats) {
    lines.push(`- files: ${snapshot.stats.fileCount}`);
    lines.push(`- nodes: ${snapshot.stats.nodeCount}`);
    lines.push(`- edges: ${snapshot.stats.edgeCount}`);
    lines.push(`- database size: ${formatBytes(snapshot.stats.dbSizeBytes)}`);
    lines.push(`- stats updated: ${formatTimestamp(snapshot.stats.lastUpdated)}`);
  }

  lines.push(`- last indexed: ${formatTimestamp(snapshot.lastIndexedAt)}`);
  if (snapshot.indexBuildInfo) {
    lines.push(`- indexed with: ${snapshot.indexBuildInfo.version ?? "unknown"} / extraction ${snapshot.indexBuildInfo.extractionVersion ?? "unknown"}`);
  }
  lines.push(`- full reindex needed: ${snapshot.indexStale ? "yes" : "no"}`);
  if (snapshot.indexStale) {
    lines.push("  - Recommendation: ask the user before running a full `codegraph index` / future `codegraph_index` flow.");
  }

  lines.push(...formatChangedFiles(snapshot.changedFiles));

  const pendingWatcher = snapshot.pendingFiles ?? [];
  lines.push(`- watcher pending files: ${pendingWatcher.length}`);
  for (const pending of pendingWatcher.slice(0, 20)) {
    lines.push(`  - ${pending.path}${pending.indexing ? " (indexing)" : ""}`);
  }
  if (pendingWatcher.length > 20) lines.push(`  - ... ${pendingWatcher.length - 20} more`);

  lines.push(`- extension sync TTL: ${snapshot.syncTtlMs < 0 ? "disabled" : `${snapshot.syncTtlMs}ms`}`);
  lines.push(`- extension last sync: ${formatTimestamp(snapshot.lastSyncedAt)}`);
  lines.push(`- extension sync in flight: ${snapshot.syncInFlight ? "yes" : "no"}`);
  lines.push(`- next query sync: ${snapshot.nextQuerySync ?? "unknown"}${snapshot.nextQuerySyncAfterMs ? ` in ~${snapshot.nextQuerySyncAfterMs}ms` : ""}`);

  return lines.join("\n");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sortSearchResults(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => b.score - a.score || a.node.filePath.localeCompare(b.node.filePath) || a.node.startLine - b.node.startLine);
}

function uniqueNodes(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.node.id)) continue;
    seen.add(result.node.id);
    out.push(result);
  }
  return out;
}

function searchMatches(cg: CodeGraphInstance, symbol: string, options: { file?: string; limit?: number; kinds?: NodeKind[] } = {}): SearchResult[] {
  const query = symbol.trim();
  const searchLimit = Math.max(options.limit ?? 10, 50);
  const exact = /^[\w$#:.<>-]+$/.test(query)
    ? cg.getNodesByName(query).map((node) => ({ node, score: 1 }))
    : [];
  const ranked = cg.searchNodes(query, { limit: searchLimit, kinds: options.kinds });
  let results = uniqueNodes(sortSearchResults([...exact, ...ranked]));
  if (options.file) {
    const filter = normalizeFileFilter(options.file)!;
    results = results.filter((result) => fileMatches(result.node.filePath, filter));
  }
  return results.slice(0, options.limit ?? 10);
}

function formatNoMatches(symbol: string, file?: string): string {
  const fileNote = file ? ` in file matching ${file}` : "";
  return `No CodeGraph symbols found for ${JSON.stringify(symbol)}${fileNote}. Try codegraph_search with a broader query.`;
}

function formatFileChoices(files: FileRecord[], query: string): string {
  const lines = [`Multiple indexed files match ${JSON.stringify(query)}. Pass a more specific file path:`, ""];
  for (const file of files.slice(0, 50)) {
    lines.push(`- ${file.path} (${file.language}, ${file.nodeCount} symbols)`);
  }
  if (files.length > 50) lines.push(`- ... ${files.length - 50} more`);
  return lines.join("\n");
}

function findIndexedFiles(cg: CodeGraphInstance, file: string): FileRecord[] {
  const filter = normalizeFileFilter(file);
  if (!filter) return [];
  const files = cg.getFiles();
  const exact = files.filter((record) => normalizeSlashes(record.path) === filter);
  if (exact.length) return exact;
  const suffix = files.filter((record) => fileMatches(record.path, filter));
  return suffix.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
}

function lineNumbered(content: string, offset?: number, limit?: number): { text: string; shownStart: number; shownEnd: number; total: number } {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const start = Math.max(1, Math.floor(offset ?? 1));
  const end = limit ? Math.min(lines.length, start + Math.max(1, Math.floor(limit)) - 1) : lines.length;
  const selected = lines.slice(start - 1, end).map((line, index) => `${start + index}\t${line}`).join("\n");
  return { text: selected, shownStart: start, shownEnd: end, total: lines.length };
}

function formatSymbolOutline(nodes: Node[]): string {
  if (nodes.length === 0) return "No symbols indexed in this file.";
  return nodes
    .sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name))
    .map((node) => formatNodeLine(node))
    .join("\n");
}

function formatSubgraphImpact(target: Node, subgraph: Subgraph, limit: number): string {
  const nodes = [...subgraph.nodes.values()]
    .filter((node) => node.id !== target.id)
    .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startLine - b.startLine)
    .slice(0, limit);

  if (nodes.length === 0) {
    return `No impacted nodes found for ${nodeTitle(target)}.`;
  }

  const lines = [`## Impact for ${nodeTitle(target)}`, ""];
  const grouped = groupNodesByFile(nodes);
  for (const [file, fileNodes] of grouped) {
    lines.push(`### ${file}`);
    for (const node of fileNodes) lines.push(formatNodeLine(node));
    lines.push("");
  }
  const total = subgraph.nodes.size - 1;
  if (total > nodes.length) lines.push(`_Showing ${nodes.length} of ${total} impacted nodes. Narrow the symbol/file or lower depth for a smaller result._`);
  lines.push(`_Edges considered: ${subgraph.edges.length}; depth roots: ${subgraph.roots.length}._`);
  return lines.join("\n").trimEnd();
}

export default function codegraphExtension(pi: ExtensionAPI): void {
  const syncTtlMs = parseSyncTtlMs();
  const autoInitPolicy = parseAutoInitPolicy();
  const graphs = new Map<string, CachedGraph>();

  async function getEntry(root: string): Promise<CachedGraph> {
    const canonicalRoot = await canonicalPath(root);
    const existing = graphs.get(canonicalRoot);
    if (existing) return existing;
    const cg = await CodeGraph.open(canonicalRoot, { sync: false });
    const entry: CachedGraph = {
      root: canonicalRoot,
      cg,
      openedAt: Date.now(),
      lastSyncedAt: 0,
    };
    graphs.set(canonicalRoot, entry);
    return entry;
  }

  async function buildStatusSnapshot(
    startInput: string | undefined,
    ctx: ExtensionContext,
    options: { explicitProjectPath?: boolean } = {},
  ): Promise<StatusSnapshot> {
    const startPath = resolvePath(startInput, ctx.cwd);
    const searchPath = await existingSearchPath(startPath);
    const nearest = findNearestCodeGraphRoot(searchPath);

    if (!nearest) {
      const candidate = await resolveCandidateRoot(pi, startPath, ctx.cwd, !!options.explicitProjectPath, ctx.signal);
      const snapshot: StatusSnapshot = {
        initialized: false,
        startPath,
        searchPath,
        candidateRoot: candidate.root,
        syncTtlMs,
      };
      if (candidate.root) snapshot.unsafeReason = await unsafeRootReason(candidate.root);
      return snapshot;
    }

    const root = await canonicalPath(nearest);
    const entry = await getEntry(root);
    const changedFiles = entry.cg.getChangedFiles();
    const pending = changedCount(changedFiles);
    const sinceSync = Date.now() - entry.lastSyncedAt;
    let nextQuerySync: StatusSnapshot["nextQuerySync"];
    let nextQuerySyncAfterMs: number | undefined;

    if (syncTtlMs < 0) {
      nextQuerySync = "disabled";
    } else if (entry.syncInFlight) {
      nextQuerySync = "in-flight";
    } else if (pending === 0) {
      nextQuerySync = "not-needed";
    } else if (sinceSync > syncTtlMs) {
      nextQuerySync = "now";
    } else {
      nextQuerySync = "after-ttl";
      nextQuerySyncAfterMs = syncTtlMs - sinceSync;
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
      syncTtlMs,
      lastSyncedAt: entry.lastSyncedAt,
      syncInFlight: !!entry.syncInFlight,
      nextQuerySync,
      nextQuerySyncAfterMs,
    };
  }

  async function initializeGraph(
    root: string,
    ctx: ExtensionContext,
    onUpdate?: (result: ToolResult) => void,
    signal?: AbortSignal,
  ): Promise<{ entry?: CachedGraph; message?: string }> {
    const unsafe = await unsafeRootReason(root);
    if (unsafe) return { message: `Refusing to initialize CodeGraph at ${root}: candidate root looks like ${unsafe}.` };
    if (autoInitPolicy === "never") return { message: `CodeGraph is not initialized at ${root}; auto-init is disabled by CODEGRAPH_PI_AUTO_INIT=never.` };

    if (autoInitPolicy === "confirm") {
      if (!ctx.hasUI) {
        return { message: `CodeGraph is not initialized at ${root}; no UI is available to confirm initialization. Run \`codegraph init ${root}\` or set CODEGRAPH_PI_AUTO_INIT=always for trusted roots.` };
      }
      const ok = await ctx.ui.confirm("Initialize CodeGraph?", `Create .codegraph and index ${root}?`);
      if (!ok) return { message: `CodeGraph initialization declined for ${root}.` };
    }

    onUpdate?.(textResult(`Initializing CodeGraph at ${root}...`));
    const cg = await CodeGraph.init(root, { index: false });
    const entry: CachedGraph = {
      root,
      cg,
      openedAt: Date.now(),
      lastSyncedAt: 0,
    };
    graphs.set(root, entry);

    onUpdate?.(textResult(`Indexing ${root} with CodeGraph...`));
    const result = await cg.indexAll({
      signal,
      onProgress(progress) {
        onUpdate?.(textResult(`Indexing ${root}: ${progress.phase} ${progress.current}/${progress.total}`));
      },
    });
    if (!result.success) {
      return { entry, message: `CodeGraph initialized at ${root}, but initial indexing failed: ${result.errors.map((e) => e.message).join("; ")}` };
    }
    entry.lastSyncedAt = Date.now();
    return { entry, message: `Initialized and indexed CodeGraph at ${root}.` };
  }

  async function ensureFresh(entry: CachedGraph): Promise<string | undefined> {
    if (syncTtlMs < 0) return undefined;

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
    if (sinceSync <= syncTtlMs) {
      return `CodeGraph has ${pending} pending change(s); sync skipped until TTL expires (~${syncTtlMs - sinceSync}ms).`;
    }

    entry.syncInFlight = entry.cg.sync()
      .then(() => {
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

  async function ensureReady(
    projectPath: string | undefined,
    ctx: ExtensionContext,
    onUpdate?: (result: ToolResult) => void,
    signal?: AbortSignal,
  ): Promise<ReadyGraph | NotReady> {
    const explicitProjectPath = typeof projectPath === "string" && projectPath.trim() !== "";
    let snapshot = await buildStatusSnapshot(projectPath, ctx, { explicitProjectPath });

    if (!snapshot.initialized) {
      if (!snapshot.candidateRoot) {
        return { ok: false, message: `CodeGraph is not initialized and no safe candidate root could be resolved from ${snapshot.searchPath}.`, snapshot };
      }
      if (snapshot.unsafeReason) {
        return { ok: false, message: `CodeGraph is not initialized at ${snapshot.candidateRoot}, and that root looks unsafe (${snapshot.unsafeReason}).`, snapshot };
      }
      const init = await initializeGraph(snapshot.candidateRoot, ctx, onUpdate, signal);
      if (!init.entry) return { ok: false, message: init.message ?? `CodeGraph is not initialized at ${snapshot.candidateRoot}.`, snapshot };
      snapshot = await buildStatusSnapshot(init.entry.root, ctx, { explicitProjectPath: true });
      return { ok: true, root: init.entry.root, cg: init.entry.cg, entry: init.entry, snapshot, syncWarning: init.message };
    }

    const entry = await getEntry(snapshot.root!);
    const syncWarning = await ensureFresh(entry);
    const refreshedSnapshot = await buildStatusSnapshot(entry.root, ctx, { explicitProjectPath: true });
    return { ok: true, root: entry.root, cg: entry.cg, entry, snapshot: refreshedSnapshot, syncWarning };
  }

  function withWarningPrefix(graph: ReadyGraph, content: string): string {
    return graph.syncWarning ? `> ${graph.syncWarning}\n\n${content}` : content;
  }

  pi.on("session_shutdown", () => {
    for (const entry of graphs.values()) {
      try {
        entry.cg.close();
      } catch {
        // Ignore cleanup failures during runtime shutdown.
      }
    }
    graphs.clear();
  });

  pi.registerTool({
    name: "codegraph_explore",
    label: "CodeGraph Explore",
    description: `Explore relevant indexed code context for a question, flow, bug, or area. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Explore indexed source code context with CodeGraph",
    promptGuidelines: [
      "Use codegraph_explore first for indexed source-code architecture, flow, bug, what/where, or how-does-X-work questions; treat returned source as already read.",
      "Use codegraph_explore instead of grep/read exploration for indexed source code; fall back to raw file tools only for docs/configs/unindexed or stale files.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Natural-language question or symbol/file names to explore." }),
      maxNodes: Limit(30, 200),
      includeCode: Type.Optional(Type.Boolean({ description: "Include source blocks in the response.", default: true })),
      projectPath: ProjectPath,
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const graph = await ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const output = await graph.cg.buildContext(params.query, {
        maxNodes: coerceLimit(params.maxNodes, 30, 200),
        includeCode: params.includeCode ?? true,
        format: "markdown",
      });
      return textResult(withWarningPrefix(graph, String(output)), { root: graph.root, snapshot: graph.snapshot });
    },
  });

  pi.registerTool({
    name: "codegraph_search",
    label: "CodeGraph Search",
    description: `Find indexed symbols by name or text. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Find indexed symbols with CodeGraph",
    promptGuidelines: [
      "Use codegraph_search only to locate indexed symbols by name; use codegraph_explore for understanding an area.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Symbol name or text to search for." }),
      kind: Type.Optional(StringEnum(NODE_KIND_VALUES, { description: "Optional node kind filter." })),
      limit: Limit(20),
      projectPath: ProjectPath,
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const graph = await ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 20);
      const results = graph.cg.searchNodes(params.query, {
        limit,
        kinds: params.kind ? [params.kind as NodeKind] : undefined,
      });
      const lines = results.length
        ? results.map((result) => formatNodeLine(result.node, { score: result.score }))
        : [`No CodeGraph symbols found for ${JSON.stringify(params.query)}.`];
      return textResult(withWarningPrefix(graph, lines.join("\n")), { root: graph.root, count: results.length, snapshot: graph.snapshot });
    },
  });

  pi.registerTool({
    name: "codegraph_callers",
    label: "CodeGraph Callers",
    description: `Find what calls an indexed function/method/symbol. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Find CodeGraph call sites for a symbol",
    promptGuidelines: [
      "Use codegraph_callers before refactoring a named indexed symbol to find update sites and callback registrations.",
    ],
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol name to inspect." }),
      file: Type.Optional(Type.String({ description: "Optional file path/suffix to disambiguate the symbol." })),
      limit: Limit(10, 50),
      projectPath: ProjectPath,
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const graph = await ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 10, 50);
      const matches = searchMatches(graph.cg, params.symbol, { file: params.file, limit });
      if (matches.length === 0) return textResult(formatNoMatches(params.symbol, params.file), { root: graph.root, snapshot: graph.snapshot });

      const sections: string[] = [];
      for (const match of matches) {
        const callers = graph.cg.getCallers(match.node.id, 1).slice(0, limit);
        sections.push(`## Callers of ${nodeTitle(match.node)}`);
        sections.push(callers.length ? callers.map((ref) => formatReferenceLine(ref, "calls here")).join("\n") : "No callers found.");
        sections.push("");
      }
      return textResult(withWarningPrefix(graph, sections.join("\n").trimEnd()), { root: graph.root, definitions: matches.length, snapshot: graph.snapshot });
    },
  });

  pi.registerTool({
    name: "codegraph_callees",
    label: "CodeGraph Callees",
    description: `Find what an indexed function/method/symbol calls. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Find CodeGraph callees for a symbol",
    promptGuidelines: [
      "Use codegraph_callees when the user asks what an indexed symbol calls.",
    ],
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol name to inspect." }),
      file: Type.Optional(Type.String({ description: "Optional file path/suffix to disambiguate the symbol." })),
      limit: Limit(10, 50),
      projectPath: ProjectPath,
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const graph = await ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 10, 50);
      const matches = searchMatches(graph.cg, params.symbol, { file: params.file, limit });
      if (matches.length === 0) return textResult(formatNoMatches(params.symbol, params.file), { root: graph.root, snapshot: graph.snapshot });

      const sections: string[] = [];
      for (const match of matches) {
        const callees = graph.cg.getCallees(match.node.id, 1).slice(0, limit);
        sections.push(`## Callees of ${nodeTitle(match.node)}`);
        sections.push(callees.length ? callees.map((ref) => formatReferenceLine(ref, "called")).join("\n") : "No callees found.");
        sections.push("");
      }
      return textResult(withWarningPrefix(graph, sections.join("\n").trimEnd()), { root: graph.root, definitions: matches.length, snapshot: graph.snapshot });
    },
  });

  pi.registerTool({
    name: "codegraph_impact",
    label: "CodeGraph Impact",
    description: `Estimate the blast radius of changing an indexed symbol. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Estimate CodeGraph refactor impact for a symbol",
    promptGuidelines: [
      "Use codegraph_impact before broad refactors of indexed symbols to estimate blast radius.",
    ],
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol name to inspect." }),
      file: Type.Optional(Type.String({ description: "Optional file path/suffix to disambiguate the symbol." })),
      depth: Type.Optional(Type.Integer({ description: "Traversal depth for impact analysis (default 2, max 5).", minimum: 1, maximum: 5, default: 2 })),
      limit: Limit(60, 200),
      projectPath: ProjectPath,
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const graph = await ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });
      const limit = coerceLimit(params.limit, 60, 200);
      const depth = coerceLimit(params.depth, 2, 5);
      const matches = searchMatches(graph.cg, params.symbol, { file: params.file, limit: Math.min(10, limit) });
      if (matches.length === 0) return textResult(formatNoMatches(params.symbol, params.file), { root: graph.root, snapshot: graph.snapshot });

      const sections = matches.map((match) => formatSubgraphImpact(match.node, graph.cg.getImpactRadius(match.node.id, depth), limit));
      return textResult(withWarningPrefix(graph, sections.join("\n\n")), { root: graph.root, definitions: matches.length, depth, snapshot: graph.snapshot });
    },
  });

  pi.registerTool({
    name: "codegraph_node",
    label: "CodeGraph Node",
    description: `Read one indexed symbol's source/trail or one indexed source file with line numbers. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Read one indexed symbol or source file with CodeGraph",
    promptGuidelines: [
      "Use codegraph_node for one indexed symbol body or one indexed source file; prefer it over read for indexed source because it includes graph context.",
      "Use codegraph_node for exact source after codegraph_explore when one specific indexed symbol or file needs more detail.",
    ],
    parameters: Type.Object({
      symbol: Type.Optional(Type.String({ description: "Symbol name to inspect. Provide either symbol or file." })),
      file: Type.Optional(Type.String({ description: "Indexed file path/suffix to read. Provide either symbol or file." })),
      includeCode: Type.Optional(Type.Boolean({ description: "Include source code for symbol mode.", default: true })),
      offset: Type.Optional(Type.Integer({ description: "1-indexed starting line for file mode.", minimum: 1 })),
      limit: Type.Optional(Type.Integer({ description: "Maximum lines/results to return.", minimum: 1 })),
      symbolsOnly: Type.Optional(Type.Boolean({ description: "In file mode, return indexed symbols instead of source.", default: false })),
      projectPath: ProjectPath,
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const graph = await ensureReady(params.projectPath, ctx, onUpdate, signal);
      if (graph.ok === false) return textResult(graph.message, { snapshot: graph.snapshot });

      if (params.file) {
        const matches = findIndexedFiles(graph.cg, params.file);
        if (matches.length === 0) {
          return textResult(`No indexed file matches ${JSON.stringify(params.file)}. Use raw read for docs/configs/unindexed files, or codegraph_status if the index may be stale.`, { root: graph.root, snapshot: graph.snapshot });
        }
        if (matches.length > 1) {
          return textResult(formatFileChoices(matches, params.file), { root: graph.root, matches: matches.length, snapshot: graph.snapshot });
        }
        const file = matches[0]!;
        const nodes = graph.cg.getNodesInFile(file.path);
        const dependents = graph.cg.getFileDependents(file.path).slice(0, 20);
        const header = [`# ${file.path}`, ``, `- language: ${file.language}`, `- indexed symbols: ${nodes.length}`, `- dependents: ${dependents.length}${dependents.length ? ` (${dependents.join(", ")}${graph.cg.getFileDependents(file.path).length > dependents.length ? ", ..." : ""})` : ""}`, ""];

        if (params.symbolsOnly) {
          return textResult(withWarningPrefix(graph, header.join("\n") + formatSymbolOutline(nodes)), { root: graph.root, file: file.path, snapshot: graph.snapshot });
        }

        const absoluteFile = path.join(graph.root, file.path);
        if (!(await fileExists(absoluteFile))) {
          return textResult(`Indexed file is missing on disk: ${absoluteFile}. Run codegraph_status/sync or inspect deleted-file changes.`, { root: graph.root, file: file.path, snapshot: graph.snapshot });
        }
        const source = await readFile(absoluteFile, "utf8");
        const numbered = lineNumbered(source, params.offset, params.limit);
        const range = `(lines ${numbered.shownStart}-${numbered.shownEnd} of ${numbered.total})`;
        return textResult(withWarningPrefix(graph, `${header.join("\n")}## Source ${range}\n\n${numbered.text}`), { root: graph.root, file: file.path, range, snapshot: graph.snapshot });
      }

      if (!params.symbol) {
        throw new Error("codegraph_node requires either `symbol` or `file`.");
      }

      const definitionLimit = coerceLimit(params.limit, 5, 25);
      const matches = searchMatches(graph.cg, params.symbol, { limit: definitionLimit });
      if (matches.length === 0) return textResult(formatNoMatches(params.symbol), { root: graph.root, snapshot: graph.snapshot });

      const sections: string[] = [];
      for (const match of matches) {
        const node = match.node;
        sections.push(`## ${nodeTitle(node)}`);
        if (params.includeCode ?? true) {
          const code = await graph.cg.getCode(node.id);
          if (code) sections.push("", "```" + node.language, code, "```");
          else sections.push("", "_No source available for this symbol._");
        }
        const callers = graph.cg.getCallers(node.id, 1).slice(0, 8);
        const callees = graph.cg.getCallees(node.id, 1).slice(0, 8);
        sections.push("", "### Callers", callers.length ? callers.map((ref) => formatReferenceLine(ref, "calls here")).join("\n") : "No callers found.");
        sections.push("", "### Callees", callees.length ? callees.map((ref) => formatReferenceLine(ref, "called")).join("\n") : "No callees found.");
        sections.push("");
      }
      return textResult(withWarningPrefix(graph, sections.join("\n").trimEnd()), { root: graph.root, definitions: matches.length, snapshot: graph.snapshot });
    },
  });

  pi.registerTool({
    name: "codegraph_status",
    label: "CodeGraph Status",
    description: `Report CodeGraph index health, initialization, staleness, pending changes, and extension sync state. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: "Check CodeGraph index and sync health",
    promptGuidelines: [
      "Use codegraph_status when unsure whether an indexed project is initialized, stale, syncing, pending changes, or needs full reindex.",
    ],
    parameters: Type.Object({
      projectPath: ProjectPath,
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const explicitProjectPath = typeof params.projectPath === "string" && params.projectPath.trim() !== "";
      let snapshot = await buildStatusSnapshot(params.projectPath, ctx, { explicitProjectPath });
      let initMessage: string | undefined;

      if (!snapshot.initialized && snapshot.candidateRoot && !snapshot.unsafeReason) {
        const init = await initializeGraph(snapshot.candidateRoot, ctx, onUpdate, signal);
        initMessage = init.message;
        if (init.entry) {
          snapshot = await buildStatusSnapshot(init.entry.root, ctx, { explicitProjectPath: true });
        }
      }

      return textResult(formatStatus(snapshot, initMessage), { snapshot });
    },
  });
}

