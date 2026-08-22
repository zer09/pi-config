import type { Component } from "@earendil-works/pi-tui";

export const DELEGATE_ROLES = [
  "solution-a",
  "solution-b",
  "solution-c",
  "solution-d",
  "oracle",
  "implementation",
  "review-a",
  "review-b",
  "review-c",
  "review-d",
  "verification",
  "remediation",
] as const;

export const DELEGATE_BACKENDS = ["default", "zai"] as const;

export type DelegateRole = (typeof DELEGATE_ROLES)[number];
export type DelegateBackend = (typeof DELEGATE_BACKENDS)[number];
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type DelegateProtocol = "pi-rpc";
export type ProviderFailureCategory =
  | "credits_exhausted"
  | "quota_exhausted"
  | "billing_limit"
  | "usage_limit"
  | "authentication"
  | "rate_limit"
  | "provider_unavailable";

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
  readonly reportNudgeCount: 0 | 1;
  readonly reportRecoveryReason?: "missing_report" | "invalid_result";
  readonly reportRound: 1 | 2;
  readonly providerFailureCategory?: ProviderFailureCategory;
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
  readonly sessionSeen: boolean;
  readonly agentRunning: boolean;
  readonly agentStartCount: number;
  readonly agentEndCount: number;
  readonly agentEndSeen: boolean;
  readonly agentSettledSeen: boolean;
  readonly toolExecutionCount: number;
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
  readonly delegateOutcome?: "completed" | "blocked" | "failed";
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
  readonly fallbackReason?: "event_idle_before_tools" | "provider_unavailable_before_tools";
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
  readonly backend: DelegateBackend;
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
}

export interface DelegateToolParams {
  readonly role: DelegateRole;
  readonly prompt: string;
  readonly backend?: DelegateBackend;
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
  readonly backend: DelegateBackend;
  readonly prompt: string;
  readonly cwd: string;
  readonly signal?: AbortSignal;
  /** Parent session's currently selected provider, from native extension context. */
  readonly parentProvider?: string;
  /** Parent session's currently selected model id, from native extension context. */
  readonly parentModelId?: string;
  /** Deterministic injection point for the D and oracle random primary selection. */
  readonly random?: () => number;
  readonly onProgress?: (progress: DelegateProgress) => void;
  readonly timeoutMs?: number;
  readonly idleWarningMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly graceMs?: number;
  readonly piInvocation?: PiInvocation;
}

export interface PiInvocation {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}
