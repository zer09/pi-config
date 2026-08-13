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
const indexModule = jiti(extensionPath);

const { getOpenAICodexAliasSlug, isOpenAICodexProviderId } = providerIdModule;
const { loadOpenAICodexAliases, validateOpenAICodexAliasConfig } = configModule;
const { createOpenAICodexAliasProvider } = adapterModule;
const { registerOpenAICodexAliases } = indexModule;

const PERSONAL = Object.freeze({
	slug: "personal",
	id: "openai-codex-personal",
	name: "OpenAI Codex Personal",
});

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
		assert.deepEqual(aliases, [
			PERSONAL,
			{ slug: "business", id: "openai-codex-business", name: "OpenAI Codex Business" },
		]);
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
			["openai-codex-personal", "openai-codex-business"],
			"Pi's real extension loader should register both initial aliases",
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
		});
		const sourceDone = { ...sourcePartial, stopReason: "stop" };
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
		}

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
			[
				{ id: "openai-codex-personal", name: "OpenAI Codex Personal" },
				{ id: "openai-codex-business", name: "OpenAI Codex Business" },
			],
			"the initial aliases should register with exact provider IDs and names",
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

	console.log("openai-codex-aliases tests passed");
}

run().catch((error) => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
