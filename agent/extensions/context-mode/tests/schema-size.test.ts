import { describe, expect, it } from "vitest";
import { getLeanToolDefinitionPayloads } from "../src/schemas.js";

describe("lean schema payload", () => {
  it("exposes exactly three tools under 10KB serialized JSON", () => {
    const payloads = getLeanToolDefinitionPayloads();
    const json = JSON.stringify(payloads);
    expect(payloads.map((tool) => tool.name)).toEqual(["ctx_execute_file", "ctx_batch_execute", "ctx_search"]);
    expect(Buffer.byteLength(json, "utf8")).toBeLessThan(10_000);
  });

  it("does not include long upstream routing prose", () => {
    const json = JSON.stringify(getLeanToolDefinitionPayloads());
    expect(json).not.toContain("WHEN NOT");
    expect(json).not.toContain("Think-in-Code");
    expect(json).not.toContain("Reciprocal Rank Fusion");
  });

  it("limits ctx_execute_file guidance to the active project root", () => {
    const executeFile = getLeanToolDefinitionPayloads().find((tool) => tool.name === "ctx_execute_file");
    const properties = executeFile?.parameters.properties as Record<string, { description?: string }>;

    expect(executeFile?.description).toContain("inside the active project root");
    expect(executeFile?.promptGuidelines.join(" ")).toContain("outside the active project root");
    expect(executeFile?.promptGuidelines.join(" ")).toContain("linked Git worktree");
    expect(properties.path?.description).toContain("inside the active project root");
  });

  it("exposes a bounded optional progressFiles list only for batches", () => {
    const payloads = getLeanToolDefinitionPayloads();
    const batch = payloads.find((tool) => tool.name === "ctx_batch_execute")!;
    expect(batch.parameters.properties).toHaveProperty("progressFiles", {
      type: "array", maxItems: 32, items: { type: "string", minLength: 1 },
      description: expect.stringContaining("never read or index contents"),
    });
    expect(batch.parameters.required).not.toContain("progressFiles");
    for (const tool of payloads.filter((tool) => tool.name !== "ctx_batch_execute")) {
      expect(tool.parameters.properties).not.toHaveProperty("progressFiles");
    }
  });

  it("marks timeout fields as non-negative", () => {
    const payloads = getLeanToolDefinitionPayloads();
    const executeFileTimeout = (payloads.find((tool) => tool.name === "ctx_execute_file")?.parameters.properties as Record<string, unknown>).timeout;
    const batchTimeout = (payloads.find((tool) => tool.name === "ctx_batch_execute")?.parameters.properties as Record<string, unknown>).timeout;
    expect(executeFileTimeout).toMatchObject({ minimum: 0 });
    expect(batchTimeout).toMatchObject({ minimum: 0 });
  });
});
