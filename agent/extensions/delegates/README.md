# Pi delegates extension

Registers delegate tools that run user-level Pi agents in child processes with isolated context windows.

Current tools:

- `reader`: read-only investigation, review, validation planning, and documentation research.
- `writer`: tightly scoped local text-file changes for exact files listed by the parent.

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

## Writer scope

The `writer` child receives only `read`, `edit`, and `write`.

Writer uses fresh sessions per invocation and does not pass `--continue`. The session directory is deleted on success. On failure, the session is preserved only when `includeDiagnostics` is true.

Writer is text-only in v1:

- `allowedPaths` must be non-empty.
- Each `allowedPaths` entry is one exact file path, not a directory.
- Existing allowed paths must be text files.
- Relative allowed paths resolve against normalized `cwd`.
- Allowed paths must stay inside `cwd` and must not escape through symlinks.
- Existing files must be changed with `edit`.
- `write` may only create an exact missing file listed in `allowedPaths`.
- Writer cannot delete files.
- Writer cannot run shell, Context Mode command/search tools, package managers, commits, pushes, deployments, or hosted-service mutations.

The child receives `PI_DELEGATE_ALLOWED_PATHS` as JSON encoded resolved exact file paths. Child `tool_call` guards enforce exact-path and text-only boundaries in addition to the restricted `--tools` list.

## Writer parameters

```ts
{
  agent: string;
  task: string;
  allowedPaths: string[];
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  cwd?: string;
  timeoutMs?: number;
  maxResultBytes?: number;
  includeDiagnostics?: boolean;
}
```

Defaults and precedence:

- `model`: call param, then agent file, then `openai-codex/gpt-5.3-codex-spark`
- `thinking`: call param, then agent file, then `medium`
- `cwd`: parent tool context cwd, normalized to an existing real directory
- `timeoutMs`: `600000`, clamped to `1000..3600000`
- `maxResultBytes`: `24000`, clamped to `1000..1000000`
- `includeDiagnostics`: `false`

## Agent files

Delegates load agents from:

```text
~/.pi/agent/agents/*.md
```

Supported frontmatter fields:

- `name`: optional; defaults to file basename
- `description`: optional
- `model`: optional; `default` is treated as no override
- `thinking`: optional
- `systemPromptMode`: `append` or `replace`

Delegate safety boundaries always remain in the child system prompt. `systemPromptMode` affects only the agent role text and cannot remove reader or writer safety rules.

## Progress UI

Both tools emit progress through `onUpdate` with compact details for phases such as:

- `starting`
- `launching_child`
- `child_event`
- `diff_ready` for writer
- `finishing`

Progress details include a redacted task preview and do not include raw child stdout, stderr, or tool arguments. Writer diff previews are parent-computed, capped, redacted, and carried in UI `details` for rendering rather than final model-visible `content`. The writer renderer shows the capped diff preview in the collapsed result row and when expanded. The preview uses four context lines to match Pi's native `edit` diff context.

## Result shape

Delegates return:

- `content`: model-visible text. Reader returns the redacted and truncated child final answer. Writer returns a compact changed-file summary, not the full diff or child stdout/stderr.
- `details`: compact metadata including agent, model, thinking, cwd, status, exit code, duration, tool-call count, and truncation status. Writer details may include capped `changedFiles`, `changedFileCount`, `skippedDiffCount`, `changedFilesTruncated`, `diffPreview`, and `diffTruncated` for TUI rendering.

Diagnostics are bounded and redacted. They are included only when `includeDiagnostics` is true.

## Validation

```bash
bun agent/extensions/delegates/delegates.test.ts
bun build agent/extensions/delegates/index.ts --target=node --external @earendil-works/pi-coding-agent --external @earendil-works/pi-ai --external @earendil-works/pi-tui --external typebox --outfile=/tmp/delegates-check.js
node --check /tmp/delegates-check.js
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 pi --no-extensions -e agent/extensions/delegates/index.ts --list-models definitely-no-such-model-filter
```
