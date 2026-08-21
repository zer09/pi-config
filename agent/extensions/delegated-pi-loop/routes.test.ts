import assert from "node:assert/strict";
import test from "node:test";
import { buildDelegatePrompt, roleIsExclusive, roleIsReadOnly, routeKey, routesFor } from "./routes.ts";

test("preserves ordered A, B, and C default route maps", () => {
  assert.deepEqual(routesFor("solution-a", "default").map(routeKey), [
    "opencode-go/muse-spark-1.2-contributor:xhigh",
    "agentrouter/gpt-5.6-sol:max",
    "tabitoken/claude-opus-5-thinking:max",
    "seekai/claude-opus-5:max",
    "gorouter/claude-opus-5-thinking:high",
  ]);
  assert.equal(routeKey(routesFor("review-b", "default")[0]!), "opencode-go/deepseek-v4-flash:max");
  assert.equal(routeKey(routesFor("review-c", "default")[0]!), "opencode-go/hy3:high");
  // A/B/C maps ignore parent-provider inheritance and injected randomness.
  assert.deepEqual(
    routesFor("solution-a", "default", { parentProvider: "openai-codex-cgpt2", random: () => 0 }).map(routeKey),
    routesFor("solution-a", "default").map(routeKey),
  );
});

test("D inherits an eligible parent provider as its primary", () => {
  assert.deepEqual(routesFor("solution-d", "default", { parentProvider: "openai-codex-cgpt2" }).map(routeKey), [
    "openai-codex-cgpt2/gpt-5.5:medium",
    "openai-codex/gpt-5.5:medium",
    "openai-codex-zahlo/gpt-5.5:medium",
    "openai-codex-cgpt1/gpt-5.5:medium",
    "openai-codex-cgpt3/gpt-5.5:medium",
  ]);
  // Inheritance needs no randomness: the injected source is never consulted.
  let randomCalls = 0;
  const routes = routesFor("review-d", "default", {
    parentProvider: "openai-codex",
    random: () => {
      randomCalls += 1;
      return 0.99;
    },
  });
  assert.equal(routeKey(routes[0]!), "openai-codex/gpt-5.5:medium");
  assert.equal(randomCalls, 0);
});

test("D selects one random eligible primary exactly once and keeps the rest canonical", () => {
  let randomCalls = 0;
  const routes = routesFor("solution-d", "default", {
    parentProvider: "zai",
    random: () => {
      randomCalls += 1;
      return 0.3;
    },
  });
  assert.equal(randomCalls, 1);
  assert.deepEqual(routes.map(routeKey), [
    "openai-codex-zahlo/gpt-5.5:medium",
    "openai-codex/gpt-5.5:medium",
    "openai-codex-cgpt1/gpt-5.5:medium",
    "openai-codex-cgpt2/gpt-5.5:medium",
    "openai-codex-cgpt3/gpt-5.5:medium",
  ]);
  // A different draw only moves the primary; the canonical order is stable.
  const otherRoutes = routesFor("review-d", "default", { parentProvider: "zai", random: () => 0.99 });
  assert.deepEqual(otherRoutes.map(routeKey), [
    "openai-codex-cgpt3/gpt-5.5:medium",
    "openai-codex/gpt-5.5:medium",
    "openai-codex-zahlo/gpt-5.5:medium",
    "openai-codex-cgpt1/gpt-5.5:medium",
    "openai-codex-cgpt2/gpt-5.5:medium",
  ]);
});

test("D excludes ineligible providers such as Cursor from the whole chain", () => {
  const routes = routesFor("solution-d", "default", { parentProvider: "cursor", random: () => 0 });
  assert.equal(routes.length, 5);
  for (const route of routes) {
    if (route.kind !== "pi") assert.fail("D routes must be Pi routes");
    assert.equal(route.model, "gpt-5.5");
    assert.equal(route.thinking, "medium");
    assert.notEqual(route.provider, "cursor");
    assert.match(route.provider, /^openai-codex(-zahlo|-cgpt[123])?$/);
  }
  // Cursor never becomes primary even when the parent session selected it.
  assert.equal(routeKey(routes[0]!), "openai-codex/gpt-5.5:medium");
});

test("explicit backends override D default routing exactly like other roles", () => {
  assert.equal(routeKey(routesFor("solution-d", "zai")[0]!), "zai/glm-5.3:max");
  assert.equal(routeKey(routesFor("review-d", "claude")[0]!), "claude-code/claude-opus-5:medium");
  // Explicit backends ignore parent-provider inheritance.
  assert.deepEqual(
    routesFor("solution-d", "zai", { parentProvider: "openai-codex", random: () => 0 }),
    routesFor("solution-d", "zai"),
  );
});

test("keeps implementation, remediation, and verification defaults pinned", () => {
  assert.equal(routeKey(routesFor("implementation", "default")[0]!), "zai/glm-5.3:max");
  assert.equal(routeKey(routesFor("remediation", "default")[0]!), "zai/glm-5.3:max");
  assert.equal(routeKey(routesFor("verification", "default")[0]!), "openai-codex/gpt-5.6-sol:high");
});

test("explicit backends preserve role while replacing the route", () => {
  assert.equal(routeKey(routesFor("review-a", "zai")[0]!), "zai/glm-5.3:max");
  assert.equal(routeKey(routesFor("implementation", "claude")[0]!), "claude-code/claude-opus-5:medium");
});

test("classifies role permissions and sequential roles", () => {
  assert.equal(roleIsReadOnly("solution-a"), true);
  assert.equal(roleIsReadOnly("solution-d"), true);
  assert.equal(roleIsReadOnly("review-c"), true);
  assert.equal(roleIsReadOnly("review-d"), true);
  assert.equal(roleIsReadOnly("verification"), true);
  assert.equal(roleIsReadOnly("implementation"), false);
  assert.equal(roleIsExclusive("verification"), true);
  assert.equal(roleIsExclusive("implementation"), true);
  assert.equal(roleIsExclusive("review-a"), false);
  assert.equal(roleIsExclusive("review-d"), false);
});

test("builds a non-recursive prompt with terminal contract", () => {
  const prompt = buildDelegatePrompt("review-a", "/tmp/project", "Review the candidate.");
  assert.match(prompt, /Do not spawn or orchestrate another Pi instance/);
  assert.match(prompt, /independent read-only implementation review/i);
  assert.match(prompt, /DELEGATE_RESULT: COMPLETED/);
  assert.match(prompt, /Review the candidate\./);
});
