/**
 * Secret detection and display redaction for the AgentMemory Pi extension.
 *
 * The extension has two different safety jobs:
 *
 * 1. Refuse writes that look like they contain credentials before any network
 *    request can carry them to AgentMemory.
 * 2. Sanitize all AgentMemory output before it reaches Pi UI, logs, tool
 *    results, or diagnostics.
 *
 * Most helpers below are intentionally conservative. They decode common text
 * obfuscations into candidate variants, score those variants for secret signals,
 * then redact the safest candidate. This file should prefer false positives over
 * leaking credentials. Do not add examples with real credential values.
 *
 * Pi can opt out of local save refusal and output redaction with
 * PI_AGENTMEMORY_SECURITY_ENABLED=0. The default and all unrecognized values
 * are fail-closed/enabled. Plaintext bearer transport
 * checks and URL diagnostic scrubbing intentionally stay independent.
 */

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

type SecurityEnv = { PI_AGENTMEMORY_SECURITY_ENABLED?: string };

/**
 * Return whether Pi-local AgentMemory extension safety checks are enabled.
 *
 * This controls local save refusal and AgentMemory output redaction. Security is
 * enabled by default. Only explicit disabled values turn it off; unknown values
 * remain enabled so typoed configuration fails closed.
 */
export function isSecurityEnabled(env: SecurityEnv = process.env): boolean {
  const rawValue = env.PI_AGENTMEMORY_SECURITY_ENABLED;
  if (rawValue === undefined || rawValue.trim() === "") return true;
  const normalized = rawValue.trim().toLowerCase();
  if (SECURITY_DISABLED_VALUES.has(normalized)) return false;
  if (SECURITY_ENABLED_VALUES.has(normalized)) return true;
  return true;
}

/**
 * Return true when a configured AgentMemory bearer secret would be sent over
 * plaintext HTTP to a non-loopback host.
 */
export function usesPlaintextBearerAuth(baseUrl: string, secret?: string): boolean {
  if (!secret) return false;
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(normalizedHostname(parsed.hostname));
  } catch {
    return false;
  }
}

/**
 * Render a URL safely for diagnostics. Userinfo, query strings, and fragments are
 * removed so status messages cannot echo credentials or signed URLs.
 *
 * This helper is intentionally independent of PI_AGENTMEMORY_SECURITY_ENABLED
 * because configured endpoint URLs can contain credentials or signed data.
 */
export function sanitizeUrlForDisplay(baseUrl: string): string {
  const withoutUserinfo = redactUrlUserinfo(baseUrl);
  try {
    const parsed = new URL(withoutUserinfo);
    parsed.username = parsed.username ? "<redacted>" : "";
    parsed.password = parsed.password ? "<redacted>" : "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return redactSecretLikeText(redactUrlUserinfo(withoutUserinfo)).replace(/[?#].*$/, "");
  }
}

/**
 * Build the warning/error text used when AGENTMEMORY_SECRET is configured for an
 * unsafe plaintext endpoint. The endpoint is sanitized before interpolation.
 */
export function plaintextBearerAuthMessage(baseUrl: string): string {
  return `agentmemory: AGENTMEMORY_SECRET is configured for plaintext HTTP to ${sanitizeUrlForDisplay(baseUrl)}. Bearer tokens and memory payloads can be observed on the network; use HTTPS or an SSH tunnel.`;
}

/**
 * Create a one-shot guard for unsafe bearer transport.
 *
 * The guard warns once by default. When AGENTMEMORY_REQUIRE_HTTPS=1 is present in
 * the supplied environment, it throws instead so callers can fail closed. This
 * transport guard is independent of PI_AGENTMEMORY_SECURITY_ENABLED.
 */
export function createPlaintextBearerAuthGuard(
  warn: (message: string) => void = (message) => console.warn(message),
  env?: { AGENTMEMORY_REQUIRE_HTTPS?: string },
): (baseUrl: string, secret?: string) => void {
  let warned = false;
  return (baseUrl, secret) => {
    if (!usesPlaintextBearerAuth(baseUrl, secret)) return;
    const message = plaintextBearerAuthMessage(baseUrl);
    if ((env || process.env).AGENTMEMORY_REQUIRE_HTTPS === "1") throw new Error(message);
    if (!warned) {
      warned = true;
      warn(message);
    }
  };
}

/**
 * Detect whether a value looks like it contains a credential.
 *
 * This accepts unknown input because tool parameters and upstream JSON can be any
 * shape. Strings are checked directly and, if they look like JSON, recursively as
 * parsed JSON. Object keys also count: a credential embedded in a key must refuse
 * the write just like a credential embedded in a value.
 */
export function containsSecretLikeContent(
  value: unknown,
  seen = new Set<object>(),
  secretKeyContext = false,
): boolean {
  if (value === undefined || value === null) return false;

  if (typeof value === "string") {
    if (matchesSecretText(value)) return true;
    const trimmed = value.trim();
    if (secretKeyContext && trimmed) return true;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return containsSecretLikeContent(JSON.parse(trimmed), seen, secretKeyContext);
      } catch {
        return false;
      }
    }
    return false;
  }

  if (typeof value !== "object") return secretKeyContext;
  if (seen.has(value)) return secretKeyContext;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsSecretLikeContent(item, seen, secretKeyContext));

  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (matchesSecretText(key)) return true;
    if (containsSecretLikeContent(inner, seen, secretKeyContext || isSecretLikeKey(key))) return true;
  }
  return false;
}

/**
 * Redact secret-like content in free-form text for display.
 *
 * The input may be obfuscated. We generate decoded variants, pick the variant
 * with the strongest secret signal, then redact URL userinfo, private key blocks,
 * bearer runs, quoted assignments, and unquoted assignment tails.
 */
export function redactSecretLikeText(text: string): string {
  const source = textVariants(text)
    .map((variant) => ({ variant, score: secretSignalScore(variant) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || Number(left.variant === text) - Number(right.variant === text))[0]
    ?.variant || text;

  const redactedTransportSecrets = redactUrlUserinfo(source)
    .replace(PRIVATE_KEY_BLOCK_PATTERN, "<redacted private key>")
    .replace(BEARER_VALUE_PATTERN, "$1<redacted>");

  return redactQuotedSecretAssignments(redactedTransportSecrets)
    .replace(
      SECRET_ASSIGNMENT_PATTERN,
      (_match, prefix: string, key: string, separator: string) => `${prefix}${key}${separator}<redacted>`,
    );
}

/**
 * Sanitize text before it is returned through a Pi tool, command, or UI message.
 *
 * JSON-looking text is parsed first so secret-like keys are handled structurally.
 * If parsing fails, the text path still redacts malformed JSON-like content.
 */
export function sanitizeTextForDisplay(text: string): string {
  if (looksLikeJsonText(text)) {
    try {
      return JSON.stringify(redactSecretLikeValue(JSON.parse(text)), null, 2);
    } catch {
      // Fall through to text redaction for malformed JSON-looking content.
    }
  }
  const redacted = redactSecretLikeText(text);
  if (!looksLikeJsonText(redacted)) return redacted;
  try {
    return JSON.stringify(redactSecretLikeValue(JSON.parse(redacted)), null, 2);
  } catch {
    return redacted;
  }
}

/**
 * Recursively redact secret-like fields in arbitrary JSON-compatible values.
 *
 * When a key is secret-like, all non-empty values under it are redacted even if
 * the value itself is short or opaque. Shared/circular references are handled so
 * diagnostic rendering cannot recurse forever or leak through a non-secret alias.
 */
export function redactSecretLikeValue(
  value: unknown,
  seen = new Set<object>(),
  secretKeyContext = false,
  secretObjects?: Set<object>,
): unknown {
  const contextObjects = secretObjects || collectSecretContextObjects(value);
  if (value === undefined || value === null) return value;

  if (typeof value === "string") {
    const redacted = redactSecretLikeText(value);
    if (secretKeyContext && redacted.trim()) return "<redacted>";
    if (looksLikeJsonText(redacted)) {
      try {
        return JSON.stringify(
          redactSecretLikeValue(JSON.parse(redacted), new Set<object>(), secretKeyContext),
          null,
          2,
        );
      } catch {
        return redacted;
      }
    }
    return redacted;
  }

  if (typeof value !== "object") return secretKeyContext ? "<redacted>" : value;
  if (!secretKeyContext && contextObjects.has(value)) return "<redacted>";
  if (seen.has(value)) return secretKeyContext ? "<redacted>" : "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretLikeValue(item, seen, secretKeyContext, contextObjects));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
      redactSecretLikeText(key),
      redactSecretLikeValue(inner, seen, secretKeyContext || isSecretLikeKey(key), contextObjects),
    ]),
  );
}

// -----------------------------------------------------------------------------
// Private constants and types
// -----------------------------------------------------------------------------

type EscapeMode = "numeric" | "css" | "cssLoose" | "decimal" | "octal";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const SECURITY_DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);
const SECURITY_ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

// Separators that users and tools commonly place inside credential-like key names.
// Includes ASCII underscore/hyphen plus Unicode dash compatibility variants.
const SECRET_SEPARATOR_PATTERN = "_\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212\\uFE58\\uFE63\\uFF0D";
const SECRET_KEY_CHAR_PATTERN = `[A-Za-z0-9${SECRET_SEPARATOR_PATTERN}]`;
const SECRET_KEY_PATTERN = `${SECRET_KEY_CHAR_PATTERN}*(?:API[${SECRET_SEPARATOR_PATTERN}]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BEARER|PRIVATE|KEY)${SECRET_KEY_CHAR_PATTERN}*?`;
const SECRET_KEY_NAME_PATTERN = new RegExp(`^${SECRET_KEY_PATTERN}$`, "i");

// Unquoted assignments intentionally consume the rest of the line/string. Once a
// secret-looking key is present, the safest default is to redact the full tail.
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9${SECRET_SEPARATOR_PATTERN}])(${SECRET_KEY_PATTERN})(\\s*[:=${SECRET_SEPARATOR_PATTERN}]\\s*)(?![\"'])([\\s\\S]*\\S[\\s\\S]*)`,
  "gi",
);

// Quoted assignments are parsed manually by redactQuotedSecretAssignments so we
// can handle escaped quotes, missing closing quotes, and adjacent assignments.
const QUOTED_SECRET_ASSIGNMENT_START_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9${SECRET_SEPARATOR_PATTERN}]|(?<=[\"']))((?:[\"'])?)(${SECRET_KEY_PATTERN})\\2(\\s*[:=${SECRET_SEPARATOR_PATTERN}]\\s*)([\"'])`,
  "gi",
);

// Bearer values may arrive split across whitespace after decoding CSS, octal, or
// decimal escapes. Redact the whole run rather than only the first token.
const BEARER_VALUE_PATTERN = /(Bearer\s+)([A-Za-z0-9._~+/=:'"-]{12,}(?:\s+[A-Za-z0-9._~+/=:'"-]{12,})*)(?=$|[\s,;])/gi;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi;

// -----------------------------------------------------------------------------
// Private helpers
// -----------------------------------------------------------------------------

/** Normalize URL hostnames before loopback comparison. */
function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/**
 * Redact userinfo from normal URLs, protocol-relative URLs, path-like URLs, and
 * partially decoded malformed URL forms produced by obfuscation fuzzing.
 */
function redactUrlUserinfo(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:[/\\]{2})([^\s/?#@\\]+(?::[^\s/?#@\\]*)?@)/gi, "$1<redacted>@")
    .replace(/([a-z][a-z0-9+.-]*:[/\\]{2})([^\s/?#@\\]+:[^\s/?#@\\]+)(?=\([^\s/?#@\\]*\.)/gi, "$1<redacted>")
    .replace(/([a-z][a-z0-9+.-]*:[/\\]{2})([^\s/?#@\\]+:[^\s/?#@\\]+)(?=\s+[^\s/?#@\\]*\.)/gi, "$1<redacted>")
    .replace(/(^|[^:])([/\\]{2})([^\s/?#@\\]+(?::[^\s/?#@\\]*)?@)/g, "$1$2<redacted>@")
    .replace(/([/\\])([^\s/?#@\\]+:[^\s/?#@\\]+@)(?=[^\s/?#@\\]+)/g, "$1<redacted>@");
}

/** Decode runs of percent triplets without throwing on malformed UTF-8. */
function decodePercentTriplets(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (sequence: string) => {
    try {
      return decodeURIComponent(sequence);
    } catch {
      return sequence.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    }
  });
}

/** Decode nested percent-encoded text a bounded number of times. */
function decodePercentEncodedText(text: string): string {
  if (!/%[0-9a-f]{2}/i.test(text)) return text;
  let current = text;
  for (let index = 0; index < 3; index += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      decoded = decodePercentTriplets(current);
    }
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

/** Remove junk after a percent sign so noisy percent encodings still normalize. */
function stripMalformedPercentTripletNoise(text: string): string {
  if (!/%(?![0-9a-f]{2})/i.test(text)) return text;
  return text.replace(/%(?![0-9a-f]{2})(?:[^\s%]{1,2})?/gi, "");
}

/** Decode common decimal-style backslash escapes for URL and assignment syntax. */
function decodeNumericEscapeText(text: string): string {
  if (!/\\+(?:0?(?:42|47|55|56|57|72|75)|100|137|34|39|45|46|47|58|61|64|95)/.test(text)) return text;
  return text
    .replace(/\\+(?:0?72|58)/g, ":")
    .replace(/\\+(?:0?57|47)/g, "/")
    .replace(/\\+(?:100|64)/g, "@")
    .replace(/\\+(?:137|95)/g, "_")
    .replace(/\\+(?:0?55|45)/g, "-")
    .replace(/\\+(?:0?75|61)/g, "=")
    .replace(/\\+(?:0?42|34)/g, '"')
    .replace(/\\+(?:0?47|39)/g, "'")
    .replace(/\\+(?:0?56|46)/g, ".");
}

/** Decode generic decimal backslash escapes into printable ASCII. */
function decodeDecimalEscapeText(text: string): string {
  if (!/\\+0*[1-9][0-9]{1,2}/.test(text)) return text;
  return text.replace(/\\+0*([1-9][0-9]{1,2})/g, (match: string, decimal: string) => {
    const codePoint = Number.parseInt(decimal, 10);
    return codePoint >= 32 && codePoint <= 126 ? String.fromCodePoint(codePoint) : match;
  });
}

/** Decode generic octal backslash escapes into printable ASCII. */
function decodeOctalEscapeText(text: string): string {
  if (!/\\+[0-7]{2,3}/.test(text)) return text;
  return text.replace(/\\+([0-7]{2,3})/g, (match: string, octal: string) => {
    const codePoint = Number.parseInt(octal, 8);
    return codePoint >= 32 && codePoint <= 126 ? String.fromCodePoint(codePoint) : match;
  });
}

/**
 * Decode ambiguous short CSS-style punctuation escapes.
 *
 * This is intentionally limited to punctuation. For letters, strict CSS parsing
 * needs spaces to avoid stealing following hex-looking characters.
 */
function decodeLooseCssPunctuationEscapeText(text: string): string {
  if (!/\\+0*(?:22|27|2d|2e|2f|3a|3d|40|5f)\s?/i.test(text)) return text;
  return text
    .replace(/\\+0*3a\s?/gi, ":")
    .replace(/\\+0*2f\s?/gi, "/")
    .replace(/\\+0*40\s?/gi, "@")
    .replace(/\\+0*5f\s?/gi, "_")
    .replace(/\\+0*2d\s?/gi, "-")
    .replace(/\\+0*3d\s?/gi, "=")
    .replace(/\\+0*22\s?/gi, '"')
    .replace(/\\+0*27\s?/gi, "'")
    .replace(/\\+0*2e\s?/gi, ".");
}

/** Decode standards-style CSS hex escapes. */
function decodeStrictCssHexEscapeText(text: string): string {
  if (!/\\+[0-9a-f]{1,6}\s?/i.test(text)) return text;
  return text.replace(/\\+([0-9a-f]{1,6})\s?/gi, (match: string, hex: string) => {
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint <= 0 || codePoint > 0x10ffff) return match;
    return String.fromCodePoint(codePoint);
  });
}

/** Decode CSS escapes with loose punctuation handling followed by strict parsing. */
function decodeCssHexEscapeText(text: string): string {
  return decodeStrictCssHexEscapeText(decodeLooseCssPunctuationEscapeText(text));
}

/** Decode non-standard percent-unicode escapes used by some old encoders. */
function decodePercentUnicodeEscapeText(text: string): string {
  if (!/%(?:U[0-9a-f]{8}|u[0-9a-f]{4})/i.test(text)) return text;
  return text
    .replace(/%U([0-9a-f]{8})/gi, (match: string, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/%u([0-9a-f]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Decode JavaScript, JSON, Python, and shell-style unicode escapes. */
function decodeUnicodeEscapeText(text: string): string {
  if (!/\\+(?:U[0-9a-f]{8}|u[0-9a-f]{4}|u\{[0-9a-f]{1,6}\}|x[0-9a-f]{2})/i.test(text)) return text;
  return text
    .replace(/\\+u\{([0-9a-f]{1,6})\}/gi, (match: string, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/\\+U([0-9a-f]{8})/gi, (match: string, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/\\+u([0-9a-f]{4})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\+x([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Decode decimal and hexadecimal HTML numeric entities. */
function decodeHtmlNumericEntities(text: string): string {
  if (!/&#(?:x[0-9a-f]{1,6}|[0-9]{1,7});?/i.test(text)) return text;
  return text
    .replace(/&#x([0-9a-f]{1,6});?/gi, (match: string, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&#([0-9]{1,7});?/g, (match: string, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    });
}

/** Decode named HTML entities relevant to URL and assignment syntax. */
function decodeHtmlUrlEntities(text: string): string {
  const decodedNumeric = decodeHtmlNumericEntities(text);
  if (!/&(?:amp|sol|colon|commat|lowbar|underbar|hyphen|dash|minus|equals|quot|apos);?/i.test(decodedNumeric)) {
    return decodedNumeric;
  }
  return decodedNumeric
    .replace(/&amp;?/gi, "&")
    .replace(/&sol;?/gi, "/")
    .replace(/&colon;?/gi, ":")
    .replace(/&commat;?/gi, "@")
    .replace(/&lowbar;?/gi, "_")
    .replace(/&underbar;?/gi, "_")
    .replace(/&hyphen;?/gi, "-")
    .replace(/&dash;?/gi, "-")
    .replace(/&minus;?/gi, "-")
    .replace(/&equals;?/gi, "=")
    .replace(/&quot;?/gi, '"')
    .replace(/&apos;?/gi, "'");
}

/** Apply Unicode NFKC so fullwidth and compatibility glyphs normalize. */
function normalizeCompatibilityText(text: string): string {
  return text.normalize("NFKC");
}

/** Remove invisible format characters that can split secret key names. */
function stripInvisibleFormatText(text: string): string {
  if (!/[\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/i.test(text)) return text;
  return text.replace(/[\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gi, "");
}

/** Remove combining marks used to visually obscure key names or URL schemes. */
function stripCombiningMarkText(text: string): string {
  if (!/\p{M}/u.test(text)) return text;
  return text.replace(/\p{M}/gu, "");
}

/** Run the cheap Unicode normalization passes used before and after decoding. */
function normalizeObfuscatedText(text: string): string {
  return stripCombiningMarkText(stripInvisibleFormatText(normalizeCompatibilityText(text)));
}

/** Decode one backslash-escape family without mixing incompatible parsers. */
function decodeBackslashEscapesByMode(text: string, escapeMode: EscapeMode): string {
  switch (escapeMode) {
    case "css":
      return decodeNumericEscapeText(decodeStrictCssHexEscapeText(text));
    case "cssLoose":
      return decodeNumericEscapeText(decodeCssHexEscapeText(text));
    case "decimal":
      return decodeCssHexEscapeText(decodeNumericEscapeText(decodeDecimalEscapeText(text)));
    case "octal":
      return decodeCssHexEscapeText(decodeNumericEscapeText(decodeOctalEscapeText(text)));
    case "numeric":
      return decodeCssHexEscapeText(decodeNumericEscapeText(text));
  }
  return decodeCssHexEscapeText(decodeNumericEscapeText(text));
}

/**
 * Decode one obfuscation strategy for a bounded number of rounds.
 *
 * We run this with several escape modes because CSS, decimal, and octal escapes
 * conflict on short hex-looking sequences. Keeping them as separate variants
 * prevents one decoder from corrupting another decoder's stronger candidate.
 */
function decodeObfuscatedText(text: string, escapeMode: EscapeMode = "numeric"): string {
  let current = text;
  for (let index = 0; index < 4; index += 1) {
    const normalized = normalizeObfuscatedText(current);
    const percentUnicodeDecoded = decodePercentUnicodeEscapeText(normalized);
    const percentDecoded = decodePercentEncodedText(stripMalformedPercentTripletNoise(percentUnicodeDecoded));
    const unicodeDecoded = decodeUnicodeEscapeText(decodePercentUnicodeEscapeText(percentDecoded));
    const escapeDecoded = decodeBackslashEscapesByMode(unicodeDecoded, escapeMode);
    const decoded = normalizeObfuscatedText(decodeHtmlUrlEntities(escapeDecoded));
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

/** True when URL userinfo redaction would alter the text. */
function hasUrlUserinfo(text: string): boolean {
  return redactUrlUserinfo(text) !== text;
}

/** True for canonical userinfo syntax, used to prefer cleaner decoded variants. */
function hasCanonicalUrlUserinfo(text: string): boolean {
  return /[a-z][a-z0-9+.-]*:[/\\]{2}[^\s/?#@\\]+(?::[^\s/?#@\\]*)?@/i.test(text)
    || /(^|[^:])[/\\]{2}[^\s/?#@\\]+(?::[^\s/?#@\\]*)?@/.test(text)
    || /[/\\][^\s/?#@\\]+:[^\s/?#@\\]+@(?=[^\s/?#@\\]+)/.test(text);
}

/** Generate raw and decoded variants that downstream matchers can score. */
function textVariants(text: string): string[] {
  const variants = [text];
  const decodedVariants = [
    decodeObfuscatedText(text, "decimal"),
    decodeObfuscatedText(text, "octal"),
    decodeObfuscatedText(text),
    decodeObfuscatedText(text, "cssLoose"),
    decodeObfuscatedText(text, "css"),
  ];

  for (const decoded of decodedVariants) {
    if (!variants.includes(decoded)) variants.push(decoded);
  }
  return variants;
}

/** Lightweight JSON shape check before attempting JSON.parse. */
function looksLikeJsonText(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

/** True when a field/key name itself denotes a secret context. */
function isSecretLikeKey(key: string): boolean {
  for (const variant of textVariants(key)) {
    SECRET_KEY_NAME_PATTERN.lastIndex = 0;
    if (SECRET_KEY_NAME_PATTERN.test(variant)) return true;
  }
  return false;
}

/**
 * Score secret signals in one decoded variant.
 *
 * A higher score means the variant is more likely to preserve the intended shape
 * of an obfuscated secret, so redactSecretLikeText uses the highest-scoring
 * variant for display redaction.
 */
function secretSignalScore(text: string): number {
  let score = hasUrlUserinfo(text) ? 2 : 0;
  if (hasCanonicalUrlUserinfo(text)) score += 1;
  for (const pattern of [PRIVATE_KEY_BLOCK_PATTERN, BEARER_VALUE_PATTERN, QUOTED_SECRET_ASSIGNMENT_START_PATTERN, SECRET_ASSIGNMENT_PATTERN]) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) score += 1;
  }
  return score;
}

/** True when any raw or decoded variant has a secret signal. */
function matchesSecretText(text: string): boolean {
  if (!text) return false;
  return textVariants(text).some((variant) => secretSignalScore(variant) > 0);
}

/** Find nested assignments inside an unterminated or adjacent quoted value. */
function nestedSecretAssignmentIndex(text: string): number {
  for (const pattern of [QUOTED_SECRET_ASSIGNMENT_START_PATTERN, SECRET_ASSIGNMENT_PATTERN]) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match.index > 0) return match.index;
  }
  return -1;
}

/**
 * Redact quoted secret assignments while preserving surrounding syntax.
 *
 * This manual scanner is deliberately separate from regex replacement because it
 * must handle escaped quotes, missing closing quotes, and adjacent assignments
 * produced after decoding multiple obfuscation schemes.
 */
function redactQuotedSecretAssignments(text: string): string {
  QUOTED_SECRET_ASSIGNMENT_START_PATTERN.lastIndex = 0;
  let output = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = QUOTED_SECRET_ASSIGNMENT_START_PATTERN.exec(text)) !== null) {
    const [fullMatch, prefix, keyQuote, key, separator, valueQuote] = match;
    const valueStart = match.index + fullMatch.length;
    let valueEnd = valueStart;
    let escaped = false;
    let closed = false;
    while (valueEnd < text.length) {
      const char = text[valueEnd];
      if (escaped) {
        escaped = false;
        valueEnd += 1;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        valueEnd += 1;
        continue;
      }
      if (char === valueQuote) {
        closed = true;
        break;
      }
      valueEnd += 1;
    }

    const nestedIndex = nestedSecretAssignmentIndex(text.slice(valueStart, closed ? valueEnd + 1 : valueEnd));
    if (nestedIndex >= 0) {
      valueEnd = valueStart + nestedIndex;
      closed = false;
    }

    output += text.slice(cursor, match.index);
    output += `${prefix}${keyQuote}${key}${keyQuote}${separator}${valueQuote}<redacted>${closed ? valueQuote : ""}`;
    cursor = closed ? valueEnd + 1 : valueEnd;
    QUOTED_SECRET_ASSIGNMENT_START_PATTERN.lastIndex = cursor;
  }
  return output + text.slice(cursor);
}

/**
 * Collect objects that are reachable through a secret-like key. Shared references
 * to those objects must be redacted everywhere, not only under the secret key.
 */
function collectSecretContextObjects(
  value: unknown,
  targets = new Set<object>(),
  seen = new Set<object>(),
  secretKeyContext = false,
): Set<object> {
  if (value === undefined || value === null || typeof value !== "object") return targets;
  if (secretKeyContext) targets.add(value);
  if (seen.has(value)) return targets;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectSecretContextObjects(item, targets, seen, secretKeyContext);
    return targets;
  }

  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    collectSecretContextObjects(inner, targets, seen, secretKeyContext || isSecretLikeKey(key));
  }
  return targets;
}
