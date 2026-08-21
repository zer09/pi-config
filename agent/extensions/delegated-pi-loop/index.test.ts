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
  // Small tasks skip only the solution-investigation gate and still delegate implementation.
  assert.match(guidelines, /small task with an accepted plan or an obvious established pattern skips the solution-investigation gate and still runs exactly one implementation delegate/);
  // The parent inspects the implementation diff and evidence before the review gate.
  assert.match(guidelines, /implementation delegate's diff and evidence/);
  assert.match(guidelines, /review-a, review-b, review-c, and review-d concurrently/);
  // Blocking findings get fresh verification, only verification-confirmed findings
  // reach one focused remediation role, and fresh gates repeat until none remain.
  assert.match(guidelines, /verification role, send only verification-confirmed findings to one focused remediation role/);
  assert.match(guidelines, /fresh four-reviewer gate until no blocking findings remain/);
  // Git transitions and hosted writes never ride on a completed delegate.
  assert.match(guidelines, /require separate explicit authorization/);

  // Role routes live in routes.ts; model-visible guidelines stay route-free.
  // Compare lowercased text so mixed-case reintroductions still fail.
  const lowered = guidelines.toLowerCase();
  for (const routeDetail of ["gpt-5.5", "gpt-5.6", "codex", "cursor", "ox-alpha", "hy3", "opus", "deepseek", "muse-spark", "glm-"]) {
    assert.ok(!lowered.includes(routeDetail), `route detail "${routeDetail}" must not appear in prompt guidelines`);
  }
});
