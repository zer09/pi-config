import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import hostedMutationGuard, {
	classifyShellCommand,
	classifyToolCall,
	matchesAuthorization,
	parseOneTimeAuthorization,
	parsePromptAuthorizations,
	shellSplit,
	type HostedMutationAuthorization,
} from "./index.ts";

type TestFn = () => void | Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];

function test(name: string, fn: TestFn): void {
	tests.push({ name, fn });
}

interface Harness {
	commands: Record<string, any>;
	notifications: Array<{ message: string; type?: string }>;
	entries: Array<{ type: string; data: unknown }>;
	before(prompt: string): Promise<void>;
	end(): Promise<void>;
	call(toolName: string, input: unknown): Promise<any>;
	runCommand(name: string, args: string): Promise<void>;
}

function makeHarness(): Harness {
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const commands: Record<string, any> = {};
	const notifications: Array<{ message: string; type?: string }> = [];
	const entries: Array<{ type: string; data: unknown }> = [];
	const ctx = {
		hasUI: true,
		ui: {
			notify: (message: string, type?: string) => notifications.push({ message, type }),
		},
	};

	hostedMutationGuard({
		on: (name: string, handler: (event: any, ctx: any) => any) => {
			handlers[name] ??= [];
			handlers[name].push(handler);
		},
		registerCommand: (name: string, options: any) => {
			commands[name] = options;
		},
		appendEntry: (type: string, data: unknown) => {
			entries.push({ type, data });
		},
	} as any);

	async function emit(name: string, event: any): Promise<any> {
		for (const handler of handlers[name] ?? []) {
			const result = await handler(event, ctx);
			if (result !== undefined) return result;
		}
		return undefined;
	}

	return {
		commands,
		notifications,
		entries,
		before: async (prompt: string) => {
			await emit("before_agent_start", { type: "before_agent_start", prompt, systemPrompt: "", systemPromptOptions: {} });
		},
		end: async () => {
			await emit("agent_end", { type: "agent_end", messages: [] });
		},
		call: async (toolName: string, input: unknown) => emit("tool_call", { type: "tool_call", toolCallId: "tool-1", toolName, input }),
		runCommand: async (name: string, args: string) => {
			await commands[name].handler(args, ctx);
		},
	};
}

function assertBlocked(result: any): void {
	assert.equal(result?.block, true);
	assert.match(result.reason, /Hosted-service mutation blocked/);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

test("shellSplit keeps quoted bodies together", () => {
	assert.deepEqual(shellSplit('gh pr comment 123 --body "Fixed in 98fb768."'), ["gh", "pr", "comment", "123", "--body", "Fixed in 98fb768."]);
});

test("classifier blocks git push as tier 3", () => {
	const intents = classifyShellCommand("git push origin feature/foo");
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "git");
	assert.equal(intents[0].action, "git-push");
	assert.equal(intents[0].tier, 3);
});

test("classifier blocks git push after git global options", () => {
	const intents = classifyShellCommand("git -C /tmp/pi-config push origin security/audit");
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "git");
	assert.equal(intents[0].action, "git-push");
	assert.equal(intents[0].tier, 3);
	assert.equal(intents[0].target, "origin security/audit");
});

test("classifier normalizes executable paths before classification", () => {
	assert.equal(classifyShellCommand("/usr/bin/git push origin main")[0].action, "git-push");
	assert.equal(classifyShellCommand("/opt/homebrew/bin/gh pr merge 123")[0].action, "pr-merge");
});

test("classifier blocks GitHub PR merge", () => {
	const intents = classifyShellCommand("gh pr merge 123");
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "github");
	assert.equal(intents[0].action, "pr-merge");
	assert.equal(intents[0].target, "123");
	assert.equal(intents[0].tier, 3);
});

test("classifier unwraps common shell -c launchers", () => {
	assert.equal(classifyShellCommand("bash -lc 'gh pr merge 123'")[0].action, "pr-merge");
	assert.equal(classifyShellCommand("sh -c 'git push origin main'")[0].action, "git-push");
	assert.equal(classifyShellCommand("env FOO=1 command bash -lc \"sh -c 'gh pr merge 123'\"")[0].action, "pr-merge");
});

test("classifier blocks mutations after pipeline and background separators", () => {
	assert.equal(classifyShellCommand("echo ok | gh pr merge 123")[0].action, "pr-merge");
	assert.equal(classifyShellCommand("echo ok & gh pr merge 123")[0].action, "pr-merge");
});

test("classifier blocks GitHub PR comment and captures body", () => {
	const intents = classifyShellCommand('gh pr comment 123 --body "hello"');
	assert.equal(intents.length, 1);
	assert.equal(intents[0].action, "pr-comment");
	assert.equal(intents[0].target, "123");
	assert.equal(intents[0].body, "hello");
	assert.equal(intents[0].tier, 1);
});

test("classifier allows GitHub read-only commands", () => {
	assert.deepEqual(classifyShellCommand("gh pr view 123"), []);
	assert.deepEqual(classifyShellCommand("gh issue list"), []);
	assert.deepEqual(classifyShellCommand("gh api repos/o/r/issues/1"), []);
});

test("classifier blocks gh api mutating methods", () => {
	const intents = classifyShellCommand("gh api -X PATCH repos/o/r/issues/1 -f title=New");
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "github");
	assert.equal(intents[0].action, "api-patch");
});

test("classifier blocks Firebase and GCP deploys", () => {
	assert.equal(classifyShellCommand("firebase deploy")[0].action, "deploy");
	assert.equal(classifyShellCommand("gcloud run deploy service")[0].service, "gcloud");
});

test("classifier blocks mutating hosted HTTP requests but not localhost", () => {
	assert.equal(classifyShellCommand("curl -X DELETE https://api.github.com/repos/o/r/issues/1")[0].service, "github");
	assert.deepEqual(classifyShellCommand("curl -X POST http://localhost:3000/test"), []);
});

test("classifier ignores Context Mode tools", () => {
	assert.deepEqual(classifyToolCall("ctx_execute", { language: "shell", code: "firebase deploy" }), []);
	assert.deepEqual(classifyToolCall("context_mode_ctx_execute", { language: "javascript", code: "require('child_process').execSync('gh pr merge 123')" }), []);
	assert.deepEqual(classifyToolCall("ctx_batch_execute", { commands: [{ command: "gh pr merge 1" }] }), []);
	assert.deepEqual(classifyToolCall("context_mode_ctx_batch_execute", { commands: [{ command: "gh pr merge 1" }] }), []);
	assert.deepEqual(classifyToolCall("ctx_execute_file", { path: "docs/directus-production-schema.md", language: "javascript", code: "console.log(FILE_CONTENT)", intent: "Directus production schema update" }), []);
	assert.deepEqual(classifyToolCall("context_mode_ctx_execute_file", { path: "docs/directus-production-schema.md", language: "javascript", code: "console.log(FILE_CONTENT)", intent: "Directus production schema update" }), []);
});

test("classifier inspects embedded commands in direct shell code", () => {
	const intents = classifyShellCommand("node -e \"require('child_process').execSync('gh pr merge 123')\"");
	assert.equal(intents.length, 1);
	assert.equal(intents[0].action, "pr-merge");
});

test("classifier inspects embedded git push with quoted git global option path", () => {
	const intents = classifyShellCommand(String.raw`node -e "require('child_process').execSync(\"git -C \\\"/tmp/work tree\\\" push origin main\")"`);
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "git");
	assert.equal(intents[0].action, "git-push");
});

test("classifier inspects direct shell execution sinks beyond the code sample window", () => {
	const paddedCommand = `node -e \"${"x".repeat(60_000)}\nrequire('child_process').execSync('gh pr merge 123')\"`;
	const intents = classifyShellCommand(paddedCommand);
	assert.equal(intents.length, 1);
	assert.equal(intents[0].action, "pr-merge");
});

test("classifier ignores inert hosted mutation-looking string literals in direct shell code", () => {
	const command = 'node -e "const example = \\\"gh pr merge 123\\\"; console.log(example);"';
	assert.deepEqual(classifyShellCommand(command), []);
});

test("classifier inspects hosted HTTP methods in direct shell code", () => {
	const intents = classifyShellCommand("node -e \"fetch('https://api.github.com/repos/o/r', { method: 'DELETE' })\"");
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "github");
	assert.equal(intents[0].action, "http-delete");
});

test("prompt parser accepts exact GitHub PR comments", () => {
	const auths = parsePromptAuthorizations('Post this exact GitHub PR comment on PR #123:\n"Fixed in 98fb768."');
	assert.equal(auths.length, 1);
	assert.equal(auths[0].service, "github");
	assert.equal(auths[0].action, "pr-comment");
	assert.equal(auths[0].target, "123");
	assert.equal(auths[0].body, "Fixed in 98fb768.");
});

test("prompt parser rejects broad GitHub comments", () => {
	assert.deepEqual(parsePromptAuthorizations("Post a comment on PR #123."), []);
});

test("prompt authorization matches only exact target and body", () => {
	const [auth] = parsePromptAuthorizations('Post this exact GitHub PR comment on PR #123:\n"Fixed in 98fb768."');
	const [intent] = classifyShellCommand('gh pr comment 123 --body "Fixed in 98fb768."');
	assert.equal(matchesAuthorization(intent, auth), true);
	const [wrongBody] = classifyShellCommand('gh pr comment 123 --body "Fixed."');
	assert.equal(matchesAuthorization(wrongBody, auth), false);
	const [wrongTarget] = classifyShellCommand('gh pr comment 124 --body "Fixed in 98fb768."');
	assert.equal(matchesAuthorization(wrongTarget, auth), false);
});

test("prompt authorization does not allow destructive tier 3 actions", () => {
	const auth: HostedMutationAuthorization = { service: "github", action: "pr-merge", target: "123", body: "merge", source: "prompt", createdAt: Date.now() };
	const [intent] = classifyShellCommand("gh pr merge 123");
	assert.equal(matchesAuthorization(intent, auth), false);
});

test("one-time authorization parses target and optional body hash", () => {
	const auth = parseOneTimeAuthorization("github pr-merge 123 body-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
	assert.ok(!("error" in auth));
	assert.equal(auth.service, "github");
	assert.equal(auth.action, "pr-merge");
	assert.equal(auth.target, "123");
	assert.equal(auth.bodySha256, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("one-time authorization requires payload hash for tier 1 and tier 2", () => {
	assert.match((parseOneTimeAuthorization("github pr-comment 123") as any).error, /requires body-sha256/);
	assert.match((parseOneTimeAuthorization("github pr-edit 123") as any).error, /requires body-sha256/);
	assert.ok(!("error" in parseOneTimeAuthorization("github pr-merge 123")));
});

test("command authorization without payload never matches tier 1 or tier 2", () => {
	const [comment] = classifyShellCommand('gh pr comment 123 --body "Done."');
	const [edit] = classifyShellCommand('gh pr edit 123 --body "Done."');
	const now = Date.now();
	assert.equal(matchesAuthorization(comment, { service: "github", action: "pr-comment", target: "123", source: "command", createdAt: now }), false);
	assert.equal(matchesAuthorization(edit, { service: "github", action: "pr-edit", target: "123", source: "command", createdAt: now }), false);
});

test("command authorization body hash matches only the exact payload", () => {
	const [right] = classifyShellCommand('gh pr comment 123 --body "Done."');
	const [wrong] = classifyShellCommand('gh pr comment 123 --body "Changed."');
	const auth: HostedMutationAuthorization = { service: "github", action: "pr-comment", target: "123", bodySha256: sha256("Done."), source: "command", createdAt: Date.now() };
	assert.equal(matchesAuthorization(right, auth), true);
	assert.equal(matchesAuthorization(wrong, auth), false);
});

test("extension blocks GitHub PR comment without exact authorization", async () => {
	const harness = makeHarness();
	const result = await harness.call("bash", { command: 'gh pr comment 123 --body "Done."' });
	assertBlocked(result);
	assert.equal(harness.entries.length, 1);
	assert.equal(harness.entries[0].type, "hosted-mutation-guard");
});

test("extension allows one body-hash command-authorized GitHub PR comment", async () => {
	const harness = makeHarness();
	await harness.runCommand("authorize-hosted-mutation", `github pr-comment 123 body-sha256:${sha256("Done.")}`);
	assert.equal(await harness.call("bash", { command: 'gh pr comment 123 --body "Done."' }), undefined);
	assertBlocked(await harness.call("bash", { command: 'gh pr comment 123 --body "Done."' }));
});

test("extension redacts URL userinfo in block reasons and audit entries", async () => {
	const harness = makeHarness();
	const result = await harness.call("bash", { command: "git push https://TOKEN_VALUE@github.com/org/repo main" });
	assertBlocked(result);
	assert.doesNotMatch(result.reason, /TOKEN_VALUE/);
	assert.match(result.reason, /https:\/\/<redacted>@github\.com\/org\/repo/);
	const audit = harness.entries[0].data as { target?: string };
	assert.doesNotMatch(audit.target ?? "", /TOKEN_VALUE/);
});

test("extension allows one exact prompt-authorized GitHub PR comment", async () => {
	const harness = makeHarness();
	await harness.before('Post this exact GitHub PR comment on PR #123:\n"Fixed in 98fb768."');
	const result = await harness.call("bash", { command: 'gh pr comment 123 --body "Fixed in 98fb768."' });
	assert.equal(result, undefined);
});

test("extension consumes prompt authorization after one use", async () => {
	const harness = makeHarness();
	await harness.before('Post this exact GitHub PR comment on PR #123:\n"Fixed in 98fb768."');
	assert.equal(await harness.call("bash", { command: 'gh pr comment 123 --body "Fixed in 98fb768."' }), undefined);
	assertBlocked(await harness.call("bash", { command: 'gh pr comment 123 --body "Fixed in 98fb768."' }));
});

test("extension blocks prompt-authorized comment when body differs", async () => {
	const harness = makeHarness();
	await harness.before('Post this exact GitHub PR comment on PR #123:\n"Fixed in 98fb768."');
	assertBlocked(await harness.call("bash", { command: 'gh pr comment 123 --body "Fixed."' }));
});

test("extension clears prompt authorization at agent end", async () => {
	const harness = makeHarness();
	await harness.before('Post this exact GitHub PR comment on PR #123:\n"Fixed in 98fb768."');
	await harness.end();
	assertBlocked(await harness.call("bash", { command: 'gh pr comment 123 --body "Fixed in 98fb768."' }));
});

test("extension allows exact Linear comments", async () => {
	const harness = makeHarness();
	await harness.before('Create a Linear comment on ENG-123 with exactly:\n"Root cause documented."');
	assert.equal(await harness.call("bash", { command: 'linear issue comment ENG-123 "Root cause documented."' }), undefined);
});

test("extension blocks broad Linear update prompts", async () => {
	const harness = makeHarness();
	await harness.before("Update Linear with the fix.");
	assertBlocked(await harness.call("bash", { command: "linear issue update ENG-123 --status Done" }));
});

test("extension allows one command-authorized tier 3 mutation", async () => {
	const harness = makeHarness();
	await harness.runCommand("authorize-hosted-mutation", "github pr-merge 123");
	assert.equal(await harness.call("bash", { command: "gh pr merge 123" }), undefined);
	assertBlocked(await harness.call("bash", { command: "gh pr merge 123" }));
});

test("extension ignores Context Mode batch tool calls", async () => {
	const harness = makeHarness();
	const result = await harness.call("ctx_batch_execute", { commands: [{ command: "gh pr view 123" }, { command: "gh pr merge 123" }] });
	assert.equal(result, undefined);
});

test("extension allows local tools", async () => {
	const harness = makeHarness();
	assert.equal(await harness.call("read", { path: "agent/mcp.json" }), undefined);
	assert.equal(await harness.call("write", { path: "tmp.txt", content: "hello" }), undefined);
	assert.equal(await harness.call("write", { path: "tmp/tool-hook-issue/tool-hook-block-report.md", content: "Directus production schema update report. Linear SB-5219 mutation notes." }), undefined);
	assert.equal(await harness.call("edit", { path: "tmp.txt", edits: [] }), undefined);
});

test("MCP classifier blocks hosted mutation tool names", () => {
	const intents = classifyToolCall("github_create_issue", { repo: "o/r", title: "t" });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "github");
	assert.equal(intents[0].action, "create");
});

test("MCP classifier allows read-only hosted tool names", () => {
	assert.deepEqual(classifyToolCall("github_get_issue", { repo: "o/r", number: "1" }), []);
});

test("MCP classifier blocks gateway mutation tools", () => {
	const intents = classifyToolCall("mcp", { server: "firebase", tool: "firebase_deploy", args: "{}" });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "firebase");
	assert.equal(intents[0].action, "deploy");
});

test("MCP classifier parses gateway JSON args for mutation signals", () => {
	const intents = classifyToolCall("mcp", { server: "github", tool: "request", args: '{"method":"DELETE","path":"/repos/o/r/issues/1"}' });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "github");
	assert.equal(intents[0].action, "api-delete");
	assert.equal(intents[0].target, "/repos/o/r/issues/1");
});

test("MCP classifier blocks hosted mutating HTTP methods", () => {
	const intents = classifyToolCall("posthog_request", { method: "DELETE", path: "/api/projects/1" });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "posthog");
	assert.equal(intents[0].action, "api-delete");
});

test("MCP classifier blocks hosted action mutations but allows hosted reads", () => {
	assert.deepEqual(classifyToolCall("mcp", { server: "directus_prod", tool: "directus_prod_fields", args: '{"action":"read","collection":"block_richtext"}' }), []);
	const intents = classifyToolCall("mcp", { server: "directus_prod", tool: "directus_prod_fields", args: '{"action":"update","collection":"block_richtext"}' });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "directus");
	assert.equal(intents[0].action, "update");
	assert.equal(intents[0].target, "block_richtext");
});

test("MCP classifier ignores non-hosted query text", () => {
	assert.deepEqual(classifyToolCall("mcp", { server: "code-review-graph", tool: "code_review_graph_semantic_search_nodes_tool", query: "Directus mutation update schema" }), []);
});

test("MCP classifier blocks GraphQL mutations but allows queries", () => {
	assert.equal(classifyToolCall("github_graphql", { query: "mutation { closeIssue(input:{}) { clientMutationId } }" }).length, 1);
	assert.equal(classifyToolCall("github_graphql", { query: "mutation CloseIssue($id: ID!) { closeIssue(input:{issueId:$id}) { clientMutationId } }" }).length, 1);
	assert.deepEqual(classifyToolCall("github_graphql", { query: "query { viewer { login } }" }), []);
});

test("MCP classifier allows docs search with natural-language mutation wording", () => {
	const docsSearchInput = {
		query: "How to read feature flag status without update mutation or delete operations?",
		context: "Search docs for safe read-only approaches when checking a feature flag status without making any update or delete operations in production.",
	};

	assert.deepEqual(classifyToolCall("posthog_docs-search", docsSearchInput), []);
	assert.deepEqual(classifyToolCall("mcp", { tool: "posthog_docs-search", args: JSON.stringify(docsSearchInput) }), []);
	assert.deepEqual(
		classifyToolCall("mcp", {
			tool: "posthog_docs-search",
			args: JSON.stringify({ ...docsSearchInput, query: "mutation update delete operations in docs search" }),
		}),
		[],
	);
});

test("extension command exposes guard status and clear", async () => {
	const harness = makeHarness();
	await harness.runCommand("authorize-hosted-mutation", "github pr-merge 123");
	await harness.runCommand("hosted-mutation-guard", "status");
	await harness.runCommand("hosted-mutation-guard", "clear");
	assert.match(harness.notifications.at(-1)?.message ?? "", /cleared/);
});

async function main(): Promise<void> {
	let failed = 0;
	for (const { name, fn } of tests) {
		try {
			await fn();
			console.log(`ok ${name}`);
		} catch (error) {
			failed++;
			console.error(`FAIL ${name}`);
			console.error(error);
		}
	}
	if (failed > 0) {
		console.error(`${failed}/${tests.length} tests failed`);
		process.exit(1);
	}
	console.log(`${tests.length}/${tests.length} tests passed`);
}

await main();
