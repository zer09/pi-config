import assert from "node:assert/strict";
import test from "node:test";
import {
  RESTART_AFTER_WORK_NOTE,
  buildDelegatePrompt,
} from "./instructions.ts";
import { oracleGuard, roleIsExclusive, roleIsReadOnly, roleLabel, routeKey } from "./routes.ts";
import { loadRoutingConfig, roleIds } from "./routing.ts";
import type { ResolvedRole } from "./routing.ts";

/** Test fixture: build a registry-style resolved role from a known role id. */
function role(id: string): ResolvedRole {
  const family = id.replace(/-[a-z]$/, "") as ResolvedRole["family"];
  const slot = /-[a-z]$/.test(id) ? id.charCodeAt(id.length - 1) - "a".charCodeAt(0) : undefined;
  return slot === undefined ? { id, family, profile: `${family}-profile` } : { id, family, profile: `${family}-profile`, slot };
}

const ORACLE_MODEL = "gpt-5.6-sol";

test("routeKey keeps the Pi-only provider/model:thinking format", () => {
  assert.equal(
    routeKey({ provider: "openai-codex-cgpt4", model: "gpt-5.5", thinking: "medium" }),
    "openai-codex-cgpt4/gpt-5.5:medium",
  );
});

test("classifies role permissions and sequential roles", () => {
  assert.equal(roleIsReadOnly(role("solution-a")), true);
  assert.equal(roleIsReadOnly(role("solution-d")), true);
  assert.equal(roleIsReadOnly(role("solution-e")), true);
  assert.equal(roleIsReadOnly(role("solution-f")), true);
  assert.equal(roleIsReadOnly(role("review-c")), true);
  assert.equal(roleIsReadOnly(role("review-d")), true);
  assert.equal(roleIsReadOnly(role("review-e")), true);
  assert.equal(roleIsReadOnly(role("verification")), true);
  assert.equal(roleIsReadOnly(role("oracle")), true);
  assert.equal(roleIsReadOnly(role("implementation")), false);
  // Verification is read-only but not exclusive: DelegateManager owns its
  // bounded verification-only overlap rule with the four-delegate cap.
  assert.equal(roleIsExclusive(role("verification")), false);
  assert.equal(roleIsExclusive(role("remediation")), true);
  assert.equal(roleIsExclusive(role("implementation")), true);
  assert.equal(roleIsExclusive(role("oracle")), true);
  assert.equal(roleIsExclusive(role("review-a")), false);
  assert.equal(roleIsExclusive(role("review-d")), false);
  assert.equal(roleIsExclusive(role("review-e")), false);
});

test("exposes the oracle role in the derived model-visible role registry", () => {
  const registry = loadRoutingConfig().roles;
  assert.ok(registry.has("oracle"));
  assert.equal([...registry.keys()].filter((id) => id === "oracle").length, 1);
  assert.equal(registry.get("oracle")!.family, "oracle");
  assert.equal(registry.get("oracle")!.slot, undefined);
});

test("the shipped snapshot derives six solution roles and five review roles in canonical order", () => {
  const ids = roleIds(loadRoutingConfig());
  const solutions = ids.filter((id) => id.startsWith("solution-"));
  const reviews = ids.filter((id) => id.startsWith("review-"));
  assert.deepEqual(solutions, ["solution-a", "solution-b", "solution-c", "solution-d", "solution-e", "solution-f"]);
  assert.deepEqual(reviews, ["review-a", "review-b", "review-c", "review-d", "review-e"]);
  // Singleton families keep their fixed ids and stay present exactly once.
  assert.deepEqual(
    ids.filter((id) => ["implementation", "remediation", "verification", "oracle"].includes(id)),
    ["implementation", "remediation", "verification", "oracle"],
  );
});

test("role labels carry the plain role without a backend suffix", () => {
  assert.equal(roleLabel(role("solution-a")), "solution-a");
  assert.equal(roleLabel(role("oracle")), "oracle");
  assert.equal(roleLabel(role("implementation")), "implementation");
});

test("main-Sol skip detection is exact, model-id based, and covers every configured oracle model", () => {
  const models = new Set([ORACLE_MODEL]);
  // Exact model id triggers the skip regardless of the serving provider.
  assert.match(oracleGuard(role("oracle"), ORACLE_MODEL, models)?.message ?? "", /Skip the oracle role/);
  assert.match(
    oracleGuard(role("oracle"), ORACLE_MODEL, models)?.message ?? "",
    /gpt-5\.6-sol.*finalize the solution contract directly/,
  );
  // Lookalike and sibling model ids never trigger the skip.
  assert.equal(oracleGuard(role("oracle"), "gpt-5.6-sol-latest", models), undefined);
  assert.equal(oracleGuard(role("oracle"), "gpt-5.5", models), undefined);
  assert.equal(oracleGuard(role("oracle"), undefined, models), undefined);
  assert.equal(oracleGuard(role("oracle"), "claude-opus-5", models), undefined);
  // The guard only constrains the oracle role.
  assert.equal(oracleGuard(role("verification"), ORACLE_MODEL, models), undefined);
  // A differently configured oracle model set changes the skip target.
  const alternates = new Set(["gpt-5.5"]);
  assert.equal(oracleGuard(role("oracle"), "gpt-5.5", alternates) instanceof Error, true);
  assert.equal(oracleGuard(role("oracle"), ORACLE_MODEL, alternates), undefined);
  // Multi-tier oracle profiles: a parent matching any configured oracle
  // model is rejected, not only the first tier's model.
  const twoTier = new Set(["model-x", "model-y"]);
  assert.match(oracleGuard(role("oracle"), "model-y", twoTier)?.message ?? "", /parent session already runs model-y/);
  assert.match(oracleGuard(role("oracle"), "model-x", twoTier)?.message ?? "", /parent session already runs model-x/);
  assert.equal(oracleGuard(role("oracle"), "model-z", twoTier), undefined);
  assert.equal(oracleGuard(role("oracle"), undefined, twoTier), undefined);
});

test("role contracts are family-owned for every family including derived high slots", () => {
  const solutionZ = role("solution-z");
  const reviewZ = role("review-z");
  // Derived high-slot roles keep their family contract without prefix logic.
  assert.match(buildDelegatePrompt(solutionZ, "/tmp/project", "Investigate."), /independent read-only solution investigation/i);
  assert.match(buildDelegatePrompt(reviewZ, "/tmp/project", "Review."), /independent neutral read-only implementation review/i);
  assert.match(buildDelegatePrompt(role("verification"), "/tmp/project", "Verify."), /read-only verification of one supplied finding/i);
  assert.match(buildDelegatePrompt(role("remediation"), "/tmp/project", "Fix."), /focused remediation contract/);
  assert.match(buildDelegatePrompt(role("implementation"), "/tmp/project", "Implement."), /assigned contract/);
  // The task header carries the exact derived id.
  assert.match(buildDelegatePrompt(solutionZ, "/tmp/project", "Investigate."), /# Task: solution-z/);
  // Classification follows the family, never the id text.
  assert.equal(roleIsReadOnly(solutionZ), true);
  assert.equal(roleIsExclusive(reviewZ), false);
  assert.equal(roleIsExclusive(role("remediation")), true);
});

test("builds the oracle role contract with verdict and evidence requirements", () => {
  const prompt = buildDelegatePrompt(role("oracle"), "/tmp/project", "Review the draft contract.");
  assert.match(prompt, /read-only advisory solution oracle/i);
  assert.match(prompt, /Do not edit, implement, delegate, or change Git or hosted state/);
  assert.match(prompt, /exactly one verdict, VALID or REVISE/);
  assert.match(prompt, /correctness analysis, missing invariants and risks/);
  assert.match(prompt, /exact path:line evidence/);
  assert.match(prompt, /Parent verifies claims and owns the final contract/);
  assert.match(prompt, /DELEGATE_RESULT: COMPLETED/);
  assert.match(prompt, /Review the draft contract\./);
  // Without the restart flag the fixed restart note stays absent.
  assert.ok(!prompt.includes(RESTART_AFTER_WORK_NOTE));
});

test("builds a non-recursive prompt with terminal contract", () => {
  const prompt = buildDelegatePrompt(role("review-a"), "/tmp/project", "Review the candidate.");
  assert.match(prompt, /Do not start or orchestrate another agent process or subagent/);
  assert.match(prompt, /independent neutral read-only implementation review/i);
  assert.match(prompt, /DELEGATE_RESULT: COMPLETED/);
  assert.match(prompt, /Review the candidate\./);
});

test("terminal instructions require one exact reason code for BLOCKED and FAILED", () => {
  const prompt = buildDelegatePrompt(role("implementation"), "/tmp/project", "Implement the contract.");
  // The reason line sits directly above the marker, exactly once, code only.
  assert.match(prompt, /DELEGATE_REASON: <blocked-code>\nDELEGATE_RESULT: BLOCKED/);
  assert.match(prompt, /DELEGATE_REASON: <failed-code>\nDELEGATE_RESULT: FAILED/);
  assert.match(prompt, /Use one matching code with no prose, path, or details/);
  assert.match(prompt, /DELEGATE_REASON appears once directly above it/);
  // Every closed code is generated from the runtime enum.
  for (const code of [
    "evidence_inaccessible", "user_decision_required", "assignment_conflict",
    "policy_restriction", "budget_exhausted", "external_dependency", "finding_reported",
    "execution_failure", "verification_failure", "internal_inconsistency", "policy_violation",
  ]) {
    assert.ok(prompt.includes(code), `terminal contract must list ${code}`);
  }
  // Reviews with findings must use COMPLETED, never BLOCKED.
  assert.match(prompt, /reviews with findings use COMPLETED/);
  // COMPLETED carries no reason line and the marker rules are unchanged.
  assert.match(prompt, /COMPLETED has no reason/);
  assert.match(prompt, /DELEGATE_RESULT appears once as the final nonblank line/);
  assert.match(prompt, /After BLOCKED or FAILED, stop/);
});

test("the restart note is fixed, sanitized, and appended at most once", () => {
  // The note is generic: no provider errors, raw output, tool payloads,
  // reports, paths, or credentials ever enter it.
  for (const forbidden of ["/tmp", "http", "key", "token", "error:", "provider=", "/"]) {
    if (forbidden === "/") {
      assert.ok(!RESTART_AFTER_WORK_NOTE.includes("://"));
      continue;
    }
    assert.ok(!RESTART_AFTER_WORK_NOTE.toLowerCase().includes(forbidden.toLowerCase()));
  }
  assert.match(RESTART_AFTER_WORK_NOTE, /may have changed the tree/);
  assert.match(RESTART_AFTER_WORK_NOTE, /treat it as authoritative/);
  assert.match(RESTART_AFTER_WORK_NOTE, /Inspect current work first/);
  assert.match(RESTART_AFTER_WORK_NOTE, /do not repeat irreversible actions/);

  const plain = buildDelegatePrompt(role("review-a"), "/tmp/project", "Review the candidate.");
  const restarted = buildDelegatePrompt(role("review-a"), "/tmp/project", "Review the candidate.", {
    restartAfterWork: true,
  });
  assert.equal(restarted.split(RESTART_AFTER_WORK_NOTE).length - 1, 1);
  assert.ok(restarted.length > plain.length);
  // Regenerating from the same original assignment never stacks the note.
  const restartedTwice = buildDelegatePrompt(role("review-a"), "/tmp/project", "Review the candidate.", {
    restartAfterWork: true,
  });
  assert.equal(restartedTwice, restarted);
  // The assigned task itself stays intact in the restarted prompt.
  assert.match(restarted, /## Assignment\n\nReview the candidate\./);
});
