import assert from "node:assert/strict";
import test from "node:test";
import {
  RESTART_AFTER_WORK_NOTE,
  buildDelegatePrompt,
  oracleGuard,
  roleIsExclusive,
  roleIsReadOnly,
  roleLabel,
  routeKey,
} from "./routes.ts";
import { DELEGATE_ROLES } from "./types.ts";

const ORACLE_MODEL = "gpt-5.6-sol";

test("routeKey keeps the Pi-only provider/model:thinking format", () => {
  assert.equal(
    routeKey({ provider: "openai-codex-cgpt4", model: "gpt-5.5", thinking: "medium" }),
    "openai-codex-cgpt4/gpt-5.5:medium",
  );
});

test("classifies role permissions and sequential roles", () => {
  assert.equal(roleIsReadOnly("solution-a"), true);
  assert.equal(roleIsReadOnly("solution-d"), true);
  assert.equal(roleIsReadOnly("solution-e"), true);
  assert.equal(roleIsReadOnly("solution-f"), true);
  assert.equal(roleIsReadOnly("review-c"), true);
  assert.equal(roleIsReadOnly("review-d"), true);
  assert.equal(roleIsReadOnly("review-e"), true);
  assert.equal(roleIsReadOnly("verification"), true);
  assert.equal(roleIsReadOnly("oracle"), true);
  assert.equal(roleIsReadOnly("implementation"), false);
  // Verification is read-only but not exclusive: DelegateManager owns its
  // bounded verification-only overlap rule with the four-delegate cap.
  assert.equal(roleIsExclusive("verification"), false);
  assert.equal(roleIsExclusive("remediation"), true);
  assert.equal(roleIsExclusive("implementation"), true);
  assert.equal(roleIsExclusive("oracle"), true);
  assert.equal(roleIsExclusive("review-a"), false);
  assert.equal(roleIsExclusive("review-d"), false);
  assert.equal(roleIsExclusive("review-e"), false);
});

test("exposes the oracle role in the model-visible role enum", () => {
  assert.ok(DELEGATE_ROLES.includes("oracle"));
  assert.equal(DELEGATE_ROLES.filter((role) => role === "oracle").length, 1);
});

test("exposes six solution roles and five review roles in the model-visible role enum", () => {
  const solutions = DELEGATE_ROLES.filter((role) => role.startsWith("solution-"));
  const reviews = DELEGATE_ROLES.filter((role) => role.startsWith("review-"));
  assert.deepEqual(solutions, ["solution-a", "solution-b", "solution-c", "solution-d", "solution-e", "solution-f"]);
  assert.deepEqual(reviews, ["review-a", "review-b", "review-c", "review-d", "review-e"]);
});

test("role labels carry the plain role without a backend suffix", () => {
  assert.equal(roleLabel("solution-a"), "solution-a");
  assert.equal(roleLabel("oracle"), "oracle");
  assert.equal(roleLabel("implementation"), "implementation");
});

test("main-Sol skip detection is exact, model-id based, and covers every configured oracle model", () => {
  const models = new Set([ORACLE_MODEL]);
  // Exact model id triggers the skip regardless of the serving provider.
  assert.match(oracleGuard("oracle", ORACLE_MODEL, models)?.message ?? "", /Skip the oracle role/);
  assert.match(
    oracleGuard("oracle", ORACLE_MODEL, models)?.message ?? "",
    /gpt-5\.6-sol.*finalize the solution contract directly/,
  );
  // Lookalike and sibling model ids never trigger the skip.
  assert.equal(oracleGuard("oracle", "gpt-5.6-sol-latest", models), undefined);
  assert.equal(oracleGuard("oracle", "gpt-5.5", models), undefined);
  assert.equal(oracleGuard("oracle", undefined, models), undefined);
  assert.equal(oracleGuard("oracle", "claude-opus-5", models), undefined);
  // The guard only constrains the oracle role.
  assert.equal(oracleGuard("verification", ORACLE_MODEL, models), undefined);
  // A differently configured oracle model set changes the skip target.
  const alternates = new Set(["gpt-5.5"]);
  assert.equal(oracleGuard("oracle", "gpt-5.5", alternates) instanceof Error, true);
  assert.equal(oracleGuard("oracle", ORACLE_MODEL, alternates), undefined);
  // Multi-tier oracle profiles: a parent matching any configured oracle
  // model is rejected, not only the first tier's model.
  const twoTier = new Set(["model-x", "model-y"]);
  assert.match(oracleGuard("oracle", "model-y", twoTier)?.message ?? "", /parent session already runs model-y/);
  assert.match(oracleGuard("oracle", "model-x", twoTier)?.message ?? "", /parent session already runs model-x/);
  assert.equal(oracleGuard("oracle", "model-z", twoTier), undefined);
  assert.equal(oracleGuard("oracle", undefined, twoTier), undefined);
});

test("builds the oracle role contract with verdict and evidence requirements", () => {
  const prompt = buildDelegatePrompt("oracle", "/tmp/project", "Review the draft contract.");
  assert.match(prompt, /read-only advisory solution oracle/);
  assert.match(prompt, /Do not edit files, mutate Git, write to hosted services, implement, or start delegates/);
  assert.match(prompt, /exactly one verdict, VALID or REVISE/);
  assert.match(prompt, /correctness analysis, missing invariants and risks/);
  assert.match(prompt, /exact path:line evidence/);
  assert.match(prompt, /advisory, not the final authority/);
  assert.match(prompt, /DELEGATE_RESULT: COMPLETED/);
  assert.match(prompt, /Review the draft contract\./);
  // Without the restart flag the fixed restart note stays absent.
  assert.ok(!prompt.includes(RESTART_AFTER_WORK_NOTE));
});

test("builds a non-recursive prompt with terminal contract", () => {
  const prompt = buildDelegatePrompt("review-a", "/tmp/project", "Review the candidate.");
  assert.match(prompt, /Do not spawn or orchestrate another Pi instance/);
  assert.match(prompt, /independent read-only implementation review/i);
  assert.match(prompt, /DELEGATE_RESULT: COMPLETED/);
  assert.match(prompt, /Review the candidate\./);
});

test("terminal instructions require one exact reason code for BLOCKED and FAILED", () => {
  const prompt = buildDelegatePrompt("implementation", "/tmp/project", "Implement the contract.");
  // The reason line sits directly above the marker, exactly once, code only.
  assert.match(prompt, /A BLOCKED or FAILED result must carry exactly one reason line directly above the marker/);
  assert.match(prompt, /DELEGATE_REASON: <code>/);
  assert.match(prompt, /Use only the exact code on the reason line: no prose, paths, or details/);
  assert.match(prompt, /The reason line must sit directly above the marker and appear exactly once/);
  // Every closed code is listed with its concise meaning.
  for (const code of [
    "evidence_inaccessible", "user_decision_required", "assignment_conflict",
    "policy_restriction", "budget_exhausted", "external_dependency", "finding_reported",
    "execution_failure", "verification_failure", "internal_inconsistency", "policy_violation",
  ]) {
    assert.ok(prompt.includes(code), `terminal contract must list ${code}`);
  }
  // Reviews with findings must use COMPLETED, never BLOCKED.
  assert.match(prompt, /Reviews with findings must use COMPLETED, never BLOCKED with finding_reported/);
  assert.match(prompt, /finding_reported \(a finding was reported; reviews with findings must use COMPLETED instead\)/);
  // COMPLETED carries no reason line and the marker rules are unchanged.
  assert.match(prompt, /COMPLETED carries no reason line/);
  assert.match(prompt, /The marker must be the final non-whitespace line and must not appear earlier/);
  assert.match(prompt, /After BLOCKED or FAILED, do not start another attempt or unrelated task/);
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
  assert.match(RESTART_AFTER_WORK_NOTE, /may already have changed the working tree/);
  assert.match(RESTART_AFTER_WORK_NOTE, /current state of the working tree as authoritative/);
  assert.match(RESTART_AFTER_WORK_NOTE, /inspect the existing work before acting/);
  assert.match(RESTART_AFTER_WORK_NOTE, /do not repeat an irreversible operation/);

  const plain = buildDelegatePrompt("review-a", "/tmp/project", "Review the candidate.");
  const restarted = buildDelegatePrompt("review-a", "/tmp/project", "Review the candidate.", {
    restartAfterWork: true,
  });
  assert.equal(restarted.split(RESTART_AFTER_WORK_NOTE).length - 1, 1);
  assert.ok(restarted.length > plain.length);
  // Regenerating from the same original assignment never stacks the note.
  const restartedTwice = buildDelegatePrompt("review-a", "/tmp/project", "Review the candidate.", {
    restartAfterWork: true,
  });
  assert.equal(restartedTwice, restarted);
  // The assigned task itself stays intact in the restarted prompt.
  assert.match(restarted, /## Assigned task\n\nReview the candidate\./);
});
