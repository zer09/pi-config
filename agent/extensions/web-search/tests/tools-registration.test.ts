import "./pi-tui-mock.js";
import { describe, expect, it } from "bun:test";

// Imported dynamically so the pi-tui stub is registered before tools.ts loads render.ts.
const { createToolRegistrations } = await import("../src/tools.js");
const { webCodeSearchSchema, webSearchSchema, fetchContentsSchema } = await import("../src/schemas.js");

function schemaFor(name: string) {
  if (name === "web_search") return webSearchSchema;
  if (name === "web_code_search") return webCodeSearchSchema;
  return fetchContentsSchema;
}

describe("public tool registration", () => {
  const tools = createToolRegistrations();

  it("registers exactly web_search, web_code_search, and fetch_contents", () => {
    expect(tools.map((tool) => tool.name)).toEqual(["web_search", "web_code_search", "fetch_contents"]);
    expect(tools).toHaveLength(3);
  });

  it("requires web_search.query and exposes only standard and deep depth", () => {
    const schema = schemaFor("web_search") as Record<string, any>;
    expect(schema.required).toEqual(["query"]);
    expect(schema.properties.query.type).toBe("string");
    expect(schema.properties.query.minLength).toBe(1);
    expect(schema.properties.depth.enum).toEqual(["standard", "deep"]);
  });

  it("has no legacy mode field in the web_search schema", () => {
    const schema = schemaFor("web_search") as Record<string, any>;
    expect(schema.properties.mode).toBeUndefined();
    expect(JSON.stringify(schema)).not.toContain('"mode"');
  });

  it("requires web_code_search query and focus with only the two semantic focus values", () => {
    const schema = schemaFor("web_code_search") as Record<string, any>;
    expect(schema.required).toEqual(["query", "focus"]);
    expect(schema.properties.focus.enum).toEqual(["developer_sources", "implementation_examples"]);
    expect(schema.properties.focus.enum).not.toContain("auto");
  });

  it("accepts fetch_contents maxAgeHours integers from 0 through 720", () => {
    const schema = schemaFor("fetch_contents") as Record<string, any>;
    expect(schema.properties.maxAgeHours.type).toBe("integer");
    expect(schema.properties.maxAgeHours.minimum).toBe(0);
    expect(schema.properties.maxAgeHours.maximum).toBe(720);
    expect(schema.required).toEqual(["uris"]);
  });

  it("keeps schemas closed against unexpected properties", () => {
    for (const tool of tools) {
      expect((tool.parameters as Record<string, unknown>).additionalProperties).toBe(false);
    }
  });

  it("distinguishes public web, public code context, URL fetching, and local CodeGraph in descriptions", () => {
    const [webSearch, codeSearch, fetchContents] = tools;
    expect(webSearch.description).toContain("inline citations");
    expect(webSearch.description).toContain("Prefer web_code_search");
    expect(webSearch.description).toContain("Do not use this tool to inspect the current local repository");
    expect(codeSearch.description).toContain("developer_sources");
    expect(codeSearch.description).toContain("implementation_examples");
    expect(codeSearch.description).toContain("Use CodeGraph or local file tools for the current repository");
    expect(fetchContents.description).toContain("explicit public URLs");
    expect(fetchContents.description).toContain("does not discover URLs");
  });

  it("allows a single task to call both web tools", () => {
    const [webSearch, codeSearch] = tools;
    expect(webSearch.promptGuidelines?.join("\n")).toContain("both web_search and web_code_search");
    expect(codeSearch.promptGuidelines?.join("\n")).toContain("both web_search and web_code_search");
  });

  it("registers execute, parameters, labels, and renderers for every tool", () => {
    for (const tool of tools) {
      expect(typeof tool.execute).toBe("function");
      expect(typeof tool.parameters).toBe("object");
      expect(tool.label.length).toBeGreaterThan(0);
      expect(typeof tool.renderCall).toBe("function");
      expect(typeof tool.renderResult).toBe("function");
    }
  });
});
