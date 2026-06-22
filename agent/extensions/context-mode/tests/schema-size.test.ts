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

  it("marks timeout fields as non-negative", () => {
    const payloads = getLeanToolDefinitionPayloads();
    const executeFileTimeout = (payloads.find((tool) => tool.name === "ctx_execute_file")?.parameters.properties as Record<string, unknown>).timeout;
    const batchTimeout = (payloads.find((tool) => tool.name === "ctx_batch_execute")?.parameters.properties as Record<string, unknown>).timeout;
    expect(executeFileTimeout).toMatchObject({ minimum: 0 });
    expect(batchTimeout).toMatchObject({ minimum: 0 });
  });
});
