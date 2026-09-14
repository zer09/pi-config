import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CodexAlias } from "./config";
import { CANONICAL_OPENAI_CODEX_PROVIDER_ID, getOpenAICodexAliasSlug } from "./provider-id";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const COMMAND_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MANILA_TIME_ZONE = "Asia/Manila";

type CommandRegistrar = Pick<ExtensionAPI, "registerCommand">;
type RequestAuth = { readonly auth: { readonly apiKey?: string } } | undefined;

interface ProviderDescriptor {
	readonly id: string;
	readonly name: string;
}

interface UsageWindow {
	readonly remainingPercent: number;
	readonly resetAt?: number;
}

interface UsageDetails {
	readonly plan: string;
	readonly allowed: boolean;
	readonly primary?: UsageWindow;
	readonly secondary?: UsageWindow;
	readonly credits?: number;
}

type ProviderResult =
	| { readonly kind: "missing-auth"; readonly provider: ProviderDescriptor }
	| { readonly kind: "unavailable"; readonly provider: ProviderDescriptor }
	| { readonly kind: "usage"; readonly provider: ProviderDescriptor; readonly usage: UsageDetails };

interface UsageCommandOptions {
	readonly fetch?: typeof fetch;
	readonly now?: () => number;
	readonly timeoutMs?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function accountIdFromToken(token: string): string | undefined {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return;
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		if (!isObject(payload)) return;
		const auth = payload["https://api.openai.com/auth"];
		if (!isObject(auth)) return;
		const accountId = auth.chatgpt_account_id;
		return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
	} catch {
		return;
	}
}

async function readBoundedBody(
	response: Response,
	signal: AbortSignal,
	deadline: Promise<never>,
): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const result = await Promise.race([reader.read(), deadline]);
			signal.throwIfAborted();
			if (result.done) break;
			size += result.value.byteLength;
			if (size > MAX_RESPONSE_BYTES) throw new Error("Codex usage response is too large");
			chunks.push(result.value);
		}
	} catch (error) {
		// Cleanup must not extend the shared command deadline.
		void reader.cancel().catch(() => undefined);
		throw error;
	}

	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

function parseWindow(value: unknown): UsageWindow | undefined {
	if (value === undefined || value === null) return;
	if (!isObject(value)) throw new Error("Invalid Codex usage window");
	const usedPercent = value.used_percent;
	if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
		throw new Error("Invalid Codex usage percentage");
	}
	const resetAt = value.reset_at;
	if (resetAt !== undefined) {
		if (typeof resetAt !== "number" || !Number.isFinite(resetAt) || resetAt < 0) {
			throw new Error("Invalid Codex usage reset time");
		}
		const resetDate = new Date(resetAt * 1000);
		if (!Number.isFinite(resetDate.getTime())) throw new Error("Invalid Codex usage reset time");
	}
	return {
		remainingPercent: 100 - usedPercent,
		...(typeof resetAt === "number" ? { resetAt } : {}),
	};
}

function parseUsage(value: unknown): UsageDetails {
	if (!isObject(value) || !isObject(value.rate_limit)) throw new Error("Invalid Codex usage response");
	const allowed = value.rate_limit.allowed;
	if (typeof allowed !== "boolean") throw new Error("Invalid Codex usage status");
	const primary = parseWindow(value.rate_limit.primary_window);
	const secondary = parseWindow(value.rate_limit.secondary_window);
	if (!primary && !secondary) throw new Error("Codex usage response has no windows");

	const availableCredits = isObject(value.rate_limit_reset_credits)
		? value.rate_limit_reset_credits.available_count
		: undefined;
	const credits = typeof availableCredits === "number" && Number.isInteger(availableCredits) && availableCredits >= 0
		? availableCredits
		: undefined;
	return {
		plan: typeof value.plan_type === "string" && value.plan_type.length > 0 ? value.plan_type : "unknown",
		allowed,
		...(primary ? { primary } : {}),
		...(secondary ? { secondary } : {}),
		...(credits !== undefined ? { credits } : {}),
	};
}

async function inspectProvider(
	provider: ProviderDescriptor,
	resolveAuth: (providerId: string) => Promise<RequestAuth>,
	fetchUsage: typeof fetch,
	signal: AbortSignal,
	deadline: Promise<never>,
): Promise<ProviderResult> {
	let resolved: RequestAuth;
	try {
		resolved = await Promise.race([resolveAuth(provider.id), deadline]);
		signal.throwIfAborted();
	} catch {
		return { kind: "missing-auth", provider };
	}
	const token = resolved?.auth.apiKey;
	if (!token) return { kind: "missing-auth", provider };
	const accountId = accountIdFromToken(token);
	if (!accountId) return { kind: "unavailable", provider };

	try {
		const response = await Promise.race([
			fetchUsage(USAGE_URL, {
				headers: {
					Authorization: `Bearer ${token}`,
					"ChatGPT-Account-Id": accountId,
					"User-Agent": "codex-cli",
				},
				redirect: "manual",
				signal,
			}),
			deadline,
		]);
		if (!response.ok) {
			void response.body?.cancel().catch(() => undefined);
			throw new Error("Codex usage request failed");
		}
		const body = await readBoundedBody(response, signal, deadline);
		signal.throwIfAborted();
		return { kind: "usage", provider, usage: parseUsage(JSON.parse(body)) };
	} catch {
		return { kind: "unavailable", provider };
	}
}

function cleanText(value: string): string {
	const normalized = value.replace(/[\u0000-\u001f\u007f|]+/g, " ").replace(/\s+/g, " ").trim();
	const bounded = truncateToWidth(normalized, 80, "").replaceAll("\x1b[0m", "");
	return bounded || "Unknown";
}

function planLabel(plan: string): string {
	const normalized = cleanText(plan).toLowerCase();
	if (normalized === "prolite") return "Pro Lite";
	if (normalized === "k12") return "K-12";
	return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function percent(value: number): string {
	return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function manilaDate(timestampMs: number, includeYear = true): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: MANILA_TIME_ZONE,
		...(includeYear ? { year: "numeric" as const } : {}),
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(new Date(timestampMs));
}

const PROVIDER_COLUMN_WIDTH = 38;

function providerLabel(provider: ProviderDescriptor): string {
	if (provider.id === CANONICAL_OPENAI_CODEX_PROVIDER_ID) return "codex";
	const slug = getOpenAICodexAliasSlug(provider.id);
	if (!slug) return cleanText(provider.id);

	const identity = `codex-${slug}`;
	const friendlyName = cleanText(provider.name).replace(/^OpenAI Codex\s+/i, "");
	const withoutRepeatedSlug = friendlyName.replace(new RegExp(`^${slug}(?:\\s+|$)`, "i"), "").trim();
	if (!withoutRepeatedSlug || visibleWidth(identity) >= PROVIDER_COLUMN_WIDTH) return identity;

	const detailWidth = PROVIDER_COLUMN_WIDTH - visibleWidth(identity) - 1;
	if (detailWidth <= 0) return identity;
	const detail = truncateToWidth(withoutRepeatedSlug, detailWidth, "…");
	return detail ? `${identity}/${detail}` : identity;
}

function remainingLabel(window: UsageWindow | undefined): string {
	return window ? percent(window.remainingPercent) : "—";
}

function resetLabel(window: UsageWindow | undefined): string {
	if (!window) return "—";
	return window.resetAt === undefined ? "Not returned" : manilaDate(window.resetAt * 1000, false);
}

const TABLE_COLUMNS = [
	{ heading: "Provider", width: PROVIDER_COLUMN_WIDTH, right: false },
	{ heading: "Plan", width: 8, right: false },
	{ heading: "Status", width: 11, right: false },
	{ heading: "5h", width: 6, right: true },
	{ heading: "5-hour reset", width: 18, right: false },
	{ heading: "Weekly", width: 6, right: true },
	{ heading: "Weekly reset", width: 18, right: false },
	{ heading: "Score", width: 6, right: true },
	{ heading: "Credits", width: 7, right: true },
] as const;

function tableCell(value: string, width: number, right: boolean): string {
	const clipped = truncateToWidth(value, width, "…");
	const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
	return right ? `${padding}${clipped}` : `${clipped}${padding}`;
}

function tableRow(values: readonly string[]): string {
	return TABLE_COLUMNS.map((column, index) => tableCell(values[index] ?? "", column.width, column.right)).join("  ");
}

function routingScore(usage: UsageDetails): number {
	if (!usage.allowed) return 0;
	const remaining = [usage.primary, usage.secondary]
		.filter((window): window is UsageWindow => window !== undefined)
		.map((window) => window.remainingPercent);
	return remaining.length > 0 ? Math.min(...remaining) : 0;
}

export function formatCodexUsageReport(results: readonly ProviderResult[], checkedAt: number): string {
	const visible = results.filter((result) => result.kind !== "missing-auth");
	const usageRows = visible.filter((result): result is Extract<ProviderResult, { kind: "usage" }> => result.kind === "usage");
	const available = usageRows.filter((result) => result.usage.allowed);
	const blocked = usageRows.length - available.length;
	const unavailable = visible.length - usageRows.length;
	const missingAuth = results.length - visible.length;
	const best = available.reduce<Extract<ProviderResult, { kind: "usage" }> | undefined>((current, result) => {
		return !current || routingScore(result.usage) > routingScore(current.usage) ? result : current;
	}, undefined);

	const lines = [
		`Codex usage at ${manilaDate(checkedAt)} PHT (${MANILA_TIME_ZONE})`,
		tableRow(TABLE_COLUMNS.map(({ heading }) => heading)),
		TABLE_COLUMNS.map(({ width }) => "-".repeat(width)).join("  "),
	];
	for (const result of visible) {
		if (result.kind === "unavailable") {
			lines.push(tableRow([providerLabel(result.provider), "—", "Unavailable", "—", "—", "—", "—", "0%", "—"]));
			continue;
		}
		const status = result.usage.allowed ? "Available" : "Blocked";
		lines.push(tableRow([
			providerLabel(result.provider),
			planLabel(result.usage.plan),
			status,
			remainingLabel(result.usage.primary),
			resetLabel(result.usage.primary),
			remainingLabel(result.usage.secondary),
			resetLabel(result.usage.secondary),
			percent(routingScore(result.usage)),
			result.usage.credits === undefined ? "—" : String(result.usage.credits),
		]));
	}
	lines.push(
		`Authenticated ${visible.length}  Available ${available.length}  Quota-blocked ${blocked}  Unavailable ${unavailable}  Missing auth ${missingAuth}`,
		best
			? `Best provider: ${providerLabel(best.provider)} at ${percent(routingScore(best.usage))}`
			: "Best provider: none available",
	);
	return lines.join("\n");
}

export function registerCodexUsageCommand(
	pi: CommandRegistrar,
	aliases: readonly CodexAlias[],
	options: UsageCommandOptions = {},
): void {
	const providers: readonly ProviderDescriptor[] = [
		{ id: CANONICAL_OPENAI_CODEX_PROVIDER_ID, name: "OpenAI Codex (main)" },
		...aliases.map(({ id, name }) => ({ id, name })),
	];
	pi.registerCommand("codex-usage", {
		description: "Show current Codex quota in Philippine time without using the model",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const controller = new AbortController();
			let timer: ReturnType<typeof setTimeout> | undefined;
			const deadline = new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new Error("Codex usage command timed out"));
				}, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
			});
			try {
				const results = await Promise.all(providers.map((provider) => inspectProvider(
					provider,
					(providerId) => ctx.modelRegistry.getProviderAuth(providerId),
					options.fetch ?? fetch,
					controller.signal,
					deadline,
				)));
				ctx.ui.notify(formatCodexUsageReport(results, (options.now ?? Date.now)()), "info");
			} finally {
				clearTimeout(timer);
			}
		},
	});
}
