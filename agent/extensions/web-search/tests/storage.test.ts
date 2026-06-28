import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStoredResponse } from "../src/storage.js";

describe("stored response reads", () => {
  it("returns a friendly not-found error without exposing filesystem paths", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "wse-storage-test-"));
    try {
      await readStoredResponse(cacheDir, "wse_missing_deadbeef");
      throw new Error("expected readStoredResponse to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Stored response wse_missing_deadbeef was not found or has expired.");
      expect(message).not.toContain(cacheDir);
      expect(message).not.toContain("ENOENT");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
