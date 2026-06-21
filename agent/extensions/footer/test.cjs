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
const { visibleWidth } = require("@earendil-works/pi-tui");

const extensionPath = path.join(__dirname, "index.ts");
const ansiPattern = /\x1b\[[0-9;]*m/g;
const experimentalGlyph = "\uf00d";

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

async function withExperimental(value, fn) {
	const oldValue = process.env.PI_EXPERIMENTAL;
	if (value === undefined) {
		delete process.env.PI_EXPERIMENTAL;
	} else {
		process.env.PI_EXPERIMENTAL = value;
	}
	try {
		return await fn();
	} finally {
		if (oldValue === undefined) {
			delete process.env.PI_EXPERIMENTAL;
		} else {
			process.env.PI_EXPERIMENTAL = oldValue;
		}
	}
}

async function withFakeGitStatus(output, fn) {
	return withFakeGitScript(`process.stdout.write(${JSON.stringify(output)});\n`, fn);
}

async function withFakeGitScript(script, fn) {
	const oldPath = process.env.PATH;
	const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "footer-git-"));
	const gitPath = path.join(binDir, "git");
	fs.writeFileSync(gitPath, `#!/usr/bin/env node\n${script}`, "utf8");
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
	const handlers = new Map();
	const factory = loadExtension();
	const themeName = options.themeName ?? "dark";
	const colorCalls = [];
	const theme = {
		fg(color, text) {
			colorCalls.push({ color, text });
			return `\x1b[2m${text}\x1b[0m`;
		},
		bold(text) {
			return `\x1b[1m${text}\x1b[0m`;
		},
	};
	let thinkingLevel = options.thinkingLevel ?? "medium";
	let branch = Object.hasOwn(options, "branch") ? options.branch : "main";
	let statuses = options.statuses ?? new Map();
	let renderRequests = 0;
	let footerFactory;
	const eventHandlers = new Map();
	const events = {
		on(name, handler) {
			const list = eventHandlers.get(name) ?? [];
			list.push(handler);
			eventHandlers.set(name, list);
		},
		emit(name, data) {
			for (const handler of eventHandlers.get(name) ?? []) handler(data);
		},
	};

	factory({
		events,
		on(event, handler) {
			handlers.set(event, handler);
		},
		getThinkingLevel() {
			return thinkingLevel;
		},
	});

	const ctx = {
		hasUI: true,
		mode: "tui",
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
			getAvailableProviderCount: () => options.availableProviderCount ?? 1,
			onBranchChange: (callback) => {
				createFooter.lastBranchCallback = callback;
				return () => {};
			},
		},
	);

	return {
		component,
		handlers,
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
		emitFastlaneState(payload) {
			events.emit("fastlane:state", payload);
		},
		async emit(event, payload = {}) {
			await handlers.get(event)?.(payload, ctx);
		},
		getColorCalls() {
			return colorCalls;
		},
	};
}

function assistantEntry(usage) {
	return { type: "message", message: { role: "assistant", usage } };
}

async function run() {
	return withExperimental(undefined, runTests);
}

async function runTests() {
	{
		const footer = await createFooter({ thinkingLevel: "off" });
		for (const [level, glyph] of [
			["off", "○"],
			["minimal", "·"],
			["low", "◦"],
			["medium", "◇"],
			["high", "◆"],
			["xhigh", "●"],
		]) {
			footer.setThinkingLevel(level);
			assert.match(footer.renderPlain(), new RegExp(`${glyph}$`), `${level} thinking should use ${glyph}`);
		}
	}


	{
		const footer = await createFooter({ thinkingLevel: "xhigh" });
		footer.emitFastlaneState({ active: true, thinkingGlyphCount: 3 });
		assert.match(footer.renderPlain(), /●●●$/, "active Fastlane should repeat the thinking glyph three times");
		assert.ok(!footer.renderPlain().includes("fast"), "Fastlane should not render a text indicator in footer");
		assert.ok(footer.getRenderRequests() > 0, "Fastlane state changes should request a footer render");
	}

	{
		const footer = await createFooter({ thinkingLevel: "high" });
		footer.emitFastlaneState({ active: true, thinkingGlyphCount: 5 });
		assert.match(footer.renderPlain(), /◆◆◆◆◆$/, "Fastlane should use the configured thinking glyph count");
		footer.emitFastlaneState({ active: false, thinkingGlyphCount: 5 });
		assert.match(footer.renderPlain(), /◆$/, "inactive Fastlane should restore the single thinking glyph");
	}

	await withExperimental(undefined, async () => {
		const footer = await createFooter();
		assert.ok(!footer.renderPlain().includes(experimentalGlyph), "experimental marker should be hidden by default");
	});

	await withExperimental("1", async () => {
		const footer = await createFooter();
		assert.ok(footer.renderPlain().endsWith(experimentalGlyph), "experimental marker should show at the end when enabled");
		assert.ok(
			footer.getColorCalls().some((call) => call.color === "error" && call.text === experimentalGlyph),
			"experimental marker should use the error color",
		);
	});


	{
		const footer = await createFooter({
			cwd: path.join(process.env.HOME ?? "/home/test", "project"),
			model: { provider: "anthropic", id: "claude-sonnet-4-20250514", contextWindow: 200000 },
		});
		const line = footer.renderPlain();
		assert.match(line, /^\(main\) ~\/project/, "branch should show before abbreviated cwd");
		assert.ok(line.includes("sonnet-4"), "model date suffix should be removed and model label should be compact");
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
		const largeDirtyOutput = `# branch.head main\n# branch.ab +0 -0\n${Array.from({ length: 9000 }, (_, index) => `? file-${index}\n`).join("")}`;
		await withFakeGitStatus(largeDirtyOutput, async () => {
			const footer = await createFooter({ cwd: __dirname, branch: "main" });
			await waitFor(() => footer.renderPlain().includes("(main*)"), "large dirty status output should still show dirty marker");
		});
	}


	{
		const markerPath = path.join(os.tmpdir(), `footer-git-null-branch-${process.pid}-${Date.now()}`);
		try {
			await withFakeGitScript(
				`require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "ran");\nprocess.stdout.write("# branch.head main\\n# branch.ab +0 -0\\n");\n`,
				async () => {
					const footer = await createFooter({
						cwd: __dirname,
						branch: null,
					});
					footer.renderPlain();
					await new Promise((resolve) => setTimeout(resolve, 20));
					assert.equal(fs.existsSync(markerPath), false, "missing branch should not spawn git status");
				},
			);
		} finally {
			fs.rmSync(markerPath, { force: true });
		}
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
		assert.ok(line.indexOf("a:on") < line.indexOf("codex/gpt-5.5"), "statuses should render before model");
	}

	for (const [statusText, dot, description] of [
		["⚪ Browser disabled", "⚪", "disabled"],
		["⚪ Browser enabled lazily", "⚪", "enabled lazy"],
		["🔴 Browser disconnected", "🔴", "disconnected"],
		["🟢 Browser connected", "🟢", "connected"],
		["🟢 Browser enabled", "🟢", "enabled connected"],
		["Browser: 🔴 Disconnected", "🔴", "status command disconnected"],
	]) {
		const footer = await createFooter({
			statuses: new Map([["browser", statusText]]),
		});
		const line = footer.renderPlain();
		assert.ok(line.includes(dot), `browser ${description} status should keep only the status dot`);
		assert.ok(!line.includes("Browser"), `browser ${description} status should omit the label`);
	}

	{
		const footer = await createFooter({
			cwd: path.join(process.env.HOME ?? "/home/test", "very", "long", "project", "path"),
			statuses: new Map([["browser", "🔴 Browser disconnected"]]),
		});
		assert.ok(footer.renderPlain(60).includes("🔴"), "compact layout should keep browser status dot");
	}

	{
		const footer = await createFooter({
			statuses: new Map([["agentmemory", "🧠 agentmemory"]]),
		});
		const line = footer.renderPlain();
		assert.ok(line.includes("\uf0c7"), "healthy agentmemory status should use compact disk glyph");
		assert.ok(!line.includes("agentmemory"), "agentmemory status should omit the long label");
		assert.ok(!line.includes("🧠"), "agentmemory status should omit the colored emoji");
		assert.ok(
			footer.getColorCalls().some((call) => call.color === "accent" && call.text === "\uf0c7"),
			"healthy agentmemory status should use accent color",
		);
	}

	{
		const footer = await createFooter({
			statuses: new Map([["agentmemory", "🧠 agentmemory off"]]),
		});
		footer.renderPlain();
		assert.ok(
			footer.getColorCalls().some((call) => call.color === "muted" && call.text === "\uf0c7"),
			"offline agentmemory status should mute the disk glyph",
		);
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
		const footer = await createFooter({
			entries: [assistantEntry({ input: 12000, output: 3000, cacheRead: 4000, cacheWrite: 4000 })],
			contextUsage: { tokens: 9400, contextWindow: 272000, percent: 3.45 },
		});
		assert.ok(
			footer.renderPlain().includes("(20%) (↑12k/R4k · ↓3k/W4k) (3.5%) (9.4k/272k) codex/gpt-5.5"),
			"right side should include cache hit rate, token totals, context percentage, context usage, model, and thinking",
		);
	}



	{
		const footer = await createFooter({
			entries: [assistantEntry({ input: 742000, output: 80000, cacheRead: 12000000, cacheWrite: 0 })],
			contextUsage: { tokens: 76000, contextWindow: 272000, percent: null },
		});
		assert.ok(
			footer.renderPlain().includes("(94%) (↑742k/R12M · ↓80k) (28%) (76k/272k) codex/gpt-5.5"),
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
		assert.ok(line.includes("(0%) (↑12k · ↓3k) codex/gpt-5.5"), "cache segments should be omitted when zero");
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
		assert.ok(compactLine.includes("(main) path"), "compact layout should show branch before cwd basename");
		assert.ok(compactLine.includes("↑123.5k · ↓45.7k"), "compact layout should omit cache token details");
		assert.ok(compactLine.includes("(45%)"), "compact layout should keep context percentage");
		assert.ok(!compactLine.includes("/272k"), "compact layout should omit full context window details");
		assert.ok(compactLine.includes("codex/gpt-5.5"), "compact layout should shorten Codex model name");
		assert.ok(!compactLine.includes("openai-codex"), "compact layout should omit redundant Codex provider name");
		assert.ok(!compactLine.includes("\uf233 0/9"), "compact layout should drop inactive MCP status first");

		const minimalLine = footer.renderPlain(40);
		assert.ok(minimalLine.includes("(main) path"), "minimal layout should keep branch before cwd basename");
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
			statuses: new Map([["other", "status:warn"]]),
		});
		const line = footer.renderPlain(60);
		assert.ok(line.includes("status:warn"), "compact layout should preserve non-MCP extension statuses");
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

	await withExperimental("1", async () => {
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
			assert.doesNotThrow(() => footer.render(width), `experimental render should not throw at width ${width}`);
			assert.ok(visibleWidth(footer.render(width)) <= width, `experimental render should fit width ${width}`);
		}
	});

	console.log("footer tests passed");
}

run().catch((error) => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
