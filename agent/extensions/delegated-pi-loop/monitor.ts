import { createHmac, randomBytes } from "node:crypto";
import { classifyProviderFailure } from "./protocol.ts";
import {
  BLOCKED_REASON_CODES,
  DELEGATE_REASON_UNSPECIFIED,
  FAILED_REASON_CODES,
  type DelegateReasonCode,
  type DelegateReasonStatus,
  type DelegateTerminalReasonValue,
} from "./types.ts";
import type {
  DelegateState,
  MonitorSnapshot,
  ProviderFailureCategory,
} from "./types.ts";

const RESULT_LINE_PATTERN = /^DELEGATE_RESULT:\s*(COMPLETED|BLOCKED|FAILED)\s*$/gm;
const RESULT_PATTERN = /(?:^|\n)DELEGATE_RESULT:\s*(COMPLETED|BLOCKED|FAILED)\s*$/;
const REASON_PREFIX = "DELEGATE_REASON:";
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_REASON_VALUE_LENGTH = 64;
const BLOCKED_REASON_SET: ReadonlySet<string> = new Set(BLOCKED_REASON_CODES);
const FAILED_REASON_SET: ReadonlySet<string> = new Set(FAILED_REASON_CODES);
const MACHINE_ERROR_PREFIX = "[error]";

const CORE_ACTIVITY_EVENTS = new Set([
  "turn_start",
  "turn_end",
  "message_start",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

const SESSION_ACTIVITY_EVENTS = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "bash_execution_update",
  "queue_update",
]);

// `entry_appended` is deliberately absent from both activity sets: it is an
// undocumented RPC-only session-log record, never accepted task activity.
// Valid framed records still renew supervisor-level RPC health, but the
// monitor ignores the event entirely: no activity or structural clock,
// counter, phase, last-event, or detail mutation, and its payload content is
// never inspected or persisted.

interface ActiveTool {
  readonly key: string;
  readonly name: string;
  readonly startedMonotonic: number;
  readonly sequence: number;
  /** Bounded domain-separated digest of the normalized start arguments; the raw args value is never retained. */
  argsDigest: string | undefined;
  /** Most recent novel-update time; an identical accumulated update never moves it. */
  lastNovelUpdateMonotonic: number;
  /** Ephemeral digest of the last seen accumulated update, never serialized. */
  lastUpdateDigest: string | undefined;
}

/** Bounded number of recent checkpoint digests retained for novelty comparison. */
const MAX_CHECKPOINT_INDEX = 64;
/** UTF-8 byte cap on the HMAC input produced while traversing a digest input. */
const MAX_DIGEST_BYTES = 256 * 1024;
/** Node cap for one digest traversal: bounds work on wide adversarial payloads. */
const MAX_DIGEST_NODES = 20_000;
/** Depth cap for one digest traversal; deeper structure never renews anything. */
const MAX_DIGEST_DEPTH = 24;
/** Fixed cap on content items normalized by one message checkpoint; never above the digest node budget. */
const MAX_MESSAGE_CONTENT_ITEMS = MAX_DIGEST_NODES;
/** Fixed chunk size in code units for canonical string encoding inside a digest. */
export const DIGEST_STRING_CHUNK_UNITS = 4096;
/** Fixed cap on concurrently active tool executions inside one attempt. */
const MAX_ACTIVE_TOOLS = 64;
/** Key-namespace marker for a tool created without a tool-call id. */
const ANONYMOUS_TOOL_KEY_PREFIX = "anonymous:";
/** Fixed cap on distinct checkpoint digests retained by one turn or agent summary. */
const MAX_SUMMARY_DISTINCT_DIGESTS = 64;
/** Fixed label for any child-supplied tool name outside the live allowlist. */
const UNKNOWN_TOOL_NAME = "unknown";
/** Fixed allowlist of tool names delegated runtime children can execute: the Pi core read/bash/edit/write tools plus the tools of the runtime resource-policy extensions (web-search, context-mode, codegraph). Any other child string maps to `unknown`. */
const LIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read",
  "bash",
  "edit",
  "write",
  "web_search",
  "fetch_contents",
  "ctx_execute_file",
  "ctx_batch_execute",
  "ctx_search",
  "codegraph_explore",
  "codegraph_search",
  "codegraph_files",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_node",
  "codegraph_status",
]);
/** The three tool execution lifecycle event types; reporting-only in round 2. */
const TOOL_EXECUTION_EVENT_TYPES = new Set([
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

/** The three streamed tool-call selection event types; reporting-only in round 2. */
const TOOLCALL_STREAM_EVENT_TYPES = new Set([
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
]);

/** Result of one bounded digest computation. */
export type DigestResult = { readonly ok: true; readonly digest: string } | { readonly ok: false };

/**
 * Bounded key-order-independent HMAC over one value. The value is digested
 * by traversal: small canonical tokens are fed to the HMAC as they are
 * visited, with the total UTF-8 byte count, visited-node count, and depth
 * each capped during the traversal. The whole payload is never serialized
 * or allocated first, so an adversarial wide, deep, compact-numeric, or
 * near-protocol-limit input stops at the first exceeded limit and returns
 * `ok: false` instead of building a giant string to slice.
 */
export function boundedDigest(key: Buffer, value: unknown): DigestResult {
  let bytes = 0;
  let nodes = 0;
  const hmac = createHmac("sha256", key);
  const feed = (token: string): boolean => {
    // The budget is checked before feeding, so an oversized token is never
    // hashed at all: traversal stops the moment the byte cap would be crossed.
    const tokenBytes = Buffer.byteLength(token, "utf8");
    if (bytes + tokenBytes > MAX_DIGEST_BYTES) return false;
    bytes += tokenBytes;
    hmac.update(token, "utf8");
    return true;
  };
  // Strings are canonically encoded in fixed-size code-unit chunks, so a
  // near-protocol-limit string is never serialized as one allocation. The
  // chunk encoding is deterministic and injective for local equality
  // comparison: each chunk is escaped independently and framed by its own
  // JSON quotes, so chunk boundaries stay visible in the fed stream and
  // equal inputs always produce equal fed bytes. The encoding is
  // deliberately not claimed to be byte-identical to JSON.stringify of the
  // whole string.
  const feedString = (value: string): boolean => {
    if (!feed("s")) return false;
    let offset = 0;
    do {
      let end = offset + DIGEST_STRING_CHUNK_UNITS;
      // A surrogate pair split by the fixed boundary stays inside one
      // chunk; the chunk grows by at most one code unit, so the fixed
      // allocation bound holds.
      if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1))) end += 1;
      const encoded = JSON.stringify(value.slice(offset, end));
      if (!feed(encoded)) return false;
      offset = end;
    } while (offset < value.length);
    return feed(",");
  };
  const visit = (item: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_DIGEST_NODES || depth > MAX_DIGEST_DEPTH) return false;
    if (item === null) return feed("null");
    switch (typeof item) {
      case "undefined": return feed("u");
      case "string": return feedString(item);
      case "number": return feed(Number.isFinite(item) ? `n${item},` : "n?,");
      case "boolean": return feed(item ? "b1," : "b0,");
      case "bigint": return feed(`i${item.toString()},`);
      case "object": break;
      default: return feed("x,");
    }
    if (Array.isArray(item)) {
      if (!feed(`a${item.length}:`)) return false;
      for (const entry of item) {
        if (!visit(entry, depth + 1)) return false;
        if (!feed(",")) return false;
      }
      return true;
    }
    const record = item as Record<string, unknown>;
    // Own enumerable keys are counted and collected only up to the remaining
    // node budget; a wider object fails closed here, before any sort, so an
    // adversarial wide object never pays full-key materialization or sort
    // work. `for...in` plus the own-property check enumerates without ever
    // allocating the full key array; only the bounded collected set is sorted.
    const keyBudget = MAX_DIGEST_NODES - nodes;
    const keys: string[] = [];
    for (const candidate in record) {
      if (!Object.hasOwn(record, candidate)) continue;
      if (keys.length >= keyBudget) return false;
      keys.push(candidate);
    }
    keys.sort();
    if (!feed(`o${keys.length}:`)) return false;
    for (const entryKey of keys) {
      // Object keys never interpolate JSON.stringify(key) as one complete
      // token: a key domain marker, then the same fixed-size bounded string
      // encoder as every other string, then a terminator.
      if (!feed("k")) return false;
      if (!feedString(entryKey)) return false;
      if (!feed(":")) return false;
      if (!visit(record[entryKey], depth + 1)) return false;
      if (!feed(",")) return false;
    }
    return true;
  };
  return visit(value, 0) ? { ok: true, digest: hmac.digest("hex") } : { ok: false };
}

/** Outcome of one bounded checkpoint novelty comparison. */
type NoveltyOutcome =
  | { readonly status: "novel"; readonly digest: string }
  | { readonly status: "duplicate"; readonly digest: string }
  | { readonly status: "unavailable" };

/**
 * Ephemeral per-attempt checkpoint novelty index. Digests exist only in
 * memory under one random per-attempt HMAC key; neither the key nor any
 * digest ever leaves this class, and the index plus key are dropped when
 * the attempt ends. A digest computation failure or over-budget traversal
 * counts as no novelty credit instead of an error, and never pollutes the
 * bounded index.
 */
class CheckpointNovelty {
  private key: Buffer | undefined = randomBytes(32);
  private readonly recent: string[] = [];
  private readonly seen = new Set<string>();

  check(input: unknown): NoveltyOutcome {
    if (this.key === undefined) return { status: "unavailable" };
    let digest: string;
    try {
      const result = boundedDigest(this.key, input);
      if (!result.ok) return { status: "unavailable" };
      digest = result.digest;
    } catch {
      return { status: "unavailable" };
    }
    if (this.seen.has(digest)) return { status: "duplicate", digest };
    this.seen.add(digest);
    this.recent.push(digest);
    if (this.recent.length > MAX_CHECKPOINT_INDEX) {
      const evicted = this.recent.shift();
      if (evicted !== undefined) this.seen.delete(evicted);
    }
    return { status: "novel", digest };
  }

  /** Drops the key and every retained digest; later checks earn no credit. */
  clear(): void {
    this.key = undefined;
    this.recent.length = 0;
    this.seen.clear();
  }
}

/**
 * Per-turn and per-agent bounded structural summaries used as digest inputs.
 * The identity accumulator keeps at most `MAX_SUMMARY_DISTINCT_DIGESTS`
 * distinct checkpoint digests: repeated copies of a present digest never
 * change the summary, and a distinct digest beyond the cap is never
 * admitted, so the summary saturates and later identities cannot keep
 * mutating the enclosing turn or agent checkpoint.
 */
interface StructuralSummary {
  /** Distinct checkpoint digests admitted so far; bounded by the fixed cap. */
  readonly distinct: Set<string>;
  /** Last admitted distinct digest; frozen once the cap is reached. */
  lastDigest: string | undefined;
}

function emptySummary(): StructuralSummary {
  return { distinct: new Set(), lastDigest: undefined };
}

/**
 * Normalizes one assistant content item to its semantic identity: text,
 * thinking, or tool name plus arguments. Volatile tool-call ids and opaque
 * signatures are excluded; unknown item types keep only their type marker.
 */
function semanticContentItem(item: unknown): unknown {
  if (!isRecord(item)) return typeof item;
  const type = item.type;
  if (type === "text" && typeof item.text === "string") return { type, text: item.text };
  if (type === "thinking" && typeof item.thinking === "string") return { type, thinking: item.thinking };
  if (type === "tool_call") return { type, toolName: item.toolName, arguments: item.arguments };
  return { type };
}

/**
 * Semantic identity of one authoritative assistant message: role, stop
 * reason, and normalized content only. Timestamp, response id, usage,
 * provider/api/model metadata, opaque signatures, and volatile tool-call
 * ids are excluded, so a retransmitted identical message stays a duplicate
 * while any semantic text, thinking, tool, or stop-reason change is novel.
 * Content wider than the fixed item cap returns `undefined`: the checkpoint
 * is unavailable, nothing is normalized, and no truncated prefix is
 * digested.
 */
function semanticAssistantMessage(message: Record<string, unknown>): unknown | undefined {
  const content = message.content;
  // The item cap is enforced before any mapping: an over-cap array is one
  // unavailable checkpoint, so the full normalization never runs.
  if (Array.isArray(content) && content.length > MAX_MESSAGE_CONTENT_ITEMS) return undefined;
  return {
    kind: "message_end",
    role: message.role,
    stopReason: message.stopReason,
    content: Array.isArray(content) ? content.map(semanticContentItem) : typeof content,
  };
}

const MESSAGE_ACTIVITY_EVENTS = new Set([
  "start",
  "text_start",
  "text_delta",
  "text_end",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "toolcall_start",
  "toolcall_delta",
  "toolcall_end",
  "done",
  "error",
]);

type Outcome = "completed" | "blocked" | "failed";
type ReportRound = 1 | 2;

/** Parsed terminal reason line: an accepted closed code, or why none was accepted. */
export type TerminalReason =
  | { readonly status: "accepted"; readonly code: DelegateReasonCode }
  | { readonly status: "rejected" }
  | { readonly status: "missing" };

/** Strictly parsed terminal structure of one final report. */
export interface DelegateTerminal {
  readonly outcome?: Outcome;
  readonly reason?: TerminalReason;
}

interface RoundState {
  promptAccepted: boolean;
  agentRunning: boolean;
  turnOpen: boolean;
  agentStartCount: number;
  agentEndCount: number;
  finalAgentEndSeen: boolean;
  settledSeen: boolean;
  finalReport?: string;
  outcome?: Outcome;
  reason?: TerminalReason;
  providerFailureCategory?: ProviderFailureCategory;
}

/**
 * Snapshot reason fields for one round. Only non-completed outcomes carry
 * a reason; an accepted code stays typed, anything else becomes the fixed
 * internal unspecified value with its missing or rejected status.
 */
function terminalReasonFields(state: RoundState): {
  readonly terminalReason?: DelegateTerminalReasonValue;
  readonly reasonStatus?: DelegateReasonStatus;
  readonly blockedMisuseSuspected?: boolean;
} {
  if (state.outcome !== "blocked" && state.outcome !== "failed") return {};
  const reason = state.reason;
  if (reason?.status === "accepted") {
    // The misuse flag comes from the outcome and the accepted code together,
    // never from the role alone; a FAILED outcome never sets it.
    return state.outcome === "blocked"
      ? {
        terminalReason: reason.code,
        reasonStatus: "accepted",
        blockedMisuseSuspected: reason.code === "finding_reported",
      }
      : { terminalReason: reason.code, reasonStatus: "accepted" };
  }
  return {
    terminalReason: DELEGATE_REASON_UNSPECIFIED,
    reasonStatus: reason === undefined ? "missing" : reason.status,
  };
}

function emptyRound(): RoundState {
  return {
    promptAccepted: false,
    agentRunning: false,
    turnOpen: false,
    agentStartCount: 0,
    agentEndCount: 0,
    finalAgentEndSeen: false,
    settledSeen: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for the leading half of one UTF-16 surrogate pair. */
function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

export function parseDelegateOutcome(report: string): Outcome | undefined {
  return parseDelegateTerminal(report).outcome;
}

/**
 * Strict terminal-structure parser for the DELEGATE_RESULT marker and the
 * DELEGATE_REASON line directly above it. Only exact fixed reason codes are
 * accepted; unknown, malformed, duplicate, misplaced, path-like,
 * credential-like, overlong, Unicode, or outcome-mismatched values are
 * discarded as rejected, and a report without any reason line stays legacy
 * missing. A reason line paired with COMPLETED violates the contract, so
 * the whole terminal structure is invalid and the outcome becomes
 * undefined, following the existing invalid-result recovery behavior. No
 * delegate-authored free text is ever retained.
 */
export function parseDelegateTerminal(report: string): DelegateTerminal {
  const markers = [...report.matchAll(RESULT_LINE_PATTERN)];
  if (markers.length !== 1) return {};
  const trimmed = report.trimEnd();
  const match = RESULT_PATTERN.exec(trimmed);
  if (!match) return {};
  const outcome = match[1]!.toLowerCase() as Outcome;
  const lines = trimmed.split(/\r?\n/);
  const candidate = lines.length >= 2 ? lines[lines.length - 2]!.trim() : undefined;
  const reasonLines = lines.filter((line) => line.trim().startsWith(REASON_PREFIX));
  if (outcome === "completed") {
    return reasonLines.length > 0 ? {} : { outcome };
  }
  if (reasonLines.length > 1) return { outcome, reason: { status: "rejected" } };
  if (candidate !== undefined && candidate.startsWith(REASON_PREFIX)) {
    const value = candidate.slice(REASON_PREFIX.length).trim();
    const allowed = outcome === "blocked" ? BLOCKED_REASON_SET : FAILED_REASON_SET;
    if (
      value.length >= 1
      && value.length <= MAX_REASON_VALUE_LENGTH
      && REASON_CODE_PATTERN.test(value)
      && allowed.has(value)
    ) {
      return { outcome, reason: { status: "accepted", code: value as DelegateReasonCode } };
    }
    return { outcome, reason: { status: "rejected" } };
  }
  // A reason line that is not directly above the marker is misplaced.
  return { outcome, reason: reasonLines.length === 1 ? { status: "rejected" } : { status: "missing" } };
}

export function routeUnavailableError(value: unknown): boolean {
  return classifyProviderFailure(value) !== undefined;
}

export function machineErrorEnvelope(report: string): boolean {
  const stripped = report.trim();
  if (stripped.includes("\n") || stripped.includes("\r")) return false;
  if (!stripped.startsWith(MACHINE_ERROR_PREFIX)) return false;
  return classifyProviderFailure(stripped.slice(MACHINE_ERROR_PREFIX.length).trimStart()) !== undefined;
}

function assistantText(message: unknown): string | undefined {
  if (!isRecord(message) || message.role !== "assistant") return undefined;
  if (message.stopReason !== "stop" && message.stopReason !== "length") return undefined;
  if (!Array.isArray(message.content)) return undefined;
  const text = message.content
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("");
  return text.trim() ? text : undefined;
}

function categoryFromRecord(record: Record<string, unknown>): ProviderFailureCategory | undefined {
  for (const key of ["errorMessage", "error", "finalError", "message"]) {
    const category = classifyProviderFailure(record[key]);
    if (category !== undefined) return category;
  }
  return undefined;
}

/** Monitors one accepted RPC child session containing at most two report rounds. */
export class PiRpcMonitor {
  private phaseValue = "starting";
  private lastEventValue = "process_start";
  private lastEventDetailValue: string | undefined;
  private lastEventAtValue: string;
  private lastValidRpcValue: number;
  private lastActivityValue: number;
  private lastStructuralProgressValue: number;
  private activityEventCountValue = 0;
  private structuralProgressCountValue = 0;
  private duplicateCheckpointCountValue = 0;
  private duplicateCheckpointsSinceNovelValue = 0;
  private activityWarningCountValue = 0;
  private progressWarningCountValue = 0;
  private toolExecutionCountValue = 0;
  private activeToolSequence = 0;
  private readonly activeTools = new Map<string, ActiveTool>();
  private lastQueueSignature: string | undefined;
  private reportRoundValue: ReportRound = 1;
  private readonly errorsValue: string[] = [];
  private readonly rounds: Record<ReportRound, RoundState> = { 1: emptyRound(), 2: emptyRound() };
  private readonly novelty = new CheckpointNovelty();
  private toolUpdateKey: Buffer | undefined = randomBytes(32);
  private toolArgsKey: Buffer | undefined = randomBytes(32);
  private turnSummary: StructuralSummary = emptySummary();
  private agentSummary: StructuralSummary = emptySummary();
  private readonly monotonicNow: () => number;
  private readonly wallNow: () => string;
  private readonly onActivity: (() => void) | undefined;

  constructor(
    startedMonotonic: number,
    startedAt: string,
    monotonicNow: () => number = () => performance.now(),
    wallNow: () => string = () => new Date().toISOString(),
    onActivity?: () => void,
  ) {
    this.lastValidRpcValue = startedMonotonic;
    this.lastActivityValue = startedMonotonic;
    this.lastStructuralProgressValue = startedMonotonic;
    this.lastEventAtValue = startedAt;
    this.monotonicNow = monotonicNow;
    this.wallNow = wallNow;
    this.onActivity = onActivity;
  }

  beginRecovery(): void {
    this.reportRoundValue = 2;
    this.phaseValue = "recovering_report";
    // Round 2 starts a distinct bounded reporting phase: the RPC and
    // accepted-activity clocks restart so the recovery idle lease measures
    // only round-2 communication. Output bytes, retry counters, duplicate
    // checkpoint counters, and tool counts stay cumulative by contract.
    const now = this.monotonicNow();
    this.lastValidRpcValue = now;
    this.lastActivityValue = now;
  }

  /** Records one accepted protocol record for RPC health only. */
  recordValidRpc(): void {
    this.lastValidRpcValue = this.monotonicNow();
  }

  acceptPrompt(round: ReportRound): void {
    const state = this.rounds[round];
    if (state.promptAccepted) {
      this.addError("duplicate_prompt_acceptance");
      return;
    }
    if (round === 2) {
      const firstState = this.classifyRound(1);
      if (firstState !== "missing_report" && firstState !== "invalid_result") {
        this.addError("recovery_prompt_before_eligible_settlement");
        return;
      }
    }
    state.promptAccepted = true;
    this.reportRoundValue = round;
    this.recordActivity(`prompt-${round}_accepted`, round === 2 ? "recovering_report" : "provider");
    // Prompt acceptance is a structural checkpoint: the initial assignment
    // and the recovery round each renew the progress lease unconditionally.
    this.renewStructuralProgress();
  }

  recordUiActivity(_method: string): void {
    // UI requests show no work progress. They remain protocol-valid but do not
    // reset the idle watchdog or replace the last meaningful activity.
  }

  addProtocolError(category: string): void {
    this.addError(`rpc_${category.slice(0, 80)}`);
  }

  consumeEvent(round: ReportRound, event: Record<string, unknown>): void {
    const state = this.rounds[round];
    if (!state.promptAccepted) {
      this.addError("event_before_prompt_acceptance");
      return;
    }
    if (round !== this.reportRoundValue) {
      this.addError("event_for_inactive_round");
      return;
    }

    const eventType = event.type;
    if (typeof eventType !== "string") {
      this.addError("event_type_missing");
      return;
    }
    if (eventType === "session") {
      this.addError("json_session_event_in_rpc_stream");
      return;
    }

    // The recovery round is reporting-only. Any tool execution lifecycle
    // event there is one fixed stream error before any tool count, active
    // state, activity clock, structural clock, or progress mutation, so the
    // attempt becomes invalid_stream while the cumulative round-1 tool
    // count stays preserved.
    if (round === 2 && TOOL_EXECUTION_EVENT_TYPES.has(eventType)) {
      this.addError("tool_execution_in_recovery_round");
      return;
    }

    if (eventType === "agent_start") {
      if (state.agentRunning || state.finalAgentEndSeen || state.settledSeen) {
        this.addError("invalid_agent_start_lifecycle");
        return;
      }
      state.agentRunning = true;
      state.agentStartCount += 1;
      this.agentSummary = emptySummary();
    } else if (eventType === "agent_end") {
      if (!state.agentRunning) {
        this.addError("invalid_agent_end_lifecycle");
        return;
      }
      if (state.turnOpen) {
        // An open turn at agent end is a broken upstream sequence: it earns
        // no activity or progress credit before the round becomes invalid.
        this.addError("agent_end_with_open_turn");
        return;
      }
      state.agentRunning = false;
      state.agentEndCount += 1;
      state.finalAgentEndSeen = event.willRetry !== true;
      this.recordAgentCheckpoint(event);
    } else if (eventType === "agent_settled") {
      if (!state.finalAgentEndSeen || state.agentRunning || state.settledSeen) {
        this.addError("agent_settled_before_final_agent_end");
        return;
      }
      state.settledSeen = true;
      // Final settlement is always novel: the lifecycle validator already
      // rejects a second settled event in the same round.
      this.structuralCheckpoint();
    } else if (CORE_ACTIVITY_EVENTS.has(eventType) && !state.agentRunning) {
      this.addError(`${eventType.slice(0, 60)}_outside_agent_lifecycle`);
      return;
    } else if (eventType === "turn_start") {
      if (state.turnOpen) {
        // A nested turn start is a broken upstream sequence: it earns no
        // activity or progress credit before the round becomes invalid.
        this.addError("nested_turn_start");
        return;
      }
      state.turnOpen = true;
      // The turn summary is initialized only here, on the accepted turn
      // start, and is consumed exactly once by the matching turn end.
      this.turnSummary = emptySummary();
    }

    if (eventType === "message_update") {
      if (!state.agentRunning) {
        this.addError("message_update_outside_agent_lifecycle");
        return;
      }
      const update = event.assistantMessageEvent;
      if (!isRecord(update)) {
        this.addError("message_update_missing_event");
        return;
      }
      const updateType = update.type;
      if (typeof updateType !== "string" || !MESSAGE_ACTIVITY_EVENTS.has(updateType)) return;
      // The recovery round is reporting-only: streamed tool-call selection
      // is one fixed stream error before delta filtering, phase mutation, or
      // any activity renewal, so an empty toolcall delta is rejected too.
      if (round === 2 && TOOLCALL_STREAM_EVENT_TYPES.has(updateType)) {
        this.addError("tool_execution_in_recovery_round");
        return;
      }
      if (updateType === "error") this.recordProviderFailure(state, categoryFromRecord(update) ?? "provider_unavailable");
      if (updateType.endsWith("_delta") && (typeof update.delta !== "string" || update.delta.length === 0)) return;
      let phase = updateType.startsWith("thinking_") ? "thinking" : "responding";
      if (updateType.startsWith("toolcall_")) phase = "tool_selection";
      this.recordActivity(updateType, phase);
      return;
    }

    if (!CORE_ACTIVITY_EVENTS.has(eventType) && !SESSION_ACTIVITY_EVENTS.has(eventType)) return;
    if (eventType === "bash_execution_update" && (typeof event.delta !== "string" || event.delta.length === 0)) return;
    if (eventType === "queue_update") {
      const steeringCount = Array.isArray(event.steering) ? event.steering.length : 0;
      const followUpCount = Array.isArray(event.followUp) ? event.followUp.length : 0;
      const signature = `${steeringCount}:${followUpCount}`;
      if (signature === this.lastQueueSignature) return;
      this.lastQueueSignature = signature;
    }
    if (eventType === "tool_execution_start") {
      if (!this.startTool(event)) return;
    } else if (eventType === "tool_execution_update") {
      if (!this.updateTool(event)) return;
    } else if (eventType === "tool_execution_end") {
      if (!this.endTool(event)) return;
    }
    if (eventType === "turn_end") {
      if (!state.turnOpen) {
        // An unmatched turn end is a broken upstream sequence, even when its
        // payload carries upstream provider-failure evidence: the invalid
        // stream classification takes precedence and nothing renews.
        this.addError("turn_end_without_open_turn");
        return;
      }
      state.turnOpen = false;
      this.recordTurnCheckpoint();
    }
    if (eventType === "auto_retry_start") {
      const category = categoryFromRecord(event);
      if (category !== undefined) this.recordProviderFailure(state, category);
    } else if (eventType === "auto_retry_end" && event.success === false) {
      this.recordProviderFailure(state, categoryFromRecord(event) ?? "provider_unavailable");
    } else if (eventType === "compaction_end" && event.aborted === false && event.result === null) {
      const category = categoryFromRecord(event);
      if (category !== undefined) this.recordProviderFailure(state, category);
    }

    let phase = this.phaseValue;
    if (eventType === "agent_start" || eventType === "turn_start" || eventType === "message_start") phase = "provider";
    else if (eventType.startsWith("tool_execution_") || eventType === "bash_execution_update") phase = "tool";
    else if (eventType === "turn_end" || eventType === "message_end") phase = "turn_complete";
    else if (eventType === "auto_retry_start" || eventType === "auto_retry_end") phase = "retry";
    else if (eventType.startsWith("compaction_") || eventType.startsWith("summarization_retry_")) phase = "compaction";
    else if (eventType === "agent_end" || eventType === "agent_settled") phase = "complete";

    // Live tool names on the activity surface are the ingress-mapped
    // allowlist names only; the raw child string is never stored or shown.
    const detail = eventType.startsWith("tool_execution_") ? this.toolName(event) : undefined;
    this.recordActivity(eventType, phase, detail);

    if (eventType === "message_end") {
      const message = event.message;
      if (!isRecord(message) || message.role !== "assistant") return;
      this.recordMessageCheckpoint(message);
      if (message.stopReason === "error") {
        this.recordProviderFailure(state, categoryFromRecord(message) ?? "provider_unavailable");
      }
      const report = assistantText(message);
      state.finalReport = report;
      const terminal = report === undefined ? undefined : parseDelegateTerminal(report);
      state.outcome = terminal?.outcome;
      state.reason = terminal?.reason;
      if (report !== undefined && state.outcome === undefined && machineErrorEnvelope(report)) {
        this.recordProviderFailure(
          state,
          classifyProviderFailure(report.slice(MACHINE_ERROR_PREFIX.length).trimStart()) ?? "provider_unavailable",
        );
      }
    }
  }

  classifyRound(round: ReportRound, processEnded = false): DelegateState | "running" {
    const state = this.rounds[round];
    if (this.errorsValue.length > 0) return "invalid_stream";
    if (state.outcome === "blocked") return "blocked";
    if (state.outcome === "failed") return "delegate_failed";
    if (state.outcome === "completed") {
      return state.finalAgentEndSeen && state.settledSeen ? "completed" : "running";
    }
    if (state.providerFailureCategory !== undefined && (state.settledSeen || processEnded)) return "provider_failed";
    if (!state.settledSeen) return "running";
    if (state.finalReport === undefined || !state.finalReport.trim()) return "missing_report";
    return "invalid_result";
  }

  finalReport(round: ReportRound = this.reportRoundValue): string | undefined {
    return this.rounds[round].finalReport;
  }

  outcome(round: ReportRound = this.reportRoundValue): Outcome | undefined {
    return this.rounds[round].outcome;
  }

  issueActivityWarning(): void {
    this.activityWarningCountValue += 1;
  }

  issueProgressWarning(): void {
    this.progressWarningCountValue += 1;
  }

  /** Drops the ephemeral HMAC keys and every retained digest for this attempt. */
  clearEphemeralState(): void {
    this.novelty.clear();
    this.toolUpdateKey = undefined;
    this.toolArgsKey = undefined;
    // The turn and agent summary digest sets are ephemeral digest state too:
    // they are dropped here with the keys so no retained digest survives the
    // attempt. Later checkpoints cannot earn novelty anyway, because the
    // novelty key is gone.
    this.turnSummary = emptySummary();
    this.agentSummary = emptySummary();
    // Completed digests are unusable afterwards, so an end after finalization
    // earns no structural novelty; the name/time telemetry stays observable.
    for (const tool of this.activeTools.values()) {
      tool.argsDigest = undefined;
      tool.lastUpdateDigest = undefined;
    }
  }

  snapshot(): MonitorSnapshot {
    const current = this.rounds[this.reportRoundValue];
    const first = this.rounds[1];
    const second = this.rounds[2];
    const providerFailureCategory = current.providerFailureCategory ?? first.providerFailureCategory;
    const reason = terminalReasonFields(current);
    return {
      phase: this.phaseValue,
      lastEvent: this.lastEventValue,
      lastEventDetail: this.lastEventDetailValue,
      lastEventAt: this.lastEventAtValue,
      lastValidRpcMonotonic: this.lastValidRpcValue,
      lastActivityMonotonic: this.lastActivityValue,
      lastStructuralProgressMonotonic: this.lastStructuralProgressValue,
      activityEventCount: this.activityEventCountValue,
      structuralProgressCount: this.structuralProgressCountValue,
      duplicateCheckpointCount: this.duplicateCheckpointCountValue,
      duplicateCheckpointsSinceNovel: this.duplicateCheckpointsSinceNovelValue,
      activityWarningCount: this.activityWarningCountValue,
      progressWarningCount: this.progressWarningCountValue,
      finalReport: current.finalReport,
      outcome: current.outcome,
      terminalReason: reason.terminalReason,
      reasonStatus: reason.reasonStatus,
      blockedMisuseSuspected: reason.blockedMisuseSuspected,
      sessionSeen: first.promptAccepted,
      agentRunning: current.agentRunning,
      agentStartCount: first.agentStartCount + second.agentStartCount,
      agentEndCount: first.agentEndCount + second.agentEndCount,
      agentEndSeen: current.finalAgentEndSeen,
      agentSettledSeen: current.settledSeen,
      toolExecutionCount: this.toolExecutionCountValue,
      ...this.activeToolFields(),
      routeUnavailableSeen: providerFailureCategory !== undefined,
      providerFailureCategory,
      reportRound: this.reportRoundValue,
      errors: [...this.errorsValue],
    };
  }

  private activeToolFields(): {
    readonly activeToolCount: number;
    readonly activeToolName?: string;
    readonly activeToolElapsedSeconds?: number;
    readonly activeToolIdleSeconds?: number;
    readonly activeToolLastNovelUpdateMonotonic?: number;
  } {
    if (this.activeTools.size === 0) return { activeToolCount: 0 };
    const now = this.monotonicNow();
    // The watchdog surface is the stalest active tool: the maximum
    // novel-update idle age across every active tool id, so a newer
    // updating tool can never mask an older silent one. Ties identify the
    // most recently started tool.
    let selected: ActiveTool | undefined;
    for (const tool of this.activeTools.values()) {
      if (selected === undefined) {
        selected = tool;
        continue;
      }
      const toolIdle = now - tool.lastNovelUpdateMonotonic;
      const selectedIdle = now - selected.lastNovelUpdateMonotonic;
      if (toolIdle > selectedIdle || (toolIdle === selectedIdle && tool.sequence > selected.sequence)) {
        selected = tool;
      }
    }
    if (selected === undefined) return { activeToolCount: 0 };
    return {
      activeToolCount: this.activeTools.size,
      activeToolName: selected.name,
      activeToolElapsedSeconds: Math.round((now - selected.startedMonotonic) / 100) / 10,
      activeToolIdleSeconds: Math.round((now - selected.lastNovelUpdateMonotonic) / 100) / 10,
      activeToolLastNovelUpdateMonotonic: selected.lastNovelUpdateMonotonic,
    };
  }

  private toolKey(event: Record<string, unknown>): string | undefined {
    return typeof event.toolCallId === "string" && event.toolCallId.length > 0
      ? `id:${event.toolCallId}`
      : undefined;
  }

  private toolName(event: Record<string, unknown>): string {
    // Ingress sanitization: a child-supplied name is stored, matched,
    // emitted, and persisted only when it is exactly one of the tools the
    // runtime resource policy makes available to children. Everything
    // else, including seeded paths, credentials, and provider bodies,
    // becomes the fixed label "unknown".
    const name = event.toolName;
    return typeof name === "string" && LIVE_TOOL_NAMES.has(name) ? name : UNKNOWN_TOOL_NAME;
  }

  /**
   * Accepts one tool start into the bounded active-tool map. A duplicate
   * key or a start beyond the fixed active-tool cap is one bounded stream
   * error before any insertion, tool count, or activity credit. An
   * accepted start retains only a domain-separated digest of the
   * normalized arguments under the ephemeral per-attempt key, never the
   * raw `event.args` value.
   */
  private startTool(event: Record<string, unknown>): boolean {
    const name = this.toolName(event);
    const key = this.toolKey(event) ?? `${ANONYMOUS_TOOL_KEY_PREFIX}${this.activeToolSequence + 1}`;
    if (this.activeTools.has(key)) {
      this.addError("duplicate_tool_execution_start");
      return false;
    }
    if (this.activeTools.size >= MAX_ACTIVE_TOOLS) {
      this.addError("too_many_active_tools");
      return false;
    }
    this.activeToolSequence += 1;
    this.toolExecutionCountValue += 1;
    const now = this.monotonicNow();
    this.activeTools.set(key, {
      key,
      name,
      startedMonotonic: now,
      sequence: this.activeToolSequence,
      argsDigest: this.toolArgsDigest(event.args),
      lastNovelUpdateMonotonic: now,
      lastUpdateDigest: undefined,
    });
    return true;
  }

  private matchingTool(event: Record<string, unknown>): ActiveTool | undefined {
    const key = this.toolKey(event);
    if (key !== undefined) return this.activeTools.get(key);
    // Anonymous correlation: only tools created without a tool-call id are
    // candidates, so an ID-backed tool can never match a no-ID event. Among
    // those, only the newest with an exactly equal sanitized name matches.
    // `unknown` is a literal name bucket, never a wildcard, so an anonymous
    // unallowlisted update or end matches only an active tool that also
    // maps to `unknown`; against anything else it follows the existing
    // unmatched-event error path.
    const name = this.toolName(event);
    return [...this.activeTools.values()]
      .filter((tool) => tool.key.startsWith(ANONYMOUS_TOOL_KEY_PREFIX) && tool.name === name)
      .sort((left, right) => right.sequence - left.sequence)[0];
  }

  private updateTool(event: Record<string, unknown>): boolean {
    const tool = this.matchingTool(event);
    if (tool === undefined) {
      this.addError("tool_execution_update_without_start");
      return false;
    }
    const digest = this.toolUpdateDigest(event);
    // A failed or over-budget digestion cannot prove the update changed, so
    // it fails closed: neither the tool clock nor accepted activity renews.
    // An identical accumulated update is not activity either.
    if (digest === undefined || digest === tool.lastUpdateDigest) return false;
    tool.lastUpdateDigest = digest;
    tool.lastNovelUpdateMonotonic = this.monotonicNow();
    return true;
  }

  private endTool(event: Record<string, unknown>): boolean {
    const tool = this.matchingTool(event);
    if (tool === undefined) {
      this.addError("tool_execution_end_without_start");
      return false;
    }
    this.activeTools.delete(tool.key);
    // Semantic novelty identity combines the mapped tool name, the stored
    // start-args digest, the final result, and the error status. When the
    // args digest is unavailable (key dropped at finalization or an
    // over-budget digestion at start), the identity is incomplete, so the
    // completed tool earns no structural novelty: fail closed. The
    // volatile toolCallId and the anonymous correlation key are excluded,
    // so the same completed call under a fresh id stays a duplicate.
    if (tool.argsDigest === undefined) return true;
    const digest = this.structuralCheckpoint({
      kind: "tool_execution_end",
      tool: tool.name,
      argsDigest: tool.argsDigest,
      result: event.result,
      isError: event.isError === true,
    }).digest;
    this.recordInTurn(digest);
    this.recordInAgent(digest);
    return true;
  }

  /** Authoritative assistant message checkpoint; digest input is the normalized semantic payload only. */
  private recordMessageCheckpoint(message: Record<string, unknown>): void {
    const semantic = semanticAssistantMessage(message);
    // Over-cap content is an unavailable checkpoint: no full map ran, and
    // neither structural nor duplicate credit is granted.
    if (semantic === undefined) return;
    const digest = this.structuralCheckpoint(semantic).digest;
    this.recordInTurn(digest);
    this.recordInAgent(digest);
  }

  private recordTurnCheckpoint(): void {
    const consumed = this.turnSummary;
    this.turnSummary = emptySummary();
    const digest = this.structuralCheckpoint({
      kind: "turn_end",
      distinctCheckpointCount: consumed.distinct.size,
      lastDigest: consumed.lastDigest,
    }).digest;
    // The completed-turn digest feeds only the enclosing agent summary,
    // never back into the closed turn summary it was consumed from.
    this.recordInAgent(digest);
  }

  private recordAgentCheckpoint(event: Record<string, unknown>): void {
    this.structuralCheckpoint({
      kind: "agent_end",
      willRetry: event.willRetry === true,
      distinctCheckpointCount: this.agentSummary.distinct.size,
      lastDigest: this.agentSummary.lastDigest,
    });
    this.agentSummary = emptySummary();
  }

  /**
   * Feeds one checkpoint digest into a summary's bounded identity
   * accumulator. A digest already present never changes the summary, so
   * repeated copies of the same message keep the enclosing identity. The
   * 65th distinct digest is never admitted: the accumulator saturates and
   * every later distinct identity is ignored, so a wider turn cannot keep
   * mutating the enclosing checkpoint and lossy overflow fails closed.
   */
  private feedSummary(summary: StructuralSummary, digest: string | undefined): void {
    if (digest === undefined || summary.distinct.has(digest)) return;
    if (summary.distinct.size >= MAX_SUMMARY_DISTINCT_DIGESTS) return;
    summary.distinct.add(digest);
    summary.lastDigest = digest;
  }

  /**
   * Feeds one checkpoint digest into the current turn summary slot. The
   * slot is dormant outside an open turn and is reinitialized at every
   * accepted turn start, so only checkpoints inside the open turn survive
   * to the matching turn end.
   */
  private recordInTurn(digest: string | undefined): void {
    this.feedSummary(this.turnSummary, digest);
  }

  /** Feeds one checkpoint digest into the enclosing agent summary. */
  private recordInAgent(digest: string | undefined): void {
    this.feedSummary(this.agentSummary, digest);
  }

  /**
   * Records one structural checkpoint and returns its identity digest.
   * Without a digest input the checkpoint is unconditionally novel (prompt
   * acceptance, settlement). With an input, an exact repeated checkpoint
   * increments the bounded duplicate counters and does not renew the
   * progress lease, while its digest is still returned so enclosing turn
   * and agent summaries keep repeated identities and cannot become novel
   * by omission. A failed or over-budget digestion earns no credit at all.
   */
  private structuralCheckpoint(input?: unknown): { readonly digest: string | undefined } {
    if (input === undefined) {
      this.renewStructuralProgress();
      return { digest: undefined };
    }
    const outcome = this.novelty.check(input);
    if (outcome.status === "novel") {
      this.renewStructuralProgress();
      return { digest: outcome.digest };
    }
    if (outcome.status === "duplicate") {
      this.duplicateCheckpointCountValue += 1;
      this.duplicateCheckpointsSinceNovelValue += 1;
      return { digest: outcome.digest };
    }
    return { digest: undefined };
  }

  private renewStructuralProgress(): void {
    this.lastStructuralProgressValue = this.monotonicNow();
    this.structuralProgressCountValue += 1;
    this.duplicateCheckpointsSinceNovelValue = 0;
  }

  private toolUpdateDigest(event: Record<string, unknown>): string | undefined {
    if (this.toolUpdateKey === undefined) return undefined;
    try {
      const result = boundedDigest(this.toolUpdateKey, { partialResult: event.partialResult });
      return result.ok ? result.digest : undefined;
    } catch {
      return undefined;
    }
  }

  /** Domain-separated bounded digest of one tool's normalized start arguments. */
  private toolArgsDigest(args: unknown): string | undefined {
    if (this.toolArgsKey === undefined) return undefined;
    try {
      const result = boundedDigest(this.toolArgsKey, { domain: "tool-args", args });
      return result.ok ? result.digest : undefined;
    } catch {
      return undefined;
    }
  }

  private recordProviderFailure(state: RoundState, category: ProviderFailureCategory): void {
    if (state.providerFailureCategory === undefined || state.providerFailureCategory === "provider_unavailable") {
      state.providerFailureCategory = category;
    }
  }

  private addError(category: string): void {
    this.errorsValue.push(category.slice(0, 120));
  }

  private recordActivity(eventName: string, phase: string, detail?: string): void {
    this.lastActivityValue = this.monotonicNow();
    this.lastEventValue = eventName.slice(0, 80);
    this.lastEventDetailValue = detail;
    this.lastEventAtValue = this.wallNow();
    this.phaseValue = phase;
    this.activityEventCountValue += 1;
    this.onActivity?.();
  }
}
