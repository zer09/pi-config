import { constants, lstatSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { THINKING_LEVELS } from "./types.ts";

// Fixed private read limits. Blank and malformed physical records also spend the record budget.
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const MAX_SESSION_LINE_BYTES = 4 * 1024 * 1024;
const MAX_SESSION_RECORDS = 100_000;
type HistoryReadiness = "usable" | "assignment_absent" | "invalid";
export type HistoryFailureCategory = "file_integrity" | "size_limit" | "read_changed" | "record_shape" | "context_target" | "ancestry" | "unclassified";
type HistoryEntry = {
  parentId: string | null;
  assignment: boolean;
  editableRole?: string;
  children: string[];
  edit?: { targetId: string; assignment: boolean };
  compaction?: { firstKeptEntryId?: string };
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

const UNSUPPORTED_STRICT_SCHEMA_KEYS = [
  "$ref", "$defs", "definitions", "allOf", "oneOf", "patternProperties", "dependentSchemas", "dependencies",
  "unevaluatedProperties", "propertyNames", "contains", "prefixItems", "not", "if", "then", "else",
];

function strictRequiredSchema(parameters: Record<string, unknown>): boolean {
  if (parameters.type !== "object") return false;
  // Match Pi 0.87.1 makeStrictJsonSchema without a runtime import or mutation.
  // The session line limit bounds this iterative walk over parsed JSON.
  const pending: unknown[] = [parameters];
  while (pending.length > 0) {
    const schema = pending.pop();
    if (!record(schema) || UNSUPPORTED_STRICT_SCHEMA_KEYS.some((key) => schema[key] !== undefined)) return false;
    if (schema.anyOf !== undefined) {
      if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) return false;
      for (const variant of schema.anyOf) {
        if (record(variant)) {
          const types = Array.isArray(variant.type) ? variant.type : [variant.type];
          if (types.includes("object") || types.includes("array") || variant.properties !== undefined || variant.items !== undefined) return false;
        }
        pending.push(variant);
      }
    }
    // Tuple items and boolean schemas fail the same record check as other children.
    if (schema.items !== undefined) pending.push(schema.items);
    const isObjectSchema = schema.type === "object";
    if (schema.properties !== undefined && !isObjectSchema) return false;
    if (!isObjectSchema) continue;
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) return false;
    if (schema.properties !== undefined && !record(schema.properties)) return false;
    const properties = schema.properties ?? {};
    const propertyNames = new Set(Object.keys(properties));
    if (schema.required !== undefined && (!Array.isArray(schema.required)
      || schema.required.some((key) => typeof key !== "string" || !propertyNames.has(key)))) return false;
    // Pi adds nullability to optional properties, including objects and arrays, after validation.
    for (const property of Object.values(properties)) pending.push(property);
  }
  return true;
}

function tool(value: unknown): boolean {
  if (!record(value) || typeof value.name !== "string" || typeof value.description !== "string" || !record(value.parameters)) return false;
  const config = value.constrainedSampling;
  if (config === undefined || config === false) return true;
  if (!record(config)) return false;
  // Reject constraints that would prevent Pi from preparing a resumed request.
  if (config.type === "json_schema") {
    if (config.strict === "prefer") return true;
    if (config.strict !== "require") return false;
    return strictRequiredSchema(value.parameters);
  }
  if (config.type !== "grammar" || !record(config.variants)
    || !Object.entries(config.variants).every(([format, grammar]) => ["openai_lark", "openai_regex"].includes(format) && typeof grammar === "string")
    || !Object.values(config.variants).some((grammar) => typeof grammar === "string" && grammar.trim().length > 0)) return false;
  const parameters = value.parameters;
  if (parameters.type !== "object" || !Array.isArray(parameters.required) || parameters.required.length !== 1
    || typeof parameters.required[0] !== "string" || !record(parameters.properties)) return false;
  const property = parameters.properties[parameters.required[0]];
  return record(property) && property.type === "string";
}

function message(value: unknown): value is Record<string, unknown> {
  if (!record(value) || !count(value.timestamp)) return false;
  switch (value.role) {
    case "system": return (typeof value.content === "string" || (Array.isArray(value.content)
      && value.content.every((block) => record(block) && block.type === "text" && typeof block.text === "string"
        && (block.textSignature === undefined || typeof block.textSignature === "string"))))
      && (value.sections === undefined || (record(value.sections)
        && Object.values(value.sections).every((section) => section === null || typeof section === "string")))
      && (value.toolsAdded === undefined || (Array.isArray(value.toolsAdded) && value.toolsAdded.every(tool)))
      && (value.toolsRemoved === undefined || (Array.isArray(value.toolsRemoved)
        && value.toolsRemoved.every((reference) => record(reference) && typeof reference.name === "string")));
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

function usage(value: unknown): boolean {
  if (!record(value) || !record(value.cost)) return false;
  return [value.input, value.output, value.cacheRead, value.cacheWrite, value.totalTokens,
    value.cost.input, value.cost.output, value.cost.cacheRead, value.cost.cacheWrite, value.cost.total].every(count)
    && (value.cacheWrite1h === undefined || count(value.cacheWrite1h))
    && (value.reasoning === undefined || count(value.reasoning));
}

function entryPayload(entry: Record<string, unknown>): boolean {
  switch (entry.type) {
    case "message": return message(entry.message);
    case "usage": return typeof entry.kind === "string" && typeof entry.provider === "string" && typeof entry.model === "string"
      && usage(entry.usage) && (entry.note === undefined || typeof entry.note === "string");
    case "model_change": return typeof entry.provider === "string" && typeof entry.modelId === "string";
    case "thinking_level_change": return (THINKING_LEVELS as readonly unknown[]).includes(entry.thinkingLevel);
    case "custom": return typeof entry.customType === "string";
    case "custom_message": return typeof entry.customType === "string" && content(entry.content) && typeof entry.display === "boolean";
    case "session_info": return typeof entry.name === "string";
    case "label": return identifier(entry.targetId) && (entry.label === undefined || typeof entry.label === "string");
    case "branch_summary": return identifier(entry.fromId) && typeof entry.summary === "string";
    case "context_edit": return identifier(entry.targetId) && (entry.replacement === null || record(entry.replacement));
    case "compaction": return typeof entry.summary === "string" && count(entry.tokensBefore)
      && (entry.firstKeptEntryId !== undefined || entry.retainedTail !== undefined)
      && (entry.firstKeptEntryId === undefined || identifier(entry.firstKeptEntryId))
      && (entry.retainedTail === undefined || (Array.isArray(entry.retainedTail) && entry.retainedTail.every(message)))
      && (entry.systemMessage === undefined || (message(entry.systemMessage) && entry.systemMessage.role === "system"));
    default: return false;
  }
}

/** Private runner/supervisor state. Never copy this object into telemetry. */
export interface PersistedPiSession {
  readonly args: readonly string[];
  readonly verifySpawn: () => void;
  /** Call only after positive group cleanup, never against a retained live process. Returns no private data. */
  readonly historyReadiness: (originalPrompt: string, restartPrompt: string) => Promise<HistoryReadiness>;
  /** Fixed public-safe category from the last readiness check; cleared when the next check starts. */
  readonly historyFailureCategory: HistoryFailureCategory | undefined;
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
    let historyFailureCategory: HistoryFailureCategory | undefined;
    const session: PersistedPiSession = {
      args: Object.freeze(["--session-dir", directory, "--session", file]),
      assignmentAccepted: false,
      get historyFailureCategory() { return historyFailureCategory; },
      async historyReadiness(originalPrompt, restartPrompt) {
        historyFailureCategory = undefined;
        const invalid = (category: HistoryFailureCategory): "invalid" => {
          historyFailureCategory = category;
          return "invalid";
        };
        try {
          let bytes: Buffer;
          try {
            this.verifySpawn();
            const before = lstatSync(file);
            if (before.size > MAX_SESSION_BYTES) return invalid("size_limit");
            const reader = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
              const opened = await reader.stat();
              if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return invalid("read_changed");
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
                || after.ctimeMs !== before.ctimeMs || current.dev !== before.dev || current.ino !== before.ino) return invalid("read_changed");
              bytes = bytes.subarray(0, size);
            } finally {
              await reader.close();
            }
          } catch {
            return invalid("file_integrity");
          }

          const tree = new Map<string, HistoryEntry>();
          const roots: string[] = [];
          let leaf: string | null = null;
          let headerSeen = false;
          let records = 0;
          for (let start = 0; start < bytes.length;) {
            const newline = bytes.indexOf(10, start);
            const end = newline < 0 ? bytes.length : newline;
            if (++records > MAX_SESSION_RECORDS || end - start > MAX_SESSION_LINE_BYTES) return invalid("size_limit");
            const line = bytes.toString("utf8", start, end);
            start = end + 1;
            if (!line.trim()) continue;
            let entry: unknown;
            try { entry = JSON.parse(line); } catch { continue; } // Pi skips malformed records, including a torn tail.
            if (!record(entry)) return invalid("record_shape");
            if (!headerSeen) {
              if (entry.type !== "session" || entry.version !== 3 || !identifier(entry.id) || !timestamp(entry.timestamp)
                || typeof entry.cwd !== "string" || !path.isAbsolute(entry.cwd) || entry.cwd.includes("\0")
                || (entry.parentSession !== undefined && typeof entry.parentSession !== "string")) return invalid("record_shape");
              const identity = JSON.stringify([entry.version, entry.id, entry.timestamp, entry.cwd, entry.parentSession]);
              if (pinnedHeader !== undefined && pinnedHeader !== identity) return invalid("file_integrity");
              pinnedHeader = identity;
              headerSeen = true;
              continue;
            }
            if (!identifier(entry.id) || !timestamp(entry.timestamp) || !entryPayload(entry)) return invalid("record_shape");
            // Parents must already exist. This rejects orphans, cycles, and duplicate IDs on any branch.
            if (tree.has(entry.id) || (entry.parentId !== null && (!identifier(entry.parentId) || !tree.has(entry.parentId)))) return invalid("ancestry");
            const node: HistoryEntry = {
              parentId: entry.parentId as string | null,
              assignment: entry.type === "message" && isAssignmentMessage(entry.message, originalPrompt, restartPrompt),
              children: [],
            };
            if (entry.type === "custom_message") node.editableRole = "custom";
            else if (entry.type === "message" && record(entry.message) && typeof entry.message.role === "string"
              && ["user", "assistant", "toolResult"].includes(entry.message.role)) node.editableRole = entry.message.role;
            if (entry.type === "context_edit") {
              const target = tree.get(entry.targetId as string);
              if (target?.editableRole === undefined) return invalid("context_target");
              const replacement = entry.replacement;
              if (replacement !== null && (!record(replacement)
                || !(typeof replacement.content === "string" || content(replacement.content, target.editableRole === "assistant")))) return invalid("record_shape");
              node.edit = { targetId: entry.targetId as string,
                assignment: replacement !== null && isAssignmentMessage({ role: target.editableRole, content: replacement.content }, originalPrompt, restartPrompt) };
            }
            if (entry.type === "compaction") node.compaction = { firstKeptEntryId: entry.firstKeptEntryId as string | undefined };
            if (node.parentId === null) roots.push(entry.id);
            else tree.get(node.parentId)!.children.push(entry.id);
            tree.set(entry.id, node);
            leaf = entry.id;
          }
          if (!headerSeen) return invalid("record_shape");
          // Walk every branch once, including abandoned branches. Targets must be ancestors
          // of their own records, not merely IDs that occur somewhere in the file.
          const ancestors = new Set<string>();
          const pending = roots.map((id) => ({ id, exit: false }));
          while (pending.length > 0) {
            const { id, exit } = pending.pop()!;
            if (exit) { ancestors.delete(id); continue; }
            const node = tree.get(id)!;
            if (node.edit && !ancestors.has(node.edit.targetId)) return invalid("ancestry");
            const boundary = node.compaction?.firstKeptEntryId;
            if (boundary !== undefined && boundary !== id && !ancestors.has(boundary)) return invalid("ancestry");
            ancestors.add(id);
            pending.push({ id, exit: true });
            for (const child of node.children) pending.push({ id: child, exit: false });
          }
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
            // Pi 0.87.1 ignores legacy retainedTail. A self boundary retains none.
            contextStart = compactionIndex + 1;
            if (compaction.firstKeptEntryId !== undefined && compaction.firstKeptEntryId !== activePath[compactionIndex]) {
              contextStart = activePath.indexOf(compaction.firstKeptEntryId);
            }
          }
          const selected = activePath.slice(contextStart);
          const edits = new Map<string, boolean>();
          for (const id of selected) {
            const edit = tree.get(id)!.edit;
            if (edit) edits.set(edit.targetId, edit.assignment);
          }
          // Only user entries can carry assignment identity. System checkpoints and
          // retained administrative entries cannot create it, even with matching text.
          return selected.some((id) => edits.get(id) ?? tree.get(id)!.assignment) ? "usable" : "assignment_absent";
        } catch {
          // No filesystem, JSON, path, identity, or history detail crosses this boundary.
          return invalid("unclassified");
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
