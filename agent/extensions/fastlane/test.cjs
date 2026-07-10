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

function loadExtension() {
	const jiti = createJiti(extensionPath, { interopDefault: false, moduleCache: false });
	const mod = jiti(extensionPath);
	return mod.default ?? mod;
}

async function createFastlane(options = {}) {
	const handlers = new Map();
	const commands = new Map();
	const notifications = [];
	const emitted = [];
	const factory = loadExtension();
	let usingOAuth = options.usingOAuth ?? true;
	let model = options.model ?? {
		provider: "openai-codex",
		id: "gpt-5.5",
		api: "openai-codex-responses",
	};
	const ctx = {
		hasUI: true,
		mode: "tui",
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
	});
	await handlers.get("session_start")?.({}, ctx);

	return {
		handlers,
		commands,
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

	for (const modelId of ["gpt-5.4", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]) {
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

	console.log("fastlane tests passed");
}

run().catch((error) => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
