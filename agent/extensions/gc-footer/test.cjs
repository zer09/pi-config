const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
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

async function waitFor(predicate, message) {
	for (let i = 0; i < 50; i += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.ok(predicate(), message);
}

async function withFakeGitStatus(output, fn) {
	const oldPath = process.env.PATH;
	const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-footer-git-"));
	const gitPath = path.join(binDir, "git");
	fs.writeFileSync(gitPath, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(output)});\n`, "utf8");
	fs.chmodSync(gitPath, 0o755);
	process.env.PATH = [binDir, oldPath].filter(Boolean).join(path.delimiter);
	try {
		return await fn();
	} finally {
		if (oldPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = oldPath;
		}
		fs.rmSync(binDir, { recursive: true, force: true });
	}
}

function loadExtension() {
	const jiti = createJiti(extensionPath, { interopDefault: false, moduleCache: false });
	const mod = jiti(extensionPath);
	return mod.default ?? mod;
}

async function createFooter(options = {}) {
	const oldConfigPath = process.env.GC_FOOTER_CONFIG_PATH;
	let tempConfigDir;

	if (Object.hasOwn(options, "config")) {
		tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-footer-test-"));
		const configPath = path.join(tempConfigDir, "config.json");
		const configText = typeof options.config === "string"
			? options.config
			: JSON.stringify(options.config);
		fs.writeFileSync(configPath, configText, "utf8");
		process.env.GC_FOOTER_CONFIG_PATH = configPath;
	}

	const handlers = new Map();
	const commands = new Map();
	const notifications = [];
	const factory = loadExtension();
	const themeName = options.themeName ?? "dark";
	const colorCalls = [];
	const theme = {
		fg(color, text) {
			colorCalls.push({ color, text });
			return `\x1b[2m${text}\x1b[0m`;
		},
	};
	let thinkingLevel = options.thinkingLevel ?? "medium";
	let branch = Object.hasOwn(options, "branch") ? options.branch : "main";
	let statuses = options.statuses ?? new Map();
	let renderRequests = 0;
	let footerFactory;

	try {
		factory({
			on(event, handler) {
				handlers.set(event, handler);
			},
			registerCommand(name, command) {
				commands.set(name, command);
			},
			getThinkingLevel() {
				return thinkingLevel;
			},
		});
	} finally {
		if (oldConfigPath === undefined) {
			delete process.env.GC_FOOTER_CONFIG_PATH;
		} else {
			process.env.GC_FOOTER_CONFIG_PATH = oldConfigPath;
		}
		if (tempConfigDir) fs.rmSync(tempConfigDir, { recursive: true, force: true });
	}

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
			theme,
			notify(message, level = "info") {
				notifications.push({ message, level });
			},
			getAllThemes() {
				return [{ name: themeName, path: undefined }];
			},
			getTheme(name) {
				return name === themeName ? theme : undefined;
			},
			setFooter(fn) {
				footerFactory = fn;
			},
		},
	};

	await handlers.get("session_start")?.({}, ctx);
	assert.equal(typeof footerFactory, "function", "session_start should install footer");

	const component = footerFactory(
		{ requestRender: () => { renderRequests += 1; } },
		theme,
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
		commands,
		notifications,
		colorCalls,
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
		async emit(event, payload = {}) {
			await handlers.get(event)?.(payload, ctx);
		},
		getColorCalls() {
			return colorCalls;
		},
		async runCommand(args = "") {
			const command = commands.get("gc-footer");
			assert.equal(typeof command?.handler, "function", "gc-footer command should be registered");
			await command.handler(args, ctx);
			return notifications[notifications.length - 1];
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
			thinkingLevel: "off",
			config: { nerdFont: false },
		});
		assert.match(footer.renderPlain(), /\u25cb$/, "fallback off thinking should use unicode outline circle");
		footer.setThinkingLevel("medium");
		const line = footer.renderPlain();
		assert.match(line, /\u25cf$/, "fallback enabled thinking should use unicode filled circle");
		assert.ok(!line.includes("\uf111"), "fallback thinking should not use Nerd Font glyphs");
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

	await withFakeGitStatus("# branch.head main\n# branch.ab +0 -0\n", async () => {
		const footer = await createFooter({ cwd: __dirname, branch: "main" });
		await waitFor(() => footer.getRenderRequests() > 0, "git status refresh should request a render");
		assert.ok(footer.renderPlain().includes("(main)"), "clean synced branch should match the existing branch format");
		assert.ok(!footer.renderPlain().includes("(main*"), "clean branch should not show dirty marker");
	});

	await withFakeGitStatus("# branch.head main\n# branch.ab +0 -0\n1 .M N... 100644 100644 100644 abc abc file.txt\n", async () => {
		const footer = await createFooter({ cwd: __dirname, branch: "main" });
		await waitFor(() => footer.renderPlain().includes("(main*)"), "dirty branch should show dirty marker");
		assert.ok(
			footer.getColorCalls().some((call) => call.color === "warning" && call.text === "(main*)"),
			"dirty branch should use warning color",
		);
	});

	await withFakeGitStatus("# branch.head main\n# branch.ab +2 -0\n", async () => {
		const footer = await createFooter({ cwd: __dirname, branch: "main" });
		await waitFor(() => footer.renderPlain().includes("(main +2)"), "ahead branch should show ahead count");
	});

	await withFakeGitStatus("# branch.head main\n# branch.ab +0 -1\n", async () => {
		const footer = await createFooter({ cwd: __dirname, branch: "main" });
		await waitFor(() => footer.renderPlain().includes("(main -1)"), "behind branch should show behind count");
	});

	await withFakeGitStatus("# branch.head main\n# branch.ab +2 -1\n? new-file.txt\n", async () => {
		const footer = await createFooter({ cwd: __dirname, branch: "main" });
		await waitFor(() => footer.renderPlain().includes("(main +2/-1*)"), "diverged dirty branch should show ahead, behind, and dirty marker");
	});

	{
		const footer = await createFooter();
		const notification = await footer.runCommand();
		assert.equal(notification.level, "info", "gc-footer command should report status");
		assert.ok(notification.message.includes("segments: cwd, branch, statuses, timer, queue, tokens, context, model, thinking"), "command should list enabled segments");
		assert.ok(notification.message.includes("theme: dark"), "command should report active theme name");
		assert.ok(notification.message.includes("model: openai-codex/gpt-5.5"), "command should report current model");
		assert.ok(notification.message.includes("thinking: medium"), "command should report current thinking level");
		assert.ok(notification.message.includes("branch: main"), "command should report current branch");
		assert.ok(notification.message.includes("nerdFont: on"), "command should report Nerd Font mode");
	}

	{
		const footer = await createFooter({
			config: {
				segments: {
					branch: false,
					statuses: false,
					tokens: false,
				},
				nerdFont: false,
			},
		});
		const notification = await footer.runCommand("status");
		assert.equal(notification.level, "info", "gc-footer status alias should report status");
		assert.ok(notification.message.includes("segments: cwd, timer, queue, context, model, thinking"), "command should show config-disabled segments as omitted");
		assert.ok(notification.message.includes("nerdFont: off"), "command should report disabled Nerd Font mode");

		const error = await footer.runCommand("toggle branch");
		assert.equal(error.level, "error", "gc-footer command should reject mutating subcommands");
		assert.equal(error.message, "Usage: /gc-footer", "gc-footer command should remain read-only");
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
			statuses: new Map([["mcp", "\x1b[32mMCP: 0/9 servers\x1b[0m"]]),
		});
		footer.renderPlain();
		assert.ok(footer.renderPlain().includes("\uf233 0/9"), "MCP status should use compact server glyph by default");
		assert.ok(
			footer.getColorCalls().some((call) => call.color === "muted" && call.text === "\uf233 0/9"),
			"inactive MCP status should use muted color instead of upstream active color",
		);
	}

	{
		const footer = await createFooter({
			statuses: new Map([["mcp", "\x1b[32mMCP: 2/9 servers\x1b[0m"]]),
		});
		assert.ok(footer.render().includes("\x1b[32m\uf233 2/9\x1b[0m"), "active MCP status should preserve changed upstream color");
	}

	{
		const footer = await createFooter({
			config: { nerdFont: false },
			statuses: new Map([["mcp", "MCP: 0/9 servers"]]),
		});
		const line = footer.renderPlain();
		assert.ok(line.includes("MCP 0/9"), "MCP status should use compact text fallback without Nerd Font");
		assert.ok(!line.includes("\uf233"), "fallback MCP status should not use Nerd Font glyph");
	}

	{
		const footer = await createFooter({
			entries: [assistantEntry({ input: 12000, output: 3000, cacheRead: 0, cacheWrite: 0 })],
		});
		const originalNow = Date.now;
		try {
			let now = 100000;
			Date.now = () => now;

			await footer.emit("input", { source: "interactive", text: "hello", images: [] });
			now += 1200;
			await footer.emit("before_agent_start");
			assert.ok(footer.renderPlain().includes("\uf017 1.2s"), "running timer should show clock glyph and elapsed duration");

			now += 3400;
			await footer.emit("agent_end");
			const completedLine = footer.renderPlain();
			assert.ok(completedLine.includes("\uf00c 4.6s"), "completed timer should show check glyph and total duration");
			assert.ok(completedLine.indexOf("\uf00c") < completedLine.indexOf("↑"), "timer should render before token totals");
		} finally {
			Date.now = originalNow;
		}
	}

	{
		const footer = await createFooter();
		const originalNow = Date.now;
		try {
			let now = 300000;
			Date.now = () => now;

			await footer.emit("input", { source: "interactive", text: "/skill:demo hello", images: [] });
			now += 900;
			await footer.emit("before_agent_start");
			assert.ok(footer.renderPlain().includes("\uf017 0.9s"), "slash prompt expansion time should be counted");
			await footer.emit("agent_end");
		} finally {
			Date.now = originalNow;
		}
	}

	{
		const footer = await createFooter();
		const originalNow = Date.now;
		try {
			let now = 600000;
			Date.now = () => now;

			await footer.emit("before_agent_start");
			now += 600000;
			assert.ok(footer.renderPlain().includes("\uf017 10:00"), "long running timer should use m:ss format");

			await footer.emit("agent_end");
			assert.ok(footer.renderPlain().includes("\uf00c 10:00"), "long completed timer should use m:ss format");
		} finally {
			Date.now = originalNow;
		}
	}

	{
		const footer = await createFooter();
		const originalNow = Date.now;
		try {
			let now = 400000;
			Date.now = () => now;

			await footer.emit("input", { source: "interactive", text: "first", images: [] });
			await footer.emit("before_agent_start");
			now += 1000;
			await footer.emit("input", { source: "interactive", text: "queued", images: [], streamingBehavior: "followUp" });
			assert.ok(footer.renderPlain().includes("\uf46c 1"), "queued follow-up count should be visible while waiting");
			now += 1000;
			await footer.emit("agent_end");
			now += 500;
			await footer.emit("before_agent_start");
			const queuedLine = footer.renderPlain();
			assert.ok(queuedLine.includes("\uf017 1.5s"), "queued follow-up timer should start when the follow-up was submitted");
			assert.ok(!queuedLine.includes("\uf46c"), "queued follow-up count should hide after the queued prompt starts");
			await footer.emit("agent_end");
		} finally {
			Date.now = originalNow;
		}
	}

	{
		const footer = await createFooter({ config: { nerdFont: false } });
		await footer.emit("input", { source: "interactive", text: "first", images: [] });
		await footer.emit("before_agent_start");
		await footer.emit("input", { source: "interactive", text: "queued one", images: [], streamingBehavior: "followUp" });
		await footer.emit("input", { source: "interactive", text: "queued two", images: [], streamingBehavior: "followUp" });
		assert.ok(footer.renderPlain().includes("q 2"), "fallback queue indicator should show multiple queued follow-ups");
		await footer.emit("agent_end");
		await footer.emit("before_agent_start");
		assert.ok(footer.renderPlain().includes("q 1"), "fallback queue indicator should decrement when a queued prompt starts");
		await footer.emit("agent_end");
	}

	{
		const footer = await createFooter();
		const originalNow = Date.now;
		try {
			let now = 500000;
			Date.now = () => now;

			await footer.emit("input", { source: "interactive", text: "handled by another extension", images: [] });
			await new Promise((resolve) => setImmediate(resolve));
			now += 5000;
			await footer.emit("before_agent_start");
			now += 200;
			assert.ok(footer.renderPlain().includes("\uf017 0.2s"), "handled inputs should not leave stale start times for later prompts");
			await footer.emit("agent_end");
		} finally {
			Date.now = originalNow;
		}
	}

	{
		const footer = await createFooter({ config: { nerdFont: false } });
		const originalNow = Date.now;
		try {
			let now = 200000;
			Date.now = () => now;

			await footer.emit("before_agent_start");
			now += 500;
			assert.ok(footer.renderPlain().includes("time 0.5s"), "fallback running timer should use text label");

			await footer.emit("agent_end");
			assert.ok(footer.renderPlain().includes("done 0.5s"), "fallback completed timer should use text label");
		} finally {
			Date.now = originalNow;
		}
	}

	{
		const footer = await createFooter({
			entries: [assistantEntry({ input: 12000, output: 3000, cacheRead: 4000, cacheWrite: 4000 })],
			contextUsage: { tokens: 9400, contextWindow: 272000, percent: 3.45 },
		});
		assert.ok(
			footer.renderPlain().includes("↑12k/R4k ↓3k/W4k (3.5%) (9.4k/272k) openai-codex/gpt-5.5"),
			"right side should include token totals, context percentage, context usage, model, and thinking",
		);
	}

	{
		const footer = await createFooter({
			entries: [assistantEntry({ input: 742000, output: 80000, cacheRead: 12000000, cacheWrite: 0 })],
			contextUsage: { tokens: 76000, contextWindow: 272000, percent: null },
		});
		assert.ok(
			footer.renderPlain().includes("↑742k/R12M ↓80k (28%) (76k/272k) openai-codex/gpt-5.5"),
			"context percentage should be computed when usage percent is absent",
		);
	}

	for (const { percent, text, color } of [
		{ percent: 69.4, text: "(69%)", color: "muted" },
		{ percent: 69.6, text: "(70%)", color: "warning" },
		{ percent: 70, text: "(70%)", color: "warning" },
		{ percent: 89.5, text: "(90%)", color: "error" },
		{ percent: 90, text: "(90%)", color: "error" },
	]) {
		const footer = await createFooter({
			contextUsage: { tokens: 1000, contextWindow: 10000, percent },
		});
		footer.renderPlain();
		assert.ok(
			footer.getColorCalls().some((call) => call.text === text && call.color === color),
			`context percentage ${text} should use ${color}`,
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
			statuses: new Map([["mcp", "MCP: 0/9 servers"]]),
			entries: [assistantEntry({ input: 123456, output: 45678, cacheRead: 98765, cacheWrite: 8765 })],
			contextUsage: { tokens: 123456, contextWindow: 272000, percent: 45.4 },
		});
		const compactLine = footer.renderPlain(90);
		assert.ok(compactLine.includes("path (main)"), "compact layout should use cwd basename");
		assert.ok(compactLine.includes("↑123k ↓46k"), "compact layout should omit cache token details");
		assert.ok(compactLine.includes("(45%)"), "compact layout should keep context percentage");
		assert.ok(!compactLine.includes("/272k"), "compact layout should omit full context window details");
		assert.ok(compactLine.includes("codex/gpt-5.5"), "compact layout should shorten Codex model name");
		assert.ok(!compactLine.includes("openai-codex"), "compact layout should omit redundant Codex provider name");
		assert.ok(!compactLine.includes("\uf233 0/9"), "compact layout should drop inactive MCP status first");

		const minimalLine = footer.renderPlain(40);
		assert.ok(minimalLine.includes("path (main)"), "minimal layout should keep cwd basename and branch");
		assert.ok(minimalLine.includes("(45%)"), "minimal layout should keep context percentage");
		assert.ok(!minimalLine.includes("codex/gpt-5.5"), "minimal layout should hide model");
		assert.ok(!minimalLine.includes("↑"), "minimal layout should hide token totals");
	}

	{
		const footer = await createFooter({
			cwd: path.join(process.env.HOME ?? "/home/test", "very", "long", "project", "path"),
			statuses: new Map([["mcp", "\x1b[32mMCP: 2/9 servers\x1b[0m"]]),
			entries: [assistantEntry({ input: 123456, output: 45678, cacheRead: 98765, cacheWrite: 8765 })],
			contextUsage: { tokens: 123456, contextWindow: 272000, percent: 45.4 },
		});
		assert.ok(footer.renderPlain(90).includes("\uf233 2/9"), "compact layout should keep active MCP status");
	}

	{
		const footer = await createFooter({
			cwd: path.join(process.env.HOME ?? "/home/test", "very", "long", "project", "path"),
			model: { provider: "anthropic", id: "claude-sonnet-4-20250514", contextWindow: 200000 },
			entries: [assistantEntry({ input: 123456, output: 45678, cacheRead: 98765, cacheWrite: 8765 })],
			contextUsage: { tokens: 123456, contextWindow: 200000, percent: 61.7 },
		});
		const line = footer.renderPlain(60);
		assert.ok(line.includes("sonnet-4"), "compact layout should shorten Anthropic Sonnet model names");
		assert.ok(!line.includes("anthropic/"), "compact layout should omit Anthropic provider prefix");
	}

	{
		const footer = await createFooter({
			config: {
				segments: {
					branch: false,
					statuses: false,
					tokens: false,
					context: false,
					thinking: false,
				},
			},
			statuses: new Map([["status", "status:on"]]),
			entries: [assistantEntry({ input: 12000, output: 3000, cacheRead: 4000, cacheWrite: 4000 })],
			contextUsage: { tokens: 9400, contextWindow: 272000, percent: 3.45 },
		});
		const line = footer.renderPlain();
		assert.ok(line.includes("~/project"), "cwd should remain enabled by default");
		assert.ok(line.includes("openai-codex/gpt-5.5"), "model should remain enabled by default");
		assert.ok(!line.includes("(main)"), "branch config should hide branch");
		assert.ok(!line.includes("status:on"), "statuses config should hide statuses");
		assert.ok(!line.includes("↑") && !line.includes("↓"), "tokens config should hide token totals");
		assert.ok(!line.includes("%") && !line.includes("/272k"), "context config should hide context percentage and usage");
		assert.ok(!line.includes("\uf111"), "thinking config should hide thinking dot");
	}

	{
		const footer = await createFooter({
			config: "{",
		});
		const line = footer.renderPlain();
		assert.match(line, /^~\/project \(main\)/, "invalid config should fall back to defaults");
		assert.ok(line.includes("openai-codex/gpt-5.5"), "invalid config should keep default model segment");
		assert.ok(line.includes("\uf111"), "invalid config should keep default thinking segment");
	}

	for (const config of [undefined, { nerdFont: false }]) {
		const footer = await createFooter({
			...(config ? { config } : {}),
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
