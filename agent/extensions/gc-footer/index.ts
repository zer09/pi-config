import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

let requestRender: (() => void) | undefined;

const AGENTMEMORY_FALLBACK = "mem";
const AGENTMEMORY_GLYPH = "\uf0c7";
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "config.json");
const FALLBACK_THINKING_FILLED_CIRCLE = "\u25cf";
const FALLBACK_THINKING_OUTLINE_CIRCLE = "\u25cb";
const GIT_STATUS_TIMEOUT_MS = 500;
const GIT_STATUS_TTL_MS = 5000;
const MCP_SERVER_GLYPH = "\uf233";
const QUEUE_GLYPH = "\uf46c";
const THINKING_FILLED_CIRCLE = "\uf111";
const THINKING_OUTLINE_CIRCLE = "\uf10c";
const TIMER_DONE_GLYPH = "\uf00c";
const TIMER_RUNNING_GLYPH = "\uf017";

const SEGMENT_KEYS = [
	"cwd",
	"branch",
	"statuses",
	"timer",
	"queue",
	"tokens",
	"context",
	"model",
	"thinking",
] as const;

type SegmentName = typeof SEGMENT_KEYS[number];
type SegmentConfig = Record<SegmentName, boolean>;
type FooterProfile = "full" | "compact" | "minimal";
type SegmentProfileOverride = FooterProfile | "inherit";
type SegmentProfileConfig = Partial<Record<SegmentName, SegmentProfileOverride>>;
type ContextUsageSnapshot = ReturnType<ExtensionContext["getContextUsage"]>;

type FormattedExtensionStatus = {
	keepInCompact: boolean;
	text: string;
};

type SessionTokenTotals = {
	cacheRead: number;
	cacheWrite: number;
	input: number;
	output: number;
};

type RenderSnapshot = {
	contextUsage: ContextUsageSnapshot;
	cwd: string;
	formattedStatuses: FormattedExtensionStatus[];
	modelContextWindow: number | undefined;
	modelId: string | undefined;
	modelProvider: string | undefined;
	now: number;
	sessionTokenTotals: SessionTokenTotals | undefined;
	thinkingLevel: string;
};

type FooterConfig = {
	nerdFont: boolean;
	segmentProfiles: SegmentProfileConfig;
	segments: SegmentConfig;
};

type FooterData = {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
};

type PromptTimerState = {
	pendingStartedAt: number | undefined;
	pendingClearImmediate: ReturnType<typeof setImmediate> | undefined;
	queuedStartedAts: number[];
	startedAt: number | undefined;
	lastDurationMs: number | undefined;
	interval: ReturnType<typeof setInterval> | undefined;
};

type GitStatus = {
	branch: string | null;
	dirty: boolean;
	ahead: number;
	behind: number;
};

type GitStatusState = {
	cached: GitStatus | undefined;
	cwd: string | undefined;
	refreshedAt: number;
	refreshing: boolean;
	scheduled: ReturnType<typeof setImmediate> | undefined;
};

type FooterParts = {
	left: string;
	middle: string | undefined;
	right: string;
};

const FOOTER_PROFILES: readonly FooterProfile[] = ["full", "compact", "minimal"];

const DEFAULT_CONFIG: FooterConfig = {
	nerdFont: true,
	segmentProfiles: {},
	segments: {
		cwd: true,
		branch: true,
		statuses: true,
		timer: true,
		queue: true,
		tokens: true,
		context: true,
		model: true,
		thinking: true,
	},
};

export default function gcFooter(pi: ExtensionAPI): void {
	const config = loadConfig();
	const promptTimer: PromptTimerState = {
		pendingStartedAt: undefined,
		pendingClearImmediate: undefined,
		queuedStartedAts: [],
		startedAt: undefined,
		lastDurationMs: undefined,
		interval: undefined,
	};
	const gitStatus = createGitStatusState();
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
				const branch = getBranch();
				if (config.segments.branch) scheduleGitStatusRefresh(gitStatus, ctx.cwd, branch, true);
				render();
			};
			requestRender = render;
			const initialBranch = getBranch();
			if (config.segments.branch) scheduleGitStatusRefresh(gitStatus, ctx.cwd, initialBranch, true);

			const unsubscribeBranch = footerData.onBranchChange(renderBranchChange);

			return {
				dispose() {
					unsubscribeBranch();
					clearScheduledGitStatusRefresh(gitStatus);
					if (requestRender === render) requestRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					const branch = getBranch();
					if (config.segments.branch) scheduleGitStatusRefresh(gitStatus, ctx.cwd, branch);
					return [renderFooterLine(
						width,
						pi,
						ctx,
						theme,
						footerData,
						config,
						promptTimer,
						branch,
						config.segments.branch ? getGitStatusForRender(gitStatus, ctx.cwd, branch) : undefined,
					)];
				},
			};
		});
	});

	pi.on("input", async (event, ctx) => {
		if (!ctx.hasUI) return;
		recordPendingPromptStart(promptTimer, event.source, event.text, event.images, event.streamingBehavior);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		startPromptTimer(promptTimer, takePendingPromptStart(promptTimer) ?? Date.now());
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
		clearGitStatus(gitStatus);
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
	branch: string | null,
	gitStatus: GitStatus | undefined,
): string {
	if (width <= 0) return "";

	const snapshot = createRenderSnapshot(pi, ctx, theme, footerData, config);
	let fallback: FooterParts | undefined;
	for (const profile of FOOTER_PROFILES) {
		const parts = buildFooterParts(profile, theme, config, promptTimer, branch, gitStatus, snapshot);
		fallback = parts;
		if (footerSectionsFit(parts, width)) return joinFooterSections(parts.left, parts.middle, parts.right, width);
	}

	return fallback ? joinFooterSections(fallback.left, fallback.middle, fallback.right, width) : "";
}

function createRenderSnapshot(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	theme: Theme,
	footerData: FooterData,
	config: FooterConfig,
): RenderSnapshot {
	return {
		contextUsage: config.segments.context ? ctx.getContextUsage() : undefined,
		cwd: ctx.cwd,
		formattedStatuses: config.segments.statuses
			? formatExtensionStatusEntries(footerData.getExtensionStatuses(), theme, config.nerdFont)
			: [],
		modelContextWindow: ctx.model?.contextWindow,
		modelId: ctx.model?.id,
		modelProvider: ctx.model?.provider,
		now: Date.now(),
		sessionTokenTotals: config.segments.tokens ? getSessionTokenTotals(ctx) : undefined,
		thinkingLevel: config.segments.thinking ? pi.getThinkingLevel() : "off",
	};
}

function buildFooterParts(
	profile: FooterProfile,
	theme: Theme,
	config: FooterConfig,
	promptTimer: PromptTimerState,
	branch: string | null,
	gitStatus: GitStatus | undefined,
	snapshot: RenderSnapshot,
): FooterParts {
	const minimal = profile === "minimal";
	const contextProfile = resolveSegmentProfile(config, "context", profile);
	const cwdProfile = resolveSegmentProfile(config, "cwd", profile);
	const modelProfile = resolveSegmentProfile(config, "model", profile);
	const statusesProfile = resolveSegmentProfile(config, "statuses", profile);
	const tokensProfile = resolveSegmentProfile(config, "tokens", profile);
	const showModel = config.segments.model && (!minimal || hasSegmentProfileOverride(config, "model"));
	const showTokens = config.segments.tokens && tokensProfile !== "minimal" && (!minimal || hasSegmentProfileOverride(config, "tokens"));
	const left = joinSegments([
		config.segments.cwd ? theme.fg("dim", formatCwd(snapshot.cwd, cwdProfile)) : undefined,
		config.segments.branch ? formatGitBranch(branch, theme, gitStatus) : undefined,
	]);
	const middle = config.segments.statuses
		? formatExtensionStatuses(snapshot.formattedStatuses, statusesProfile === "full" ? "full" : "active")
		: undefined;
	const right = joinSegments([
		config.segments.timer ? formatPromptTimer(promptTimer, theme, config.nerdFont, snapshot.now) : undefined,
		config.segments.queue ? formatPromptQueue(promptTimer, theme, config.nerdFont) : undefined,
		showTokens ? formatSessionTokenTotals(snapshot.sessionTokenTotals, theme, tokensProfile === "full" ? "full" : "compact") : undefined,
		config.segments.context ? formatContextUsage(snapshot.contextUsage, snapshot.modelContextWindow, theme, contextProfile === "full" ? "full" : "compact") : undefined,
		showModel ? theme.fg("muted", formatModelName(snapshot.modelProvider, snapshot.modelId, modelProfile)) : undefined,
		config.segments.thinking && !minimal ? formatThinkingDot(snapshot.thinkingLevel, theme, config.nerdFont) : undefined,
	]);

	return { left, middle, right };
}

function recordPendingPromptStart(
	timer: PromptTimerState,
	source: "interactive" | "rpc" | "extension",
	text: string,
	images: readonly unknown[] | undefined,
	streamingBehavior: "steer" | "followUp" | undefined,
): void {
	if (source !== "interactive" || !hasPromptContent(text, images) || streamingBehavior === "steer") {
		clearPendingPromptStart(timer);
		return;
	}

	const startedAt = Date.now();
	if (streamingBehavior === "followUp") {
		clearPendingPromptStart(timer);
		timer.queuedStartedAts.push(startedAt);
		return;
	}

	timer.pendingStartedAt = startedAt;
	schedulePendingPromptStartClear(timer, startedAt);
}

function hasPromptContent(text: string, images: readonly unknown[] | undefined): boolean {
	return text.trim().length > 0 || Boolean(images?.length);
}

function takePendingPromptStart(timer: PromptTimerState): number | undefined {
	const startedAt = timer.pendingStartedAt;
	clearPendingPromptStart(timer);
	return startedAt ?? timer.queuedStartedAts.shift();
}

function schedulePendingPromptStartClear(timer: PromptTimerState, startedAt: number): void {
	clearPendingPromptStartClear(timer);
	timer.pendingClearImmediate = setImmediate(() => {
		timer.pendingClearImmediate = undefined;
		if (timer.pendingStartedAt === startedAt && timer.startedAt === undefined) {
			timer.pendingStartedAt = undefined;
		}
	});
	(timer.pendingClearImmediate as ReturnType<typeof setImmediate> & { unref?: () => void }).unref?.();
}

function clearPendingPromptStart(timer: PromptTimerState): void {
	timer.pendingStartedAt = undefined;
	clearPendingPromptStartClear(timer);
}

function clearPendingPromptStartClear(timer: PromptTimerState): void {
	if (timer.pendingClearImmediate === undefined) return;
	clearImmediate(timer.pendingClearImmediate);
	timer.pendingClearImmediate = undefined;
}

function startPromptTimer(timer: PromptTimerState, startedAt: number): void {
	clearPromptTimerInterval(timer);
	timer.startedAt = startedAt;
	timer.lastDurationMs = undefined;
	timer.interval = setInterval(() => requestRender?.(), 250);
	(timer.interval as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
	requestRender?.();
}

function stopPromptTimer(timer: PromptTimerState): boolean {
	if (timer.startedAt === undefined) return false;

	timer.lastDurationMs = Date.now() - timer.startedAt;
	timer.startedAt = undefined;
	clearPromptTimerInterval(timer);
	requestRender?.();
	return true;
}

function clearPromptTimer(timer: PromptTimerState): void {
	clearPendingPromptStart(timer);
	timer.queuedStartedAts = [];
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
	now = Date.now(),
): string | undefined {
	const running = timer.startedAt !== undefined;
	const durationMs = running ? now - timer.startedAt : timer.lastDurationMs;
	if (durationMs === undefined) return undefined;

	const glyph = nerdFont
		? (running ? TIMER_RUNNING_GLYPH : TIMER_DONE_GLYPH)
		: (running ? "time" : "done");
	const glyphColor: ThemeColor = running ? "accent" : "success";
	return `${theme.fg(glyphColor, glyph)} ${theme.fg("muted", formatDuration(durationMs))}`;
}

function formatPromptQueue(timer: PromptTimerState, theme: Theme, nerdFont: boolean): string | undefined {
	const count = timer.queuedStartedAts.length;
	if (!count) return undefined;
	return theme.fg("muted", `${nerdFont ? QUEUE_GLYPH : "q"} ${count}`);
}

function formatDuration(durationMs: number): string {
	const safeMs = Math.max(0, durationMs);
	const totalSeconds = Math.round(safeMs / 1000);
	if (totalSeconds < 60) return `${(safeMs / 1000).toFixed(1)}s`;

	const minutes = Math.floor(totalSeconds / 60);
	const seconds = String(totalSeconds % 60).padStart(2, "0");
	return `${minutes}:${seconds}`;
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

		if (isRecord(parsed.segmentProfiles)) {
			for (const key of SEGMENT_KEYS) {
				const value = parsed.segmentProfiles[key];
				if (isSegmentProfileOverride(value)) config.segmentProfiles[key] = value;
			}
		}
	} catch {
		return config;
	}

	return config;
}

function createDefaultConfig(): FooterConfig {
	return {
		nerdFont: DEFAULT_CONFIG.nerdFont,
		segmentProfiles: { ...DEFAULT_CONFIG.segmentProfiles },
		segments: { ...DEFAULT_CONFIG.segments },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSegmentProfileOverride(value: unknown): value is SegmentProfileOverride {
	return value === "inherit" || value === "full" || value === "compact" || value === "minimal";
}

function resolveSegmentProfile(config: FooterConfig, segment: SegmentName, footerProfile: FooterProfile): FooterProfile {
	const override = config.segmentProfiles[segment];
	return override && override !== "inherit" ? override : footerProfile;
}

function hasSegmentProfileOverride(config: FooterConfig, segment: SegmentName): boolean {
	const override = config.segmentProfiles[segment];
	return Boolean(override && override !== "inherit");
}

function formatCommandStatus(
	config: FooterConfig,
	ctx: ExtensionContext,
	thinkingLevel: string,
	branch: string | null | undefined,
): string {
	const enabledSegments = SEGMENT_KEYS.filter((key) => config.segments[key]).join(", ");
	const segmentProfiles = formatSegmentProfileOverrides(config);
	return [
		"gc-footer",
		`segments: ${enabledSegments || "none"}`,
		...(segmentProfiles ? [`segmentProfiles: ${segmentProfiles}`] : []),
		`theme: ${getActiveThemeName(ctx)}`,
		`model: ${formatModelName(ctx.model?.provider, ctx.model?.id)}`,
		`thinking: ${thinkingLevel}`,
		`branch: ${formatBranchStatus(branch)}`,
		`nerdFont: ${config.nerdFont ? "on" : "off"}`,
	].join("\n");
}

function formatSegmentProfileOverrides(config: FooterConfig): string {
	return SEGMENT_KEYS.map((key) => {
		const override = config.segmentProfiles[key];
		return override && override !== "inherit" ? `${key}=${override}` : undefined;
	}).filter(Boolean).join(", ");
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

function formatCwd(cwd: string, profile: FooterProfile = "full"): string {
	if (profile !== "full") return formatCwdBasename(cwd);

	const home = process.env.HOME;
	if (!home) return cwd;
	if (cwd === home) return "~";
	return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

function formatCwdBasename(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd === home) return "~";
	return basename(cwd) || cwd;
}

function formatGitBranch(branch: string | null, theme: Theme, gitStatus: GitStatus | undefined): string | undefined {
	const status = gitStatus ?? (branch ? { branch, dirty: false, ahead: 0, behind: 0 } : undefined);
	if (!status?.branch) return undefined;

	const sync = formatGitSyncStatus(status.ahead, status.behind);
	const dirty = status.dirty ? "*" : "";
	const text = `(${status.branch}${sync ? ` ${sync}` : ""}${dirty})`;
	return theme.fg(status.dirty ? "warning" : "muted", text);
}

function formatGitSyncStatus(ahead: number, behind: number): string {
	return [ahead ? `+${ahead}` : undefined, behind ? `-${behind}` : undefined].filter(Boolean).join("/");
}

function createGitStatusState(): GitStatusState {
	return {
		cached: undefined,
		cwd: undefined,
		refreshedAt: 0,
		refreshing: false,
		scheduled: undefined,
	};
}

function getGitStatusForRender(state: GitStatusState, cwd: string, branch: string | null): GitStatus | undefined {
	if (!branch) return undefined;
	if (state.cwd !== cwd || state.cached?.branch !== branch) {
		return { branch, dirty: false, ahead: 0, behind: 0 };
	}
	return state.cached;
}

function scheduleGitStatusRefresh(
	state: GitStatusState,
	cwd: string,
	branch: string | null,
	force = false,
): void {
	if (!branch) {
		clearScheduledGitStatusRefresh(state);
		state.cached = undefined;
		state.cwd = cwd;
		state.refreshedAt = 0;
		return;
	}

	const now = Date.now();
	const cwdChanged = state.cwd !== cwd;
	const branchChanged = Boolean(state.cached?.branch && state.cached.branch !== branch);
	if (cwdChanged) {
		state.cwd = cwd;
		state.cached = branch ? { branch, dirty: false, ahead: 0, behind: 0 } : undefined;
		state.refreshedAt = 0;
	} else if (branchChanged) {
		state.refreshedAt = 0;
	}

	if (!force && !cwdChanged && !branchChanged && now - state.refreshedAt < GIT_STATUS_TTL_MS) return;
	if (state.refreshing || state.scheduled !== undefined) return;

	state.scheduled = setImmediate(() => {
		state.scheduled = undefined;
		void refreshGitStatus(state, cwd, branch);
	});
	(state.scheduled as ReturnType<typeof setImmediate> & { unref?: () => void }).unref?.();
}

async function refreshGitStatus(state: GitStatusState, cwd: string, branch: string | null): Promise<void> {
	state.refreshing = true;
	state.refreshedAt = Date.now();
	const status = await readGitStatus(cwd, branch);
	state.refreshing = false;
	if (state.cwd !== cwd) return;

	if (status) {
		state.cached = status;
	} else if (!state.cached && branch) {
		state.cached = { branch, dirty: false, ahead: 0, behind: 0 };
	}
	requestRender?.();
}

function readGitStatus(cwd: string, fallbackBranch: string | null): Promise<GitStatus | undefined> {
	return new Promise((resolve) => {
		let resolved = false;
		let status: GitStatus = {
			branch: fallbackBranch,
			dirty: false,
			ahead: 0,
			behind: 0,
		};
		let pendingLine = "";
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let child: ReturnType<typeof spawn>;

		const finish = (result: GitStatus | undefined) => {
			if (resolved) return;
			resolved = true;
			if (timeout !== undefined) clearTimeout(timeout);
			resolve(result);
		};

		const parseLine = (line: string) => {
			status = parseGitStatusLine(line, status);
		};

		try {
			child = spawn("git", ["status", "--porcelain=v2", "--branch"], {
				cwd,
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			finish(undefined);
			return;
		}

		timeout = setTimeout(() => {
			child.kill();
			finish(undefined);
		}, GIT_STATUS_TIMEOUT_MS);
		(timeout as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			pendingLine += chunk;
			let newlineIndex = pendingLine.indexOf("\n");
			while (newlineIndex !== -1) {
				parseLine(pendingLine.slice(0, newlineIndex).replace(/\r$/, ""));
				pendingLine = pendingLine.slice(newlineIndex + 1);
				if (status.dirty && status.branch) {
					child.kill();
					finish(status);
					return;
				}
				newlineIndex = pendingLine.indexOf("\n");
			}
		});
		child.on("error", () => finish(undefined));
		child.on("close", (code) => {
			if (pendingLine) parseLine(pendingLine.replace(/\r$/, ""));
			finish(code === 0 && status.branch ? status : undefined);
		});
		child.unref?.();
	});
}

function parseGitStatusLine(line: string, status: GitStatus): GitStatus {
	if (!line) return status;
	if (line.startsWith("# branch.head ")) {
		return {
			...status,
			branch: normalizeGitBranch(line.slice("# branch.head ".length).trim(), status.branch),
		};
	}
	if (line.startsWith("# branch.ab ")) {
		const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
		return match ? { ...status, ahead: Number(match[1]), behind: Number(match[2]) } : status;
	}
	return line.startsWith("#") ? status : { ...status, dirty: true };
}

function normalizeGitBranch(head: string, fallbackBranch: string | null): string | null {
	if (!head || head === "(unknown)") return fallbackBranch;
	return head === "(detached)" ? "detached" : head;
}

function clearGitStatus(state: GitStatusState): void {
	clearScheduledGitStatusRefresh(state);
	state.cached = undefined;
	state.cwd = undefined;
	state.refreshedAt = 0;
	state.refreshing = false;
}

function clearScheduledGitStatusRefresh(state: GitStatusState): void {
	if (state.scheduled === undefined) return;
	clearImmediate(state.scheduled);
	state.scheduled = undefined;
}

function formatExtensionStatusEntries(
	statuses: ReadonlyMap<string, string>,
	theme: Theme,
	nerdFont: boolean,
): FormattedExtensionStatus[] {
	return Array.from(statuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => formatExtensionStatus(sanitizeStatusText(text), theme, nerdFont));
}

function formatExtensionStatuses(
	statuses: FormattedExtensionStatus[],
	mode: "full" | "active" = "full",
): string | undefined {
	const statusText = statuses
		.filter((status) => mode === "full" || status.keepInCompact)
		.map((status) => status.text)
		.filter(Boolean)
		.join(" ");

	return statusText || undefined;
}

function formatExtensionStatus(text: string, theme: Theme, nerdFont: boolean): FormattedExtensionStatus {
	const plainText = stripAnsi(text);
	const agentMemoryMatch = plainText.match(/^🧠\s*agentmemory(?:\s+(off))?$/i);
	if (agentMemoryMatch) {
		const active = agentMemoryMatch[1] === undefined;
		const compactText = nerdFont ? AGENTMEMORY_GLYPH : AGENTMEMORY_FALLBACK;
		return {
			keepInCompact: true,
			text: theme.fg(active ? "accent" : "muted", compactText),
		};
	}

	const mcpMatch = plainText.match(/^MCP:\s*(\d+)\s*\/\s*(\d+)\s+servers?$/i);
	if (mcpMatch) {
		const [visibleText, connected, total] = mcpMatch;
		const active = Number(connected) > 0;
		const compactText = `${nerdFont ? MCP_SERVER_GLYPH : "MCP"} ${connected}/${total}`;
		return {
			keepInCompact: active,
			text: active
				? preserveVisibleTextStyle(text, visibleText, compactText)
				: theme.fg("muted", compactText),
		};
	}

	return { text, keepInCompact: true };
}

function preserveVisibleTextStyle(text: string, visibleText: string, compactText: string): string {
	return text.includes(visibleText) ? text.replace(visibleText, compactText) : compactText;
}

function getSessionTokenTotals(ctx: ExtensionContext): SessionTokenTotals | undefined {
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

	return input || output || cacheRead || cacheWrite
		? { cacheRead, cacheWrite, input, output }
		: undefined;
}

function formatSessionTokenTotals(
	totals: SessionTokenTotals | undefined,
	theme: Theme,
	profile: "full" | "compact" = "full",
): string | undefined {
	if (!totals) return undefined;

	const inputPart = `↑${formatTokens(totals.input)}${profile === "full" && totals.cacheRead ? `/R${formatTokens(totals.cacheRead)}` : ""}`;
	const outputPart = `↓${formatTokens(totals.output)}${profile === "full" && totals.cacheWrite ? `/W${formatTokens(totals.cacheWrite)}` : ""}`;
	return theme.fg("muted", `${inputPart} ${outputPart}`);
}

function formatContextUsage(
	usage: ContextUsageSnapshot,
	modelContextWindow: number | undefined,
	theme: Theme,
	profile: "full" | "compact" = "full",
): string | undefined {
	if (!usage || usage.tokens === null) return undefined;

	const contextWindow = usage.contextWindow || modelContextWindow;
	if (!contextWindow) return undefined;

	const percent = getTokenPercent(usage.tokens, contextWindow, usage.percent);
	const displayedPercent = getDisplayedTokenPercent(percent);
	const percentText = theme.fg(contextUsageColor(displayedPercent.value), `(${displayedPercent.text})`);
	return profile === "compact"
		? percentText
		: [percentText, theme.fg("muted", `(${formatTokens(usage.tokens)}/${formatTokens(contextWindow)})`)].join(" ");
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

function formatModelName(
	provider: string | undefined,
	id: string | undefined,
	profile: "full" | "compact" | "minimal" = "full",
): string {
	if (!id) return "no-model";
	const base = id.includes("/") ? (id.split("/").pop() ?? id) : id;
	const model = base.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
	if (profile === "full") return provider ? `${provider}/${model}` : model;
	return formatCompactModelName(provider, model, profile);
}

function formatCompactModelName(
	provider: string | undefined,
	model: string,
	profile: "compact" | "minimal",
): string {
	if (provider === "openai-codex" && model.startsWith("gpt-")) {
		return profile === "minimal" ? model : `codex/${model}`;
	}

	if (provider === "anthropic") {
		if (model.startsWith("claude-sonnet-")) return model.replace(/^claude-/, "");
		if (model.startsWith("claude-opus-")) return model.replace(/^claude-/, "");
	}

	if ((provider === "google" || provider === "google-gemini") && model.startsWith("gemini-") && model.includes("flash")) {
		return model.replace(/^gemini-/, "").replace(/^(\d+(?:\.\d+)?(?:-[a-z]+)?)-flash/, "flash-$1");
	}

	if (profile === "minimal") return model;
	return provider ? `${provider}/${model}` : model;
}

function footerSectionsFit(parts: FooterParts, width: number): boolean {
	if (width <= 0) return false;
	const leftWidth = visibleWidth(parts.left);
	const middleWidth = visibleWidth(parts.middle ?? "");
	const rightWidth = visibleWidth(parts.right);
	const gapWidth = (parts.left && parts.middle ? 1 : 0) + (parts.middle && parts.right ? 1 : 0) + (!parts.middle && parts.left && parts.right ? 1 : 0);
	return leftWidth + middleWidth + rightWidth + gapWidth <= width;
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
