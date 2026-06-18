const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
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
	const oldConfigPath = process.env.FASTLANE_CONFIG_PATH;
	const tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "fastlane-test-"));
	const configPath = path.join(tempConfigDir, "config.json");

	if (Object.hasOwn(options, "config")) {
		const configText = typeof options.config === "string"
			? options.config
			: JSON.stringify(options.config);
		fs.writeFileSync(configPath, configText, "utf8");
	}
	process.env.FASTLANE_CONFIG_PATH = configPath;

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

	try {
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
	} finally {
		if (oldConfigPath === undefined) {
			delete process.env.FASTLANE_CONFIG_PATH;
		} else {
			process.env.FASTLANE_CONFIG_PATH = oldConfigPath;
		}
		fs.rmSync(tempConfigDir, { recursive: true, force: true });
	}

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
		assert.equal(fastlane.lastEvent().name, "fastlane:state", "session start should emit Fastlane state");
		assert.equal(fastlane.lastEvent().data.active, false, "safe code default should keep Fastlane inactive");
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "default-off Fastlane should not inject service tier");
	}

	{
		const fastlane = await createFastlane({ config: { enabled: true } });
		const payload = await fastlane.beforeProvider({ model: "gpt-5.5", input: "hello" });
		assert.deepEqual(payload, { model: "gpt-5.5", input: "hello", service_tier: "priority" }, "eligible payload should receive priority service tier");
		assert.equal(fastlane.lastEvent().data.active, true, "eligible enabled Fastlane should be active");
		assert.equal(fastlane.lastEvent().data.thinkingGlyphCount, 3, "default glyph count should be emitted");
	}

	{
		const fastlane = await createFastlane({ config: { enabled: true, thinkingGlyphCount: 5 } });
		await fastlane.beforeProvider({ model: "gpt-5.5" });
		assert.equal(fastlane.lastEvent().data.thinkingGlyphCount, 5, "configured glyph count should be emitted");
	}

	{
		const fastlane = await createFastlane();
		const notification = await fastlane.runCommand();
		assert.equal(notification.level, "info", "toggle should notify");
		assert.equal(fastlane.lastEvent().data.active, true, "toggle should enable Fastlane for the session");
		const payload = await fastlane.beforeProvider({ model: "gpt-5.5" });
		assert.equal(payload.service_tier, "priority", "session override should enable injection");
	}

	{
		const fastlane = await createFastlane({ config: { enabled: true } });
		const notification = await fastlane.runCommand("status");
		assert.equal(notification.level, "info", "status should notify");
		assert.ok(notification.message.includes("Fastlane is on"), "status should include mode");
		assert.equal(fastlane.lastEvent().data.active, true, "status should publish current state");
	}

	{
		const fastlane = await createFastlane({
			config: { enabled: true },
			model: { provider: "anthropic", id: "claude-sonnet-4-5", api: "anthropic-messages" },
		});
		assert.equal(await fastlane.beforeProvider({ model: "claude-sonnet-4-5" }), undefined, "ineligible provider should not inject");
		assert.equal(fastlane.lastEvent().data.active, false, "ineligible provider should not be active");
	}

	{
		const fastlane = await createFastlane({ config: { enabled: true }, usingOAuth: false });
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5" }), undefined, "API-key auth should not inject");
		assert.equal(fastlane.lastEvent().data.active, false, "API-key auth should not be active");
	}

	{
		const fastlane = await createFastlane({ config: { enabled: true } });
		assert.equal(await fastlane.beforeProvider({ model: "gpt-5.5", service_tier: "default" }), undefined, "existing service tier should not be overwritten");
	}

	{
		const fastlane = await createFastlane({ config: "{" });
		assert.equal(fastlane.lastEvent().data.active, false, "invalid config should fall back to safe defaults");
	}

	console.log("fastlane tests passed");
}

run().catch((error) => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
