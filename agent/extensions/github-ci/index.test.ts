import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import githubCiExtension from "./index.ts";
import { parameters } from "./input.ts";
import type { WaitDetails } from "./types.ts";
import { Clock, snapshot } from "./test-helpers.ts";

test("entry registers the public tool and returns normal FAIL without progress", async () => {
  const clock = new Clock();
  let tool: ToolDefinition<typeof parameters, WaitDetails> | undefined;
  const calls: Parameters<ExtensionAPI["exec"]>[] = [];
  githubCiExtension(
    {
      registerTool(value) {
        tool = value as unknown as typeof tool;
      },
      async exec(...args) {
        calls.push(args);
        const data =
          args[1].at(-1) === "jobs"
            ? { jobs: [] }
            : snapshot("completed", "failure");
        return {
          code: 0,
          killed: false,
          stdout: JSON.stringify(data),
          stderr: "UNRETURNED_STDERR",
        };
      },
    },
    { now: clock.now, sleep: clock.sleep },
  );
  assert.ok(tool);
  assert.equal(tool.name, "github_ci_wait");
  assert.equal(tool.label, "GitHub CI Wait");
  assert.equal(tool.parameters, parameters);
  assert.equal(calls.length, 0);
  assert.equal(clock.pending.size, 0);
  assert.throws(
    () =>
      tool!.prepareArguments!({ repo: "o/r", runs: [{ id: 1 }, { id: 1 }] }),
    /duplicate run ID 1/,
  );
  const signal = new AbortController().signal;
  let updates = 0;
  const result = await tool.execute(
    "test",
    { repo: "o/r", runs: [{ id: 1 }] },
    signal,
    () => {
      updates++;
    },
    {} as ExtensionContext,
  );
  assert.equal(updates, 0);
  assert.equal(result.details.outcome, "FAIL");
  assert.equal(result.content[0].type, "text");
  assert.ok(!("isError" in result));
  assert.equal(calls.length, 2);
  assert.equal(clock.pending.size, 0);
});
