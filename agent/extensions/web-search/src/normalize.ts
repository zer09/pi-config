import type { GroundingSource, GroundingSupport, NormalizedGeminiExaResponse } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asIntegerArray(value: unknown): number[] {
  return asArray(value).filter((item): item is number => Number.isInteger(item) && item >= 0);
}

export function normalizeGeminiExaResponse(response: unknown): NormalizedGeminiExaResponse {
  const root = asRecord(response) ?? {};
  const candidate = asRecord(asArray(root.candidates)[0]);
  const content = asRecord(candidate?.content);
  const parts = asArray(content?.parts);
  const answer = parts.map((part) => asString(asRecord(part)?.text) ?? "").join("");

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
      return {
        text: asString(segment.text) ?? "",
        startIndex: asNumber(segment.startIndex),
        endIndex: asNumber(segment.endIndex),
        groundingChunkIndices: asIntegerArray(supportObject.groundingChunkIndices),
      };
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
