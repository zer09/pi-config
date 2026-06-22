import { describe, expect, it } from "vitest";
import { createCallRenderer, createResultRenderer, extractText } from "../src/rendering.js";
import type { PiRenderTheme } from "../src/types.js";

const theme: PiRenderTheme = {
  bold: (text) => text,
  fg: (_color, text) => text,
};

const result = {
  content: [
    {
      type: "text" as const,
      text: "\nfirst useful line\nsecond line\nthird line",
    },
  ],
  details: {},
};

describe("tool rendering", () => {
  it("collapsed renderer returns only the first non-empty line", () => {
    const renderer = createResultRenderer("ctx_search", "searching...");
    const component = renderer(result, { expanded: false, isPartial: false }, theme, {});
    expect(component.render(120)).toEqual(["first useful line"]);
  });

  it("expanded renderer returns full text", () => {
    const renderer = createResultRenderer("ctx_search", "searching...");
    const component = renderer(result, { expanded: true, isPartial: false }, theme, {});
    expect(component.render(120)).toEqual(["", "first useful line", "second line", "third line"]);
  });

  it("partial renderer shows status", () => {
    const renderer = createResultRenderer("ctx_batch_execute", "running/indexing/searching...");
    const component = renderer(result, { expanded: false, isPartial: true }, theme, {});
    expect(component.render(120)).toEqual(["running/indexing/searching..."]);
  });

  it("call renderer tolerates missing args and context", () => {
    const renderer = createCallRenderer("ctx_execute_file");
    expect(renderer(undefined, theme).render(120)).toEqual(["ctx_execute_file"]);
    expect(renderer(null, theme).render(120)).toEqual(["ctx_execute_file"]);
  });

  it("extractText handles circular objects", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(extractText(circular)).toBe("[Unserializable result]");
  });
});
