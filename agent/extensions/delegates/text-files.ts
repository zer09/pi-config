import * as fs from "node:fs";

export function isBinaryBuffer(buffer: Buffer): boolean {
	if (buffer.length === 0) return false;
	if (buffer.includes(0)) return true;
	const text = buffer.toString("utf8");
	const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
	return replacementCount > 0 && replacementCount / Math.max(text.length, 1) > 0.01;
}

export function assertTextFile(filePath: string): void {
	const fd = fs.openSync(filePath, "r");
	try {
		const buffer = Buffer.alloc(4096);
		const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
		if (isBinaryBuffer(buffer.subarray(0, bytesRead))) throw new Error("writer is text-only");
	} finally {
		fs.closeSync(fd);
	}
}

export function containsBinaryLookingText(value: string): boolean {
	return value.includes("\u0000") || value.includes("\0") || value.includes("�");
}
