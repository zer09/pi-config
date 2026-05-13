import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import subagentRunnerExtension, {
	buildBootstrapPrompt,
	buildPiArgs,
	buildSessionDir,
	deriveWorkstream,
	observeJsonLine,
	parseJsonObject,
	parseListModelsOutput,
	redactForReturn,
	resolveModelFromListOutput,
	sanitizeSlug,
	buildInvalidPathRetryTask,
	buildNoToolRetryTask,
	findInvalidReportedPaths,
	shouldRetryNoToolBlockedResult,
	shouldRetryNoToolResult,
	validateAndNormalize,
	type ObservedChildState,
} from "./index.ts";

function main() {
	const home = homedir();

	assert.equal(sanitizeSlug("Switchboard Google SSO!"), "switchboard-google-sso");
	assert.ok(!sanitizeSlug("../../bad").includes(".."));
	assert.equal(deriveWorkstream(`${home}/.pi`, "Investigate subagent runner", undefined), "pi-investigate-subagent-runner");
	assert.equal(deriveWorkstream(`${home}/.pi`, "Ignored task", "My Workstream"), "my-workstream");

	const sessionDir = buildSessionDir("Pi Subagent", "investigator");
	assert.ok(sessionDir.endsWith("/.pi/agent/subagent-sessions/pi-subagent/investigator"));

	const rolePrompt = "# Investigator\n\nUse Context Watcher and return evidence.";
	const bootstrap = buildBootstrapPrompt({ agent: "investigator", task: "Check something", mode: "read" }, rolePrompt);
	assert.ok(bootstrap.includes("~/.pi/agent/skills/context-watcher/SKILL.md"));
	assert.ok(bootstrap.includes("use Context Mode file-processing tools"));
	assert.ok(bootstrap.includes("These startup reads are tool calls"));
	assert.ok(bootstrap.includes("before subject-matter inspection"));
	assert.ok(bootstrap.includes("Do not run cleanup/update startup scripts from the child"));
	assert.ok(bootstrap.includes("For simple literal string searches, one graph availability/search check is enough"));
	assert.ok(bootstrap.includes("Read-only mode is active"));
	assert.ok(bootstrap.includes("Return only a JSON object"));
	assert.ok(bootstrap.includes("never use pass"));
	assert.ok(bootstrap.includes("do not expand literal `~`"));
	assert.ok(bootstrap.includes("~/.pi/agent/rules/"));
	assert.ok(bootstrap.includes("Do not ask the parent for permission"));
	assert.ok(bootstrap.includes("your next assistant response must be a tool call, not final JSON"));
	assert.ok(bootstrap.includes("Do not return `blocked`, `error`, or `ok` merely because no tool query has run yet"));
	assert.ok(bootstrap.includes("Self-reporting tool names in `toolsUsed` is not enough"));
	assert.ok(bootstrap.includes("Never return an empty object"));
	assert.ok(bootstrap.includes("Do not write tool-call syntax"));
	assert.ok(bootstrap.includes("Only cite files, symbols, commands, and line numbers"));
	assert.ok(bootstrap.includes("An empty, stale, or incomplete graph is not automatically a graph error"));

	const args = buildPiArgs({ agent: "investigator", task: "Do work" }, "/tmp/session", "prompt");
	assert.deepEqual(args, ["--mode", "json", "--session-dir", "/tmp/session", "--continue", "--append-system-prompt", "prompt", "Sub-agent task:\nDo work"]);

	const resetArgs = buildPiArgs({ agent: "investigator", task: "Do work", reset: true, model: "provider/model" }, "/tmp/session", "prompt");
	assert.deepEqual(resetArgs, ["--mode", "json", "--session-dir", "/tmp/session", "--append-system-prompt", "prompt", "--model", "provider/model", "Sub-agent task:\nDo work"]);

	const listModelsOutput = `provider      model                      context  max-out  thinking  images
openai-codex  gpt-5.3-codex              272K     128K     yes       yes
openai-codex  gpt-5.3-codex-spark        128K     128K     yes       no
openai        gpt-5.3-codex              128K     64K      yes       yes`;
	assert.deepEqual(parseListModelsOutput(`[context-mode] warning ignored\n${listModelsOutput}`), [
		{ provider: "openai-codex", model: "gpt-5.3-codex" },
		{ provider: "openai-codex", model: "gpt-5.3-codex-spark" },
		{ provider: "openai", model: "gpt-5.3-codex" },
	]);
	const qualifiedResolution = resolveModelFromListOutput("openai-codex/gpt-5.3-codex", listModelsOutput);
	assert.equal(qualifiedResolution.ok, true);
	assert.equal(qualifiedResolution.ok ? qualifiedResolution.model : "", "openai-codex/gpt-5.3-codex");
	const thinkingResolution = resolveModelFromListOutput("openai-codex/gpt-5.3-codex:high", listModelsOutput);
	assert.equal(thinkingResolution.ok, true);
	assert.equal(thinkingResolution.ok ? thinkingResolution.model : "", "openai-codex/gpt-5.3-codex:high");
	const ambiguousResolution = resolveModelFromListOutput("gpt-5.3-codex", listModelsOutput);
	assert.equal(ambiguousResolution.ok, false);
	assert.ok(!ambiguousResolution.ok && ambiguousResolution.blockers.includes("ambiguous_model"));
	const exactCodexOutput = `provider      model                      context  max-out  thinking  images
openai-codex  gpt-5.3-codex              272K     128K     yes       yes
openai-codex  gpt-5.3-codex-spark        128K     128K     yes       no`;
	const exactCodexResolution = resolveModelFromListOutput("gpt-5.3-codex", exactCodexOutput);
	assert.equal(exactCodexResolution.ok, true);
	assert.equal(exactCodexResolution.ok ? exactCodexResolution.model : "", "openai-codex/gpt-5.3-codex");
	const exactShortResolution = resolveModelFromListOutput("gpt-5.3-codex-spark", listModelsOutput);
	assert.equal(exactShortResolution.ok, true);
	assert.equal(exactShortResolution.ok ? exactShortResolution.model : "", "openai-codex/gpt-5.3-codex-spark");
	const missingResolution = resolveModelFromListOutput("gpt-5.3", listModelsOutput);
	assert.equal(missingResolution.ok, false);
	assert.ok(!missingResolution.ok && missingResolution.suggestions.includes("openai-codex/gpt-5.3-codex"));

	assert.deepEqual(parseJsonObject('```json\n{"status":"ok"}\n```'), { status: "ok" });
	assert.deepEqual(parseJsonObject('prefix {"status":"ok"} suffix'), { status: "ok" });
	assert.equal(parseJsonObject("not json"), null);

	const observed: ObservedChildState = { finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(), parseErrors: 0, skippedLargeLines: 0 };
	observeJsonLine(JSON.stringify({ type: "session", id: "session-1" }), observed);
	observeJsonLine(JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } }), observed);
	observeJsonLine(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: '{"status":"ok"' } }), observed);
	observeJsonLine(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "}" } }), observed);
	observeJsonLine(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "context_mode_ctx_execute", arguments: {} }] } }), observed);
	assert.equal(observed.sessionId, "session-1");
	assert.equal(observed.finalText, '{"status":"ok"}');
	assert.equal(observed.toolsUsed.has("context_mode_ctx_execute"), true);

	const messageObserved: ObservedChildState = { finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(), parseErrors: 0, skippedLargeLines: 0 };
	observeJsonLine(JSON.stringify({ type: "message", message: { role: "assistant", content: '{"status":"ok"}' } }), messageObserved);
	assert.equal(messageObserved.finalText, '{"status":"ok"}');

	const redacted = redactForReturn({ apiKey: "secret-value", path: `${home}/.pi`, text: "TOKEN=secret", colon: "api_key: secret", header: "Authorization: Bearer secret" }) as Record<string, unknown>;
	assert.equal(redacted.apiKey, "[REDACTED]");
	assert.equal(redacted.path, "~/.pi");
	assert.equal(redacted.text, "TOKEN=[REDACTED]");
	assert.equal(redacted.colon, "api_key=[REDACTED]");
	assert.equal(redacted.header, "Authorization: Bearer [REDACTED]");

	const normalized = validateAndNormalize(
		{ status: "pass", finding: { roleCanStart: true }, evidence: ["role file reachable"], confidence: "high", recommended_next_steps: ["continue"] },
		{ agent: "investigator", task: "check" },
		{ finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(["ctx_execute"]), parseErrors: 0, skippedLargeLines: 0 },
		{ workstream: "work", sessionDir: "/tmp/session", durationMs: 1 },
	);
	assert.ok(normalized);
	assert.equal(normalized.status, "ok");
	assert.equal(normalized.summary, '{"roleCanStart":true}');
	assert.equal(normalized.evidence[0]?.reason, "role file reachable");
	assert.equal(normalized.recommendedNextStep, "continue");
	assert.equal(shouldRetryNoToolBlockedResult({ ...normalized, status: "blocked", toolsUsed: [] }, 0), true);
	assert.equal(shouldRetryNoToolBlockedResult({ ...normalized, status: "blocked", toolsUsed: ["ctx_execute"] }, 0), true);
	assert.equal(shouldRetryNoToolBlockedResult({ ...normalized, status: "blocked", toolsUsed: [] }, 1), false);
	assert.equal(shouldRetryNoToolResult({ ...normalized, status: "ok", toolsUsed: ["ctx_execute"] }, 0), true);
	assert.equal(shouldRetryNoToolResult({ ...normalized, status: "error", toolsUsed: [] }, 0), true);
	assert.equal(shouldRetryNoToolResult({ ...normalized, status: "error", toolsUsed: [] }, 1), false);
	assert.ok(buildNoToolRetryTask("Find email").includes("Original task:\nFind email"));
	assert.ok(buildNoToolRetryTask("Find email").includes("Do not answer that startup reads need to happen first"));
	assert.ok(buildNoToolRetryTask("Find email").includes("must include an actual read-only Context Mode or Code Review Graph tool call"));
	const invalidPathResult = { ...normalized, evidence: [{ file: "./definitely-missing-subagent-file.txt", reason: "missing" }], filesRead: ["~/.pi/agent/AGENTS.md", "also-missing.txt"] };
	const invalidPaths = findInvalidReportedPaths(invalidPathResult, home);
	assert.equal(invalidPaths.length, 2);
	assert.ok(buildInvalidPathRetryTask("Find email", invalidPaths).includes("cited file paths that do not exist"));

	let registeredToolName = "";
	subagentRunnerExtension({
		registerTool(definition: { name: string }) {
			registeredToolName = definition.name;
		},
	} as never);
	assert.equal(registeredToolName, "subagent_run");

	console.log("subagent-runner smoke tests passed");
}

main();
