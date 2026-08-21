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
  assert.match(guidelines, /review-a, review-b, review-c, and review-d concurrently/);
  // Solution delegates gather evidence and propose options; the parent stays
  // the sole author and owner of the final plan or research deliverable.
  assert.match(guidelines, /Solution delegates may gather evidence and propose options, but the parent verifies the evidence, synthesizes conclusions, and remains sole author and owner of the final plan or research deliverable/);
  // Oracle policy: one fresh read-only oracle after a required solution gate,
  // the exact main-model skip condition, advisory-only authority that never
  // authors or saves the final plan, and the neutral oracle prompt contents.
  assert.match(guidelines, /After a required solution gate, call delegate_run for exactly one fresh read-only oracle review of the draft solution contract/);
  assert.match(guidelines, /only when the parent session's current model is not exactly gpt-5\.6-sol; when it is gpt-5\.6-sol, skip the oracle and finalize the solution contract directly/);
  assert.match(guidelines, /Give the oracle role the neutral problem, governing documents, verified evidence, the draft solution contract, constraints, and unresolved uncertainties; do not give it raw investigator reports or the parent's synthesis rationale/);
  assert.match(guidelines, /Treat the oracle as advisory, not the final authority: the oracle critiques the parent draft but never authors or saves the final plan/);
  assert.match(guidelines, /Verify its VALID or REVISE analysis like any other evidence/);
  assert.match(guidelines, /run no automatic oracle loop; a non-completed oracle run blocks implementation/);
  assert.match(guidelines, /backend=zai or backend=claude is invalid for the oracle role/);
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
  assert.match(guidelines, /fresh four-reviewer gate until no blocking findings remain/);
  // Git transitions and hosted writes never ride on a completed delegate.
  assert.match(guidelines, /require separate explicit authorization/);

  // Role routes live in routes.ts; model-visible guidelines stay route-free.
  // The oracle main-Sol skip condition is the one sanctioned model mention:
  // every gpt-5.6 reference must be the exact gpt-5.6-sol condition, and no
  // provider route map detail may appear. Compare lowercased text so mixed-case
  // reintroductions still fail.
  const lowered = guidelines.toLowerCase();
  for (const routeDetail of ["gpt-5.5", "codex", "cursor", "ox-alpha", "hy3", "opus", "deepseek", "muse-spark", "glm-"]) {
    assert.ok(!lowered.includes(routeDetail), `route detail "${routeDetail}" must not appear in prompt guidelines`);
  }
  const modelMentions = lowered.match(/gpt-5\.6[a-z0-9.-]*/g) ?? [];
  assert.ok(modelMentions.length > 0, "the exact main-Sol skip condition must appear in prompt guidelines");
  for (const mention of modelMentions) {
    assert.equal(mention, "gpt-5.6-sol", `only the exact gpt-5.6-sol condition may appear, found "${mention}"`);
  }
});
