/**
 * Shared footer render invalidation callback.
 *
 * Prompt timers and async git-status refreshes need to request a TUI rerender even
 * though they live outside the footer component closure. This module isolates the
 * one intentional mutable callback shared by those concerns.
 */

let requestRender: (() => void) | undefined;

/**
 * Set the active footer render callback.
 *
 * @param callback - Function that asks Pi's TUI to rerender.
 */
export function setRequestRender(callback: () => void): void {
	requestRender = callback;
}

/**
 * Clear the active footer render callback.
 *
 * @param callback - Optional callback identity guard. When provided, only the matching callback is cleared.
 */
export function clearRequestRender(callback?: () => void): void {
	if (callback && requestRender !== callback) return;
	requestRender = undefined;
}

/**
 * Request a footer rerender if a footer component is currently installed.
 */
export function requestFooterRender(): void {
	requestRender?.();
}
