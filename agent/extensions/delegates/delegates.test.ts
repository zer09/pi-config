import assert from "node:assert/strict";
import * as cp from "node:child_process";
import { createHash } from "node:crypto";
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
	WRITER_DIFF_MAX_CHANGED_FILES,
	WRITER_DIFF_MAX_FILE_BYTES,
	buildReaderSystemPrompt,
	buildWriterDiffPreview,
	buildWriterSystemPrompt,
	captureWriterFileSnapshots,
	getContinuedReaderSessionDir,
	getFreshReaderSessionBaseDir,
	getReaderSessionDir,
	normalizeReaderParams,
	normalizeWriterParams,
	resolveInvocation,
	resolveReaderInvocation,
	renderDelegateCall,
	renderDelegateResult,
	runReader,
	runWriter,
	readerProfile,
	writerProfile,
} from "./index.ts";
import { WRITER_DIFF_MAX_PREVIEW_LINES } from "./constants.ts";
import { agentSessionDirName, cwdSessionDirName, getWriterSessionBaseDir, sessionKeyDirName } from "./paths.ts";
import { redactSensitiveText } from "./redaction.ts";
import { acquireContinuedReaderSessionLock } from "./session-lock.ts";
import { writerDiffDetailFields } from "./writer-diff.ts";
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
	const merged = { ...values };
	if (merged.CAPTURE_PATH !== undefined && merged.PI_DELEGATE_INHERIT_ENV_KEYS === undefined) {
		merged.PI_DELEGATE_INHERIT_ENV_KEYS = "CAPTURE_PATH,PI_FAKE_WRITER_MUTATION";
	}
	const previous: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(merged)) {
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

function expectedCwdSessionDirName(cwd: string): string {
	const resolvedCwd = path.resolve(cwd);
	const name = `--${encodeURIComponent(resolvedCwd)}--`;
	if (Buffer.byteLength(name, "utf8") <= 200) return name;
	return `--cwd-${createHash("sha256").update(resolvedCwd).digest("hex")}--`;
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
const path = require("node:path");
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
  secretToken: process.env.SECRET_TOKEN,
  allowedSecret: process.env.ALLOWED_SECRET_TOKEN,
  piCodingAgentDir: process.env.PI_CODING_AGENT_DIR,
  promptPath,
  taskPath,
  prompt: fs.readFileSync(promptPath, "utf8"),
  task: fs.readFileSync(taskPath, "utf8")
}, null, 2));
const allowedPaths = JSON.parse(process.env.PI_DELEGATE_ALLOWED_PATHS || "[]");
if (process.env.PI_FAKE_WRITER_MUTATION === "edit") fs.writeFileSync(allowedPaths[0], ${JSON.stringify("export const before = false;\n")}, "utf8");
if (process.env.PI_FAKE_WRITER_MUTATION === "create") fs.writeFileSync(allowedPaths[0], ${JSON.stringify("# Created\n\nhello\n")}, "utf8");
if (process.env.PI_FAKE_WRITER_MUTATION === "large") fs.writeFileSync(allowedPaths[0], "x".repeat(${WRITER_DIFF_MAX_FILE_BYTES} + 1), "utf8");
if (process.env.PI_FAKE_WRITER_MUTATION === "truncate-multi") {
  fs.writeFileSync(allowedPaths[0], Array.from({ length: 1000 }, (_, index) => "line " + index).join(String.fromCharCode(10)) + String.fromCharCode(10), "utf8");
  fs.writeFileSync(allowedPaths[1], ${JSON.stringify("export const second = false;\n")}, "utf8");
}
if (process.env.PI_FAKE_WRITER_MUTATION === "many") {
  allowedPaths.forEach((file, index) => fs.writeFileSync(file, "value " + index + String.fromCharCode(10), "utf8"));
}
if (process.env.PI_FAKE_WRITER_MUTATION === "outside") fs.writeFileSync(path.join(process.cwd(), "outside.ts"), "export const outside = true;\\n", "utf8");
if (process.env.PI_FAKE_WRITER_MUTATION === "outside-dirty") fs.writeFileSync(path.join(process.cwd(), "dirty.ts"), "export const dirty = false;\\n", "utf8");
if (process.env.PI_FAKE_WRITER_MUTATION === "ignored") fs.writeFileSync(path.join(process.cwd(), "ignored.env"), "IGNORED_VALUE=changed\\n", "utf8");
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
  secretToken: process.env.SECRET_TOKEN,
  allowedSecret: process.env.ALLOWED_SECRET_TOKEN,
  piCodingAgentDir: process.env.PI_CODING_AGENT_DIR,
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

function makeHangingReaderHarness(): {
	agentRoot: string;
	project: string;
	capturePath: string;
	fakePi: string;
} {
	const harness = makeFakeReaderHarness();
	writeExecutable(
		harness.fakePi,
		`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({ sessionDir: args[args.indexOf("--session-dir") + 1] }));
console.log(JSON.stringify({ type: "tool_execution_start" }));
setInterval(() => {}, 1000);
`,
	);
	return harness;
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

test("reader parameters keep the read-only public interface with explicit continuation fields", async () => {
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
			"continueSession",
			"sessionKey",
		]);
		assert.deepEqual(reader.parameters?.required, ["agent", "task"]);
		assert.equal(reader.parameters?.properties?.continueSession?.default, false);
		assert.match(reader.parameters?.properties?.sessionKey?.description ?? "", /Required when continueSession is true/);
	});
});

test("reader tool schema rejects writer-only parameters such as allowedPaths", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, () => {
		const [reader] = captureRegisteredTools();
		assert.equal(reader.parameters?.properties?.allowedPaths, undefined);
		assert.equal(reader.parameters?.additionalProperties, false);
	});
});

test("delegate catch-all failures redact details", async () => {
	await withEnv({ [DELEGATE_CHILD_MARKER]: undefined }, async () => {
		const reader = captureRegisteredTools().find((tool) => tool.name === "reader");
		const result: any = await reader?.execute?.("tool-call", { agent: "", task: "Fail" }, undefined, undefined, {
			cwd: "/tmp/SECRET_TOKEN=<fixture-secret>",
		});
		assert.ok(result);
		assert.doesNotMatch(result.content[0].text, /fixture-secret/);
		assert.doesNotMatch(result.details.cwd, /fixture-secret/);
		assert.match(result.details.cwd, /SECRET_TOKEN=<redacted>/);
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
		assert.equal(writer.parameters?.properties?.continueSession, undefined);
		assert.equal(writer.parameters?.properties?.sessionKey, undefined);
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
	assert.equal(readerProfile.sessionMode, "fresh");
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

test("delegate cwd overrides resolve relative to the tool default cwd", () => {
	const parent = makeTempDir("pi-delegates-parent-cwd-");
	const project = path.join(parent, "project");
	fs.mkdirSync(path.join(project, "src"), { recursive: true });
	fs.writeFileSync(path.join(project, "src", "app.ts"), "export const ok = true;\n", "utf8");

	const reader = normalizeReaderParams({ agent: "investigator", task: "Read", cwd: "project" }, parent);
	const writer = normalizeWriterParams({ agent: "implementer", task: "Write", cwd: "project", allowedPaths: ["src/app.ts"] }, parent);

	assert.equal(reader.cwd, fs.realpathSync(project));
	assert.equal(reader.continueSession, false);
	assert.equal(reader.sessionKey, undefined);
	assert.equal(writer.cwd, fs.realpathSync(project));
	assert.deepEqual(writer.allowedPaths, [fs.realpathSync(path.join(project, "src", "app.ts"))]);
});

test("reader continuation parameters normalize only for explicit named sessions", () => {
	const project = makeTempDir("pi-delegates-reader-continuation-params-");
	const freshDefault = normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project }, "/tmp/parent");
	assert.equal(freshDefault.continueSession, false);
	assert.equal(freshDefault.sessionKey, undefined);

	const freshExplicit = normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: false }, "/tmp/parent");
	assert.equal(freshExplicit.continueSession, false);
	assert.equal(freshExplicit.sessionKey, undefined);

	const continued = normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: true, sessionKey: "  auth  " }, "/tmp/parent");
	assert.equal(continued.continueSession, true);
	assert.equal(continued.sessionKey, "auth");

	assert.throws(
		() => normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: true }, "/tmp/parent"),
		/sessionKey is required when continueSession is true/,
	);
	assert.throws(
		() => normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: true, sessionKey: "   " }, "/tmp/parent"),
		/sessionKey must be a non-empty string/,
	);
	assert.throws(
		() => normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, sessionKey: "auth" }, "/tmp/parent"),
		/sessionKey requires continueSession to be true/,
	);
	assert.throws(
		() => normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: false, sessionKey: "auth" }, "/tmp/parent"),
		/sessionKey requires continueSession to be true/,
	);
	assert.throws(
		() => normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: "true" as any }, "/tmp/parent"),
		/continueSession must be a boolean/,
	);
	assert.throws(
		() => normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: true, sessionKey: 123 as any }, "/tmp/parent"),
		/sessionKey must be a string/,
	);
	assert.throws(
		() => normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: true, sessionKey: "API_KEY=abc" }, "/tmp/parent"),
		/sessionKey must not contain secret-looking key\/value material/,
	);
	for (const credentialLikeKey of [`ghp_${"a".repeat(20)}`, `github_pat_${"a".repeat(20)}`, `sk-${"a".repeat(8)}`]) {
		assert.throws(
			() => normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: true, sessionKey: credentialLikeKey }, "/tmp/parent"),
			/sessionKey must not contain secret-looking credential material/,
		);
	}
	assert.throws(
		() => normalizeReaderParams({ agent: "investigator", task: "Read", cwd: project, continueSession: true, sessionKey: "x".repeat(513) }, "/tmp/parent"),
		/sessionKey must be at most 512 characters/,
	);
});

test("delegate session directories use encoded collision-resistant cwd names", () => {
	assert.equal(getReaderSessionDir("/home/gc/.pi", "/agent-root"), path.join("/agent-root", "delegate-sessions", "reader", "--%2Fhome%2Fgc%2F.pi--"));
	assert.equal(getReaderSessionDir("/", "/agent-root"), path.join("/agent-root", "delegate-sessions", "reader", "--%2F--"));

	const hyphenatedParent = path.basename(getReaderSessionDir("/tmp/foo-bar/baz", "/agent-root"));
	const hyphenatedChild = path.basename(getReaderSessionDir("/tmp/foo/bar-baz", "/agent-root"));
	assert.notEqual(hyphenatedParent, hyphenatedChild);
	assert.equal(hyphenatedParent, "--%2Ftmp%2Ffoo-bar%2Fbaz--");
	assert.equal(hyphenatedChild, "--%2Ftmp%2Ffoo%2Fbar-baz--");
});

test("delegate session safe cwd names match reversible encoding across fuzzed paths", () => {
	let seed = 0x5eed_1234;
	const next = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed;
	};
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- :\\";
	const samples = ["/", "/home/gc/.pi", "/tmp/with spaces", "/tmp/colon:name", "/tmp/back\\slash"];
	for (let sampleIndex = 0; sampleIndex < 500; sampleIndex++) {
		const segmentCount = 1 + (next() % 8);
		const segments: string[] = [];
		for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
			const length = 1 + (next() % 18);
			let segment = "";
			for (let charIndex = 0; charIndex < length; charIndex++) segment += chars[next() % chars.length];
			segments.push(segment);
		}
		samples.push(`/${segments.join("/")}`);
	}

	for (const cwd of samples) {
		const expected = expectedCwdSessionDirName(cwd);
		for (const sessionDir of [getReaderSessionDir(cwd, "/agent-root"), getWriterSessionBaseDir(cwd, "/agent-root")]) {
			const actual = path.basename(sessionDir);
			assert.equal(actual, expected);
			assert.doesNotMatch(actual, /[\\/:]/);
			assert.equal(actual.startsWith("--"), true);
			assert.equal(actual.endsWith("--"), true);
			assert.ok(Buffer.byteLength(actual, "utf8") <= 200);
		}
	}
});

test("delegate session cwd names are hashed when a cwd is too long for one path segment", () => {
	const cwd = path.join("/", ...Array.from({ length: 40 }, (_, index) => `segment-${index}-${"x".repeat(24)}`));
	const expected = expectedCwdSessionDirName(cwd);
	assert.match(expected, /^--cwd-[a-f0-9]{64}--$/);
	assert.equal(cwdSessionDirName(cwd), expected);
	for (const sessionDir of [getReaderSessionDir(cwd, "/agent-root"), getWriterSessionBaseDir(cwd, "/agent-root")]) {
		const actual = path.basename(sessionDir);
		assert.equal(actual, expected);
		assert.ok(Buffer.byteLength(actual, "utf8") <= 200);
	}
});

test("continued reader session paths are keyed by cwd, agent, and session key", () => {
	const cwd = "/tmp/project:one";
	const continued = getContinuedReaderSessionDir(cwd, "docs researcher", "api v2/migration", "/agent-root");
	assert.equal(
		continued,
		path.join(
			"/agent-root",
			"delegate-sessions",
			"reader",
			expectedCwdSessionDirName(cwd),
			"continued",
			"--docs%20researcher--",
			"--api%20v2%2Fmigration--",
		),
	);
	assert.notEqual(getContinuedReaderSessionDir(cwd, "reviewer", "auth", "/agent-root"), getContinuedReaderSessionDir(cwd, "investigator", "auth", "/agent-root"));
	assert.notEqual(getContinuedReaderSessionDir(cwd, "reviewer", "auth", "/agent-root"), getContinuedReaderSessionDir(cwd, "reviewer", "style", "/agent-root"));
	assert.notEqual(getContinuedReaderSessionDir(cwd, "reviewer", "auth", "/agent-root"), getContinuedReaderSessionDir("/tmp/other", "reviewer", "auth", "/agent-root"));

	for (const value of ["with spaces", "slash/value", "colon:value", "unicode-漢字", "back\\slash"]) {
		for (const segment of [agentSessionDirName(value), sessionKeyDirName(value)]) {
			assert.doesNotMatch(segment, /[\\/:]/);
			assert.equal(segment.startsWith("--"), true);
			assert.equal(segment.endsWith("--"), true);
			assert.ok(Buffer.byteLength(segment, "utf8") <= 200);
		}
	}

	const longValue = "long-".repeat(80);
	assert.match(agentSessionDirName(longValue), /^--agent-[a-f0-9]{64}--$/);
	assert.match(sessionKeyDirName(longValue), /^--session-[a-f0-9]{64}--$/);
	assert.throws(() => sessionKeyDirName("   "), /session segment must be a non-empty string/);
});

test("writer strips Pi file-reference prefixes from allowed paths", () => {
	const project = makeTempDir("pi-delegates-at-paths-");
	fs.mkdirSync(path.join(project, "src"));
	const existing = path.join(project, "src", "app.ts");
	fs.writeFileSync(existing, "export const ok = true;\n", "utf8");

	const normalized = normalizeWriterParams(
		{ agent: "implementer", task: "Update exact files", cwd: project, allowedPaths: ["@src/app.ts"] },
		"/tmp/parent",
	);

	assert.deepEqual(normalized.allowedPaths, [fs.realpathSync(existing)]);
});

test("writer normalization deduplicates duplicate allowed paths before diff capture", () => {
	const project = makeTempDir("pi-delegates-duplicate-paths-");
	const filePath = path.join(project, "app.ts");
	fs.writeFileSync(filePath, "export const value = 1;\n", "utf8");
	const normalized = normalizeWriterParams(
		{ agent: "implementer", task: "Duplicate path scope", cwd: project, allowedPaths: ["app.ts", "./app.ts", filePath] },
		"/tmp/parent",
	);
	assert.deepEqual(normalized.allowedPaths, [fs.realpathSync(filePath)]);
});

test("reader invocation resolves defaults and overrides without exposing writer capability", () => {
	const cwd = makeTempDir("pi-delegates-reader-cwd-");
	const normalized = normalizeReaderParams({ agent: "investigator", task: "Map the auth flow", cwd }, "/tmp/parent-cwd");
	assert.deepEqual(normalized, {
		agent: "investigator",
		task: "Map the auth flow",
		cwd: fs.realpathSync(cwd),
		timeoutMs: DEFAULT_TIMEOUT_MS,
		maxResultBytes: DEFAULT_MAX_RESULT_BYTES,
		includeDiagnostics: false,
		continueSession: false,
	});
	assert.throws(
		() => normalizeReaderParams({ agent: "investigator", task: "Missing cwd", cwd: path.join(cwd, "missing") }, "/tmp/parent-cwd"),
		/cwd must resolve to an existing directory/,
	);

	assert.equal(resolveInvocation(normalized, [sampleAgent()]), "Fresh reader invocation requires an explicit sessionDir");
	const freshSessionDir = path.join(getFreshReaderSessionBaseDir(fs.realpathSync(cwd)), "run-test");
	const profileDefault = resolveInvocation(normalized, [sampleAgent()], freshSessionDir);
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
		"ctx_stats",
		"ctx_doctor",
		"context_mode_ctx_execute",
		"context_mode_ctx_execute_file",
		"context_mode_ctx_batch_execute",
		"context_mode_ctx_search",
		"context_mode_ctx_fetch_and_index",
		"context_mode_ctx_index",
		"context_mode_ctx_stats",
		"context_mode_ctx_doctor",
	]);
	assert.equal((profileDefault as any).sessionDir, freshSessionDir);
	assert.equal((profileDefault as any).sessionMode, "fresh");

	const continued = normalizeReaderParams({ agent: "investigator", task: "Continue", cwd, continueSession: true, sessionKey: "auth" }, "/tmp/parent-cwd");
	const continuedInvocation = resolveReaderInvocation(continued, [sampleAgent()], getContinuedReaderSessionDir(fs.realpathSync(cwd), "investigator", "auth"));
	assert.notEqual(typeof continuedInvocation, "string");
	assert.equal((continuedInvocation as any).sessionMode, "continued");
	assert.equal((continuedInvocation as any).sessionDir, getContinuedReaderSessionDir(fs.realpathSync(cwd), "investigator", "auth"));

	const agentOverride = resolveInvocation(normalized, [sampleAgent({ model: "model-agent", thinking: "high" })], freshSessionDir);
	assert.notEqual(typeof agentOverride, "string");
	assert.equal((agentOverride as any).model, "model-agent");
	assert.equal((agentOverride as any).thinking, "high");

	const callOverride = resolveInvocation(
		{ ...normalized, model: "model-call", thinking: "low" },
		[sampleAgent({ model: "model-agent", thinking: "high" })],
		freshSessionDir,
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
			assert.deepEqual(
				await guard({ toolName: "edit", input: { path: missing, edits: [{ oldText: "a".repeat(70_000), newText: "world\u0000" }] } }),
				{
					block: true,
					reason: "writer is text-only",
				},
			);
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
	assert.match(prompt, /Do not use recursive delegation tools/);
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
	assert.match(prompt, /Do not use recursive delegation tools/);
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
			PI_DELEGATE_INHERIT_ENV_KEYS: "CAPTURE_PATH,ALLOWED_SECRET_TOKEN",
			CAPTURE_PATH: harness.capturePath,
			SECRET_TOKEN: `ghp_${"1".repeat(36)}`,
			ALLOWED_SECRET_TOKEN: "allowed-for-test",
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Change the exported value only", cwd: harness.project, allowedPaths: ["src/app.ts"], timeoutMs: 5_000 },
				"/tmp/parent",
			);
			assert.equal(result.content[0].text, "Writer completed: no file changes detected.");
			assert.equal(result.details.agent, "implementer");
			assert.equal(result.details.model, "writer-child-model");
			assert.equal(result.details.status, "completed");

			const capture = JSON.parse(fs.readFileSync(harness.capturePath, "utf8"));
			assert.equal(capture.cwd, fs.realpathSync(harness.project));
			assert.equal(capture.childMarker, "1");
			assert.equal(capture.kind, "writer");
			assert.equal(capture.secretToken, undefined);
			assert.equal(capture.allowedSecret, "allowed-for-test");
			assert.equal(capture.piCodingAgentDir, harness.agentRoot);
			assert.deepEqual(JSON.parse(capture.allowedPaths), [fs.realpathSync(harness.allowedFile)]);
			assert.equal(capture.args.includes("--continue"), false);
			assert.deepEqual(capture.args.slice(0, 5), ["--mode", "json", "-p", "--session-dir", capture.args[4]]);
			assert.match(capture.args[4], /delegate-sessions\/writer/);
			assert.equal(path.basename(path.dirname(capture.args[4])), expectedCwdSessionDirName(fs.realpathSync(harness.project)));
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
			assert.equal(result.content[0].text, "Writer completed: no file changes detected.");
			assert.doesNotMatch(result.content[0].text, /launching|working|diff_ready|finishing/);
		},
	);

	assert.deepEqual(updates.map((update) => update.details?.phase).filter(Boolean), ["starting", "launching_subagent", "working", "diff_ready", "finishing"]);
	assert.deepEqual([...new Set(updates.map((update) => update.details?.tool))], ["writer"]);
	for (const update of updates) {
		assert.match(update.content?.[0]?.text ?? "", /^Writer /);
		assert.doesNotMatch(update.content?.[0]?.text ?? "", /Writer progress-safe final answer/);
	}
});

test("writer computes UI-only diff preview for modified allowed files", async () => {
	const harness = makeFakeWriterHarness("## Result\nChild summary should stay out of parent content");
	const updates: any[] = [];
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
			PI_FAKE_WRITER_MUTATION: "edit",
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Flip the exported value", cwd: harness.project, allowedPaths: ["src/app.ts"], timeoutMs: 5_000 },
				"/tmp/parent",
				undefined,
				(update: any) => updates.push(update),
			);
			assert.equal(result.content[0].text, "Writer completed: 1 file changed: modified src/app.ts.");
			assert.doesNotMatch(result.content[0].text, /Child summary|export const|^[-+]/m);
			assert.equal(result.details.changedFiles?.[0]?.status, "modified");
			assert.equal(result.details.changedFiles?.[0]?.additions, 1);
			assert.equal(result.details.changedFiles?.[0]?.deletions, 1);
			assert.match(result.details.diffPreview ?? "", /edit src\/app\.ts/);
			assert.match(result.details.diffPreview ?? "", /- export const before = true;/);
			assert.match(result.details.diffPreview ?? "", /\+ export const before = false;/);
		},
	);

	const diffUpdate = updates.find((update) => update.details?.phase === "diff_ready");
	assert.ok(diffUpdate);
	assert.match(diffUpdate.content?.[0]?.text ?? "", /Writer Diff Ready\.\.\.: 1 file changed/);
	assert.doesNotMatch(diffUpdate.content?.[0]?.text ?? "", /diff_ready/);
	assert.doesNotMatch(diffUpdate.content?.[0]?.text ?? "", /export const/);
	assert.match(diffUpdate.details?.diffPreview ?? "", /\+ export const before = false;/);
});

test("writer computes created-file diff previews for missing allowed files", async () => {
	const harness = makeFakeWriterHarness();
	fs.rmSync(harness.allowedFile);
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
			PI_FAKE_WRITER_MUTATION: "create",
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Create the allowed file", cwd: harness.project, allowedPaths: ["src/app.ts"], timeoutMs: 5_000 },
				"/tmp/parent",
			);
			assert.equal(result.content[0].text, "Writer completed: 1 file changed: created src/app.ts.");
			assert.equal(result.details.changedFiles?.[0]?.status, "created");
			assert.match(result.details.diffPreview ?? "", /write src\/app\.ts/);
			assert.match(result.details.diffPreview ?? "", /\+ # Created/);
		},
	);
});

test("writer reports outside-scope git changes as failures", async () => {
	const harness = makeFakeWriterHarness();
	cp.execFileSync("git", ["init"], { cwd: harness.project, stdio: "ignore" });
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
			PI_FAKE_WRITER_MUTATION: "outside",
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Stay in scope", cwd: harness.project, allowedPaths: ["src/app.ts"], timeoutMs: 5_000 },
				"/tmp/parent",
			);
			assert.equal(result.details.status, "failed");
			assert.match(result.content[0].text, /outside allowedPaths/);
			assert.match(result.content[0].text, /outside\.ts/);
			assert.match(result.details.error ?? "", /outside\.ts/);
		},
	);
});

test("writer reports edits to pre-existing dirty out-of-scope files", async () => {
	const harness = makeFakeWriterHarness();
	cp.execFileSync("git", ["init"], { cwd: harness.project, stdio: "ignore" });
	fs.writeFileSync(path.join(harness.project, "dirty.ts"), "export const dirty = true;\n", "utf8");
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
			PI_FAKE_WRITER_MUTATION: "outside-dirty",
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Stay in scope", cwd: harness.project, allowedPaths: ["src/app.ts"], timeoutMs: 5_000 },
				"/tmp/parent",
			);
			assert.equal(result.details.status, "failed");
			assert.match(result.content[0].text, /dirty\.ts/);
			assert.match(result.details.error ?? "", /dirty\.ts/);
		},
	);
});

test("writer reports ignored out-of-scope file changes", async () => {
	const harness = makeFakeWriterHarness();
	cp.execFileSync("git", ["init"], { cwd: harness.project, stdio: "ignore" });
	fs.writeFileSync(path.join(harness.project, ".gitignore"), "ignored.env\n", "utf8");
	cp.execFileSync("git", ["add", ".gitignore"], { cwd: harness.project, stdio: "ignore" });
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
			PI_FAKE_WRITER_MUTATION: "ignored",
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Stay in scope", cwd: harness.project, allowedPaths: ["src/app.ts"], timeoutMs: 5_000 },
				"/tmp/parent",
			);
			assert.equal(result.details.status, "failed");
			assert.match(result.content[0].text, /ignored\.env/);
			assert.match(result.details.error ?? "", /ignored\.env/);
		},
	);
});

test("writer skips oversized diff previews without putting file bodies in content", async () => {
	const harness = makeFakeWriterHarness();
	fs.rmSync(harness.allowedFile);
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
			PI_FAKE_WRITER_MUTATION: "large",
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Create a large file", cwd: harness.project, allowedPaths: ["src/app.ts"], timeoutMs: 5_000 },
				"/tmp/parent",
			);
			assert.equal(result.content[0].text, "Writer completed: 1 diff skipped.");
			assert.equal(result.details.changedFiles?.[0]?.status, "skipped");
			assert.match(result.details.changedFiles?.[0]?.reason ?? "", /file exceeds/);
			assert.match(result.details.diffPreview ?? "", /skip src\/app\.ts: file exceeds/);
			assert.doesNotMatch(result.content[0].text, /xxx/);
		},
	);
});

test("writer keeps full change accounting after diff preview truncates", async () => {
	const harness = makeFakeWriterHarness();
	const secondFile = path.join(harness.project, "src", "second.ts");
	fs.writeFileSync(secondFile, "export const second = true;\n", "utf8");
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
			PI_FAKE_WRITER_MUTATION: "truncate-multi",
		},
		async () => {
			const result = await runWriter(
				{
					agent: "implementer",
					task: "Change both allowed files",
					cwd: harness.project,
					allowedPaths: ["src/app.ts", "src/second.ts"],
					timeoutMs: 5_000,
				},
				"/tmp/parent",
			);
			assert.equal(result.content[0].text, "Writer completed: 2 files changed: modified src/app.ts, modified src/second.ts.");
			assert.equal(result.details.changedFileCount, 2);
			assert.equal(result.details.changedFiles?.length, 2);
			assert.deepEqual(result.details.changedFiles?.map((file) => file.path), ["src/app.ts", "src/second.ts"]);
			assert.equal(result.details.diffTruncated, true);
			assert.match(result.details.diffPreview ?? "", /writer diff preview truncated/);
		},
	);
});

test("writer bounds changed file details while preserving total changed count", async () => {
	const harness = makeFakeWriterHarness();
	fs.rmSync(harness.allowedFile);
	const updates: any[] = [];
	const relativePaths = Array.from({ length: WRITER_DIFF_MAX_CHANGED_FILES + 5 }, (_, index) => `src/many-${index}.txt`);
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
			PI_FAKE_WRITER_MUTATION: "many",
		},
		async () => {
			const result = await runWriter(
				{ agent: "implementer", task: "Create many files", cwd: harness.project, allowedPaths: relativePaths, timeoutMs: 5_000 },
				"/tmp/parent",
				undefined,
				(update: any) => updates.push(update),
			);
			assert.equal(result.details.changedFileCount, WRITER_DIFF_MAX_CHANGED_FILES + 5);
			assert.equal(result.details.changedFiles?.length, WRITER_DIFF_MAX_CHANGED_FILES);
			assert.equal(result.details.changedFilesTruncated, true);
			assert.match(result.content[0].text, new RegExp(`${WRITER_DIFF_MAX_CHANGED_FILES + 5} files changed`));
			assert.match(result.content[0].text, new RegExp(`and ${WRITER_DIFF_MAX_CHANGED_FILES} more`));
			const diffUpdate = updates.find((update) => update.details?.phase === "diff_ready");
			assert.equal(diffUpdate?.details?.changedFileCount, WRITER_DIFF_MAX_CHANGED_FILES + 5);
			assert.equal(diffUpdate?.details?.changedFiles?.length, WRITER_DIFF_MAX_CHANGED_FILES);
			assert.equal(diffUpdate?.details?.changedFilesTruncated, true);
		},
	);
});

test("writer snapshot order stays deterministic above snapshot concurrency", async () => {
	const project = makeTempDir("pi-delegates-snapshot-order-");
	const filePaths = Array.from({ length: 12 }, (_, index) => path.join(project, `ordered-${index}.txt`));
	for (const filePath of filePaths) fs.writeFileSync(filePath, `${path.basename(filePath)}\n`, "utf8");
	const snapshots = await captureWriterFileSnapshots(filePaths, project);
	assert.deepEqual(snapshots.map((snapshot) => snapshot.displayPath), filePaths.map((filePath) => path.basename(filePath)));
});

test("writer diff LCS fallback remains bounded for very large changed regions", async () => {
	const project = makeTempDir("pi-delegates-lcs-fallback-");
	const filePath = path.join(project, "large.txt");
	const oldLines = ["prefix", ...Array.from({ length: 2050 }, (_, index) => (index % 2 === 0 ? `old-${index}` : `shared-${index}`)), "suffix"];
	const newLines = ["prefix", ...Array.from({ length: 2050 }, (_, index) => (index % 2 === 0 ? `new-${index}` : `shared-${index}`)), "suffix"];
	fs.writeFileSync(filePath, `${oldLines.join("\n")}\n`, "utf8");
	const before = await captureWriterFileSnapshots([filePath], project);
	fs.writeFileSync(filePath, `${newLines.join("\n")}\n`, "utf8");
	const diff = await buildWriterDiffPreview(before, [filePath], project);
	assert.equal(diff.changedFiles[0].status, "modified");
	assert.equal(diff.changedFiles[0].additions, 2049);
	assert.equal(diff.changedFiles[0].deletions, 2049);
	assert.equal(diff.diffTruncated, true);
	assert.ok(diff.diffPreview.split("\n").length <= WRITER_DIFF_MAX_PREVIEW_LINES);
	assert.match(diff.diffPreview, /writer diff preview truncated/);
});

test("writer diff counts separated edits without treating unchanged middle lines as changed", async () => {
	const project = makeTempDir("pi-delegates-separated-diff-");
	const filePath = path.join(project, "sample.txt");
	fs.writeFileSync(filePath, "a\nb-old\nc\nd\ne\nf-old\ng\n", "utf8");
	const before = await captureWriterFileSnapshots([filePath], project);
	fs.writeFileSync(filePath, "a\nb-new\nc\nd\ne\nf-new\ng\n", "utf8");
	const diff = await buildWriterDiffPreview(before, [filePath], project);
	assert.equal(diff.changedFiles[0].additions, 2);
	assert.equal(diff.changedFiles[0].deletions, 2);
	assert.match(diff.diffPreview, /- b-old/);
	assert.match(diff.diffPreview, /\+ b-new/);
	assert.match(diff.diffPreview, /- f-old/);
	assert.match(diff.diffPreview, /\+ f-new/);
	assert.doesNotMatch(diff.diffPreview, /- c/);
	assert.doesNotMatch(diff.diffPreview, /\+ c/);
	assert.doesNotMatch(diff.diffPreview, /- d/);
	assert.doesNotMatch(diff.diffPreview, /\+ d/);
});

test("writer diff redacts secret-looking relative paths in summaries and details", async () => {
	const project = makeTempDir("pi-delegates-secret-path-");
	const redactionFixtureDir = path.join(project, "SECRET_TOKEN=<fixture-secret>");
	fs.mkdirSync(redactionFixtureDir);
	const filePath = path.join(redactionFixtureDir, "app.txt");
	fs.writeFileSync(filePath, "old\n", "utf8");
	const before = await captureWriterFileSnapshots([filePath], project);
	fs.writeFileSync(filePath, "new\n", "utf8");
	const diff = await buildWriterDiffPreview(before, [filePath], project);
	assert.doesNotMatch(diff.changedFiles[0].path, /fixture-secret/);
	assert.doesNotMatch(diff.diffPreview, /fixture-secret/);
	assert.match(diff.changedFiles[0].path, /SECRET_TOKEN=<redacted>/);
});

test("redaction covers common bare provider tokens and quoted secret values", () => {
	const githubClassic = `ghp_${"1".repeat(36)}`;
	const githubFineGrained = `github_pat_${"2".repeat(36)}`;
	const googleKey = `AIza${"A".repeat(32)}`;
	const slackToken = `xoxb-${"1".repeat(12)}-${"2".repeat(12)}-${"a".repeat(16)}`;
	const npmToken = `npm_${"3".repeat(32)}`;
	const redacted = redactSensitiveText(
		`github=${githubClassic} fine=${githubFineGrained} google=${googleKey} slack=${slackToken} npm=${npmToken} {"apiKey":"${googleKey}"}`,
	);
	assert.doesNotMatch(redacted, new RegExp(githubClassic));
	assert.doesNotMatch(redacted, new RegExp(githubFineGrained));
	assert.doesNotMatch(redacted, new RegExp(googleKey));
	assert.doesNotMatch(redacted, new RegExp(slackToken));
	assert.doesNotMatch(redacted, new RegExp(npmToken));
	assert.match(redacted, /<redacted>/);
});

test("writer diff details prioritize changed files over unchanged allowed paths", async () => {
	const project = makeTempDir("pi-delegates-detail-priority-");
	const filePaths = Array.from({ length: WRITER_DIFF_MAX_CHANGED_FILES + 5 }, (_, index) => path.join(project, `file-${index}.txt`));
	for (const filePath of filePaths) fs.writeFileSync(filePath, "same\n", "utf8");
	const before = await captureWriterFileSnapshots(filePaths, project);
	fs.writeFileSync(filePaths[filePaths.length - 1], "changed\n", "utf8");
	const diff = await buildWriterDiffPreview(before, filePaths, project);
	const details = writerDiffDetailFields(diff);
	assert.equal(details.changedFileCount, 1);
	assert.equal(details.changedFilesTruncated, false);
	assert.deepEqual(details.changedFiles?.map((file) => file.path), [`file-${WRITER_DIFF_MAX_CHANGED_FILES + 4}.txt`]);
});

test("writer snapshot degrades to skipped diff when file read fails after stat", async () => {
	const project = makeTempDir("pi-delegates-read-race-");
	const filePath = path.join(project, "race.txt");
	fs.writeFileSync(filePath, "old\n", "utf8");
	const originalOpen = fs.promises.open;
	try {
		(fs.promises as any).open = async () => {
			const error = new Error("forced read failure") as NodeJS.ErrnoException;
			error.code = "EACCES";
			throw error;
		};
		const snapshots = await captureWriterFileSnapshots([filePath], project);
		assert.equal(snapshots[0].exists, true);
		assert.equal(snapshots[0].skipReason, "read failed");
	} finally {
		(fs.promises as any).open = originalOpen;
	}
});

test("reader launches Pi in fresh mode by default with read-only tools and disposable session files", async () => {
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
  sessionDir: args[args.indexOf("--session-dir") + 1],
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
			assert.equal(result.details.sessionMode, "fresh");
			assert.equal(result.details.continueSession, false);
			assert.equal(result.details.sessionPreserved, false);

			const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
			assert.equal(capture.cwd, project);
			assert.equal(capture.childMarker, "1");
			assert.equal(capture.kind, "reader");
			assert.deepEqual(capture.args.slice(0, 5), ["--mode", "json", "-p", "--session-dir", capture.sessionDir]);
			assert.equal(capture.args.includes("--continue"), false);
			assert.equal(path.dirname(capture.sessionDir), getFreshReaderSessionBaseDir(project));
			assert.match(path.basename(capture.sessionDir), /^run-/);
			assert.equal(capture.args[capture.args.indexOf("--model") + 1], DEFAULT_READER_MODEL);
			assert.equal(capture.args[capture.args.indexOf("--thinking") + 1], DEFAULT_THINKING);
			assert.match(capture.args[capture.args.indexOf("--tools") + 1], /ctx_execute/);
			assert.match(capture.prompt, /# Reader Delegate Boundary/);
			assert.match(capture.task, /Inspect auth/);
			assert.equal(fs.existsSync(capture.promptPath), false);
			assert.equal(fs.existsSync(capture.taskPath), false);
			assert.equal(fs.existsSync(capture.sessionDir), false);
		},
	);
});

test("reader continues only explicit named sessions and releases the continued-session lock", async () => {
	const harness = makeFakeReaderHarness("## Result\nContinued");
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
		},
		async () => {
			const result = await runReader(
				{ agent: "investigator", task: "Continue auth", cwd: harness.project, continueSession: true, sessionKey: "auth", timeoutMs: 5_000 },
				"/tmp/parent",
			);
			assert.equal(result.content[0].text, "## Result\nContinued");
			assert.equal(result.details.sessionMode, "continued");
			assert.equal(result.details.continueSession, true);
			assert.equal(result.details.sessionKey, "<redacted>");

			const capture = JSON.parse(fs.readFileSync(harness.capturePath, "utf8"));
			const sessionDir = capture.args[capture.args.indexOf("--session-dir") + 1];
			assert.equal(sessionDir, getContinuedReaderSessionDir(harness.project, "investigator", "auth"));
			assert.equal(capture.args.includes("--continue"), true);
			assert.equal(fs.existsSync(sessionDir), true);
			assert.equal(fs.existsSync(path.join(sessionDir, ".delegate-lock")), false);
		},
	);
});

test("reader rejects concurrent continued sessions with an existing lock", async () => {
	const harness = makeFakeReaderHarness("## Result\nShould not run");
	const sessionDir = getContinuedReaderSessionDir(harness.project, "investigator", "auth", harness.agentRoot);
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(path.join(sessionDir, ".delegate-lock"), "{bad json", "utf8");
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
		},
		async () => {
			const result = await runReader(
				{ agent: "investigator", task: "Continue auth", cwd: harness.project, continueSession: true, sessionKey: "auth", timeoutMs: 5_000 },
				"/tmp/parent",
			);
			assert.equal(result.details.status, "failed");
			assert.equal(result.details.sessionMode, "continued");
			assert.equal(result.details.sessionKey, "<redacted>");
			assert.match(result.content[0].text, /reader continued session is already running for this sessionKey/);
			assert.doesNotMatch(result.content[0].text, /auth/);
			assert.equal(fs.existsSync(path.join(sessionDir, ".delegate-lock")), true);
			assert.equal(fs.existsSync(harness.capturePath), false);
		},
	);
});

test("reader continued sessions preserve session dir and release lock after child failure", async () => {
	const agentRoot = makeTempDir("pi-delegates-agent-root-");
	const project = makeTempDir("pi-delegates-continued-failure-");
	const fakePi = path.join(makeTempDir("pi-delegates-bin-"), "fake-pi.cjs");
	const capturePath = path.join(makeTempDir("pi-delegates-capture-"), "capture.json");
	writeAgent(agentRoot, "investigator", `---\nname: investigator\n---\nInvestigate.`);
	writeExecutable(
		fakePi,
		`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({ sessionDir: args[args.indexOf("--session-dir") + 1] }));
process.exit(2);
`,
	);

	await withEnv({ PI_CODING_AGENT_DIR: agentRoot, PI_DELEGATE_BIN: fakePi, CAPTURE_PATH: capturePath }, async () => {
		const result = await runReader(
			{ agent: "investigator", task: "Continue and fail", cwd: project, continueSession: true, sessionKey: "auth", timeoutMs: 5_000 },
			"/tmp/parent",
		);
		const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
		assert.equal(result.details.status, "failed");
		assert.equal(result.details.sessionMode, "continued");
		assert.equal(fs.existsSync(capture.sessionDir), true);
		assert.equal(fs.existsSync(path.join(capture.sessionDir, ".delegate-lock")), false);
	});
});

test("reader continued sessions preserve session dir and release lock after timeout and abort", async () => {
	for (const scenario of ["timeout", "aborted"] as const) {
		const harness = makeHangingReaderHarness();
		await withEnv(
			{
				PI_CODING_AGENT_DIR: harness.agentRoot,
				PI_DELEGATE_BIN: harness.fakePi,
				CAPTURE_PATH: harness.capturePath,
			},
			async () => {
				const controller = scenario === "aborted" ? new AbortController() : undefined;
				if (controller) setTimeout(() => controller.abort(), 100);
				const result = await runReader(
					{
						agent: "investigator",
						task: `Continue and ${scenario}`,
						cwd: harness.project,
						continueSession: true,
						sessionKey: scenario,
						timeoutMs: scenario === "timeout" ? 1_000 : 5_000,
						includeDiagnostics: true,
					},
					"/tmp/parent",
					controller?.signal,
				);
				const capture = JSON.parse(fs.readFileSync(harness.capturePath, "utf8"));
				assert.equal(result.details.status, scenario);
				assert.equal(result.details.sessionMode, "continued");
				assert.equal(fs.existsSync(capture.sessionDir), true);
				assert.equal(fs.existsSync(path.join(capture.sessionDir, ".delegate-lock")), false);
			},
		);
	}
});

test("continued reader lock write failure removes half-acquired lock", async () => {
	const sessionDir = makeTempDir("pi-delegates-lock-write-failure-");
	const lockPath = path.join(sessionDir, ".delegate-lock");
	const originalOpen = fs.promises.open;
	(fs.promises as any).open = async (filePath: string, flags: string) => {
		const handle = await originalOpen.call(fs.promises, filePath, flags as never);
		if (filePath !== lockPath) return handle;
		return {
			async writeFile() {
				throw new Error("simulated lock write failure");
			},
			async close() {
				await handle.close();
			},
		};
	};
	try {
		await assert.rejects(() => acquireContinuedReaderSessionLock(sessionDir, { pid: process.pid }), /simulated lock write failure/);
		assert.equal(fs.existsSync(lockPath), false);
	} finally {
		(fs.promises as any).open = originalOpen;
	}
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
			assert.doesNotMatch(result.content[0].text, /launching|working|finishing/);
		},
	);

	const phases = updates.map((update) => update.details?.phase).filter(Boolean);
	assert.deepEqual(phases, ["starting", "launching_subagent", "working", "finishing"]);
	for (const update of updates) {
		const text = update.content?.[0]?.text ?? "";
		assert.doesNotMatch(text, /Progress-safe final answer/);
	}
});
test("reader keeps oversized JSON event lines", async () => {
	const finalText = `## Result\n${"x".repeat(140_000)}`;
	const harness = makeFakeReaderHarness(finalText);
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
		},
		async () => {
			const result = await runReader(
				{ agent: "investigator", task: "Inspect large event", cwd: harness.project, timeoutMs: 5_000, maxResultBytes: 200_000 },
				"/tmp/parent",
			);
			assert.equal(result.details.status, "completed");
			assert.equal(result.content[0].text, finalText);
			assert.equal(result.details.truncated, false);
		},
	);
});

test("reader truncates maxResultBytes as UTF-8 bytes for multibyte output", async () => {
	const harness = makeFakeReaderHarness(`## Result\n${"漢".repeat(600)}`);
	await withEnv(
		{
			PI_CODING_AGENT_DIR: harness.agentRoot,
			PI_DELEGATE_BIN: harness.fakePi,
			CAPTURE_PATH: harness.capturePath,
		},
		async () => {
			const result = await runReader(
				{ agent: "investigator", task: "Inspect multibyte", cwd: harness.project, timeoutMs: 5_000, maxResultBytes: 1_000 },
				"/tmp/parent",
			);
			assert.equal(result.details.truncated, true);
			assert.ok(Buffer.byteLength(result.content[0].text, "utf8") <= 1_000);
			assert.match(result.content[0].text, /truncated child result to 1000 bytes/);
		},
	);
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
			assert.match(result.content[0].text, /truncated child result to 1000 bytes/);
			assert.equal(result.details.truncated, true);
			assert.deepEqual(Object.keys(result.details).sort(), [
				"agent",
				"continueSession",
				"cwd",
				"durationMs",
				"exitCode",
				"model",
				"sessionMode",
				"sessionPreserved",
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

test("reader fresh sessions are preserved on failure only when diagnostics are requested", async () => {
	const agentRoot = makeTempDir("pi-delegates-agent-root-");
	const project = makeTempDir("pi-delegates-reader-diagnostics-");
	const fakePi = path.join(makeTempDir("pi-delegates-bin-"), "fake-pi.cjs");
	const capturePath = path.join(makeTempDir("pi-delegates-capture-"), "capture.json");
	writeAgent(agentRoot, "investigator", `---\nname: investigator\n---\nInvestigate.`);
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
		const withoutDiagnostics = await runReader({ agent: "investigator", task: "Fail safely", cwd: project, timeoutMs: 5_000 }, "/tmp/parent");
		const firstCapture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
		assert.equal(withoutDiagnostics.details.status, "failed");
		assert.equal(withoutDiagnostics.details.sessionMode, "fresh");
		assert.equal(withoutDiagnostics.details.continueSession, false);
		assert.equal(withoutDiagnostics.details.sessionPreserved, false);
		assert.equal(withoutDiagnostics.details.diagnosticSessionDir, undefined);
		assert.equal(fs.existsSync(firstCapture.sessionDir), false);

		const withDiagnostics = await runReader(
			{ agent: "investigator", task: "Fail with diagnostics", cwd: project, timeoutMs: 5_000, includeDiagnostics: true },
			"/tmp/parent",
		);
		const secondCapture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
		assert.equal(withDiagnostics.details.status, "failed");
		assert.equal(withDiagnostics.details.sessionMode, "fresh");
		assert.equal(withDiagnostics.details.sessionPreserved, true);
		assert.equal(withDiagnostics.details.diagnosticSessionDir, secondCapture.sessionDir);
		assert.match(withDiagnostics.content[0].text, /SECRET_TOKEN=<redacted>/);
		assert.doesNotMatch(withDiagnostics.content[0].text, /<fixture-secret>/);
		assert.equal(fs.existsSync(secondCapture.sessionDir), true);
	});
});

test("reader fresh timeout and abort preserve diagnostic sessions", async () => {
	for (const scenario of ["timeout", "aborted"] as const) {
		const harness = makeHangingReaderHarness();
		await withEnv(
			{
				PI_CODING_AGENT_DIR: harness.agentRoot,
				PI_DELEGATE_BIN: harness.fakePi,
				CAPTURE_PATH: harness.capturePath,
			},
			async () => {
				const controller = scenario === "aborted" ? new AbortController() : undefined;
				if (controller) setTimeout(() => controller.abort(), 100);
				const result = await runReader(
					{
						agent: "investigator",
						task: `Fresh ${scenario}`,
						cwd: harness.project,
						timeoutMs: scenario === "timeout" ? 1_000 : 5_000,
						includeDiagnostics: true,
					},
					"/tmp/parent",
					controller?.signal,
				);
				const capture = JSON.parse(fs.readFileSync(harness.capturePath, "utf8"));
				assert.equal(result.details.status, scenario);
				assert.equal(result.details.sessionMode, "fresh");
				assert.equal(result.details.sessionPreserved, true);
				assert.equal(result.details.diagnosticSessionDir, capture.sessionDir);
				assert.equal(fs.existsSync(capture.sessionDir), true);
			},
		);
	}
});

test("reader fresh early failures clean up or preserve sessions by diagnostics policy", async () => {
	const agentRoot = makeTempDir("pi-delegates-agent-root-");
	writeAgent(agentRoot, "investigator", `---\nname: investigator\n---\nInvestigate.`);

	await withEnv({ PI_CODING_AGENT_DIR: agentRoot }, async () => {
		const project = makeTempDir("pi-delegates-unknown-agent-");
		const baseDir = getFreshReaderSessionBaseDir(project, agentRoot);
		const result = await runReader({ agent: "missing", task: "Unknown", cwd: project, timeoutMs: 5_000 }, "/tmp/parent");
		const runDirs = fs.existsSync(baseDir) ? fs.readdirSync(baseDir).filter((name) => name.startsWith("run-")) : [];
		assert.equal(result.details.status, "failed");
		assert.equal(result.details.sessionMode, "fresh");
		assert.equal(runDirs.length, 0);
	});

	const tempFile = path.join(makeTempDir("pi-delegates-temp-file-"), "not-a-dir");
	const tempFailureProject = makeTempDir("pi-delegates-temp-failure-");
	fs.writeFileSync(tempFile, "not a directory", "utf8");
	await withEnv({ PI_CODING_AGENT_DIR: agentRoot, TMPDIR: tempFile }, async () => {
		const baseDir = getFreshReaderSessionBaseDir(tempFailureProject, agentRoot);
		await assert.rejects(
			() => runReader({ agent: "investigator", task: "Temp failure", cwd: tempFailureProject, timeoutMs: 5_000 }, "/tmp/parent"),
			/ENOTDIR|not a directory/i,
		);
		const runDirs = fs.existsSync(baseDir) ? fs.readdirSync(baseDir).filter((name) => name.startsWith("run-")) : [];
		assert.equal(runDirs.length, 0);
	});

	await withEnv({ PI_CODING_AGENT_DIR: agentRoot, PI_DELEGATE_BIN: path.join(makeTempDir("pi-delegates-missing-bin-"), "missing-pi") }, async () => {
		const project = makeTempDir("pi-delegates-spawn-failure-");
		const baseDir = getFreshReaderSessionBaseDir(project, agentRoot);
		const withoutDiagnostics = await runReader({ agent: "investigator", task: "Spawn fail", cwd: project, timeoutMs: 5_000 }, "/tmp/parent");
		const runDirs = fs.existsSync(baseDir) ? fs.readdirSync(baseDir).filter((name) => name.startsWith("run-")) : [];
		assert.equal(withoutDiagnostics.details.status, "failed");
		assert.equal(withoutDiagnostics.details.sessionPreserved, false);
		assert.equal(runDirs.length, 0);
	});

	await withEnv({ PI_CODING_AGENT_DIR: agentRoot, PI_DELEGATE_BIN: path.join(makeTempDir("pi-delegates-missing-bin-"), "missing-pi") }, async () => {
		const project = makeTempDir("pi-delegates-spawn-diagnostics-");
		const withDiagnostics = await runReader(
			{ agent: "investigator", task: "Spawn fail", cwd: project, timeoutMs: 5_000, includeDiagnostics: true },
			"/tmp/parent",
		);
		assert.equal(withDiagnostics.details.status, "failed");
		assert.equal(withDiagnostics.details.sessionPreserved, true);
		assert.ok(withDiagnostics.details.diagnosticSessionDir);
		assert.equal(fs.existsSync(withDiagnostics.details.diagnosticSessionDir), true);
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
test("writer custom renderers emphasize agent labels and hide raw child stdout or stderr", async () => {
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
		const renderedCall = call.render(120).join("\n");
		assert.match(renderedCall, /Implementer ○ Change exact file/);
		assert.doesNotMatch(renderedCall, /writer implementer/);

		const resultPayload = {
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
				changedFiles: [
					{ path: "src/new.ts", status: "created", oldSize: null, newSize: 1, additions: 1, deletions: 0 },
					{ path: "src/app.ts", status: "modified", oldSize: 1, newSize: 1, additions: 1, deletions: 1 },
					{ path: "src/old.ts", status: "deleted", oldSize: 1, newSize: null, additions: 0, deletions: 1 },
					{ path: "src/large.bin", status: "skipped", oldSize: 1024, newSize: 1024, additions: 0, deletions: 0, reason: "file exceeds max diff size" },
				],
				changedFileCount: 3,
				skippedDiffCount: 1,
				diffPreview: "edit src/app.ts\n- old\n+ new",
				diffTruncated: false,
				stderrTail: "SECRET_TOKEN=<fixture-secret>",
			},
		};
		const collapsed = writer.renderResult(resultPayload, { expanded: false, isPartial: false } as any, theme as any, context as any);
		const collapsedRendered = collapsed.render(120).join("\n");
		assert.doesNotMatch(collapsedRendered, /Implementer/);
		assert.match(collapsedRendered, /󰸞 Completed/);
		assert.doesNotMatch(collapsedRendered, /writer completed/);
		assert.match(collapsedRendered, /edit src\/app\.ts/);
		assert.match(collapsedRendered, /\+ new/);
		assert.doesNotMatch(collapsedRendered, /tools: 2/);
		assert.doesNotMatch(collapsedRendered, /raw writer final summary/);

		const partial = writer.renderResult(
			{ ...resultPayload, details: { ...resultPayload.details, phase: "launching_subagent" } },
			{ expanded: false, isPartial: true } as any,
			theme as any,
			context as any,
		);
		const partialRendered = partial.render(120).join("\n");
		assert.match(partialRendered, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Launching Subagent\.\.\./);
		assert.doesNotMatch(partialRendered, /Implementer Launching Subagent/);
		assert.doesNotMatch(partialRendered, /writer launching subagent/);
		assert.doesNotMatch(partialRendered, /launching_subagent/);

		const result = writer.renderResult(resultPayload, { expanded: true, isPartial: false } as any, theme as any, context as any);
		const rendered = result.render(120).join("\n");
		assert.doesNotMatch(rendered, /Implementer/);
		assert.match(rendered, /󰸞 Completed/);
		assert.doesNotMatch(rendered, /writer completed/);
		assert.match(rendered, /tools: 2/);
		assert.match(rendered, /󰝒 Created/);
		assert.match(rendered, /src\/new\.ts/);
		assert.match(rendered, /󰷈 Modified/);
		assert.match(rendered, /src\/app\.ts/);
		assert.match(rendered, /󰩹 Deleted/);
		assert.match(rendered, /src\/old\.ts/);
		assert.match(rendered, /󰒭 Skipped/);
		assert.match(rendered, /src\/large\.bin \(file exceeds max diff size\)/);
		assert.match(rendered, /edit src\/app\.ts/);
		assert.match(rendered, /\+ new/);
		assert.doesNotMatch(rendered, /SECRET_TOKEN/);
		assert.doesNotMatch(rendered, /raw writer final summary/);
	});
});

test("partial loading renderer stores spinner state and avoids untracked intervals", () => {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	let nextTimerId = 0;
	let clearCount = 0;
	const activeTimers = new Set<number>();
	(globalThis as any).setInterval = () => {
		const id = ++nextTimerId;
		activeTimers.add(id);
		return { id, unref() {} };
	};
	(globalThis as any).clearInterval = (timer: { id?: number } | undefined) => {
		clearCount += 1;
		if (timer?.id) activeTimers.delete(timer.id);
	};
	try {
		const theme = {
			fg(_name: string, text: string) {
				return text;
			},
			bold(text: string) {
				return text;
			},
		};
		const partialPayload = {
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
				phase: "working",
			},
		};

		const stateless = renderDelegateResult(partialPayload, { expanded: false, isPartial: true } as any, theme as any, undefined as any);
		assert.match(stateless.render(120).join("\n"), /Working\.\.\./);
		assert.equal(nextTimerId, 0);

		const context: any = { cwd: "/tmp/project" };
		const first = renderDelegateResult(partialPayload, { expanded: false, isPartial: true } as any, theme as any, context);
		const second = renderDelegateResult(partialPayload, { expanded: false, isPartial: true } as any, theme as any, context);
		assert.equal(first, second);
		assert.equal(typeof context.state, "object");
		assert.equal(nextTimerId, 1);
		assert.equal(activeTimers.size, 1);

		renderDelegateResult(
			{ ...partialPayload, details: { ...partialPayload.details, phase: undefined } },
			{ expanded: false, isPartial: false } as any,
			theme as any,
			context,
		);
		assert.equal(clearCount, 1);
		assert.equal(activeTimers.size, 0);
		assert.equal(context.state.delegateLoadingText, undefined);
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
});

test("custom status colors fall back to theme colors for non-ANSI renderers", () => {
	const theme = {
		fg(name: string, text: string) {
			return `[${name}]${text}[/${name}]`;
		},
		bold(text: string) {
			return text;
		},
	};
	const context = { state: {}, cwd: "/tmp/project" };

	const aborted = renderDelegateResult(
		{
			content: [{ type: "text", text: "raw child final summary" }],
			details: {
				agent: "investigator",
				model: "child-model",
				thinking: "medium",
				cwd: "/tmp/project",
				status: "aborted",
				exitCode: 1,
				durationMs: 42,
				toolCallCount: 2,
				truncated: false,
			},
		},
		{ expanded: false, isPartial: false } as any,
		theme as any,
		context as any,
	);
	const abortedRendered = aborted.render(120).join("\n");
	assert.doesNotMatch(abortedRendered, /\x1b\[/);
	assert.match(abortedRendered, /\[warning\]󰅖 Aborted\[\/warning\]/);

	const writer = captureRegisteredTools().find((tool) => tool.name === "writer");
	assert.ok(writer?.renderResult);
	const modified = writer.renderResult(
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
				changedFiles: [{ path: "src/app.ts", status: "modified", oldSize: 1, newSize: 1, additions: 1, deletions: 1 }],
				changedFileCount: 1,
				skippedDiffCount: 0,
			},
		},
		{ expanded: true, isPartial: false } as any,
		theme as any,
		context as any,
	);
	const modifiedRendered = modified.render(120).join("\n");
	assert.doesNotMatch(modifiedRendered, /\x1b\[/);
	assert.match(modifiedRendered, /\[accent\]󰷈 Modified\[\/accent\]/);
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
	const renderedCall = call.render(120).join("\n");
	assert.match(renderedCall, /Investigator ○ Inspect with noisy whitespace/);
	assert.doesNotMatch(renderedCall, /reader investigator/);

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
	assert.doesNotMatch(rendered, /Investigator/);
	assert.match(rendered, /󰸞 Completed/);
	assert.doesNotMatch(rendered, /reader completed/);
	assert.match(rendered, /tools: 2/);
	assert.doesNotMatch(rendered, /SECRET_TOKEN/);
	assert.doesNotMatch(rendered, /raw child final summary/);
});

test("reader call renderer marks continued sessions with filled dot", () => {
	const theme = {
		fg(_name: string, text: string) {
			return text;
		},
		bold(text: string) {
			return text;
		},
	};
	const context = { state: {}, cwd: "/tmp/project" };

	const call = renderDelegateCall(
		{
			agent: "investigator",
			task: "Continue delegate indicator investigation",
			continueSession: true,
			sessionKey: "demo",
		},
		theme as any,
		context as any,
	);

	const renderedCall = call.render(120).join("\n");
	assert.match(renderedCall, /Investigator ● Continue delegate indicator investigation/);
	assert.doesNotMatch(renderedCall, /demo/);
	assert.doesNotMatch(renderedCall, /sessionKey/);
});

test("delegate final status renderer uses selected icons", () => {
	const theme = {
		fg(_name: string, text: string) {
			return text;
		},
		bold(text: string) {
			return text;
		},
	};
	const statuses = [
		["completed", "󰸞 Completed"],
		["timeout", "󰔟 Timeout"],
		["aborted", "󰅖 Aborted"],
		["failed", "󰅙 Failed"],
	] as const;

	for (const [status, expected] of statuses) {
		const result = renderDelegateResult(
			{
				content: [{ type: "text", text: "raw child final summary" }],
				details: {
					agent: "investigator",
					model: "child-model",
					thinking: "medium",
					cwd: "/tmp/project",
					status,
					exitCode: status === "completed" ? 0 : 1,
					durationMs: 42,
					toolCallCount: 2,
					truncated: false,
				},
			},
			{ expanded: false, isPartial: false } as any,
			theme as any,
			{ state: {}, cwd: "/tmp/project" } as any,
		);
		const rendered = result.render(120).join("\n");
		assert.ok(!rendered.includes("Investigator"), rendered);
		assert.ok(rendered.includes(expected), rendered);
		assert.doesNotMatch(rendered, /raw child final summary/);
	}
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
