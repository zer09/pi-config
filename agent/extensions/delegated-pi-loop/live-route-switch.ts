import type { ControlCommand, ControlModel, ControlResult, ControlState } from "./protocol.ts";
import { THINKING_LEVELS } from "./types.ts";
import type { PiRoute, ThinkingLevel } from "./types.ts";

export const LIVE_ROUTE_SWITCH_FAILURE_CATEGORIES = Object.freeze([
  "invalid_input",
  "invalid_transition",
  "invalid_result",
  "command_rejected",
  "not_idle",
  "route_mismatch",
] as const);

export type LiveRouteSwitchFailureCategory = (typeof LIVE_ROUTE_SWITCH_FAILURE_CATEGORIES)[number];

export interface LiveRouteSwitchAction {
  readonly status: "command";
  readonly id: string;
  readonly command: ControlCommand;
}

export type LiveRouteSwitchTerminal =
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly category: LiveRouteSwitchFailureCategory };

export type LiveRouteSwitchUpdate = LiveRouteSwitchAction | LiveRouteSwitchTerminal;

// Read only own data fields. Reject extras and accessors instead of keeping raw RPC data or invoking getters.
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    if (Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (!required.every((key) => keys.includes(key))) return undefined;
    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string" || (!required.includes(key) && !optional.includes(key))) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return undefined;
  }
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

function model(value: unknown): ControlModel | undefined {
  const data = record(value, ["provider", "id"]);
  if (data === undefined) return undefined;
  const { provider, id } = data;
  // Match protocol.ts's bounded transport grammar, not routing policy or model capabilities.
  // @ and ~ are valid model namespace prefixes, but user@host and URLs are not model IDs.
  if (typeof provider !== "string" || provider.length > 512 || provider.trim() !== provider
    || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(provider) || provider.includes("://")
    || typeof id !== "string" || id.length > 512 || id.trim() !== id
    || !/^[@~]?[A-Za-z0-9](?:[A-Za-z0-9._:/+-]|\/[@~](?=[A-Za-z0-9]))*$/.test(id) || id.includes("://")) return undefined;
  return { provider, id };
}

function route(value: unknown): PiRoute | undefined {
  const data = record(value, ["kind", "provider", "model", "thinking"]);
  if (data === undefined || data.kind !== "pi" || !isThinkingLevel(data.thinking)) return undefined;
  const identity = model({ provider: data.provider, id: data.model });
  if (identity === undefined) return undefined;
  return { kind: "pi", provider: identity.provider, model: identity.id, thinking: data.thinking };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function controlState(value: unknown): ControlState | undefined {
  const data = record(value, ["model", "thinkingLevel", "isStreaming", "isCompacting", "messageCount", "pendingMessageCount"]);
  if (data === undefined) return undefined;
  const identity = data.model === null ? null : model(data.model);
  if (identity === undefined || !isThinkingLevel(data.thinkingLevel)
    || typeof data.isStreaming !== "boolean" || typeof data.isCompacting !== "boolean"
    || !isCount(data.messageCount) || !isCount(data.pendingMessageCount)) return undefined;
  return {
    model: identity,
    thinkingLevel: data.thinkingLevel,
    isStreaming: data.isStreaming,
    isCompacting: data.isCompacting,
    messageCount: data.messageCount,
    pendingMessageCount: data.pendingMessageCount,
  };
}

/** One pure, non-retrying switch per process-unique fallback ordinal supplied by the supervisor. */
export class LiveRouteSwitch {
  private readonly input: { ordinal: number; current: PiRoute; next: PiRoute } | undefined;
  private step = 0;
  private pending: LiveRouteSwitchAction | undefined;
  private terminal: LiveRouteSwitchTerminal | undefined;

  constructor(routeOrdinal: number, current: PiRoute, next: PiRoute) {
    if (!Number.isSafeInteger(routeOrdinal) || routeOrdinal <= 1) {
      this.fail("invalid_input");
      return;
    }
    const currentRoute = route(current);
    const nextRoute = route(next);
    if (currentRoute === undefined || nextRoute === undefined) {
      this.fail("invalid_input");
      return;
    }
    // Copy validated identities so caller mutation cannot change a switch already in progress.
    this.input = { ordinal: routeOrdinal, current: currentRoute, next: nextRoute };
  }

  get state(): "ready" | "switching" | "completed" | "failed" {
    if (this.terminal !== undefined) return this.terminal.status;
    return this.step === 0 ? "ready" : "switching";
  }

  start(): LiveRouteSwitchUpdate {
    if (this.terminal !== undefined) return this.rejectTerminalCall();
    if (this.step !== 0) return this.fail("invalid_transition");
    return this.issue({ type: "get_state" });
  }

  consume(result: ControlResult): LiveRouteSwitchUpdate {
    if (this.terminal !== undefined) return this.rejectTerminalCall();
    const pending = this.pending;
    if (pending === undefined) return this.fail("invalid_transition");
    // Spend this callback before inspecting data so duplicate or reentrant calls cannot advance twice.
    this.pending = undefined;
    const data = record(result, ["id", "command", "success"], ["data", "category"]);
    if (data === undefined || data.id !== pending.id || data.command !== pending.command.type
      || typeof data.success !== "boolean") return this.fail("invalid_result");
    if (!data.success) {
      if (Object.hasOwn(data, "data") || data.category !== "command_rejected") return this.fail("invalid_result");
      return this.fail("command_rejected");
    }
    if (Object.hasOwn(data, "category")) return this.fail("invalid_result");

    if (pending.command.type === "set_thinking_level") {
      if (Object.hasOwn(data, "data")) return this.fail("invalid_result");
      // Pi can clamp thinking levels. The acknowledgement alone is not proof of the new route.
      return this.issue({ type: "get_state" });
    }
    if (pending.command.type === "set_model") {
      const identity = model(data.data);
      if (identity === undefined) return this.fail("invalid_result");
      if (identity.provider !== this.input!.next.provider || identity.id !== this.input!.next.model) {
        return this.fail("route_mismatch");
      }
      return this.issue({ type: "set_thinking_level", level: this.input!.next.thinking });
    }

    const state = controlState(data.data);
    if (state === undefined) return this.fail("invalid_result");
    if (state.isStreaming || state.isCompacting || state.pendingMessageCount !== 0) return this.fail("not_idle");
    const expected = this.step === 1 ? this.input!.current : this.input!.next;
    if (state.model === null || state.model.provider !== expected.provider || state.model.id !== expected.model
      || state.thinkingLevel !== expected.thinking) return this.fail("route_mismatch");
    if (this.step === 1) {
      return this.issue({ type: "set_model", provider: this.input!.next.provider, modelId: this.input!.next.model });
    }
    if (this.terminal !== undefined) return this.rejectTerminalCall();
    this.terminal = Object.freeze({ status: "completed" });
    return this.terminal;
  }

  private issue(command: ControlCommand): LiveRouteSwitchUpdate {
    if (this.terminal !== undefined) return this.rejectTerminalCall();
    this.step += 1;
    // Safe ordinals keep IDs at most 31 characters. The switch suffix never occupies route-N:prompt-1/2.
    this.pending = Object.freeze({
      status: "command",
      id: `route-${this.input!.ordinal}:switch-${this.step}`,
      command: Object.freeze(command),
    });
    return this.pending;
  }

  private fail(category: LiveRouteSwitchFailureCategory): LiveRouteSwitchTerminal {
    if (this.terminal !== undefined) return this.rejectTerminalCall();
    this.pending = undefined;
    this.terminal = Object.freeze({ status: "failed", category });
    return this.terminal;
  }

  private rejectTerminalCall(): LiveRouteSwitchTerminal {
    // Terminal states never change. Late calls return failure without inspecting or retaining their arguments.
    if (this.terminal!.status === "failed") return this.terminal!;
    return Object.freeze({ status: "failed", category: "invalid_transition" });
  }
}
