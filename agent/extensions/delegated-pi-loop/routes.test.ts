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
  assert.equal(roleIsReadOnly("review-c"), true);
  assert.equal(roleIsReadOnly("verification"), true);
  assert.equal(roleIsReadOnly("implementation"), false);
  assert.equal(roleIsExclusive("verification"), true);
  assert.equal(roleIsExclusive("implementation"), true);
  assert.equal(roleIsExclusive("review-a"), false);
});

test("builds a non-recursive prompt with terminal contract", () => {
  const prompt = buildDelegatePrompt("review-a", "/tmp/project", "Review the candidate.");
  assert.match(prompt, /Do not spawn or orchestrate another Pi instance/);
  assert.match(prompt, /independent read-only implementation review/i);
  assert.match(prompt, /DELEGATE_RESULT: COMPLETED/);
  assert.match(prompt, /Review the candidate\./);
});
