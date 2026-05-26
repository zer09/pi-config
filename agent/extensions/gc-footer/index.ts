import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const FALLBACK_THINKING_OUTLINE_CIRCLE = "\u25cb";
const FALLBACK_THINKING_FILLED_CIRCLE = "\u25cf";
const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "config.json");

const SEGMENT_KEYS = [
	"cwd",
	"branch",
	"statuses",
	"tokens",
	"context",
	"model",
	"thinking",
] as const;

type SegmentName = typeof SEGMENT_KEYS[number];
type SegmentConfig = Record<SegmentName, boolean>;

type FooterConfig = {
	segments: SegmentConfig;
	nerdFont: boolean;
};

type FooterData = {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
};

const DEFAULT_CONFIG: FooterConfig = {
	segments: {
		cwd: true,
		branch: true,
		statuses: true,
		tokens: true,
		context: true,
		model: true,
		thinking: true,
	},
	nerdFont: true,
};

export default function gcFooter(pi: ExtensionAPI): void {
	const config = loadConfig();

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
					return [renderFooterLine(width, pi, ctx, theme, footerData, config)];
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

	pi.on("agent_end", async () => {
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
	config: FooterConfig,
): string {
	const left = joinSegments([
		config.segments.cwd ? theme.fg("dim", formatCwd(ctx.cwd)) : undefined,
		config.segments.branch ? formatGitBranch(footerData.getGitBranch(), theme) : undefined,
	]);
	const middle = config.segments.statuses
		? formatExtensionStatuses(footerData.getExtensionStatuses())
		: undefined;
	const right = joinSegments([
		config.segments.tokens ? formatSessionTokenTotals(ctx, theme) : undefined,
		config.segments.context ? formatContextUsage(ctx, theme) : undefined,
		config.segments.model ? theme.fg("muted", formatModelName(ctx.model?.provider, ctx.model?.id)) : undefined,
		config.segments.thinking ? formatThinkingDot(pi.getThinkingLevel(), theme, config.nerdFont) : undefined,
	]);

	return joinFooterSections(left, middle, right, width);
}

function loadConfig(): FooterConfig {
	const config = createDefaultConfig();
	const configPath = process.env.GC_FOOTER_CONFIG_PATH || CONFIG_PATH;
	if (!existsSync(configPath)) return config;

	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8"));
		if (!isRecord(parsed)) return config;

		if (typeof parsed.nerdFont === "boolean") config.nerdFont = parsed.nerdFont;

		if (isRecord(parsed.segments)) {
			for (const key of SEGMENT_KEYS) {
				const value = parsed.segments[key];
				if (typeof value === "boolean") config.segments[key] = value;
			}
		}
	} catch {
		return config;
	}

	return config;
}

function createDefaultConfig(): FooterConfig {
	return {
		segments: { ...DEFAULT_CONFIG.segments },
		nerdFont: DEFAULT_CONFIG.nerdFont,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

function formatExtensionStatuses(statuses: ReadonlyMap<string, string>): string | undefined {
	const statusText = Array.from(statuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatusText(text))
		.filter(Boolean)
		.join(" ");

	return statusText || undefined;
}

function formatSessionTokenTotals(ctx: ExtensionContext, theme: Theme): string | undefined {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = entry.message.usage;
		input += usage.input;
		output += usage.output;
		cacheRead += usage.cacheRead;
		cacheWrite += usage.cacheWrite;
	}

	if (!input && !output && !cacheRead && !cacheWrite) return undefined;

	const inputPart = `↑${formatTokens(input)}${cacheRead ? `/R${formatTokens(cacheRead)}` : ""}`;
	const outputPart = `↓${formatTokens(output)}${cacheWrite ? `/W${formatTokens(cacheWrite)}` : ""}`;
	return theme.fg("muted", `${inputPart} ${outputPart}`);
}

function formatContextUsage(ctx: ExtensionContext, theme: Theme): string | undefined {
	const usage = ctx.getContextUsage();
	if (!usage || usage.tokens === null) return undefined;

	const contextWindow = usage.contextWindow || ctx.model?.contextWindow;
	if (!contextWindow) return undefined;

	return theme.fg("muted", `(${formatTokens(usage.tokens)}/${formatTokens(contextWindow)})`);
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) {
		const thousands = count / 1000;
		return Number.isInteger(thousands) ? `${thousands}k` : `${thousands.toFixed(1)}k`;
	}
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) {
		const millions = count / 1000000;
		return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
	}
	return `${Math.round(count / 1000000)}M`;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
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

function thinkingGlyph(level: string, nerdFont: boolean): string {
	if (level === "off") {
		return nerdFont ? THINKING_OUTLINE_CIRCLE : FALLBACK_THINKING_OUTLINE_CIRCLE;
	}
	return nerdFont ? THINKING_FILLED_CIRCLE : FALLBACK_THINKING_FILLED_CIRCLE;
}

function formatThinkingDot(level: string, theme: Theme, nerdFont: boolean): string {
	return theme.fg(thinkingColor(level), thinkingGlyph(level, nerdFont));
}

function formatModelName(provider: string | undefined, id: string | undefined): string {
	if (!id) return "no-model";
	const base = id.includes("/") ? (id.split("/").pop() ?? id) : id;
	const model = base.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
	return provider ? `${provider}/${model}` : model;
}

function joinFooterSections(
	left: string,
	middle: string | undefined,
	right: string,
	width: number,
): string {
	if (width <= 0) return "";
	if (!middle) return joinLeftRight(left, right, width);

	const leftWidth = visibleWidth(left);
	const middleWidth = visibleWidth(middle);
	const rightWidth = visibleWidth(right);
	const gapWidth = (left && middle ? 1 : 0) + (middle && right ? 1 : 0);

	if (leftWidth + middleWidth + rightWidth + gapWidth <= width) {
		return joinLeftMiddleRight(left, middle, right, width);
	}

	const availableMiddleWidth = width - leftWidth - rightWidth - gapWidth;
	if (availableMiddleWidth <= 0) {
		return joinLeftRight(left, right, width);
	}

	const shortenedMiddle = truncateToWidth(middle, availableMiddleWidth, "");
	return visibleWidth(shortenedMiddle) > 0
		? joinLeftMiddleRight(left, shortenedMiddle, right, width)
		: joinLeftRight(left, right, width);
}

function joinLeftMiddleRight(left: string, middle: string, right: string, width: number): string {
	const leftWidth = visibleWidth(left);
	const middleWidth = visibleWidth(middle);
	const rightWidth = visibleWidth(right);
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
