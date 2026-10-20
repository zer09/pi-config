import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

// Scope these checks to active routing and its safety boundaries, not historical evidence.
test("global agent instructions retire both tool families and route local work through native tools", () => {
  const routing = read("agent/AGENTS.md").split("## Tool routing\n")[1].split("\n## ")[0];
  assert.match(routing, /CodeGraph \(`codegraph_\*`\) and Context Mode \(`ctx_\*`\) are retired and unavailable/);
  assert.match(routing, /Do not re-enable either extension or bypass retirement with direct extension loads, explicit `-e` entries, child-profile changes, or their CLIs/);
  assert.match(routing, /not an absolute shell or OS security boundary/);
  assert.match(routing, /use native `read` for targeted files and bounded `bash` searches for symbols, callers, and dependencies/);
  assert.match(routing, /Use bounded `bash` diagnostics for tests, builds, lints, typechecks, logs, and large output/);
});

test("ADR 0002 supersedes provider and routing guidance with a valid ADR 0010 retirement link", () => {
  const status = read("docs/adr/0002-codegraph-replaces-codebase-memory-mcp.md").split("## Status\n")[1].split("\n## ")[0];
  assert.match(status, /Provider and routing guidance is superseded by/);
  assert.match(status, /remaining sections preserve the migration history/);
  assert.doesNotMatch(status, /CodeGraph remains the active/);
  const link = status.match(/\[ADR 0010 retirement amendment\]\(([^)#]+)#([^)]+)\)/);
  assert.ok(link, "Status must link to the scoped retirement amendment");
  const [, target, anchor] = link;
  assert.equal(target, "0010-delegated-child-resource-isolation.md");
  const retirement = read(`docs/adr/${target}`);
  const headings = [...retirement.matchAll(/^#{1,6} (.+)$/gm)].map(([, heading]) =>
    heading.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-"));
  assert.ok(headings.includes(anchor), "The relative ADR target must contain the linked heading anchor");
  assert.equal(anchor, "parent-retirement-amendment-packages-retained");
});

test("the three retained skills use native reads and bounded shell without retired tools", () => {
  for (const name of ["grill-with-docs", "improve-codebase-architecture", "convert-documents-to-markdown"]) {
    const text = read(`agent/skills/${name}/SKILL.md`);
    assert.doesNotMatch(text, /CodeGraph|Context Mode|codegraph_|ctx_/);
    assert.match(text, /native (?:file reads|shell commands)/);
    assert.match(text, /bounded shell|[Bb]ounded native shell/);
  }
});

test("native routing preserves planning pauses and explicit documentation-write authority", () => {
  const grill = read("agent/skills/grill-with-docs/SKILL.md");
  const architecture = read("agent/skills/improve-codebase-architecture/SKILL.md");
  assert.match(grill, /without changing repository files by default/);
  assert.match(grill, /Ask one material question at a time and wait for feedback/);
  assert.match(grill, /Agreement on a term or decision.*not authorization to write/);
  assert.match(grill, /Keep `CONTEXT.md` a domain glossary only/);
  assert.match(grill, /An offer or conversational agreement is not permission to create it/);
  assert.match(architecture, /bounded span of recent Git history/);
  assert.match(architecture, /Choosing a candidate authorizes exploration, not implementation or documentation writes/);
  assert.match(architecture, /Stop here until the user chooses a candidate/);
  assert.match(architecture, /Repository reports require explicit repository-change instruction/);
  assert.match(architecture, /Use.*LANGUAGE.md.*project's `CONTEXT.md` for domain terms/);
});

test("conversion inspection keeps stdout, ephemeral, privacy, retry, and output boundaries", () => {
  const text = read("agent/skills/convert-documents-to-markdown/SKILL.md");
  assert.match(text, /Prefer stdout for read-only inspection/);
  assert.match(text, /Persistent `-o` \/ `--output` requires requested or authorized output/);
  assert.match(text, /only if host policy permits.*task-scoped temporary directory outside the repository/);
  assert.match(text, /Remove only task-created artifacts after checking symlink boundaries/);
  assert.match(text, /Do not turn inspection into persistent repository changes/);
  assert.match(text, /known unredacted sensitive data/);
  assert.match(text, /Only exit `3` \/ `NeedsOcr` permits one hosted invocation/);
  assert.match(text, /whole-PDF\/privacy\/possible-cost\/rate-limit notice.*before retry/);
  assert.match(text, /Explicit opt-outs and host sensitive-data\/redaction rules still win/);
  assert.match(text, /No local exit `1`\/`2` or failed hosted call permits retry/);
  assert.match(text, /Missing offline resources must stop; never retry online/);
});

test("maintenance preserves retirement, authenticated gh, and full native Linear reads", () => {
  const invariants = read("docs/skills/local-skill-update-invariants.md");
  assert.match(invariants, /CodeGraph.*and Context Mode.*are retired/);
  assert.match(invariants, /Do not restore mandatory use, re-enable either extension, load it explicitly/);
  assert.match(invariants, /use its CLI to bypass retirement/);
  assert.match(invariants, /not an OS security boundary/);
  assert.match(invariants, /`gh-cli` skill and authenticated `gh` CLI with native `bash`/);
  assert.match(invariants, /full read responses enter context without intentional summarizing, filtering, or bounding/);
  assert.match(invariants, /Retrieve hard-truncated missing sections with the Linear CLI/);
  assert.match(invariants, /Require explicit user instruction for exact remote mutations/);
  assert.match(invariants, /local adaptations do not require upstream retrieval or source-pin changes/);
});
