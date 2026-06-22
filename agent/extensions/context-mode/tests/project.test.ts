import { describe, expect, it } from "vitest";
import { isUnderPiConfig, resolveProjectDir, resolveUserPath } from "../src/project.js";

describe("project directory resolution", () => {
  it("prefers PI_WORKSPACE_DIR", () => {
    const project = resolveProjectDir({
      env: { PI_WORKSPACE_DIR: "/workspace", PI_PROJECT_DIR: "/legacy", PWD: "/pwd" },
      cwd: "/cwd",
      home: "/home/gc",
    });
    expect(project).toBe("/workspace");
  });

  it("falls back through PWD and ctx cwd", () => {
    expect(resolveProjectDir({ env: { PWD: "/pwd" }, ctx: { cwd: "/ctx" }, cwd: "/cwd", home: "/home/gc" })).toBe("/pwd");
    expect(resolveProjectDir({ env: { PWD: "/home/gc/.pi" }, ctx: { cwd: "/ctx" }, cwd: "/cwd", home: "/home/gc" })).toBe("/ctx");
  });

  it("rejects paths under ~/.pi and falls back to home", () => {
    const project = resolveProjectDir({
      env: { PI_WORKSPACE_DIR: "/home/gc/.pi", PI_PROJECT_DIR: "/home/gc/.pi/project", PWD: "/home/gc/.pi" },
      ctx: { cwd: "/home/gc/.pi/agent" },
      cwd: "/home/gc/.pi",
      home: "/home/gc",
    });
    expect(project).toBe("/home/gc");
    expect(isUnderPiConfig("/home/gc/.pi/agent", "/home/gc")).toBe(true);
  });

  it("resolves @ and relative user paths", () => {
    expect(resolveUserPath("@src/index.ts", "/work/project")).toBe("/work/project/src/index.ts");
    expect(resolveUserPath("/tmp/file", "/work/project")).toBe("/tmp/file");
  });
});
