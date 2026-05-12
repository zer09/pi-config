import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import subagentRunnerExtension, {
	buildBootstrapPrompt,
	buildPiArgs,
	buildSessionDir,
	deriveWorkstream,
	observeJsonLine,
	parseJsonObject,
	redactForReturn,
	sanitizeSlug,
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
	assert.ok(bootstrap.includes("Read-only mode is active"));
	assert.ok(bootstrap.includes("Return only a JSON object"));
	assert.ok(bootstrap.includes("never use pass"));
	assert.ok(bootstrap.includes("do not expand literal `~`"));
	assert.ok(bootstrap.includes("~/.pi/agent/rules/"));
	assert.ok(bootstrap.includes("Do not ask the parent for permission"));
	assert.ok(bootstrap.includes("Do not return `blocked` merely because no tool query has run yet"));
	assert.ok(bootstrap.includes("Never return an empty object"));
	assert.ok(bootstrap.includes("Do not write tool-call syntax"));
	assert.ok(bootstrap.includes("Only cite files, symbols, commands, and line numbers"));

	const args = buildPiArgs({ agent: "investigator", task: "Do work" }, "/tmp/session", "prompt");
	assert.deepEqual(args, ["--mode", "json", "--session-dir", "/tmp/session", "--continue", "--append-system-prompt", "prompt", "Sub-agent task:\nDo work"]);

	const resetArgs = buildPiArgs({ agent: "investigator", task: "Do work", reset: true, model: "provider/model" }, "/tmp/session", "prompt");
	assert.deepEqual(resetArgs, ["--mode", "json", "--session-dir", "/tmp/session", "--append-system-prompt", "prompt", "--model", "provider/model", "Sub-agent task:\nDo work"]);

	assert.deepEqual(parseJsonObject('```json\n{"status":"ok"}\n```'), { status: "ok" });
	assert.deepEqual(parseJsonObject('prefix {"status":"ok"} suffix'), { status: "ok" });
	assert.equal(parseJsonObject("not json"), null);

	const observed: ObservedChildState = { finalText: "", currentAssistantText: "", inAssistantMessage: false, toolsUsed: new Set(), parseErrors: 0, skippedLargeLines: 0 };
	observeJsonLine(JSON.stringify({ type: "session", id: "session-1" }), observed);
	observeJsonLine(JSON.stringify({ type: "message_start", message: { role: "assistant", content: [] } }), observed);
	observeJsonLine(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: '{"status":"ok"' } }), observed);
	observeJsonLine(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "}" } }), observed);
	assert.equal(observed.sessionId, "session-1");
	assert.equal(observed.finalText, '{"status":"ok"}');

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
