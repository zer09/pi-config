const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

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
const { FASTLANE_RPC_STATUS_KEY } = createJiti(extensionPath, { interopDefault: false })(path.join(__dirname, "constants.ts"));
assert.equal(FASTLANE_RPC_STATUS_KEY, "delegate-fastlane", "RPC status key is a fixed public contract");

function loadExtension() {
	const jiti = createJiti(extensionPath, { interopDefault: false, moduleCache: false });
	const mod = jiti(extensionPath);
	return mod.default ?? mod;
}

async function createFastlane(options = {}) {
	const handlers = new Map();
	const commands = new Map();
	const flags = new Map();
	const statuses = [];
	const notifications = [];
	const emitted = [];
	const factory = loadExtension();
	let usingOAuth = options.usingOAuth ?? true;
	let model = Object.hasOwn(options, "model") ? options.model : {
		provider: "openai-codex",
		id: "gpt-5.5",
		api: "openai-codex-responses",
	};
	const ctx = {
		hasUI: true,
		mode: options.mode ?? "tui",
		cwd: options.cwd ?? path.join(process.env.HOME ?? "/home/test", "project"),
		get model() {
			return model;
		},
		modelRegistry: {
			isUsingOAuth() {
				return usingOAuth;
			},
		},
		sessionManager: {},
		ui: {
			setStatus(key, value) {
				statuses.push({ key, value });
			},
			notify(message, level = "info") {
				notifications.push({ message, level });
			},
		},
	};

	factory({
		events: {
			emit(name, data) {
				emitted.push({ name, data });
			},
			on() {},
		},
		on(event, handler) {
			handlers.set(event, handler);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerFlag(name, flag) {
			flags.set(name, flag);
		},
		getFlag(name) {
			assert.ok(flags.has(name), "flag should be registered before reading it");
			return options.fastlane ?? flags.get(name).default;
		},
	});
	await handlers.get("session_start")?.({}, ctx);

	return {
		handlers,
		commands,
		flags,
		statuses,
		notifications,
		emitted,
		lastEvent() {
			return emitted[emitted.length - 1];
		},
		setModel(nextModel) {
			model = nextModel;
		},
		setUsingOAuth(value) {
			usingOAuth = value;
		},
		async beforeProvider(payload) {
			return handlers.get("before_provider_request")?.({ payload }, ctx);
		},
		async modelSelect() {
			await handlers.get("model_select")?.({}, ctx);
		},
		async runCommand(args = "") {
			const command = commands.get("fastlane");
			assert.equal(typeof command?.handler, "function", "fastlane command should be registered");
			await command.handler(args, ctx);
			return notifications[notifications.length - 1];
		},
	};
}

async function run() {
	{
		const fastlane = await createFastlane();
		assert.ok(fastlane.commands.has("fastlane"), "fastlane command should be registered");
		assert.equal(fastlane.commands.has("fast"), false, "fast command should not be registered");
		assert.deepEqual(fastlane.lastEvent(), { name: "fastlane:state", data: { active: false } }, "session start should emit inactive state");
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "default-off Fastlane should not inject service tier");
	}

	for (const modelId of ["gpt-5.4", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"]) {
		const startup = await createFastlane({
			fastlane: true,
			model: { provider: "openai-codex", id: modelId, api: "openai-codex-responses" },
		});
		assert.deepEqual(startup.lastEvent().data, { active: true }, `${modelId} should enable at startup`);
		assert.deepEqual(await startup.beforeProvider({ model: modelId }), { model: modelId, service_tier: "priority" });

		const fastlane = await createFastlane({
			model: { provider: "openai-codex", id: modelId, api: "openai-codex-responses" },
		});
		const notification = await fastlane.runCommand();
		assert.deepEqual(notification, { message: "Fastlane enabled.", level: "info" }, `${modelId} should enable Fastlane`);
		assert.deepEqual(fastlane.lastEvent().data, { active: true }, `${modelId} should publish active state`);

		const payload = await fastlane.beforeProvider({ model: modelId, input: "hello" });
		assert.deepEqual(
			payload,
			{ model: modelId, input: "hello", service_tier: "priority" },
			`${modelId} should receive priority service tier`,
		);
		assert.deepEqual(fastlane.lastEvent().data, { active: true }, `${modelId} should keep Fastlane active`);
	}

	for (const provider of ["openai-codex-personal", "openai-codex-business"]) {
		const fastlane = await createFastlane({
			model: { provider, id: "gpt-5.6-sol", api: "openai-codex-responses" },
		});
		const notification = await fastlane.runCommand();
		assert.deepEqual(notification, { message: "Fastlane enabled.", level: "info" }, `${provider} should enable Fastlane`);
		assert.deepEqual(
			await fastlane.beforeProvider({ model: "gpt-5.6-sol", input: "hello" }),
			{ model: "gpt-5.6-sol", input: "hello", service_tier: "priority" },
			`${provider} should receive priority service tier`,
		);
	}

	{
		const fastlane = await createFastlane();
		await fastlane.runCommand();
		const notification = await fastlane.runCommand();
		assert.deepEqual(notification, { message: "Fastlane disabled.", level: "info" }, "second toggle should disable Fastlane");
		assert.deepEqual(fastlane.lastEvent().data, { active: false }, "disabled Fastlane should publish inactive state");
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "disabled Fastlane should not inject");
	}

	{
		const fastlane = await createFastlane();
		const notification = await fastlane.runCommand("status");
		assert.deepEqual(notification, { message: "Usage: /fastlane", level: "warning" }, "arguments should show usage");
		assert.deepEqual(fastlane.lastEvent().data, { active: false }, "invalid command should leave Fastlane inactive");
	}

	{
		const fastlane = await createFastlane({
			model: { provider: "anthropic", id: "claude-sonnet-4-5", api: "anthropic-messages" },
		});
		const notification = await fastlane.runCommand();
		assert.equal(notification.level, "warning", "ineligible model should warn");
		assert.ok(notification.message.includes("Fastlane cannot be enabled for anthropic/claude-sonnet-4-5"), "warning should name the ineligible model");
		assert.ok(notification.message.includes("current provider is anthropic"), "warning should explain why the model is ineligible");
		assert.deepEqual(fastlane.lastEvent().data, { active: false }, "ineligible model should not enable Fastlane");
		assert.equal(await fastlane.beforeProvider({ model: "claude-sonnet-4-5" }), undefined, "ineligible provider should not inject");
	}

	{
		const fastlane = await createFastlane({
			model: { provider: "openai-codex", id: "gpt-5.4-mini", api: "openai-codex-responses" },
		});
		const notification = await fastlane.runCommand();
		assert.equal(notification.level, "warning", "a model without a Fast service tier should warn");
		assert.ok(notification.message.includes("does not advertise the priority/Fast service tier"), "warning should explain the catalog requirement");
		assert.deepEqual(fastlane.lastEvent().data, { active: false }, "unsupported model should not enable Fastlane");
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.4-mini" }), undefined, "unsupported model should not inject");
	}

	{
		const fastlane = await createFastlane({ usingOAuth: false });
		const notification = await fastlane.runCommand();
		assert.equal(notification.level, "warning", "API-key auth should warn");
		assert.ok(notification.message.includes("ChatGPT OAuth auth is required"), "warning should explain OAuth requirement");
		assert.deepEqual(fastlane.lastEvent().data, { active: false }, "API-key auth should not enable Fastlane");
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "API-key auth should not inject");
	}

	{
		const fastlane = await createFastlane({
			usingOAuth: false,
			model: { provider: "openai-codex-personal", id: "gpt-5.6-sol", api: "openai-codex-responses" },
		});
		const notification = await fastlane.runCommand();
		assert.equal(notification.level, "warning", "alias API-key auth should warn");
		assert.ok(notification.message.includes("ChatGPT OAuth auth is required"), "alias warning should explain OAuth requirement");
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.6-sol" }), undefined, "alias API-key auth should not inject");
	}

	{
		const fastlane = await createFastlane({
			model: { provider: "openai-codex-", id: "gpt-5.6-sol", api: "openai-codex-responses" },
		});
		const notification = await fastlane.runCommand();
		assert.equal(notification.level, "warning", "a malformed Codex alias should warn");
		assert.ok(notification.message.includes("not a valid OpenAI Codex provider"));
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.6-sol" }), undefined, "a malformed alias should not inject");
	}

	{
		const fastlane = await createFastlane();
		await fastlane.runCommand();
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5", service_tier: "default" }), undefined, "existing service tier should not be overwritten");
	}

	{
		const fastlane = await createFastlane();
		await fastlane.runCommand();
		fastlane.setModel({ provider: "anthropic", id: "claude-sonnet-4-5", api: "anthropic-messages" });
		await fastlane.modelSelect();
		assert.deepEqual(fastlane.lastEvent().data, { active: false }, "model changes should publish inactive state when enabled Fastlane is no longer eligible");

		fastlane.setModel({ provider: "openai-codex", id: "gpt-5.5", api: "openai-codex-responses" });
		await fastlane.modelSelect();
		assert.deepEqual(fastlane.lastEvent().data, { active: false }, "Fastlane should stay disabled after switching back to an eligible model");

		await fastlane.runCommand();
		assert.deepEqual(fastlane.lastEvent().data, { active: true }, "Fastlane can be enabled again after returning to an eligible model");
	}

	for (const fastlaneFlag of [undefined, false, true]) {
		const fastlane = await createFastlane({ fastlane: fastlaneFlag });
		assert.equal(fastlane.flags.size, 1, "only the Fastlane flag should be registered");
		assert.equal(fastlane.flags.get("fastlane").type, "boolean");
		assert.equal(fastlane.flags.get("fastlane").default, false);
		assert.deepEqual(fastlane.lastEvent().data, { active: fastlaneFlag === true });
		assert.deepEqual(fastlane.notifications, [], "startup should not send interactive notifications");
		assert.deepEqual(fastlane.statuses, [], "TUI startup should not publish RPC status");
	}

	for (const provider of ["openai-codex", "openai-codex-personal", "openai-codex-business", "openai-codex-future-1"]) {
		for (const usingOAuth of [true, false]) {
			const fastlane = await createFastlane({
				fastlane: true,
				usingOAuth,
				mode: "rpc",
				model: { provider, id: "gpt-5.5", api: "openai-codex-responses" },
			});
			assert.deepEqual(fastlane.lastEvent().data, { active: usingOAuth }, `${provider} startup requires OAuth`);
			assert.deepEqual(fastlane.statuses, [{ key: FASTLANE_RPC_STATUS_KEY, value: usingOAuth ? "enabled" : "inactive" }]);
			assert.deepEqual(await fastlane.beforeProvider({ model: "gpt-5.5" }), usingOAuth ? { model: "gpt-5.5", service_tier: "priority" } : undefined);
		}
	}

	for (const model of [
		undefined,
		{ provider: "anthropic", id: "claude-sonnet-4-5", api: "anthropic-messages" },
		{ provider: "openai-codex", id: "gpt-5.5", api: "openai-responses" },
		{ provider: "openai-codex", id: "gpt-5.4-mini", api: "openai-codex-responses" },
		{ provider: "openai-codex-", id: "gpt-5.5", api: "openai-codex-responses" },
	]) {
		const fastlane = await createFastlane({ fastlane: true, mode: "rpc", model });
		assert.deepEqual(fastlane.lastEvent().data, { active: false }, "ineligible startup must stay inactive");
		assert.equal(await fastlane.beforeProvider({ model: model?.id }), undefined);
		assert.deepEqual(fastlane.statuses, [
			{ key: FASTLANE_RPC_STATUS_KEY, value: "inactive" },
			{ key: FASTLANE_RPC_STATUS_KEY, value: "inactive" },
		]);
		fastlane.setModel({ provider: "openai-codex", id: "gpt-5.5", api: "openai-codex-responses" });
		await fastlane.modelSelect();
		assert.deepEqual(fastlane.lastEvent().data, { active: true }, "ineligible startup must retain CLI intent");
	}

	{
		const fastlane = await createFastlane({ fastlane: true, mode: "rpc" });
		await fastlane.modelSelect();
		await fastlane.beforeProvider({ model: "gpt-5.5" });
		await fastlane.beforeProvider({ model: "gpt-5.5" });
		assert.deepEqual(fastlane.statuses, Array.from({ length: 4 }, () => ({ key: FASTLANE_RPC_STATUS_KEY, value: "enabled" })), "same-model requests must publish fresh confirmation without deduplication");

		fastlane.setModel({ provider: "anthropic", id: "claude-sonnet-4-5", api: "anthropic-messages" });
		await fastlane.modelSelect();
		assert.deepEqual(fastlane.lastEvent().data, { active: false });
		assert.equal(await fastlane.beforeProvider({ model: "claude-sonnet-4-5" }), undefined);
		fastlane.setModel({ provider: "openai-codex-personal", id: "gpt-5.6-sol", api: "openai-codex-responses" });
		await fastlane.modelSelect();
		assert.deepEqual(fastlane.lastEvent().data, { active: true }, "CLI intent should re-enable an eligible route");
		assert.deepEqual(await fastlane.beforeProvider({ model: "gpt-5.6-sol" }), { model: "gpt-5.6-sol", service_tier: "priority" });
		assert.deepEqual(fastlane.statuses.slice(4), [
			{ key: FASTLANE_RPC_STATUS_KEY, value: "inactive" },
			{ key: FASTLANE_RPC_STATUS_KEY, value: "inactive" },
			{ key: FASTLANE_RPC_STATUS_KEY, value: "enabled" },
			{ key: FASTLANE_RPC_STATUS_KEY, value: "enabled" },
		]);
	}

	{
		const fastlane = await createFastlane({ fastlane: true, mode: "rpc" });
		fastlane.setUsingOAuth(false);
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "auth changes must be checked before requests");
		assert.deepEqual(fastlane.lastEvent().data, { active: false });
		fastlane.setUsingOAuth(true);
		assert.deepEqual(await fastlane.beforeProvider({ model: "gpt-5.5" }), { model: "gpt-5.5", service_tier: "priority" }, "restored OAuth should re-enable sticky intent without model_select");
		fastlane.setUsingOAuth(false);
		await fastlane.modelSelect();
		assert.deepEqual(fastlane.lastEvent().data, { active: false });
		fastlane.setUsingOAuth(true);
		await fastlane.modelSelect();
		assert.deepEqual(fastlane.lastEvent().data, { active: true });
		assert.deepEqual(fastlane.statuses.map((status) => status.value), ["enabled", "inactive", "enabled", "inactive", "enabled"]);

		fastlane.setModel(undefined);
		await fastlane.modelSelect();
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "no selected model must not inject");
		assert.deepEqual(fastlane.lastEvent().data, { active: false });
	}

	{
		const fastlane = await createFastlane({ fastlane: true, mode: "rpc" });
		assert.deepEqual(await fastlane.runCommand(), { message: "Fastlane disabled.", level: "info" });
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "manual disable must override CLI intent immediately");
		await fastlane.modelSelect();
		fastlane.setModel({ provider: "anthropic", id: "claude-sonnet-4-5", api: "anthropic-messages" });
		await fastlane.modelSelect();
		fastlane.setModel({ provider: "openai-codex", id: "gpt-5.5", api: "openai-codex-responses" });
		await fastlane.modelSelect();
		fastlane.setUsingOAuth(false);
		await fastlane.beforeProvider({ model: "gpt-5.5" });
		fastlane.setUsingOAuth(true);
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined);
		assert.deepEqual(fastlane.lastEvent().data, { active: false }, "route and auth changes must not undo manual disable");
		assert.ok(fastlane.statuses.slice(1).every((status) => status.key === FASTLANE_RPC_STATUS_KEY && status.value === "inactive"));
		assert.deepEqual(await fastlane.runCommand(), { message: "Fastlane enabled.", level: "info" });
		fastlane.setModel({ provider: "anthropic", id: "claude-sonnet-4-5", api: "anthropic-messages" });
		await fastlane.modelSelect();
		fastlane.setModel({ provider: "openai-codex", id: "gpt-5.5", api: "openai-codex-responses" });
		await fastlane.modelSelect();
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "manual enable must use ordinary disable-only route behavior");
	}

	{
		const fastlane = await createFastlane({ fastlane: true, usingOAuth: false });
		assert.equal((await fastlane.runCommand()).level, "warning");
		fastlane.setUsingOAuth(true);
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "a valid manual toggle on an ineligible route must cancel sticky intent");
		await fastlane.modelSelect();
		assert.deepEqual(fastlane.lastEvent().data, { active: false });
	}

	{
		const fastlane = await createFastlane({ fastlane: true });
		await fastlane.runCommand("status");
		fastlane.setUsingOAuth(false);
		await fastlane.beforeProvider({ model: "gpt-5.5" });
		fastlane.setUsingOAuth(true);
		assert.deepEqual(await fastlane.beforeProvider({ model: "gpt-5.5" }), { model: "gpt-5.5", service_tier: "priority" }, "invalid command arguments must not override CLI intent");
	}

	{
		const fastlane = await createFastlane();
		await fastlane.runCommand();
		fastlane.setModel({ provider: "openai-codex-business", id: "gpt-5.6-sol", api: "openai-codex-responses" });
		await fastlane.modelSelect();
		assert.deepEqual(fastlane.lastEvent().data, { active: true }, "ordinary eligible route changes should keep Fastlane enabled");
		fastlane.setUsingOAuth(false);
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.6-sol" }), undefined);
		fastlane.setUsingOAuth(true);
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.6-sol" }), undefined, "ordinary sessions must not re-enable after auth recovery");
	}

	{
		const fastlane = await createFastlane({ fastlane: true, mode: "rpc" });
		for (const service_tier of ["default", "auto", "flex", "priority", null, undefined]) {
			const payload = Object.freeze({ model: "gpt-5.5", service_tier });
			assert.equal(await fastlane.beforeProvider(payload), undefined, "every existing service_tier value must remain untouched");
			assert.deepEqual(payload, { model: "gpt-5.5", service_tier });
		}
		const inheritedTier = Object.create({ service_tier: "default" });
		inheritedTier.model = "gpt-5.5";
		assert.equal(await fastlane.beforeProvider(inheritedTier), undefined, "inherited service_tier must remain protected");
		for (const payload of [{ model: "gpt-5.4" }, {}, [], null, "payload"]) {
			assert.equal(await fastlane.beforeProvider(payload), undefined, "mismatched or invalid payloads must not inject");
		}
		const payload = Object.freeze({ model: "gpt-5.5", input: "hello" });
		assert.deepEqual(await fastlane.beforeProvider(payload), { model: "gpt-5.5", input: "hello", service_tier: "priority" });
		assert.deepEqual(payload, { model: "gpt-5.5", input: "hello" }, "injection must not mutate the caller's payload");
		assert.ok(fastlane.statuses.every((status) => status.key === FASTLANE_RPC_STATUS_KEY && status.value === "enabled"), "RPC status confirms configuration, not actual payload injection");
	}

	for (const mode of ["tui", "rpc", "json", "print"]) {
		for (const fastlaneFlag of [undefined, false, true]) {
			if (mode === "rpc" && fastlaneFlag === true) continue;
			const fastlane = await createFastlane({ mode, fastlane: fastlaneFlag });
			await fastlane.modelSelect();
			await fastlane.beforeProvider({ model: "gpt-5.5" });
			await fastlane.runCommand();
			await fastlane.runCommand();
			assert.deepEqual(fastlane.statuses, [], `${mode} with flag ${fastlaneFlag} must not publish RPC status`);
		}
	}

	{
		const requested = await createFastlane({ fastlane: true, mode: "rpc" });
		const ordinary = await createFastlane({ mode: "rpc" });
		await requested.beforeProvider({ model: "gpt-5.5" });
		assert.deepEqual(ordinary.lastEvent().data, { active: false }, "extension instances must not share enablement");
		assert.deepEqual(ordinary.statuses, [], "extension instances must not share status traffic");
	}

	console.log("fastlane tests passed");
}

run().catch((error) => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
