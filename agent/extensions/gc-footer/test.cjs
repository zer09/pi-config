const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");
const path = require("node:path");

function resolveGlobalNodeModules() {
	try {
		return execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
	} catch {
		return path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules");
	}
}

const globalNodeModules = resolveGlobalNodeModules();
const piPackageRoot = path.join(globalNodeModules, "@earendil-works", "pi-coding-agent");
process.env.NODE_PATH = [
	path.join(piPackageRoot, "node_modules"),
	globalNodeModules,
	process.env.NODE_PATH,
].filter(Boolean).join(path.delimiter);
Module._initPaths();

const { createJiti } = require(path.join(piPackageRoot, "node_modules", "jiti"));
const { visibleWidth } = require("@earendil-works/pi-tui");

const extensionPath = path.join(__dirname, "index.ts");
const ansiPattern = /\x1b\[[0-9;]*m/g;

function stripAnsi(value) {
	return value.replace(ansiPattern, "");
}

function loadExtension() {
	const jiti = createJiti(extensionPath, { interopDefault: false, moduleCache: false });
	const mod = jiti(extensionPath);
	return mod.default ?? mod;
}

async function createFooter(options = {}) {
	const handlers = new Map();
	const factory = loadExtension();
	let thinkingLevel = options.thinkingLevel ?? "medium";
	let branch = Object.hasOwn(options, "branch") ? options.branch : "main";
	let statuses = options.statuses ?? new Map();
	let renderRequests = 0;
	let footerFactory;

	factory({
		on(event, handler) {
			handlers.set(event, handler);
		},
		getThinkingLevel() {
			return thinkingLevel;
		},
	});

	const ctx = {
		hasUI: true,
		cwd: options.cwd ?? path.join(process.env.HOME ?? "/home/test", "project"),
		model: options.model ?? {
			provider: "openai-codex",
			id: "gpt-5.5",
			contextWindow: 272000,
		},
		sessionManager: {
			getEntries: () => options.entries ?? [],
		},
		getContextUsage: () => options.contextUsage,
		ui: {
			setFooter(fn) {
				footerFactory = fn;
			},
		},
	};

	await handlers.get("session_start")?.({}, ctx);
	assert.equal(typeof footerFactory, "function", "session_start should install footer");

	const component = footerFactory(
		{ requestRender: () => { renderRequests += 1; } },
		{ fg: (_color, text) => `\x1b[2m${text}\x1b[0m` },
		{
			getGitBranch: () => branch,
			getExtensionStatuses: () => statuses,
			onBranchChange: (callback) => {
				createFooter.lastBranchCallback = callback;
				return () => {};
			},
		},
	);

	return {
		component,
		handlers,
		render(width = 120) {
			return component.render(width)[0] ?? "";
		},
		renderPlain(width = 120) {
			return stripAnsi(this.render(width));
		},
		setThinkingLevel(level) {
			thinkingLevel = level;
		},
		setBranch(value) {
			branch = value;
		},
		setStatuses(value) {
			statuses = value;
		},
		getRenderRequests() {
			return renderRequests;
		},
	};
}

function assistantEntry(usage) {
	return { type: "message", message: { role: "assistant", usage } };
}

async function run() {
	{
		const footer = await createFooter({ thinkingLevel: "off" });
		assert.match(footer.renderPlain(), /\uf10c$/, "off thinking should use outline circle");
		footer.setThinkingLevel("medium");
		assert.match(footer.renderPlain(), /\uf111$/, "enabled thinking should use filled circle");
	}

	{
		const footer = await createFooter({
			cwd: path.join(process.env.HOME ?? "/home/test", "project"),
			model: { provider: "anthropic", id: "claude-sonnet-4-20250514", contextWindow: 200000 },
		});
		const line = footer.renderPlain();
		assert.match(line, /^~\/project \(main\)/, "cwd should abbreviate home and show branch");
		assert.ok(line.includes("anthropic/claude-sonnet-4"), "model date suffix should be removed");
	}

	{
		const footer = await createFooter({ branch: null });
		assert.ok(!footer.renderPlain().includes("(main)"), "branch should be hidden outside git repos");
	}

	{
		const footer = await createFooter({
			statuses: new Map([
				["z-status", "z:\ton\nready"],
				["a-status", "a:on"],
			]),
		});
		const line = footer.renderPlain();
		assert.ok(line.includes("a:on z: on ready"), "statuses should sort by key and sanitize whitespace");
		assert.ok(line.indexOf("a:on") < line.indexOf("openai-codex/gpt-5.5"), "statuses should render before model");
	}

	{
		const footer = await createFooter({
			entries: [assistantEntry({ input: 12000, output: 3000, cacheRead: 4000, cacheWrite: 4000 })],
			contextUsage: { tokens: 9400, contextWindow: 272000, percent: 3.45 },
		});
		assert.ok(
			footer.renderPlain().includes("↑12k/R4k ↓3k/W4k (9.4k/272k) openai-codex/gpt-5.5"),
			"right side should include token totals, context usage, model, and thinking",
		);
	}

	{
		const footer = await createFooter({
			entries: [assistantEntry({ input: 12000, output: 3000, cacheRead: 0, cacheWrite: 0 })],
			contextUsage: { tokens: null, contextWindow: 272000, percent: null },
		});
		const line = footer.renderPlain();
		assert.ok(line.includes("↑12k ↓3k openai-codex/gpt-5.5"), "cache segments should be omitted when zero");
		assert.ok(!line.includes("/272k"), "context usage should be hidden when tokens are unknown");
	}

	{
		const footer = await createFooter({
			cwd: path.join(process.env.HOME ?? "/home/test", "very", "long", "project", "path"),
			statuses: new Map([
				["a", "alpha-status-is-long"],
				["b", "beta-status-is-long"],
			]),
			entries: [assistantEntry({ input: 123456, output: 45678, cacheRead: 98765, cacheWrite: 8765 })],
			contextUsage: { tokens: 123456, contextWindow: 272000, percent: 45.4 },
		});
		for (let width = 0; width <= 140; width += 1) {
			assert.doesNotThrow(() => footer.render(width), `render should not throw at width ${width}`);
			assert.ok(visibleWidth(footer.render(width)) <= width, `render should fit width ${width}`);
		}
	}

	console.log("gc-footer tests passed");
}

run().catch((error) => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
