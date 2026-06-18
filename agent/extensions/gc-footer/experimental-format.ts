/**
 * Experimental Pi feature marker formatting for gc-footer.
 *
 * This module keeps the environment check and rendered marker isolated from the
 * main footer renderer, matching the extension's focused formatter modules.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { EXPERIMENTAL_GLYPH } from "./constants";

const EXPERIMENTAL_TEXT_FALLBACK = "x";

/**
 * Check whether Pi experimental features are enabled for the current process.
 *
 * @returns `true` when Pi is running with experimental features enabled.
 */
export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.PI_EXPERIMENTAL === "1";
}

/**
 * Format the compact experimental-features marker.
 *
 * @param theme - Active Pi theme.
 * @param nerdFont - Whether Nerd Font glyphs should be used.
 * @returns Red experimental marker for the footer.
 */
export function formatExperimentalMarker(theme: Theme, nerdFont: boolean): string {
	return theme.bold(theme.fg("error", nerdFont ? EXPERIMENTAL_GLYPH : EXPERIMENTAL_TEXT_FALLBACK));
}
