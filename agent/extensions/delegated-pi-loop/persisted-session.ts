import { constants, lstatSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { THINKING_LEVELS } from "./types.ts";

// Fixed private read limits. Blank and malformed physical records also spend the record budget.
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const MAX_SESSION_LINE_BYTES = 4 * 1024 * 1024;
const MAX_SESSION_RECORDS = 100_000;
type HistoryReadiness = "usable" | "assignment_absent" | "invalid";
type HistoryEntry = {
  parentId: string | null;
  assignment: boolean;
  compaction?: { firstKeptEntryId?: string; retainedAssignment?: boolean };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function timestamp(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function count(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function content(value: unknown, assistant = false): boolean {
  if (typeof value === "string") return !assistant;
  return Array.isArray(value) && value.every((block) => {
    if (!record(block)) return false;
    if (block.type === "text") return typeof block.text === "string";
    if (block.type === "image") return !assistant && typeof block.data === "string" && typeof block.mimeType === "string";
    if (block.type === "thinking") return assistant && typeof block.thinking === "string";
    return assistant && block.type === "toolCall" && typeof block.id === "string"
      && typeof block.name === "string" && record(block.arguments);
  });
}

function message(value: unknown): value is Record<string, unknown> {
  if (!record(value) || !count(value.timestamp)) return false;
  switch (value.role) {
    case "user": return content(value.content);
    case "assistant": return content(value.content, true) && typeof value.provider === "string"
      && typeof value.model === "string" && typeof value.stopReason === "string"
      && ["stop", "length", "toolUse", "error", "aborted", "deferred"].includes(value.stopReason);
    case "toolResult": return content(value.content) && typeof value.toolCallId === "string"
      && typeof value.toolName === "string" && typeof value.isError === "boolean";
    case "custom": return content(value.content) && typeof value.customType === "string" && typeof value.display === "boolean";
    case "bashExecution": return typeof value.command === "string" && typeof value.output === "string"
      && typeof value.cancelled === "boolean" && typeof value.truncated === "boolean";
    case "branchSummary": return typeof value.summary === "string" && (value.fromId === null || typeof value.fromId === "string");
    case "compactionSummary": return typeof value.summary === "string" && count(value.tokensBefore);
    default: return false;
  }
}

function isAssignmentMessage(value: unknown, originalPrompt: string, restartPrompt: string): boolean {
  if (!record(value) || value.role !== "user") return false;
  let text: string;
  if (typeof value.content === "string") text = value.content;
  else if (Array.isArray(value.content) && value.content.every((block) => record(block) && block.type === "text" && typeof block.text === "string")) {
    text = value.content.map((block) => block.text).join("");
  } else return false; // Dropping images or other blocks would change assignment identity.
  return text === originalPrompt || text === restartPrompt;
}

function entryPayload(entry: Record<string, unknown>): boolean {
  switch (entry.type) {
    case "message": return message(entry.message);
    case "model_change": return typeof entry.provider === "string" && typeof entry.modelId === "string";
    case "thinking_level_change": return (THINKING_LEVELS as readonly unknown[]).includes(entry.thinkingLevel);
    case "custom": return typeof entry.customType === "string";
    case "custom_message": return typeof entry.customType === "string" && content(entry.content) && typeof entry.display === "boolean";
    case "session_info": return typeof entry.name === "string";
    case "label": return identifier(entry.targetId) && (entry.label === undefined || typeof entry.label === "string");
    case "branch_summary": return identifier(entry.fromId) && typeof entry.summary === "string";
    case "compaction": return typeof entry.summary === "string" && count(entry.tokensBefore)
      && (entry.retainedTail === undefined ? identifier(entry.firstKeptEntryId)
        : Array.isArray(entry.retainedTail) && entry.retainedTail.every(message));
    default: return false;
  }
}

/** Private runner/supervisor state. Never copy this object into telemetry. */
export interface PersistedPiSession {
  readonly args: readonly string[];
  readonly verifySpawn: () => void;
  /** Call only after positive group cleanup, never against a retained live process. Returns no private data. */
  readonly historyReadiness: (originalPrompt: string, restartPrompt: string) => Promise<HistoryReadiness>;
  assignmentAccepted: boolean;
}

export async function createPersistedPiSession(artifactDir: string): Promise<PersistedPiSession> {
  try {
    const directory = realpathSync(artifactDir);
    const owner = lstatSync(artifactDir);
    if (!owner.isDirectory() || owner.isSymbolicLink() || (owner.mode & 0o7777) !== 0o700) throw new Error();
    const file = path.join(directory, "session.jsonl");
    // An existing empty file makes Pi flush its header immediately, so accepted
    // user work can persist even if no assistant response ever finishes.
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
    let pinnedHeader: string | undefined;
    const session: PersistedPiSession = {
      args: Object.freeze(["--session-dir", directory, "--session", file]),
      assignmentAccepted: false,
      async historyReadiness(originalPrompt, restartPrompt) {
        try {
          this.verifySpawn();
          const before = lstatSync(file);
          if (before.size > MAX_SESSION_BYTES) return "invalid";
          const reader = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          let bytes: Buffer;
          try {
            const opened = await reader.stat();
            if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return "invalid";
            // The extra byte detects growth without an unbounded readFile allocation.
            bytes = Buffer.alloc(before.size + 1);
            let size = 0;
            while (size < bytes.length) {
              const next = await reader.read(bytes, size, bytes.length - size, size);
              if (next.bytesRead === 0) break;
              size += next.bytesRead;
            }
            const after = await reader.stat();
            this.verifySpawn();
            const current = lstatSync(file);
            if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
              || after.ctimeMs !== before.ctimeMs || current.dev !== before.dev || current.ino !== before.ino) return "invalid";
            bytes = bytes.subarray(0, size);
          } finally {
            await reader.close();
          }

          const tree = new Map<string, HistoryEntry>();
          let leaf: string | null = null;
          let headerSeen = false;
          let records = 0;
          for (let start = 0; start < bytes.length;) {
            const newline = bytes.indexOf(10, start);
            const end = newline < 0 ? bytes.length : newline;
            if (++records > MAX_SESSION_RECORDS || end - start > MAX_SESSION_LINE_BYTES) return "invalid";
            const line = bytes.toString("utf8", start, end);
            start = end + 1;
            if (!line.trim()) continue;
            let entry: unknown;
            try { entry = JSON.parse(line); } catch { continue; } // Pi skips malformed records, including a torn tail.
            if (!record(entry)) return "invalid";
            if (!headerSeen) {
              if (entry.type !== "session" || entry.version !== 3 || !identifier(entry.id) || !timestamp(entry.timestamp)
                || typeof entry.cwd !== "string" || !path.isAbsolute(entry.cwd) || entry.cwd.includes("\0")
                || (entry.parentSession !== undefined && typeof entry.parentSession !== "string")) return "invalid";
              const identity = JSON.stringify([entry.version, entry.id, entry.timestamp, entry.cwd, entry.parentSession]);
              if (pinnedHeader !== undefined && pinnedHeader !== identity) return "invalid";
              pinnedHeader = identity;
              headerSeen = true;
              continue;
            }
            // Parents must already exist. This rejects orphans, cycles, duplicate IDs, and extra headers on any branch.
            if (!identifier(entry.id) || tree.has(entry.id) || !timestamp(entry.timestamp) || !entryPayload(entry)
              || (entry.parentId !== null && (!identifier(entry.parentId) || !tree.has(entry.parentId)))) return "invalid";
            const node: HistoryEntry = {
              parentId: entry.parentId as string | null,
              assignment: entry.type === "message" && isAssignmentMessage(entry.message, originalPrompt, restartPrompt),
            };
            if (entry.type === "compaction") {
              if (Array.isArray(entry.retainedTail)) {
                node.compaction = { retainedAssignment: entry.retainedTail.some((value) => isAssignmentMessage(value, originalPrompt, restartPrompt)) };
              } else node.compaction = { firstKeptEntryId: entry.firstKeptEntryId as string };
            }
            tree.set(entry.id, node);
            leaf = entry.id;
          }
          if (!headerSeen) return "invalid";
          // Pi restores the last tree entry as its leaf, not the last assignment anywhere in the file.
          const activePath: string[] = [];
          while (leaf !== null) {
            activePath.push(leaf);
            leaf = tree.get(leaf)!.parentId;
          }
          activePath.reverse();
          const compactionIndex = activePath.findLastIndex((id) => tree.get(id)!.compaction !== undefined);
          let contextStart = 0;
          if (compactionIndex >= 0) {
            const compaction = tree.get(activePath[compactionIndex]!)!.compaction!;
            if (compaction.retainedAssignment) return "usable";
            // A materialized tail replaces raw ancestry. An unresolved legacy boundary keeps none of it.
            contextStart = compactionIndex + 1;
            if (compaction.firstKeptEntryId !== undefined) {
              const boundary = activePath.indexOf(compaction.firstKeptEntryId);
              if (boundary >= 0 && boundary < compactionIndex) contextStart = boundary;
            }
          }
          return activePath.slice(contextStart).some((id) => tree.get(id)!.assignment) ? "usable" : "assignment_absent";
        } catch {
          // No filesystem, JSON, path, identity, or history detail crosses this boundary.
          return "invalid";
        }
      },
      verifySpawn() {
        try {
          const parent = lstatSync(artifactDir);
          const entry = lstatSync(file);
          if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o7777) !== 0o700
            || parent.dev !== owner.dev || parent.ino !== owner.ino || realpathSync(artifactDir) !== directory
            || path.dirname(file) !== directory || path.basename(file) !== "session.jsonl"
            || !entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o7777) !== 0o600 || entry.nlink !== 1) {
            throw new Error();
          }
        } catch {
          // Filesystem errors can contain the private path. Never propagate them.
          throw new Error("Delegated session validation failed");
        }
      },
    };
    return session;
  } catch {
    throw new Error("Delegated session initialization failed");
  }
}
