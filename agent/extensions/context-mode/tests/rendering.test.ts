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
  it("collapsed search renderer shows a short multi-line preview", () => {
    const renderer = createResultRenderer("ctx_search", "searching...");
    const component = renderer(result, { expanded: false, isPartial: false }, theme, {});
    expect(component.render(120)).toEqual(["first useful line", "second line", "third line"]);
  });

  it("collapsed search renderer limits long previews and reports omitted lines", () => {
    const renderer = createResultRenderer("ctx_search", "searching...");
    const lines = Array.from({ length: 23 }, (_, index) => `line ${index + 1}`);
    const longResult = { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
    const component = renderer(longResult, { expanded: false, isPartial: false }, theme, {});

    expect(component.render(120)).toEqual([
      ...lines.slice(0, 20),
      "... (3 more lines, Ctrl+O to expand)",
    ]);
  });

  it("expanded search renderer reuses the preview component and returns full text", () => {
    const renderer = createResultRenderer("ctx_search", "searching...");
    const preview = renderer(result, { expanded: false, isPartial: false }, theme, {});
    const component = renderer(result, { expanded: true, isPartial: false }, theme, { lastComponent: preview });

    expect(component).toBe(preview);
    expect(component.render(120)).toEqual(["", "first useful line", "second line", "third line"]);
  });

  it("non-search collapsed renderer keeps a one-line summary", () => {
    const renderer = createResultRenderer("ctx_batch_execute", "running/indexing/searching...");
    const component = renderer(result, { expanded: false, isPartial: false }, theme, {});
    expect(component.render(120)).toEqual(["first useful line"]);
  });

  it("empty search output uses the completion fallback", () => {
    const renderer = createResultRenderer("ctx_search", "searching...");
    const component = renderer({ content: [], details: {} }, { expanded: false, isPartial: false }, theme, {});
    expect(component.render(120)).toEqual(["ctx_search completed"]);
  });

  it("search preview lines stay within the terminal width", () => {
    const renderer = createResultRenderer("ctx_search", "searching...");
    const wideResult = { content: [{ type: "text" as const, text: "x".repeat(40) }], details: {} };
    const component = renderer(wideResult, { expanded: false, isPartial: false }, theme, {});
    expect(component.render(8).every((line) => line.length <= 8)).toBe(true);
  });

  it("partial renderer shows status", () => {
    const renderer = createResultRenderer("ctx_batch_execute", "running/indexing/searching...");
    const component = renderer(result, { expanded: false, isPartial: true }, theme, {});
    expect(component.render(120)).toEqual(["running/indexing/searching..."]);
  });

  it("call renderer tolerates missing args and context", () => {
    const renderer = createCallRenderer("ctx_execute_file", "CM Execute File");
    expect(renderer(undefined, theme).render(120)).toEqual(["CM Execute File"]);
    expect(renderer(null, theme).render(120)).toEqual(["CM Execute File"]);
  });

  it("execute-file call renderer shows the script below the target path", () => {
    const renderer = createCallRenderer("ctx_execute_file", "CM Execute File");
    const initialComponent = renderer({}, theme);
    const component = renderer(
      {
        path: "/tmp/example.txt",
        language: "javascript",
        code: "const lines = FILE_CONTENT.split(\"\\n\");\nreturn lines.length;",
      },
      theme,
      { lastComponent: initialComponent },
    );

    expect(component.render(120)).toEqual([
      "CM Execute File /tmp/example.txt",
      '  const lines = FILE_CONTENT.split("\\n");',
      "  return lines.length;",
    ]);
  });

  it("batch call renderer lists commands below the title", () => {
    const renderer = createCallRenderer("ctx_batch_execute", "CM Batch Execute");
    const initialComponent = renderer({}, theme);
    const component = renderer(
      {
        commands: [
          { label: "test", command: "npm test" },
          { label: "lint", command: "npm run lint" },
        ],
      },
      theme,
      { lastComponent: initialComponent },
    );

    expect(component.render(120)).toEqual(["CM Batch Execute 2 command(s)", "  1. test: npm test", "  2. lint: npm run lint"]);
  });

  it("extractText handles circular objects", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(extractText(circular)).toBe("[Unserializable result]");
  });
});
