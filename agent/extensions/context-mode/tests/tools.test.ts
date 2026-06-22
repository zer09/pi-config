import { describe, expect, it, vi } from "vitest";
import { buildBatchExecuteArgs, buildExecuteFileArgs, buildSearchArgs, createLeanToolRegistrations, executeLeanTool } from "../src/tools.js";

describe("wrapper arg builders", () => {
  it("resolves ctx_execute_file paths and preserves lean params", () => {
    expect(
      buildExecuteFileArgs(
        { path: "logs/big.log", language: "javascript", code: "console.log(FILE_CONTENT.length)", intent: "errors" },
        "/work/project",
      ),
    ).toEqual({
      path: "/work/project/logs/big.log",
      language: "javascript",
      code: "console.log(FILE_CONTENT.length)",
      intent: "errors",
    });
  });

  it("adds ctx_batch_execute defaults and query_scope", () => {
    expect(
      buildBatchExecuteArgs(
        {
          commands: [{ label: "status", command: "git status --short" }],
          queries: ["modified"],
        },
        "/work/project",
      ),
    ).toEqual({
      commands: [{ label: "status", command: "git status --short" }],
      queries: ["modified"],
      concurrency: 1,
      cwd: "/work/project",
      query_scope: "batch",
    });
  });

  it("rejects ctx_batch_execute concurrency above 4", () => {
    expect(() =>
      buildBatchExecuteArgs(
        { commands: [{ label: "x", command: "git status" }], queries: ["x"], concurrency: 5 },
        "/work/project",
      ),
    ).toThrow(/concurrency/);
  });

  it("rejects sensitive ctx_batch_execute cwd values", () => {
    expect(() =>
      buildBatchExecuteArgs(
        { commands: [{ label: "x", command: "git status" }], queries: ["x"], cwd: ".git" },
        "/work/project",
      ),
    ).toThrow(/cwd/);
  });

  it("rejects negative timeout values", () => {
    expect(() =>
      buildExecuteFileArgs(
        { path: "logs/big.log", language: "javascript", code: "console.log(1)", timeout: -1 },
        "/work/project",
      ),
    ).toThrow(/timeout/);
    expect(() =>
      buildBatchExecuteArgs(
        { commands: [{ label: "x", command: "git status" }], queries: ["x"], timeout: -1 },
        "/work/project",
      ),
    ).toThrow(/timeout/);
  });

  it("builds ctx_search args without exposing project or sort", () => {
    expect(buildSearchArgs({ queries: ["ERR42"], source: "test", limit: 5, contentType: "code" })).toEqual({
      queries: ["ERR42"],
      source: "test",
      limit: 5,
      contentType: "code",
    });
  });

  it("rejects invalid ctx_search contentType values", () => {
    expect(() => buildSearchArgs({ queries: ["ERR42"], contentType: "xml" as "code" })).toThrow(/contentType/);
  });

  it("omits empty ctx_search source and contentType", () => {
    expect(buildSearchArgs({ queries: ["ERR42"], source: "", contentType: "" as "code" })).toEqual({
      queries: ["ERR42"],
    });
  });
});

describe("tool registrations", () => {
  it("exposes exactly three lean tools", () => {
    const tools = createLeanToolRegistrations();
    expect(tools.map((tool) => tool.name)).toEqual(["ctx_execute_file", "ctx_batch_execute", "ctx_search"]);
  });

  it("forwards wrapper calls to the selected upstream tool", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} }));
    const result = await executeLeanTool(
      "ctx_batch_execute",
      { commands: [{ label: "status", command: "rtk git status --short" }], queries: ["status"] },
      { cwd: "/work/project" },
      { callTool },
    );

    expect(result.content[0]?.text).toBe("ok");
    expect(callTool).toHaveBeenCalledWith("/work/project", "ctx_batch_execute", {
      commands: [{ label: "status", command: "rtk git status --short" }],
      queries: ["status"],
      concurrency: 1,
      cwd: "/work/project",
      query_scope: "batch",
    });
  });
});
