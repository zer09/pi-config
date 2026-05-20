import * as os from "node:os";

export function redactSensitiveText(text: string): string {
	let redacted = text;
	const home = os.homedir();
	if (home && home !== "/") redacted = redacted.split(home).join("~");
	redacted = redacted.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>");
	redacted = redacted.replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "<redacted>");
	redacted = redacted.replace(
		/\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BEARER|API_KEY|PRIVATE)[A-Za-z0-9_]*)\s*[:=]\s*([^\s"'`]+)/gi,
		"$1=<redacted>",
	);
	return redacted;
}
