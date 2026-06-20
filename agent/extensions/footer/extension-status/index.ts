/**
 * Extension-status formatter registry and formatting pipeline.
 *
 * This module powers the middle footer segment. It automatically loads
 * formatter modules from this directory, applies them in deterministic filename
 * order, and falls back to the original status text when no formatter matches.
 */

import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { ANSI_PATTERN } from "../constants";
import type { FormattedExtensionStatus } from "../types";
import { formatter as agentmemoryFormatter } from "./agentmemory";
import { formatter as browserFormatter } from "./browser";
import { formatter as mcpFormatter } from "./mcp";
import type { ExtensionStatusFormatter, ExtensionStatusFormatterInput } from "./types";

const FORMATTER_DIR = dirname(fileURLToPath(import.meta.url));
const FORMATTER_MODULE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const BUILTIN_FORMATTER_FILES = new Set(["agentmemory.ts", "agentmemory.js", "browser.ts", "browser.js", "mcp.ts", "mcp.js"]);
const INFRASTRUCTURE_FILES = new Set(["index.ts", "index.tsx", "index.js", "types.ts", "types.tsx", "types.js"]);
const BUILTIN_FORMATTERS: readonly ExtensionStatusFormatter[] = [agentmemoryFormatter, browserFormatter, mcpFormatter];
const requireFormatter = createRequire(import.meta.url);
const loadFormatter = createFormatterLoader();
const FORMATTERS = [...BUILTIN_FORMATTERS, ...discoverExtensionStatusFormatters()];

/**
 * Format all extension statuses in stable key order.
 *
 * @param statuses - Status text map supplied by Pi footer data.
 * @param theme - Active Pi theme used for formatter colors.
 * @returns Formatted statuses sorted by their original status key.
 */
export function formatExtensionStatusEntries(
	statuses: ReadonlyMap<string, string>,
	theme: Theme,
): FormattedExtensionStatus[] {
	return Array.from(statuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => formatExtensionStatus(sanitizeStatusText(text), theme));
}

/**
 * Join formatted extension statuses for the footer middle segment.
 *
 * @param statuses - Formatted status entries.
 * @param mode - `full` keeps every status; `active` keeps compact-eligible statuses only.
 * @returns Joined status text, or `undefined` when nothing should be rendered.
 */
export function formatExtensionStatuses(
	statuses: readonly FormattedExtensionStatus[],
	mode: "full" | "active" = "full",
): string | undefined {
	const statusText = statuses
		.filter((status) => mode === "full" || status.keepInCompact)
		.map((status) => status.text)
		.filter(Boolean)
		.join(" ");

	return statusText || undefined;
}

function formatExtensionStatus(text: string, theme: Theme): FormattedExtensionStatus {
	const input: ExtensionStatusFormatterInput = {
		text,
		plainText: stripAnsi(text),
		theme,
	};

	for (const formatter of FORMATTERS) {
		const formatted = formatter.format(input);
		if (formatted) return formatted;
	}

	return { text, keepInCompact: true };
}

function discoverExtensionStatusFormatters(): ExtensionStatusFormatter[] {
	try {
		return readdirSync(FORMATTER_DIR, { withFileTypes: true })
			.filter((entry) => entry.isFile() && isFormatterFile(entry.name))
			.map((entry) => entry.name)
			.sort((a, b) => a.localeCompare(b))
			.flatMap((fileName) => loadFormatterModule(join(FORMATTER_DIR, fileName)));
	} catch {
		return [];
	}
}

function isFormatterFile(fileName: string): boolean {
	const baseName = basename(fileName);
	return FORMATTER_MODULE_EXTENSIONS.has(extname(fileName))
		&& !INFRASTRUCTURE_FILES.has(baseName)
		&& !BUILTIN_FORMATTER_FILES.has(baseName);
}

function createFormatterLoader(): (filePath: string) => unknown {
	try {
		const { createJiti } = requireFormatter("jiti") as {
			createJiti: (url: string, options: { interopDefault: boolean; moduleCache: boolean }) => (id: string) => unknown;
		};
		return createJiti(import.meta.url, { interopDefault: false, moduleCache: false });
	} catch {
		return (filePath: string) => requireFormatter(filePath);
	}
}

function loadFormatterModule(filePath: string): ExtensionStatusFormatter[] {
	try {
		const loaded = loadFormatter(filePath) as { default?: unknown; formatter?: unknown };
		const candidate = loaded.default ?? loaded.formatter;
		return isExtensionStatusFormatter(candidate) ? [candidate] : [];
	} catch {
		return [];
	}
}

function isExtensionStatusFormatter(value: unknown): value is ExtensionStatusFormatter {
	return typeof value === "object"
		&& value !== null
		&& typeof (value as { name?: unknown }).name === "string"
		&& typeof (value as { format?: unknown }).format === "function";
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}
