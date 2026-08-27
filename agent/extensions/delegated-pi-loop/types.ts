import type { Component } from "@earendil-works/pi-tui";
import type { RoutingConfig } from "./routing.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * Delegate role id, for example "solution-a" or "oracle". The concrete set
 * is no longer a compile-time union: it derives from the validated routing
 * snapshot (the ordered solution/review assignment arrays plus the four
 * singleton families), and every runtime decision resolves the id through
 * the normalized role registry in `routing.ts` instead of prefix inference.
 */
export type DelegateRole = string;
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

/**
 * The one exact runtime allowlist of provider-failure categories. Every
 * diagnostic, sanitized-progress, ToolResult, and rendered surface must
 * fail closed by omitting any category value not in this list.
 */
export const PROVIDER_FAILURE_CATEGORIES = [
  "credits_exhausted",
  "quota_exhausted",
  "billing_limit",
  "usage_limit",
  "authentication",
  "rate_limit",
  "provider_unavailable",
] as const;

export type ProviderFailureCategory = (typeof PROVIDER_FAILURE_CATEGORIES)[number];

/** Runtime membership check shared by every fail-closed category surface. */
export const PROVIDER_FAILURE_CATEGORY_SET: ReadonlySet<string> = new Set(PROVIDER_FAILURE_CATEGORIES);

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

/** Fixed cause codes for the remaining bounded deadline stops. */
export type DeadlineCause = "idle_deadline" | "catalog_preflight";

/** Fixed mechanism codes for a liveness stall. */
export type StallCause =
  | "rpc_silent"
  | "activity_idle"
  | "active_tool_idle"
  | "progress_stagnation"
  | "repeated_cycle"
  | "report_recovery_idle";

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
  /** Accepted-activity idle age; total elapsed time never terminates a run. */
  readonly activityIdleSeconds: number;
  readonly elapsedSeconds: number;
  readonly toolExecutionCount: number;
  readonly activityWarningCount: number;
  readonly progressWarningCount: number;
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
  readonly stallCause?: StallCause;
  readonly cleanupFailureReason?: CleanupFailureReason;
  readonly interruptionSource?: InterruptionSource;
  /** Fixed bounded lease-warning label; one label at most is active at a time. */
  readonly leaseWarning?: "activity" | "progress";
  readonly rpcIdleSeconds?: number;
  readonly progressIdleSeconds?: number;
  readonly activityEventCount: number;
  readonly structuralProgressCount: number;
  readonly duplicateCheckpointCount: number;
  readonly activeToolCount?: number;
  readonly activeToolName?: string;
  readonly activeToolElapsedSeconds?: number;
  readonly activeToolIdleSeconds?: number;
}

export interface MonitorSnapshot {
  readonly phase: string;
  readonly lastEvent: string;
  readonly lastEventDetail?: string;
  readonly lastEventAt: string;
  readonly lastValidRpcMonotonic: number;
  readonly lastActivityMonotonic: number;
  readonly lastStructuralProgressMonotonic: number;
  readonly activityEventCount: number;
  readonly structuralProgressCount: number;
  readonly duplicateCheckpointCount: number;
  /** Duplicate checkpoints observed since the last novel checkpoint; drives the repeated-cycle cause. */
  readonly duplicateCheckpointsSinceNovel: number;
  readonly activityWarningCount: number;
  readonly progressWarningCount: number;
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
  readonly activeToolIdleSeconds?: number;
  readonly activeToolLastNovelUpdateMonotonic?: number;
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
  readonly stallCause?: StallCause;
  readonly cleanupFailureReason?: CleanupFailureReason;
  readonly interruptionSource?: InterruptionSource;
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
  readonly structuralProgressCount: number;
  readonly duplicateCheckpointCount: number;
  readonly lastEvent: string;
  readonly lastEventDetail?: string;
  readonly lastEventAt: string;
  readonly phase: string;
  readonly activityIdleSeconds: number;
  readonly rpcIdleSeconds: number;
  readonly progressIdleSeconds: number;
  readonly activityWarningCount: number;
  readonly progressWarningCount: number;
  readonly sessionSeen: boolean;
  readonly agentStartCount: number;
  readonly agentEndCount: number;
  readonly agentEndSeen: boolean;
  readonly agentSettledSeen: boolean;
  readonly toolExecutionCount: number;
  readonly activeToolCount: number;
  readonly activeToolName?: string;
  readonly activeToolElapsedSeconds?: number;
  readonly activeToolIdleSeconds?: number;
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
  readonly stallCause?: StallCause;
  /**
   * Supervised liveness evidence settled at attempt end (plan §13.2):
   * every field that has a value at settlement travels on the attempt, so
   * prior-route liveness evidence survives fallback. Catalog-only attempts
   * omit these fields entirely.
   */
  readonly rpcIdleSeconds?: number;
  readonly activityIdleSeconds?: number;
  readonly progressIdleSeconds?: number;
  readonly activityEventCount?: number;
  readonly structuralProgressCount?: number;
  readonly duplicateCheckpointCount?: number;
  readonly activityWarningCount?: number;
  readonly progressWarningCount?: number;
  readonly cleanupFailureReason?: CleanupFailureReason;
  readonly interruptionSource?: InterruptionSource;
  readonly activeToolCount?: number;
  readonly activeToolName?: string;
  readonly activeToolElapsedSeconds?: number;
  /** Idle age of the stalest active tool's last novel update at attempt end; absent when no tool was active. */
  readonly activeToolIdleSeconds?: number;
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
  readonly stallCause?: StallCause;
  readonly cleanupFailureReason?: CleanupFailureReason;
  readonly interruptionSource?: InterruptionSource;
}

export interface DelegateToolParams {
  readonly role: DelegateRole;
  readonly prompt: string;
  readonly routingOverride?: RoutingOverride;
  readonly cwd?: string;
  /** Orchestrator-selected pre-approved skill names made discoverable to this delegated child. */
  readonly availableSkills?: readonly string[];
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
  /** Parent session's currently selected model id, from native extension context; drives Oracle self-review prevention. */
  readonly parentModelId?: string;
  /** Deterministic injection point for random primary selection inside multi-provider tiers. */
  readonly random?: () => number;
  readonly onProgress?: (progress: DelegateProgress) => void;
  /** Internal test seam for the five-minute accepted-activity warning. */
  readonly activityWarningMs?: number;
  /** Internal test seam for the ten-minute accepted-activity idle lease. */
  readonly activityIdleMs?: number;
  /** Internal test seam for the thirty-minute structural-progress warning. */
  readonly progressWarningMs?: number;
  /** Internal test seam for the renewable 45-minute structural-progress lease. */
  readonly progressStallMs?: number;
  /** Internal test seam for the five-minute report-recovery idle lease. */
  readonly reportRecoveryIdleMs?: number;
  readonly maxOutputBytes?: number;
  /** Internal test seam for the fixed five-second SIGTERM grace. */
  readonly graceMs?: number;
  /** Internal test seam for the fixed ten-second cleanup allowance. */
  readonly cleanupTimeoutMs?: number;
  /** Internal test seam for the fixed 15-second catalog preflight cap. */
  readonly catalogTimeoutMs?: number;
  readonly piInvocation?: PiInvocation;
  /** Optional pre-validated routing config: the registration snapshot injected by the tool, or a deterministic test seam for alternate assignments. */
  readonly routingConfig?: RoutingConfig;
  /**
   * Prebuilt immutable child resource selection from `resources.ts`; covers
   * every attempt and recovery round of this invocation.
   */
  readonly resourceSelection?: DelegateResourceSelection;
  /**
   * Optional pre-validated resource policy; deterministic injection point so
   * tests can exercise alternate profiles. Used only when no prebuilt
   * selection is provided; the selection is then built (and its paths
   * rechecked) before any private artifact exists.
   */
  readonly resourcePolicy?: ResolvedDelegateResources;
}

export interface PiInvocation {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

/**
 * Canonical containment roots every resolved resource-policy path must
 * stay inside. Derived from the policy file location by `resources.ts`;
 * owned by the resource policy, never by routing.
 */
export interface ContainmentRoots {
  /** Canonical `agent/extensions` root derived from the policy file location. */
  readonly extensionsRoot: string;
  /** Canonical `agent/skills` root derived from the policy file location. */
  readonly skillsRoot: string;
  /** Canonical directory containing the policy file (an extension directory). */
  readonly policyDir: string;
}

/**
 * Immutable, strictly validated delegated child resource policy resolved
 * from `resources.json`. Extension paths are canonical absolute entry files;
 * skill paths are canonical absolute directories containing a regular
 * `SKILL.md`. `roots` carries the canonical containment roots so every
 * pre-spawn re-verification can recheck containment without re-deriving the
 * policy location. Owned by `resources.ts`; routing-policy concepts stay
 * in `routing.ts`.
 */
export interface ResolvedDelegateResources {
  readonly catalogExtensions: readonly string[];
  readonly runtimeExtensions: readonly string[];
  readonly allowedSkills: ReadonlyMap<string, string>;
  readonly excludedSkills: ReadonlySet<string>;
  readonly roots: ContainmentRoots;
}

/**
 * One immutable prebuilt child resource argument set for a complete
 * delegate invocation. The runner reuses these exact arrays for every
 * sequential route attempt, catalog preflight, and report-recovery round,
 * so the child resource profile never changes during provider fallback.
 * The verification closures re-resolve canonical identity, containment,
 * and regular-file/directory/`SKILL.md` invariants immediately before every
 * catalog or runtime spawn, including fallback attempts, so a
 * post-validation symlink swap of an approved extension entry or selected
 * skill fails closed before any child command line exists.
 */
export interface DelegateResourceSelection {
  readonly catalogArgs: readonly string[];
  readonly runtimeArgs: readonly string[];
  /** Fail-closed re-verification of the catalog extension entries and every selected skill, run immediately before each catalog preflight spawn; the catalog argv itself stays alias-only. */
  readonly verifyCatalogSpawn: () => void;
  /** Fail-closed re-verification of the runtime extension entries and every selected skill, run immediately before each runtime child spawn. */
  readonly verifyRuntimeSpawn: () => void;
}
