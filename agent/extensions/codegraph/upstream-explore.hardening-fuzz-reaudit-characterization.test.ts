import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_BYTES } from "./constants.ts";
import { textResult } from "./result.ts";
import type { CodeGraphInstance } from "./types.ts";
import { executeUpstreamExplore } from "./upstream-explore.ts";

const EXACT_MARKER =
  "... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. " +
  "For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)";

async function adapt(input: string): Promise<string> {
  class Handler { executeReadTool() { return { content: [{ type: "text", text: input }] }; } }
  return executeUpstreamExplore({} as CodeGraphInstance, { query: "reaudit-characterization" }, () => Handler);
}

test("characterization: emergency-cap closure recognizes an opening fence when the cap splits CRLF", () => {
  const retainedPrefix = `${"x".repeat(DEFAULT_MAX_BYTES - 5)}\n\`\`\`\r`;
  assert.equal(Buffer.byteLength(retainedPrefix, "utf8"), DEFAULT_MAX_BYTES);
  const output = textResult(`${retainedPrefix}tail`).content[0]!.text;

  assert.match(output, /\n```\r\n```\n\n\[Output truncated:/);
});

test("characterization: lone-CR Markdown line endings preserve repair locality", async () => {
  const input = `\`\`\`ts\r1\tbody\r${EXACT_MARKER}`;
  const expected = `\`\`\`ts\r1\tbody\r\`\`\`\r\r> ⚠️ Upstream Explore output truncated to budget inside the final source block. The visible source lines are verbatim, but the final block is incomplete. Run another codegraph_explore with specific names for omitted areas.`;
  assert.equal(await adapt(input), expected);
});

test("characterization: exact triple-looking text inside a four-backtick block does not trigger repair", async () => {
  const input = `\`\`\`\`markdown\n\`\`\`\n${EXACT_MARKER}\n\`\`\`\``;
  assert.equal(await adapt(input), input);
});

test("characterization: exact triple-looking text inside a tilde block does not trigger repair", async () => {
  const input = `~~~markdown\n\`\`\`\n${EXACT_MARKER}\n~~~`;
  assert.equal(await adapt(input), input);
});

test("characterization: emergency cap does not add a triple closure for literal text inside a four-backtick block", () => {
  const input = `\`\`\`\`markdown\n\`\`\`\n${"x".repeat(DEFAULT_MAX_BYTES + 64)}\n\`\`\`\``;
  const output = textResult(input).content[0]!.text;
  assert.doesNotMatch(output, /\n```\n\n\[Output truncated:/);
});

test("characterization: invoking a proxied method does not read its arbitrary call property", async () => {
  const method = new Proxy(
    function executeReadTool() { return { content: [{ type: "text", text: "proxied-ok" }] }; },
    { get(target, property, receiver) {
      if (property === "call") throw new TypeError("method-call-getter-sentinel");
      return Reflect.get(target, property, receiver);
    } },
  );
  class Handler { get executeReadTool() { return method; } }

  assert.equal(
    await executeUpstreamExplore({} as CodeGraphInstance, { query: "proxied-method" }, () => Handler),
    "proxied-ok",
  );
});
