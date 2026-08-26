#!/usr/bin/env node
/**
 * Regenerates the marked model-visible instruction sections of
 * docs/delegated-pi-loop-agent-instructions.md from the canonical exports in
 * instructions.ts and the shipped routing snapshot. Run from anywhere:
 *
 *   node render-instructions-doc.ts [path-to-markdown]
 *
 * Without an argument it targets the checked-in reference document relative
 * to this module. Exits nonzero when a marker is missing, and prints a diff
 * summary when content changed. No external dependencies.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyInstructionDocSections, renderInstructionDocSections } from "./docsync.ts";
import { loadRoutingSnapshot } from "./routing.ts";

const defaultDocPath = fileURLToPath(
  new URL("../../../docs/delegated-pi-loop-agent-instructions.md", import.meta.url),
);

const docPath = process.argv[2] === undefined ? defaultDocPath : path.resolve(process.argv[2]!);
const markdown = await readFile(docPath, "utf8");
const updated = applyInstructionDocSections(markdown, renderInstructionDocSections(loadRoutingSnapshot()));
if (updated === markdown) {
  console.log(`instruction doc sections already current: ${docPath}`);
} else {
  await writeFile(docPath, updated, "utf8");
  console.log(`regenerated instruction doc sections: ${docPath}`);
}
