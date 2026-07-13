export type MarkdownEol = "" | "\n" | "\r\n" | "\r";

export interface MarkdownLine {
  readonly start: number;
  readonly contentEnd: number;
  readonly eol: MarkdownEol;
  readonly text: string;
}

export interface MarkdownFence {
  readonly character: "`" | "~";
  readonly length: number;
  readonly openingStart: number;
  readonly openingEol: MarkdownEol;
}

export interface MarkdownFenceScan {
  readonly lines: readonly MarkdownLine[];
  readonly activeFence?: MarkdownFence;
  readonly fenceAtLineStart: ReadonlyMap<number, MarkdownFence>;
}

interface FenceCandidate {
  readonly character: "`" | "~";
  readonly length: number;
  readonly remainder: string;
}

function markdownLines(value: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  let cursor = 0;

  while (cursor < value.length) {
    const character = value[cursor]!;
    if (character !== "\r" && character !== "\n") {
      cursor++;
      continue;
    }

    let eol: Exclude<MarkdownEol, "">;
    let width: number;
    if (character === "\r" && value[cursor + 1] === "\n") {
      eol = "\r\n";
      width = 2;
    } else {
      eol = character;
      width = 1;
    }
    lines.push({
      start,
      contentEnd: cursor,
      eol,
      text: value.slice(start, cursor),
    });
    cursor += width;
    start = cursor;
  }

  lines.push({
    start,
    contentEnd: value.length,
    eol: "",
    text: value.slice(start),
  });
  return lines;
}

function fenceCandidate(line: string): FenceCandidate | undefined {
  let offset = 0;
  while (line[offset] === " ") offset++;
  if (offset > 3) return undefined;

  const character = line[offset];
  if (character !== "`" && character !== "~") return undefined;

  let end = offset;
  while (line[end] === character) end++;
  const length = end - offset;
  if (length < 3) return undefined;

  const remainder = line.slice(end);
  if (character === "`" && remainder.includes("`")) return undefined;
  return { character, length, remainder };
}

export function scanMarkdownFences(value: string): MarkdownFenceScan {
  const lines = markdownLines(value);
  const fenceAtLineStart = new Map<number, MarkdownFence>();
  let activeFence: MarkdownFence | undefined;

  for (const line of lines) {
    if (activeFence) fenceAtLineStart.set(line.start, activeFence);
    const candidate = fenceCandidate(line.text);

    if (activeFence) {
      const closesActiveFence =
        candidate?.character === activeFence.character &&
        candidate.length >= activeFence.length &&
        /^[ \t]*$/.test(candidate.remainder);
      if (closesActiveFence) activeFence = undefined;
      continue;
    }

    if (candidate) {
      activeFence = {
        character: candidate.character,
        length: candidate.length,
        openingStart: line.start,
        openingEol: line.eol,
      };
    }
  }

  return {
    lines,
    fenceAtLineStart,
    ...(activeFence ? { activeFence } : {}),
  };
}
