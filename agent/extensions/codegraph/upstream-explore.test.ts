import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraphInstance } from "./types.ts";
import {
  codeGraphPlatformPackageName,
  executeUpstreamExplore,
  loadUpstreamToolHandler,
} from "./upstream-explore.ts";

const EXACT_MARKER =
  "... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. " +
  "For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)";

class MinimalFakeToolHandler {
  async executeReadTool(): Promise<{ content: Array<{ type: string; text: string }> }> {
    return { content: [{ type: "text", text: "ok" }] };
  }
}

test("builds the platform package name", () => {
  assert.equal(codeGraphPlatformPackageName("linux", "x64"), "@colbymchenry/codegraph-linux-x64");
  assert.equal(codeGraphPlatformPackageName("darwin", "arm64"), "@colbymchenry/codegraph-darwin-arm64");
});

test("loads ToolHandler from the platform MCP module", () => {
  let requestedModule = "";
  const loaded = loadUpstreamToolHandler(
    (moduleId) => {
      requestedModule = moduleId;
      return { ToolHandler: MinimalFakeToolHandler };
    },
    "linux",
    "x64",
  );

  assert.equal(loaded, MinimalFakeToolHandler);
  assert.equal(
    requestedModule,
    "@colbymchenry/codegraph-linux-x64/lib/dist/mcp/tools.js",
  );
});

test("loads the actual pinned platform ToolHandler", () => {
  const ToolHandler = loadUpstreamToolHandler();
  assert.equal(typeof ToolHandler, "function");
  assert.equal(typeof ToolHandler.prototype.executeReadTool, "function");
});

test("wraps platform-module load failures", () => {
  assert.throws(
    () => loadUpstreamToolHandler(() => {
      throw new Error("missing bundle");
    }, "linux", "x64"),
    /CodeGraph .* compatibility error.*@colbymchenry\/codegraph-linux-x64\/lib\/dist\/mcp\/tools\.js.*missing bundle.*private adapter must be reviewed/is,
  );
});

test("rejects an incompatible upstream module shape", () => {
  assert.throws(
    () => loadUpstreamToolHandler(() => ({}), "linux", "x64"),
    /does not export a ToolHandler constructor/,
  );
});

test("wraps ToolHandler construction failures with compatibility guidance", async () => {
  const NonConstructible = () => ({
    executeReadTool: async () => ({ content: [{ type: "text", text: "unexpected" }] }),
  });

  await assert.rejects(
    executeUpstreamExplore(
      {} as CodeGraphInstance,
      { query: "GraphManager" },
      () => NonConstructible as never,
    ),
    /CodeGraph .* upstream Explore compatibility error.*ToolHandler could not be constructed.*private adapter must be reviewed/is,
  );
});

test("executes upstream Explore with only query and maxFiles", async () => {
  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const fakeGraph = {} as CodeGraphInstance;

  class FakeToolHandler {
    constructor(cg: CodeGraphInstance) {
      assert.equal(cg, fakeGraph);
    }

    async executeReadTool(
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<{ content: Array<{ type: string; text: string }> }> {
      calls.push({ toolName, args });
      return {
        content: [
          { type: "text", text: "first" },
          { type: "image", text: "ignored" },
          { type: "text", text: "second" },
        ],
      };
    }
  }

  const output = await executeUpstreamExplore(
    fakeGraph,
    { query: "SessionStoreManager afterCommit", maxFiles: 6 },
    () => FakeToolHandler,
  );

  assert.equal(output, "first\nsecond");
  assert.deepEqual(calls, [
    {
      toolName: "codegraph_explore",
      args: { query: "SessionStoreManager afterCommit", maxFiles: 6 },
    },
  ]);
  assert.equal("projectPath" in calls[0]!.args, false);
});

test("omits maxFiles so upstream can choose its adaptive default", async () => {
  let capturedArgs: Record<string, unknown> | undefined;

  class FakeToolHandler extends MinimalFakeToolHandler {
    override async executeReadTool(
      _toolName: string,
      args: Record<string, unknown>,
    ): Promise<{ content: Array<{ type: string; text: string }> }> {
      capturedArgs = args;
      return { content: [{ type: "text", text: "ok" }] };
    }
  }

  await executeUpstreamExplore(
    {} as CodeGraphInstance,
    { query: "GraphManager" },
    () => FakeToolHandler,
  );

  assert.deepEqual(capturedArgs, { query: "GraphManager" });
});

test("rejects a ToolHandler with an incompatible instance shape", async () => {
  class IncompatibleToolHandler {
    async execute(): Promise<{ content: Array<{ type: string; text: string }> }> {
      return { content: [{ type: "text", text: "ok" }] };
    }
  }

  await assert.rejects(
    executeUpstreamExplore(
      {} as CodeGraphInstance,
      { query: "GraphManager" },
      () => IncompatibleToolHandler as never,
    ),
    /does not expose executeReadTool/,
  );
});

test("rejects malformed upstream results with compatibility guidance", async () => {
  const malformedResults: unknown[] = [
    null,
    17,
    {},
    { content: null },
    { content: [null] },
    { content: [{}] },
    { content: [{ type: 17 }] },
    { content: [{ type: "text" }] },
    { content: [], isError: "yes" },
  ];

  for (const malformedResult of malformedResults) {
    class MalformedResultHandler {
      async executeReadTool(): Promise<unknown> {
        return malformedResult;
      }
    }

    await assert.rejects(
      executeUpstreamExplore(
        {} as CodeGraphInstance,
        { query: "GraphManager" },
        () => MalformedResultHandler as never,
      ),
      /CodeGraph .* upstream Explore compatibility error.*private adapter must be reviewed/is,
    );
  }
});

test("repairs LF and CRLF truncation inside the final source fence", async () => {
  for (const newline of ["\n", "\r\n"]) {
    const upstreamOutput = [
      "**Source Code**",
      "",
      "```typescript",
      "1\texport function incomplete() {",
      "",
      EXACT_MARKER,
    ].join(newline);

    class TruncatedResultHandler {
      async executeReadTool(): Promise<unknown> {
        return { content: [{ type: "text", text: upstreamOutput }] };
      }
    }

    const output = await executeUpstreamExplore(
      {} as CodeGraphInstance,
      { query: "incomplete" },
      () => TruncatedResultHandler as never,
    );

    assert.equal((output.match(/^```/gm) ?? []).length % 2, 0);
    assert.ok(output.includes(
      `\`\`\`${newline}${newline}> ⚠️ Upstream Explore output truncated to budget inside the final source block`,
    ));
    assert.match(output, /final block is incomplete/);
    assert.doesNotMatch(output, /source above is complete and verbatim/);
    assert.equal(output.includes("\r\n"), newline === "\r\n");
  }
});

test("leaves balanced or unmarked upstream Markdown unchanged", async () => {
  const outputs = [
    "```typescript\n1\texport const complete = true;\n```\n\n... (output truncated to budget; complete section)",
    "```typescript\n1\texport const oddButUnmarked = true;",
  ];

  for (const upstreamOutput of outputs) {
    class UnchangedResultHandler {
      async executeReadTool(): Promise<unknown> {
        return { content: [{ type: "text", text: upstreamOutput }] };
      }
    }

    assert.equal(
      await executeUpstreamExplore(
        {} as CodeGraphInstance,
        { query: "unchanged" },
        () => UnchangedResultHandler as never,
      ),
      upstreamOutput,
    );
  }
});

test("throws when upstream reports an error", async () => {
  class FakeToolHandler extends MinimalFakeToolHandler {
    override async executeReadTool(): Promise<{
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    }> {
      return {
        content: [{ type: "text", text: "upstream failure" }],
        isError: true,
      };
    }
  }

  await assert.rejects(
    executeUpstreamExplore(
      {} as CodeGraphInstance,
      { query: "GraphManager" },
      () => FakeToolHandler,
    ),
    /upstream failure/,
  );
});

test("throws when upstream returns no text", async () => {
  class FakeToolHandler extends MinimalFakeToolHandler {
    override async executeReadTool(): Promise<{ content: Array<{ type: string }> }> {
      return { content: [{ type: "image" }] };
    }
  }

  await assert.rejects(
    executeUpstreamExplore(
      {} as CodeGraphInstance,
      { query: "GraphManager" },
      () => FakeToolHandler,
    ),
    /returned no text output/,
  );
});
