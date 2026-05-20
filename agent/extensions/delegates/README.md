# Pi delegates extension

Registers delegate tools that run user-level Pi agents in child processes with isolated context windows.

Milestone A exposes only the `reader` tool. `writer` is intentionally not registered yet.

## Current tool surface

- `reader`: runs one synchronous read-only child task and returns the child final summary plus compact metadata.

Not registered in Milestone A:

- `writer`
- `subagent` compatibility alias

## Reader scope

The `reader` child receives only read-oriented Context Mode tools. It cannot edit files through the provided tool list.

The child receives `PI_DELEGATE_CHILD=1` and `PI_DELEGATE_KIND=reader`, so delegate tools are not registered recursively in child processes.

The parent agent remains the orchestrator. Reader output uses `## Parent considerations` rather than telling the child or parent to call another delegate next.

## Reader parameters

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

Defaults and precedence:

- `model`: call param, then agent file, then `openai-codex/gpt-5.3-codex`
- `thinking`: call param, then agent file, then `medium`
- `cwd`: parent tool context cwd
- `timeoutMs`: `600000`, clamped to `1000..3600000`
- `maxResultBytes`: `24000`, clamped to `1000..1000000`
- `includeDiagnostics`: `false`

## Agent files

Reader loads agents from:

```text
~/.pi/agent/agents/*.md
```

Supported frontmatter fields:

- `name`: optional; defaults to file basename
- `description`: optional
- `model`: optional; `default` is treated as no override
- `thinking`: optional
- `systemPromptMode`: `append` or `replace`

Delegate safety boundaries always remain in the child system prompt. `systemPromptMode` affects only the agent role text and cannot remove reader safety rules.

## Progress UI

The tool emits progress through `onUpdate` with compact details for phases such as:

- `starting`
- `launching_child`
- `child_event`
- `finishing`

Progress details include a redacted task preview and do not include raw child stdout, stderr, tool arguments, or diffs. Progress text is not appended to the final model-visible `content`.

## Result shape

Reader returns:

- `content`: the redacted and truncated child final answer
- `details`: compact metadata including agent, model, thinking, cwd, status, exit code, duration, tool-call count, and truncation status

Diagnostics are bounded and redacted. They are included only when `includeDiagnostics` is true.

## Validation

```bash
bun agent/extensions/delegates/delegates.test.ts
bun build agent/extensions/delegates/index.ts --target=node --external @earendil-works/pi-coding-agent --external @earendil-works/pi-ai --external @earendil-works/pi-tui --external typebox --outfile=/tmp/delegates-check.js
node --check /tmp/delegates-check.js
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 pi --no-extensions -e agent/extensions/delegates/index.ts --list-models definitely-no-such-model-filter
```

## Milestone B preview

Milestone B will add `writer` with exact-file `allowedPaths`, fresh sessions, restricted write tools, and child path/text guards. It is not available in Milestone A.
