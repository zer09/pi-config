/**
 * Experimental Pi feature marker formatting for footer.
 *
 * This module keeps the environment check and rendered marker isolated from the
 * main footer renderer, matching the extension's focused formatter modules.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { EXPERIMENTAL_GLYPH } from "./constants";

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
 * @returns Red experimental marker for the footer.
 */
export function formatExperimentalMarker(theme: Theme): string {
	return theme.bold(theme.fg("error", EXPERIMENTAL_GLYPH));
}
