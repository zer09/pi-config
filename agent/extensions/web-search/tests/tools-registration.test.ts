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

const retiredRecommendation = /(?:^|[.!?;]\s+)(?:use|prefer|call|run|load)\s+(?:CodeGraph|Context[- ]Mode|`?(?:codegraph|ctx)_[\w*]+`?)/i;

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

  it("caps fetch_contents at 25 URLs and 50000 maxCharacters in the public schema", () => {
    const schema = schemaFor("fetch_contents") as Record<string, any>;
    expect(schema.properties.uris.maxItems).toBe(25);
    expect(schema.properties.uris.minItems).toBe(1);
    expect(schema.properties.maxCharacters.maximum).toBe(50_000);
    expect(schema.properties.maxCharacters.minimum).toBe(1);
  });

  it("keeps schemas closed against unexpected properties", () => {
    for (const tool of tools) {
      expect((tool.parameters as Record<string, unknown>).additionalProperties).toBe(false);
    }
  });

  it("distinguishes public web, public code context, URL fetching, and native repository inspection in descriptions", () => {
    const [webSearch, codeSearch, fetchContents] = tools;
    expect(webSearch.description).toContain("inline citations");
    expect(webSearch.description).toContain("Prefer web_code_search");
    expect(webSearch.description).toContain("Do not use this tool to inspect the current local repository");
    expect(codeSearch.description).toContain("developer_sources");
    expect(codeSearch.description).toContain("implementation_examples");
    expect(codeSearch.description).toContain("Use targeted native file reads and bounded shell searches for the current repository");
    expect(fetchContents.description).toContain("explicit public URLs");
    expect(fetchContents.description).toContain("does not discover URLs");
  });

  it("keeps every description, prompt snippet, and prompt guideline free of retired-tool recommendations", () => {
    for (const tool of tools) {
      const metadata = {
        description: tool.description,
        promptSnippet: tool.promptSnippet ?? "",
        ...Object.fromEntries((tool.promptGuidelines ?? []).map((text, index) => [`promptGuidelines[${index}]`, text])),
      };
      for (const [field, text] of Object.entries(metadata)) {
        expect(text, `${tool.name}.${field}`).not.toMatch(retiredRecommendation);
      }
    }
  });

  it("detects affirmative retired-tool routing without banning history or retirement prohibitions", () => {
    for (const text of [
      "Use CodeGraph or local file tools for the current repository.",
      "Do not use web_search locally; use CodeGraph instead.",
      "Prefer Context Mode for diagnostics.",
      "Call `codegraph_explore` for local code.",
      "Run ctx_batch_execute for tests.",
    ]) {
      expect(text).toMatch(retiredRecommendation);
    }
    for (const text of [
      "Historically, CodeGraph and Context Mode provided repository tools.",
      "CodeGraph and Context Mode are retired; do not re-enable them.",
      "Do not use CodeGraph or ctx_batch_execute.",
      "Use native file reads instead of CodeGraph.",
    ]) {
      expect(text).not.toMatch(retiredRecommendation);
    }
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
