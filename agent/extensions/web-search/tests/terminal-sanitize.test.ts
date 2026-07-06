import { describe, expect, it } from "bun:test";
import { stripTerminalControlSequences } from "../src/terminal-sanitize.js";

describe("terminal output sanitization", () => {
  it("removes terminal control sequences while preserving readable text", () => {
    const unsafe = [
      "before",
      "\x1b[2J\x1b[Hcleared",
      "\x1b]52;c;SGVsbG8=\x07clipboard",
      "\x1bPmalicious\npayload\x1b\\dcs",
      "\x07bell",
      "\x7f\x80c1",
      "after",
    ].join("\n");

    const sanitized = stripTerminalControlSequences(unsafe);

    expect(sanitized).toBe(["before", "cleared", "clipboard", "dcs", "bell", "c1", "after"].join("\n"));
  });
});
