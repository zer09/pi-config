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

test("closes four-backtick and tilde fences with their matching delimiter", () => {
  const cases = [
    { output: `\`\`\`\`typescript\n${"x".repeat(DEFAULT_MAX_BYTES + 1)}`, closing: "````" },
    { output: `~~~typescript\n${"x".repeat(DEFAULT_MAX_BYTES + 1)}`, closing: "~~~" },
  ];

  for (const { output, closing } of cases) {
    const text = textResult(output).content[0]?.text ?? "";
    assert.match(text, new RegExp(`\\n${closing}\\n\\n\\[Output truncated:`));
    assert.doesNotMatch(text, /\n```\n\n\[Output truncated:/);
  }
});

test("omits only an extreme active fence block and updates retained-prefix counters", () => {
  const safePrefix = "summary\r\n";
  const opening = "~".repeat(1025);
  const result = textResult(`${safePrefix}${opening}\n${"x".repeat(DEFAULT_MAX_BYTES)}`);
  const truncation = result.details.truncation as {
    content: string;
    outputBytes: number;
    outputLines: number;
  };

  assert.equal(truncation.content, safePrefix);
  assert.equal(truncation.outputBytes, Buffer.byteLength(safePrefix));
  assert.equal(truncation.outputLines, 2);
  assert.match(result.content[0]?.text ?? "", /^summary\r\n\n\n\[Output truncated:/);
});
