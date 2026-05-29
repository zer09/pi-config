# Pi delegates extension

Registers delegate tools that run user-level Pi agents in child processes with isolated context windows.

Current tools:

- `reader`: read-only investigation, review, validation planning, and documentation research.
- `writer`: tightly scoped local text-file changes for exact files listed by the parent.

## Reader scope

The `reader` child receives only read-oriented Context Mode tools. It cannot edit files through the provided tool list.

The child receives `PI_DELEGATE_CHILD=1` and `PI_DELEGATE_KIND=reader`, so delegate tools are not registered recursively in child processes.

The parent agent remains the orchestrator. Reader output uses `## Parent considerations` rather than telling the child or parent to call another delegate next.

Delegate session directories use reversible, collision-resistant cwd encoding, for example `/home/gc/.pi` maps to `--%2Fhome%2Fgc%2F.pi--` under `~/.pi/agent/delegate-sessions/{reader,writer}/`. Very long cwd, agent, and session-key values are stored as hashed segments to stay under per-segment filesystem limits.

Reader uses a fresh `run-*` session directory by default and does not pass `--continue`. The fresh directory is deleted on success, and on failure is preserved only when `includeDiagnostics` is true. Deliberate follow-ups must set `continueSession: true` with a non-secret `sessionKey`; continued reader sessions use `delegate-sessions/reader/<encoded-cwd>/continued/<encoded-agent>/<encoded-session-key>/`, pass `--continue`, and are protected by a `.delegate-lock` file while running. Old cwd-only reader sessions are not auto-used.

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
  continueSession?: boolean;
  sessionKey?: string;
}
```

Defaults and precedence:

- `model`: call param, then agent file, then `openai-codex/gpt-5.3-codex`
- `thinking`: call param, then agent file, then `medium`
- `cwd`: parent tool context cwd
- `timeoutMs`: `600000`, clamped to `1000..3600000`
- `maxResultBytes`: `24000`, clamped to `1000..1000000`
- `includeDiagnostics`: `false`
- `continueSession`: `false`; fresh context is used by default
- `sessionKey`: required only when `continueSession` is true; do not put secrets in it

Use fresh mode for independent second opinions, unrelated tasks, and broad audits that should not inherit stale hypotheses. Use continued mode only for a named investigation thread where prior reader memory is intentional.

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

Both tools emit progress through `onUpdate` with compact details. Partial progress rows render with Pi's animated loading indicator plus phase labels such as:

- `starting` displays as `{spinner} Starting...`
- `launching_subagent` displays as `{spinner} Launching Subagent...`
- `working` displays as `{spinner} Working...`
- `diff_ready` for writer displays as `{spinner} Diff Ready...`
- `finishing` displays as `{spinner} Finishing...`

Progress details include a redacted task preview and do not include raw child stdout, stderr, or tool arguments. Writer diff previews are parent-computed, capped, redacted, and carried in UI `details` for rendering rather than final model-visible `content`. The writer renderer shows the capped diff preview in the collapsed result row and when expanded. The preview uses four context lines to match Pi's native `edit` diff context.

Final delegate rows and expanded writer file rows use Nerd Font icons with theme-dependent colors:

| Status | Icon | Color |
|---|---:|---|
| `completed` | `󰸞` | success / green |
| `timeout` | `󰔟` | warning / amber |
| `aborted` | `󰅖` | best-effort ANSI orange, fallback warning / amber |
| `failed` | `󰅙` | error / red |
| `created` | `󰝒` | success / green |
| `modified` | `󰷈` | best-effort ANSI blue, fallback accent |
| `deleted` | `󰩹` | error / red |
| `skipped` | `󰒭` | muted / gray |

## Result shape

Delegates return:

- `content`: model-visible text. Reader returns the redacted and truncated child final answer. Writer returns a compact changed-file summary, not the full diff or child stdout/stderr.
- `details`: compact metadata including agent, model, thinking, cwd, status, exit code, duration, tool-call count, truncation status, and reader session metadata. Reader details include `sessionMode`, `continueSession`, `sessionPreserved` for fresh mode, redacted `sessionKey` for continued mode, and `diagnosticSessionDir` only when a fresh failed session is preserved. Writer details may include capped `changedFiles`, `changedFileCount`, `skippedDiffCount`, `changedFilesTruncated`, `diffPreview`, and `diffTruncated` for TUI rendering.

Diagnostics are bounded and redacted. They are included only when `includeDiagnostics` is true.

## Validation

```bash
bun agent/extensions/delegates/delegates.test.ts
bun build agent/extensions/delegates/index.ts --target=node --external @earendil-works/pi-coding-agent --external @earendil-works/pi-ai --external @earendil-works/pi-tui --external typebox --outfile=/tmp/delegates-check.js
node --check /tmp/delegates-check.js
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 pi --no-extensions -e agent/extensions/delegates/index.ts --list-models definitely-no-such-model-filter
```
