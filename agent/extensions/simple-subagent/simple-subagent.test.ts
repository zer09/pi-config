import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import simpleSubagentExtension, {
	CHILD_MARKER,
	DEFAULT_MODEL,
	DEFAULT_THINKING,
	applyJsonEventLine,
	buildPiArgs,
	buildSystemPrompt,
	buildTaskPrompt,
	createTempRunFiles,
	discoverAgents,
	getSubagentSessionDir,
	normalizeParams,
	parseAgentFile,
	parseFrontmatter,
	redactSensitiveText,
	resolveInvocation,
	resolveTools,
	runSubagent,
	truncateMiddleByChars,
} from "./index.ts";
import type { AgentConfig } from "./types.ts";

type TestFn = () => void | Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];

function test(name: string, fn: TestFn): void {
	tests.push({ name, fn });
}

function makeTempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeAgent(root: string, name: string, body: string): string {
	const dir = path.join(root, "agents");
	fs.mkdirSync(dir, { recursive: true });
	const filePath = path.join(dir, `${name}.md`);
	fs.writeFileSync(filePath, body, "utf8");
	return filePath;
}

async function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
	const previous: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(values)) {
		previous[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return await fn();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

function sampleAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "investigator",
		description: "Investigates",
		systemPrompt: "Investigate and report.",
		systemPromptMode: "append",
		filePath: "/tmp/investigator.md",
		...overrides,
	};
}

test("frontmatter parser only treats the leading block as metadata", () => {
	const parsed = parseFrontmatter(`---\nname: investigator\ntools: read, grep, bash\n---\n# Body\n---\nstill body`);
	assert.equal(parsed.frontmatter.name, "investigator");
	assert.equal(parsed.frontmatter.tools, "read, grep, bash");
	assert.match(parsed.body, /still body/);
});

test("frontmatter parser handles an empty body without trailing newline", () => {
	const parsed = parseFrontmatter(`---\nname: empty\n---`);
	assert.equal(parsed.frontmatter.name, "empty");
	assert.equal(parsed.body, "");

	const spaced = parseFrontmatter(`---\t\nname: spaced\n---   `);
	assert.equal(spaced.frontmatter.name, "spaced");
	assert.equal(spaced.body, "");

	assert.throws(() => parseAgentFile("/tmp/empty.md", `---\nname: empty\n---`), /empty prompt body/);
});

test("agent discovery parses supported fields and rejects duplicates", async () => {
	const root = makeTempDir("pi-simple-subagent-agents-");
	writeAgent(
		root,
		"investigator",
		`---\nname: investigator\ndescription: Reads code\nmodel: model-a\nthinking: high\ntools: read, grep, find\nsystemPromptMode: append\n---\n# Role`,
	);
	const discovery = await discoverAgents(root);
	assert.equal(discovery.agents.length, 1);
	assert.equal(discovery.agents[0].name, "investigator");
	assert.equal(discovery.agents[0].model, "model-a");
	assert.equal(discovery.agents[0].thinking, "high");
	assert.equal(parseAgentFile("default.md", `---\nname: reviewer\nmodel: default\n---\n# Role`).model, undefined);

	writeAgent(root, "duplicate", `---\nname: investigator\n---\n# Duplicate`);
	await assert.rejects(() => discoverAgents(root), /Duplicate agent name/);
});

test("tool resolution is read-only and uses only Context Mode tools", () => {
	const readTools = resolveTools();
	assert.deepEqual(readTools, [
		"ctx_execute",
		"ctx_execute_file",
		"ctx_batch_execute",
		"ctx_search",
		"ctx_fetch_and_index",
		"ctx_index",
		"context_mode_ctx_execute",
		"context_mode_ctx_execute_file",
		"context_mode_ctx_batch_execute",
		"context_mode_ctx_search",
		"context_mode_ctx_fetch_and_index",
		"context_mode_ctx_index",
	]);
	assert.equal(readTools.includes("bash"), false);
	assert.equal(readTools.includes("edit"), false);
	assert.equal(readTools.includes("write"), false);
});

test("session dir maps cwd under the subagent sessions root", () => {
	const agentRoot = makeTempDir("pi-simple-subagent-agent-root-");
	assert.equal(
		getSubagentSessionDir("/home/gc/development/code-review-graph", agentRoot),
		path.join(agentRoot, "subagent-sessions", "home", "gc", "development", "code-review-graph"),
	);
	assert.equal(getSubagentSessionDir("/", agentRoot), path.join(agentRoot, "subagent-sessions", "_root"));
});

test("model and thinking precedence is call, agent, then extension default", () => {
	const cwd = makeTempDir("pi-simple-subagent-cwd-");
	const params = normalizeParams({ agent: "a", task: "t" }, cwd);
	const defaultResolved = resolveInvocation(params, [sampleAgent({ name: "a" })]);
	assert.notEqual(typeof defaultResolved, "string");
	assert.equal((defaultResolved as any).model, DEFAULT_MODEL);
	assert.equal((defaultResolved as any).thinking, DEFAULT_THINKING);

	const agentResolved = resolveInvocation(params, [sampleAgent({ name: "a", model: "model-agent", thinking: "low" })]);
	assert.notEqual(typeof agentResolved, "string");
	assert.equal((agentResolved as any).model, "model-agent");
	assert.equal((agentResolved as any).thinking, "low");

	const callParams = normalizeParams({ agent: "a", task: "t", model: "model-call", thinking: "xhigh" }, cwd);
	const callResolved = resolveInvocation(callParams, [sampleAgent({ name: "a", model: "model-agent", thinking: "low" })]);
	assert.notEqual(typeof callResolved, "string");
	assert.equal((callResolved as any).model, "model-call");
	assert.equal((callResolved as any).thinking, "xhigh");
});

test("prompt assembly contains boundary, mode contracts, agent prompt, and output contract", () => {
	const agent = sampleAgent({ systemPrompt: "Role prompt." });
	const readPrompt = buildSystemPrompt(agent);
	assert.match(readPrompt, /Do not call subagent/);
	assert.match(readPrompt, /Mode: read-only/);
	assert.match(readPrompt, /Do not edit files/);
	assert.match(readPrompt, /Direct bash, edit, and write tools are not available/);
	assert.match(readPrompt, /Role prompt/);
	assert.match(readPrompt, /## Result/);
});

test("task prompt includes requested cwd with a concise Context Mode prefix hint", () => {
	const cwd = makeTempDir("pi-simple-subagent-cwd-'");
	const params = normalizeParams({ agent: "a", task: "inspect files" }, cwd);
	const resolved = resolveInvocation(params, [sampleAgent({ name: "a" })]);
	assert.notEqual(typeof resolved, "string");

	const taskPrompt = buildTaskPrompt(resolved as any);
	assert.match(taskPrompt, /Requested cwd:/);
	assert.ok(taskPrompt.includes(params.cwd));
	assert.match(taskPrompt, /Before repo work, start Context Mode shell commands with: cd '/);
	assert.match(taskPrompt, /'\\''/);
	assert.doesNotMatch(taskPrompt, /Use Context Mode tools for shell work/);
	assert.doesNotMatch(taskPrompt, /direct bash is not available/);
	assert.doesNotMatch(taskPrompt, /command string passed to Context Mode tools/);
	assert.doesNotMatch(taskPrompt, /Context Mode command strings may start/);
	assert.doesNotMatch(taskPrompt, /When a Context Mode shell command reads repo files/);
});

test("argument builder uses json, session-dir, continue, model, thinking, prompt file, tools, and task file", async () => {
	const cwd = makeTempDir("pi-simple-subagent-cwd-");
	const params = normalizeParams({ agent: "a", task: "t" }, cwd);
	const resolved = resolveInvocation(params, [sampleAgent({ name: "a" })]);
	assert.notEqual(typeof resolved, "string");
	const files = await createTempRunFiles(resolved as any);
	try {
		const args = buildPiArgs(resolved as any, files);
		assert.deepEqual(args.slice(0, 3), ["--mode", "json", "-p"]);
		assert.equal(args.includes("--no-session"), false);
		const sessionIndex = args.indexOf("--session-dir");
		assert.notEqual(sessionIndex, -1);
		assert.equal(args[sessionIndex + 1], (resolved as any).sessionDir);
		assert.equal(args.includes("--continue"), true);
		assert.ok(args.includes("--model"));
		assert.ok(args.includes(DEFAULT_MODEL));
		assert.ok(args.includes("--thinking"));
		assert.ok(args.includes(DEFAULT_THINKING));
		assert.ok(args.includes("--append-system-prompt"));
		assert.ok(args.includes("--tools"));
		assert.ok(args.some((arg) => arg === `@${files.taskPath}`));
	} finally {
		fs.rmSync(files.dir, { recursive: true, force: true });
	}
});

test("JSON event parsing extracts final text and counts tools without returning tool args", () => {
	const state = { finalText: "", streamingText: "", lastError: "", toolCallCount: 0 };
	applyJsonEventLine(JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "secret" } }), state);
	applyJsonEventLine(
		JSON.stringify({
			type: "message_end",
			message: { role: "assistant", model: "fake", content: [{ type: "text", text: "final answer" }] },
		}),
		state,
	);
	assert.equal(state.toolCallCount, 1);
	assert.equal(state.finalText, "final answer");
	assert.equal(JSON.stringify(state).includes("secret"), false);
});

test("redaction and middle truncation keep output bounded", () => {
	const redacted = redactSensitiveText(`${os.homedir()}/.pi API_KEY=<redaction-test-value> Bearer REDACTION_TEST_VALUE`);
	assert.equal(redacted.includes(os.homedir()), false);
	assert.match(redacted, /~\/\.pi/);
	assert.match(redacted, /API_KEY=<redacted>/);
	assert.match(redacted, /Bearer <redacted>/);

	const truncated = truncateMiddleByChars("a".repeat(200), 80);
	assert.equal(truncated.truncated, true);
	assert.ok(truncated.text.length <= 80);
	assert.match(truncated.text, /truncated child result/);

	const tiny = truncateMiddleByChars("a".repeat(200), 10);
	assert.equal(tiny.truncated, true);
	assert.ok(tiny.text.length <= 10);
});

test("runSubagent uses fake Pi, redacts output, counts tools, and cleans temp files", async () => {
	const testRoot = makeTempDir("pi-simple-subagent-run-");
	const agentRoot = path.join(testRoot, "agent-root");
	const cwd = path.join(testRoot, "project");
	fs.mkdirSync(cwd, { recursive: true });
	writeAgent(agentRoot, "fake", `---\nname: fake\ndescription: Fake agent\n---\n# Fake role`);

	const fakePi = path.join(testRoot, "pi-fake.js");
	const argsOut = path.join(testRoot, "args.json");
	fs.writeFileSync(
		fakePi,
		`#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.FAKE_PI_ARGS_OUT, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "TOKEN=<redaction-test-value>" } }));\nconsole.log(JSON.stringify({ type: "message_end", message: { role: "assistant", model: "fake-model", content: [{ type: "text", text: "done ${os.homedir()}/.pi API_KEY=<redaction-test-value>" }] } }));\n`,
		"utf8",
	);
	fs.chmodSync(fakePi, 0o700);

	await withEnv(
		{ PI_CODING_AGENT_DIR: agentRoot, PI_SIMPLE_SUBAGENT_BIN: fakePi, FAKE_PI_ARGS_OUT: argsOut },
		async () => {
			const result = await runSubagent({ agent: "fake", task: "do it", maxResultBytes: 4_000 }, cwd);
			assert.equal(result.details.status, "completed");
			assert.equal(result.details.toolCallCount, 1);
			assert.equal(result.details.model, "fake-model");
			assert.match(result.content[0].text, /done ~\/\.pi/);
			assert.match(result.content[0].text, /API_KEY=<redacted>/);
			assert.equal(result.content[0].text.includes("TOKEN=<redaction-test-value>"), false);

			const args = JSON.parse(fs.readFileSync(argsOut, "utf8"));
			const sessionDir = args[args.indexOf("--session-dir") + 1];
			assert.equal(sessionDir, getSubagentSessionDir(cwd, agentRoot));
			assert.equal(fs.existsSync(sessionDir), true);
			assert.equal(args.includes("--no-session"), false);
			assert.equal(args.includes("--continue"), true);
			const promptPath = args[args.indexOf("--append-system-prompt") + 1];
			const taskPath = args.find((arg: string) => arg.startsWith("@")).slice(1);
			assert.equal(fs.existsSync(promptPath), false);
			assert.equal(fs.existsSync(taskPath), false);
			assert.equal(fs.existsSync(path.dirname(promptPath)), false);
		},
	);
});

test("extension skips registration when running in a child", async () => {
	await withEnv({ [CHILD_MARKER]: "1" }, () => {
		let registered = false;
		simpleSubagentExtension({ registerTool: () => (registered = true) } as never);
		assert.equal(registered, false);
	});

	await withEnv({ [CHILD_MARKER]: undefined }, () => {
		let registered = false;
		simpleSubagentExtension({ registerTool: () => (registered = true) } as never);
		assert.equal(registered, true);
	});
});

let failures = 0;
for (const { name, fn } of tests) {
	try {
		await fn();
		console.log(`ok ${name}`);
	} catch (error) {
		failures += 1;
		console.error(`FAIL ${name}`);
		console.error(error);
	}
}

if (failures > 0) {
	throw new Error(`${failures} simple-subagent test(s) failed`);
}
