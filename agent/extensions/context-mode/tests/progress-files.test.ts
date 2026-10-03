import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { access } from "node:fs/promises";
import { ProgressFiles } from "../src/progress-files.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, access: vi.fn(actual.access) };
});

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), "ctx-progress-files-"));
  path = resolve(dir, "log");
});
afterEach(() => {
  vi.mocked(access).mockClear();
  rmSync(dir, { recursive: true, force: true });
});

describe("explicit file growth", () => {
  it("baselines existing bytes and reports only positive growth across unchanged polls", async () => {
    writeFileSync(path, "old bytes");
    const files = new ProgressFiles([path]);
    expect(await files.poll(true)).toBe(0);
    expect(await files.poll()).toBe(0);
    writeFileSync(path, "OLD BYTES");
    expect(await files.poll()).toBe(0);
    appendFileSync(path, "new");
    expect(await files.poll()).toBe(3);
    expect(await files.poll()).toBe(3);
    appendFileSync(path, "!");
    expect(await files.poll()).toBe(4);
  });

  it("counts newly created files and aggregates multiple paths", async () => {
    const second = resolve(dir, "second");
    writeFileSync(second, "baseline");
    const files = new ProgressFiles([path, second]);
    await files.poll(true);
    writeFileSync(path, "new");
    appendFileSync(second, "++");
    expect(await files.poll()).toBe(5);
    expect(await files.poll()).toBe(5);
  });

  it("resets a truncated size without reducing the aggregate", async () => {
    writeFileSync(path, "baseline");
    const files = new ProgressFiles([path]);
    await files.poll(true);
    appendFileSync(path, "++");
    expect(await files.poll()).toBe(2);
    writeFileSync(path, "x");
    expect(await files.poll()).toBe(2);
    appendFileSync(path, "+++");
    expect(await files.poll()).toBe(5);
  });

  it.each([false, true])("baselines a replacement even after an observed deletion (%s)", async (observeDeletion) => {
    writeFileSync(path, "baseline");
    const files = new ProgressFiles([path]);
    await files.poll(true);
    appendFileSync(path, "+");
    expect(await files.poll()).toBe(1);
    // Keep the old inode alive so replacement identity is deterministic.
    renameSync(path, resolve(dir, "old"));
    if (observeDeletion) expect(await files.poll()).toBe(1);
    writeFileSync(path, "older replacement bytes");
    expect(await files.poll()).toBe(1);
    appendFileSync(path, "++");
    expect(await files.poll()).toBe(3);
  });

  it("ignores directories and baselines their eventual file replacements", async () => {
    const files = new ProgressFiles([path]);
    await files.poll(true);
    mkdirSync(path);
    writeFileSync(resolve(path, "child"), "not progress");
    expect(await files.poll()).toBe(0);
    rmSync(path, { recursive: true });
    writeFileSync(path, "existing replacement");
    expect(await files.poll()).toBe(0);
    appendFileSync(path, "+");
    expect(await files.poll()).toBe(1);
  });

  it("ignores unreadable files and baselines recovered access", async () => {
    writeFileSync(path, "existing bytes");
    chmodSync(path, 0o200);
    const files = new ProgressFiles([path]);
    await files.poll(true);
    appendFileSync(path, "+");
    expect(await files.poll()).toBe(0);
    chmodSync(path, 0o600);
    expect(await files.poll()).toBe(0);
    vi.mocked(access).mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EACCES" }));
    appendFileSync(path, "+");
    expect(await files.poll()).toBe(0);
    expect(await files.poll()).toBe(0);
    appendFileSync(path, "+");
    expect(await files.poll()).toBe(1);
  });
});
