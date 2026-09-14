import { THINKING_LEVELS, type ProviderFailureCategory, type ThinkingLevel } from "./types.ts";

// The round-2 recovery prompt text itself lives in instructions.ts; this
// module owns only the RPC framing and correlation state.

export const PROMPT_IDS = { 1: "prompt-1", 2: "prompt-2" } as const;
const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
/** Fixed cap on one UI request method string; a longer method is malformed. */
const MAX_UI_METHOD_LENGTH = 80;
/** Fixed cap on one dialog id string; a longer id is malformed. */
const MAX_UI_DIALOG_ID_LENGTH = 200;
/** Fixed cap on one tool-call id string in code units; a longer id is malformed. */
const MAX_TOOL_CALL_ID_LENGTH = 200;
/** The three tool execution lifecycle event types that may carry a toolCallId. */
const TOOL_EXECUTION_EVENT_TYPES = new Set([
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

export type ReportRound = 1 | 2;

export type ControlCommand =
  | { readonly type: "get_state" | "get_available_models" | "get_session_stats" }
  | { readonly type: "set_model"; readonly provider: string; readonly modelId: string }
  | { readonly type: "set_thinking_level"; readonly level: ThinkingLevel };

export interface ControlModel {
  readonly provider: string;
  readonly id: string;
}

export interface ControlState {
  readonly model: ControlModel | null;
  readonly thinkingLevel: ThinkingLevel;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly messageCount: number;
  readonly pendingMessageCount: number;
}

type ControlSuccess =
  | { readonly command: "get_state"; readonly data: ControlState }
  | { readonly command: "get_available_models"; readonly data: { readonly models: readonly ControlModel[] } }
  | { readonly command: "set_model"; readonly data: ControlModel }
  | { readonly command: "set_thinking_level" }
  | { readonly command: "get_session_stats"; readonly data: { readonly totalMessages: number } };

export type ControlResult =
  | ({ readonly id: string; readonly success: true } & ControlSuccess)
  | {
    readonly id: string;
    readonly command: ControlCommand["type"];
    readonly success: false;
    readonly category: "command_rejected";
  };

interface PendingControl {
  readonly id: string;
  readonly command: ControlCommand;
  readonly onResult: (result: ControlResult) => void;
}

const CONTROL_COMMANDS = new Set(["get_state", "get_available_models", "set_model", "set_thinking_level", "get_session_stats"]);
const MAX_COMMAND_ID_LENGTH = 100;
const MAX_CONTROL_IDENTIFIER_LENGTH = 512;

export type ProtocolRecord =
  | { readonly kind: "prompt_accepted"; readonly round: ReportRound }
  | { readonly kind: "prompt_rejected"; readonly round: ReportRound; readonly category: "command_rejected" }
  | { readonly kind: "event"; readonly round: ReportRound; readonly event: Record<string, unknown> }
  | { readonly kind: "ui_response"; readonly line: string; readonly method: string }
  | { readonly kind: "ui_activity"; readonly method: string }
  | { readonly kind: "protocol_error"; readonly category: string };

interface PendingPrompt {
  readonly id: string;
  readonly round: ReportRound;
  readonly bufferedEvents: Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isControlIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_CONTROL_IDENTIFIER_LENGTH && value.trim() === value
    && /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(value) && !value.includes("://");
}

function isControlModelId(value: unknown): value is string {
  // Model namespace prefixes allow @ and ~, but not credential-style user@host.
  // Keep exact IDs without allowing URLs, whitespace, or header/query syntax.
  return typeof value === "string" && value.length <= MAX_CONTROL_IDENTIFIER_LENGTH && value.trim() === value
    && /^[@~]?[A-Za-z0-9](?:[A-Za-z0-9._:/+-]|\/[@~](?=[A-Za-z0-9]))*$/.test(value) && !value.includes("://");
}

function controlModel(value: unknown): ControlModel | undefined {
  if (!isRecord(value) || !isControlIdentifier(value.provider) || !isControlModelId(value.id)) return undefined;
  return { provider: value.provider, id: value.id };
}

function validateControlCommand(value: ControlCommand): ControlCommand {
  if (isRecord(value)) {
    const type = value.type;
    if (type === "get_state" || type === "get_available_models" || type === "get_session_stats") {
      if (Object.keys(value).length === 1) return { type };
    } else if (type === "set_model") {
      if (Object.keys(value).length === 3 && isControlIdentifier(value.provider) && isControlModelId(value.modelId)) {
        return { type, provider: value.provider, modelId: value.modelId };
      }
    } else if (type === "set_thinking_level") {
      if (Object.keys(value).length === 2 && isThinkingLevel(value.level)) return { type, level: value.level };
    }
  }
  throw new Error("RPC control command is invalid");
}

function controlSuccess(command: ControlCommand, data: unknown): ControlSuccess | undefined {
  if (command.type === "set_thinking_level") {
    // Pi can clamp the requested level. Only a later get_state proves it.
    if (data === undefined) return { command: command.type };
    return undefined;
  }
  if (!isRecord(data)) return undefined;
  if (command.type === "get_state") {
    // Installed Pi omits an unset model; the RPC docs also permit null.
    const model = data.model == null ? null : controlModel(data.model);
    if (model === undefined || !isThinkingLevel(data.thinkingLevel)
      || typeof data.isStreaming !== "boolean" || typeof data.isCompacting !== "boolean"
      || !isCount(data.messageCount) || !isCount(data.pendingMessageCount)) return undefined;
    return {
      command: command.type,
      data: {
        model,
        thinkingLevel: data.thinkingLevel,
        isStreaming: data.isStreaming,
        isCompacting: data.isCompacting,
        messageCount: data.messageCount,
        pendingMessageCount: data.pendingMessageCount,
      },
    };
  }
  if (command.type === "get_available_models") {
    if (!Array.isArray(data.models)) return undefined;
    const models: ControlModel[] = [];
    const seen = new Set<string>();
    for (const entry of data.models) {
      const model = controlModel(entry);
      if (model === undefined) return undefined;
      const key = JSON.stringify([model.provider, model.id]);
      if (seen.has(key)) return undefined;
      seen.add(key);
      models.push(model);
    }
    return { command: command.type, data: { models } };
  }
  if (command.type === "set_model") {
    const model = controlModel(data);
    if (model === undefined || model.provider !== command.provider || model.id !== command.modelId) return undefined;
    return { command: command.type, data: model };
  }
  // History presence needs only this count, not session paths, usage, or cost.
  if (!isCount(data.totalMessages)) return undefined;
  return { command: command.type, data: { totalMessages: data.totalMessages } };
}

export function serializePromptCommand(round: ReportRound, message: string): string {
  return `${JSON.stringify({ id: PROMPT_IDS[round], type: "prompt", message })}\n`;
}

export function serializeUiCancellation(id: string): string {
  return `${JSON.stringify({ type: "extension_ui_response", id, cancelled: true })}\n`;
}

/** One instance per child process; response IDs are never reused across routes. */
export class RpcJsonlProtocol {
  private buffer = Buffer.alloc(0);
  private bufferLength = 0;
  private pendingBytes = 0;
  private pendingReplayRecords = 0;
  private pendingUiResponses = 0;
  private pendingPrompt: PendingPrompt | undefined;
  private pendingControl: PendingControl | undefined;
  private promptUnsettled = false;
  private activeRound: ReportRound | undefined;
  private routeOrdinal = 1;
  private promptIds: Readonly<Record<ReportRound, string>> = PROMPT_IDS;
  private readonly completedResponseIds = new Set<string>();
  private readonly cancelledUiIds = new Set<string>();
  private readonly maxLineBytes: number;
  private failed = false;

  constructor(maxLineBytes = DEFAULT_MAX_LINE_BYTES) {
    this.maxLineBytes = maxLineBytes;
  }

  beginPrompt(round: ReportRound, message: string): string {
    // Acceptance is not settlement; late events still belong to the current prompt.
    // Buffered bytes and unfinished callbacks cannot belong to a new prompt.
    if (this.failed || this.pendingPrompt !== undefined || this.pendingControl !== undefined
      || this.promptUnsettled || this.pendingBytes > 0 || this.pendingReplayRecords > 0 || this.pendingUiResponses > 0) {
      throw new Error("RPC prompt cannot start in the current protocol state");
    }
    if ((round !== 1 && round !== 2) || this.completedResponseIds.has(this.promptIds[round])) {
      throw new Error("RPC prompt round is invalid or already used");
    }
    if (round === 2 && this.activeRound !== 1) {
      throw new Error("RPC recovery prompt requires an accepted first round");
    }
    const id = this.promptIds[round];
    this.pendingPrompt = { id, round, bufferedEvents: [] };
    this.promptUnsettled = true;
    return `${JSON.stringify({ id, type: "prompt", message })}\n`;
  }

  // A probe must leave partial bytes and all process-local correlation state untouched.
  canBeginFallbackPromptCycle(routeOrdinal: number): boolean {
    return "promptIds" in this.fallbackPromptCycleReadiness(routeOrdinal);
  }

  /**
   * Start a fallback route's logical round 1 at the same true idle boundary as controls.
   * The initial cycle must have started through beginPrompt(1, ...).
   * Ordinals must be safe integers in exact order: 2, 3, ...; no reuse or gaps.
   * IDs are route-N:prompt-1 and route-N:prompt-2 (at most 31 characters).
   * Both IDs must be unused by controls; beginPrompt(2, ...) uses this cycle's ID once.
   * A rejected prompt consumes its ID but still permits the next idle cycle.
   */
  beginFallbackPromptCycle(routeOrdinal: number, message: string): string {
    const readiness = this.fallbackPromptCycleReadiness(routeOrdinal);
    if ("error" in readiness) throw new Error(readiness.error);
    // Only prompt correlation is route-local. Keep all process-wide guards and IDs.
    this.routeOrdinal = routeOrdinal;
    this.promptIds = readiness.promptIds;
    this.activeRound = undefined;
    return this.beginPrompt(1, message);
  }

  private fallbackPromptCycleReadiness(routeOrdinal: number): { promptIds: Readonly<Record<ReportRound, string>> } | { error: string } {
    if (this.failed || this.pendingPrompt !== undefined || this.pendingControl !== undefined
      || this.promptUnsettled || this.pendingBytes > 0 || this.pendingReplayRecords > 0 || this.pendingUiResponses > 0
      || !this.completedResponseIds.has(this.promptIds[1])) {
      return { error: "RPC fallback prompt cycle cannot start in the current protocol state" };
    }
    if (!Number.isSafeInteger(routeOrdinal) || routeOrdinal <= 1 || routeOrdinal !== this.routeOrdinal + 1) {
      return { error: "RPC route ordinal must be the next safe integer" };
    }
    const promptIds = { 1: `route-${routeOrdinal}:prompt-1`, 2: `route-${routeOrdinal}:prompt-2` };
    if (Object.values(promptIds).some((id) => id.length > MAX_COMMAND_ID_LENGTH || this.completedResponseIds.has(id))) {
      return { error: "RPC route prompt ID is invalid or already used" };
    }
    return { promptIds };
  }

  // Supply a deterministic route/step ID, for example "route-2:verify-state".
  // Controls have a separate callback so they cannot become prompt activity.
  // Protocol failures still go to feed/finish's protocol_error callback.
  beginControl(id: string, command: ControlCommand, onResult: (result: ControlResult) => void): string {
    if (this.failed || this.pendingPrompt !== undefined || this.pendingControl !== undefined
      || this.promptUnsettled || this.pendingBytes > 0 || this.pendingReplayRecords > 0 || this.pendingUiResponses > 0) {
      throw new Error("RPC control cannot start in the current protocol state");
    }
    if (typeof id !== "string" || id.length > MAX_COMMAND_ID_LENGTH || id.trim() !== id || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)
      || id === PROMPT_IDS[1] || id === PROMPT_IDS[2] || id === this.promptIds[1] || id === this.promptIds[2]
      || this.completedResponseIds.has(id)) {
      throw new Error("RPC control ID is invalid or already used");
    }
    const validated = validateControlCommand(command);
    this.pendingControl = { id, command: validated, onResult };
    return `${JSON.stringify({ id, ...validated })}\n`;
  }

  feed(chunk: Buffer, emit: (record: ProtocolRecord) => void): void {
    if (this.failed) return;
    // Count the whole chunk before callbacks, including incomplete UTF-8 tails.
    this.pendingBytes += chunk.length;
    let offset = 0;
    while (offset < chunk.length && !this.failed) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline < 0 ? chunk.length : newline;
      const length = this.bufferLength + end - offset;
      const lastByte = end > offset ? chunk[end - 1] : this.buffer[this.bufferLength - 1];
      // Allow one trailing CR even when its LF arrives in the next chunk.
      if (length > this.maxLineBytes + 1 || (length > this.maxLineBytes && lastByte !== 0x0d)) {
        this.protocolError("line_too_large", emit);
        break;
      }
      let line: string;
      if (this.bufferLength === 0 && newline >= 0) {
        line = chunk.toString("utf8", offset, end);
      } else {
        if (length > this.buffer.length) {
          // Geometric growth keeps tiny chunks from repeatedly copying the whole record.
          const buffer = Buffer.alloc(Math.min(this.maxLineBytes + 1, Math.max(length, this.buffer.length * 2, 1024)));
          this.buffer.copy(buffer, 0, 0, this.bufferLength);
          this.buffer = buffer;
        }
        chunk.copy(this.buffer, this.bufferLength, offset, end);
        this.bufferLength = length;
        if (newline < 0) break;
        line = this.buffer.toString("utf8", 0, length);
        this.buffer = Buffer.alloc(0);
        this.bufferLength = 0;
      }
      this.pendingBytes -= length + 1;
      offset = newline + 1;
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
        this.protocolError("line_too_large", emit);
        break;
      }
      if (line.length === 0) {
        this.protocolError("empty_record", emit);
        break;
      }
      this.consumeLine(line, emit);
    }
  }

  finish(emit: (record: ProtocolRecord) => void): void {
    if (this.failed) return;
    if (this.pendingBytes > 0) {
      this.protocolError("partial_record", emit);
      return;
    }
    if (this.pendingPrompt !== undefined) this.protocolError("missing_prompt_response", emit);
    else if (this.pendingControl !== undefined) this.protocolError("missing_control_response", emit);
  }

  private consumeLine(line: string, emit: (record: ProtocolRecord) => void): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.protocolError("malformed_json", emit);
      return;
    }
    if (!isRecord(value) || typeof value.type !== "string") {
      this.protocolError("malformed_record", emit);
      return;
    }
    // The tool-call id bound runs before prompt buffering and event emission,
    // so an oversized id can never renew RPC health or reach the monitor.
    // A present nonempty id longer than 200 code units is one fixed protocol
    // error; missing, empty, and non-string ids keep anonymous correlation,
    // and id characters stay opaque with no allowlist.
    if (TOOL_EXECUTION_EVENT_TYPES.has(value.type)) {
      const toolCallId = value.toolCallId;
      if (typeof toolCallId === "string" && toolCallId.length > MAX_TOOL_CALL_ID_LENGTH) {
        this.protocolError("tool_call_id_too_long", emit);
        return;
      }
    }
    if (value.type === "response") {
      this.consumeResponse(value, emit);
      return;
    }
    if (value.type === "extension_ui_request") {
      this.consumeUiRequest(value, emit);
      return;
    }
    // UI has its own correlation and cancellation path. Every other event
    // contradicts an idle control exchange, so never buffer or attribute it.
    if (this.pendingControl !== undefined) {
      this.protocolError("event_during_control", emit);
      return;
    }
    if (this.pendingPrompt !== undefined) {
      this.pendingPrompt.bufferedEvents.push(value);
      return;
    }
    if (this.activeRound === undefined) {
      this.protocolError("event_without_prompt", emit);
      return;
    }
    this.promptUnsettled = value.type !== "agent_settled";
    emit({ kind: "event", round: this.activeRound, event: value });
  }

  private consumeResponse(value: Record<string, unknown>, emit: (record: ProtocolRecord) => void): void {
    const id = value.id;
    if (typeof id !== "string" || id.trim().length === 0 || id.length > MAX_COMMAND_ID_LENGTH
      || typeof value.command !== "string" || (value.command !== "prompt" && !CONTROL_COMMANDS.has(value.command))
      || typeof value.success !== "boolean") {
      this.protocolError("malformed_response", emit);
      return;
    }
    if (this.completedResponseIds.has(id)) {
      this.protocolError("duplicate_response", emit);
      return;
    }
    if (this.pendingControl !== undefined) {
      this.consumeControlResponse(value, emit);
      return;
    }
    if (value.command !== "prompt") {
      this.protocolError("unexpected_control_response", emit);
      return;
    }
    if (this.pendingPrompt?.id !== id) {
      this.protocolError("unknown_response", emit);
      return;
    }

    const pending = this.pendingPrompt;
    this.pendingPrompt = undefined;
    this.completedResponseIds.add(id);
    if (!value.success) {
      this.promptUnsettled = false;
      emit({ kind: "prompt_rejected", round: pending.round, category: "command_rejected" });
      return;
    }

    this.activeRound = pending.round;
    // The response LF may exhaust raw bytes before these decoded events replay.
    this.pendingReplayRecords = pending.bufferedEvents.length;
    try {
      emit({ kind: "prompt_accepted", round: pending.round });
      for (const event of pending.bufferedEvents) {
        if (this.failed) break;
        if (this.pendingControl !== undefined) {
          this.protocolError("event_during_control", emit);
          break;
        }
        this.promptUnsettled = event.type !== "agent_settled";
        // Allow a transition from the final callback only when no old event follows.
        this.pendingReplayRecords -= 1;
        emit({ kind: "event", round: pending.round, event });
      }
    } finally {
      this.pendingReplayRecords = 0;
    }
  }

  private consumeControlResponse(value: Record<string, unknown>, emit: (record: ProtocolRecord) => void): void {
    const pending = this.pendingControl!;
    if (value.id !== pending.id) {
      this.protocolError("unknown_response", emit);
      return;
    }
    if (value.command !== pending.command.type) {
      this.protocolError("mismatched_control_response", emit);
      return;
    }
    let result: ControlResult;
    if (value.success === false) {
      if (typeof value.error !== "string") {
        this.protocolError("malformed_response", emit);
        return;
      }
      result = { id: pending.id, command: pending.command.type, success: false, category: "command_rejected" };
    } else {
      if (Object.hasOwn(value, "error")) {
        this.protocolError("malformed_response", emit);
        return;
      }
      const success = controlSuccess(pending.command, value.data);
      if (success === undefined) {
        this.protocolError("malformed_control_data", emit);
        return;
      }
      result = { id: pending.id, success: true, ...success };
    }
    this.pendingControl = undefined;
    this.completedResponseIds.add(pending.id);
    pending.onResult(result);
  }

  private consumeUiRequest(value: Record<string, unknown>, emit: (record: ProtocolRecord) => void): void {
    // Shape and duplicate validation runs before any ui_activity emission:
    // a malformed or oversized method or dialog id can never surface as
    // accepted UI activity on its way to the terminal protocol error.
    const method = value.method;
    if (typeof method !== "string" || method.length === 0 || method.length > MAX_UI_METHOD_LENGTH) {
      this.protocolError("malformed_ui_request", emit);
      return;
    }
    if (DIALOG_METHODS.has(method)) {
      const id = value.id;
      if (typeof id !== "string" || id.length === 0 || id.length > MAX_UI_DIALOG_ID_LENGTH) {
        this.protocolError("malformed_ui_request", emit);
        return;
      }
      if (this.cancelledUiIds.has(id)) {
        this.protocolError("duplicate_ui_request", emit);
        return;
      }
      this.cancelledUiIds.add(id);
      // ui_activity still owes a cancellation callback, even after the record's LF.
      this.pendingUiResponses += 1;
      try {
        emit({ kind: "ui_activity", method });
      } finally {
        // Terminal errors already clear this count before their callback.
        if (!this.failed) this.pendingUiResponses -= 1;
      }
      if (!this.failed) emit({ kind: "ui_response", method, line: serializeUiCancellation(id) });
      return;
    }
    // Unknown methods are consumed like fire-and-forget UI updates. Never invent
    // a reply for a method that is not one of the four blocking dialogs.
    emit({ kind: "ui_activity", method });
  }

  private protocolError(category: string, emit: (record: ProtocolRecord) => void): void {
    this.failed = true;
    // A failed stream cannot consume these records. Drop any private payloads.
    this.buffer = Buffer.alloc(0);
    this.bufferLength = 0;
    this.pendingBytes = 0;
    this.pendingReplayRecords = 0;
    this.pendingUiResponses = 0;
    this.pendingPrompt = undefined;
    this.pendingControl = undefined;
    emit({ kind: "protocol_error", category });
  }
}

const QUOTA_PATTERN = /(?:insufficient[_ -]?quota|quota (?:exhausted|exhaustion|exceeded|depleted)|exceeded (?:your )?quota)/i;
const CREDIT_PATTERN = /(?:(?:insufficient|unavailable|depleted|exhausted) credits?|credit(?:-| )?balance (?:exhausted|exhaustion|depleted|insufficient)|not enough credits?)/i;
const BILLING_PATTERN = /(?:\b402\b|payment required|billing limit|spending limit)/i;
const USAGE_PATTERN = /(?:usage limit|usage cap|monthly limit|daily limit)/i;
const AUTH_PATTERN = /(?:\b401\b|\b403\b|unauthorized|forbidden|authentication|invalid api key|api key invalid|missing api key)/i;
const RATE_PATTERN = /(?:\b429\b|rate[ -]?limit|too many requests)/i;
const UNAVAILABLE_PATTERN = /(?:\b408\b|\b5(?:00|02|03|04|24|29)\b|no models? match|model[^\n]{0,80}(?:not found|unavailable)|overload|(?:service|provider) unavailable|temporarily unavailable|internal server error|gateway timeout|connection (?:reset|refused)|network error|fetch failed|client[_ -]?gone|context cancel(?:ed|led)|scanner[_ -]?error|unexpected eof|request (?:timed out|timeout))/i;

/** Returns only a bounded category; the input string is never retained. */
export function classifyProviderFailure(value: unknown): ProviderFailureCategory | undefined {
  if (typeof value !== "string") return undefined;
  if (QUOTA_PATTERN.test(value)) return "quota_exhausted";
  if (CREDIT_PATTERN.test(value)) return "credits_exhausted";
  if (BILLING_PATTERN.test(value)) return "billing_limit";
  if (USAGE_PATTERN.test(value)) return "usage_limit";
  if (AUTH_PATTERN.test(value)) return "authentication";
  if (RATE_PATTERN.test(value)) return "rate_limit";
  if (UNAVAILABLE_PATTERN.test(value)) return "provider_unavailable";
  return undefined;
}
