import type { MonitorSnapshot } from "./types.ts";

const RESULT_LINE_PATTERN = /^DELEGATE_RESULT:\s*(COMPLETED|BLOCKED|FAILED)\s*$/gm;
const RESULT_PATTERN = /(?:^|\n)DELEGATE_RESULT:\s*(COMPLETED|BLOCKED|FAILED)\s*$/;
const ROUTE_UNAVAILABLE_PATTERN = /(?:\b(?:401|403|408|429|500|502|503|504|524|529)\b|no models? match|model[^\n]{0,80}(?:not found|unavailable)|rate[ -]?limit|overload|(?:service|provider) unavailable|temporarily unavailable|internal server error|gateway timeout|connection (?:reset|refused)|network error|fetch failed|client[_ -]?gone|context cancel(?:ed|led)|scanner[_ -]?error|unexpected eof|request (?:timed out|timeout)|unauthorized|invalid api key)/i;
const MACHINE_ERROR_PREFIX = "[error]";

const PI_CORE_ACTIVITY_EVENTS = new Set([
  "turn_start",
  "turn_end",
  "message_start",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

const PI_SESSION_ACTIVITY_EVENTS = new Set([
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
]);

const PI_MESSAGE_ACTIVITY_EVENTS = new Set([
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDelegateOutcome(report: string): "completed" | "blocked" | "failed" | undefined {
  const markers = [...report.matchAll(RESULT_LINE_PATTERN)];
  if (markers.length !== 1) return undefined;
  const match = RESULT_PATTERN.exec(report.trimEnd());
  return match?.[1]?.toLowerCase() as "completed" | "blocked" | "failed" | undefined;
}

export function routeUnavailableError(value: unknown): boolean {
  return typeof value === "string" && ROUTE_UNAVAILABLE_PATTERN.test(value);
}

export function machineErrorEnvelope(report: string): boolean {
  const stripped = report.trim();
  if (stripped.includes("\n") || stripped.includes("\r")) return false;
  if (!stripped.startsWith(MACHINE_ERROR_PREFIX)) return false;
  return routeUnavailableError(stripped.slice(MACHINE_ERROR_PREFIX.length).trimStart());
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

export class PiJsonMonitor {
  private phaseValue = "starting";
  private lastEventValue = "process_start";
  private lastEventDetailValue: string | undefined;
  private lastEventAtValue: string;
  private lastActivityValue: number;
  private activityEventCountValue = 0;
  private warningCountValue = 0;
  private finalReportValue: string | undefined;
  private outcomeValue: "completed" | "blocked" | "failed" | undefined;
  private sessionSeenValue = false;
  private agentRunningValue = false;
  private agentStartCountValue = 0;
  private agentEndCountValue = 0;
  private agentEndSeenValue = false;
  private agentSettledSeenValue = false;
  private toolExecutionCountValue = 0;
  private routeUnavailableSeenValue = false;
  private readonly errorsValue: string[] = [];
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

  consumeLine(line: string): void {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (error) {
      this.errorsValue.push(`Invalid Pi JSON event: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!isRecord(event)) {
      this.errorsValue.push("Pi JSON event must be an object");
      return;
    }

    const eventType = event.type;
    if (eventType === "session") {
      if (this.sessionSeenValue || this.activityEventCountValue > 0) {
        this.errorsValue.push("Pi JSON session event must appear exactly once first");
        return;
      }
      this.sessionSeenValue = true;
      this.recordActivity("session", "starting");
      return;
    }
    if (!this.sessionSeenValue) {
      this.errorsValue.push("Pi JSON activity appeared before the session event");
      return;
    }
    if (typeof eventType !== "string") return;

    if (eventType === "agent_start") {
      if (this.agentRunningValue || this.agentEndSeenValue) {
        this.errorsValue.push("Pi JSON agent_start lifecycle is invalid");
        return;
      }
      this.agentRunningValue = true;
      this.agentStartCountValue += 1;
    } else if (eventType === "agent_end") {
      if (!this.agentRunningValue) {
        this.errorsValue.push("Pi JSON agent_end lifecycle is invalid");
        return;
      }
      this.agentRunningValue = false;
      this.agentEndCountValue += 1;
      this.agentEndSeenValue = event.willRetry !== true;
    } else if (eventType === "agent_settled") {
      if (!this.agentEndSeenValue || this.agentRunningValue) {
        this.errorsValue.push("Pi JSON agent_settled appeared before final agent_end");
        return;
      }
      this.agentSettledSeenValue = true;
    } else if (PI_CORE_ACTIVITY_EVENTS.has(eventType) && !this.agentRunningValue) {
      this.errorsValue.push(`Pi JSON ${eventType} is outside the agent lifecycle`);
      return;
    }

    if (eventType === "message_update") {
      if (!this.agentRunningValue) {
        this.errorsValue.push("Pi JSON message_update is outside the agent lifecycle");
        return;
      }
      const update = event.assistantMessageEvent;
      if (!isRecord(update)) {
        this.errorsValue.push("message_update lacks assistantMessageEvent");
        return;
      }
      const updateType = update.type;
      if (typeof updateType !== "string" || !PI_MESSAGE_ACTIVITY_EVENTS.has(updateType)) return;
      if (updateType === "error") {
        this.routeUnavailableSeenValue ||= routeUnavailableError(update.errorMessage ?? update.error);
      }
      if (updateType.endsWith("_delta") && !update.delta) return;
      let phase = updateType.startsWith("thinking_") ? "thinking" : "responding";
      if (updateType.startsWith("toolcall_")) phase = "tool_selection";
      this.recordActivity(updateType, phase);
      return;
    }

    if (!PI_CORE_ACTIVITY_EVENTS.has(eventType) && !PI_SESSION_ACTIVITY_EVENTS.has(eventType)) return;
    if (eventType === "bash_execution_update" && !event.delta) return;
    if (eventType === "tool_execution_start") this.toolExecutionCountValue += 1;
    if (eventType === "auto_retry_start") {
      this.routeUnavailableSeenValue ||= routeUnavailableError(event.errorMessage);
    } else if (eventType === "auto_retry_end") {
      this.routeUnavailableSeenValue ||= routeUnavailableError(event.finalError);
    }

    let phase = this.phaseValue;
    if (eventType === "agent_start" || eventType === "turn_start" || eventType === "message_start") phase = "provider";
    else if (eventType.startsWith("tool_execution_") || eventType === "bash_execution_update") phase = "tool";
    else if (eventType === "turn_end" || eventType === "message_end") phase = "turn_complete";
    else if (eventType === "auto_retry_start" || eventType === "auto_retry_end") phase = "retry";
    else if (eventType.startsWith("compaction_") || eventType.startsWith("summarization_retry_")) phase = "compaction";
    else if (eventType === "agent_end" || eventType === "agent_settled") phase = "complete";

    const detail = eventType.startsWith("tool_execution_") && typeof event.toolName === "string"
      ? event.toolName
      : undefined;
    this.recordActivity(eventType, phase, detail);

    if (eventType === "message_end") {
      const message = event.message;
      if (isRecord(message)) this.routeUnavailableSeenValue ||= routeUnavailableError(message.errorMessage);
      const report = assistantText(message);
      if (report !== undefined) {
        this.finalReportValue = report;
        this.outcomeValue = parseDelegateOutcome(report);
        if (this.outcomeValue === undefined) {
          this.routeUnavailableSeenValue ||= machineErrorEnvelope(report);
        }
      }
    }
  }

  finish(hasPartialLine: boolean): void {
    if (hasPartialLine) this.errorsValue.push("Pi JSON stream ended with a partial line");
  }

  issueIdleWarning(): void {
    this.warningCountValue += 1;
  }

  snapshot(): MonitorSnapshot {
    return {
      phase: this.phaseValue,
      lastEvent: this.lastEventValue,
      lastEventDetail: this.lastEventDetailValue,
      lastEventAt: this.lastEventAtValue,
      lastActivityMonotonic: this.lastActivityValue,
      activityEventCount: this.activityEventCountValue,
      warningCount: this.warningCountValue,
      finalReport: this.finalReportValue,
      outcome: this.outcomeValue,
      sessionSeen: this.sessionSeenValue,
      agentRunning: this.agentRunningValue,
      agentStartCount: this.agentStartCountValue,
      agentEndCount: this.agentEndCountValue,
      agentEndSeen: this.agentEndSeenValue,
      agentSettledSeen: this.agentSettledSeenValue,
      toolExecutionCount: this.toolExecutionCountValue,
      routeUnavailableSeen: this.routeUnavailableSeenValue,
      errors: [...this.errorsValue],
    };
  }

  private recordActivity(eventName: string, phase: string, detail?: string): void {
    this.lastActivityValue = this.monotonicNow();
    this.lastEventValue = eventName;
    this.lastEventDetailValue = detail;
    this.lastEventAtValue = this.wallNow();
    this.phaseValue = phase;
    this.activityEventCountValue += 1;
    this.onActivity?.();
  }
}
