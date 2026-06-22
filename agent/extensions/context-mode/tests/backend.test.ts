import { beforeEach, describe, expect, it, vi } from "vitest";
import { callCtxTool, loadBackend, resetBackendCache, resolveContextModeServer } from "../src/backend.js";

const required = ["ctx_execute_file", "ctx_batch_execute", "ctx_search"];

beforeEach(() => resetBackendCache());

describe("resolveContextModeServer", () => {
  it("prefers CONTEXT_MODE_ROOT", () => {
    const found = resolveContextModeServer({
      env: { CONTEXT_MODE_ROOT: "/opt/context-mode" } as NodeJS.ProcessEnv,
      exists: (path) => path === "/opt/context-mode/server.bundle.mjs",
    });
    expect(found).toBe("/opt/context-mode/server.bundle.mjs");
  });

  it("resolves the installed npm dependency from context-mode/cli", () => {
    const found = resolveContextModeServer({
      env: {} as NodeJS.ProcessEnv,
      requireResolve: (id) => {
        expect(id).toBe("context-mode/cli");
        return "/pkg/context-mode/cli.bundle.mjs";
      },
      exists: (path) => path === "/pkg/context-mode/server.bundle.mjs",
    });
    expect(found).toBe("/pkg/context-mode/server.bundle.mjs");
  });

  it("returns null when no backend exists", () => {
    const found = resolveContextModeServer({
      env: {} as NodeJS.ProcessEnv,
      requireResolve: () => {
        throw new Error("missing");
      },
      exists: () => false,
    });
    expect(found).toBeNull();
  });
});

describe("direct backend import", () => {
  it("sets embedded env before import and finds required handlers", async () => {
    const env = {} as NodeJS.ProcessEnv;
    const importModule = vi.fn(async () => {
      expect(env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS).toBe("1");
      expect(env.CONTEXT_MODE_PROJECT_DIR).toBe("/work/project");
      return {
        REGISTERED_CTX_TOOLS: required.map((name) => ({ name, handler: vi.fn() })),
        withProjectDirOverride: async (_project: unknown, fn: () => Promise<unknown>) => fn(),
      };
    });

    const backend = await loadBackend("/work/project", {
      env,
      exists: (path) => path === "/pkg/context-mode/server.bundle.mjs",
      requireResolve: (id) => {
        expect(id).toBe("context-mode/cli");
        return "/pkg/context-mode/cli.bundle.mjs";
      },
      importModule,
      home: "/home/test",
    });

    expect(importModule).toHaveBeenCalledWith("file:///pkg/context-mode/server.bundle.mjs");
    expect([...backend.tools.keys()].sort()).toEqual([...required].sort());
    expect(env.PI_CONFIG_DIR).toBe("/home/test/.pi");
    expect(env.CONTEXT_MODE_DIR).toBe("/home/test/.pi/context-mode");
  });

  it("calls upstream handlers inside withProjectDirOverride with parsed args", async () => {
    const handler = vi.fn(async (args: Record<string, unknown>) => ({ content: [{ type: "text", text: `ok ${args.limit}` }] }));
    const withProjectDirOverride = vi.fn(async (_project: unknown, fn: () => Promise<unknown>) => fn());
    const result = await callCtxTool(
      "/work/project",
      "ctx_search",
      { queries: ["x"], limit: "4" },
      {
        env: { CONTEXT_MODE_ROOT: "/ctx" } as NodeJS.ProcessEnv,
        exists: (path) => path === "/ctx/server.bundle.mjs",
        importModule: async () => ({
          REGISTERED_CTX_TOOLS: [
            { name: "ctx_execute_file", handler: vi.fn() },
            { name: "ctx_batch_execute", handler: vi.fn() },
            {
              name: "ctx_search",
              config: { inputSchema: { parse: (args: Record<string, unknown>) => ({ ...args, limit: Number(args.limit) }) } },
              handler,
            },
          ],
          withProjectDirOverride,
        }),
      },
    );

    expect(withProjectDirOverride).toHaveBeenCalledWith({ projectDir: "/work/project" }, expect.any(Function));
    expect(handler).toHaveBeenCalledWith({ queries: ["x"], limit: 4 });
    expect(result.content[0]?.text).toBe("ok 4");
  });

  it("updates CONTEXT_MODE_PROJECT_DIR on cached-backend calls", async () => {
    const env = {} as NodeJS.ProcessEnv;
    const importModule = vi.fn(async () => ({
      REGISTERED_CTX_TOOLS: required.map((name) => ({ name, handler: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })) })),
      withProjectDirOverride: async (_project: unknown, fn: () => Promise<unknown>) => fn(),
    }));

    env.CONTEXT_MODE_ROOT = "/ctx";
    const deps = {
      env,
      exists: (path: string) => path === "/ctx/server.bundle.mjs",
      importModule,
    };

    await callCtxTool("/work/project-a", "ctx_search", { queries: ["a"] }, deps);
    expect(env.CONTEXT_MODE_PROJECT_DIR).toBe("/work/project-a");
    await callCtxTool("/work/project-b", "ctx_search", { queries: ["b"] }, deps);
    expect(env.CONTEXT_MODE_PROJECT_DIR).toBe("/work/project-b");
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it("throws clearly when no backend exists", async () => {
    await expect(
      loadBackend("/work/project", {
        env: {} as NodeJS.ProcessEnv,
        exists: () => false,
        requireResolve: () => {
          throw new Error("missing");
        },
      }),
    ).rejects.toThrow(/context-mode backend not found/);
  });

  it("throws when a required upstream handler is missing", async () => {
    await expect(
      loadBackend("/work/project", {
        env: { CONTEXT_MODE_ROOT: "/ctx" } as NodeJS.ProcessEnv,
        exists: (path) => path === "/ctx/server.bundle.mjs",
        importModule: async () => ({
          REGISTERED_CTX_TOOLS: [{ name: "ctx_search", handler: vi.fn() }],
          withProjectDirOverride: async (_project: unknown, fn: () => Promise<unknown>) => fn(),
        }),
      }),
    ).rejects.toThrow(/missing ctx_execute_file/);
  });
});
