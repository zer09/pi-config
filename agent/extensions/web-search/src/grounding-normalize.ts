import { asArray, asRecord, asString } from "./value-guards.js";
import type { GroundingSource, GroundingSupport, NormalizedGeminiGroundingResponse } from "./types.js";

function asIntegerArray(value: unknown): number[] {
  return asArray(value).filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0);
}

function utf8OffsetToUtf16(text: string, offset: unknown): number | undefined {
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) return undefined;

  let byteIndex = 0;
  let utf16Index = 0;
  for (const character of text) {
    if (byteIndex === offset) return utf16Index;
    byteIndex += Buffer.byteLength(character, "utf8");
    utf16Index += character.length;
    // An offset inside a UTF-8 character has no matching string position.
    if (byteIndex > offset) return undefined;
  }
  return byteIndex === offset ? utf16Index : undefined;
}

/**
 * Normalizes a Gemini generateContent grounding response.
 *
 * The response shape is identical for the Parallel and Exa grounding
 * partners, so one normalizer covers both.
 */
export function normalizeGeminiGroundingResponse(response: unknown): NormalizedGeminiGroundingResponse {
  const root = asRecord(response) ?? {};
  const candidate = asRecord(asArray(root.candidates)[0]);
  const content = asRecord(candidate?.content);
  const parts = asArray(content?.parts);
  let answerLength = 0;
  // Keep original Part indices, including entries without text.
  const textParts = parts.map((part) => {
    const text = asString(asRecord(part)?.text);
    const startIndex = answerLength;
    answerLength += text?.length ?? 0;
    return { text, startIndex };
  });
  const answer = textParts.map((part) => part.text ?? "").join("");

  const groundingMetadata = asRecord(candidate?.groundingMetadata) ?? {};
  const groundingChunks = asArray(groundingMetadata.groundingChunks);
  const sources: GroundingSource[] = groundingChunks
    .map((chunk, groundingId) => {
      const web = asRecord(asRecord(chunk)?.web);
      return {
        groundingId,
        title: asString(web?.title),
        url: asString(web?.uri),
        domain: asString(web?.domain),
      };
    })
    .filter((source) => source.title || source.url);

  const supports: GroundingSupport[] = asArray(groundingMetadata.groundingSupports)
    .map((support) => {
      const supportObject = asRecord(support) ?? {};
      const segment = asRecord(supportObject.segment) ?? {};
      const normalized: GroundingSupport = {
        text: asString(segment.text) ?? "",
        startIndex: undefined,
        endIndex: undefined,
        groundingChunkIndices: asIntegerArray(supportObject.groundingChunkIndices),
      };

      // Recorded responses without partIndex use offsets across the whole answer.
      let text = answer;
      let baseIndex = 0;
      if (Object.hasOwn(segment, "partIndex")) {
        const partIndex = segment.partIndex;
        if (typeof partIndex !== "number" || !Number.isInteger(partIndex) || partIndex < 0) return normalized;
        const part = textParts[partIndex];
        if (part?.text === undefined) return normalized;
        text = part.text;
        baseIndex = part.startIndex;
      }

      const startIndex = utf8OffsetToUtf16(text, Object.hasOwn(segment, "startIndex") ? segment.startIndex : 0);
      const endIndex = utf8OffsetToUtf16(text, segment.endIndex);
      if (startIndex !== undefined && endIndex !== undefined && startIndex <= endIndex) {
        normalized.startIndex = baseIndex + startIndex;
        normalized.endIndex = baseIndex + endIndex;
      }
      return normalized;
    })
    .filter((support) => support.text.length > 0 || support.groundingChunkIndices.length > 0);

  const promptFeedback = asRecord(root.promptFeedback);
  const promptBlockReason = asString(promptFeedback?.blockReason);
  const finishReason = asString(candidate?.finishReason);

  return {
    answer,
    finishReason,
    cleanSuccess: finishReason === "STOP" && answer.trim().length > 0,
    sources,
    supports,
    webSearchQueries: asArray(groundingMetadata.webSearchQueries).filter(
      (query): query is string => typeof query === "string",
    ),
    usage: root.usageMetadata,
    googleResponseId: asString(root.responseId),
    modelVersion: asString(root.modelVersion),
    promptBlockReason,
  };
}

export function extractBenchmarkResponseJson(benchmark: unknown): unknown {
  const root = asRecord(benchmark) ?? {};
  const rawResponse = asRecord(root.rawResponse) ?? {};
  return rawResponse.bodyJson ?? benchmark;
}
