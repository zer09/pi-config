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
const TIMER_RUNNING_GLYPH = "\uf017";
const TIMER_DONE_GLYPH = "\uf00c";
const MCP_SERVER_GLYPH = "\uf233";
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "config.json");

const SEGMENT_KEYS = [
	"cwd",
	"branch",
	"statuses",
	"timer",
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

type PromptTimerState = {
	pendingStartedAt: number | undefined;
	startedAt: number | undefined;
	lastDurationMs: number | undefined;
	interval: ReturnType<typeof setInterval> | undefined;
};

const DEFAULT_CONFIG: FooterConfig = {
	segments: {
		cwd: true,
		branch: true,
		statuses: true,
		timer: true,
		tokens: true,
		context: true,
		model: true,
		thinking: true,
	},
	nerdFont: true,
};

export default function gcFooter(pi: ExtensionAPI): void {
	const config = loadConfig();
	const promptTimer: PromptTimerState = {
		pendingStartedAt: undefined,
		startedAt: undefined,
		lastDurationMs: undefined,
		interval: undefined,
	};
	let currentBranch: string | null | undefined;

	pi.registerCommand("gc-footer", {
		description: "Show gc footer status",
		handler: async (args, ctx) => {
			const command = args.trim();
			// TODO(gc-footer): Add mutating subcommands after config writes are stable:
			// /gc-footer toggle <segment>, /gc-footer nerd-font <on|off>.
			if (command && command !== "status") {
				ctx.ui.notify("Usage: /gc-footer", "error");
				return;
			}

			ctx.ui.notify(formatCommandStatus(config, ctx, pi.getThinkingLevel(), currentBranch), "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const getBranch = () => {
				currentBranch = footerData.getGitBranch();
				return currentBranch;
			};
			const render = () => tui.requestRender();
			const renderBranchChange = () => {
				getBranch();
				render();
			};
			requestRender = render;
			getBranch();

			const unsubscribeBranch = footerData.onBranchChange(renderBranchChange);

			return {
				dispose() {
					unsubscribeBranch();
					if (requestRender === render) requestRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					return [renderFooterLine(width, pi, ctx, theme, footerData, config, promptTimer, getBranch)];
				},
			};
		});
	});

	pi.on("input", async (event, ctx) => {
		if (!ctx.hasUI || event.source !== "interactive") return;
		promptTimer.pendingStartedAt = shouldUseInputStart(event.text, event.images)
			? Date.now()
			: undefined;
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		startPromptTimer(promptTimer, promptTimer.pendingStartedAt ?? Date.now());
	});

	pi.on("thinking_level_select", async () => {
		requestRender?.();
	});

	pi.on("model_select", async () => {
		requestRender?.();
	});

	pi.on("agent_end", async () => {
		if (!stopPromptTimer(promptTimer)) requestRender?.();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearPromptTimer(promptTimer);
		if (ctx.hasUI) ctx.ui.setFooter(undefined);
		requestRender = undefined;
		currentBranch = undefined;
	});
}

function renderFooterLine(
	width: number,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	footerData: FooterData,
	config: FooterConfig,
	promptTimer: PromptTimerState,
	getBranch: () => string | null,
): string {
	const left = joinSegments([
		config.segments.cwd ? theme.fg("dim", formatCwd(ctx.cwd)) : undefined,
		config.segments.branch ? formatGitBranch(getBranch(), theme) : undefined,
	]);
	const middle = config.segments.statuses
		? formatExtensionStatuses(footerData.getExtensionStatuses(), theme, config.nerdFont)
		: undefined;
	const right = joinSegments([
		config.segments.timer ? formatPromptTimer(promptTimer, theme, config.nerdFont) : undefined,
		config.segments.tokens ? formatSessionTokenTotals(ctx, theme) : undefined,
		config.segments.context ? formatContextUsage(ctx, theme) : undefined,
		config.segments.model ? theme.fg("muted", formatModelName(ctx.model?.provider, ctx.model?.id)) : undefined,
		config.segments.thinking ? formatThinkingDot(pi.getThinkingLevel(), theme, config.nerdFont) : undefined,
	]);

	return joinFooterSections(left, middle, right, width);
}

function shouldUseInputStart(text: string, images: readonly unknown[] | undefined): boolean {
	const trimmedText = text.trim();
	return (trimmedText.length > 0 || Boolean(images?.length)) && !trimmedText.startsWith("/");
}

function startPromptTimer(timer: PromptTimerState, startedAt: number): void {
	clearPromptTimerInterval(timer);
	timer.pendingStartedAt = undefined;
	timer.startedAt = startedAt;
	timer.lastDurationMs = undefined;
	timer.interval = setInterval(() => requestRender?.(), 250);
	(timer.interval as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
	requestRender?.();
}

function stopPromptTimer(timer: PromptTimerState): boolean {
	if (timer.startedAt === undefined) {
		timer.pendingStartedAt = undefined;
		return false;
	}

	timer.lastDurationMs = Date.now() - timer.startedAt;
	timer.startedAt = undefined;
	timer.pendingStartedAt = undefined;
	clearPromptTimerInterval(timer);
	requestRender?.();
	return true;
}

function clearPromptTimer(timer: PromptTimerState): void {
	timer.pendingStartedAt = undefined;
	timer.startedAt = undefined;
	timer.lastDurationMs = undefined;
	clearPromptTimerInterval(timer);
}

function clearPromptTimerInterval(timer: PromptTimerState): void {
	if (timer.interval === undefined) return;
	clearInterval(timer.interval);
	timer.interval = undefined;
}

function formatPromptTimer(
	timer: PromptTimerState,
	theme: Theme,
	nerdFont: boolean,
): string | undefined {
	const running = timer.startedAt !== undefined;
	const durationMs = running ? Date.now() - timer.startedAt : timer.lastDurationMs;
	if (durationMs === undefined) return undefined;

	const glyph = nerdFont
		? (running ? TIMER_RUNNING_GLYPH : TIMER_DONE_GLYPH)
		: (running ? "time" : "done");
	const glyphColor: ThemeColor = running ? "accent" : "success";
	return `${theme.fg(glyphColor, glyph)} ${theme.fg("muted", formatDuration(durationMs))}`;
}

function formatDuration(durationMs: number): string {
	return `${(Math.max(0, durationMs) / 1000).toFixed(1)}s`;
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

function formatCommandStatus(
	config: FooterConfig,
	ctx: ExtensionContext,
	thinkingLevel: string,
	branch: string | null | undefined,
): string {
	const enabledSegments = SEGMENT_KEYS.filter((key) => config.segments[key]).join(", ");
	return [
		"gc-footer",
		`segments: ${enabledSegments || "none"}`,
		`theme: ${getActiveThemeName(ctx)}`,
		`model: ${formatModelName(ctx.model?.provider, ctx.model?.id)}`,
		`thinking: ${thinkingLevel}`,
		`branch: ${formatBranchStatus(branch)}`,
		`nerdFont: ${config.nerdFont ? "on" : "off"}`,
	].join("\n");
}

function getActiveThemeName(ctx: ExtensionContext): string {
	const currentTheme = ctx.ui.theme;
	for (const theme of ctx.ui.getAllThemes()) {
		if (ctx.ui.getTheme(theme.name) === currentTheme) return theme.name;
	}
	return "unknown";
}

function formatBranchStatus(branch: string | null | undefined): string {
	if (branch === undefined) return "unknown";
	return branch ?? "none";
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

function formatExtensionStatuses(statuses: ReadonlyMap<string, string>, theme: Theme, nerdFont: boolean): string | undefined {
	const statusText = Array.from(statuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => formatExtensionStatus(sanitizeStatusText(text), theme, nerdFont))
		.filter(Boolean)
		.join(" ");

	return statusText || undefined;
}

function formatExtensionStatus(text: string, theme: Theme, nerdFont: boolean): string {
	const plainText = stripAnsi(text);
	const mcpMatch = plainText.match(/^MCP:\s*(\d+)\s*\/\s*(\d+)\s+servers?$/i);
	if (mcpMatch) {
		const [visibleText, connected, total] = mcpMatch;
		const compactText = `${nerdFont ? MCP_SERVER_GLYPH : "MCP"} ${connected}/${total}`;
		return Number(connected) > 0
			? preserveVisibleTextStyle(text, visibleText, compactText)
			: theme.fg("muted", compactText);
	}

	return text;
}

function preserveVisibleTextStyle(text: string, visibleText: string, compactText: string): string {
	return text.includes(visibleText) ? text.replace(visibleText, compactText) : compactText;
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

	const percent = getTokenPercent(usage.tokens, contextWindow, usage.percent);
	const displayedPercent = getDisplayedTokenPercent(percent);
	return [
		theme.fg(contextUsageColor(displayedPercent.value), `(${displayedPercent.text})`),
		theme.fg("muted", `(${formatTokens(usage.tokens)}/${formatTokens(contextWindow)})`),
	].join(" ");
}

function getTokenPercent(tokens: number, contextWindow: number, percent: number | null | undefined): number {
	return typeof percent === "number" && Number.isFinite(percent)
		? percent
		: (tokens / contextWindow) * 100;
}

function getDisplayedTokenPercent(percent: number): { text: string; value: number } {
	if (percent < 10 && !Number.isInteger(percent)) {
		const text = percent.toFixed(1);
		return { text: `${text}%`, value: Number(text) };
	}

	const value = Math.round(percent);
	return { text: `${value}%`, value };
}

function contextUsageColor(percent: number): ThemeColor {
	if (percent >= 90) return "error";
	if (percent >= 70) return "warning";
	return "muted";
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

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
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
