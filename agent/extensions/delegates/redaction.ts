import * as os from "node:os";

const SECRET_SEPARATOR_PATTERN = "_\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212\\uFE58\\uFE63\\uFF0D";
const SECRET_KEY_PART_PATTERN = "[A-Za-z0-9]+";
const _SEP = `[${SECRET_SEPARATOR_PATTERN}]`;
const _PART = SECRET_KEY_PART_PATTERN;
const SECRET_KEY_STANDALONE_WORD_PATTERN = `API${_SEP}?KEY|PRIVATE${_SEP}?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH`;
const _STANDALONE_SHAPE = `(?:${_PART}${_SEP})*(?:${SECRET_KEY_STANDALONE_WORD_PATTERN})(?:${_SEP}${_PART})*`;
const _KEY_COMPOUND_SHAPE = `(?:${_PART}${_SEP})+KEY(?:${_SEP}${_PART})*|(?:${_PART}${_SEP})*KEY(?:${_SEP}${_PART})+`;
const SECRET_KEY_NAME_PATTERN = new RegExp(`^(?:${_STANDALONE_SHAPE}|${_KEY_COMPOUND_SHAPE})$`, "i");
const FUSED_SECRET_KEY_NAME_PATTERN = /^(?:[A-Za-z0-9]+)?(?:TOKEN|SECRET|PASSWORD|CREDENTIAL)(?:[0-9]+|ID|KEY|VALUE|HASH)?$/i;
const SECRET_KEY_VALUE_PATTERN = /(\b[A-Za-z0-9][A-Za-z0-9_\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]*)(\s*[:=]\s*)(["']?)([^\s"'`,}]+)\3?/gi;
const SECRET_VALUE_PATTERNS = [
	/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
	/\bAIza[A-Za-z0-9_-]{20,}\b/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
	/\bnpm_[A-Za-z0-9]{20,}\b/g,
	/\bsk-[A-Za-z0-9_-]{8,}\b/g,
];

export function containsSecretValue(text: string): boolean {
	if (/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
	if (/\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(text)) return true;
	return SECRET_VALUE_PATTERNS.some((pattern) => {
		pattern.lastIndex = 0;
		return pattern.test(text);
	});
}

function keyNameVariants(key: string): string[] {
	const camelCase = key.replace(/([a-z0-9])([A-Z])/g, "$1-$2");
	return camelCase === key ? [key] : [key, camelCase];
}

function isSecretLikeKey(key: string): boolean {
	for (const variant of keyNameVariants(key.trim())) {
		if (SECRET_KEY_NAME_PATTERN.test(variant) || FUSED_SECRET_KEY_NAME_PATTERN.test(variant)) return true;
	}
	return false;
}

function normalizedAssignmentValue(value: string): string {
	return value.trim().replace(/^["']+/, "").replace(/["']+$/, "").trim();
}

function isSecretLikeAssignmentKey(key: string, value: string): boolean {
	const normalizedKey = key.trim();
	if (/^BEARER$/i.test(normalizedKey)) return normalizedAssignmentValue(value).length >= 8;
	return isSecretLikeKey(normalizedKey);
}

function redactKeyValue(_match: string, key: string, separator: string, quote = ""): string {
	return `${key}${separator}${quote}<redacted>${quote}`;
}

export function redactSensitiveText(text: string): string {
	let redacted = text;
	const home = os.homedir();
	if (home && home !== "/") redacted = redacted.split(home).join("~");
	redacted = redacted.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "<redacted private key>");
	redacted = redacted.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>");
	for (const pattern of SECRET_VALUE_PATTERNS) redacted = redacted.replace(pattern, "<redacted>");
	redacted = redacted.replace(
		SECRET_KEY_VALUE_PATTERN,
		(match, key, separator, quote, value) => isSecretLikeAssignmentKey(key, value) ? redactKeyValue(match, key, separator, quote) : match,
	);
	redacted = redacted.replace(/(["'])([^"']+)\1(\s*:\s*)(["'])([^"']+)\4/g, (match, keyQuote, key, separator, valueQuote, value) => {
		if (!isSecretLikeAssignmentKey(key, value)) return match;
		return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}<redacted>${valueQuote}`;
	});
	return redacted;
}
