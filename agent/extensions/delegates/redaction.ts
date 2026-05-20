import * as os from "node:os";

const SECRET_KEY_PATTERN = /[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BEARER|API_KEY|PRIVATE)[A-Za-z0-9_]*/i;
const SECRET_VALUE_PATTERNS = [
	/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
	/\bAIza[A-Za-z0-9_-]{20,}\b/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
	/\bnpm_[A-Za-z0-9]{20,}\b/g,
	/\bsk-[A-Za-z0-9_-]{8,}\b/g,
];

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
		/(\b[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BEARER|API_KEY|PRIVATE)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"'`,}]+)/gi,
		(match, key, separator, quote) => redactKeyValue(match, key, separator, quote),
	);
	redacted = redacted.replace(/(["'])([^"']+)\1(\s*:\s*)(["'])([^"']+)\4/g, (match, keyQuote, key, separator, valueQuote) => {
		if (!SECRET_KEY_PATTERN.test(key)) return match;
		return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}<redacted>${valueQuote}`;
	});
	return redacted;
}
