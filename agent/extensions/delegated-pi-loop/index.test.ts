import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("registration guidelines encode the automatic delegation policy without provider route details", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const guidelinesStart = source.indexOf("promptGuidelines: [");
  assert.ok(guidelinesStart >= 0, "promptGuidelines array not found");
  const guidelines = source.slice(guidelinesStart, source.indexOf("parameters:", guidelinesStart));

  // Delegation is automatic for repository changes; only the user can opt out,
  // and only a truly trivial edit may bypass delegation entirely.
  assert.match(guidelines, /automatically for repository changes unless the user explicitly opts out/);
  assert.match(guidelines, /only a truly trivial edit, such as one typo with no behavior change, may be implemented directly by the parent/);
  // Small tasks skip only the solution-investigation gate and the oracle, and
  // still delegate implementation.
  assert.match(guidelines, /small task with an accepted plan or an obvious established pattern skips the solution-investigation gate and the oracle role and still runs exactly one implementation delegate/);
  // The parent inspects the implementation diff and evidence before the review gate.
  assert.match(guidelines, /implementation delegate's diff and evidence/);
  assert.match(guidelines, /review-a, review-b, review-c, and review-d concurrently/);
  // Oracle policy: one fresh read-only oracle after a required solution gate,
  // the exact main-model skip condition, advisory-only authority, and the
  // neutral oracle prompt contents.
  assert.match(guidelines, /After a required solution gate, call delegate_run for exactly one fresh read-only oracle review of the draft solution contract/);
  assert.match(guidelines, /only when the parent session's current model is not exactly gpt-5\.6-sol; when it is gpt-5\.6-sol, skip the oracle and finalize the solution contract directly/);
  assert.match(guidelines, /Give the oracle role the neutral problem, governing documents, verified evidence, the draft solution contract, constraints, and unresolved uncertainties; do not give it raw investigator reports or the parent's synthesis rationale/);
  assert.match(guidelines, /Treat the oracle as advisory, not the final authority: verify its VALID or REVISE analysis/);
  assert.match(guidelines, /run no automatic oracle loop; a non-completed oracle run blocks implementation/);
  assert.match(guidelines, /backend=zai or backend=claude is invalid for the oracle role/);
  assert.match(guidelines, /only one implementation, remediation, or oracle role at a time/);
  // Blocking findings get fresh verification, only verification-confirmed findings
  // reach one focused remediation role, and fresh gates repeat until none remain.
  assert.match(guidelines, /verification role, send only verification-confirmed findings to one focused remediation role/);
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
