import {
  BEARER_TOKEN_PATTERN,
  MAX_FIELD_CHARS,
  PROVIDER_TOKEN_PATTERN,
  SECRET_ASSIGNMENT_PATTERN,
  SECRET_KEY_PATTERN,
} from "./constants.ts";
import { replaceHome } from "./path-utils.ts";

export function compactString(
  value: unknown,
  fallback: string,
  maxChars = MAX_FIELD_CHARS,
): string {
  let text = "";
  if (typeof value === "string") {
    text = value.trim();
  } else if (value !== undefined && value !== null) {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (!text) text = fallback;
  text = replaceHome(text);
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}...[truncated]`
    : text;
}

export function redactForReturn(value: unknown, key = ""): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return replaceHome(value)
      .replace(BEARER_TOKEN_PATTERN, "$1[REDACTED]")
      .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]")
      .replace(PROVIDER_TOKEN_PATTERN, "[REDACTED_TOKEN]");
  }
  if (Array.isArray(value)) return value.map((item) => redactForReturn(item));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactForReturn(entryValue, entryKey);
    }
    return output;
  }
  return value;
}
