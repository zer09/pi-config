import assert from "node:assert/strict";
import test from "node:test";
import { scanMarkdownFences } from "./markdown-fences.ts";

test("keeps triple-looking lines literal inside larger backtick and tilde fences", () => {
  const backticks = scanMarkdownFences("````markdown\n```\nbody");
  assert.deepEqual(backticks.activeFence, {
    character: "`",
    length: 4,
    openingStart: 0,
    openingEol: "\n",
  });

  const tilde = scanMarkdownFences("~~~markdown\n```\nbody");
  assert.equal(tilde.activeFence?.character, "~");
  assert.equal(tilde.activeFence?.length, 3);
});

test("closes only a matching delimiter of at least the opening length", () => {
  assert.equal(scanMarkdownFences("````ts\nbody\n```\n").activeFence?.length, 4);
  assert.equal(scanMarkdownFences("````ts\nbody\n~~~~\n").activeFence?.length, 4);
  assert.equal(scanMarkdownFences("````ts\nbody\n`````\n").activeFence, undefined);
});

test("supports up to three leading spaces but not indented code blocks", () => {
  assert.equal(scanMarkdownFences("   ```ts\nbody").activeFence?.length, 3);
  assert.equal(scanMarkdownFences("    ```ts\nbody").activeFence, undefined);
});

test("recognizes LF, CRLF, and lone CR while tracking the active fence at each line", () => {
  for (const eol of ["\n", "\r\n", "\r"] as const) {
    const scan = scanMarkdownFences(`\`\`\`ts${eol}body${eol}`);
    const body = scan.lines.find((line) => line.text === "body")!;
    assert.equal(scan.activeFence?.openingEol, eol);
    assert.equal(scan.fenceAtLineStart.get(body.start), scan.activeFence);
  }
});

test("rejects a backtick opening fence whose info string contains a backtick", () => {
  assert.equal(scanMarkdownFences("```lang`extra\nbody").activeFence, undefined);
});
