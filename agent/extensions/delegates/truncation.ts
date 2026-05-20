export function truncateMiddleByChars(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	if (maxChars <= 0) return { text: "", truncated: true };

	const marker = `\n\n[truncated child result to ${maxChars} characters]\n\n`;
	if (marker.length >= maxChars) return { text: marker.slice(0, maxChars), truncated: true };

	const available = maxChars - marker.length;
	const headChars = Math.floor(available * 0.7);
	const tailChars = available - headChars;
	const head = text.slice(0, headChars);
	const tail = tailChars > 0 ? text.slice(-tailChars) : "";
	return { text: head + marker + tail, truncated: true };
}
