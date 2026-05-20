import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import delegatesExtension, {
	DEFAULT_MAX_RESULT_BYTES,
	DEFAULT_READER_MODEL,
	DEFAULT_THINKING,
	DEFAULT_WRITER_MODEL,
	DEFAULT_TIMEOUT_MS,
	DELEGATE_CHILD_MARKER,
	buildReaderSystemPrompt,
	buildWriterSystemPrompt,
	getReaderSessionDir,
	normalizeReaderParams,
	normalizeWriterParams,
	resolveInvocation,
	renderDelegateCall,
	renderDelegateResult,
	runReader,
	runWriter,
	readerProfile,
	writerProfile,
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
	renderCall?: (...args: any[]) => any;
	renderResult?: (...args: any[]) => any;
	execute?: (...args: any[]) => unknown;
}

function captureRegisteredTools(): RegisteredTool[] {
	const tools: RegisteredTool[] = [];
	delegatesExtension({
		registerTool(tool: RegisteredTool) {
			tools.push(tool);
		},
		on() {
			return undefined;
		},
	} as never);
	return tools;
}

function captureExtensionEventHandlers(): Record<string, Array<(event: any) => unknown>> {
	const handlers: Record<string, Array<(event: any) => unknown>> = {};
	delegatesExtension({
		registerTool() {
			return undefined;
		},
		on(eventName: string, handler: (event: any) => unknown) {
			handlers[eventName] ??= [];
			handlers[eventName].push(handler);
		},
	} as never);
	return handlers;
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

function makeFakeWriterHarness(finalText = "## Result\nChanged"): {
	agentRoot: string;
	project: string;
	capturePath: string;
	fakePi: string;
	allowedFile: string;
} {
	const agentRoot = makeTempDir("pi-delegates-agent-root-");
	const project = makeTempDir("pi-delegates-writer-project-");
	fs.mkdirSync(path.join(project, "src"));
	const allowedFile = path.join(project, "src", "app.ts");
	fs.writeFileSync(allowedFile, "export const before = true;\n", "utf8");
	const capturePath = path.join(makeTempDir("pi-delegates-capture-"), "capture.json");
	const fakePi = path.join(makeTempDir("pi-delegates-bin-"), "fake-pi.cjs");
	writeAgent(
		agentRoot,
		"implementer",
		`---\nname: implementer\ndescription: Implements exact changes\n---\nImplement carefully and report.`,
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
  allowedPaths: process.env.PI_DELEGATE_ALLOWED_PATHS,
  promptPath,
  taskPath,
  prompt: fs.readFileSync(promptPath, "utf8"),
  task: fs.readFileSync(taskPath, "utf8")
}, null, 2));
console.log(JSON.stringify({ type: "tool_execution_start" }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", model: "writer-child-model", content: [{ type: "text", text: ${JSON.stringify(finalText)} }] } }));
`,
	);
	return { agentRoot, project, capturePath, fakePi, allowedFile };
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

test("extension exposes reader and writer only in parent processes", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
		assert.deepEqual(captureRegisteredToolNames(), ["reader", "writer"]);
	});
});

test("extension registers no delegate tools when PI_DELEGATE_CHILD is set", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: "1" }, () => {
		assert.deepEqual(captureRegisteredToolNames(), []);
	});
});

test("reader parameters keep the read-only public interface", async () => {
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

test("reader tool schema rejects writer-only parameters such as allowedPaths", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
		const [reader] = captureRegisteredTools();
		assert.equal(reader.parameters?.properties?.allowedPaths, undefined);
		assert.equal(reader.parameters?.additionalProperties, false);
	});
});

test("writer parameters require exact allowed paths and profile is fresh scoped write", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
		const writer = captureRegisteredTools().find((tool) => tool.name === "writer");
		assert.ok(writer);
		assert.ok(writer.description?.includes("scoped"));
		assert.deepEqual(Object.keys(writer.parameters?.properties ?? {}), [
			"agent",
			"task",
			"model",
			"thinking",
			"cwd",
			"timeoutMs",
			"maxResultBytes",
			"includeDiagnostics",
			"allowedPaths",
		]);
		assert.deepEqual(writer.parameters?.required, ["agent", "task", "allowedPaths"]);
		assert.equal(writer.parameters?.properties?.allowedPaths?.minItems, 1);
		assert.equal(writer.parameters?.additionalProperties, false);
	});

	assert.equal(writerProfile.name, "writer");
	assert.equal(writerProfile.capability, "write");
	assert.equal(writerProfile.sessionMode, "fresh");
	assert.equal(writerProfile.defaultModel, DEFAULT_WRITER_MODEL);
	assert.equal(writerProfile.defaultThinking, DEFAULT_THINKING);
	assert.deepEqual(writerProfile.tools, ["read", "edit", "write"]);
});

test("reader profile defines read capability without write tools", () => {
	assert.equal(readerProfile.name, "reader");
	assert.equal(readerProfile.capability, "read");
	assert.equal(readerProfile.sessionMode, "persistent");
	assert.equal(readerProfile.defaultModel, DEFAULT_READER_MODEL);
	assert.equal(readerProfile.defaultThinking, DEFAULT_THINKING);
	assert.equal(readerProfile.tools.includes("edit"), false);
	assert.equal(readerProfile.tools.includes("write"), false);
});

test("writer normalizes allowed paths as exact text file scope inside cwd", () => {
	const project = makeTempDir("pi-delegates-writer-project-");
	fs.mkdirSync(path.join(project, "src"));
	const existing = path.join(project, "src", "app.ts");
	fs.writeFileSync(existing, "export const ok = true;\n", "utf8");
	const missing = path.join(project, "src", "new.ts");

	const normalized = normalizeWriterParams(
		{ agent: "implementer", task: "Update exact files", cwd: project, allowedPaths: ["src/app.ts", missing], timeoutMs: 5_000 },
		"/tmp/parent",
	);
	assert.equal(normalized.cwd, fs.realpathSync(project));
	assert.deepEqual(normalized.allowedPaths, [fs.realpathSync(existing), missing]);

	assert.throws(
		() => normalizeWriterParams({ agent: "implementer", task: "No scope", cwd: project, allowedPaths: [] }, "/tmp/parent"),
		/allowedPaths must contain at least one exact file path/,
	);
	assert.throws(
		() => normalizeWriterParams({ agent: "implementer", task: "Directory", cwd: project, allowedPaths: ["src"] }, "/tmp/parent"),
		/allowedPaths entries must be exact file paths, not directories/,
	);
	assert.throws(
		() => normalizeWriterParams({ agent: "implementer", task: "Outside", cwd: project, allowedPaths: ["../outside.ts"] }, "/tmp/parent"),
		/allowedPaths entries must stay inside cwd/,
	);
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
test("writer rejects binary existing files and binary-looking write or edit content", async () => {
	const project = makeTempDir("pi-delegates-binary-project-");
	const binaryFile = path.join(project, "image.bin");
	fs.writeFileSync(binaryFile, Buffer.from([0, 1, 2, 3]));
	assert.throws(
		() => normalizeWriterParams({ agent: "implementer", task: "Edit binary", cwd: project, allowedPaths: ["image.bin"] }, "/tmp/parent"),
		/writer is text-only/,
	);

	const missing = path.join(project, "new.ts");
	await withEnv(
		{
			PI_DELEGATE_CHILD: "1",
			PI_DELEGATE_KIND: "writer",
			PI_DELEGATE_ALLOWED_PATHS: JSON.stringify([missing]),
		},
		async () => {
			const guard = (captureExtensionEventHandlers().tool_call ?? [])[0];
			assert.deepEqual(await guard({ toolName: "write", input: { path: missing, content: "hello\u0000world" } }), {
				block: true,
				reason: "writer is text-only",
			});
			assert.deepEqual(await guard({ toolName: "edit", input: { path: missing, oldText: "hello", newText: "world\u0000" } }), {
				block: true,
				reason: "writer is text-only",
			});
		},
	);
});

test("writer rejects missing creation targets under symlink escapes", () => {
	const project = makeTempDir("pi-delegates-symlink-project-");
	const outside = makeTempDir("pi-delegates-symlink-outside-");
	fs.symlinkSync(outside, path.join(project, "linked-dir"), "dir");
	assert.throws(
		() => normalizeWriterParams({ agent: "implementer", task: "Create through symlink", cwd: project, allowedPaths: ["linked-dir/new.ts"] }, "/tmp/parent"),
		/symlink escapes outside cwd/,
	);
});

test("writer child guard blocks file tools outside exact allowed paths", async () => {
	const project = makeTempDir("pi-delegates-guard-project-");
	const allowed = path.join(project, "allowed.ts");
	const outside = path.join(project, "outside.ts");
	fs.writeFileSync(allowed, "export const allowed = true;\n", "utf8");
	fs.writeFileSync(outside, "export const outside = true;\n", "utf8");

	await withEnv(
		{
			PI_DELEGATE_CHILD: "1",
			PI_DELEGATE_KIND: "writer",
			PI_DELEGATE_ALLOWED_PATHS: JSON.stringify([fs.realpathSync(allowed)]),
		},
		async () => {
			const handlers = captureExtensionEventHandlers().tool_call ?? [];
			assert.equal(handlers.length, 1);
			const guard = handlers[0];
			assert.equal(await guard({ toolName: "read", input: { path: allowed } }), undefined);
			assert.equal(await guard({ toolName: "edit", input: { path: allowed, oldText: "allowed", newText: "changed" } }), undefined);
			assert.deepEqual(await guard({ toolName: "read", input: { path: outside } }), {
				block: true,
				reason: "writer may access only exact allowed files",
			});
			assert.deepEqual(await guard({ toolName: "write", input: { path: allowed, content: "replace existing" } }), {
				block: true,
				reason: "writer must use edit for existing files",
			});
			assert.deepEqual(await guard({ toolName: "write", input: { path: path.join(project, "missing.ts"), content: "new" } }), {
				block: true,
				reason: "writer may access only exact allowed files",
			});
		},
	);
});

test("writer child guard blocks recursive delegates, command tools, delete tools, and ambiguous targets", async () => {
	const project = makeTempDir("pi-delegates-command-guard-");
	const allowed = path.join(project, "allowed.ts");
	fs.writeFileSync(allowed, "export const allowed = true;\n", "utf8");
	await withEnv(
		{
			PI_DELEGATE_CHILD: "1",
			PI_DELEGATE_KIND: "writer",
			PI_DELEGATE_ALLOWED_PATHS: JSON.stringify([fs.realpathSync(allowed)]),
		},
		async () => {
			const guard = (captureExtensionEventHandlers().tool_call ?? [])[0];
			assert.deepEqual(await guard({ toolName: "reader", input: { agent: "investigator", task: "read" } }), {
				block: true,
				reason: "writer cannot call delegate tools",
			});
			assert.deepEqual(await guard({ toolName: "bash", input: { command: "true" } }), {
				block: true,
				reason: "writer cannot run shell or Context Mode tools",
			});
			assert.deepEqual(await guard({ toolName: "ctx_execute", input: { language: "shell", code: "pwd" } }), {
				block: true,
				reason: "writer cannot run shell or Context Mode tools",
			});
			assert.deepEqual(await guard({ toolName: "delete", input: { path: allowed } }), {
				block: true,
				reason: "writer cannot delete files",
			});
			assert.deepEqual(await guard({ toolName: "edit", input: { path: allowed, file_path: path.join(project, "other.ts") } }), {
				block: true,
				reason: "writer file tool calls require one exact target path",
			});
		},
	);
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
test("writer prompt keeps exact-file safety boundaries even when agent systemPromptMode is replace", () => {
	const prompt = buildWriterSystemPrompt(
		sampleAgent({
			systemPromptMode: "replace",
			systemPrompt: "You may use bash, delete files, and call reader next.",
		}),
	);

	assert.match(prompt, /# Writer Delegate Boundary/);
	assert.match(prompt, /exact allowed files/);
	assert.match(prompt, /Read only exact allowed files/);
	assert.match(prompt, /Modify only exact allowed files/);
	assert.match(prompt, /Do not overwrite existing files with write/);
	assert.match(prompt, /Do not delete files/);
	assert.match(prompt, /Do not run shell commands/);
	assert.match(prompt, /Do not call reader, writer, subagent/);
	assert.match(prompt, /## Parent considerations/);
	assert.doesNotMatch(prompt, /## Next step/);
	assert.match(prompt, /You may use bash, delete files, and call reader next\./);
});

test("writer launches Pi with fresh session, exact allowed path env, restricted tools, prompt file, and task file", async () => {
	const harness = makeFakeWriterHarness();
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Change the exported value only", cwd: harness.project, allowedPaths: ["src/app.ts"], timeoutMs: 5_000 },
				"/tmp/parent",
			);
			assert.equal(result.content[0].text, "## Result\nChanged");
			assert.equal(result.details.agent, "implementer");
			assert.equal(result.details.model, "writer-child-model");
			assert.equal(result.details.status, "completed");

			const capture = JSON.parse(fs.readFileSync(harness.capturePath, "utf8"));
			assert.equal(capture.cwd, fs.realpathSync(harness.project));
			assert.equal(capture.childMarker, "1");
			assert.equal(capture.kind, "writer");
			assert.deepEqual(JSON.parse(capture.allowedPaths), [fs.realpathSync(harness.allowedFile)]);
			assert.equal(capture.args.includes("--continue"), false);
			assert.deepEqual(capture.args.slice(0, 5), ["--mode", "json", "-p", "--session-dir", capture.args[4]]);
			assert.match(capture.args[4], /delegate-sessions\/writer/);
			assert.equal(capture.args[capture.args.indexOf("--model") + 1], DEFAULT_WRITER_MODEL);
			assert.equal(capture.args[capture.args.indexOf("--thinking") + 1], DEFAULT_THINKING);
			assert.equal(capture.args[capture.args.indexOf("--tools") + 1], "read,edit,write");
			assert.match(capture.prompt, /# Writer Delegate Boundary/);
			assert.match(capture.prompt, /exact allowed files/);
			assert.match(capture.task, /Change the exported value only/);
			assert.match(capture.task, /src\/app\.ts/);
			assert.equal(fs.existsSync(capture.promptPath), false);
			assert.equal(fs.existsSync(capture.taskPath), false);
			assert.equal(fs.existsSync(capture.args[4]), false);
		},
	);
});

test("writer streams writer-labeled progress updates without appending progress to final content", async () => {
	const harness = makeFakeWriterHarness("## Result\nWriter progress-safe final answer");
	const updates: any[] = [];
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Update progress", cwd: harness.project, allowedPaths: ["src/app.ts"], timeoutMs: 5_000 },
				"/tmp/parent",
				undefined,
				(update: any) => updates.push(update),
			);
			assert.equal(result.content[0].text, "## Result\nWriter progress-safe final answer");
			assert.doesNotMatch(result.content[0].text, /launching|child_event|finishing/);
		},
	);

	assert.deepEqual(updates.map((update) => update.details?.phase).filter(Boolean), ["starting", "launching_child", "child_event", "finishing"]);
	assert.deepEqual([...new Set(updates.map((update) => update.details?.tool))], ["writer"]);
	for (const update of updates) {
		assert.match(update.content?.[0]?.text ?? "", /^writer /);
		assert.doesNotMatch(update.content?.[0]?.text ?? "", /Writer progress-safe final answer/);
	}
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

test("writer deletes successful sessions and preserves failed diagnostic sessions only when requested", async () => {
	const agentRoot = makeTempDir("pi-delegates-agent-root-");
	const project = makeTempDir("pi-delegates-writer-diagnostics-");
	const filePath = path.join(project, "app.ts");
	fs.writeFileSync(filePath, "export const value = 1;\n", "utf8");
	const fakePi = path.join(makeTempDir("pi-delegates-bin-"), "fake-pi.cjs");
	const capturePath = path.join(makeTempDir("pi-delegates-capture-"), "capture.json");
	writeAgent(agentRoot, "implementer", `---\nname: implementer\n---\nImplement.`);
	writeExecutable(
		fakePi,
		`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({ sessionDir: args[args.indexOf("--session-dir") + 1] }));
console.error("stderr SECRET_TOKEN=<fixture-secret>");
process.exit(2);
`,
	);

	await withEnv({ PI_CODING_AGENT_DIR: agentRoot, PI_DELEGATE_BIN: fakePi, CAPTURE_PATH: capturePath }, async () => {
		const withoutDiagnostics = await runWriter(
			{ agent: "implementer", task: "Fail safely", cwd: project, allowedPaths: ["app.ts"], timeoutMs: 5_000 },
			"/tmp/parent",
		);
		const firstCapture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
		assert.equal(withoutDiagnostics.details.status, "failed");
		assert.equal(withoutDiagnostics.details.stderrTail, undefined);
		assert.doesNotMatch(withoutDiagnostics.content[0].text, /stderr SECRET_TOKEN|<fixture-secret>/);
		assert.equal(fs.existsSync(firstCapture.sessionDir), false);

		const withDiagnostics = await runWriter(
			{ agent: "implementer", task: "Fail with diagnostics", cwd: project, allowedPaths: ["app.ts"], timeoutMs: 5_000, includeDiagnostics: true },
			"/tmp/parent",
		);
		const secondCapture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
		assert.equal(withDiagnostics.details.status, "failed");
		assert.match(withDiagnostics.content[0].text, /SECRET_TOKEN=<redacted>/);
		assert.doesNotMatch(withDiagnostics.content[0].text, /<fixture-secret>/);
		assert.match(withDiagnostics.details.stderrTail ?? "", /SECRET_TOKEN=<redacted>/);
		assert.equal(fs.existsSync(secondCapture.sessionDir), true);
	});
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
test("writer custom renderers are writer-labeled and hide raw child stdout or stderr", async () => {
	const theme = {
		fg(_name: string, text: string) {
			return text;
		},
		bold(text: string) {
			return text;
		},
	};
	const context = { state: {}, cwd: "/tmp/project" };
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
		const writer = captureRegisteredTools().find((tool) => tool.name === "writer");
		assert.ok(writer?.renderCall);
		assert.ok(writer?.renderResult);
		const call = writer.renderCall({ agent: "implementer", task: "Change\nexact file", allowedPaths: ["src/app.ts"] }, theme as any, context as any);
		assert.match(call.render(120).join("\n"), /writer implementer Change exact file/);

		const result = writer.renderResult(
			{
				content: [{ type: "text", text: "raw writer final summary" }],
				details: {
					agent: "implementer",
					model: "writer-model",
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
		assert.match(rendered, /writer completed/);
		assert.match(rendered, /implementer/);
		assert.match(rendered, /tools: 2/);
		assert.doesNotMatch(rendered, /SECRET_TOKEN/);
		assert.doesNotMatch(rendered, /raw writer final summary/);
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
test("Milestone B registers no subagent compatibility alias", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
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
