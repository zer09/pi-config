# Simple Subagent Implementation Plan

Status: draft for review
Owner: Pi Config
Date: 2026-05-18

## 1. Goal

Build a small local Pi extension that lets the parent agent act as an orchestrator while a child Pi process performs tool-heavy work in its own context. The parent receives only a compact final result, keeping the parent conversation clean and reducing parent-side tool output.

The system should be intentionally simpler than `pi-subagents`:

- No TUI streaming or custom rendering.
- No background jobs.
- No intercom.
- No artifacts by default.
- No packaged builtin agents.
- No chains in v1.
- No worktree isolation in v1.
- No remote sharing.
- No child subagent recursion.

Default model requirements:

- Default child model: `openai-codex/gpt-5.3-codex`.
- Default child thinking level: `medium`.
- Per-call and per-agent options may override model and thinking.

## 2. Working definitions

These terms should be added to `CONTEXT.md` only after confirmation.

### Parent Orchestrator

The active Pi session that decides when to delegate work. It owns final decisions, user-facing reporting, edits validation, commits, and any hosted-service mutation decisions.

### Child Subagent

A separate non-interactive Pi process launched for one scoped task. It can use tools, but must return compact structured findings instead of raw logs or broad dumps.

### Quiet Foreground Run

A synchronous child run where the parent waits for completion and receives only a final compact result plus small metadata. Child tool events are parsed internally but not returned to the parent unless needed for errors.

### Fresh Child Context

The default mode. The child starts a new Pi process with normal context-file loading, but without parent conversation history. The parent must provide a self-contained task.

### Forked Child Context

A later optional mode where the child branches from the parent session history. This is intentionally out of v1 unless we decide it is required.

### Child Boundary

Runtime and prompt constraints that make the child behave as a child worker, not as another orchestrator. This includes disabling the subagent tool inside child processes and instructing the child not to launch more subagents.

## 3. Non-negotiable behavior

1. Parent context stays clean.
   - Do not return child tool-call streams.
   - Do not return child raw stdout or stderr except bounded diagnostics on failure.
   - Do not inline large outputs.

2. Child follows existing Pi rules.
   - Do not pass `--no-context-files`.
   - Child should load `~/.pi/agent/AGENTS.md` and project `AGENTS.md`/`CLAUDE.md` from its `cwd`.
   - Child must be reminded to follow Context Watcher and the subagent operating contract.

3. No nested subagents.
   - Extension must not register the subagent tool when `PI_SIMPLE_SUBAGENT_CHILD=1`.
   - Child prompt must explicitly say it is not the orchestrator and must not launch subagents.

4. Default to read-only.
   - Tool schema should include `mode: "read" | "write"` with default `read`.
   - Parent must explicitly set `mode: "write"` for child file edits.
   - External hosted service mutations remain blocked unless the task explicitly authorizes the exact mutation.

5. One writer at a time.
   - Parallel writer children are out of scope.
   - v1 should only support one child per tool call.
   - If parallel fanout is added later, enforce read-only fanout by default.

6. Local only.
   - No `gh gist create`.
   - No network sharing.
   - No package auto-update logic.

7. Minimal and maintainable.
   - Do not vendor `pi-subagents` wholesale.
   - Borrow patterns, not source structure.
   - Prefer one extension directory with small focused modules.

## 4. Proposed user-facing tool

Tool name options:

- Recommended: `subagent`
- Alternative if conflict with future package: `delegate_subagent`

Recommended v1 schema:

```ts
{
  agent: string,
  task: string,
  mode?: "read" | "write",
  model?: string,
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
  cwd?: string,
  timeoutMs?: number,
  maxResultBytes?: number,
  includeDiagnostics?: boolean
}
```

Field details:

- `agent`
  - Required.
  - Name of a markdown agent definition in `~/.pi/agent/agents/*.md`.
  - Later may support project `.pi/agents/*.md`, but v1 should start with user agents only to reduce trust issues.

- `task`
  - Required.
  - Must be self-contained enough for a fresh child context.
  - Parent should include relevant file paths, exact question, expected output format, and write permission if any.

- `mode`
  - Optional.
  - Default: `read`.
  - `read` means child may inspect, test, analyze, and report, but must not edit files or mutate hosted services.
  - `write` means child may edit local files if the parent explicitly asks for implementation. Parent still owns final validation.

- `model`
  - Optional.
  - Default: `openai-codex/gpt-5.3-codex`.
  - Pass through to Pi CLI as `--model`.
  - Validate as non-empty string. Do not guess aliases.

- `thinking`
  - Optional.
  - Default: `medium`.
  - Pass through to Pi CLI as `--thinking medium` rather than appending `:medium` to the model, because Pi documents an explicit `--thinking` flag.
  - Accept only `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.

- `cwd`
  - Optional.
  - Default: parent tool call context `ctx.cwd`.
  - Resolve to absolute path.
  - Must exist and be a directory.
  - Used as child process `cwd`, so Pi context-file discovery works relative to the target project.

- `timeoutMs`
  - Optional.
  - Default recommendation: 600000 ms for v1, configurable later.
  - Enforce min and max bounds, for example 1000 ms to 3600000 ms.
  - On timeout, terminate child and return a bounded failure result.

- `maxResultBytes`
  - Optional.
  - Default recommendation: 24000 bytes.
  - Applies only to the returned final result. Internal child output can be larger but must not be returned raw.

- `includeDiagnostics`
  - Optional.
  - Default: false.
  - If true, include bounded stderr tail, child exit code, model, duration, and maybe last N child events.
  - Never include secrets or full logs.

## 5. Agent definition format

Use existing user-level agent files:

```text
~/.pi/agent/agents/*.md
```

Current local agents:

- `docs-researcher`
- `investigator`
- `oracle`
- `reviewer`
- `tester`

Recommended markdown format:

```md
---
name: investigator
model: openai-codex/gpt-5.3-codex
thinking: medium
description: Read-only root cause and codebase investigation sub-agent.
tools: read, grep, find, ls, bash
---

# Investigator Sub-agent

Role-specific prompt here.
```

V1 should support these frontmatter fields:

- `name`: required.
- `description`: optional but recommended.
- `model`: optional agent default.
- `thinking`: optional agent default.
- `tools`: optional comma-separated Pi tool allowlist.
- `systemPromptMode`: optional, `append` or `replace`, default `append` for local agents unless we decide otherwise.

Precedence for model and thinking:

1. Tool call `model` / `thinking`.
2. Agent frontmatter `model` / `thinking`.
3. Extension defaults: `openai-codex/gpt-5.3-codex`, `medium`.

Tool allowlist recommendation:

- If `mode: "read"`, enforce a read-only default tool list even if frontmatter is missing.
- If `mode: "write"`, allow edit/write only when the parent sets `mode: "write"`.
- Do not rely only on prompt instructions for write safety.

Recommended defaults:

```ts
const READ_TOOLS = ["read", "grep", "find", "ls", "bash"];
const WRITE_TOOLS = ["read", "grep", "find", "ls", "bash", "edit", "write"];
```

Important caveat:

Our global rules prefer Context Mode for read-only shell and large outputs. If the child has only Pi built-in `bash`, it may violate Context Watcher routing unless Context Mode MCP/direct tools are available to the child. We should verify how MCP tools are exposed to child Pi sessions before finalizing the default allowlist. If MCP tools are available, prefer adding the Context Mode direct tool names to read agents. If they are not, child prompt must strongly route shell work through whatever tool set Pi exposes.

## 6. Extension location and file structure

Recommended directory:

```text
~/.pi/agent/extensions/simple-subagent/
  index.ts
  agents.ts
  child.ts
  cli.ts
  result.ts
  types.ts
  README.md
  simple-subagent.test.ts
```

Start smaller if desired:

```text
~/.pi/agent/extensions/simple-subagent/
  index.ts
  README.md
```

But keep functions internally separated so they can be extracted later.

Suggested responsibilities:

### `index.ts`

- Register the `subagent` tool.
- Skip registration when `PI_SIMPLE_SUBAGENT_CHILD=1`.
- Define TypeBox schema.
- Validate and normalize arguments.
- Call the runner.
- Return compact result.

### `agents.ts`

- Discover user agents from `~/.pi/agent/agents/*.md`.
- Parse YAML-like frontmatter without heavy dependencies.
- Validate required fields.
- Avoid loading project-local agents in v1 unless explicitly enabled later.

### `child.ts`

- Build child system prompt.
- Merge child boundary instructions, agent prompt, mode instructions, and output contract.
- Ensure no nested subagents.

### `cli.ts`

- Resolve Pi invocation.
- Build CLI args.
- Spawn child process.
- Handle abort and timeout.
- Parse JSONL events.

### `result.ts`

- Extract final assistant answer.
- Truncate result safely.
- Redact obvious secrets and home paths.
- Format errors.

### `types.ts`

- Shared TypeScript interfaces.
- Thinking level enum.
- Defaults.

## 7. Pi invocation design

Use a separate Pi process for isolation.

Recommended command shape:

```bash
pi --mode json -p --no-session \
  --model openai-codex/gpt-5.3-codex \
  --thinking medium \
  --append-system-prompt /tmp/pi-simple-subagent-*/agent.md \
  --tools read,grep,find,ls,bash \
  @/tmp/pi-simple-subagent-*/task.md
```

Key choices:

- Use `--mode json` so the parent can parse events.
- Use `-p` for non-interactive prompt mode.
- Use `--no-session` for v1 fresh context.
- Do not use `--no-context-files`; child must load AGENTS.md.
- Use temp files for system prompt and task to avoid shell escaping and OS argument limits.
- Write temp files with mode `0600`.
- Delete temp files after completion, best effort.
- Use `spawn`, not `exec`, to avoid shell injection and buffer limits.
- Use `shell: false`.
- Pass env overlay:

```ts
{
  ...process.env,
  PI_SIMPLE_SUBAGENT_CHILD: "1",
  PI_SIMPLE_SUBAGENT_AGENT: agentName,
  PI_SIMPLE_SUBAGENT_MODE: mode
}
```

Pi executable resolution:

- If current extension is running under the Pi CLI entrypoint, prefer `process.execPath` plus current CLI script when available.
- Otherwise call `pi` from PATH.
- Keep this simple in v1, but copy the robust pattern from the official example if needed:
  - avoid Bun virtual script paths
  - support Node/Bun runtimes
  - fall back to `pi`

## 8. Child prompt contract

Every child system prompt should include four layers:

1. Child boundary.
2. Mode contract.
3. Agent role prompt.
4. Output contract.

Recommended child boundary:

```md
You are a child subagent launched by a parent Pi orchestrator.
You are not the parent orchestrator.
Do not launch or propose subagents.
Complete only the assigned task.
Follow all loaded AGENTS.md and Context Watcher rules.
Do not expose secrets.
Do not return raw logs or broad tool dumps.
Return compact structured findings only.
```

Read mode contract:

```md
Mode: read-only.
You may inspect files, run safe read-only checks, analyze logs, run tests when appropriate, and report findings.
Do not edit files.
Do not create files.
Do not mutate external hosted services.
If a mutation appears necessary, return a recommended patch or checklist instead.
```

Write mode contract:

```md
Mode: local-write authorized.
You may edit local files only as required by the assigned task.
Keep changes surgical.
Read files before editing.
Use native edit/write tools for file content changes.
Do not commit, push, deploy, publish, comment, label, or mutate hosted services unless the task explicitly authorizes that exact mutation.
Return changed paths, validation performed, and remaining risks.
```

Output contract:

```md
Final response must be compact markdown with these headings:

## Result
## Evidence
## Changes
## Validation
## Risks
## Next step

Use `None` for sections that do not apply.
Do not include raw command output over 20 lines.
Do not include secrets.
Redact user-specific home paths to `~`.
```

Potential issue:

Some child agents may have role prompts that conflict with this output contract. The runner should append the output contract after the role prompt so it wins locally.

## 9. Result extraction

Pi JSON mode emits structured JSON lines. The runner should parse stdout line by line.

Track:

- Final assistant message text.
- Error events.
- Tool execution starts and ends only as counters, not as returned context.
- Usage if provided.
- Model if provided.

Do not store or return:

- Full child conversation.
- Full tool args.
- Full tool results.
- Full stdout/stderr.

Return shape to parent:

```ts
{
  content: [{
    type: "text",
    text: childFinalTextOrErrorSummary
  }],
  details: {
    agent,
    mode,
    model,
    thinking,
    cwd,
    status: "completed" | "failed" | "timeout" | "aborted",
    exitCode,
    durationMs,
    toolCallCount,
    truncated: boolean
  }
}
```

Truncation policy:

- If final result exceeds `maxResultBytes`, keep the first part plus a clear marker.
- Better: keep the first 70 percent and last 30 percent if the result is long, because summaries often end with useful conclusions.
- Never write artifact files in v1 unless we later add an explicit debug option.

Error result policy:

- Include child exit code.
- Include bounded stderr tail, for example last 4000 bytes, only if `includeDiagnostics` is true or no final message exists.
- Redact home path and secret-looking values.
- Include a short line saying child output was intentionally not imported into parent context.

## 10. Abort and timeout behavior

Parent cancellation should stop the child.

Implementation details:

- Listen to `AbortSignal` passed into tool execute.
- On abort:
  - send SIGTERM or platform equivalent.
  - wait a short grace period, for example 2000 ms.
  - send SIGKILL if still alive and platform supports it.
- On timeout:
  - same process termination path.
  - return status `timeout`.

Quirks:

- Windows uses different signals. Use Node's `child.kill()` with default signal first.
- Child may exit after parent already settled. Guard against double resolve.
- Stderr may still flush after close. Preserve only a bounded tail.

## 11. Security and safety details

### Hosted service mutation gate

The child must not mutate GitHub, Linear, Figma, Notion, Firebase, cloud providers, Stripe, Sentry, Jira, or similar services unless the parent task explicitly authorizes the exact mutation.

Implementation support:

- Prompt contract states the rule.
- Read mode tool allowlist excludes obvious write tools where practical.
- Parent should not delegate ambiguous hosted-service tasks in write mode.

### Secrets

Do not print or return secrets.

Add simple redaction before returning text:

- Redact values after keys containing `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `AUTH`, `BEARER`, `API_KEY`, `PRIVATE`.
- Redact `Bearer <token-like>` patterns.
- Redact private key blocks.

This is a last-resort output filter, not a substitute for child rules.

### Home paths

Normalize user-specific paths in returned text:

- `/home/gc/.pi` -> `~/.pi`
- `/home/gc/development/...` -> `~/development/...`

### Temp files

- Use `fs.mkdtemp(os.tmpdir() + prefix)`.
- Write prompt/task with mode `0600`.
- Cleanup in `finally`.
- Do not include raw task or prompt in error output unless explicitly requested.

### Shell injection

- Use `spawn(command, args, { shell: false })`.
- Never concatenate user input into shell command strings.

## 12. Context behavior

V1 should use fresh child context only.

Why:

- It keeps parent context clean.
- It avoids copying prior tool logs into child context.
- It forces scoped tasks.
- It reduces implementation complexity.

Child still receives:

- Global `~/.pi/agent/AGENTS.md`.
- Project context files discovered from `cwd`.
- Agent role prompt via `--append-system-prompt`.
- Task file.

Do not implement forked context in v1.

Future forked mode requirements if added:

- Use Pi session manager branch APIs, not manual JSON copying.
- Strip prior subagent tool calls/results from inherited context.
- Add child boundary instructions before inherited history.
- Warn that forked context is larger and may reduce the context-cleanliness benefit.

## 13. Worktree isolation decision

Skip in v1.

Reasoning:

- Our first version should support only one child per call.
- Read-only children do not need filesystem isolation.
- A single write child can operate in the parent worktree with parent review afterward.
- Per-child worktrees are only needed for parallel write children, which are out of scope.

If later added, it should be opt-in and patch-based:

- Parent creates temporary worktree.
- Child edits there.
- Parent receives patch summary.
- Parent applies or rejects patch.

Do not add setup hooks in v1.

## 14. Feature comparison against `pi-subagents`

Keep or borrow:

- Separate Pi subprocess.
- Markdown agent definitions.
- Agent-level model/thinking/tool settings.
- Child env var to disable nested subagent tool.
- JSON mode parsing.
- Bounded final result.
- Recursion guard concept.

Drop:

- TUI rendering.
- Async/background runs.
- Status/resume/interrupt.
- Intercom.
- Artifacts.
- Share to Gist.
- Chains.
- Packaged builtin agents.
- Worktree fanout.
- Agent CRUD tool actions.
- Prompt shortcuts.
- Notifications.
- Result widgets.

Maybe later:

- Parallel read-only fanout.
- Forked context.
- Debug mode with local artifact files.
- Doctor command.

## 15. Implementation phases

### Phase 0 - Decisions

Resolve these before coding:

1. Tool name: `subagent` or `delegate_subagent`.
2. V1 agent scope: user-only or user plus project.
3. Whether write mode is included in v1 or deferred.
4. Whether child tool allowlist should include Context Mode direct tools if available.
5. Whether final result must be strict JSON or compact markdown.

Recommended answers:

1. Use `subagent` if no package conflict is installed; otherwise `delegate_subagent`.
2. User-only in v1.
3. Include write mode, but keep default read-only and no parallel.
4. Include Context Mode direct tools if Pi exposes them to child sessions; otherwise keep built-ins and rely on AGENTS.md.
5. Compact markdown for humans, structured `details` for the parent runtime.

### Phase 1 - Minimal extension skeleton

Files:

```text
~/.pi/agent/extensions/simple-subagent/index.ts
~/.pi/agent/extensions/simple-subagent/README.md
```

Tasks:

- Register tool.
- Add schema.
- Skip registration under `PI_SIMPLE_SUBAGENT_CHILD=1`.
- Return a stub result.
- Verify Pi loads extension.

Validation:

```bash
pi --extension ~/.pi/agent/extensions/simple-subagent/index.ts -p "List available tools relevant to subagents"
```

Use Context Mode when running validation from an agent.

### Phase 2 - Agent discovery

Tasks:

- Load `~/.pi/agent/agents/*.md`.
- Parse frontmatter.
- Validate `name` and body.
- Match requested `agent` exactly.
- Produce helpful unknown-agent error with available names.

Quirks:

- Markdown may include `---` in body. Only parse frontmatter if file starts with `---`.
- Avoid YAML dependency initially. Parse simple `key: value` lines.
- Comma-separated tools need trimming.
- Duplicate names should fail loudly or deterministic last-wins. Recommended: fail loudly.

Tests:

- Finds existing local agents.
- Rejects missing agent.
- Rejects duplicate agent names.
- Parses model/thinking/tools.

### Phase 3 - Child prompt assembly

Tasks:

- Build system prompt temp file.
- Include boundary, mode contract, agent prompt, output contract.
- Append task-specific mode note.
- Redact local absolute temp path from returned errors.

Tests:

- Read mode prompt contains no-edit rule.
- Write mode prompt contains local-write-only rule.
- Boundary contains no nested subagents rule.
- Prompt is written `0600`.

### Phase 4 - Spawn child Pi

Tasks:

- Build args.
- Resolve model and thinking.
- Resolve cwd.
- Spawn child with `shell: false`.
- Set env vars.
- Pipe stdout/stderr.
- Parse JSON lines.
- Track final assistant message.
- Handle non-JSON noise safely.

Args:

```ts
[
  "--mode", "json",
  "-p",
  "--no-session",
  "--model", resolvedModel,
  "--thinking", resolvedThinking,
  "--append-system-prompt", promptPath,
  "--tools", resolvedTools.join(","),
  `@${taskPath}`
]
```

Important: do not include `--no-context-files`.

Tests:

- Args include model default.
- Args include thinking default.
- Args respect call overrides.
- Args respect agent frontmatter overrides.
- Env includes child marker.
- Child registration is skipped under child marker.

### Phase 5 - Result extraction and truncation

Tasks:

- Extract final text from assistant events.
- Return compact text to parent.
- Include `details` metadata.
- Bound final result by `maxResultBytes`.
- Redact secrets and home paths.

Tests:

- Final assistant text returned.
- Tool events are not returned.
- Long result truncated.
- Secret-looking values redacted.
- Home path normalized.

### Phase 6 - Cancellation and timeout

Tasks:

- Wire `AbortSignal`.
- Add timeout timer.
- Kill child on abort/timeout.
- Avoid double settlement.
- Cleanup temp dir.

Tests:

- Abort kills child.
- Timeout kills child.
- Temp files removed after success and failure.
- Stderr tail bounded.

### Phase 7 - Local validation

Validation checklist:

- `subagent({ agent: "investigator", task: "Find where X is configured" })` returns concise result.
- Parent context receives no raw tool logs.
- Child cannot call `subagent` because the tool is not registered under child env.
- Child loads AGENTS.md because it follows Context Watcher rules in behavior.
- Default model is `openai-codex/gpt-5.3-codex`.
- Default thinking is `medium`.
- Override model works.
- Override thinking works.
- Unknown agent error lists available agents.
- Read mode refuses edits.
- Write mode can edit a controlled test file.
- Timeout path works.
- Abort path works.

### Phase 8 - Documentation

Add README with:

- What problem it solves.
- Tool schema.
- Examples.
- Safety model.
- Agent definition format.
- Known non-goals.
- How to troubleshoot.

Update `CONTEXT.md` only after the terminology is confirmed.

## 16. Testing strategy

Use Node built-in test runner if practical.

Suggested test files:

```text
~/.pi/agent/extensions/simple-subagent/simple-subagent.test.ts
```

Unit tests:

1. Frontmatter parsing.
2. Agent discovery.
3. Tool selection by mode.
4. Model/thinking precedence.
5. Prompt assembly.
6. Args building.
7. Result extraction from sample JSONL.
8. Redaction.
9. Truncation.
10. Temp cleanup.

Integration tests with fake Pi executable:

- Create a temp executable named `pi` that emits JSONL events.
- Prepend temp dir to PATH.
- Run extension runner against fake Pi.
- Assert returned result excludes fake tool logs.

Avoid real model calls in automated tests.

Manual smoke tests:

- One read-only investigator run.
- One reviewer run.
- One tester run on a harmless command.
- One write-mode run against a temp project file.

## 17. Possible quirks and mitigations

### Quirk: Pi JSON event schema may change

Mitigation:

- Parse defensively.
- Prefer message role/content extraction by shape.
- If no final assistant message found, return bounded diagnostics.

### Quirk: Child loads the same extension

Mitigation:

- Check `PI_SIMPLE_SUBAGENT_CHILD=1` at extension load and return before registering tool.

### Quirk: Tool allowlist may hide Context Mode tools

Mitigation:

- First implementation may omit `--tools` for full tool availability in read-only mode, but that weakens write safety.
- Better implementation should discover exact tool names and configure agent files accordingly.
- This is an important decision before coding.

### Quirk: `bash` in child can still mutate files

Mitigation:

- Read mode prompt prohibits edits.
- Tool allowlist cannot make Bash read-only.
- Existing Context Watcher rules prohibit writing file content through Bash.
- For stricter enforcement, v2 could add a child extension hook to block risky Bash commands in read mode.

### Quirk: Parent task may be underspecified

Mitigation:

- Tool description should tell parent to pass specific scope, paths, and expected output.
- Child should ask no questions unless impossible; it should return blockers and next step.

### Quirk: AGENTS.md startup steps may cost child tool calls

Mitigation:

- This is acceptable because child tool calls do not pollute parent context.
- Parent should delegate only when task is worth the child startup overhead.

### Quirk: `--no-session` prevents resume and fork

Mitigation:

- Intentional for v1.
- If a child needs a long multi-turn job, parent should launch a new child with a new task.

### Quirk: Model may be unavailable

Mitigation:

- Return clear failure.
- Do not silently fall back unless we add explicit `fallbackModels` support.
- The user requested a default model, so failure is better than hidden fallback at v1.

### Quirk: Thinking flag and model suffix can conflict

Mitigation:

- Use `--thinking` separately.
- If user passes model with suffix like `model:high` and also passes `thinking`, decide precedence. Recommendation: explicit `thinking` wins; strip suffix only if implementation can do so safely, otherwise document that both should not be combined.

### Quirk: Agent prompt says one output shape and runner says another

Mitigation:

- Runner output contract is appended last.
- Agent files should keep role behavior separate from formatting.

### Quirk: Child final response may include markdown tables too large

Mitigation:

- Truncate final result.
- Prompt child to summarize, not dump.

### Quirk: Child may produce useful intermediate findings but fail at the end

Mitigation:

- Track last assistant message.
- On non-zero exit, return last assistant message plus error summary if available.

### Quirk: Temp cleanup can fail

Mitigation:

- Best-effort cleanup.
- Use unique prefixes.
- Add a future cleanup command only if needed.

### Quirk: Existing `pi-subagents` package might later be installed

Mitigation:

- Check for tool name conflict during manual validation.
- If conflict exists, rename ours to `delegate_subagent`.

## 18. Recommended v1 acceptance criteria

The implementation is done when:

1. Parent can call one subagent synchronously.
2. Child uses default model `openai-codex/gpt-5.3-codex` and thinking `medium` unless overridden.
3. Child loads normal Pi context files.
4. Child cannot call subagents recursively.
5. Parent receives only compact final result and metadata.
6. No TUI, artifacts, intercom, background state, or sharing exist.
7. Read mode is default.
8. Write mode requires explicit `mode: "write"`.
9. Timeout and abort paths are safe.
10. Tests cover parser, prompt, args, result extraction, truncation, and child marker behavior.

## 19. Recommended first grill question

Question: Should v1 enforce read-only mode technically by restricting tools, or should it rely on AGENTS.md plus prompt rules while keeping the child toolset broad?

Recommended answer: enforce read-only as much as practical with a tool allowlist, but verify Context Mode tool availability first. If Context Mode direct tools cannot be allowlisted cleanly, use broad tools temporarily and add a child read-mode guard hook in v2.

Why this matters:

- Strict tool allowlists improve safety but can accidentally prevent Context Watcher-compliant workflows.
- Broad tools preserve capability but rely more on prompt adherence.
- This decision affects the CLI args, tests, and agent file frontmatter.

## 20. Implementation order summary

1. Confirm v1 decisions from section 15 and answer the grill question in section 19.
2. Create `~/.pi/agent/extensions/simple-subagent/index.ts`.
3. Implement schema and child-env registration skip.
4. Implement local agent discovery.
5. Implement prompt assembly.
6. Implement Pi subprocess runner.
7. Implement result extraction, redaction, and truncation.
8. Add timeout/abort cleanup.
9. Add tests with fake Pi.
10. Run manual smoke tests.
11. Update `CONTEXT.md` glossary terms if accepted.
12. Optionally add README examples.
