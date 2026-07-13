import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "./constants.ts";
import { textResult } from "./result.ts";

function visibleText(input: string): string {
  return textResult(input).content[0]!.text;
}

test("characterization: lone-CR logical lines cannot bypass the emergency line cap", () => {
  const input = Array.from({ length: DEFAULT_MAX_LINES + 1 }, (_, index) => `L${index}`).join("\r");
  const truncation = textResult(input).details.truncation as { truncated: boolean; totalLines: number; outputLines: number };

  assert.equal(truncation.totalLines, DEFAULT_MAX_LINES + 1);
  assert.equal(truncation.truncated, true);
  assert.ok(truncation.outputLines <= DEFAULT_MAX_LINES);
});

test("characterization: lone-CR counters remain truthful when the byte cap truncates", () => {
  const input = `\`\`\`ts\rbody\r${"x".repeat(DEFAULT_MAX_BYTES + 32)}`;
  const truncation = textResult(input).details.truncation as { totalLines: number; outputLines: number };

  assert.equal(truncation.totalLines, 3);
  assert.equal(truncation.outputLines, 3);
});

test("characterization: attacker-controlled fence closure has fixed bounded overhead", () => {
  const openingLength = DEFAULT_MAX_BYTES - 2;
  const input = "`".repeat(openingLength) + "\n" + "x".repeat(DEFAULT_MAX_BYTES);
  const outputBytes = Buffer.byteLength(visibleText(input), "utf8");

  assert.ok(outputBytes <= DEFAULT_MAX_BYTES + 2048, `final output was ${outputBytes} bytes`);
});
