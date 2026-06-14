/**
 * Formatter contracts for gc-footer extension-status plugins.
 *
 * Modules in this directory can export an {@link ExtensionStatusFormatter} as a
 * default export or a named `formatter` export. The registry in `index.ts` loads
 * them automatically and applies them to Pi extension statuses before the middle
 * footer segment is rendered.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FormattedExtensionStatus } from "../types";

/**
 * Input passed to an extension-status formatter.
 */
export interface ExtensionStatusFormatterInput {
	/** Original status text, including any upstream ANSI styling. */
	readonly text: string;
	/** Status text with ANSI styling stripped for matching. */
	readonly plainText: string;
	/** Active Pi theme used to apply footer-compatible colors. */
	readonly theme: Theme;
	/** Whether Nerd Font glyphs should be used for compact symbols. */
	readonly nerdFont: boolean;
}

/**
 * A pluggable formatter for one kind of Pi extension status.
 */
export interface ExtensionStatusFormatter {
	/** Stable formatter name used for validation and debugging. */
	readonly name: string;

	/**
	 * Format the provided status if this plugin recognizes it.
	 *
	 * @param input - Status text and render context.
	 * @returns A formatted status when matched, otherwise `undefined` to let later plugins try.
	 */
	format(input: ExtensionStatusFormatterInput): FormattedExtensionStatus | undefined;
}
