import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHILD_RECURSION_PROHIBITION,
  REPORT_RECOVERY_PROMPT,
  RESTART_AFTER_WORK_NOTE,
  buildDelegatePrompt,
  composeDelegatePrompt,
  delegateRunPromptGuidelines,
  roleFamilyContract,
} from "./instructions.ts";
import { ROLE_FAMILIES, loadRoutingSnapshot, roleIdsInFamily, type ResolvedRole, type RoleFamily } from "./routing.ts";

/** Test fixture: build a registry-style resolved role for one family. */
function familyRole(family: RoleFamily, id: string = family): ResolvedRole {
  return { id, family, profile: `${family}-profile` };
}

test("prompt and instruction text is single-sourced in the canonical module", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const protocol = await readFile(new URL("./protocol.ts", import.meta.url), "utf8");
  const runner = await readFile(new URL("./runner.ts", import.meta.url), "utf8");
  const supervisor = await readFile(new URL("./supervisor.ts", import.meta.url), "utf8");
  // Enforcement modules keep no instruction text of their own.
  assert.ok(!routes.includes("Restart note:"), "routes.ts must not carry the restart note");
  assert.ok(!routes.includes("## Role contract"), "routes.ts must not carry the child prompt template");
  assert.ok(!protocol.includes("Your previous response did not satisfy"), "protocol.ts must not carry the recovery prompt");
  // The runtime consumes the centralized builders and text directly.
  assert.match(runner, /import \{ buildDelegatePrompt \} from "\.\/instructions\.ts";/);
  assert.match(supervisor, /import \{ REPORT_RECOVERY_PROMPT \} from "\.\/instructions\.ts";/);
  assert.match(supervisor, /protocol\.beginPrompt\(2, REPORT_RECOVERY_PROMPT\)/);
});

test("the restart note stays byte-exact and generic", () => {
  assert.equal(
    RESTART_AFTER_WORK_NOTE,
    "Restart note: a previous route attempt for this same assignment may already have changed the working tree. Treat the current state of the working tree as authoritative: inspect the existing work before acting, build on it, and do not repeat an irreversible operation.",
  );
  assert.ok(!RESTART_AFTER_WORK_NOTE.includes("://"));
});

test("the report-recovery prompt stays byte-exact and marker-focused", () => {
  assert.equal(
    REPORT_RECOVERY_PROMPT,
    `Your previous response did not satisfy the required final-report protocol.

Do not repeat the assigned task, investigation, tool calls, edits, or other work.
Return one complete, self-contained final report using only the evidence already
available in this session.

Follow the original terminal-result instructions exactly. Include exactly one
valid DELEGATE_RESULT line as the final non-whitespace line, and do not quote or
discuss that marker elsewhere. If the result is BLOCKED or FAILED, put exactly
one DELEGATE_REASON line directly above the marker with one exact allowed code
and no prose, paths, or details: BLOCKED allows evidence_inaccessible,
user_decision_required, assignment_conflict, policy_restriction,
budget_exhausted, external_dependency, finding_reported; FAILED allows
execution_failure, verification_failure, internal_inconsistency,
policy_violation. COMPLETED takes no reason line; reviews with findings must
use COMPLETED.`,
  );
});

test("the base child prompt embeds the generic recursion prohibition verbatim", () => {
  assert.equal(
    CHILD_RECURSION_PROHIBITION,
    "Execute this assigned role yourself. Do not spawn or orchestrate another Pi instance, Claude Code session, or subagent.",
  );
  // The prohibition names no parent tool: it must not mention or explain
  // delegate_run, so parent orchestration policy stays out of child context.
  assert.ok(!CHILD_RECURSION_PROHIBITION.includes("delegate_run"));
  for (const family of ROLE_FAMILIES) {
    const prompt = buildDelegatePrompt(familyRole(family), "/tmp/project", "Do the assigned work.");
    assert.match(prompt, /Do not spawn or orchestrate another Pi instance, Claude Code session, or subagent\./);
  }
});

test("child prompts carry no parent workflow, waiver, or gate instruction beyond the role contract", () => {
  for (const family of ROLE_FAMILIES) {
    const prompt = buildDelegatePrompt(familyRole(family), "/tmp/project", "Do the assigned work.");
    // Remove the role-specific contract, then require that the remaining
    // template carries none of the parent orchestration policy.
    const template = prompt.replace(roleFamilyContract(family), "<contract>");
    for (const forbidden of [
      "delegate_run",
      "delegate_model_catalog",
      "promptGuidelines",
      "waive",
      "waiver",
      "solution gate",
      "review gate",
      "reviewer",
      "investigator",
      "solution-a",
      "review-a",
      "availableSkills",
      "routingOverride",
      "sole orchestrator",
      "planning and research deliverables",
    ]) {
      assert.ok(!template.includes(forbidden), `child template must not carry parent policy "${forbidden}"`);
    }
  }
});

test("every supported role family receives its centralized contract from the registry type", () => {
  for (const family of ROLE_FAMILIES) {
    const contract = roleFamilyContract(family);
    assert.ok(contract.length > 0, `family ${family} must have a contract`);
    const prompt = buildDelegatePrompt(familyRole(family, `${family}-probe`), "/tmp/project", "Work.");
    assert.ok(prompt.includes(contract), `the ${family} prompt must embed the centralized contract verbatim`);
  }
  // The contracts stay family-distinct policy text, not copies of one blob.
  const contracts = ROLE_FAMILIES.map((family) => roleFamilyContract(family));
  assert.equal(new Set(contracts).size, ROLE_FAMILIES.length);
});

test("an unknown role family stays fail-closed at the contract boundary", () => {
  // A smuggled runtime family value must throw instead of falling through to
  // an implementation contract; the routing registry keeps rejecting unknown
  // role ids before this boundary.
  assert.throws(
    () => roleFamilyContract("attacker" as RoleFamily),
    /no role contract for family "attacker"/,
  );
  const smuggled = composeDelegatePrompt({
    taskHeading: "# Task: x",
    cwdSentence: "You are a fresh delegated CLI agent working directly in \"/tmp\".",
    roleContractText: "contract",
    assignedTask: "Work.",
    restartNote: undefined,
  });
  assert.match(smuggled, /## Role contract\n\ncontract/);
});

test("agent/AGENTS.md no longer duplicates the parent delegation workflow", async () => {
  const agents = await readFile(new URL("../../../agent/AGENTS.md", import.meta.url), "utf8");
  assert.ok(!agents.includes("## Delegated work"), "the detailed Delegated work section must be gone");
  // No duplicated workflow sentences from the tool-scoped policy remain.
  for (const forbidden of [
    "delegate_run",
    "delegate_model_catalog",
    "waive the named failed",
    "solution investigator",
    "reviewer waiver",
    "solution-oracle",
    "sole orchestrator",
    "Delegated work",
  ]) {
    assert.ok(!agents.includes(forbidden), `agent/AGENTS.md must not duplicate delegation policy (found "${forbidden}")`);
  }
});

test("no model or provider catalog enumeration enters permanent prompt content", async () => {
  const source = await readFile(new URL("./instructions.ts", import.meta.url), "utf8");
  const lowered = source.toLowerCase();
  for (const routeDetail of [
    "gpt-5.5", "gpt-5.6", "codex", "cursor", "ox-alpha", "hy3", "opus", "deepseek",
    "muse-spark", "glm-", "zai", "opencode-go", "openrouter", "provider/",
  ]) {
    assert.ok(!lowered.includes(routeDetail), `instruction text must not enumerate route detail "${routeDetail}"`);
  }
  // Generated permanent prompt content stays route-free for every family and
  // the shipped gate sizes.
  const snapshot = loadRoutingSnapshot();
  const guidelines = delegateRunPromptGuidelines(
    roleIdsInFamily(snapshot, "solution"),
    roleIdsInFamily(snapshot, "review"),
  ).join("\n");
  for (const routeDetail of ["gpt-5.5", "gpt-5.6", "codex", "glm-", "zai"]) {
    assert.ok(!guidelines.includes(routeDetail), `guidelines must not contain ${routeDetail}`);
  }
});

test("the parent guidelines stay count-aware over the shipped snapshot", () => {
  const snapshot = loadRoutingSnapshot();
  const guidelines = delegateRunPromptGuidelines(
    roleIdsInFamily(snapshot, "solution"),
    roleIdsInFamily(snapshot, "review"),
  );
  assert.equal(guidelines.length, 24);
  assert.match(guidelines.join("\n"), /solution-a, solution-b, solution-c, solution-d, solution-e, and solution-f concurrently/);
  assert.match(guidelines.join("\n"), /review-a, review-b, review-c, review-d, and review-e concurrently/);
});
