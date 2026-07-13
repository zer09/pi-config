import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_BYTES } from "./constants.ts";
import { textResult } from "./result.ts";
import type { CodeGraphInstance } from "./types.ts";
import { executeUpstreamExplore, loadUpstreamToolHandler } from "./upstream-explore.ts";

const EXACT_MARKER = "... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)";
const WARNING_START = "> ⚠️ Upstream Explore output truncated to budget inside the final source block";
const COMPATIBILITY = /CodeGraph .*compatibility error.*private adapter must be reviewed/is;

async function executeResult(result: unknown): Promise<string> {
  class Handler { async executeReadTool(): Promise<unknown> { return result; } }
  return executeUpstreamExplore({} as CodeGraphInstance, { query: "characterization" }, () => Handler);
}

test("characterization: sparse content arrays are rejected as malformed", async () => {
  const content = new Array(2);
  content[1] = { type: "text", text: "survives-map-hole" };
  await assert.rejects(executeResult({ content }), COMPATIBILITY);
});

test("characterization: near-maximum sparse arrays are rejected without walking their length", async () => {
  const content: unknown[] = [];
  content.length = 0xffff_ffff;
  content[0] = { type: "text", text: "first" };

  await assert.rejects(executeResult({ content }), /compatibility error.*sparse content array/is);
});

test("characterization: executeReadTool getters are wrapped as instance-shape compatibility failures", async () => {
  class Handler { get executeReadTool(): never { throw new TypeError("executeReadTool-getter-sentinel"); } }
  await assert.rejects(
    executeUpstreamExplore({} as CodeGraphInstance, { query: "x" }, () => Handler as never),
    /compatibility error.*executeReadTool-getter-sentinel.*private adapter must be reviewed/is,
  );
});

test("characterization: throwing result accessors are wrapped as private-result compatibility failures", async () => {
  const result = Object.defineProperty({}, "content", {
    get(): never { throw new TypeError("result-content-getter-sentinel"); },
  });
  await assert.rejects(executeResult(result), /compatibility error.*result-content-getter-sentinel.*private adapter must be reviewed/is);
});

test("characterization: throwing block accessors are wrapped as private-result compatibility failures", async () => {
  const block = Object.defineProperty({}, "type", {
    get(): never { throw new TypeError("block-type-getter-sentinel"); },
  });
  await assert.rejects(executeResult({ content: [block] }), /compatibility error.*block-type-getter-sentinel.*private adapter must be reviewed/is);
});

test("characterization: ToolHandler export getters are wrapped as module-shape compatibility failures", () => {
  const loaded = Object.defineProperty({}, "ToolHandler", {
    get(): never { throw new TypeError("ToolHandler-export-getter-sentinel"); },
  });
  assert.throws(
    () => loadUpstreamToolHandler(() => loaded, "fuzzos", "fuzzarch"),
    /compatibility error.*ToolHandler-export-getter-sentinel.*private adapter must be reviewed/is,
  );
});

test("characterization: plain-object constructor throws retain their useful reason", async () => {
  class Handler { constructor() { throw { message: "object-constructor-sentinel" }; } }
  await assert.rejects(
    executeUpstreamExplore({} as CodeGraphInstance, { query: "x" }, () => Handler as never),
    /compatibility error.*object-constructor-sentinel.*private adapter must be reviewed/is,
  );
});

test("characterization: hostile thrown proxies cannot escape compatibility wrapping", async () => {
  const hostile = new Proxy({}, {
    get(): never { throw new TypeError("hostile-get"); },
    getPrototypeOf(): never { throw new TypeError("hostile-prototype"); },
  });
  class Handler { constructor() { throw hostile; } }

  await assert.rejects(
    executeUpstreamExplore({} as CodeGraphInstance, { query: "x" }, () => Handler as never),
    /compatibility error.*object thrown without a string message or reason.*private adapter must be reviewed/is,
  );
});

test("characterization: platform loader failures include private-adapter review guidance", () => {
  assert.throws(
    () => loadUpstreamToolHandler(() => { throw new Error("loader-sentinel"); }, "fuzzos", "fuzzarch"),
    /CodeGraph .*@colbymchenry\/codegraph-fuzzos-fuzzarch.*loader-sentinel.*private adapter must be reviewed/is,
  );
});

test("characterization: a simplified near-miss budget marker leaves odd Markdown unchanged", async () => {
  const input = "```ts\n1\tbody\n... (output truncated to budget; the source above is complete and verbatim)";
  assert.equal(await executeResult({ content: [{ type: "text", text: input }] }), input);
});

test("characterization: inline triple backticks do not count as source fences", async () => {
  const input = `\`\`\`inline\`\`\`\n${EXACT_MARKER}`;
  assert.equal(await executeResult({ content: [{ type: "text", text: input }] }), input);
});

test("characterization: four-backtick fences do not count as triple source fences", async () => {
  const input = `\`\`\`\`typescript\nliteral\n${EXACT_MARKER}`;
  assert.equal(await executeResult({ content: [{ type: "text", text: input }] }), input);
});

test("characterization: CRLF repair preserves the marker line ending before suffix text", async () => {
  const input = ["```ts", "1\tbody", EXACT_MARKER, "suffix"].join("\r\n");
  const output = await executeResult({ content: [{ type: "text", text: input }] });
  assert.ok(output.includes(`${WARNING_START}`));
  assert.ok(output.includes("specific names for omitted areas.\r\nsuffix"));
});

test("characterization: mixed-newline repair follows the local marker LF style", async () => {
  const input = `intro\r\n\`\`\`ts\n1\tbody\n${EXACT_MARKER}\nsuffix`;
  const output = await executeResult({ content: [{ type: "text", text: input }] });
  assert.ok(output.includes(`1\tbody\n\`\`\`\n\n${WARNING_START}`));
});

test("characterization: Pi emergency truncation does not re-break a repaired fence", async () => {
  const input = `\`\`\`ts\n${"x".repeat(DEFAULT_MAX_BYTES + 2_048)}\n${EXACT_MARKER}`;
  const repaired = await executeResult({ content: [{ type: "text", text: input }] });
  assert.equal((repaired.match(/^```[^`\r\n]*\r?$/gm) ?? []).length % 2, 0);
  const capped = textResult(repaired).content[0]!.text;
  assert.match(capped, /\[Output truncated:/);
  assert.equal((capped.match(/^```[^`\r\n]*\r?$/gm) ?? []).length % 2, 0);
});
