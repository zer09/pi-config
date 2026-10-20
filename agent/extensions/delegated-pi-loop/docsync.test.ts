import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { posix } from "node:path";
import {
  INSTRUCTION_DOC_SECTION_IDS,
  applyInstructionDocSections,
  extractInstructionDocSections,
  renderInstructionDocSections,
} from "./docsync.ts";
import { CHILD_ATTEMPT_BUDGET, DELEGATE_RUN_TOOL } from "./instructions.ts";

const DOC_URL = new URL("../../../docs/delegated-pi-loop-agent-instructions.md", import.meta.url);

test("the checked-in instruction document sections match the canonical exports", async () => {
  const markdown = await readFile(DOC_URL, "utf8");
  const checked = extractInstructionDocSections(markdown);
  const rendered = renderInstructionDocSections();
  const guidelines = rendered.get("delegate-run-guidelines") ?? "";
  assert.match(guidelines, /`<all configured solution roles>`/);
  assert.match(guidelines, /`<all configured review roles>`/);
  assert.ok(rendered.get("delegate-run-tool")?.includes(`- **Description:** ${DELEGATE_RUN_TOOL.description}`));
  assert.ok(rendered.get("child-prompt-template")?.includes(`## Attempt limits\n\n${CHILD_ATTEMPT_BUDGET}\n\n## Final protocol`));
  // Exactly the managed sections are present: none missing, none stale.
  assert.deepEqual(
    [...checked.keys()].sort(),
    [...INSTRUCTION_DOC_SECTION_IDS].slice().sort(),
    "the document must carry exactly the managed instruction sections",
  );
  for (const id of INSTRUCTION_DOC_SECTION_IDS) {
    assert.equal(
      checked.get(id),
      rendered.get(id),
      `the checked-in "${id}" section must match the canonical instruction exports`,
    );
  }
});

test("applying the rendered sections is idempotent", async () => {
  const markdown = await readFile(DOC_URL, "utf8");
  const rendered = renderInstructionDocSections();
  const updated = applyInstructionDocSections(markdown, rendered);
  assert.equal(updated, markdown, "the checked-in document must already be regenerated");
  // A drifted section is repaired by apply and detected again by extract.
  const drifted = markdown.replace(
    "Restart: a prior route attempt",
    "Restart: a tampered route attempt",
  );
  const repaired = applyInstructionDocSections(drifted, rendered);
  assert.notEqual(repaired, drifted);
  assert.equal(
    extractInstructionDocSections(repaired).get("restart-note"),
    rendered.get("restart-note"),
  );
});

test("current manual runtime profiles match the production resource policy", async () => {
  const policy = JSON.parse(await readFile(new URL("./resources.json", import.meta.url), "utf8")) as {
    extensions: { runtime: string[]; catalog: string[] };
  };
  const runtime = policy.extensions.runtime.map((entry) => posix.normalize(posix.join("delegated-pi-loop", entry)));
  const catalog = policy.extensions.catalog.map((entry) => posix.normalize(posix.join("delegated-pi-loop", entry)));
  const reference = await readFile(DOC_URL, "utf8");
  const maintenance = await readFile(new URL("../../../docs/skills/delegated-pi-loop-update-process.md", import.meta.url), "utf8");
  const adr = await readFile(new URL("../../../docs/adr/0010-delegated-child-resource-isolation.md", import.meta.url), "utf8");
  for (const [text, pattern] of [
    [reference, /The child receives exactly these extensions, in order:\n\n([\s\S]*?)\n\n/],
    [maintenance, /2\. The runtime child explicitly loads exactly five extension entry files in policy order: ([^\n]+)/],
    [adr, /The current runtime child profile loads exactly five extension entry files, in this order:\n\n([\s\S]*?)\n\n/],
  ] as const) {
    const section = text.match(pattern)?.[1];
    assert.ok(section, "the current runtime profile must be documented");
    assert.deepEqual([...section.matchAll(/`([\w/-]+\.ts)`/g)].map((match) => match[1]), runtime);
  }
  const catalogSection = maintenance.match(/3\. The catalog preflight loads exactly ([^\n]+?) and never loads/)?.[1];
  assert.ok(catalogSection);
  assert.deepEqual([...catalogSection.matchAll(/`([\w/-]+\.ts)`/g)].map((match) => match[1]), catalog);
  assert.match(reference, /3 web tools plus 4 core tools = 7/);
  assert.match(maintenance, /7 tools: 4 core plus 3 web/);
  assert.match(adr, /7 model-visible tools: 4 core tools plus 3 from `web-search`/);
});

test("extract fails closed on a duplicated section", () => {
  const block = [
    "<!-- pi-delegated-instructions:begin:restart-note -->",
    "content",
    "<!-- pi-delegated-instructions:end:restart-note -->",
    "<!-- pi-delegated-instructions:begin:restart-note -->",
    "content",
    "<!-- pi-delegated-instructions:end:restart-note -->",
  ].join("\n");
  assert.throws(() => extractInstructionDocSections(block), /duplicated instruction doc section/);
});
