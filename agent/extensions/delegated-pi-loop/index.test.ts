import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("registration guidelines encode the automatic delegation policy without provider route details", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const guidelinesStart = source.indexOf("promptGuidelines: [");
  assert.ok(guidelinesStart >= 0, "promptGuidelines array not found");
  const guidelines = source.slice(guidelinesStart, source.indexOf("parameters:", guidelinesStart));

  // Delegation is automatic for repository implementation changes unless the
  // user opts out. Only trivial edits and parent-authored plan or research
  // deliverables bypass implementation delegation.
  assert.match(guidelines, /automatically for repository implementation changes unless the user explicitly opts out/);
  assert.match(guidelines, /The parent may directly make only a truly trivial edit with no behavior change or create and revise the plan and research deliverables defined below/);
  assert.match(guidelines, /the parent never manually implements a non-trivial or small implementation task/);
  // The parent owns planning and research deliverables: it authors them
  // directly, artifact writes are an explicit exception to automatic
  // delegation, and no implementation or remediation delegate may author,
  // research, or revise them. Plan/research artifacts are classified by
  // purpose, and a pure planning or research request runs no implementation
  // delegate, review gate, or remediation.
  assert.match(guidelines, /The parent owns planning and research deliverables: directly formulate, draft, edit, and save every plan, design note, investigation report, and research note, including repository artifacts such as PLAN\.md/);
  assert.match(guidelines, /Those artifact writes are an explicit exception to automatic delegation even when they change repository files/);
  assert.match(guidelines, /plan and research artifacts are distinguished by purpose, not only by file extension or location/);
  assert.match(guidelines, /Never call an implementation or remediation delegate to research, explore, formulate, draft, edit, save, or revise a plan or research deliverable/);
  assert.match(guidelines, /An implementation delegate executes only a parent-finalized implementation contract that changes product code, configuration, operational behavior, or implementation documentation/);
  assert.match(guidelines, /implementation documentation such as README updates, ADRs, changelogs, policy files, and documentation accompanying code/);
  assert.match(guidelines, /a remediation delegate corrects only verification-confirmed findings in such implementation work/);
  assert.match(guidelines, /A pure planning or research request runs no implementation delegate, implementation review gate, or remediation/);
  assert.match(guidelines, /if the user later approves implementation, that later request follows the existing implementation delegation and review workflow/);
  // Small tasks skip only the solution-investigation gate and the oracle, and
  // still delegate implementation.
  assert.match(guidelines, /small task with an accepted plan or an obvious established pattern skips the solution-investigation gate and the oracle role and still runs exactly one implementation delegate/);
  // The parent inspects the implementation diff and evidence before the review gate.
  assert.match(guidelines, /implementation delegate's diff and evidence/);
  assert.match(guidelines, /review-a, review-b, review-c, review-d, and review-e concurrently/);
  // Reviewer-gate waiver: the strict all-five default stands, and only the
  // user may explicitly waive named failed reviewer roles for the one
  // current gate. The waiver continues with completed reports, records the
  // waived roles, never relabels failures as passes, stays one-shot and
  // gate-scoped, keeps findings from completed reviewers, and is never
  // inferred from generic continue/commit/skip-retry requests.
  assert.match(guidelines, /all five must complete/);
  assert.match(guidelines, /the gate stays blocked by default; only the user may explicitly waive the named failed reviewer roles for that one current gate/);
  assert.match(guidelines, /continue with the completed review reports instead of retrying or stopping solely because the waived reviewers failed/);
  assert.match(guidelines, /A reviewer waiver is one-shot and gate-scoped/);
  assert.match(guidelines, /it changes no later gates, role schema, routing, or concurrency/);
  assert.match(guidelines, /state which reviewers were waived and that the gate completed under user waiver/);
  assert.match(guidelines, /never label a waived failure as a reviewer pass/);
  assert.match(guidelines, /does not dismiss findings from completed reviewers/);
  assert.match(guidelines, /Do not infer a reviewer waiver from a generic request to continue, commit, or skip retries/);
  assert.match(guidelines, /C may be waived for this gate, authorizes only that named waiver/);
  // Solution delegates gather evidence and propose options; the parent stays
  // the sole author and owner of the final plan or research deliverable.
  assert.match(guidelines, /Solution delegates may gather evidence and propose options, but the parent verifies the evidence, synthesizes conclusions, and remains sole author and owner of the final plan or research deliverable/);
  // Solution-gate waiver: the strict all-six default stands before synthesis,
  // and only the user may explicitly waive named failed solution roles for
  // the one current solution gate. The waiver continues synthesis from
  // completed reports plus parent-verified repository evidence, requires at
  // least one completed investigator (zero completed reports cannot be waived
  // into a synthesis), records the waived roles without relabeling failures,
  // stays one-shot and gate-scoped, preserves the advisory oracle and the
  // downstream implementation/review/verification/remediation rules, and is
  // never inferred from generic continue/commit/skip-retry requests.
  assert.match(guidelines, /solution-a, solution-b, solution-c, solution-d, solution-e, and solution-f concurrently/);
  assert.match(guidelines, /all six must complete before synthesis/);
  assert.match(guidelines, /the gate stays blocked by default; only the user may explicitly waive the named failed solution roles for that one current solution gate/);
  assert.match(guidelines, /continue synthesis using only the completed solution reports plus parent-verified repository evidence/);
  assert.match(guidelines, /At least one solution delegate must have completed: the user cannot waive the entire evidence set and synthesize from zero completed investigator reports/);
  assert.match(guidelines, /A solution waiver is one-shot and gate-scoped/);
  assert.match(guidelines, /it changes no later solution gates, role schema, routing, or concurrency/);
  assert.match(guidelines, /state which solution roles were waived and that the solution gate proceeded under user waiver/);
  assert.match(guidelines, /never label a waived failure as completed or passed/);
  assert.match(guidelines, /does not fabricate or dismiss evidence, resolve uncertainties, authorize implementation, replace parent evidence verification/);
  assert.match(guidelines, /skip the advisory oracle when otherwise required/);
  assert.match(guidelines, /weaken implementation, review, verification, or remediation rules/);
  assert.match(guidelines, /Do not infer a solution waiver from a generic request to continue, commit, or skip retries/);
  assert.match(guidelines, /solution C may be waived for this gate, authorizes only that named waiver/);
  // Oracle policy: one fresh read-only oracle after a required solution gate,
  // the configured-Oracle-model set skip condition, advisory-only authority
  // that never authors or saves the final plan, and the neutral oracle prompt
  // contents.
  assert.match(guidelines, /After a required solution gate, call delegate_run for exactly one fresh read-only oracle review of the draft solution contract/);
  assert.match(guidelines, /only when the parent session's current model is not one of the configured Oracle profile models; when it is, skip the oracle and finalize the solution contract directly/);
  assert.match(guidelines, /Give the oracle role the neutral problem, governing documents, verified evidence, the draft solution contract, constraints, and unresolved uncertainties; do not give it raw investigator reports or the parent's synthesis rationale/);
  assert.match(guidelines, /Treat the oracle as advisory, not the final authority: the oracle critiques the parent draft but never authors or saves the final plan/);
  assert.match(guidelines, /Verify its VALID or REVISE analysis like any other evidence/);
  assert.match(guidelines, /run no automatic oracle loop; a non-completed oracle run blocks implementation/);
  assert.doesNotMatch(guidelines, /Claude Code|backend=claude/);
  assert.match(guidelines, /only one implementation, remediation, or oracle role at a time/);
  // Blocking findings get fresh verification, only verification-confirmed findings
  // reach one focused remediation role, and fresh gates repeat until none remain.
  // Independent verifications run in bounded four-way batches, duplicates are
  // consolidated first, dependent findings stay sequential, and the parent waits
  // for the whole batch before remediation.
  assert.match(guidelines, /consolidate exact duplicate findings first/);
  assert.match(guidelines, /give each verification exactly one finding without sibling verification reports/);
  assert.match(guidelines, /overlap verification only with other verification delegates/);
  assert.match(guidelines, /Run independent finding verifications concurrently in batches of at most four/);
  assert.match(guidelines, /keep dependent findings sequential/);
  assert.match(guidelines, /wait for every verification in the current batch before remediation/);
  assert.match(guidelines, /non-completed verification leaves its finding unresolved without erasing completed sibling reports/);
  assert.match(guidelines, /Send only verification-confirmed findings to one focused remediation role/);
  assert.match(guidelines, /fresh five-reviewer gate until no blocking findings remain/);
  // Routing is automatic and config-driven; routingOverride is the only
  // exceptional escape hatch and is invalid for the oracle role.
  assert.match(guidelines, /Delegate routing, including model, thinking, and provider fallback after operational failures, is automatic from the extension-owned routing configuration/);
  assert.match(guidelines, /pass routingOverride only when the user or project explicitly requests an operational route change for that one run, never for the oracle role/);
  assert.match(guidelines, /routingOverride never changes role permissions or concurrency/);
  assert.match(guidelines, /do not retry outside the tool's bounded operational route fallback without user-authorized diagnosis/);
  // Git transitions and hosted writes never ride on a completed delegate.
  assert.match(guidelines, /require separate explicit authorization/);

  // Role routes live in routing.json; model-visible guidelines stay route-free.
  // The oracle skip condition references the configured Oracle models as a
  // set, so no concrete model id may appear in the guidelines at all. Compare
  // lowercased text so mixed-case reintroductions still fail.
  const lowered = guidelines.toLowerCase();
  for (const routeDetail of ["gpt-5.5", "gpt-5.6", "codex", "cursor", "ox-alpha", "hy3", "opus", "deepseek", "muse-spark", "glm-", "backend", "z.ai", "zai"]) {
    assert.ok(!lowered.includes(routeDetail), `route detail "${routeDetail}" must not appear in prompt guidelines`);
  }
});

test("the tool schema replaces routine backend selection with an exceptional routing override", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  // The routine backend parameter is gone from the model-visible schema.
  assert.doesNotMatch(source, /backend\s*:/);
  assert.doesNotMatch(source, /backend\?/);
  assert.doesNotMatch(source, /backend=/);
  // The exceptional override is optional with a mandatory non-empty reason.
  assert.match(source, /routingOverride: Type\.Optional\(RoutingOverrideParameters\)/);
  assert.match(source, /reason: Type\.String\(\{\s*\n\s*minLength: 1,/);
  assert.match(source, /excludeProviders: Type\.Optional\(Type\.Array\(Type\.String\(\{ minLength: 1 \}\), \{/);
});

test("public schema and runtime contain no direct Claude CLI backend", async () => {
  const files = ["index.ts", "routing.ts", "routes.ts", "runner.ts", "supervisor.ts", "types.ts"];
  const forbidden = [
    "ClaudeRoute", "CLAUDE_ROUTE", "superviseClaude", "spawn(\"claude\"", "--print",
    "--no-session-persistence", "permission-mode", "allowedTools", "disallowedTools",
    "claude-code/", "protocol: \"plain\"", "backend=claude",
    "DelegateBackend", "DELEGATE_BACKENDS",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    for (const value of forbidden) assert.ok(!source.includes(value), `${file} must not contain ${value}`);
  }
  const index = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(index, /StringEnum\(DELEGATE_ROLES/);
});

test("registers targeted delegate list and stop commands without a BTW control path", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const renderSource = await readFile(new URL("./render.ts", import.meta.url), "utf8");
  assert.match(source, /registerCommand\("delegate:list"/);
  assert.match(source, /const labels = active\.map\(activeDelegateLabel\)/);
  assert.match(source, /select\("Active delegates", labels\)/);
  assert.match(source, /setEditorText\(`\/delegate:stop \$\{delegate\.id\}`\)/);
  assert.match(source, /registerCommand\("delegate:stop"/);
  assert.match(source, /manager\.stop\(delegateId\)/);
  assert.match(source, /Delegate #\$\{delegateId\} is no longer active/);
  assert.match(renderSource, /`Delegate \$\{id\}`/);
  assert.match(renderSource, /`⏳ \$\{id\}\$\{progress\.label\}`/);
  assert.match(renderSource, /`\$\{id\}\$\{String\(state\)\}`/);
  assert.doesNotMatch(source, /btw:delegate/);
  // The live render surfaces bounded restart-after-work metadata.
  assert.match(renderSource, /restarts: \$\{progress\.restartAfterWorkCount\}/);
  assert.match(renderSource, /restarts after work: \$\{progress\.restartAfterWorkCount\}/);
  // The call render marks an exceptional override without route details.
  assert.match(renderSource, /args\.routingOverride !== undefined \? " override" : ""/);
});
