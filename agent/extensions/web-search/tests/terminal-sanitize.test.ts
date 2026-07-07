import { describe, expect, it, mock } from "bun:test";

class TestText {
  private text = "";

  constructor(text = "") {
    this.text = text;
  }

  setText(text: string): void {
    this.text = text;
  }

  render(): string[] {
    return this.text.split("\n");
  }
}

mock.module("@earendil-works/pi-tui", () => ({ Text: TestText }));

const { createWebSearchResultRenderer } = await import("../src/render.js");

function renderedContentLines(component: { render(width?: number): string[] }): string[] {
  return component
    .render(1000)
    .map((line) => line.trim())
    .filter(Boolean);
}

describe("terminal output sanitization", () => {
  it("removes terminal control sequences while preserving readable tool output", () => {
    const unsafe = [
      "before",
      "\x1b[2J\x1b[Hcleared",
      "\x1b]52;c;SGVsbG8=\x07clipboard",
      "\x1bPmalicious\npayload\x1b\\dcs",
      "\x07bell",
      "\x7f\x80c1",
      "safe\rspoof",
      "crlf\r\nnext",
      "after",
    ].join("\n");

    const component = createWebSearchResultRenderer("web_search")(
      { content: [{ type: "text", text: unsafe }], details: { responseId: "test", sourceCount: 0, supportCount: 0 } },
      { expanded: true },
      {},
    );

    expect(renderedContentLines(component).slice(0, 9)).toEqual([
      "before",
      "cleared",
      "clipboard",
      "dcs",
      "bell",
      "c1",
      "safespoof",
      "crlf",
      "next",
    ]);
  });
});
