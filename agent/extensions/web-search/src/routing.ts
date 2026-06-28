import type { FallbackRoute, PrimaryAttempt, WebSearchMode } from "./types.js";

export function classifyFallbackRoute(query: string): FallbackRoute {
  const normalized = query.toLowerCase();
  let score = 0;

  if (/```|\bimport\s+|\bfrom\s+['"]|\bfunction\b|\bclass\b|\binterface\b/.test(query)) score += 4;
  if (/\b(error|exception|stack trace|traceback|typeerror|syntaxerror)\b/.test(normalized)) score += 3;
  if (/\b(code|snippet|example implementation|api usage|sdk usage)\b/.test(normalized)) score += 3;
  if (/\b(implement|integrate|configure|middleware|route handler|schema|validator)\b/.test(normalized)) score += 2;
  if (/\b(react|next\.js|nextjs|zod|express|typescript|python|rust|go|node\.js|npm|package)\b/.test(normalized)) score += 1;

  if (/\b(latest news|mission|schedule|crew|company|market|policy|release date|current version)\b/.test(normalized)) score -= 2;

  return score >= 4 ? "code_search" : "exa_search";
}

export function selectFallbackRoute(query: string, mode: WebSearchMode = "auto"): FallbackRoute {
  if (mode === "web") return "exa_search";
  if (mode === "code") return "code_search";
  return classifyFallbackRoute(query);
}

export function fallbackReasonFromPrimary(primary: PrimaryAttempt): string {
  if (primary.error) return `Gemini+Exa request failed before an HTTP response was received: ${primary.error}`;

  const status = primary.rawResponse?.status;
  if (status && (status < 200 || status >= 300)) {
    if (status === 401 || status === 403) {
      return `Gemini+Exa returned HTTP ${status}; likely Google Cloud quota, billing, API-key restriction, or service availability issue.`;
    }
    if (status === 429) return "Gemini+Exa returned HTTP 429; quota or rate limiting prevented a clean primary answer.";
    if (status >= 500) return `Gemini+Exa returned HTTP ${status}; the primary provider had a server-side or transient failure.`;
    return `Gemini+Exa returned HTTP ${status}, so the primary answer was unavailable.`;
  }

  if (primary.normalized?.promptBlockReason) {
    return `Gemini+Exa prompt was blocked with blockReason=${primary.normalized.promptBlockReason}.`;
  }

  const finishReason = primary.normalized?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    return "Gemini+Exa hit MAX_TOKENS, so the primary answer was incomplete.";
  }
  if (finishReason && finishReason !== "STOP") {
    return `Gemini+Exa returned finishReason=${finishReason}, so the primary answer was not treated as a clean success.`;
  }

  if (!primary.normalized) return "Gemini+Exa returned a response that could not be parsed as normal generateContent JSON.";
  if (primary.normalized.answer.trim().length === 0) return "Gemini+Exa returned no answer text.";
  return "Gemini+Exa did not return a clean STOP finish reason.";
}

export function assertMode(value: unknown): WebSearchMode {
  if (value === undefined || value === null || value === "") return "auto";
  if (value === "auto" || value === "web" || value === "code") return value;
  throw new Error("mode must be one of: auto, web, code");
}
