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

export const DELEGATE_BACKENDS = ["default", "zai", "claude"] as const;

export type DelegateRole = (typeof DELEGATE_ROLES)[number];
export type DelegateBackend = (typeof DELEGATE_BACKENDS)[number];
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type DelegateProtocol = "pi-json" | "plain";

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

export interface ClaudeRoute {
  readonly kind: "claude";
  readonly model: "claude-opus-5";
  readonly effort: "medium";
}

export type DelegateRoute = PiRoute | ClaudeRoute;

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

export interface ExtensionContext {
  readonly cwd: string;
  readonly mode?: string;
  readonly hasUI?: boolean;
  /** Parent session's active model; supplies the selected provider and model id. */
  readonly model?: { readonly provider: string; readonly id?: string };
  readonly ui?: {
    setWidget(
      id: string,
      value: string[] | undefined,
      options?: { readonly placement?: "aboveEditor" | "belowEditor" },
    ): void;
  };
}

export interface ToolRenderContext {
  readonly lastComponent?: unknown;
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
