function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

function prefixByUtf8Bytes(text: string, maxBytes: number): string {
	let low = 0;
	let high = text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (utf8ByteLength(text.slice(0, mid)) <= maxBytes) low = mid;
		else high = mid - 1;
	}
	let end = low;
	if (end > 0 && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
	while (end > 0 && utf8ByteLength(text.slice(0, end)) > maxBytes) end -= 1;
	return text.slice(0, end);
}

function suffixByUtf8Bytes(text: string, maxBytes: number): string {
	let low = 0;
	let high = text.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (utf8ByteLength(text.slice(text.length - mid)) <= maxBytes) low = mid;
		else high = mid - 1;
	}
	let start = text.length - low;
	if (start < text.length && isLowSurrogate(text.charCodeAt(start))) start += 1;
	while (start < text.length && utf8ByteLength(text.slice(start)) > maxBytes) start += 1;
	return text.slice(start);
}

export function truncateMiddleByBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
	if (utf8ByteLength(text) <= maxBytes) return { text, truncated: false };
	if (maxBytes <= 0) return { text: "", truncated: true };

	const marker = `\n\n[truncated child result to ${maxBytes} bytes]\n\n`;
	const markerBytes = utf8ByteLength(marker);
	if (markerBytes >= maxBytes) return { text: prefixByUtf8Bytes(marker, maxBytes), truncated: true };

	const available = maxBytes - markerBytes;
	const headBytes = Math.floor(available * 0.7);
	const tailBytes = available - headBytes;
	const head = prefixByUtf8Bytes(text, headBytes);
	const tail = tailBytes > 0 ? suffixByUtf8Bytes(text, tailBytes) : "";
	return { text: head + marker + tail, truncated: true };
}
