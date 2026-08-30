import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHILD_ATTEMPT_BUDGET,
  CHILD_RECURSION_PROHIBITION,
  CHILD_TERMINAL_RESULT_INSTRUCTIONS,
  MODEL_CATALOG_PROMPT_GUIDELINES,
  REPORT_RECOVERY_PROMPT,
  RESTART_AFTER_WORK_NOTE,
  buildDelegatePrompt,
  composeDelegatePrompt,
  delegateRunPromptGuidelines,
  roleFamilyContract,
} from "./instructions.ts";
import { ROLE_FAMILIES, loadRoutingSnapshot, roleIdsInFamily, type ResolvedRole, type RoleFamily } from "./routing.ts";
import { BLOCKED_REASON_CODES, FAILED_REASON_CODES } from "./types.ts";

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
  assert.ok(!routes.includes("## Final protocol"), "routes.ts must not carry the child prompt template");
  assert.ok(!protocol.includes("The previous response lacked a valid final report"), "protocol.ts must not carry the recovery prompt");
  // The runtime consumes the centralized builders and text directly.
  assert.match(runner, /import \{ buildDelegatePrompt \} from "\.\/instructions\.ts";/);
  assert.match(supervisor, /import \{ REPORT_RECOVERY_PROMPT \} from "\.\/instructions\.ts";/);
  assert.match(supervisor, /protocol\.beginPrompt\(2, REPORT_RECOVERY_PROMPT\)/);
});

test("the restart note stays byte-exact and generic", () => {
  assert.equal(
    RESTART_AFTER_WORK_NOTE,
    "Restart: a prior route attempt may have changed the tree. Inspect current work first; treat it as authoritative, continue from it, and do not repeat irreversible actions.",
  );
  assert.ok(!RESTART_AFTER_WORK_NOTE.includes("://"));
});

test("the report-recovery prompt stays byte-exact and marker-focused", () => {
  assert.equal(
    REPORT_RECOVERY_PROMPT,
    `The previous response lacked a valid final report.

Do not repeat work or call tools. Using only existing session evidence, return one complete self-contained report.

Follow the original Final protocol. Include exactly one DELEGATE_RESULT line as the final nonblank line; for BLOCKED or FAILED, put one valid DELEGATE_REASON line directly above it; COMPLETED has none. Do not quote or discuss either marker.`,
  );
  assert.doesNotMatch(REPORT_RECOVERY_PROMPT, /evidence_inaccessible|execution_failure/);
});

test("the base child prompt embeds the generic recursion prohibition verbatim", () => {
  assert.equal(
    CHILD_RECURSION_PROHIBITION,
    "Do this role yourself. Do not start or orchestrate another agent process or subagent.",
  );
  // The prohibition names no parent tool: it must not mention or explain
  // delegate_run, so parent orchestration policy stays out of child context.
  assert.ok(!CHILD_RECURSION_PROHIBITION.includes("delegate_run"));
  for (const family of ROLE_FAMILIES) {
    const prompt = buildDelegatePrompt(familyRole(family), "/tmp/project", "Do the assigned work.");
    assert.match(prompt, /Do not start or orchestrate another agent process or subagent\./);
  }
});

test("the child owns semantic attempt limits while the supervisor owns time", () => {
  assert.match(CHILD_ATTEMPT_BUDGET, /at most two materially equivalent attempts/);
  assert.match(CHILD_ATTEMPT_BUDGET, /Repeat only when new evidence justifies it/);
  assert.match(CHILD_ATTEMPT_BUDGET, /report BLOCKED/);
  assert.doesNotMatch(CHILD_ATTEMPT_BUDGET, /minute|hour|clock|time/i);
});

test("terminal instructions derive every closed reason code and keep three exact forms", () => {
  for (const code of [...BLOCKED_REASON_CODES, ...FAILED_REASON_CODES]) {
    assert.ok(CHILD_TERMINAL_RESULT_INSTRUCTIONS.includes(code), `terminal instructions must list ${code}`);
  }
  assert.match(CHILD_TERMINAL_RESULT_INSTRUCTIONS, /DELEGATE_REASON: <blocked-code>\nDELEGATE_RESULT: BLOCKED/);
  assert.match(CHILD_TERMINAL_RESULT_INSTRUCTIONS, /DELEGATE_REASON: <failed-code>\nDELEGATE_RESULT: FAILED/);
  assert.match(CHILD_TERMINAL_RESULT_INSTRUCTIONS, /DELEGATE_RESULT appears once as the final nonblank line/);
  assert.match(CHILD_TERMINAL_RESULT_INSTRUCTIONS, /reviews with findings use COMPLETED/);
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
  assert.match(smuggled, /## Role\n\ncontract/);
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
  // The general override mechanism remains user-controlled instruction
  // precedence and must never become part of a delegated workflow.
  assert.match(agents, /## User overrides/);
  assert.match(agents, /begins with `OVERRIDE:`/);
  assert.match(agents, /Never ask or suggest that the user write an `OVERRIDE:` directive/);
  assert.match(agents, /cannot supersede actual platform system or developer instructions/);
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

test("the parent guidelines stay dynamic, compact, and tool-attributed", () => {
  const snapshot = loadRoutingSnapshot();
  const guidelines = delegateRunPromptGuidelines(
    roleIdsInFamily(snapshot, "solution"),
    roleIdsInFamily(snapshot, "review"),
  );
  assert.equal(guidelines.length, 15);
  assert.ok(guidelines.every((line) => line.startsWith("delegate_run ")));
  const text = guidelines.join("\n");
  assert.match(text, /solution-a, solution-b, solution-c, solution-d, solution-e, solution-f, solution-g, solution-h, and solution-i concurrently/);
  assert.match(text, /review-a, review-b, and review-c concurrently/);
  assert.match(text, /wait for every role/);
  assert.match(text, /follow the user's next instruction/);
  assert.match(text, /continue, resume, or retry requires no special syntax/);
  assert.doesNotMatch(text, /OVERRIDE:/);
  assert.match(text, /at least one completed report/);
  assert.ok(text.length < 7_000, "the compact parent workflow must stay within its character budget");
  assert.ok(MODEL_CATALOG_PROMPT_GUIDELINES.every((line) => line.startsWith("delegate_model_catalog:")));
});
