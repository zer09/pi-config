import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
	assert.equal(classifyShellCommand("git --literal-pathspecs push origin main")[0].action, "git-push");
	assert.equal(classifyShellCommand("git --glob-pathspecs push origin main")[0].action, "git-push");
	assert.equal(classifyShellCommand("git --noglob-pathspecs push origin main")[0].action, "git-push");
	assert.equal(classifyShellCommand("git --icase-pathspecs push origin main")[0].action, "git-push");
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
	assert.equal(classifyShellCommand("env -- git push origin main")[0].action, "git-push");
	assert.equal(classifyShellCommand("command -- gh pr merge 123")[0].action, "pr-merge");
});

test("classifier blocks shell command substitutions", () => {
	assert.equal(classifyShellCommand("echo $(gh pr merge 123)")[0].action, "pr-merge");
	assert.equal(classifyShellCommand("bash -lc \"echo $(git push origin main)\"")[0].action, "git-push");
	assert.equal(classifyShellCommand("echo `gh issue close 5`")[0].action, "issue-close");
	assert.deepEqual(classifyShellCommand("echo '$(gh pr merge 123)'"), []);
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

test("classifier reads GitHub body-file payloads", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hosted-guard-body-file-"));
	const bodyPath = path.join(dir, "body.md");
	fs.writeFileSync(bodyPath, "hello from file\n", "utf8");
	const intents = classifyShellCommand(`gh pr comment 123 --body-file ${bodyPath}`);
	assert.equal(intents.length, 1);
	assert.equal(intents[0].body, "hello from file\n");
});

test("classifier blocks PR creation and implicit-target PR review", () => {
	const [create] = classifyShellCommand('gh pr create --title "T" --body "B"');
	assert.equal(create.action, "pr-create");
	assert.equal(create.target, "new pull request");
	assert.equal(create.tier, 2);
	assert.ok(create.body?.includes("--title"));

	const [review] = classifyShellCommand("gh pr review --approve");
	assert.equal(review.action, "pr-review");
	assert.equal(review.target, "current pull request");
	assert.equal(review.tier, 2);
	assert.ok(review.body?.includes("--approve"));

	const [issue] = classifyShellCommand('gh issue create --title "T" --body "B"');
	assert.equal(issue.action, "issue-create");
	assert.equal(issue.target, "new issue");
	assert.equal(issue.tier, 2);
});

test("classifier handles gh repo flags before groups and subcommands", () => {
	assert.equal(classifyShellCommand("gh pr -R owner/repo merge")[0].action, "pr-merge");
	assert.equal(classifyShellCommand("gh -R owner/repo pr close 3")[0].action, "pr-close");
	assert.equal(classifyShellCommand("gh pr --repo owner/repo unlock")[0].action, "pr-unlock");
	const [edit] = classifyShellCommand("gh issue -R owner/repo edit 101 --title New");
	assert.equal(edit.action, "issue-edit");
	assert.equal(edit.target, "101");
});

test("classifier scopes issue edit to every positional issue", () => {
	const [edit] = classifyShellCommand("gh issue edit 23 34 --add-label bug");
	assert.equal(edit.action, "issue-edit");
	assert.equal(edit.target, "23 34");
	assert.equal(edit.tier, 2);
	assert.ok(edit.body?.includes("--add-label"));
});

test("classifier blocks issue lock and unlock", () => {
	assert.equal(classifyShellCommand("gh issue lock 123")[0].action, "issue-lock");
	assert.equal(classifyShellCommand("gh issue unlock 123")[0].action, "issue-unlock");
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
	assert.equal(intents[0].body, JSON.stringify(["-f", "title=New"]));

	const [implicitPost] = classifyShellCommand("gh api repos/o/r/issues/1/comments -f body=Done");
	assert.equal(implicitPost.action, "issue-comment");
	assert.equal(implicitPost.target, "1");
	assert.equal(implicitPost.body, "Done");

	const [fieldPost] = classifyShellCommand("gh api repos/o/r/issues/1 -F title=New --raw-field state=open");
	assert.equal(fieldPost.action, "api-post");
	assert.equal(fieldPost.body, JSON.stringify(["-F", "title=New", "--raw-field", "state=open"]));
});

test("classifier blocks Firebase and GCP deploys", () => {
	assert.equal(classifyShellCommand("firebase deploy")[0].action, "deploy");
	assert.equal(classifyShellCommand("gcloud run deploy service")[0].service, "gcloud");
});

test("classifier blocks expanded cloud CLI mutations", () => {
	assert.equal(classifyShellCommand("aws iam attach-role-policy --role-name r --policy-arn arn:x")[0].action, "attach-role-policy");
	assert.equal(classifyShellCommand("aws lambda update-function-code --function-name f --zip-file fileb://x.zip")[0].action, "update-function-code");
	assert.equal(classifyShellCommand("aws s3 rm s3://bucket/key")[0].action, "rm");
	assert.equal(classifyShellCommand("gcloud services enable run.googleapis.com")[0].action, "enable");
	assert.deepEqual(classifyShellCommand("aws s3 ls"), []);
	assert.deepEqual(classifyShellCommand("aws s3 cp s3://bucket/key ."), []);
});

test("classifier blocks mutating hosted HTTP requests but not localhost", () => {
	assert.equal(classifyShellCommand("curl -X DELETE https://api.github.com/repos/o/r/issues/1")[0].service, "github");
	assert.equal(classifyShellCommand("curl -d body=Done https://api.github.com/repos/o/r/issues/1/comments")[0].action, "http-post");
	assert.equal(classifyShellCommand("curl --form file=@a.txt https://api.github.com/repos/o/r/releases/assets")[0].action, "http-post");
	assert.deepEqual(classifyShellCommand("curl -G -d q=test https://api.github.com/search/issues"), []);
	assert.deepEqual(classifyShellCommand("curl -X POST http://localhost:3000/test"), []);
});

test("classifier blocks ctx_execute shell hosted mutations", () => {
	const intents = classifyToolCall("ctx_execute", { language: "shell", code: "firebase deploy" });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "firebase");
	assert.equal(intents[0].action, "deploy");
	assert.equal(intents[0].source, "ctx_execute");

	const prefixed = classifyToolCall("context_mode_ctx_execute", { language: "bash", code: "git push origin main" });
	assert.equal(prefixed.length, 1);
	assert.equal(prefixed[0].action, "git-push");
	assert.equal(prefixed[0].source, "ctx_execute");
});

test("classifier allows ctx_execute read-only shell commands", () => {
	assert.deepEqual(classifyToolCall("ctx_execute", { language: "shell", code: "git status" }), []);
	assert.deepEqual(classifyToolCall("context_mode_ctx_execute", { language: "shell", code: "gh pr view 123" }), []);
});

test("classifier blocks Context Mode batch hosted mutations", () => {
	const intents = classifyToolCall("ctx_batch_execute", { commands: [{ command: "gh pr view 1" }, { command: "gh pr merge 1" }] });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "github");
	assert.equal(intents[0].action, "pr-merge");
	assert.equal(intents[0].source, "ctx_batch_execute");

	const prefixed = classifyToolCall("context_mode_ctx_batch_execute", { commands: [{ command: "gh issue close 2" }] });
	assert.equal(prefixed.length, 1);
	assert.equal(prefixed[0].action, "issue-close");
	assert.equal(prefixed[0].source, "ctx_batch_execute");
});

test("classifier allows Context Mode batch read-only commands", () => {
	assert.deepEqual(classifyToolCall("ctx_batch_execute", { commands: [{ command: "gh pr view 1" }, { command: "git status" }] }), []);
	assert.deepEqual(classifyToolCall("context_mode_ctx_batch_execute", { commands: [{ command: "gh issue list" }] }), []);
});

test("classifier blocks ctx_execute code execution sinks", () => {
	const intents = classifyToolCall("ctx_execute", { language: "javascript", code: "require('child_process').execSync('gh pr merge 123')" });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].action, "pr-merge");
	assert.equal(intents[0].source, "ctx_execute");

	const escaped = classifyToolCall("ctx_execute_file", { path: "README.md", language: "javascript", code: String.raw`require('child_process').execSync(\"gh pr merge 123\")` });
	assert.equal(escaped[0].action, "pr-merge");

	const escapedSingle = classifyToolCall("ctx_execute", { language: "javascript", code: String.raw`require(\'child_process\').execSync(\'gh pr merge 123\')` });
	assert.equal(escapedSingle.length, 1);
	assert.equal(escapedSingle[0].target, "123");

	const unicodeEscapedSpaces = classifyToolCall("ctx_execute", { language: "javascript", code: String.raw`require(\"child_process\").execSync(\"gh\u0020pr\u0020merge\u0020123\")` });
	assert.equal(unicodeEscapedSpaces.length, 1);
	assert.equal(unicodeEscapedSpaces[0].target, "123");
});

test("classifier blocks ctx_execute hosted HTTP code", () => {
	const intents = classifyToolCall("context_mode_ctx_execute", { language: "typescript", code: "await fetch('https://api.github.com/repos/o/r', { method: 'DELETE' })" });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "github");
	assert.equal(intents[0].action, "http-delete");
	assert.equal(intents[0].source, "ctx_execute");

	const axios = classifyToolCall("ctx_execute", { language: "javascript", code: "await axios.delete('https://api.github.com/repos/o/r')" });
	assert.equal(axios[0].action, "http-delete");

	const requests = classifyToolCall("ctx_execute", { language: "python", code: "import requests\nrequests.delete('https://api.github.com/repos/o/r')" });
	assert.equal(requests[0].action, "http-delete");
});

test("classifier blocks Context Mode execution sinks across runtimes", () => {
	const cases: Array<[string, string, string]> = [
		["python", "import subprocess\nsubprocess.run(['git', 'push', 'origin', 'main'])", "git-push"],
		["ruby", "system('gh pr merge 123')", "pr-merge"],
		["perl", "system('gh pr merge 123')", "pr-merge"],
		["go", "exec.Command('git', 'push', 'origin', 'main').Run()", "git-push"],
		["rust", "Command::new('gh').arg('pr').arg('merge').arg('123').status()", "pr-merge"],
		["php", "shell_exec('gh pr merge 123');", "pr-merge"],
		["csharp", "Process.Start('git', 'push origin main');", "git-push"],
	];
	for (const [language, code, action] of cases) {
		const intents = classifyToolCall("ctx_execute", { language, code });
		assert.equal(intents[0]?.action, action, language);
		assert.equal(intents[0]?.source, "ctx_execute");
		const fileIntents = classifyToolCall("context_mode_ctx_execute_file", { path: "README.md", language, code });
		assert.equal(fileIntents[0]?.action, action, language);
		assert.equal(fileIntents[0]?.source, "ctx_execute_file");
	}
});

test("classifier blocks ctx_execute_file code without inspecting path or file contents", () => {
	const intents = classifyToolCall("ctx_execute_file", { path: "README.md", language: "javascript", code: "require('child_process').execSync('git push origin main')" });
	assert.equal(intents.length, 1);
	assert.equal(intents[0].service, "git");
	assert.equal(intents[0].action, "git-push");
	assert.equal(intents[0].source, "ctx_execute_file");

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

test("one-time authorization requires payload hash for tier 1 only", () => {
	assert.match((parseOneTimeAuthorization("github pr-comment 123") as any).error, /requires body-sha256/);
	assert.ok(!("error" in parseOneTimeAuthorization("github pr-edit 123")));
	assert.ok(!("error" in parseOneTimeAuthorization("github pr-merge 123")));
});

test("command authorization without payload never matches tier 1 or payload-bearing tier 2", () => {
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

test("command authorization permits implicit-target tier 2 with exact payload hash", () => {
	const [intent] = classifyShellCommand("gh pr review --approve");
	const auth = parseOneTimeAuthorization(`github pr-review current pull request body-sha256:${sha256(intent.body ?? "")}`);
	assert.ok(!("error" in auth));
	assert.equal(matchesAuthorization(intent, auth), true);

	const [issue] = classifyShellCommand('gh issue create --title "T" --body "B"');
	const issueAuth = parseOneTimeAuthorization(`github issue-create new issue body-sha256:${sha256(issue.body ?? "")}`);
	assert.ok(!("error" in issueAuth));
	assert.equal(matchesAuthorization(issue, issueAuth), true);
});

test("command authorization permits tier 2 field edits with exact payload hash", () => {
	const [intent] = classifyShellCommand("gh issue edit 23 --add-label bug");
	const [wrong] = classifyShellCommand("gh issue edit 23 --add-label security");
	const auth = parseOneTimeAuthorization(`github issue-edit 23 body-sha256:${sha256(intent.body ?? "")}`);
	assert.ok(!("error" in auth));
	assert.equal(matchesAuthorization(intent, auth), true);
	assert.equal(matchesAuthorization(wrong, auth), false);
});

test("command authorization binds gh api mutations to request fields", () => {
	const [intent] = classifyShellCommand("gh api repos/o/r/issues/1 -f title=New");
	const [wrong] = classifyShellCommand("gh api repos/o/r/issues/1 -f title=Different");
	const auth = parseOneTimeAuthorization(`github api-post repos/o/r/issues/1 body-sha256:${sha256(intent.body ?? "")}`);
	assert.ok(!("error" in auth));
	assert.equal(matchesAuthorization(intent, auth), true);
	assert.equal(matchesAuthorization(wrong, auth), false);
});

test("command authorization permits bodyless tier 2 when no payload exists", () => {
	const intent = { service: "github", action: "api-patch", tier: 2 as const, target: "repos/o/r/settings", source: "mcp" as const, reason: "GitHub API PATCH" };
	const auth = parseOneTimeAuthorization("github api-patch repos/o/r/settings");
	assert.ok(!("error" in auth));
	assert.equal(matchesAuthorization(intent, auth), true);
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

test("extension blocks Context Mode batch mutations before execution", async () => {
	const harness = makeHarness();
	const result = await harness.call("ctx_batch_execute", { commands: [{ command: "gh pr view 123" }, { command: "gh pr merge 123" }] });
	assertBlocked(result);
	assert.equal((harness.entries[0].data as { toolName?: string }).toolName, "ctx_batch_execute");
});

test("extension allows Context Mode read-only calls", async () => {
	const harness = makeHarness();
	assert.equal(await harness.call("ctx_execute", { language: "shell", code: "git status" }), undefined);
	assert.equal(await harness.call("ctx_batch_execute", { commands: [{ command: "gh pr view 123" }] }), undefined);
	assert.equal(await harness.call("ctx_execute_file", { path: "README.md", language: "javascript", code: "console.log(FILE_CONTENT.length)" }), undefined);
});

test("extension allows one command-authorized Context Mode mutation", async () => {
	const harness = makeHarness();
	await harness.runCommand("authorize-hosted-mutation", "github pr-merge 123");
	assert.equal(await harness.call("ctx_execute", { language: "shell", code: "gh pr merge 123" }), undefined);
	assertBlocked(await harness.call("ctx_execute", { language: "shell", code: "gh pr merge 123" }));
});

test("extension allows local tools", async () => {
	const harness = makeHarness();
	assert.equal(await harness.call("read", { path: "agent/mcp.json" }), undefined);
	assert.equal(await harness.call("write", { path: "tmp.txt", content: "hello" }), undefined);
	assert.equal(await harness.call("write", { path: "tmp/tool-hook-issue/tool-hook-block-report.md", content: "Directus production schema update report. Linear SB-5219 mutation notes." }), undefined);
	assert.equal(await harness.call("edit", { path: "tmp.txt", edits: [] }), undefined);
});

test("classifier allows non-executable Context Mode tools", () => {
	const tools = [
		"ctx_search",
		"context_mode_ctx_search",
		"ctx_index",
		"context_mode_ctx_index",
		"ctx_fetch_and_index",
		"context_mode_ctx_fetch_and_index",
		"ctx_stats",
		"context_mode_ctx_stats",
		"ctx_doctor",
		"context_mode_ctx_doctor",
		"ctx_upgrade",
		"context_mode_ctx_upgrade",
		"ctx_purge",
		"context_mode_ctx_purge",
		"ctx_insight",
		"context_mode_ctx_insight",
	];
	for (const toolName of tools) {
		assert.deepEqual(classifyToolCall(toolName, { query: "delete GitHub issue", content: "Directus update notes", url: "https://github.com/example/repo" }), [], toolName);
	}
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

	const largeArgs = JSON.stringify({ method: "PATCH", url: "https://api.github.com/repos/o/r/issues/1", filler: "x".repeat(60_000) });
	const large = classifyToolCall("mcp", { server: "posthog", tool: "request", args: largeArgs });
	assert.equal(large[0].service, "github");
	assert.equal(large[0].action, "api-patch");
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

test("MCP classifier covers configured hosted MCP servers", () => {
	assert.deepEqual(classifyToolCall("mcp", { server: "chrome-devtools", tool: "navigate_page", args: '{"url":"https://example.com"}' }), []);
	assert.deepEqual(classifyToolCall("mcp", { server: "chrome-devtools", tool: "update_item", args: '{"id":"1"}' }), []);
	assert.deepEqual(classifyToolCall("mcp", { server: "codebase-memory-mcp", tool: "codebase_memory_mcp_search_graph", query: "mutation update schema" }), []);
	assert.deepEqual(classifyToolCall("mcp", { server: "context-mode", tool: "update_item", args: '{"id":"1"}' }), []);
	assert.equal(classifyToolCall("mcp", { server: "notion", tool: "notion_update_page", args: '{"id":"page-1"}' })[0].action, "update");
	assert.equal(classifyToolCall("mcp", { server: "figma", tool: "figma_create_component", args: '{"nodeId":"1:2"}' })[0].action, "create");
	assert.equal(classifyToolCall("mcp", { server: "firebase", tool: "firebase_delete_app", args: '{"project":"p"}' })[0].action, "delete");
	assert.equal(classifyToolCall("mcp", { server: "posthog", tool: "posthog_create_feature_flag", args: '{"name":"flag"}' })[0].action, "create");
	assert.equal(classifyToolCall("mcp", { server: "directus_prod", tool: "directus_prod_items", args: '{"action":"delete","collection":"articles"}' })[0].action, "delete");
});

test("MCP classifier ignores non-hosted query text", () => {
	assert.deepEqual(classifyToolCall("mcp", { server: "codebase-memory-mcp", tool: "codebase_memory_mcp_search_graph", query: "Directus mutation update schema" }), []);
	assert.deepEqual(classifyToolCall("mcp", { server: "codebase-memory-mcp", tool: "request", args: '{"method":"GET","url":"https://api.github.com/repos/o/r/issues/1"}' }), []);
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
