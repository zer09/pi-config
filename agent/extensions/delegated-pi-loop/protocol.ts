import { StringDecoder } from "node:string_decoder";
import type { ProviderFailureCategory } from "./types.ts";

// The round-2 recovery prompt text itself lives in instructions.ts; this
// module owns only the RPC framing and correlation state.

export const PROMPT_IDS = { 1: "prompt-1", 2: "prompt-2" } as const;
const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const FIRE_AND_FORGET_METHODS = new Set([
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
]);

export type ReportRound = 1 | 2;

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

function boundedMethod(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "invalid";
  return value.slice(0, 80);
}

export function serializePromptCommand(round: ReportRound, message: string): string {
  return `${JSON.stringify({ id: PROMPT_IDS[round], type: "prompt", message })}\n`;
}

export function serializeUiCancellation(id: string): string {
  return `${JSON.stringify({ type: "extension_ui_response", id, cancelled: true })}\n`;
}

/** Strict LF-framed RPC reader and prompt-response correlator. */
export class RpcJsonlProtocol {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private pendingPrompt: PendingPrompt | undefined;
  private activeRound: ReportRound | undefined;
  private readonly completedResponseIds = new Set<string>();
  private readonly cancelledUiIds = new Set<string>();
  private readonly maxLineBytes: number;
  private failed = false;

  constructor(maxLineBytes = DEFAULT_MAX_LINE_BYTES) {
    this.maxLineBytes = maxLineBytes;
  }

  beginPrompt(round: ReportRound, message: string): string {
    if (this.failed || this.pendingPrompt !== undefined) {
      throw new Error("RPC prompt cannot start in the current protocol state");
    }
    if (round === 2 && this.activeRound !== 1) {
      throw new Error("RPC recovery prompt requires an accepted first round");
    }
    this.pendingPrompt = { id: PROMPT_IDS[round], round, bufferedEvents: [] };
    return serializePromptCommand(round, message);
  }

  feed(chunk: Buffer, emit: (record: ProtocolRecord) => void): void {
    if (this.failed) return;
    this.buffer += this.decoder.write(chunk);
    if (Buffer.byteLength(this.buffer, "utf8") > this.maxLineBytes && !this.buffer.includes("\n")) {
      this.protocolError("line_too_large", emit);
      return;
    }

    while (!this.failed) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
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
    this.buffer += this.decoder.end();
    if (this.buffer.length > 0) {
      this.protocolError("partial_record", emit);
      return;
    }
    if (this.pendingPrompt !== undefined) this.protocolError("missing_prompt_response", emit);
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
    if (value.type === "response") {
      this.consumeResponse(value, emit);
      return;
    }
    if (value.type === "extension_ui_request") {
      this.consumeUiRequest(value, emit);
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
    emit({ kind: "event", round: this.activeRound, event: value });
  }

  private consumeResponse(value: Record<string, unknown>, emit: (record: ProtocolRecord) => void): void {
    const id = value.id;
    if (typeof id !== "string" || id.length > 100 || value.command !== "prompt" || typeof value.success !== "boolean") {
      this.protocolError("malformed_response", emit);
      return;
    }
    if (this.completedResponseIds.has(id)) {
      this.protocolError("duplicate_response", emit);
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
      emit({ kind: "prompt_rejected", round: pending.round, category: "command_rejected" });
      return;
    }

    this.activeRound = pending.round;
    emit({ kind: "prompt_accepted", round: pending.round });
    for (const event of pending.bufferedEvents) {
      if (this.failed) break;
      emit({ kind: "event", round: pending.round, event });
    }
  }

  private consumeUiRequest(value: Record<string, unknown>, emit: (record: ProtocolRecord) => void): void {
    const method = boundedMethod(value.method);
    emit({ kind: "ui_activity", method });
    if (DIALOG_METHODS.has(method)) {
      const id = value.id;
      if (typeof id !== "string" || id.length === 0 || id.length > 200) {
        this.protocolError("malformed_ui_request", emit);
        return;
      }
      if (this.cancelledUiIds.has(id)) {
        this.protocolError("duplicate_ui_request", emit);
        return;
      }
      this.cancelledUiIds.add(id);
      emit({ kind: "ui_response", method, line: serializeUiCancellation(id) });
      return;
    }
    // Unknown methods are consumed like fire-and-forget UI updates. Never invent
    // a reply for a method that is not one of the four blocking dialogs.
    if (FIRE_AND_FORGET_METHODS.has(method) || method !== "invalid") return;
    this.protocolError("malformed_ui_request", emit);
  }

  private protocolError(category: string, emit: (record: ProtocolRecord) => void): void {
    this.failed = true;
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
