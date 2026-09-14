import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import { LIVE_ROUTE_SWITCH_FAILURE_CATEGORIES, LiveRouteSwitch } from "./live-route-switch.ts";
import type { LiveRouteSwitchAction, LiveRouteSwitchFailureCategory, LiveRouteSwitchUpdate } from "./live-route-switch.ts";
import type { ControlResult, ControlState } from "./protocol.ts";
import { THINKING_LEVELS } from "./types.ts";
import type { PiRoute } from "./types.ts";

const CURRENT: PiRoute = Object.freeze({ kind: "pi", provider: "openai", model: "gpt-5.4", thinking: "high" });
const NEXT: PiRoute = Object.freeze({ kind: "pi", provider: "anthropic", model: "claude-sonnet-4-6", thinking: "medium" });
const STEPS = [1, 2, 3, 4] as const;
const SENSITIVE = "REDACTED_TEST_ONLY";

function idle(route: PiRoute): ControlState {
  return {
    model: { provider: route.provider, id: route.model },
    thinkingLevel: route.thinking,
    isStreaming: false,
    isCompacting: false,
    messageCount: 10,
    pendingMessageCount: 0,
  };
}

function action(update: LiveRouteSwitchUpdate): LiveRouteSwitchAction {
  assert.ok(update.status === "command");
  return update;
}

function success(pending: LiveRouteSwitchAction, route: PiRoute): ControlResult {
  const { id, command } = pending;
  if (command.type === "get_state") return { id, command: command.type, success: true, data: idle(route) };
  if (command.type === "set_model") {
    return { id, command: command.type, success: true, data: { provider: command.provider, id: command.modelId } };
  }
  assert.equal(command.type, "set_thinking_level");
  return { id, command: "set_thinking_level", success: true };
}

function pendingAt(step: number, current = CURRENT, next = NEXT, ordinal = 2) {
  const machine = new LiveRouteSwitch(ordinal, current, next);
  let pending = action(machine.start());
  for (let index = 1; index < step; index += 1) pending = action(machine.consume(success(pending, current)));
  return { machine, pending, response: success(pending, step === 1 ? current : next) };
}

function failure(category: LiveRouteSwitchFailureCategory) {
  return { status: "failed", category } as const;
}

function assertFailed(machine: LiveRouteSwitch, result: unknown, category: LiveRouteSwitchFailureCategory) {
  assert.deepEqual(machine.consume(result as ControlResult), failure(category));
  assert.equal(machine.state, "failed");
  assert.deepEqual(machine.start(), failure(category));
  assert.deepEqual(machine.consume(null as unknown as ControlResult), failure(category));
}

function retained(machine: LiveRouteSwitch): string {
  return inspect(machine, { depth: null, showHidden: true, customInspect: false });
}

function complete(current = CURRENT, next = NEXT, ordinal = 2) {
  const machine = new LiveRouteSwitch(ordinal, current, next);
  const actions: LiveRouteSwitchAction[] = [];
  let update = machine.start();
  for (const step of STEPS) {
    const pending = action(update);
    actions.push(pending);
    update = machine.consume(success(pending, step === 1 ? current : next));
  }
  assert.deepEqual(update, { status: "completed" });
  assert.equal(machine.state, "completed");
  return { machine, actions, update };
}

test("switch requires four exactly correlated controls and a fresh post-state proof", () => {
  const machine = new LiveRouteSwitch(2, CURRENT, NEXT);
  assert.equal(machine.state, "ready");
  let update = machine.start();
  const expected = [
    { status: "command", id: "route-2:switch-1", command: { type: "get_state" } },
    { status: "command", id: "route-2:switch-2", command: { type: "set_model", provider: NEXT.provider, modelId: NEXT.model } },
    { status: "command", id: "route-2:switch-3", command: { type: "set_thinking_level", level: NEXT.thinking } },
    { status: "command", id: "route-2:switch-4", command: { type: "get_state" } },
  ];
  for (const step of STEPS) {
    assert.equal(machine.state, "switching");
    assert.deepEqual(update, expected[step - 1]);
    update = machine.consume(success(action(update), step === 1 ? CURRENT : NEXT));
  }
  assert.deepEqual(update, { status: "completed" });
  assert.equal(machine.state, "completed");
});

test("switch IDs are bounded, deterministic, distinct across ordinals, and disjoint from all prompt IDs", () => {
  const seen = new Set<string>();
  for (const ordinal of [2, 3, 10, Number.MAX_SAFE_INTEGER]) {
    const first = complete(CURRENT, NEXT, ordinal).actions;
    assert.deepEqual(complete(CURRENT, NEXT, ordinal).actions, first);
    assert.deepEqual(first.map(({ id }) => id), STEPS.map((step) => `route-${ordinal}:switch-${step}`));
    for (const { id } of first) {
      assert.ok(id.length <= 31);
      assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
      assert.doesNotMatch(id, /^(?:route-[0-9]+:)?prompt-[12]$/);
      assert.equal(seen.has(id), false);
      seen.add(id);
    }
  }
});

test("all thinking levels work, including thinking-only changes and identical routes without skipped controls", () => {
  for (const before of THINKING_LEVELS) {
    for (const after of THINKING_LEVELS) {
      const current = { ...CURRENT, thinking: before };
      const next = { ...CURRENT, thinking: after };
      const { actions } = complete(current, next);
      assert.deepEqual(actions[1].command, { type: "set_model", provider: next.provider, modelId: next.model });
      assert.deepEqual(actions[2].command, { type: "set_thinking_level", level: after });
    }
  }
});

test("exact transport identities support installed @ and ~ model namespaces without routing-policy coupling", () => {
  for (const provider of ["provider-a.b_1:region/path+v2", "p".repeat(512)]) {
    for (const model of [
      "@cf/meta/llama-3.1-8b-instruct", "~deepseek/deepseek-v3", "org/@cf/meta/llama",
      "org/~namespace/model", "us.anthropic.model-v1:0", "M_1.2/model+variant", "m".repeat(512),
    ]) {
      const current = { ...CURRENT, provider, model };
      const next = { ...NEXT, provider, model };
      const { actions } = complete(current, next);
      assert.deepEqual(actions[1].command, { type: "set_model", provider, modelId: model });
    }
  }
});

test("failure categories are one fixed, closed, immutable vocabulary", () => {
  assert.deepEqual(LIVE_ROUTE_SWITCH_FAILURE_CATEGORIES, [
    "invalid_input", "invalid_transition", "invalid_result", "command_rejected", "not_idle", "route_mismatch",
  ]);
  assert.ok(Object.isFrozen(LIVE_ROUTE_SWITCH_FAILURE_CATEGORIES));
});

test("invalid ordinals fail terminally before producing IDs or retaining inputs", () => {
  for (const ordinal of [
    undefined, null, false, true, "2", 2n, {}, [], new Number(2), NaN, Infinity, -Infinity,
    -2, -0, 0, 1, 1.5, 2.5, Number.MAX_SAFE_INTEGER + 1, SENSITIVE,
  ]) {
    const machine = new LiveRouteSwitch(ordinal as number, CURRENT, NEXT);
    assert.equal(machine.state, "failed");
    assert.deepEqual(machine.start(), failure("invalid_input"));
    assert.deepEqual(machine.consume(null as unknown as ControlResult), failure("invalid_input"));
    assert.doesNotMatch(retained(machine), /route-[0-9]+:switch|REDACTED_TEST_ONLY/);
  }
});

test("both route inputs require exact own fields, pi kind, bounded identities, and known thinking levels", () => {
  const invalid: unknown[] = [undefined, null, false, 2, "pi", [], {}, new String("pi"), { ...CURRENT, kind: "other" }];
  for (const key of Object.keys(CURRENT)) {
    const missing: Record<string, unknown> = { ...CURRENT };
    delete missing[key];
    invalid.push(missing, { ...CURRENT, [key]: undefined }, { ...CURRENT, [key]: null });
  }
  for (const thinking of ["", "High", "max ", "unknown", 1, true, [], {}]) invalid.push({ ...CURRENT, thinking });
  for (const field of ["provider", "model"]) {
    for (const value of [
      "", " ", "a b", " model", "model ", "model\n", "model\r", "model\t", "a\u2028b", "a\u0000b",
      "https://example.invalid/model", "user@host", "a?key=value", "a#fragment", "a=header", "/absolute/path",
      "-option", "é", "a".repeat(513), 0, false, [], {}, new String("model"),
    ]) invalid.push({ ...CURRENT, [field]: value });
  }
  for (const provider of ["@cf", "~provider", "org/@cf", "org/~provider"]) invalid.push({ ...CURRENT, provider });
  for (const model of ["@", "~", "@@cf/a", "~~org/a", "a@b", "a~b", "org/@", "org/~", "org/@/m", "org/~~m"]) {
    invalid.push({ ...CURRENT, model });
  }
  for (const extra of ["sessionFile", "sessionId", "tokens", "cost", "models", "error", "text"]) {
    invalid.push({ ...CURRENT, [extra]: SENSITIVE });
  }
  invalid.push(Object.create(CURRENT), Object.assign(Object.create({ secret: SENSITIVE }), CURRENT));
  invalid.push(Object.assign([], CURRENT), { ...CURRENT, [Symbol("hidden")]: SENSITIVE });
  invalid.push(Object.defineProperty({ ...CURRENT }, "hidden", { value: SENSITIVE }));
  for (const value of invalid) {
    for (const [current, next] of [[value, NEXT], [CURRENT, value]]) {
      const machine = new LiveRouteSwitch(2, current as PiRoute, next as PiRoute);
      assert.equal(machine.state, "failed");
      assert.deepEqual(machine.start(), failure("invalid_input"));
      assert.doesNotMatch(retained(machine), /REDACTED_TEST_ONLY/);
    }
  }
});

for (const step of [1, 4]) {
  test(`step ${step} rejects busy or queued state but permits any valid history count`, () => {
    for (const fields of [
      { isStreaming: true }, { isCompacting: true }, { isStreaming: true, isCompacting: true },
      { pendingMessageCount: 1 }, { pendingMessageCount: Number.MAX_SAFE_INTEGER },
    ]) {
      const { machine, pending } = pendingAt(step);
      const data = { ...idle(step === 1 ? CURRENT : NEXT), ...fields };
      assertFailed(machine, { id: pending.id, command: "get_state", success: true, data }, "not_idle");
    }
    for (const messageCount of [0, 1, Number.MAX_SAFE_INTEGER]) {
      const { machine, pending } = pendingAt(step);
      const data = { ...idle(step === 1 ? CURRENT : NEXT), messageCount };
      const update = machine.consume({ id: pending.id, command: "get_state", success: true, data });
      assert.equal(update.status, step === 1 ? "command" : "completed");
    }
  });

  test(`step ${step} requires the exact model and thinking, not just successful set acknowledgements`, () => {
    const expected = step === 1 ? CURRENT : NEXT;
    const mismatches: Record<string, unknown>[] = [
      { model: null }, { model: { provider: "other", id: expected.model } },
      { model: { provider: expected.provider.toUpperCase(), id: expected.model } },
      { model: { provider: expected.provider, id: "other" } },
      { model: { provider: expected.provider, id: expected.model.toUpperCase() } },
      ...THINKING_LEVELS.filter((level) => level !== expected.thinking).map((thinkingLevel) => ({ thinkingLevel })),
    ];
    if (step === 4) mismatches.push({ model: idle(CURRENT).model, thinkingLevel: CURRENT.thinking });
    for (const fields of mismatches) {
      const { machine, pending } = pendingAt(step);
      assertFailed(machine, {
        id: pending.id, command: "get_state", success: true, data: { ...idle(expected), ...fields },
      }, "route_mismatch");
    }
  });

  test(`step ${step} rejects every missing or malformed state field`, () => {
    const base = idle(step === 1 ? CURRENT : NEXT);
    const invalid: unknown[] = [undefined, null, false, 0, "state", [], {}];
    for (const key of Object.keys(base)) {
      const missing: Record<string, unknown> = { ...base };
      delete missing[key];
      invalid.push(missing, { ...base, [key]: undefined });
    }
    for (const key of ["isStreaming", "isCompacting"]) {
      for (const value of [null, "false", 0, 1, [], {}, new Boolean(false)]) invalid.push({ ...base, [key]: value });
    }
    for (const key of ["messageCount", "pendingMessageCount"]) {
      for (const value of [null, "0", -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true, [], {}, 0n]) {
        invalid.push({ ...base, [key]: value });
      }
    }
    for (const thinkingLevel of [null, "High", "high ", "", "unknown", true, 1, [], {}]) {
      invalid.push({ ...base, thinkingLevel });
    }
    for (const model of [
      undefined, false, 0, "model", [], {}, { provider: NEXT.provider }, { id: NEXT.model },
      { provider: 1, id: NEXT.model }, { provider: NEXT.provider, id: 1 },
      { provider: "user@host", id: NEXT.model }, { provider: NEXT.provider, id: "model\n" },
    ]) invalid.push({ ...base, model });
    for (const data of invalid) {
      const { machine, pending } = pendingAt(step);
      assertFailed(machine, { id: pending.id, command: "get_state", success: true, data }, "invalid_result");
    }
  });
}

test("set_model acknowledgement must itself contain only the exact next model identity", () => {
  for (const data of [null, undefined, true, [], {}, { provider: NEXT.provider }, { id: NEXT.model },
    { provider: 1, id: NEXT.model }, { provider: NEXT.provider, id: "user@host" }]) {
    const { machine, response } = pendingAt(2);
    assertFailed(machine, { ...response, data }, "invalid_result");
  }
  for (const data of [idle(CURRENT).model, { provider: "other", id: NEXT.model }, { provider: NEXT.provider, id: "other" }]) {
    const { machine, response } = pendingAt(2);
    assertFailed(machine, { ...response, data }, "route_mismatch");
  }
});

for (const step of STEPS) {
  test(`step ${step} rejects wrong IDs, commands, order, envelope shapes, and uncorrelated rejections`, () => {
    const { response: base } = pendingAt(step);
    const invalid: unknown[] = [undefined, null, false, 1, "response", [], {}, Object.assign([], base), Object.create(base)];
    for (const key of ["id", "command", "success"]) {
      const missing: Record<string, unknown> = { ...base };
      delete missing[key];
      invalid.push(missing);
    }
    for (const id of [
      undefined, null, 1, true, [], {}, "", "unknown", "prompt-1", "prompt-2", "route-2:prompt-1", "route-2:prompt-2",
      `route-3:switch-${step}`, `route-2:switch-${step} `, "x".repeat(101),
    ]) invalid.push({ ...base, id }, { id, command: base.command, success: false, category: "command_rejected" });
    for (const command of [
      undefined, null, 1, true, [], {}, "", "prompt", "get_state", "set_model", "set_thinking_level",
      "get_available_models", "get_session_stats",
    ]) {
      if (command !== base.command) {
        invalid.push({ ...base, command }, { id: base.id, command, success: false, category: "command_rejected" });
      }
    }
    for (const other of STEPS) if (other !== step) invalid.push(pendingAt(other).response);
    for (const success of [undefined, null, "true", "false", 0, 1, [], {}, new Boolean(true)]) invalid.push({ ...base, success });
    invalid.push({ ...base, category: "command_rejected" }, { ...base, category: undefined });
    if (step === 3) {
      for (const data of [undefined, null, {}, { level: NEXT.thinking }, SENSITIVE]) invalid.push({ ...base, data });
    } else {
      const missing: Record<string, unknown> = { ...base };
      delete missing.data;
      invalid.push(missing);
    }
    for (const result of invalid) {
      const { machine } = pendingAt(step);
      assertFailed(machine, result, "invalid_result");
    }
  });

  test(`step ${step} makes every command rejection terminal with no retries or raw errors`, () => {
    const { machine, pending } = pendingAt(step);
    const rejection = { id: pending.id, command: pending.command.type, success: false, category: "command_rejected" };
    assertFailed(machine, rejection, "command_rejected");
    assert.deepEqual(machine.consume(success(pending, NEXT)), failure("command_rejected"));
    for (const fields of [
      { category: undefined }, { category: SENSITIVE }, { error: SENSITIVE }, { data: undefined }, { data: SENSITIVE },
      { type: "response" },
    ]) {
      const { machine: invalid } = pendingAt(step);
      assertFailed(invalid, { ...rejection, ...fields }, "invalid_result");
      assert.doesNotMatch(retained(invalid), /REDACTED_TEST_ONLY/);
    }
  });

  test(`step ${step} rejects duplicate consumption and double start without issuing more actions`, () => {
    const { machine, response } = pendingAt(step);
    const accepted = machine.consume(response);
    const expected = step === 4 ? "invalid_transition" : "invalid_result";
    assert.deepEqual(machine.consume(response), failure(expected));
    assert.equal(machine.state, step === 4 ? "completed" : "failed");
    assert.deepEqual(machine.start(), failure(expected));
    if (accepted.status === "command") assert.deepEqual(machine.consume(success(accepted, NEXT)), failure(expected));
    const { machine: restarted, response: oldResponse } = pendingAt(step);
    assert.deepEqual(restarted.start(), failure("invalid_transition"));
    assert.equal(restarted.state, "failed");
    assert.deepEqual(restarted.consume(oldResponse), failure("invalid_transition"));
  });

  test(`step ${step} rejects smuggled payloads, hidden fields, and non-plain objects without retaining secrets`, () => {
    const { response: base } = pendingAt(step);
    const invalid: unknown[] = [
      { ...base, type: "response" }, { ...base, [Symbol("secret")]: SENSITIVE },
      Object.defineProperty({ ...base }, "hidden", { value: SENSITIVE }),
      Object.assign(Object.create({ secret: SENSITIVE }), base),
    ];
    for (const key of ["error", "payload", "sessionFile", "sessionId", "cost", "tokens", "models", "text", "toJSON"]) {
      invalid.push({ ...base, [key]: SENSITIVE });
      if (base.success && "data" in base) {
        invalid.push({ ...base, data: { ...base.data, [key]: SENSITIVE } });
        if (base.command === "get_state") {
          invalid.push({ ...base, data: { ...base.data, model: { ...base.data.model, [key]: SENSITIVE } } });
        }
      }
    }
    if (base.success && "data" in base) {
      invalid.push({ ...base, data: Object.assign(Object.create({ secret: SENSITIVE }), base.data) });
      invalid.push({ ...base, data: { ...base.data, [Symbol("secret")]: SENSITIVE } });
      invalid.push({ ...base, data: Object.defineProperty({ ...base.data }, "hidden", { value: SENSITIVE }) });
      if (base.command === "get_state") {
        for (const model of [
          Object.assign(Object.create({ secret: SENSITIVE }), base.data.model),
          { ...base.data.model, [Symbol("secret")]: SENSITIVE },
          Object.defineProperty({ ...base.data.model }, "hidden", { value: SENSITIVE }),
        ]) invalid.push({ ...base, data: { ...base.data, model } });
      }
    }
    for (const result of invalid) {
      const { machine } = pendingAt(step);
      assertFailed(machine, result, "invalid_result");
      assert.doesNotMatch(retained(machine), /REDACTED_TEST_ONLY|sessionFile|sessionId|payload|tokens|cost|models/);
    }
  });

  test(`step ${step} rejects accessor fields and throwing proxies without invoking getters or keeping errors`, () => {
    let reads = 0;
    const get = () => { reads += 1; throw new Error(SENSITIVE); };
    const { response: base } = pendingAt(step);
    const invalid: unknown[] = [new Proxy(base, { getPrototypeOf: get })];
    const revoked = Proxy.revocable(base, {});
    revoked.revoke();
    invalid.push(revoked.proxy);
    for (const key of Object.keys(base)) invalid.push(Object.defineProperty({ ...base }, key, { get }));
    if (base.success && "data" in base) {
      for (const key of Object.keys(base.data)) {
        invalid.push({ ...base, data: Object.defineProperty({ ...base.data }, key, { get }) });
      }
      if (base.command === "get_state") {
        for (const key of ["provider", "id"]) {
          invalid.push({ ...base, data: { ...base.data, model: Object.defineProperty({ ...base.data.model }, key, { get }) } });
        }
        invalid.push({ ...base, data: { ...base.data, model: revoked.proxy } });
      }
    }
    for (const result of invalid) {
      const { machine } = pendingAt(step);
      assertFailed(machine, result, "invalid_result");
      assert.doesNotMatch(retained(machine), /REDACTED_TEST_ONLY/);
    }
    assert.equal(reads, 1, "only the throwing proxy trap runs; no accessor is invoked");
  });

  test(`step ${step} cannot advance through a reentrant callback or start during input validation`, () => {
    for (const method of ["start", "consume"]) {
      const { machine, response } = pendingAt(step);
      let nested: LiveRouteSwitchUpdate | undefined;
      const value = new Proxy(response, {
        getPrototypeOf(target) {
          nested = method === "start" ? machine.start() : machine.consume(response);
          return Reflect.getPrototypeOf(target);
        },
      });
      assertFailed(machine, value, "invalid_transition");
      assert.deepEqual(nested, failure("invalid_transition"));
    }
  });
}

test("consume before start fails terminally, and completed or failed machines never inspect late values", () => {
  const machine = new LiveRouteSwitch(2, CURRENT, NEXT);
  assertFailed(machine, pendingAt(1).response, "invalid_transition");
  let reads = 0;
  const late = new Proxy({}, { getPrototypeOf() { reads += 1; throw new Error(SENSITIVE); } }) as ControlResult;
  for (const terminal of [machine, complete().machine]) {
    const state = terminal.state;
    assert.deepEqual(terminal.consume(late), failure("invalid_transition"));
    assert.deepEqual(terminal.start(), failure("invalid_transition"));
    assert.equal(terminal.state, state);
  }
  assert.equal(reads, 0);
});

test("route accessors and revoked proxies cannot execute getters or leak raw errors", () => {
  let reads = 0;
  const get = () => { reads += 1; throw new Error(SENSITIVE); };
  const revoked = Proxy.revocable({ ...CURRENT }, {});
  revoked.revoke();
  const invalid = [revoked.proxy, ...Object.keys(CURRENT).map((key) => Object.defineProperty({ ...CURRENT }, key, { get }))];
  for (const value of invalid) {
    for (const [current, next] of [[value, NEXT], [CURRENT, value]]) {
      const machine = new LiveRouteSwitch(2, current, next);
      assert.deepEqual(machine.start(), failure("invalid_input"));
      assert.doesNotMatch(retained(machine), /REDACTED_TEST_ONLY/);
    }
  }
  assert.equal(reads, 0);
});

test("route snapshots and frozen actions prevent caller mutation from changing pending correlation or route identity", () => {
  const current = { ...CURRENT };
  const next = { ...NEXT };
  const machine = new LiveRouteSwitch(2, current, next);
  Object.assign(current, { provider: SENSITIVE, model: SENSITIVE, thinking: "off", sessionId: SENSITIVE });
  Object.assign(next, { provider: SENSITIVE, model: SENSITIVE, thinking: "off", sessionFile: SENSITIVE });
  let update = machine.start();
  for (const step of STEPS) {
    const pending = action(update);
    assert.ok(Object.isFrozen(pending));
    assert.ok(Object.isFrozen(pending.command));
    assert.equal(Reflect.set(pending, "id", SENSITIVE), false);
    assert.equal(Reflect.set(pending.command, "type", SENSITIVE), false);
    assert.equal(Reflect.set(pending.command, "modelId", SENSITIVE), false);
    const response = success(pending, step === 1 ? CURRENT : NEXT);
    update = machine.consume(response);
    Object.assign(response, { id: SENSITIVE, error: SENSITIVE, data: { sessionId: SENSITIVE } });
    assert.doesNotMatch(retained(machine), /REDACTED_TEST_ONLY|sessionFile|sessionId|messageCount|pendingMessageCount|error/);
  }
  assert.deepEqual(update, { status: "completed" });
  assert.ok(Object.isFrozen(update));
});

test("plain null-prototype data and frozen sanitized results remain valid without mutation", () => {
  const current = Object.assign(Object.create(null), CURRENT) as PiRoute;
  const { machine, pending } = pendingAt(1, current);
  const data = Object.freeze({ ...idle(current), model: Object.freeze(idle(current).model!) });
  const result = Object.freeze(Object.assign(Object.create(null), { id: pending.id, command: "get_state", success: true, data }));
  assert.deepEqual(action(machine.consume(result)).command, { type: "set_model", provider: NEXT.provider, modelId: NEXT.model });
});
