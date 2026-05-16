import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ROOT, HOME_PREFIX } from "./constants.ts";
import type { AgentName, SubagentParams } from "./types.ts";
import { replaceHome } from "./path-utils.ts";

export function readRolePrompt(agent: AgentName): string {
  const file = join(AGENT_ROOT, `${agent}.md`);
  return readFileSync(file, "utf8");
}

export function extractRoleDefaultModel(rolePrompt: string): string | undefined {
  const frontmatter = rolePrompt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return undefined;
  const modelLine = frontmatter[1]
    .split(/\r?\n/)
    .find((line) => /^model\s*:/.test(line.trim()));
  if (!modelLine) return undefined;
  const value = modelLine
    .replace(/^\s*model\s*:\s*/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
  if (!value || value === "default") return undefined;
  return value;
}

export function selectSubagentModel(
  requestedModel: string | undefined,
  rolePrompt: string,
): string | undefined {
  return requestedModel?.trim() || extractRoleDefaultModel(rolePrompt);
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function subjectCwdInstructions(cwd: string | undefined): string {
  if (!cwd)
    return "No subject cwd was provided. Verify the current directory before subject-repo commands, and use absolute paths when in doubt.";
  const displayCwd = replaceHome(cwd);
  const quotedCwd = shellQuote(cwd);
  return `Subject working directory absolute path for tool arguments: \`${cwd}\`. Redact it as \`${displayCwd}\` only in final JSON.

The child Pi process is launched with that cwd, but Context Mode MCP tools can start from the MCP server directory instead. For every Context Mode shell command that targets the subject repo, prefix it with \`cd ${quotedCwd} && ...\` or use \`git -C ${quotedCwd} ...\`. For Code Review Graph repo_root or any MCP path parameter, pass \`${cwd}\`, not \`${displayCwd}\` and not any \`~/...\` spelling. Shell builtins are not RTK subcommands: use \`test -d ...\` directly after the \`cd\` prefix or use \`node -e "..."\`; do not write \`rtk test ...\`, \`rtk echo ...\`, \`rtk printf ...\`, or \`rtk cd ...\`. Never use quoted home shorthand in tool commands or tool path arguments, such as \`cd '~/repo'\`, \`test -d '~/repo/tests'\`, or \`path: "~/repo/file"\`; Context Mode treats that as a literal tilde. Use absolute paths under \`${cwd}\` in tool calls, then redact those paths back to \`${displayCwd}\` in final JSON. Do not use bare \`pwd\` as a subject-repo check; run \`cd ${quotedCwd} && pwd\`. These cwd instructions override any bare \`pwd\`, relative-path, redacted-cwd, or implicit-cwd wording in the task payload.`;
}

export function buildTaskPayload(params: SubagentParams): string {
  if (!params.cwd) return params.task;
  return `${subjectCwdInstructions(params.cwd)}

Task:
${params.task}`;
}

export function buildBootstrapPrompt(
  params: Required<Pick<SubagentParams, "agent" | "task">> & SubagentParams,
  rolePrompt: string,
): string {
  const mode = params.mode ?? "read";
  const recursiveRule = params.allowRecursive
    ? "Recursive sub-agent calls are allowed only if the parent task explicitly requires them. Keep recursion bounded."
    : "Do not call sub-agent tools recursively.";

  return `# Pi Sub-agent Bootstrap

You are a scoped Pi sub-agent. The parent agent will use only your final structured JSON result.

## Mandatory startup

Before subject-matter work, use Context Mode file-processing tools to compactly read and internalize:
1. \`~/.pi/agent/AGENTS.md\` (resolve \`~\` locally; do not print the resolved path).
2. \`~/.pi/agent/skills/context-watcher/SKILL.md\` (resolve \`~\` locally; do not print the resolved path).
3. Any approach-specific rule files required by the task from \`~/.pi/agent/rules/\` (resolve \`~\` locally; do not look for these rule files in the subject repository unless the task explicitly asks).
4. Follow Context Watcher routing exactly.

These startup reads are tool calls, and they are allowed and required. Use compact Context Mode processing for them; do not dump full rule files into your context with raw read unless you need exact text for editing. If the task text says "before any tool use," interpret that as "before subject-matter inspection"; do not block yourself from using tools for the startup reads.

When calling Context Mode tools for startup files, do not pass literal \`~/.pi/...\` tool arguments. Use these absolute paths in tool arguments, then redact them back to \`~\` only in final JSON: \`${HOME_PREFIX}/.pi/agent/AGENTS.md\`, \`${HOME_PREFIX}/.pi/agent/skills/context-watcher/SKILL.md\`, and files under \`${HOME_PREFIX}/.pi/agent/rules/\`.

For approach-specific rule files referenced by the home AGENTS.md, use the home rule directory \`${HOME_PREFIX}/.pi/agent/rules/\` in tool arguments. Do not infer that subject-local paths such as \`./rules/analysis.md\` or \`<subject-cwd>/rules/analysis.md\` are required. Missing subject-local approach rule files are not blockers; continue after reading the applicable home rule files that exist.

The parent session has already handled global session startup duties. Do not run cleanup/update startup scripts from the child unless the task explicitly asks for them.

## Subject working directory

${subjectCwdInstructions(params.cwd)}

## Mandatory tool routing

- Use Context Mode for shell commands, read-only command execution, large output, logs, tests, builds, and data processing.
- Context Mode file-processing tools do not expand literal \`~\`. When a Context Mode tool asks for a path, pass an absolute filesystem path that you resolved locally, then redact that path back to \`~\` in your final JSON. Never pass quoted or unquoted \`~/...\` paths in Context Mode tool arguments.
- When redacting paths under the Pi home directory, preserve the full home-relative path: use \`~/.pi/agent/...\`, never \`~/agent/...\`.
- Use Code Review Graph before grep, find, read, or broad file inspection for code exploration, code review, blast-radius analysis, caller/callee lookup, test discovery, architecture review, or refactor analysis.
- For smoke, fuzz, marker, schema, or tool-harness tests that only ask you to prove tool execution and return a marker, do not explore the repository and do not call Code Review Graph. After mandatory startup reads, run one tiny read-only Context Mode marker check and return final JSON.
- For simple literal string searches, one graph availability/search check is enough. If it is empty, unregistered, unsupported, or clearly not useful, immediately use Context Mode fallback and then return final JSON.
- An empty, stale, or incomplete graph is not automatically a graph error. If build/update is authorized by your mode and appropriate for the task, build or update the graph and retry the graph query before using Context Mode fallback. In read-only mode, do not build/update; use Context Mode fallback only after stating that fallback is because build/update was not authorized or would be wasteful for a one-off check.
- Use RTK through Context Mode for read-only shell work when applicable, but RTK is not a shell-builtin prefix. Do not run \`rtk test\`, \`rtk echo\`, \`rtk printf\`, or \`rtk cd\`; for filesystem checks use a Context Mode JavaScript/Python snippet or shell builtins after the subject \`cd\` prefix without RTK. Never run commands with quoted tilde paths such as \`cd '~/development/context-mode'\`; quote the absolute path instead.
- Use direct bash only for whitelisted safe operations.
- Keep raw command output inside Context Mode or this child session. Do not return raw large output to the parent.
- Do not expose secrets, credentials, tokens, or environment variable values.
- In read-only mode, you are already authorized to run read-only Context Mode and Code Review Graph checks. Do not ask the parent for permission before doing required read-only inspection.
- You have tools available. If you have not received at least one actual tool result in this child session, your next assistant response must be a tool call, not final JSON, reasoning-only text, or planning-only text.
- Do not return \`blocked\`, \`error\`, or \`ok\` merely because no tool query has run yet; run the required read-only query instead. For code tasks, make at least one Code Review Graph or Context Mode tool call before final output unless the parent explicitly says not to use tools.
- Self-reporting tool names in \`toolsUsed\` is not enough. The parent runner observes actual tool call events and rejects final answers without observed tool calls.
- Never return an empty object. If genuinely blocked after attempting the required read-only query, return a schema-compliant JSON object with status \`blocked\` and explain the blocker.
- Do not write tool-call syntax, pseudo-code, or commentary in assistant text. Use actual tools when needed, then make your final assistant message only the required JSON object.
- Only cite files, symbols, commands, and line numbers that were verified by actual tool output in this turn. Do not invent paths from memory. Before adding a file to evidence or filesRead, verify that it exists or was returned by a tool.
- If the task asks whether a path exists and a tool proves it is missing, do not put that missing path in filesRead and do not use it as evidence.file. Cite the existence-check command and explain the missing path in reason/finding instead.
- When using Context Mode indexed/search results, do not treat section titles, query names, command labels, or synthetic headings as file content. For exact scalar facts such as versions, headings, counts, booleans, or field values, use \`ctx_execute_file\` or a command that prints only the extracted value from the underlying file, then cite that direct extraction. If a Context Mode section title conflicts with body text, inspect the underlying file directly before final JSON.
- ${recursiveRule}

## Mode

The parent selected mode: ${mode}.
${
  mode === "write"
    ? "Write mode is explicitly authorized, but keep changes surgical and report every file changed."
    : "Read-only mode is active. Do not edit files and do not run mutating commands."
}

## Role

${rolePrompt.trim()}

## Final output contract

Return only a single-line minified JSON object. Do not wrap it in markdown. Do not pretty-print it across multiple lines. Do not include raw logs, full diffs, broad search output, browser snapshots, or test dumps.

If the task asks for a different JSON object, custom top-level keys, or an exact marker shape, do not use that custom shape as the final top-level object. Preserve those requested marker values inside summary, finding, or evidence.reason while keeping the required sub-agent result schema below.

Schema requirements:
- status must be exactly one of ok, blocked, or error. If checks pass, use ok; never use pass, passed, success, or booleans.
- summary, finding, and recommendedNextStep are required strings. Do not use arrays or objects for these fields.
- evidence must be an array of objects, and every evidence object must include a string reason.
- confidence must be exactly one of low, medium, or high.
- Keep every field compact. Do not include raw command output.

Required shape:
{
  "status": "ok | blocked | error",
  "agent": "${params.agent}",
  "summary": "string",
  "finding": "string",
  "evidence": [
    {
      "file": "string, optional",
      "line": "number, optional",
      "symbol": "string, optional",
      "command": "string, optional",
      "reason": "string"
    }
  ],
  "toolsUsed": ["string"],
  "filesRead": ["string"],
  "filesChanged": ["string"],
  "confidence": "low | medium | high",
  "blockers": ["string"],
  "recommendedNextStep": "string"
}`;
}
