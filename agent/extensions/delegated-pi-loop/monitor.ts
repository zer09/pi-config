import { classifyProviderFailure } from "./protocol.ts";
import type {
  DelegateState,
  MonitorSnapshot,
  ProviderFailureCategory,
} from "./types.ts";

const RESULT_LINE_PATTERN = /^DELEGATE_RESULT:\s*(COMPLETED|BLOCKED|FAILED)\s*$/gm;
const RESULT_PATTERN = /(?:^|\n)DELEGATE_RESULT:\s*(COMPLETED|BLOCKED|FAILED)\s*$/;
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

interface RoundState {
  promptAccepted: boolean;
  agentRunning: boolean;
  agentStartCount: number;
  agentEndCount: number;
  finalAgentEndSeen: boolean;
  settledSeen: boolean;
  finalReport?: string;
  outcome?: Outcome;
  providerFailureCategory?: ProviderFailureCategory;
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
  const markers = [...report.matchAll(RESULT_LINE_PATTERN)];
  if (markers.length !== 1) return undefined;
  const match = RESULT_PATTERN.exec(report.trimEnd());
  return match?.[1]?.toLowerCase() as Outcome | undefined;
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

  recordUiActivity(method: string): void {
    this.recordActivity("extension_ui_request", this.phaseValue, method.slice(0, 80));
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
      if (updateType.endsWith("_delta") && !update.delta) return;
      let phase = updateType.startsWith("thinking_") ? "thinking" : "responding";
      if (updateType.startsWith("toolcall_")) phase = "tool_selection";
      this.recordActivity(updateType, phase);
      return;
    }

    if (!CORE_ACTIVITY_EVENTS.has(eventType) && !SESSION_ACTIVITY_EVENTS.has(eventType)) return;
    if (eventType === "bash_execution_update" && !event.delta) return;
    if (eventType === "tool_execution_start") this.toolExecutionCountValue += 1;
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
      state.outcome = report === undefined ? undefined : parseDelegateOutcome(report);
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
      sessionSeen: first.promptAccepted,
      agentRunning: current.agentRunning,
      agentStartCount: first.agentStartCount + second.agentStartCount,
      agentEndCount: first.agentEndCount + second.agentEndCount,
      agentEndSeen: current.finalAgentEndSeen,
      agentSettledSeen: current.settledSeen,
      toolExecutionCount: this.toolExecutionCountValue,
      routeUnavailableSeen: providerFailureCategory !== undefined,
      providerFailureCategory,
      reportRound: this.reportRoundValue,
      errors: [...this.errorsValue],
    };
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
