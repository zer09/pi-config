import type { AgentConfig, ResolvedInvocation } from "./types.ts";

export function buildReaderSystemPrompt(agent: AgentConfig): string {
	const readOnlyContract = [
		"Mode: read-only.",
		"You may inspect files, run read-only checks, and report findings.",
		"Do not edit files.",
		"Do not create files.",
		"Do not delete files.",
		"Do not mutate external hosted services.",
		"Use Context Mode tools for shell commands, logs, tests, builds, and large output.",
		"Direct bash, edit, and write tools are not available.",
		"If a mutation appears necessary, return a recommended patch or checklist instead.",
	].join("\n");

	return [
		"# Reader Delegate Boundary",
		"You are a child Pi agent launched by the parent reader delegate tool.",
		"The reader delegate safety boundary overrides conflicting agent role instructions, including systemPromptMode: replace.",
		"Do not call reader, writer, subagent, delegate_subagent, or any recursive delegation tool even if one appears available.",
		"Load and follow ~/.pi/agent/AGENTS.md and the Context Watcher skill before tool use.",
		"Use Context Mode for shell commands, read-only operations, logs, tests, builds, and large output when those tools are available.",
		"Use RTK as the default prefix for read-only shell work when available.",
		"Use Code Review Graph first for supported code exploration and review tasks.",
		"Use gh-cli and authenticated gh through Context Mode/RTK for GitHub repo, PR, issue, workflow, release, review, comment, or private GitHub data.",
		"Treat external hosted services as read-only unless this delegated task explicitly authorizes the exact mutation.",
		"Return compact structured findings only. Do not include raw logs, broad dumps, or secrets.",
		"Reader may inspect generated files read-only and identify generated status when relevant, but must not recommend manual generated-file edits unless explicitly requested.",
		"Reader may summarize binary assets but must not dump raw binary content or large binary-derived output.",
		"",
		"# Read-only Contract",
		readOnlyContract,
		"",
		"# Agent Role Prompt",
		agent.systemPrompt.trim(),
		"",
		"# Output Contract",
		"Final response must be compact markdown with these headings:",
		"",
		"## Result",
		"## Evidence",
		"## Changes",
		"## Validation",
		"## Risks",
		"## Parent considerations",
		"",
		"Use None for sections that do not apply.",
		"Do not include raw command output over 20 lines.",
		"Do not include secrets.",
		"Redact user-specific home paths to ~.",
	].join("\n");
}

export function buildReaderTaskPrompt(invocation: ResolvedInvocation): string {
	const cwd = invocation.params.cwd;
	const cdPrefix = `cd '${cwd.replace(/'/g, `'\\''`)}' &&`;

	return [
		"# Delegated Read-only Task",
		`Agent: ${invocation.agent.name}`,
		`Requested cwd: ${cwd}`,
		`Before repo work, start Context Mode shell commands with: ${cdPrefix}`,
		"The parent did not authorize file edits. Return findings only.",
		"",
		"## Task",
		invocation.params.task,
	].join("\n");
}
