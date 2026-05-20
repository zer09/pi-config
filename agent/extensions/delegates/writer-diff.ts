import * as fs from "node:fs";
import * as path from "node:path";

import {
	WRITER_DIFF_CONTEXT_LINES,
	WRITER_DIFF_MAX_CHANGED_FILES,
	WRITER_DIFF_MAX_FILE_BYTES,
	WRITER_DIFF_MAX_LCS_CELLS,
	WRITER_DIFF_MAX_LINE_CHARS,
	WRITER_DIFF_MAX_PREVIEW_BYTES,
	WRITER_DIFF_MAX_PREVIEW_LINES,
	WRITER_DIFF_SNAPSHOT_CONCURRENCY,
} from "./constants.ts";
import { redactSensitiveText } from "./redaction.ts";
import { isBinaryBuffer } from "./text-files.ts";
import type { WriterDiffPreview, WriterFileChange, WriterFileChangeStatus, WriterToolDetails } from "./types.ts";

export interface WriterFileSnapshot {
	path: string;
	displayPath: string;
	exists: boolean;
	size: number | null;
	content?: string;
	skipReason?: string;
}

function isPathInside(base: string, candidate: string): boolean {
	const relative = path.relative(base, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function displayPath(filePath: string, cwd: string): string {
	const relative = path.relative(cwd, filePath);
	if (relative && isPathInside(cwd, filePath)) return redactSensitiveText(relative);
	return redactSensitiveText(filePath);
}

async function readFileWithCap(filePath: string): Promise<{ buffer: Buffer; tooLarge: boolean }> {
	const handle = await fs.promises.open(filePath, "r");
	try {
		const buffer = Buffer.alloc(WRITER_DIFF_MAX_FILE_BYTES + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		if (bytesRead > WRITER_DIFF_MAX_FILE_BYTES) return { buffer: buffer.subarray(0, WRITER_DIFF_MAX_FILE_BYTES), tooLarge: true };
		return { buffer: buffer.subarray(0, bytesRead), tooLarge: false };
	} finally {
		await handle.close();
	}
}

async function snapshotFile(filePath: string, cwd: string): Promise<WriterFileSnapshot> {
	const base = { path: filePath, displayPath: displayPath(filePath, cwd) };
	let stats: fs.Stats;
	try {
		stats = await fs.promises.lstat(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...base, exists: false, size: null };
		return { ...base, exists: false, size: null, skipReason: "stat failed" };
	}

	if (!stats.isFile()) {
		return { ...base, exists: true, size: stats.size, skipReason: stats.isDirectory() ? "path is a directory" : "path is not a regular file" };
	}
	if (stats.size > WRITER_DIFF_MAX_FILE_BYTES) {
		return { ...base, exists: true, size: stats.size, skipReason: `file exceeds ${WRITER_DIFF_MAX_FILE_BYTES} bytes` };
	}

	let readResult: { buffer: Buffer; tooLarge: boolean };
	try {
		readResult = await readFileWithCap(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...base, exists: false, size: null };
		return { ...base, exists: true, size: stats.size, skipReason: "read failed" };
	}
	const { buffer, tooLarge } = readResult;
	if (tooLarge) return { ...base, exists: true, size: stats.size, skipReason: `file exceeds ${WRITER_DIFF_MAX_FILE_BYTES} bytes` };
	if (isBinaryBuffer(buffer)) return { ...base, exists: true, size: stats.size, skipReason: "binary file" };
	return { ...base, exists: true, size: buffer.byteLength, content: buffer.toString("utf8") };
}

export async function captureWriterFileSnapshots(filePaths: string[], cwd: string): Promise<WriterFileSnapshot[]> {
	const snapshots = new Array<WriterFileSnapshot>(filePaths.length);
	let nextIndex = 0;
	const workerCount = Math.min(WRITER_DIFF_SNAPSHOT_CONCURRENCY, filePaths.length);
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < filePaths.length) {
				const index = nextIndex;
				nextIndex += 1;
				snapshots[index] = await snapshotFile(filePaths[index], cwd);
			}
		}),
	);
	return snapshots;
}

function splitLines(text: string): string[] {
	if (text === "") return [];
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const withoutTrailingNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
	return withoutTrailingNewline === "" ? [] : withoutTrailingNewline.split("\n");
}

function trimDiffLine(line: string): string {
	const redacted = redactSensitiveText(line);
	if (redacted.length <= WRITER_DIFF_MAX_LINE_CHARS) return redacted;
	return `${redacted.slice(0, WRITER_DIFF_MAX_LINE_CHARS - 3)}...`;
}

type LineDiffOp = { type: "equal" | "remove" | "add"; line: string };

function compactLineDiff(oldLines: string[], newLines: string[]): LineDiffOp[] {
	let prefix = 0;
	while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;

	let oldSuffix = oldLines.length;
	let newSuffix = newLines.length;
	while (oldSuffix > prefix && newSuffix > prefix && oldLines[oldSuffix - 1] === newLines[newSuffix - 1]) {
		oldSuffix -= 1;
		newSuffix -= 1;
	}

	const leading = oldLines.slice(0, prefix).map((line): LineDiffOp => ({ type: "equal", line }));
	const trailing = oldLines.slice(oldSuffix).map((line): LineDiffOp => ({ type: "equal", line }));
	const oldMiddle = oldLines.slice(prefix, oldSuffix);
	const newMiddle = newLines.slice(prefix, newSuffix);
	const middleCells = oldMiddle.length * newMiddle.length;

	let middle: LineDiffOp[];
	if (middleCells > WRITER_DIFF_MAX_LCS_CELLS) {
		middle = [
			...oldMiddle.map((line): LineDiffOp => ({ type: "remove", line })),
			...newMiddle.map((line): LineDiffOp => ({ type: "add", line })),
		];
	} else {
		middle = lcsLineDiff(oldMiddle, newMiddle);
	}
	return [...leading, ...middle, ...trailing];
}

function lcsLineDiff(oldLines: string[], newLines: string[]): LineDiffOp[] {
	const width = newLines.length + 1;
	const table = new Uint32Array((oldLines.length + 1) * width);
	for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
		for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
			const current = oldIndex * width + newIndex;
			if (oldLines[oldIndex] === newLines[newIndex]) {
				table[current] = table[(oldIndex + 1) * width + newIndex + 1] + 1;
			} else {
				table[current] = Math.max(table[(oldIndex + 1) * width + newIndex], table[oldIndex * width + newIndex + 1]);
			}
		}
	}

	const ops: LineDiffOp[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < oldLines.length || newIndex < newLines.length) {
		if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
			ops.push({ type: "equal", line: oldLines[oldIndex] });
			oldIndex += 1;
			newIndex += 1;
		} else if (
			oldIndex < oldLines.length &&
			(newIndex >= newLines.length || table[(oldIndex + 1) * width + newIndex] >= table[oldIndex * width + newIndex + 1])
		) {
			ops.push({ type: "remove", line: oldLines[oldIndex] });
			oldIndex += 1;
		} else if (newIndex < newLines.length) {
			ops.push({ type: "add", line: newLines[newIndex] });
			newIndex += 1;
		}
	}
	return ops;
}

function countChangedOps(ops: LineDiffOp[]): { additions: number; deletions: number } {
	return ops.reduce(
		(counts, op) => {
			if (op.type === "add") counts.additions += 1;
			if (op.type === "remove") counts.deletions += 1;
			return counts;
		},
		{ additions: 0, deletions: 0 },
	);
}

function countChangedLines(oldText: string, newText: string): { additions: number; deletions: number } {
	return countChangedOps(compactLineDiff(splitLines(oldText), splitLines(newText)));
}

function hunkLines(oldText: string, newText: string): string[] {
	const ops = compactLineDiff(splitLines(oldText), splitLines(newText));
	const changedIndexes = ops.flatMap((op, index) => (op.type === "equal" ? [] : [index]));
	if (changedIndexes.length === 0) return [];

	const included = new Array<boolean>(ops.length).fill(false);
	for (const index of changedIndexes) {
		const start = Math.max(0, index - WRITER_DIFF_CONTEXT_LINES);
		const end = Math.min(ops.length - 1, index + WRITER_DIFF_CONTEXT_LINES);
		for (let includeIndex = start; includeIndex <= end; includeIndex += 1) included[includeIndex] = true;
	}

	const lines: string[] = [];
	let skipped = false;
	for (let index = 0; index < ops.length; index += 1) {
		if (!included[index]) {
			skipped = true;
			continue;
		}
		if (skipped) {
			lines.push("  ...");
			skipped = false;
		}
		const op = ops[index];
		const prefix = op.type === "add" ? "+" : op.type === "remove" ? "-" : " ";
		lines.push(`${prefix} ${trimDiffLine(op.line)}`);
	}
	if (skipped) lines.push("  ...");
	return lines;
}

function prefixedLines(prefix: string, text: string): string[] {
	return splitLines(text).map((line) => `${prefix} ${trimDiffLine(line)}`);
}

function makeChange(before: WriterFileSnapshot, after: WriterFileSnapshot): WriterFileChange {
	let status: WriterFileChangeStatus = "unchanged";
	let additions = 0;
	let deletions = 0;
	let reason: string | undefined;

	if (before.skipReason || after.skipReason) {
		status = "skipped";
		reason = after.skipReason ?? before.skipReason;
	} else if (!before.exists && !after.exists) {
		status = "unchanged";
	} else if (!before.exists && after.exists) {
		status = "created";
		additions = splitLines(after.content ?? "").length;
	} else if (before.exists && !after.exists) {
		status = "deleted";
		deletions = splitLines(before.content ?? "").length;
	} else if ((before.content ?? "") !== (after.content ?? "")) {
		status = "modified";
		const counts = countChangedLines(before.content ?? "", after.content ?? "");
		additions = counts.additions;
		deletions = counts.deletions;
	}

	return {
		path: after.displayPath,
		status,
		oldSize: before.size,
		newSize: after.size,
		additions,
		deletions,
		...(reason ? { reason } : {}),
	};
}

function previewForChange(before: WriterFileSnapshot, after: WriterFileSnapshot, change: WriterFileChange): string[] {
	if (change.status === "unchanged") return [];
	if (change.status === "skipped") return [`skip ${change.path}: ${change.reason ?? "diff unavailable"}`];
	if (change.status === "created") return [`write ${change.path}`, ...prefixedLines("+", after.content ?? "")];
	if (change.status === "deleted") return [`delete ${change.path}`, ...prefixedLines("-", before.content ?? "")];
	return [`edit ${change.path}`, ...hunkLines(before.content ?? "", after.content ?? "")];
}

function appendCapped(lines: string[], next: string, byteCount: number): { byteCount: number; truncated: boolean } {
	const redacted = redactSensitiveText(next);
	const nextBytes = Buffer.byteLength(redacted + "\n", "utf8");
	if (lines.length >= WRITER_DIFF_MAX_PREVIEW_LINES || byteCount + nextBytes > WRITER_DIFF_MAX_PREVIEW_BYTES) {
		return { byteCount, truncated: true };
	}
	lines.push(redacted);
	return { byteCount: byteCount + nextBytes, truncated: false };
}

export async function buildWriterDiffPreview(before: WriterFileSnapshot[], filePaths: string[], cwd: string): Promise<WriterDiffPreview> {
	const beforeByPath = new Map(before.map((snapshot) => [snapshot.path, snapshot]));
	const after = await captureWriterFileSnapshots(filePaths, cwd);
	const changedFiles: WriterFileChange[] = [];
	const previewLines: string[] = [];
	let byteCount = 0;
	let diffTruncated = false;

	for (const afterSnapshot of after) {
		const beforeSnapshot = beforeByPath.get(afterSnapshot.path) ?? { ...afterSnapshot, exists: false, size: null, content: undefined, skipReason: undefined };
		const change = makeChange(beforeSnapshot, afterSnapshot);
		changedFiles.push(change);
		if (diffTruncated) continue;
		for (const line of previewForChange(beforeSnapshot, afterSnapshot, change)) {
			const appended = appendCapped(previewLines, line, byteCount);
			byteCount = appended.byteCount;
			if (appended.truncated) {
				diffTruncated = true;
				break;
			}
		}
	}

	if (diffTruncated) {
		if (previewLines.length >= WRITER_DIFF_MAX_PREVIEW_LINES) previewLines[previewLines.length - 1] = "[writer diff preview truncated]";
		else previewLines.push("[writer diff preview truncated]");
	}
	return { changedFiles, diffPreview: previewLines.join("\n"), diffTruncated };
}

export function writerDiffDetailFields(writerDiff: WriterDiffPreview | undefined): Partial<WriterToolDetails> {
	if (!writerDiff) return {};
	const reportableFiles = writerDiff.changedFiles.filter((file) => file.status !== "unchanged");
	const changedFileCount = reportableFiles.filter((file) => file.status === "created" || file.status === "modified" || file.status === "deleted").length;
	const skippedDiffCount = reportableFiles.filter((file) => file.status === "skipped").length;
	const changedFiles = reportableFiles.slice(0, WRITER_DIFF_MAX_CHANGED_FILES);
	return {
		changedFiles,
		changedFileCount,
		skippedDiffCount,
		changedFilesTruncated: reportableFiles.length > changedFiles.length,
		diffPreview: writerDiff.diffPreview,
		diffTruncated: writerDiff.diffTruncated,
	};
}

export function summarizeWriterDiff(diff: WriterDiffPreview | undefined): string {
	if (!diff) return "diff unavailable";
	const changed = diff.changedFiles.filter((file) => file.status === "created" || file.status === "modified" || file.status === "deleted");
	const skipped = diff.changedFiles.filter((file) => file.status === "skipped");
	if (changed.length === 0 && skipped.length === 0) return "no file changes detected";
	const parts: string[] = [];
	if (changed.length > 0) parts.push(`${changed.length} file${changed.length === 1 ? "" : "s"} changed`);
	if (skipped.length > 0) parts.push(`${skipped.length} diff${skipped.length === 1 ? "" : "s"} skipped`);
	return parts.join("; ");
}

export function compactWriterChangeSummary(diff: WriterDiffPreview | undefined, label = "Writer completed"): string {
	if (!diff) return "Writer file diff unavailable.";
	const changed = diff.changedFiles.filter((file) => file.status === "created" || file.status === "modified" || file.status === "deleted");
	if (changed.length === 0) return `${label}: ${summarizeWriterDiff(diff)}.`;
	const listed = changed.slice(0, 5).map((file) => `${file.status} ${file.path}`).join(", ");
	const more = changed.length > 5 ? `, and ${changed.length - 5} more` : "";
	return `${label}: ${changed.length} file${changed.length === 1 ? "" : "s"} changed: ${listed}${more}.`;
}
