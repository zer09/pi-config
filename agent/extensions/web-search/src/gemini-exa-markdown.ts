/**
 * Gemini+Exa Markdown renderer.
 *
 * Converts a normalized Gemini native Exa grounding response into the compact
 * Markdown that enters the agent context: answer text with inline citation
 * markers plus a trailing Sources section. The normalizer owns raw response
 * shape handling; this module owns presentation-only citation placement and
 * Markdown cleanup.
 */
import type { GroundingSource, GroundingSupport, NormalizedGeminiExaResponse } from "./types.js";

function getCitationInsertionIndex(text: string, endIndex: number): number {
  // Gemini usually returns endIndex before sentence punctuation, but some
  // responses include punctuation in the segment. Prefer `claim [0].` over
  // `claim. [0]` for cleaner context output.
  let insertionIndex = endIndex;
  while (insertionIndex > 0 && /[.!?,;:]/.test(text[insertionIndex - 1])) {
    insertionIndex -= 1;
  }
  return insertionIndex;
}

function injectGroundingCitations(text: string, groundingSupports: GroundingSupport[]): string {
  const insertions: Array<{ index: number; citation: string }> = [];

  for (const support of groundingSupports) {
    const endIndex = support.endIndex;
    if (
      support.groundingChunkIndices.length === 0 ||
      !Number.isInteger(endIndex) ||
      endIndex < 0 ||
      endIndex > text.length
    ) {
      continue;
    }

    insertions.push({
      index: getCitationInsertionIndex(text, endIndex),
      citation: ` [${support.groundingChunkIndices.join(", ")}]`,
    });
  }

  insertions.sort((left, right) => right.index - left.index);

  let result = text;
  for (const insertion of insertions) {
    result = result.slice(0, insertion.index) + insertion.citation + result.slice(insertion.index);
  }
  return result;
}

function normalizeMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let inFence = false;

  for (let line of lines) {
    const trimmedStart = line.trimStart();
    const startsFence = trimmedStart.startsWith("```");

    if (!inFence) {
      line = line.replace(/^(\s*)\*\s+/, (_match, indent: string) => {
        const normalizedIndent = indent.length >= 8 ? indent.slice(2) : indent;
        return `${normalizedIndent}- `;
      });

      const listMatch = line.match(/^(\s*)(?:-|\d+\.)\s+/);
      const previousLine = output[output.length - 1];
      if (
        listMatch &&
        listMatch[1].length === 0 &&
        previousLine !== undefined &&
        previousLine.trim() !== "" &&
        previousLine.trimEnd().endsWith(":")
      ) {
        output.push("");
      }
    }

    output.push(line);

    if (startsFence) {
      inFence = !inFence;
    }
  }

  return output.join("\n");
}

function normalizeSourceTitle(title: string | undefined): string {
  return String(title ?? "")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/[\t \u00a0]+/g, " ")
    .trim();
}

function formatSourceLine(source: GroundingSource): string {
  const title = normalizeSourceTitle(source.title) || source.domain || "Untitled source";
  if (!source.url) return `[${source.groundingId}] ${title}`;
  return `[${source.groundingId}] ${title} - ${source.url}`;
}

function appendSources(markdown: string, sources: GroundingSource[]): string {
  const sourceLines = sources.length > 0 ? sources.map(formatSourceLine) : ["No sources returned."];
  return `${markdown.trimEnd()}\n\n### Sources:\n\n${sourceLines.join("\n")}\n`;
}

/**
 * Formats a normalized Gemini+Exa response as final context Markdown.
 *
 * @param normalized - Normalized Gemini native Exa grounding response.
 * @returns Markdown with inline citation markers and a trailing Sources section.
 * @example
 * ```ts
 * const markdown = formatGeminiExaMarkdown(normalized);
 * ```
 */
export function formatGeminiExaMarkdown(normalized: NormalizedGeminiExaResponse): string {
  let markdown = injectGroundingCitations(normalized.answer, normalized.supports);
  markdown = normalizeMarkdown(markdown);
  markdown = appendSources(markdown, normalized.sources);
  return markdown;
}
