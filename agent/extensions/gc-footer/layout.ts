/**
 * Footer section measurement and joining helpers.
 *
 * This module handles width-aware layout for left, middle, and right footer
 * sections. Rendering modules pass already-formatted segments here and receive a
 * single line that fits the available terminal width.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FooterParts, FooterPartWidths } from "./types";

/**
 * Measure visible widths for the footer sections and required gaps.
 *
 * @param parts - Rendered footer sections.
 * @returns Visible widths and total required width.
 */
export function measureFooterParts(parts: FooterParts): FooterPartWidths {
	const left = visibleWidth(parts.left);
	const middle = visibleWidth(parts.middle ?? "");
	const right = visibleWidth(parts.right);
	const gap = (parts.left && parts.middle ? 1 : 0)
		+ (parts.middle && parts.right ? 1 : 0)
		+ (!parts.middle && parts.left && parts.right ? 1 : 0);
	return { gap, left, middle, right, total: left + middle + right + gap };
}

/**
 * Check if measured footer sections fit within the available width.
 *
 * @param widths - Measured footer widths.
 * @param width - Available terminal width.
 * @returns `true` when the sections fit without truncation.
 */
export function footerSectionsFit(widths: FooterPartWidths, width: number): boolean {
	return width > 0 && widths.total <= width;
}

/**
 * Join footer sections into one width-constrained line.
 *
 * @param parts - Rendered footer sections.
 * @param width - Available terminal width.
 * @param widths - Optional precomputed section widths.
 * @returns One footer line truncated to the available width.
 */
export function joinFooterSections(parts: FooterParts, width: number, widths = measureFooterParts(parts)): string {
	if (width <= 0) return "";
	if (!parts.middle) return joinLeftRight(parts.left, parts.right, width, widths.left, widths.right);

	if (widths.total <= width) {
		return joinLeftMiddleRight(parts.left, parts.middle, parts.right, width, widths.left, widths.middle, widths.right);
	}

	const availableMiddleWidth = width - widths.left - widths.right - widths.gap;
	if (availableMiddleWidth <= 0) {
		return joinLeftRight(parts.left, parts.right, width, widths.left, widths.right);
	}

	const shortenedMiddle = truncateToWidth(parts.middle, availableMiddleWidth, "");
	const shortenedMiddleWidth = visibleWidth(shortenedMiddle);
	return shortenedMiddleWidth > 0
		? joinLeftMiddleRight(parts.left, shortenedMiddle, parts.right, width, widths.left, shortenedMiddleWidth, widths.right)
		: joinLeftRight(parts.left, parts.right, width, widths.left, widths.right);
}

function joinLeftMiddleRight(
	left: string,
	middle: string,
	right: string,
	width: number,
	leftWidth: number,
	middleWidth: number,
	rightWidth: number,
): string {
	const paddingWidth = Math.max(0, width - leftWidth - middleWidth - rightWidth);
	const leftPaddingWidth = left && middle ? Math.max(1, Math.floor(paddingWidth / 2)) : 0;
	const rightPaddingWidth = middle && right ? Math.max(1, paddingWidth - leftPaddingWidth) : 0;
	const line = [
		left,
		" ".repeat(leftPaddingWidth),
		middle,
		" ".repeat(rightPaddingWidth),
		right,
	].join("");

	return truncateToWidth(line, width, "");
}

function joinLeftRight(left: string, right: string, width: number, leftWidth: number, rightWidth: number): string {
	if (width <= 0) return "";

	const gapWidth = left && right ? 1 : 0;

	if (leftWidth + gapWidth + rightWidth <= width) {
		const pad = " ".repeat(width - leftWidth - rightWidth);
		return left + pad + right;
	}

	const availableLeftWidth = Math.max(0, width - rightWidth - gapWidth);
	const shortenedLeft = availableLeftWidth > 0
		? truncateToWidth(left, availableLeftWidth, "")
		: "";
	const shortenedGap = visibleWidth(shortenedLeft) > 0 && right ? " " : "";
	const line = `${shortenedLeft}${shortenedGap}${right}`;

	return truncateToWidth(line, width, "");
}
