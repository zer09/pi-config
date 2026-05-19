# Pi simple subagent extension

Registers a single `subagent` tool that runs one user-level Pi agent in a child process with an isolated context window.

## Scope

- Loads agents from `~/.pi/agent/agents/*.md` only.
- Runs one synchronous child task.
- The tool is read-only.
- The child receives only Context Mode read tools.
- The child receives `PI_SIMPLE_SUBAGENT_CHILD=1`, so this extension does not register recursively.
- The parent receives only the child final summary plus compact metadata.

No parallel fanout, chains, TUI, artifacts, intercom, sharing, background state, or agent CRUD are included in v1.

## Tool parameters

```ts
{
  agent: string;
  task: string;
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  cwd?: string;
  timeoutMs?: number;
  maxResultBytes?: number;
  includeDiagnostics?: boolean;
}
```

Defaults:

- `model`: `openai-codex/gpt-5.3-codex`, unless the agent frontmatter or tool call overrides it
- `thinking`: `medium`, unless the agent frontmatter or tool call overrides it
- `cwd`: parent tool context cwd
- `timeoutMs`: `600000`, clamped to `1000..3600000`
- `maxResultBytes`: `24000`
- `includeDiagnostics`: `false`

## Agent files

Agent definitions are markdown files in `~/.pi/agent/agents/*.md` with simple frontmatter:

```md
---
name: investigator
description: Read-only root cause investigation.
model: openai-codex/gpt-5.3-codex
thinking: medium
tools: ctx_execute, ctx_execute_file, ctx_batch_execute, ctx_search
---

Role prompt here.
```

Supported frontmatter fields:

- `name`: required
- `description`: optional
- `model`: optional (`default` is treated as no agent-level override)
- `thinking`: optional
- `tools`: ignored in v1 because the child always receives only Context Mode read tools
- `systemPromptMode`: parsed as `append` or `replace`; v1 still appends a safety boundary and output contract

## Safety behavior

The extension ignores agent-file tool allowlists and always uses only Context Mode read tools. Built-in `bash`, `edit`, and `write` are never passed to the child.

The child system prompt requires Context Watcher, Context Mode/RTK, Code Review Graph when applicable, GitHub routing through `gh-cli`, and the external hosted service mutation gate.

Each target `cwd` also gets a persistent Pi session directory under `~/.pi/agent/subagent-sessions/<absolute-cwd-segments>`. The child is launched with `--session-dir` and `--continue` instead of `--no-session` so Pi and Context Mode can retain per-target session memory and indexes.

The delegated task prompt includes the requested `cwd` plus one concise Context Mode shell prefix hint: `cd '<cwd>' &&`.

## Validation

Unit and fake-child integration checks:

```bash
bun ~/.pi/agent/extensions/simple-subagent/simple-subagent.test.ts
```

Syntax and extension-load checks:

```bash
bun build ~/.pi/agent/extensions/simple-subagent/index.ts --target=node --external @earendil-works/pi-coding-agent --external @earendil-works/pi-ai --external typebox --outfile=/tmp/simple-subagent-check.js
node --check /tmp/simple-subagent-check.js
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 pi --no-extensions -e ~/.pi/agent/extensions/simple-subagent/index.ts --list-models definitely-no-such-model-filter
```

Manual smoke test after `/reload` or Pi restart:

```text
Use subagent with agent "investigator" and task "Report the current working directory and list the relevant context files. Do not edit files."
```
