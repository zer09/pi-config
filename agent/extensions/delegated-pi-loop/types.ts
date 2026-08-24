import type { Component } from "@earendil-works/pi-tui";
import type { RoutingConfig } from "./routing.ts";

export const DELEGATE_ROLES = [
  "solution-a",
  "solution-b",
  "solution-c",
  "solution-d",
  "solution-e",
  "oracle",
  "implementation",
  "review-a",
  "review-b",
  "review-c",
  "review-d",
  "verification",
  "remediation",
] as const;

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type DelegateRole = (typeof DELEGATE_ROLES)[number];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Exceptional one-run routing change. Routing is automatic from the
 * extension-owned routing configuration; an override is valid only for an
 * explicit user or project operational request, never for the oracle role.
 * An override never changes role permissions or concurrency.
 */
export interface RoutingOverride {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly excludeProviders?: readonly string[];
  readonly reason: string;
}
export type DelegateProtocol = "pi-rpc";
export type ProviderFailureCategory =
  | "credits_exhausted"
  | "quota_exhausted"
  | "billing_limit"
  | "usage_limit"
  | "authentication"
  | "rate_limit"
  | "provider_unavailable";

/** Closed terminal reason enum for BLOCKED delegate outcomes. */
export const BLOCKED_REASON_CODES = [
  "evidence_inaccessible",
  "user_decision_required",
  "assignment_conflict",
  "policy_restriction",
  "budget_exhausted",
  "external_dependency",
  "finding_reported",
] as const;

/** Closed terminal reason enum for FAILED delegate outcomes. */
export const FAILED_REASON_CODES = [
  "execution_failure",
  "verification_failure",
  "internal_inconsistency",
  "policy_violation",
] as const;

export type BlockedReasonCode = (typeof BLOCKED_REASON_CODES)[number];
export type FailedReasonCode = (typeof FAILED_REASON_CODES)[number];
export type DelegateReasonCode = BlockedReasonCode | FailedReasonCode;

/** Internal value exposed when a non-completed reason is absent or was discarded. */
export const DELEGATE_REASON_UNSPECIFIED = "unspecified" as const;
export type DelegateReasonUnspecified = typeof DELEGATE_REASON_UNSPECIFIED;

/** Acceptance state of a non-completed terminal reason line. */
export type DelegateReasonStatus = "accepted" | "missing" | "rejected";

/** Bounded terminal reason value: one closed code or the internal unspecified value. */
export type DelegateTerminalReasonValue = DelegateReasonCode | DelegateReasonUnspecified;

export type DelegateOutcome = "completed" | "blocked" | "failed";

/** Fixed cause codes for productive-work and idle deadline stops. */
export type DeadlineCause = "work_deadline" | "idle_deadline" | "catalog_preflight";

/** Fixed positive-proof failure from process-group cleanup. */
export type CleanupFailureReason = "group_alive" | "close_unconfirmed";

/** Fixed source of the first accepted interruption. */
export type InterruptionSource =
  | "delegate_stop"
  | "session_shutdown"
  | "tool_call_abort"
  | "unknown";

export type DelegateState =
  | "catalog_check"
  | "running"
  | "completed"
  | "routes_unavailable"
  | "stalled"
  | "timed_out"
  | "output_limit"
  | "blocked"
  | "delegate_failed"
  | "provider_failed"
  | "prompt_rejected"
  | "invalid_result"
  | "invalid_stream"
  | "missing_report"
  | "child_failed"
  | "spawn_failed"
  | "cleanup_failed"
  | "interrupted";

export interface PiRoute {
  readonly kind: "pi";
  readonly provider: string;
  readonly model: string;
  readonly thinking: ThinkingLevel;
}

export type DelegateRoute = PiRoute;

export interface DelegateProgress {
  readonly label: string;
  readonly role: DelegateRole;
  readonly state: DelegateState;
  readonly protocol: DelegateProtocol;
  readonly route?: string;
  readonly attempt: number;
  readonly phase: string;
  readonly lastEvent: string;
  readonly lastEventDetail?: string;
  readonly lastEventAt: string;
  readonly idleSeconds: number;
  readonly elapsedSeconds: number;
  readonly toolExecutionCount: number;
  readonly idleWarningCount: number;
  /** How many times the chain advanced after an attempt that had executed tools or accepted report recovery. */
  readonly restartAfterWorkCount: number;
  readonly reportNudgeCount: 0 | 1;
  readonly reportRecoveryReason?: "missing_report" | "invalid_result";
  readonly reportRound: 1 | 2;
  readonly providerFailureCategory?: ProviderFailureCategory;
  readonly delegateOutcome?: DelegateOutcome;
  readonly terminalReason?: DelegateTerminalReasonValue;
  readonly reasonStatus?: DelegateReasonStatus;
  /** True only when outcome is BLOCKED with accepted reason finding_reported; never inferred from role. */
  readonly blockedMisuseSuspected?: boolean;
  readonly deadlineCause?: DeadlineCause;
  readonly cleanupFailureReason?: CleanupFailureReason;
  readonly interruptionSource?: InterruptionSource;
  readonly workBudgetSeconds?: number;
  readonly remainingWorkSecondsAtAttemptStart?: number;
  readonly activeToolCount?: number;
  readonly activeToolName?: string;
  readonly activeToolElapsedSeconds?: number;
}

export interface MonitorSnapshot {
  readonly phase: string;
  readonly lastEvent: string;
  readonly lastEventDetail?: string;
  readonly lastEventAt: string;
  readonly lastActivityMonotonic: number;
  readonly activityEventCount: number;
  readonly warningCount: number;
  readonly finalReport?: string;
  readonly outcome?: "completed" | "blocked" | "failed";
  readonly terminalReason?: DelegateTerminalReasonValue;
  readonly reasonStatus?: DelegateReasonStatus;
  readonly blockedMisuseSuspected?: boolean;
  readonly sessionSeen: boolean;
  readonly agentRunning: boolean;
  readonly agentStartCount: number;
  readonly agentEndCount: number;
  readonly agentEndSeen: boolean;
  readonly agentSettledSeen: boolean;
  readonly toolExecutionCount: number;
  readonly activeToolCount: number;
  readonly activeToolName?: string;
  readonly activeToolElapsedSeconds?: number;
  readonly routeUnavailableSeen: boolean;
  readonly providerFailureCategory?: ProviderFailureCategory;
  readonly reportRound: 1 | 2;
  readonly errors: readonly string[];
}

export interface AttemptStatus {
  readonly schemaVersion: 1;
  readonly label: string;
  readonly role: DelegateRole;
  readonly route: string;
  readonly protocol: DelegateProtocol;
  readonly state: DelegateState;
  readonly delegateOutcome?: DelegateOutcome;
  readonly terminalReason?: DelegateTerminalReasonValue;
  readonly reasonStatus?: DelegateReasonStatus;
  readonly blockedMisuseSuspected?: boolean;
  readonly deadlineCause?: DeadlineCause;
  readonly cleanupFailureReason?: CleanupFailureReason;
  readonly interruptionSource?: InterruptionSource;
  readonly workBudgetSeconds: number;
  readonly remainingWorkSecondsAtAttemptStart: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly elapsedSeconds: number;
  readonly exitCode: number | null;
  readonly completionCleanupPerformed: boolean;
  readonly outputBytes: number;
  readonly reportPresent: boolean;
  readonly reportPath: string;
  readonly stderrPath: string;
  readonly activityEventCount: number;
  readonly lastEvent: string;
  readonly lastEventDetail?: string;
  readonly lastEventAt: string;
  readonly phase: string;
  readonly idleSeconds: number;
  readonly idleWarningCount: number;
  readonly sessionSeen: boolean;
  readonly agentStartCount: number;
  readonly agentEndCount: number;
  readonly agentEndSeen: boolean;
  readonly agentSettledSeen: boolean;
  readonly toolExecutionCount: number;
  readonly activeToolCount: number;
  readonly activeToolName?: string;
  readonly activeToolElapsedSeconds?: number;
  readonly routeUnavailableSeen: boolean;
  readonly providerFailureCategory?: ProviderFailureCategory;
  readonly reportNudgeCount: 0 | 1;
  readonly reportRecoveryReason?: "missing_report" | "invalid_result";
  readonly reportRound: 1 | 2;
  readonly reportRecoveryAccepted: boolean;
  readonly streamErrors: readonly string[];
}

export interface ChainAttempt {
  readonly route: string;
  readonly state: DelegateState | "catalog_unavailable";
  readonly elapsedSeconds: number;
  readonly deadlineCause?: DeadlineCause;
  readonly cleanupFailureReason?: CleanupFailureReason;
  readonly interruptionSource?: InterruptionSource;
  readonly remainingWorkSecondsAtAttemptStart?: number;
  readonly activeToolCount?: number;
  readonly activeToolName?: string;
  readonly activeToolElapsedSeconds?: number;
  /** True when this attempt had executed tools or accepted recovery, so the next attempt received the restart note. */
  readonly restartAfterWork?: boolean;
}

/**
 * In-memory chain outcome. `artifactDir` is the caller-owned private temporary
 * supervision directory; the caller removes it after persisting any failure
 * diagnostic and assembling the tool result. All other data is in memory, so
 * no report/status file fields exist.
 */
export interface DelegateRunResult {
  readonly label: string;
  readonly role: DelegateRole;
  readonly state: DelegateState;
  readonly report: string;
  readonly artifactDir: string;
  readonly selectedRoute?: string;
  readonly attempts: readonly ChainAttempt[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly elapsedSeconds: number;
  readonly streamErrors: readonly string[];
  readonly progress: DelegateProgress;
  readonly delegateOutcome?: DelegateOutcome;
  readonly terminalReason?: DelegateTerminalReasonValue;
  readonly reasonStatus?: DelegateReasonStatus;
  readonly blockedMisuseSuspected?: boolean;
  readonly deadlineCause?: DeadlineCause;
  readonly cleanupFailureReason?: CleanupFailureReason;
  readonly interruptionSource?: InterruptionSource;
  readonly workBudgetSeconds: number;
}

export interface DelegateToolParams {
  readonly role: DelegateRole;
  readonly prompt: string;
  readonly routingOverride?: RoutingOverride;
  readonly cwd?: string;
}

export interface ToolResult {
  readonly content: Array<{ readonly type: "text"; readonly text: string }>;
  readonly details?: Record<string, unknown>;
}

export interface DelegateToolResultEvent {
  readonly type: "tool_result";
  readonly toolName: string;
  readonly toolCallId: string;
  readonly input: Record<string, unknown>;
  readonly content: readonly unknown[];
  readonly details?: unknown;
  readonly isError: boolean;
}

export type ToolUpdateHandler = (result: ToolResult) => void;

export interface ExtensionUI {
  notify(message: string, level: "info" | "warning" | "error"): void;
  select(title: string, options: string[]): Promise<string | undefined>;
  setEditorText(text: string): void;
  setWidget(
    id: string,
    value: string[] | undefined,
    options?: { readonly placement?: "aboveEditor" | "belowEditor" },
  ): void;
}

export interface ExtensionContext {
  readonly cwd: string;
  readonly mode?: string;
  readonly hasUI?: boolean;
  /** Parent session's active model; supplies the selected provider and model id. */
  readonly model?: { readonly provider: string; readonly id?: string };
  readonly ui?: ExtensionUI;
}

export interface ExtensionCommandContext extends ExtensionContext {
  readonly hasUI: boolean;
  readonly ui: ExtensionUI;
}

export interface ToolRenderContext {
  readonly lastComponent?: unknown;
  readonly toolCallId?: string;
  readonly state?: Record<string, unknown>;
}

export interface ToolDefinition<Params extends object> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet?: string;
  readonly promptGuidelines?: readonly string[];
  readonly parameters: Record<string, unknown>;
  readonly execute: (
    toolCallId: string,
    params: Params,
    signal: AbortSignal | undefined,
    onUpdate: ToolUpdateHandler | undefined,
    ctx: ExtensionContext,
  ) => Promise<ToolResult>;
  readonly renderCall?: (args: Params, theme: RenderTheme, context: ToolRenderContext) => Component;
  readonly renderResult?: (
    result: ToolResult,
    options: { readonly expanded: boolean; readonly isPartial: boolean },
    theme: RenderTheme,
    context: ToolRenderContext,
  ) => Component;
}

export interface ExtensionAPI {
  registerTool<Params extends object>(tool: ToolDefinition<Params>): void;
  registerCommand(
    name: string,
    command: {
      readonly description: string;
      readonly handler: (args: string, ctx: ExtensionCommandContext) => void | Promise<void>;
    },
  ): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
}

export interface RenderTheme {
  bold(text: string): string;
  fg(color: string, text: string): string;
}

export interface RunOptions {
  readonly role: DelegateRole;
  readonly prompt: string;
  readonly cwd: string;
  readonly signal?: AbortSignal;
  /** Optional exceptional routing override from an explicit user or project operational request. */
  readonly routingOverride?: RoutingOverride;
  /** Parent session's currently selected provider, from native extension context. */
  readonly parentProvider?: string;
  /** Parent session's currently selected model id, from native extension context. */
  readonly parentModelId?: string;
  /** Deterministic injection point for random primary selection inside multi-provider tiers. */
  readonly random?: () => number;
  readonly onProgress?: (progress: DelegateProgress) => void;
  readonly timeoutMs?: number;
  readonly idleWarningMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** Internal test seam for the fixed five-second SIGTERM grace. */
  readonly graceMs?: number;
  /** Internal test seam for the fixed ten-second cleanup allowance. */
  readonly cleanupTimeoutMs?: number;
  /** Internal test seam for the fixed 15-second catalog preflight cap. */
  readonly catalogTimeoutMs?: number;
  readonly piInvocation?: PiInvocation;
  /** Optional pre-validated routing config; deterministic injection point so tests can exercise alternate profiles. */
  readonly routingConfig?: RoutingConfig;
}

export interface PiInvocation {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}
