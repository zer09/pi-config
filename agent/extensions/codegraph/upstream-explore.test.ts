import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraphInstance } from "./types.ts";
import {
  codeGraphPlatformPackageName,
  executeUpstreamExplore,
  loadUpstreamToolHandler,
} from "./upstream-explore.ts";

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
    /upstream Explore handler from @colbymchenry\/codegraph-linux-x64\/lib\/dist\/mcp\/tools\.js: missing bundle/,
  );
});

test("rejects an incompatible upstream module shape", () => {
  assert.throws(
    () => loadUpstreamToolHandler(() => ({}), "linux", "x64"),
    /does not export a ToolHandler constructor/,
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
