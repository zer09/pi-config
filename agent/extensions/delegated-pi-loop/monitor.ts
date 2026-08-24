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
  "entry_appended",
  "queue_update",
]);

interface ActiveTool {
  readonly key: string;
  readonly name: string;
  readonly startedMonotonic: number;
  readonly sequence: number;
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
    agentStartCount: 0,
    agentEndCount: 0,
    finalAgentEndSeen: false,
    settledSeen: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  private lastActivityValue: number;
  private activityEventCountValue = 0;
  private warningCountValue = 0;
  private toolExecutionCountValue = 0;
  private activeToolSequence = 0;
  private readonly activeTools = new Map<string, ActiveTool>();
  private lastQueueSignature: string | undefined;
  private reportRoundValue: ReportRound = 1;
  private readonly errorsValue: string[] = [];
  private readonly rounds: Record<ReportRound, RoundState> = { 1: emptyRound(), 2: emptyRound() };
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
    this.lastActivityValue = startedMonotonic;
    this.lastEventAtValue = startedAt;
    this.monotonicNow = monotonicNow;
    this.wallNow = wallNow;
    this.onActivity = onActivity;
  }

  beginRecovery(): void {
    this.reportRoundValue = 2;
    this.phaseValue = "recovering_report";
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

    if (eventType === "agent_start") {
      if (state.agentRunning || state.finalAgentEndSeen || state.settledSeen) {
        this.addError("invalid_agent_start_lifecycle");
        return;
      }
      state.agentRunning = true;
      state.agentStartCount += 1;
    } else if (eventType === "agent_end") {
      if (!state.agentRunning) {
        this.addError("invalid_agent_end_lifecycle");
        return;
      }
      state.agentRunning = false;
      state.agentEndCount += 1;
      state.finalAgentEndSeen = event.willRetry !== true;
    } else if (eventType === "agent_settled") {
      if (!state.finalAgentEndSeen || state.agentRunning || state.settledSeen) {
        this.addError("agent_settled_before_final_agent_end");
        return;
      }
      state.settledSeen = true;
    } else if (CORE_ACTIVITY_EVENTS.has(eventType) && !state.agentRunning) {
      this.addError(`${eventType.slice(0, 60)}_outside_agent_lifecycle`);
      return;
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
      this.toolExecutionCountValue += 1;
      this.startTool(event);
    } else if (eventType === "tool_execution_update") {
      if (!this.updateTool(event)) return;
    } else if (eventType === "tool_execution_end") {
      if (!this.endTool(event)) return;
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

    const detail = eventType.startsWith("tool_execution_") && typeof event.toolName === "string"
      ? event.toolName.slice(0, 80)
      : undefined;
    this.recordActivity(eventType, phase, detail);

    if (eventType === "message_end") {
      const message = event.message;
      if (!isRecord(message) || message.role !== "assistant") return;
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

  issueIdleWarning(): void {
    this.warningCountValue += 1;
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
      lastActivityMonotonic: this.lastActivityValue,
      activityEventCount: this.activityEventCountValue,
      warningCount: this.warningCountValue,
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
  } {
    const active = [...this.activeTools.values()].sort((left, right) => right.sequence - left.sequence)[0];
    if (active === undefined) return { activeToolCount: 0 };
    return {
      activeToolCount: this.activeTools.size,
      activeToolName: active.name,
      activeToolElapsedSeconds: Math.round((this.monotonicNow() - active.startedMonotonic) / 100) / 10,
    };
  }

  private toolKey(event: Record<string, unknown>): string | undefined {
    return typeof event.toolCallId === "string" && event.toolCallId.length > 0
      ? `id:${event.toolCallId}`
      : undefined;
  }

  private toolName(event: Record<string, unknown>): string {
    return typeof event.toolName === "string" && event.toolName.length > 0
      ? event.toolName.slice(0, 80)
      : "unknown";
  }

  private startTool(event: Record<string, unknown>): void {
    const name = this.toolName(event);
    const key = this.toolKey(event) ?? `anonymous:${this.activeToolSequence + 1}`;
    if (this.activeTools.has(key)) {
      this.addError("duplicate_tool_execution_start");
      return;
    }
    this.activeToolSequence += 1;
    const now = this.monotonicNow();
    this.activeTools.set(key, {
      key,
      name,
      startedMonotonic: now,
      sequence: this.activeToolSequence,
    });
  }

  private matchingTool(event: Record<string, unknown>): ActiveTool | undefined {
    const key = this.toolKey(event);
    if (key !== undefined) return this.activeTools.get(key);
    const name = this.toolName(event);
    return [...this.activeTools.values()]
      .filter((tool) => name === "unknown" || tool.name === name)
      .sort((left, right) => right.sequence - left.sequence)[0];
  }

  private updateTool(event: Record<string, unknown>): boolean {
    const tool = this.matchingTool(event);
    if (tool === undefined) {
      this.addError("tool_execution_update_without_start");
      return false;
    }
    return true;
  }

  private endTool(event: Record<string, unknown>): boolean {
    const tool = this.matchingTool(event);
    if (tool === undefined) {
      this.addError("tool_execution_end_without_start");
      return false;
    }
    this.activeTools.delete(tool.key);
    return true;
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
