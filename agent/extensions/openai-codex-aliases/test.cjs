const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function resolveGlobalNodeModules() {
	const candidates = [];
	try {
		candidates.push(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim());
	} catch {
		// npm may be unavailable in minimal validation environments.
	}
	if (process.env.HOME) candidates.push(path.join(process.env.HOME, ".bun", "install", "global", "node_modules"));
	candidates.push(path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules"));

	for (const candidate of candidates) {
		if (fs.existsSync(path.join(candidate, "@earendil-works", "pi-coding-agent"))) return candidate;
	}
	return candidates[0];
}

const globalNodeModules = resolveGlobalNodeModules();
const piPackageRoot = path.join(globalNodeModules, "@earendil-works", "pi-coding-agent");
process.env.NODE_PATH = [
	path.join(piPackageRoot, "node_modules"),
	globalNodeModules,
	process.env.NODE_PATH,
].filter(Boolean).join(path.delimiter);
Module._initPaths();

function requirePiDependency(name) {
	try {
		return require(path.join(piPackageRoot, "node_modules", name));
	} catch (error) {
		if (error?.code !== "MODULE_NOT_FOUND") throw error;
		return require(name);
	}
}

const { createJiti } = requirePiDependency("jiti");
const { visibleWidth } = requirePiDependency("@earendil-works/pi-tui");
const extensionPath = path.join(__dirname, "index.ts");

function createTestAssistantMessageEventStream() {
	const queue = [];
	const waiting = [];
	let done = false;
	return {
		push(event) {
			if (done) return;
			if (event.type === "done" || event.type === "error") done = true;
			const waiter = waiting.shift();
			if (waiter) waiter({ value: event, done: false });
			else queue.push(event);
		},
		end() {
			done = true;
			while (waiting.length > 0) waiting.shift()({ value: undefined, done: true });
		},
		async *[Symbol.asyncIterator]() {
			while (true) {
				if (queue.length > 0) yield queue.shift();
				else if (done) return;
				else {
					const result = await new Promise((resolve) => waiting.push(resolve));
					if (result.done) return;
					yield result.value;
				}
			}
		},
	};
}

function rejectDefaultSourceProvider() {
	throw new Error("tests must inject a fake Codex provider");
}

module.exports = {
	builtinProviders: rejectDefaultSourceProvider,
	createAssistantMessageEventStream: createTestAssistantMessageEventStream,
};

const jiti = createJiti(extensionPath, {
	alias: {
		"@earendil-works/pi-ai": __filename,
		"@earendil-works/pi-ai/providers/all": __filename,
	},
	interopDefault: false,
	moduleCache: false,
});
const providerIdModule = jiti(path.join(__dirname, "provider-id.ts"));
const configModule = jiti(path.join(__dirname, "config.ts"));
const adapterModule = jiti(path.join(__dirname, "provider-adapter.ts"));
const usageCommandModule = jiti(path.join(__dirname, "usage-command.ts"));
const indexModule = jiti(extensionPath);

const { getOpenAICodexAliasSlug, isOpenAICodexProviderId } = providerIdModule;
const { loadOpenAICodexAliases, validateOpenAICodexAliasConfig } = configModule;
const { createOpenAICodexAliasProvider } = adapterModule;
const { formatCodexUsageReport, registerCodexUsageCommand } = usageCommandModule;
const { registerOpenAICodexAliases } = indexModule;

const PERSONAL = Object.freeze({
	slug: "personal",
	id: "openai-codex-personal",
	name: "OpenAI Codex Personal",
});

function accessToken(accountId, marker = "token") {
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none" })}.${encode({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })}.${marker}`;
}

function usageResponse({
	allowed = true,
	plan = "plus",
	primaryUsed = 25,
	primaryReset = 1_789_381_800,
	secondaryUsed = 50,
	secondaryReset = 1_789_468_800,
	credits = 0,
	applicableCredits = 0,
} = {}) {
	return Response.json({
		plan_type: plan,
		rate_limit: {
			allowed,
			primary_window: { used_percent: primaryUsed, reset_at: primaryReset },
			secondary_window: secondaryUsed === null
				? null
				: { used_percent: secondaryUsed, reset_at: secondaryReset },
		},
		rate_limit_reset_credits: {
			available_count: credits,
			applicable_available_count: applicableCredits,
		},
	});
}

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function makeAssistant(provider, overrides = {}) {
	return {
		role: "assistant",
		content: [{ type: "text", text: "hello", textSignature: "message-id" }],
		api: "openai-codex-responses",
		provider,
		model: "gpt-5.6-sol",
		usage: {
			input: 1,
			output: 2,
			cacheRead: 3,
			cacheWrite: 4,
			totalTokens: 10,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 123,
		...overrides,
	};
}

function makeEventStream(events, iteratorError) {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
			if (iteratorError) throw iteratorError;
		},
	};
}

function createFakeSource() {
	const sourceModels = [
		{
			id: "gpt-5.6-sol",
			name: "GPT-5.6 Sol",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://example.invalid/backend-api",
			reasoning: true,
			thinkingLevelMap: { high: "high", max: "max" },
			input: ["text", "image"],
			cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
			contextWindow: 272000,
			maxTokens: 128000,
			headers: { "x-test": "catalog" },
			compat: { supportsStrictMode: true, supportsToolSearch: true },
		},
	];
	const oauth = {
		name: "OpenAI (ChatGPT Plus/Pro)",
		isSubscription: true,
		loginLabel: "Sign in",
		async login() {
			throw new Error("test login must not run");
		},
		async refresh() {
			throw new Error("test refresh must not run");
		},
		async toAuth() {
			throw new Error("test auth conversion must not run");
		},
	};
	const calls = { stream: [], streamSimple: [] };
	const source = {
		id: "openai-codex",
		name: "OpenAI Codex",
		baseUrl: "https://example.invalid/backend-api",
		headers: { "x-provider": "source" },
		auth: { oauth },
		getModels: () => sourceModels,
		stream(model, context, options) {
			calls.stream.push({ model, context, options });
			return source.streamResult(model, context, options);
		},
		streamSimple(model, context, options) {
			calls.streamSimple.push({ model, context, options });
			return source.streamSimpleResult(model, context, options);
		},
		streamResult: () => makeEventStream([]),
		streamSimpleResult: () => makeEventStream([]),
	};
	return { source, sourceModels, oauth, calls };
}

async function collect(stream) {
	const events = [];
	for await (const event of stream) events.push(event);
	return events;
}

async function run() {
	{
		const aliases = loadOpenAICodexAliases();
		assert.ok(aliases.length > 0, "the deployed alias configuration should not be empty");
		assert.equal(new Set(aliases.map((alias) => alias.id)).size, aliases.length, "provider IDs should stay unique");
		assert.ok(aliases.every((alias) => alias.id === `openai-codex-${alias.slug}`));
		assert.ok(Object.isFrozen(aliases), "the normalized alias list should be immutable");
		assert.ok(aliases.every(Object.isFrozen), "normalized alias records should be immutable");
	}

	{
		const loaderUrl = pathToFileURL(path.join(piPackageRoot, "dist", "core", "extensions", "loader.js")).href;
		const projectRoot = path.resolve(__dirname, "../../..");
		const script = `
			import { loadExtensions } from ${JSON.stringify(loaderUrl)};
			const result = await loadExtensions([${JSON.stringify(extensionPath)}], ${JSON.stringify(projectRoot)});
			console.log(JSON.stringify({
				errors: result.errors,
				providers: result.runtime.pendingNativeProviderRegistrations.map((entry) => entry.provider.id),
			}));
		`;
		const loaded = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
		assert.deepEqual(loaded.errors, [], "Pi's real extension loader should load the alias extension");
		assert.deepEqual(
			loaded.providers,
			loadOpenAICodexAliases().map((alias) => alias.id),
			"Pi's real extension loader should register every configured alias",
		);
	}

	for (const providerId of ["openai-codex", "openai-codex-personal", "openai-codex-business", "openai-codex-a1-b2"]) {
		assert.equal(isOpenAICodexProviderId(providerId), true, `${providerId} should be a valid Codex provider ID`);
	}
	assert.equal(getOpenAICodexAliasSlug("openai-codex"), undefined, "the canonical provider should not have an alias slug");
	assert.equal(getOpenAICodexAliasSlug("openai-codex-personal"), "personal");
	for (const providerId of [
		"openai-codex-",
		"openai-codex-Personal",
		"openai-codex--personal",
		"openai-codex-personal-",
		"openai-codex_personal",
		`openai-codex-${"a".repeat(33)}`,
		"anthropic",
	]) {
		assert.equal(isOpenAICodexProviderId(providerId), false, `${providerId} should not be a valid Codex provider ID`);
		assert.equal(getOpenAICodexAliasSlug(providerId), undefined);
	}

	{
		const aliases = validateOpenAICodexAliasConfig(
			{ aliases: [{ slug: "team-3", name: " Team Three " }] },
			"fixture.json",
		);
		assert.deepEqual(aliases, [{ slug: "team-3", id: "openai-codex-team-3", name: "Team Three" }]);
	}

	for (const [document, description] of [
		[null, "non-object document"],
		[{}, "missing aliases"],
		[{ aliases: {} }, "non-array aliases"],
		[{ aliases: [null] }, "non-object entry"],
		[{ aliases: [{ slug: "personal", name: "Personal", credential: "forbidden" }] }, "extra fields"],
		[{ aliases: [{ slug: "", name: "Personal" }] }, "empty slug"],
		[{ aliases: [{ slug: "Personal", name: "Personal" }] }, "malformed slug"],
		[{ aliases: [{ slug: "a".repeat(33), name: "Long" }] }, "long slug"],
		[{ aliases: [{ slug: "personal", name: " " }] }, "empty name"],
		[
			{ aliases: [{ slug: "personal", name: "One" }, { slug: "personal", name: "Two" }] },
			"duplicate slug",
		],
	]) {
		assert.throws(
			() => validateOpenAICodexAliasConfig(document, "fixture.json"),
			(error) => error.message.includes("fixture.json"),
			`${description} should fail with the config path`,
		);
	}

	{
		const builtProviderModuleUrl = pathToFileURL(
			path.join(globalNodeModules, "@earendil-works", "pi-ai", "dist", "providers", "openai-codex.js"),
		).href;
		const { openaiCodexProvider } = await import(builtProviderModuleUrl);
		const source = openaiCodexProvider();
		const provider = createOpenAICodexAliasProvider(PERSONAL, source);
		assert.ok(source.getModels().length > 0, "the built-in Codex catalog should not be empty");
		assert.equal(provider.getModels().length, source.getModels().length, "aliases should expose the complete built-in catalog");
		assert.equal(provider.auth.oauth.login, source.auth.oauth.login);
		assert.equal(provider.auth.oauth.refresh, source.auth.oauth.refresh);
		assert.equal(provider.auth.oauth.toAuth, source.auth.oauth.toAuth);
	}

	{
		const { source, sourceModels, oauth } = createFakeSource();
		const provider = createOpenAICodexAliasProvider(PERSONAL, source);
		assert.equal(provider.id, PERSONAL.id);
		assert.equal(provider.name, PERSONAL.name);
		assert.equal(provider.baseUrl, source.baseUrl);
		assert.deepEqual(provider.headers, source.headers);
		assert.notEqual(provider.headers, source.headers, "provider headers should be cloned");
		assert.equal(provider.auth.oauth.name, "OpenAI Codex Personal (ChatGPT Plus/Pro)");
		assert.equal(provider.auth.oauth.isSubscription, true);
		assert.equal(provider.auth.oauth.loginLabel, oauth.loginLabel);
		assert.equal(provider.auth.oauth.login, oauth.login, "OAuth login should retain the source function");
		assert.equal(provider.auth.oauth.refresh, oauth.refresh, "OAuth refresh should retain the source function");
		assert.equal(provider.auth.oauth.toAuth, oauth.toAuth, "OAuth auth conversion should retain the source function");

		const models = provider.getModels();
		assert.equal(models.length, sourceModels.length);
		for (let index = 0; index < models.length; index += 1) {
			assert.notEqual(models[index], sourceModels[index], "alias models should be cloned");
			assert.equal(models[index].provider, PERSONAL.id);
			assert.deepEqual(
				{ ...models[index], provider: "openai-codex" },
				sourceModels[index],
				"model metadata should match the source catalog apart from provider",
			);
		}
	}

	{
		const { source, sourceModels, calls } = createFakeSource();
		const sourcePartial = makeAssistant("openai-codex", {
			content: [
				{ type: "thinking", thinking: "", thinkingSignature: '{"type":"reasoning","encrypted_content":"fixture"}' },
				{ type: "toolCall", id: "call|fc_item", name: "read", arguments: {} },
			],
			stopReason: "pending",
			providerThinkingLevel: "high",
			rawStopReason: "in_progress",
			responseId: "response-fixture",
			providerExtensionMetadata: { future: true },
		});
		const sourceDone = { ...sourcePartial, stopReason: "stop", rawStopReason: "end_turn", endTurn: true };
		const sourceEvents = [
			{ type: "start", partial: sourcePartial },
			{ type: "text_start", contentIndex: 0, partial: sourcePartial },
			{ type: "text_delta", contentIndex: 0, delta: "a", partial: sourcePartial },
			{ type: "text_end", contentIndex: 0, content: "a", partial: sourcePartial },
			{ type: "thinking_start", contentIndex: 0, partial: sourcePartial },
			{ type: "thinking_delta", contentIndex: 0, delta: "b", partial: sourcePartial },
			{ type: "thinking_end", contentIndex: 0, content: "b", partial: sourcePartial },
			{ type: "toolcall_start", contentIndex: 1, partial: sourcePartial },
			{ type: "toolcall_delta", contentIndex: 1, delta: "{}", partial: sourcePartial },
			{ type: "toolcall_end", contentIndex: 1, toolCall: sourcePartial.content[1], partial: sourcePartial },
			{ type: "done", reason: "stop", message: sourceDone },
		];
		source.streamSimpleResult = () => makeEventStream(sourceEvents);
		const provider = createOpenAICodexAliasProvider(PERSONAL, source);
		const aliasModel = provider.getModels()[0];
		const aliasHistory = makeAssistant(PERSONAL.id, {
			content: [{ type: "thinking", thinking: "", thinkingSignature: "alias-state" }],
		});
		const canonicalHistory = makeAssistant("openai-codex", {
			content: [{ type: "thinking", thinking: "", thinkingSignature: "canonical-state" }],
		});
		const otherAliasHistory = makeAssistant("openai-codex-business", {
			content: [{ type: "thinking", thinking: "", thinkingSignature: "business-state" }],
		});
		const unrelatedHistory = makeAssistant("anthropic", { api: "anthropic-messages", model: "claude-test" });
		const userMessage = { role: "user", content: "hello", timestamp: 1 };
		const toolResult = {
			role: "toolResult",
			toolCallId: "call",
			toolName: "read",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			timestamp: 2,
		};
		const context = {
			systemPrompt: "system",
			messages: [userMessage, aliasHistory, canonicalHistory, otherAliasHistory, unrelatedHistory, toolResult],
			tools: [{ name: "read", description: "read", parameters: { type: "object" } }],
		};
		const controller = new AbortController();
		const options = {
			signal: controller.signal,
			reasoning: "high",
			headers: { "x-request": "test" },
			metadata: { request: 1 },
		};
		const sourceModelBefore = cloneJson(sourceModels[0]);
		const contextBefore = cloneJson(context);
		const sourceEventsBefore = cloneJson(sourceEvents);

		const outwardEvents = await collect(provider.streamSimple(aliasModel, context, options));
		assert.deepEqual(
			outwardEvents.map((event) => event.type),
			sourceEvents.map((event) => event.type),
			"the adapter should forward every event type",
		);
		for (const event of outwardEvents) {
			const message = event.type === "done" ? event.message : event.type === "error" ? event.error : event.partial;
			assert.equal(message.provider, PERSONAL.id, `${event.type} should expose the alias provider`);
			assert.equal(message.providerThinkingLevel, "high", `${event.type} should preserve provider thinking metadata`);
			assert.deepEqual(message.providerExtensionMetadata, { future: true }, `${event.type} should preserve unknown fields`);
		}
		const outwardDone = outwardEvents.at(-1);
		assert.equal(outwardDone.message.endTurn, true, "the terminal Codex end_turn signal should survive alias mapping");
		assert.equal(outwardDone.message.rawStopReason, "end_turn", "the raw terminal reason should survive alias mapping");
		assert.equal(outwardDone.message.responseId, "response-fixture", "the response ID should survive alias mapping");

		assert.equal(calls.streamSimple.length, 1);
		const call = calls.streamSimple[0];
		assert.equal(call.model.provider, "openai-codex", "the source model should use the canonical provider");
		assert.equal(call.model.id, aliasModel.id, "the source model ID should remain canonical");
		assert.equal(call.options, options, "request options and abort signal should reach the source unchanged");
		assert.notEqual(call.context, context);
		assert.notEqual(call.context.messages, context.messages);
		assert.equal(call.context.messages[0], userMessage, "user messages should not be rewritten");
		assert.equal(call.context.messages[1].provider, "openai-codex", "current-alias history should become canonical");
		assert.equal(call.context.messages[2].provider, "openai-codex-foreign", "canonical history should remain foreign");
		assert.equal(call.context.messages[3], otherAliasHistory, "other-alias history should remain foreign");
		assert.equal(call.context.messages[4], unrelatedHistory, "unrelated assistant history should remain foreign");
		assert.equal(call.context.messages[5], toolResult, "tool results should not be rewritten");
		assert.deepEqual(sourceModels[0], sourceModelBefore, "the source model should remain unchanged");
		assert.deepEqual(context, contextBefore, "the source context and messages should remain unchanged");
		assert.deepEqual(sourceEvents, sourceEventsBefore, "source events and messages should remain unchanged");
	}

	{
		const { source, calls } = createFakeSource();
		const sourceError = makeAssistant("openai-codex", { stopReason: "error", errorMessage: "provider error" });
		source.streamResult = () => makeEventStream([{ type: "error", reason: "error", error: sourceError }]);
		const provider = createOpenAICodexAliasProvider(PERSONAL, source);
		const model = provider.getModels()[0];
		const options = { temperature: 0.2 };
		const events = await collect(provider.stream(model, { messages: [] }, options));
		assert.equal(calls.stream.length, 1, "the full stream adapter should delegate to source.stream");
		assert.equal(calls.stream[0].options, options);
		assert.equal(events.length, 1);
		assert.equal(events[0].type, "error");
		assert.equal(events[0].error.provider, PERSONAL.id);
		assert.equal(events[0].error.errorMessage, sourceError.errorMessage);
	}

	{
		const { source } = createFakeSource();
		source.streamSimpleResult = () => makeEventStream([], new Error("detail that must stay internal"));
		const provider = createOpenAICodexAliasProvider(PERSONAL, source);
		const events = await collect(provider.streamSimple(provider.getModels()[0], { messages: [] }));
		assert.equal(events.length, 1);
		assert.equal(events[0].type, "error");
		assert.equal(events[0].error.provider, PERSONAL.id);
		assert.equal(events[0].error.errorMessage, "OpenAI Codex alias stream failed unexpectedly");
		assert.ok(!events[0].error.errorMessage.includes("detail"), "unexpected iterator details should not leak");
	}

	{
		const { source } = createFakeSource();
		const registered = [];
		registerOpenAICodexAliases(
			{ registerProvider(provider) { registered.push(provider); } },
			loadOpenAICodexAliases(),
			source,
		);
		assert.deepEqual(
			registered.map(({ id, name }) => ({ id, name })),
			loadOpenAICodexAliases().map(({ id, name }) => ({ id, name })),
			"the deployed aliases should register with exact provider IDs and names",
		);
	}

	{
		const aliases = validateOpenAICodexAliasConfig(
			{
				aliases: [
					{ slug: "personal", name: "OpenAI Codex Personal" },
					{ slug: "business", name: "OpenAI Codex Business" },
					{ slug: "team", name: "OpenAI Codex Team" },
				],
			},
			"fixture.json",
		);
		const { source } = createFakeSource();
		const registered = [];
		const providers = registerOpenAICodexAliases(
			{ registerProvider(provider) { registered.push(provider); } },
			aliases,
			source,
		);
		assert.deepEqual(
			registered.map(({ id, name }) => ({ id, name })),
			[
				{ id: "openai-codex-personal", name: "OpenAI Codex Personal" },
				{ id: "openai-codex-business", name: "OpenAI Codex Business" },
				{ id: "openai-codex-team", name: "OpenAI Codex Team" },
			],
			"aliases.json entries should register distinct providers without code changes",
		);
		assert.equal(providers.length, 3);
		assert.ok(registered.every((provider) => provider.getModels().every((model) => model.provider === provider.id)));
	}

	{
		const aliases = [
			PERSONAL,
			{ slug: "business", id: "openai-codex-business", name: "OpenAI Codex Business" },
			{ slug: "missing", id: "openai-codex-missing", name: "OpenAI Codex Missing" },
		];
		const tokens = {
			"openai-codex": accessToken("account-main", "main-secret"),
			"openai-codex-personal": accessToken("account-personal", "personal-secret"),
			"openai-codex-business": accessToken("account-business", "business-secret"),
		};
		const calls = [];
		const commands = [];
		registerCodexUsageCommand(
			{ registerCommand(name, definition) { commands.push({ name, definition }); } },
			aliases,
			{
				now: () => Date.UTC(2026, 8, 14, 5, 23),
				fetch: async (url, init) => {
					const headers = new Headers(init.headers);
					calls.push({ url, init, headers });
					const accountId = headers.get("ChatGPT-Account-Id");
					if (accountId === "account-main") {
						return usageResponse({
							plan: "prolite",
							primaryUsed: 84,
							primaryReset: Date.UTC(2026, 8, 19, 8, 10) / 1000,
							secondaryUsed: null,
						});
					}
					if (accountId === "account-personal") {
						return usageResponse({
							allowed: false,
							plan: "k12",
							primaryUsed: 0,
							primaryReset: Date.UTC(2026, 8, 14, 10, 23) / 1000,
							secondaryUsed: 100,
							secondaryReset: Date.UTC(2026, 8, 14, 12, 42) / 1000,
							credits: 2,
						});
					}
					return new Response("server-secret-detail", { status: 503 });
				},
			},
		);
		assert.equal(commands.length, 1);
		assert.equal(commands[0].name, "codex-usage");
		assert.match(commands[0].definition.description, /without using the model/);
		const notices = [];
		await commands[0].definition.handler("", {
			hasUI: true,
			modelRegistry: {
				async getProviderAuth(providerId) {
					return tokens[providerId] ? { auth: { apiKey: tokens[providerId] } } : undefined;
				},
			},
			ui: { notify(text, level) { notices.push({ text, level }); } },
		});
		assert.equal(calls.length, 3, "providers without auth must not start a usage request");
		for (const call of calls) {
			assert.equal(call.url, "https://chatgpt.com/backend-api/wham/usage");
			assert.equal(call.init.redirect, "manual");
			assert.equal(call.headers.get("User-Agent"), "codex-cli");
			assert.match(call.headers.get("Authorization"), /^Bearer /);
			assert.ok(call.headers.get("ChatGPT-Account-Id"));
		}
		assert.deepEqual(notices.map(({ level }) => level), ["info"]);
		const output = notices[0].text;
		const lines = output.split("\n");
		assert.match(lines[0], /Codex usage at Sep 14, 2026, 1:23 PM PHT \(Asia\/Manila\)/);
		assert.match(lines[1], /^Provider\s+Plan\s+Status\s+5h\s+5-hour reset\s+Weekly\s+Weekly reset\s+Score\s+Credits$/);
		assert.ok(lines.slice(1).every((line) => !line.includes("|")), "plain-text output must not use Markdown table separators");
		assert.ok(lines.slice(1, 6).every((line) => visibleWidth(line) === visibleWidth(lines[1])), "headers, separator, and rows must align");
		assert.match(lines[3], /^codex\s+Pro Lite\s+Available\s+16%\s+Sep 19, 4:10 PM\s+—\s+—\s+16%\s+0\s*$/);
		assert.match(lines[4], /^codex-personal\s+K-12\s+Blocked\s+100%\s+Sep 14, 6:23 PM\s+0%\s+Sep 14, 8:42 PM\s+0%\s+2\s*$/);
		assert.match(lines[5], /^codex-business\s+—\s+Unavailable\s+—\s+—\s+—\s+—\s+0%\s+—\s*$/);
		assert.equal(lines[6], "Authenticated 3  Available 1  Quota-blocked 1  Unavailable 1  Missing auth 1");
		assert.equal(lines[7], "Best provider: codex at 16%");
		for (const secret of ["account-main", "account-personal", "account-business", "main-secret", "personal-secret", "business-secret", "server-secret-detail"]) {
			assert.ok(!output.includes(secret), `output must not expose ${secret}`);
		}
	}

	{
		const commands = [];
		let capturedSignal;
		registerCodexUsageCommand(
			{ registerCommand(name, definition) { commands.push({ name, definition }); } },
			[],
			{
				timeoutMs: 10,
				fetch: async (_url, init) => {
					capturedSignal = init.signal;
					return new Promise(() => {});
				},
			},
		);
		const notices = [];
		await commands[0].definition.handler("", {
			hasUI: true,
			modelRegistry: {
				async getProviderAuth() {
					return { auth: { apiKey: accessToken("timeout-account", "timeout-secret") } };
				},
			},
			ui: { notify(text, level) { notices.push({ text, level }); } },
		});
		assert.equal(notices.length, 1, "the shared deadline must complete the command");
		assert.match(notices[0].text, /^codex\s+—\s+Unavailable/m);
		assert.match(notices[0].text, /Authenticated 1 .* Unavailable 1/);
		assert.ok(!notices[0].text.includes("timeout-account"));
		assert.ok(!notices[0].text.includes("timeout-secret"));
		assert.equal(capturedSignal?.aborted, true, "the shared deadline must abort the usage request");
	}

	{
		const commands = [];
		let cancelCalled = false;
		registerCodexUsageCommand(
			{ registerCommand(name, definition) { commands.push({ name, definition }); } },
			[],
			{
				timeoutMs: 10,
				fetch: async () => new Response(new ReadableStream({
					pull() { return new Promise(() => {}); },
					cancel() {
						cancelCalled = true;
						return new Promise(() => {});
					},
				})),
			},
		);
		const notices = [];
		const handler = commands[0].definition.handler("", {
			hasUI: true,
			modelRegistry: {
				async getProviderAuth() {
					return { auth: { apiKey: accessToken("stream-account", "stream-secret") } };
				},
			},
			ui: { notify(text, level) { notices.push({ text, level }); } },
		});
		const outcome = await Promise.race([
			handler.then(() => "settled"),
			new Promise((resolve) => setTimeout(() => resolve("watchdog"), 250)),
		]);
		assert.equal(outcome, "settled", "non-settling stream cancellation must not extend the deadline");
		assert.equal(cancelCalled, true, "stream cleanup should still be attempted");
		assert.equal(notices.length, 1);
		assert.match(notices[0].text, /^codex\s+—\s+Unavailable/m);
		assert.ok(!notices[0].text.includes("stream-account"));
		assert.ok(!notices[0].text.includes("stream-secret"));
	}

	{
		const commands = [];
		let cancelCalls = 0;
		registerCodexUsageCommand(
			{ registerCommand(name, definition) { commands.push({ name, definition }); } },
			[],
			{
				timeoutMs: 20,
				fetch: async () => new Response(new ReadableStream({
					pull() { return new Promise(() => {}); },
					cancel() {
						cancelCalls += 1;
						return new Promise(() => {});
					},
				}), { status: 503 }),
			},
		);
		const notices = [];
		const handler = commands[0].definition.handler("", {
			hasUI: true,
			modelRegistry: {
				async getProviderAuth() {
					return { auth: { apiKey: accessToken("error-stream-account", "error-stream-secret") } };
				},
			},
			ui: { notify(text, level) { notices.push({ text, level }); } },
		});
		const outcome = await Promise.race([
			handler.then(() => "settled"),
			new Promise((resolve) => setTimeout(() => resolve("watchdog"), 250)),
		]);
		assert.equal(outcome, "settled", "non-OK stream cancellation must not delay the command");
		assert.equal(cancelCalls, 1, "a non-OK response body must receive one cancellation attempt");
		assert.equal(notices.length, 1);
		assert.match(notices[0].text, /^codex\s+—\s+Unavailable/m);
		assert.ok(!notices[0].text.includes("error-stream-account"));
		assert.ok(!notices[0].text.includes("error-stream-secret"));
	}

	{
		const aliases = [PERSONAL];
		const commands = [];
		registerCodexUsageCommand(
			{ registerCommand(name, definition) { commands.push({ name, definition }); } },
			aliases,
			{
				now: () => Date.UTC(2026, 8, 14, 5, 23),
				fetch: async (_url, init) => {
					const accountId = new Headers(init.headers).get("ChatGPT-Account-Id");
					if (accountId === "malformed-reset-account") {
						return usageResponse({ primaryReset: Number.MAX_VALUE, secondaryUsed: null });
					}
					return usageResponse({
						primaryReset: Date.UTC(2026, 8, 14, 7, 0) / 1000,
						secondaryReset: Date.UTC(2026, 8, 19, 8, 0) / 1000,
					});
				},
			},
		);
		const notices = [];
		await commands[0].definition.handler("", {
			hasUI: true,
			modelRegistry: {
				async getProviderAuth(providerId) {
					const accountId = providerId === "openai-codex" ? "malformed-reset-account" : "valid-reset-account";
					return { auth: { apiKey: accessToken(accountId) } };
				},
			},
			ui: { notify(text, level) { notices.push({ text, level }); } },
		});
		assert.equal(notices.length, 1, "one malformed reset must not suppress valid provider rows");
		assert.match(notices[0].text, /^codex\s+—\s+Unavailable/m);
		assert.match(notices[0].text, /^codex-personal\s+Plus\s+Available/m);
		assert.match(notices[0].text, /Authenticated 2  Available 1  Quota-blocked 0  Unavailable 1/);
	}

	{
		const commands = [];
		registerCodexUsageCommand(
			{ registerCommand(name, definition) { commands.push({ name, definition }); } },
			[],
			{ fetch: async () => new Response("x".repeat(64 * 1024 + 1)) },
		);
		const notices = [];
		await commands[0].definition.handler("", {
			hasUI: true,
			modelRegistry: {
				async getProviderAuth() {
					return { auth: { apiKey: accessToken("oversized-account", "oversized-secret") } };
				},
			},
			ui: { notify(text, level) { notices.push({ text, level }); } },
		});
		assert.match(notices[0].text, /^codex\s+—\s+Unavailable/m);
		assert.ok(!notices[0].text.includes("oversized-account"));
		assert.ok(!notices[0].text.includes("oversized-secret"));
	}

	{
		const commands = [];
		let authCalls = 0;
		registerCodexUsageCommand(
			{ registerCommand(name, definition) { commands.push({ name, definition }); } },
			[PERSONAL],
			{ fetch: async () => { throw new Error("fetch must not run without UI"); } },
		);
		await commands[0].definition.handler("", {
			hasUI: false,
			modelRegistry: { async getProviderAuth() { authCalls += 1; return undefined; } },
			ui: { notify() { throw new Error("notify must not run without UI"); } },
		});
		assert.equal(authCalls, 0, "non-UI mode must return before resolving credentials");
	}

	{
		const output = formatCodexUsageReport([
			{
				kind: "usage",
				provider: { id: "openai-codex-safe", name: "Safe|Name\nInjected" },
				usage: {
					plan: "plus|injected",
					allowed: true,
					primary: { remainingPercent: 75 },
					secondary: { remainingPercent: 50 },
					credits: 0,
				},
			},
		], Date.UTC(2026, 8, 14, 5, 23));
		const plainOutput = output.replace(/\x1b\[[0-9;]*m/g, "");
		assert.match(plainOutput, /^codex-safe\/Name Injected\s+Plus In…\s+Available/m);
		assert.ok(!plainOutput.includes("|"));
		assert.match(plainOutput, /Best provider: codex-safe\/Name Injected at 50%/);
	}

	{
		const [boundaryAlias] = validateOpenAICodexAliasConfig({
			aliases: [{ slug: "boundary", name: `${"\u0301".repeat(79)}😀` }],
		}, "unicode-fixture.json");
		const unicodeResults = [
			{ id: "openai-codex-emoji", name: `OpenAI Codex emoji ${"a".repeat(24)}😀b`, score: 50 },
			{ id: "openai-codex-cjk", name: `OpenAI Codex cjk ${"界".repeat(18)}`, score: 50 },
			{ id: "openai-codex-combining", name: `OpenAI Codex combining ${"e\u0301".repeat(24)}`, score: 50 },
			{ ...boundaryAlias, score: 90 },
		].map(({ score, ...provider }) => ({
			kind: "usage",
			provider,
			usage: {
				plan: "plus",
				allowed: true,
				primary: { remainingPercent: score },
				secondary: { remainingPercent: score },
				credits: 0,
			},
		}));
		const lines = formatCodexUsageReport(unicodeResults, Date.UTC(2026, 8, 14, 5, 23)).split("\n");
		const tableWidth = visibleWidth(lines[1]);
		assert.ok(lines.slice(1, 3 + unicodeResults.length).every((line) => visibleWidth(line) === tableWidth));
		const hasUnpairedSurrogate = lines.some((line) => Array.from(line).some((character) => {
			if (character.length !== 1) return false;
			const code = character.charCodeAt(0);
			return code >= 0xd800 && code <= 0xdfff;
		}));
		assert.equal(hasUnpairedSurrogate, false, "terminal-width truncation must preserve Unicode characters");
	}

	{
		const duplicateNameResults = [
			{ id: "openai-codex-alpha", remainingPercent: 20 },
			{ id: "openai-codex-beta", remainingPercent: 80 },
		].map(({ id, remainingPercent }) => ({
			kind: "usage",
			provider: { id, name: "OpenAI Codex Shared" },
			usage: {
				plan: "plus",
				allowed: true,
				primary: { remainingPercent },
				secondary: { remainingPercent },
				credits: 0,
			},
		}));
		const output = formatCodexUsageReport(duplicateNameResults, Date.UTC(2026, 8, 14, 5, 23));
		assert.match(output, /^codex-alpha\/Shared\s+Plus\s+Available/m);
		assert.match(output, /^codex-beta\/Shared\s+Plus\s+Available/m);
		assert.match(output, /Best provider: codex-beta\/Shared at 80%/);
	}

	console.log("openai-codex-aliases tests passed");
}

run().catch((error) => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
