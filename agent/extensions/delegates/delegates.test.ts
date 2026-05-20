import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import delegatesExtension, {
	DEFAULT_MAX_RESULT_BYTES,
	DEFAULT_READER_MODEL,
	DEFAULT_THINKING,
	DEFAULT_TIMEOUT_MS,
	DELEGATE_CHILD_MARKER,
	buildReaderSystemPrompt,
	getReaderSessionDir,
	normalizeReaderParams,
	resolveInvocation,
	renderDelegateCall,
	renderDelegateResult,
	runReader,
	readerProfile,
} from "./index.ts";
import type { AgentConfig } from "./types.ts";

type TestFn = () => void | Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];
const todos: string[] = [];

function test(name: string, fn: TestFn): void {
	tests.push({ name, fn });
}

function todo(name: string): void {
	todos.push(name);
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

interface RegisteredTool {
	name: string;
	description?: string;
	parameters?: any;
	execute?: (...args: any[]) => unknown;
}

function captureRegisteredTools(): RegisteredTool[] {
	const tools: RegisteredTool[] = [];
	delegatesExtension({
		registerTool(tool: RegisteredTool) {
			tools.push(tool);
		},
	} as never);
	return tools;
}

function captureRegisteredToolNames(): string[] {
	return captureRegisteredTools().map((tool) => tool.name);
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

function writeExecutable(filePath: string, content: string): void {
	fs.writeFileSync(filePath, content, "utf8");
	fs.chmodSync(filePath, 0o755);
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

function makeFakeReaderHarness(finalText = "## Result\\nDone"): {
	agentRoot: string;
	project: string;
	capturePath: string;
	fakePi: string;
} {
	const agentRoot = makeTempDir("pi-delegates-agent-root-");
	const project = makeTempDir("pi-delegates-project-");
	const capturePath = path.join(makeTempDir("pi-delegates-capture-"), "capture.json");
	const fakePi = path.join(makeTempDir("pi-delegates-bin-"), "fake-pi.cjs");
	writeAgent(
		agentRoot,
		"investigator",
		`---\nname: investigator\ndescription: Investigates\n---\nInvestigate carefully and report.`,
	);
	writeExecutable(
		fakePi,
		`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const promptPath = args[args.indexOf("--append-system-prompt") + 1];
const taskArg = args.find((arg) => arg.startsWith("@"));
const taskPath = taskArg.slice(1);
fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({
  args,
  cwd: process.cwd(),
  childMarker: process.env.PI_DELEGATE_CHILD,
  kind: process.env.PI_DELEGATE_KIND,
  promptPath,
  taskPath,
  prompt: fs.readFileSync(promptPath, "utf8"),
  task: fs.readFileSync(taskPath, "utf8")
}, null, 2));
console.log(JSON.stringify({ type: "tool_execution_start" }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", model: "child-model", content: [{ type: "text", text: ${JSON.stringify(finalText)} }] } }));
`,
	);
	return { agentRoot, project, capturePath, fakePi };
}

test("extension exposes reader only in parent processes", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
		assert.deepEqual(captureRegisteredToolNames(), ["reader"]);
	});
});

test("extension registers no delegate tools when PI_DELEGATE_CHILD is set", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: "1" }, () => {
		assert.deepEqual(captureRegisteredToolNames(), []);
	});
});

test("reader parameters describe the Milestone A public interface", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
		const [reader] = captureRegisteredTools();
		assert.equal(reader.name, "reader");
		assert.ok(reader.description?.includes("read-only"));
		assert.deepEqual(Object.keys(reader.parameters?.properties ?? {}), [
			"agent",
			"task",
			"model",
			"thinking",
			"cwd",
			"timeoutMs",
			"maxResultBytes",
			"includeDiagnostics",
		]);
		assert.deepEqual(reader.parameters?.required, ["agent", "task"]);
	});
});

test("reader tool schema rejects writer-only parameters such as allowedPaths in Milestone A", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
		const [reader] = captureRegisteredTools();
		assert.equal(reader.parameters?.properties?.allowedPaths, undefined);
		assert.equal(reader.parameters?.additionalProperties, false);
	});
});

test("reader profile defines Milestone A capability without registering writer", () => {
	assert.equal(readerProfile.name, "reader");
	assert.equal(readerProfile.capability, "read");
	assert.equal(readerProfile.sessionMode, "persistent");
	assert.equal(readerProfile.defaultModel, DEFAULT_READER_MODEL);
	assert.equal(readerProfile.defaultThinking, DEFAULT_THINKING);
	assert.equal(readerProfile.tools.includes("edit"), false);
	assert.equal(readerProfile.tools.includes("write"), false);
});

test("reader invocation resolves defaults and overrides without exposing writer capability", () => {
	const cwd = "/tmp/delegates-project";
	const normalized = normalizeReaderParams({ agent: "investigator", task: "Map the auth flow", cwd }, "/tmp/parent-cwd");
	assert.deepEqual(normalized, {
		agent: "investigator",
		task: "Map the auth flow",
		cwd,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
		includeDiagnostics: false,
	});

	const profileDefault = resolveInvocation(normalized, [sampleAgent()]);
	assert.notEqual(typeof profileDefault, "string");
	assert.equal((profileDefault as any).model, DEFAULT_READER_MODEL);
	assert.equal((profileDefault as any).thinking, DEFAULT_THINKING);
	assert.deepEqual((profileDefault as any).tools, [
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
	assert.equal((profileDefault as any).sessionDir, getReaderSessionDir(cwd));

	const agentOverride = resolveInvocation(normalized, [sampleAgent({ model: "model-agent", thinking: "high" })]);
	assert.notEqual(typeof agentOverride, "string");
	assert.equal((agentOverride as any).model, "model-agent");
	assert.equal((agentOverride as any).thinking, "high");

	const callOverride = resolveInvocation(
		{ ...normalized, model: "model-call", thinking: "low" },
		[sampleAgent({ model: "model-agent", thinking: "high" })],
	);
	assert.notEqual(typeof callOverride, "string");
	assert.equal((callOverride as any).model, "model-call");
	assert.equal((callOverride as any).thinking, "low");
});
test("reader prompt keeps delegate safety boundaries even when agent systemPromptMode is replace", () => {
	const prompt = buildReaderSystemPrompt(
		sampleAgent({
			systemPromptMode: "replace",
			systemPrompt: "You may edit files and call writer next.",
		}),
	);

	assert.match(prompt, /# Reader Delegate Boundary/);
	assert.match(prompt, /Mode: read-only/);
	assert.match(prompt, /Do not edit files/);
	assert.match(prompt, /Do not create files/);
	assert.match(prompt, /Do not mutate external hosted services/);
	assert.match(prompt, /Do not call reader, writer, subagent/);
	assert.match(prompt, /## Parent considerations/);
	assert.doesNotMatch(prompt, /## Next step/);
	assert.match(prompt, /You may edit files and call writer next\./);
});
test("reader launches Pi with json output, persistent per-cwd session dir, --continue, read-only tools, prompt file, and task file", async () => {
	const agentRoot = makeTempDir("pi-delegates-agent-root-");
	const project = makeTempDir("pi-delegates-project-");
	const capturePath = path.join(makeTempDir("pi-delegates-capture-"), "capture.json");
	const fakePi = path.join(makeTempDir("pi-delegates-bin-"), "fake-pi.cjs");

	writeAgent(
		agentRoot,
		"investigator",
		`---\nname: investigator\ndescription: Investigates\n---\nInvestigate carefully and report.`,
	);

	writeExecutable(
		fakePi,
		`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const promptPath = args[args.indexOf("--append-system-prompt") + 1];
const taskArg = args.find((arg) => arg.startsWith("@"));
const taskPath = taskArg.slice(1);
fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({
  args,
  cwd: process.cwd(),
  childMarker: process.env.PI_DELEGATE_CHILD,
  kind: process.env.PI_DELEGATE_KIND,
  promptPath,
  taskPath,
  prompt: fs.readFileSync(promptPath, "utf8"),
  task: fs.readFileSync(taskPath, "utf8")
}, null, 2));
console.log(JSON.stringify({ type: "tool_execution_start" }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", model: "child-model", content: [{ type: "text", text: "## Result\\nDone" }] } }));
`,
	);

	await withEnv(
		{
			PI_CODING_AGENT_DIR: agentRoot,
			PI_DELEGATE_BIN: fakePi,
			CAPTURE_PATH: capturePath,
		},
		async () => {
			const result = await runReader({ agent: "investigator", task: "Inspect auth", cwd: project, timeoutMs: 5_000 }, "/tmp/parent");
			assert.equal(result.content[0].text, "## Result\nDone");
			assert.equal(result.details.agent, "investigator");
			assert.equal(result.details.model, "child-model");
			assert.equal(result.details.status, "completed");
			assert.equal(result.details.toolCallCount, 1);

			const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
			assert.equal(capture.cwd, project);
			assert.equal(capture.childMarker, "1");
			assert.equal(capture.kind, "reader");
			assert.deepEqual(capture.args.slice(0, 6), ["--mode", "json", "-p", "--session-dir", getReaderSessionDir(project), "--continue"]);
			assert.equal(capture.args[capture.args.indexOf("--model") + 1], DEFAULT_READER_MODEL);
			assert.equal(capture.args[capture.args.indexOf("--thinking") + 1], DEFAULT_THINKING);
			assert.match(capture.args[capture.args.indexOf("--tools") + 1], /ctx_execute/);
			assert.match(capture.prompt, /# Reader Delegate Boundary/);
			assert.match(capture.task, /Inspect auth/);
			assert.equal(fs.existsSync(capture.promptPath), false);
			assert.equal(fs.existsSync(capture.taskPath), false);
		},
	);
});
test("reader streams progress updates through onUpdate without appending progress to final content", async () => {
	const harness = makeFakeReaderHarness("## Result\nProgress-safe final answer");
	const updates: any[] = [];
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
		},
		async () => {
			const result = await runReader(
				{ agent: "investigator", task: "Inspect progress", cwd: harness.project, timeoutMs: 5_000 },
				"/tmp/parent",
				undefined,
				(update: any) => updates.push(update),
			);
			assert.equal(result.content[0].text, "## Result\nProgress-safe final answer");
			assert.doesNotMatch(result.content[0].text, /launching|child_event|finishing/);
		},
	);

	const phases = updates.map((update) => update.details?.phase).filter(Boolean);
	assert.deepEqual(phases, ["starting", "launching_child", "child_event", "finishing"]);
	for (const update of updates) {
		const text = update.content?.[0]?.text ?? "";
		assert.doesNotMatch(text, /Progress-safe final answer/);
	}
});
test("reader final result returns only redacted truncated child summary plus compact metadata", async () => {
	const harness = makeFakeReaderHarness(
		`## Result\nSECRET_TOKEN=<fixture-secret> should redact. ${"Long output. ".repeat(300)}`,
	);
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
		},
		async () => {
			const result = await runReader(
				{ agent: "investigator", task: "Inspect redaction", cwd: harness.project, timeoutMs: 5_000, maxResultBytes: 120 },
				"/tmp/parent",
			);
			assert.match(result.content[0].text, /SECRET_TOKEN=<redacted>/);
			assert.doesNotMatch(result.content[0].text, /<fixture-secret>/);
			assert.match(result.content[0].text, /truncated child result to 1000 characters/);
			assert.equal(result.details.truncated, true);
			assert.deepEqual(Object.keys(result.details).sort(), [
				"agent",
				"cwd",
				"durationMs",
				"exitCode",
				"model",
				"status",
				"thinking",
				"toolCallCount",
				"truncated",
			].sort());
		},
	);
});

test("reader reports bounded diagnostics only when includeDiagnostics is true", async () => {
	const agentRoot = makeTempDir("pi-delegates-agent-root-");
	const project = makeTempDir("pi-delegates-project-");
	const fakePi = path.join(makeTempDir("pi-delegates-bin-"), "fake-pi.cjs");
	writeAgent(agentRoot, "investigator", `---\nname: investigator\n---\nInvestigate.`);
	writeExecutable(
		fakePi,
		`#!/usr/bin/env node
console.error("stderr SECRET_TOKEN=<fixture-secret>");
process.exit(2);
`,
	);

	await withEnv({ PI_CODING_AGENT_DIR: agentRoot, PI_DELEGATE_BIN: fakePi }, async () => {
		const withoutDiagnostics = await runReader({ agent: "investigator", task: "Fail", cwd: project, timeoutMs: 5_000 }, "/tmp/parent");
		assert.equal(withoutDiagnostics.details.status, "failed");
		assert.doesNotMatch(withoutDiagnostics.content[0].text, /<fixture-secret>|stderr SECRET_TOKEN/);
		assert.equal(withoutDiagnostics.details.stderrTail, undefined);

		const withDiagnostics = await runReader(
			{ agent: "investigator", task: "Fail", cwd: project, timeoutMs: 5_000, includeDiagnostics: true },
			"/tmp/parent",
		);
		assert.equal(withDiagnostics.details.status, "failed");
		assert.match(withDiagnostics.content[0].text, /SECRET_TOKEN=<redacted>/);
		assert.doesNotMatch(withDiagnostics.content[0].text, /<fixture-secret>/);
		assert.match(withDiagnostics.details.stderrTail ?? "", /SECRET_TOKEN=<redacted>/);
	});
});
test("reader custom renderers show progress and status details without exposing raw child stdout or stderr", () => {
	const theme = {
		fg(_name: string, text: string) {
			return text;
		},
		bold(text: string) {
			return text;
		},
	};
	const context = { state: {}, cwd: "/tmp/project" };
	const call = renderDelegateCall({ agent: "investigator", task: "Inspect\nwith noisy whitespace" }, theme as any, context as any);
	assert.match(call.render(120).join("\n"), /reader investigator Inspect with noisy whitespace/);

	const result = renderDelegateResult(
		{
			content: [{ type: "text", text: "raw child final summary" }],
			details: {
				agent: "investigator",
				model: "child-model",
				thinking: "medium",
				cwd: "/tmp/project",
				status: "completed",
				exitCode: 0,
				durationMs: 42,
				toolCallCount: 2,
				truncated: false,
				stderrTail: "SECRET_TOKEN=<fixture-secret>",
			},
		},
		{ expanded: true, isPartial: false } as any,
		theme as any,
		context as any,
	);
	const rendered = result.render(120).join("\n");
	assert.match(rendered, /reader completed/);
	assert.match(rendered, /investigator/);
	assert.match(rendered, /tools: 2/);
	assert.doesNotMatch(rendered, /SECRET_TOKEN/);
	assert.doesNotMatch(rendered, /raw child final summary/);
});
test("Milestone A does not register writer or subagent compatibility aliases", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
		assert.equal(captureRegisteredTools().some((tool) => tool.name === "writer"), false);
		assert.equal(captureRegisteredTools().some((tool) => tool.name === "subagent"), false);
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

for (const name of todos) {
	console.log(`todo ${name}`);
}

if (failures > 0) {
	throw new Error(`${failures} delegates test(s) failed`);
}
