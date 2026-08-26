import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  INSTRUCTION_DOC_SECTION_IDS,
  applyInstructionDocSections,
  extractInstructionDocSections,
  renderInstructionDocSections,
} from "./docsync.ts";
import { loadRoutingSnapshot } from "./routing.ts";

const DOC_URL = new URL("../../../docs/delegated-pi-loop-agent-instructions.md", import.meta.url);

test("the checked-in instruction document sections match the canonical exports", async () => {
  const markdown = await readFile(DOC_URL, "utf8");
  const checked = extractInstructionDocSections(markdown);
  const rendered = renderInstructionDocSections(loadRoutingSnapshot());
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
      `the checked-in "${id}" section must match the canonical exports for the shipped routing snapshot`,
    );
  }
});

test("applying the rendered sections is idempotent", async () => {
  const markdown = await readFile(DOC_URL, "utf8");
  const rendered = renderInstructionDocSections(loadRoutingSnapshot());
  const updated = applyInstructionDocSections(markdown, rendered);
  assert.equal(updated, markdown, "the checked-in document must already be regenerated");
  // A drifted section is repaired by apply and detected again by extract.
  const beginMarker = `<!-- pi-delegated-instructions:begin:restart-note -->`;
  const drifted = markdown.replace(
    beginMarker,
    beginMarker,
  ).replace("Restart note: a previous route attempt", "Restart note: a tampered route attempt");
  const repaired = applyInstructionDocSections(drifted, rendered);
  assert.notEqual(repaired, drifted);
  assert.equal(
    extractInstructionDocSections(repaired).get("restart-note"),
    rendered.get("restart-note"),
  );
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
