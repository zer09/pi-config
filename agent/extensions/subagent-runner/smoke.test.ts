import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import subagentRunnerExtension, {
	buildBootstrapPrompt,
	buildPiArgs,
	buildSessionDir,
	deriveWorkstream,
	extractRoleDefaultModel,
	observeJsonLine,
	parseJsonObject,
	parseListModelsOutput,
	redactForReturn,
	resolveCwd,
	resolveModelFromListOutput,
	sanitizeSlug,
	selectSubagentModel,
	buildInvalidPathRetryTask,
	buildNoToolRetryTask,
	buildSuspiciousOkRetryTask,
	findInvalidReportedPaths,
	findSuspiciousOkResult,
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
	assert.equal(resolveCwd("~/development/context-mode", "/tmp/base"), `${home}/development/context-mode`);
	assert.equal(resolveCwd("relative-repo", "/tmp/base"), "/tmp/base/relative-repo");
	assert.equal(resolveCwd("relative-repo", "~/base"), `${home}/base/relative-repo`);
	assert.equal(resolveCwd(undefined, "/tmp/base"), "/tmp/base");

	const sessionDir = buildSessionDir("Pi Subagent", "investigator");
	assert.ok(sessionDir.endsWith("/.pi/agent/subagent-sessions/pi-subagent/investigator"));

	const rolePrompt = "# Investigator\n\nUse Context Watcher and return evidence.";
	const modelFrontmatter = "---\nname: investigator\nmodel: openai-codex/gpt-5.3-codex\n---\n# Investigator";
	assert.equal(extractRoleDefaultModel(modelFrontmatter), "openai-codex/gpt-5.3-codex");
	assert.equal(extractRoleDefaultModel("---\nname: reviewer\nmodel: default\n---\n# Reviewer"), undefined);
	assert.equal(extractRoleDefaultModel(rolePrompt), undefined);
	assert.equal(selectSubagentModel(undefined, modelFrontmatter), "openai-codex/gpt-5.3-codex");
	assert.equal(selectSubagentModel("provider/override", modelFrontmatter), "provider/override");
	const bootstrap = buildBootstrapPrompt({ agent: "investigator", task: "Check something", mode: "read", cwd: "/tmp/repo" }, rolePrompt);
	assert.ok(bootstrap.includes("Subject working directory"));
	assert.ok(bootstrap.includes("Context Mode MCP tools can start from the MCP server directory"));
	assert.ok(bootstrap.includes("cd '/tmp/repo' && ..."));
	assert.ok(bootstrap.includes("override any bare `pwd`"));
	assert.ok(bootstrap.includes("~/.pi/agent/skills/context-watcher/SKILL.md"));
	assert.ok(bootstrap.includes("use Context Mode file-processing tools"));
	assert.ok(bootstrap.includes("These startup reads are tool calls"));
	assert.ok(bootstrap.includes("before subject-matter inspection"));
	assert.ok(bootstrap.includes(`Use these absolute paths in tool arguments, then redact them back to \`~\` only in final JSON: \`${home}/.pi/agent/AGENTS.md\``));
	assert.ok(bootstrap.includes(`use the home rule directory \`${home}/.pi/agent/rules/\` in tool arguments`));
	assert.ok(bootstrap.includes("Do not run cleanup/update startup scripts from the child"));
	assert.ok(bootstrap.includes("Missing subject-local approach rule files are not blockers"));
	assert.ok(bootstrap.includes("./rules/analysis.md"));
	assert.ok(bootstrap.includes("For simple literal string searches, one graph availability/search check is enough"));
	assert.ok(bootstrap.includes("Read-only mode is active"));
	assert.ok(bootstrap.includes("Return only a single-line minified JSON object"));
	assert.ok(bootstrap.includes("never use pass"));
	assert.ok(bootstrap.includes("do not expand literal `~`"));
	assert.ok(bootstrap.includes("never `~/agent/...`"));
	assert.ok(bootstrap.includes("do not write `rtk test ...`"));
	assert.ok(bootstrap.includes("`rtk printf ...`"));
	assert.ok(bootstrap.includes("Never use quoted home shorthand"));
	assert.ok(bootstrap.includes("Never pass quoted or unquoted `~/...` paths"));
	assert.ok(bootstrap.includes("quoted tilde paths"));
	assert.ok(bootstrap.includes("Use absolute paths under `/tmp/repo`"));
	assert.ok(bootstrap.includes("~/.pi/agent/rules/"));
	assert.ok(bootstrap.includes("Do not ask the parent for permission"));
	assert.ok(bootstrap.includes("your next assistant response must be a tool call, not final JSON, reasoning-only text, or planning-only text"));
	assert.ok(bootstrap.includes("Do not return `blocked`, `error`, or `ok` merely because no tool query has run yet"));
	assert.ok(bootstrap.includes("Self-reporting tool names in `toolsUsed` is not enough"));
	assert.ok(bootstrap.includes("Never return an empty object"));
	assert.ok(bootstrap.includes("Do not write tool-call syntax"));
	assert.ok(bootstrap.includes("Only cite files, symbols, commands, and line numbers"));
	assert.ok(bootstrap.includes("do not put that missing path in filesRead"));
	assert.ok(bootstrap.includes("do not treat section titles, query names, command labels, or synthetic headings as file content"));
	assert.ok(bootstrap.includes("For exact scalar facts such as versions, headings, counts, booleans, or field values"));
	assert.ok(bootstrap.includes("inspect the underlying file directly before final JSON"));
	assert.ok(bootstrap.includes("An empty, stale, or incomplete graph is not automatically a graph error"));

	const args = buildPiArgs({ agent: "investigator", task: "Do work" }, "/tmp/session", "prompt");
	assert.deepEqual(args, ["--mode", "json", "--session-dir", "/tmp/session", "--continue", "--append-system-prompt", "prompt", "Sub-agent task:\nDo work"]);

	const resetArgs = buildPiArgs({ agent: "investigator", task: "Do work", reset: true, model: "provider/model" }, "/tmp/session", "prompt");
	assert.deepEqual(resetArgs, ["--mode", "json", "--session-dir", "/tmp/session", "--append-system-prompt", "prompt", "--model", "provider/model", "Sub-agent task:\nDo work"]);
	const cwdArgs = buildPiArgs({ agent: "investigator", task: "Do work", cwd: "/tmp/repo" }, "/tmp/session", "prompt");
	assert.ok(cwdArgs.at(-1)?.includes("Subject working directory: `/tmp/repo`"));
	assert.ok(cwdArgs.at(-1)?.includes("cd '/tmp/repo' && ..."));
	assert.ok(cwdArgs.at(-1)?.includes("do not write `rtk test ...`"));
	assert.ok(cwdArgs.at(-1)?.includes("`rtk printf ...`"));
	assert.ok(cwdArgs.at(-1)?.includes("Never use quoted home shorthand"));
	assert.ok(cwdArgs.at(-1)?.includes("Use absolute paths under `/tmp/repo`"));
	assert.ok(cwdArgs.at(-1)?.includes("override any bare `pwd`"));
	assert.ok(cwdArgs.at(-1)?.endsWith("Task:\nDo work"));

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
	assert.equal(exactShortResolution.ok, false);
	assert.ok(!exactShortResolution.ok && exactShortResolution.blockers.includes("banned_model"));
	const bannedThinkingResolution = resolveModelFromListOutput("openai-codex/gpt-5.3-codex-spark:high", listModelsOutput);
	assert.equal(bannedThinkingResolution.ok, false);
	assert.ok(!bannedThinkingResolution.ok && bannedThinkingResolution.blockers.includes("banned_model"));
	const missingResolution = resolveModelFromListOutput("gpt-5.3", listModelsOutput);
	assert.equal(missingResolution.ok, false);
	assert.ok(!missingResolution.ok && missingResolution.suggestions.includes("openai-codex/gpt-5.3-codex"));
	assert.ok(!missingResolution.ok && !missingResolution.suggestions.some((suggestion) => suggestion.includes("gpt-5.3-codex-spark")));

	assert.deepEqual(parseJsonObject('```json\n{"status":"ok"}\n```'), { status: "ok" });
	assert.deepEqual(parseJsonObject('prefix {"status":"ok"} suffix'), { status: "ok" });
	assert.deepEqual(parseJsonObject('{"status":"ok","evidence":[{"reason":"checked"}],"blockers":[]'), { status: "ok", evidence: [{ reason: "checked" }], blockers: [] });
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

	const suspiciousObserved: ObservedChildState = { finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(), parseErrors: 0, skippedLargeLines: 0 };
	observeJsonLine(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "ctx_execute", arguments: { command: "cd '~/repo' && test -d tests" } }] } }), suspiciousObserved);
	observeJsonLine(JSON.stringify({ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "No matching sections found." }] } }), suspiciousObserved);
	assert.ok(suspiciousObserved.toolUseViolations?.length);
	assert.ok(suspiciousObserved.toolResultWarnings?.length);

	const messageObserved: ObservedChildState = { finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(), parseErrors: 0, skippedLargeLines: 0 };
	observeJsonLine(JSON.stringify({ type: "message", message: { role: "assistant", content: '{"status":"ok"}' } }), messageObserved);
	observeJsonLine(JSON.stringify({ type: "message", message: { role: "assistant", content: '{"type":"thinking","thinking":"drafting final JSON"}' } }), messageObserved);
	observeJsonLine(JSON.stringify({ type: "message", message: { role: "assistant", content: '{"type":"toolCall","name":"ctx_execute","arguments":{}}' } }), messageObserved);
	assert.equal(messageObserved.finalText, '{"status":"ok"}');

	const redacted = redactForReturn({ apiKey: "secret-value", path: `${home}/.pi`, command: `cd '${home}/development/context-mode' && test -d tests`, text: "TOKEN=secret", colon: "api_key: secret", header: "Authorization: Bearer secret" }) as Record<string, unknown>;
	assert.equal(redacted.apiKey, "[REDACTED]");
	assert.equal(redacted.path, "~/.pi");
	assert.equal(redacted.command, "cd ~/development/context-mode && test -d tests");
	assert.equal(redacted.text, "TOKEN=[REDACTED]");
	assert.equal(redacted.colon, "api_key=[REDACTED]");
	assert.equal(redacted.header, "Authorization: Bearer [REDACTED]");

	const normalized = validateAndNormalize(
		{ status: "pass", finding: { roleCanStart: true }, evidence: ["role file reachable"], confidence: "high", recommended_next_steps: ["continue"] },
		{ agent: "investigator", task: "check" },
		{ finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(["ctx_execute"]), parseErrors: 0, skippedLargeLines: 0 },
		{ workstream: "work", sessionDir: "/tmp/session", durationMs: 1, model: "openai-codex/gpt-5.3-codex" },
	);
	assert.ok(normalized);
	assert.equal(normalized.status, "ok");
	assert.equal(normalized.model, "openai-codex/gpt-5.3-codex");
	assert.equal(normalized.summary, '{"roleCanStart":true}');
	assert.equal(normalized.evidence[0]?.reason, "role file reachable");
	assert.equal(normalized.recommendedNextStep, "continue");

	const schemaLightResult = validateAndNormalize(
		{ summary: "Checked tests directory", finding: "tests exists", evidence: ["test -d returned true"], tools_used: ["ctx_execute_file"], blockers: "none", recommended_next_step: "continue" },
		{ agent: "tester", task: "check" },
		{ finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(["ctx_execute"]), parseErrors: 0, skippedLargeLines: 0 },
		{ workstream: "work", sessionDir: "/tmp/session", durationMs: 1 },
	);
	assert.ok(schemaLightResult);
	assert.equal(schemaLightResult.status, "ok");
	assert.deepEqual(schemaLightResult.toolsUsed, ["ctx_execute", "ctx_execute_file"]);
	assert.equal(schemaLightResult.evidence[0]?.reason, "test -d returned true");
	assert.deepEqual(schemaLightResult.blockers, []);
	assert.equal(schemaLightResult.recommendedNextStep, "continue");

	const inferredBlocked = validateAndNormalize(
		{ summary: "Blocked", finding: "Missing input", blockers: ["missing_input"] },
		{ agent: "tester", task: "check" },
		{ finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(), parseErrors: 0, skippedLargeLines: 0 },
		{ workstream: "work", sessionDir: "/tmp/session", durationMs: 1 },
	);
	assert.ok(inferredBlocked);
	assert.equal(inferredBlocked.status, "blocked");
	assert.equal(shouldRetryNoToolBlockedResult({ ...normalized, status: "blocked", toolsUsed: [] }, 0), true);
	assert.equal(shouldRetryNoToolBlockedResult({ ...normalized, status: "blocked", toolsUsed: ["ctx_execute"] }, 0), true);
	assert.equal(shouldRetryNoToolBlockedResult({ ...normalized, status: "blocked", toolsUsed: [] }, 1), false);
	assert.equal(shouldRetryNoToolResult({ ...normalized, status: "ok", toolsUsed: ["ctx_execute"] }, 0), true);
	assert.equal(shouldRetryNoToolResult({ ...normalized, status: "error", toolsUsed: [] }, 0), true);
	assert.equal(shouldRetryNoToolResult({ ...normalized, status: "error", toolsUsed: [] }, 1), false);
	assert.ok(buildNoToolRetryTask("Find email").includes("Original task:\nFind email"));
	assert.ok(buildNoToolRetryTask("Find email").includes("Do not answer that startup reads need to happen first"));
	assert.ok(buildNoToolRetryTask("Find email").includes("must include an actual read-only Context Mode or Code Review Graph tool call"));
	assert.ok(buildNoToolRetryTask("Find email").includes("not final JSON, reasoning-only text, planning-only text"));
	const suspiciousReasons = findSuspiciousOkResult({ ...normalized, finding: "tests does not exist as a directory", evidence: [{ command: "cd '~/repo' && test -d tests", reason: "Command returned no." }] }, suspiciousObserved, "verify tests exists and is a directory");
	assert.ok(suspiciousReasons.length >= 2);
	const unsupportedSubjectObserved: ObservedChildState = { finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(["ctx_execute"]), parseErrors: 0, skippedLargeLines: 0, toolUseTexts: [JSON.stringify({ path: `${home}/.pi/agent/skills/context-watcher/SKILL.md` })] };
	const unsupportedSubjectReasons = findSuspiciousOkResult({ ...normalized, filesRead: ["~/development/context-mode/package.json"], evidence: [{ file: "~/development/context-mode/package.json", reason: "version is 1.2.3" }] }, unsupportedSubjectObserved, "inspect package.json version", `${home}/development/context-mode`);
	assert.ok(unsupportedSubjectReasons.some((item) => item.reason.includes("subject-repository file")));
	const supportedSubjectObserved: ObservedChildState = { finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(["ctx_execute"]), parseErrors: 0, skippedLargeLines: 0, toolUseTexts: [JSON.stringify({ code: `cd '${home}/development/context-mode' && node -e "require('fs').readFileSync('package.json','utf8')"` })] };
	assert.equal(findSuspiciousOkResult({ ...normalized, filesRead: ["~/development/context-mode/package.json"], evidence: [{ file: "~/development/context-mode/package.json", reason: "version is 1.0.118" }] }, supportedSubjectObserved, "inspect package.json version", `${home}/development/context-mode`).length, 0);
	const incompleteOkReasons = findSuspiciousOkResult({ ...normalized, finding: "Unable to complete target-file inspection yet because only mandatory startup files were read; this still needs one additional read-only tool call.", evidence: [] }, supportedSubjectObserved, "inspect README first line", `${home}/development/context-mode`);
	assert.ok(incompleteOkReasons.some((item) => item.reason.includes("inspection is incomplete")));
	assert.ok(buildSuspiciousOkRetryTask("verify tests exists and is a directory", suspiciousReasons).includes("absolute paths in every tool argument, including startup file reads"));
	assert.ok(buildSuspiciousOkRetryTask("verify tests exists and is a directory", suspiciousReasons).includes("~/.pi/..."));
	assert.ok(buildSuspiciousOkRetryTask("verify tests exists and is a directory", suspiciousReasons).includes("~/development/..."));
	assert.ok(buildSuspiciousOkRetryTask("verify tests exists and is a directory", suspiciousReasons).includes("must be a tool call that directly inspects the subject file or subject working directory"));
	assert.ok(buildSuspiciousOkRetryTask("verify tests exists and is a directory", suspiciousReasons).includes("Startup rule-file reads alone are not enough"));
	assert.ok(buildSuspiciousOkRetryTask("verify tests exists and is a directory", suspiciousReasons).includes("single-line minified JSON"));
	const invalidPathResult = { ...normalized, evidence: [{ file: "./definitely-missing-subagent-file.txt", reason: "missing" }], filesRead: ["~/.pi/agent/AGENTS.md", "also-missing.txt"] };
	const invalidPaths = findInvalidReportedPaths(invalidPathResult, home);
	assert.equal(invalidPaths.length, 2);
	assert.ok(buildInvalidPathRetryTask("Find email", invalidPaths).includes("cited file paths that do not exist"));
	assert.ok(buildInvalidPathRetryTask("Find email", invalidPaths).includes("do not put that missing path in filesRead"));

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
