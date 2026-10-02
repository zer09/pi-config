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
      timeout: 300000,
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
      timeout: 300000,
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

  it.each([0, 1234, 900000])("preserves explicit timeout %i for execution tools", (timeout) => {
    expect(buildExecuteFileArgs({ path: "log.txt", language: "javascript", code: "console.log(1)", timeout }, "/work/project").timeout).toBe(timeout);
    expect(buildBatchExecuteArgs({ commands: [{ label: "x", command: "git status" }], queries: ["x"], timeout }, "/work/project").timeout).toBe(timeout);
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

  it("exposes prompt metadata whose guidelines name each tool", () => {
    const tools = createLeanToolRegistrations();
    for (const tool of tools) {
      expect(tool.promptSnippet).toBeTruthy();
      expect(tool.promptGuidelines?.length).toBeGreaterThan(0);
      for (const guideline of tool.promptGuidelines ?? []) {
        expect(guideline).toContain(tool.name);
      }
    }
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
      timeout: 300000,
      concurrency: 1,
      cwd: "/work/project",
      query_scope: "batch",
    }, {});
  });

  it("passes registration signal and updates to the backend seam", async () => {
    const signal = new AbortController().signal;
    const onUpdate = vi.fn();
    const callTool = vi.fn(async (_dir, _name, _args, lifecycle) => {
      lifecycle.onUpdate({ content: [{ type: "text", text: "changed" }] });
      return { content: [{ type: "text" as const, text: "ok" }] };
    });
    const search = createLeanToolRegistrations({ callTool })[2];
    await search.execute("id", { queries: ["x"] }, signal, onUpdate, { cwd: "/work/project" });
    expect(callTool.mock.calls[0][3]).toEqual({ signal, onUpdate });
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("does not call the backend on pre-abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const callTool = vi.fn();
    await expect(createLeanToolRegistrations({ callTool })[2].execute("id", { queries: ["x"] }, controller.signal)).rejects.toThrow(/cancelled/);
    expect(callTool).not.toHaveBeenCalled();
  });
});
