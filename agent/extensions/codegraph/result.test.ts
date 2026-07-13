import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_BYTES } from "./constants.ts";
import { textResult } from "./result.ts";

test("leaves normal upstream-sized Explore output intact", () => {
  const output = "x".repeat(24_000);
  const result = textResult(output);
  const truncation = result.details.truncation as { readonly truncated: boolean };

  assert.equal(result.content[0]?.text, output);
  assert.equal(truncation.truncated, false);
});

test("marks output that exceeds Pi's emergency cap", () => {
  const output = "x".repeat(DEFAULT_MAX_BYTES + 1);
  const result = textResult(output);
  const truncation = result.details.truncation as { readonly truncated: boolean };

  assert.equal(truncation.truncated, true);
  assert.match(result.content[0]?.text ?? "", /\[Output truncated:/);
});

test("keeps the emergency truncation marker outside an exact source fence", () => {
  const output = `\`\`\`typescript\n${"x".repeat(DEFAULT_MAX_BYTES + 1)}`;
  const text = textResult(output).content[0]?.text ?? "";

  assert.equal((text.match(/^```[^`\r\n]*\r?$/gm) ?? []).length % 2, 0);
  assert.match(text, /\n```\n\n\[Output truncated:/);
});

test("does not treat a four-backtick block as an exact source fence", () => {
  const output = `\`\`\`\`typescript\n${"x".repeat(DEFAULT_MAX_BYTES + 1)}`;
  const text = textResult(output).content[0]?.text ?? "";

  assert.doesNotMatch(text, /\n```\n\n\[Output truncated:/);
});
