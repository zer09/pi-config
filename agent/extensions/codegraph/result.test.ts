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
