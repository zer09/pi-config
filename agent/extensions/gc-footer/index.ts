import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

let requestRender: (() => void) | undefined;

const THINKING_OUTLINE_CIRCLE = "\uf10c";
const THINKING_FILLED_CIRCLE = "\uf111";

type FooterData = {
	getGitBranch(): string | null;
};

export default function gcFooter(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const render = () => tui.requestRender();
			requestRender = render;

			const unsubscribeBranch = footerData.onBranchChange(render);

			return {
				dispose() {
					unsubscribeBranch();
					if (requestRender === render) requestRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					return [renderFooterLine(width, pi, ctx, theme, footerData)];
				},
			};
		});
	});

	pi.on("thinking_level_select", async () => {
		requestRender?.();
	});

	pi.on("model_select", async () => {
		requestRender?.();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setFooter(undefined);
		requestRender = undefined;
	});
}

function renderFooterLine(
	width: number,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	footerData: FooterData,
): string {
	const left = joinSegments([
		theme.fg("dim", formatCwd(ctx.cwd)),
		formatGitBranch(footerData.getGitBranch(), theme),
	]);
	const right = [
		theme.fg("muted", formatModelName(ctx.model?.provider, ctx.model?.id)),
		formatThinkingDot(pi.getThinkingLevel(), theme),
	].join(" ");

	return joinLeftRight(left, right, width);
}

function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	if (!home) return cwd;
	if (cwd === home) return "~";
	return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

function formatGitBranch(branch: string | null, theme: Theme): string | undefined {
	return branch ? theme.fg("muted", `(${branch})`) : undefined;
}

function joinSegments(segments: Array<string | undefined>): string {
	return segments.filter((segment) => segment && visibleWidth(segment) > 0).join(" ");
}

function thinkingColor(level: string): ThemeColor {
	switch (level) {
		case "off":
			return "thinkingOff";
		case "minimal":
			return "thinkingMinimal";
		case "low":
			return "thinkingLow";
		case "medium":
			return "thinkingMedium";
		case "high":
			return "thinkingHigh";
		case "xhigh":
			return "thinkingXhigh";
		default:
			return "thinkingText";
	}
}

function thinkingGlyph(level: string): string {
	return level === "off" ? THINKING_OUTLINE_CIRCLE : THINKING_FILLED_CIRCLE;
}

function formatThinkingDot(level: string, theme: Theme): string {
	return theme.fg(thinkingColor(level), thinkingGlyph(level));
}

function formatModelName(provider: string | undefined, id: string | undefined): string {
	if (!id) return "no-model";
	const base = id.includes("/") ? (id.split("/").pop() ?? id) : id;
	const model = base.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
	return provider ? `${provider}/${model}` : model;
}

function joinLeftRight(left: string, right: string, width: number): string {
	if (width <= 0) return "";

	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
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
