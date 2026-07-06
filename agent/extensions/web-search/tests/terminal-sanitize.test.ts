import { describe, expect, it } from "bun:test";
import { stripTerminalControlSequences } from "../src/terminal-sanitize.js";

describe("terminal output sanitization", () => {
  it("removes terminal control sequences while preserving readable text", () => {
    const unsafe = [
      "before",
      "\x1b[2J\x1b[Hcleared",
      "\x1b]52;c;SGVsbG8=\x07clipboard",
      "\x1bPmalicious payload\x1b\\dcs",
      "\x07bell",
      "after",
    ].join("\n");

    const sanitized = stripTerminalControlSequences(unsafe);

    expect(sanitized).toBe(["before", "cleared", "clipboard", "dcs", "bell", "after"].join("\n"));
  });
});
