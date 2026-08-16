# Delegated Pi, Z.AI, and Claude Code prompt and spawn contracts

Load this reference before spawning delegates. Adapt project paths, documents, role templates, finding taxonomies, and gates without weakening the isolation and mutation rules. Use default role routes unless the user or project explicitly selects another supported backend.

## Read-only tree fingerprint

Capture before and after every reviewer or verifier:

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the reviewed project root}"
cd "$project_root"
printf '%s\n' 'status:'
git status --short
printf 'unstaged='; git diff --binary | sha256sum
printf 'staged='; git diff --cached --binary | sha256sum
```

The status plus hashes distinguish pre-existing tracked/staged content from delegate mutation without dumping the diff. If existing untracked files are in review scope, also capture their content hashes with a path-safe method that does not follow symlinks. If the project is not a Git repository, record an equivalent bounded manifest for the relevant files. Do not create snapshots inside the project.

## Spawn commands

Set the project, temporary prompt, and supervisor paths in the parent session. Run these with direct `bash`. Omit the bash tool's timeout field, but always route the child through `run_delegate.py`. Never run Pi or Claude Code delegates through Context Mode.

The supervisor announces its private artifact directory before spawn, applies a 45-minute wall-clock deadline, enforces a 50 MiB combined output limit, terminates the complete child process group, and preserves `report.md`, `stderr.log`, and `status.json`. Pi delegates stream JSON internally. Valid thinking, text, tool, message, turn, and agent events reset the activity clock. Five event-idle minutes produce one warning; ten event-idle minutes terminate the delegate as `stalled`. Raw JSON, thinking, and tool payloads are parsed privately, never replayed, and deleted after final extraction. Plain-protocol delegates retain 60-second process heartbeats until a separate stream adapter exists.

`run_delegate_chain.py` guards one or more ordered Pi routes around fresh supervisor attempts. It checks each exact provider/model against Pi's available catalog. It may move to the next route after catalog absence, a recognized provider-availability error, or an event-idle stall only when no tool execution started and no terminal delegate result exists. All routes share one wall deadline and receive one attempt each. The chain never returns to an earlier route, never persists delegate commands, and does not expose failed-route JSON or provider errors to the orchestrator.

Catalog preflight and delegate children see provider credentials inherited by the parent Pi process. A credential variable added to shell configuration after Pi started is not visible to that process. Restart Pi from a refreshed shell before diagnosing the route as unavailable. Do not source interactive shell startup files inside delegate commands, and check only whether required variables are set without printing their values.

Use `--timeout-seconds <seconds> --allow-extended-timeout` before `--` only when the user explicitly authorizes a larger wall deadline. Use `--idle-timeout-seconds <seconds> --allow-extended-idle` only for a known, intentionally silent tool. The supervisor rejects larger values without these explicit flags. Never run an unbounded child.

Implementation and remediation default to GLM 5.3/max. The orchestrator may choose the GoRouter-first xhigh chain only when all of these conditions hold:

1. The requested change is narrow and clearly bounded.
2. The solution follows an established local pattern and has no material ambiguity.
3. The task has no architecture, security, concurrency, schema, migration, broad-refactor, or cross-system concern.
4. The delegate should finish in a few agent turns with targeted checks.

Record the small-task classification before spawn. If any condition is uncertain, use GLM 5.3/max. The fallback models do not relax this role gate.

### Default implementation or focused remediation

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${TMPDIR:-/tmp}/project-implementation-prompt.md"
supervisor="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/delegated-pi-loop/scripts/run_delegate.py"
cd "$project_root"
uv run --no-project python "$supervisor" \
  --protocol pi-json \
  --require-result \
  --idle-warning-seconds 300 \
  --idle-timeout-seconds 600 \
  --label implementation-glm-5.3-max \
  -- \
  env \
    -u PI_SESSION_ID \
    -u PI_SESSION_FILE \
    -u PI_PROVIDER \
    -u PI_MODEL \
    -u PI_REASONING_LEVEL \
    PI_SKIP_VERSION_CHECK=1 pi \
    --mode json \
    --no-session \
    --approve \
    --provider zai \
    --model glm-5.3 \
    --thinking max \
    @"$prompt_file"
```

### Concurrent independent-review pair

Launch both commands as separate direct bash tool calls in one parallel tool batch. Do not put them in one shell with background jobs. Give both reviewers the same neutral review scope, but preserve separate artifact directories and outputs. Wait for both.

#### Reviewer A: GoRouter Claude Opus 5 Thinking/high

This guarded single route exits as `routes_unavailable` if GoRouter is absent from Pi's live catalog.

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${TMPDIR:-/tmp}/project-review-prompt.md"
chain="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/delegated-pi-loop/scripts/run_delegate_chain.py"
cd "$project_root"
uv run --no-project python "$chain" \
  --idle-warning-seconds 300 \
  --idle-timeout-seconds 600 \
  --label review-gorouter-opus-5-thinking-high \
  -- \
  env \
    -u PI_SESSION_ID \
    -u PI_SESSION_FILE \
    -u PI_PROVIDER \
    -u PI_MODEL \
    -u PI_REASONING_LEVEL \
    PI_SKIP_VERSION_CHECK=1 pi \
    --mode json \
    --no-session \
    --approve \
    --provider gorouter \
    --model claude-opus-5-thinking \
    --thinking high \
    @"$prompt_file"
```

#### Reviewer B: AgentRouter Claude Opus 5/high with GPT-5.6 Sol/high fallback

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${TMPDIR:-/tmp}/project-review-prompt.md"
chain="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/delegated-pi-loop/scripts/run_delegate_chain.py"
cd "$project_root"
uv run --no-project python "$chain" \
  --fallback-route agentrouter/gpt-5.6-sol:high \
  --idle-warning-seconds 300 \
  --idle-timeout-seconds 600 \
  --label review-agentrouter-opus-5-high \
  -- \
  env \
    -u PI_SESSION_ID \
    -u PI_SESSION_FILE \
    -u PI_PROVIDER \
    -u PI_MODEL \
    -u PI_REASONING_LEVEL \
    PI_SKIP_VERSION_CHECK=1 pi \
    --mode json \
    --no-session \
    --approve \
    --provider agentrouter \
    --model claude-opus-5 \
    --thinking high \
    @"$prompt_file"
```

The paired review gate completes only when both commands return `completed`. Preserve both reports independently. Process every blocking finding from either report. If one command fails or is unavailable, the surviving report remains useful evidence but does not constitute the complete paired review gate. An explicit Z.AI or Claude Code selection may replace an assigned reviewer slot, but it does not silently reduce a required two-reviewer gate.

### Finding verification

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${TMPDIR:-/tmp}/project-verification-prompt.md"
supervisor="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/delegated-pi-loop/scripts/run_delegate.py"
cd "$project_root"
uv run --no-project python "$supervisor" \
  --protocol pi-json \
  --require-result \
  --idle-warning-seconds 300 \
  --idle-timeout-seconds 600 \
  --label verification-sol-medium \
  -- \
  env \
    -u PI_SESSION_ID \
    -u PI_SESSION_FILE \
    -u PI_PROVIDER \
    -u PI_MODEL \
    -u PI_REASONING_LEVEL \
    PI_SKIP_VERSION_CHECK=1 pi \
    --mode json \
    --no-session \
    --approve \
    --provider openai-codex \
    --model gpt-5.6-sol \
    --thinking medium \
    @"$prompt_file"
```

### Small-task implementation or remediation chain

Ordered routes: GoRouter Claude Opus 4.8 Thinking/xhigh, AgentRouter Claude Opus 4.8/xhigh, SeekAI DeepSeek V4 Flash/xhigh, then OpenAI Codex GPT-5.6 Luna/xhigh.

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${TMPDIR:-/tmp}/project-implementation-prompt.md"
chain="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/delegated-pi-loop/scripts/run_delegate_chain.py"
cd "$project_root"
uv run --no-project python "$chain" \
  --fallback-route agentrouter/claude-opus-4-8:xhigh \
  --fallback-route seekai/deepseek-v4-flash:xhigh \
  --fallback-route openai-codex/gpt-5.6-luna:xhigh \
  --idle-warning-seconds 300 \
  --idle-timeout-seconds 600 \
  --label implementation-small-task-chain \
  -- \
  env \
    -u PI_SESSION_ID \
    -u PI_SESSION_FILE \
    -u PI_PROVIDER \
    -u PI_MODEL \
    -u PI_REASONING_LEVEL \
    PI_SKIP_VERSION_CHECK=1 pi \
    --mode json \
    --no-session \
    --approve \
    --provider gorouter \
    --model claude-opus-4-8-thinking \
    --thinking xhigh \
    @"$prompt_file"
```

### Explicit Z.AI GLM 5.3 route for any assigned role

The default implementation command above already covers implementation and focused remediation. For an explicit role assignment, provide that role's prompt and a safe diagnostic label:

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${DELEGATE_PROMPT_FILE:?set DELEGATE_PROMPT_FILE to the assigned role prompt}"
role_label="${DELEGATE_ROLE_LABEL:?set DELEGATE_ROLE_LABEL to a safe role label}"
supervisor="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/delegated-pi-loop/scripts/run_delegate.py"
cd "$project_root"
uv run --no-project python "$supervisor" \
  --protocol pi-json \
  --require-result \
  --idle-warning-seconds 300 \
  --idle-timeout-seconds 600 \
  --label "$role_label-glm-5.3-max" \
  -- \
  env \
    -u PI_SESSION_ID \
    -u PI_SESSION_FILE \
    -u PI_PROVIDER \
    -u PI_MODEL \
    -u PI_REASONING_LEVEL \
    PI_SKIP_VERSION_CHECK=1 pi \
    --mode json \
    --no-session \
    --approve \
    --provider zai \
    --model glm-5.3 \
    --thinking max \
    @"$prompt_file"
```

Z.AI GLM 5.3/max can serve any assigned role. It remains the implementation/remediation default; review or verification requires explicit user or project selection. The assigned role prompt and orchestrator contract control mutation permissions, neutrality, tools, and output requirements. A backend selection never grants a reviewer or verifier mutation permission.

`PI_SKIP_VERSION_CHECK=1` suppresses Pi's version-check request; it does not disable the selected provider request. Do not use `PI_OFFLINE=1` for a provider-backed delegate.

The `env -u` prefix prevents parent-session metadata from leaking into child extensions and subprocesses. Pi sets `AI_AGENT=pi` and `PI_CODING_AGENT=true` for itself. Pi's built-in bash tool publishes the child session's own `PI_*` metadata. Claude does not run as Pi, so its commands also clear Pi's two agent markers.

### Claude Code implementation or focused remediation

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${TMPDIR:-/tmp}/project-implementation-prompt.md"
supervisor="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/delegated-pi-loop/scripts/run_delegate.py"
cd "$project_root"
uv run --no-project python "$supervisor" \
  --require-result \
  --label implementation-claude-opus-5 \
  -- \
  env \
    -u AI_AGENT \
    -u PI_CODING_AGENT \
    -u PI_SESSION_ID \
    -u PI_SESSION_FILE \
    -u PI_PROVIDER \
    -u PI_MODEL \
    -u PI_REASONING_LEVEL \
    claude \
    --print \
    --model claude-opus-5 \
    --effort medium \
    --no-session-persistence \
    --permission-mode acceptEdits \
    --allowedTools "Read,Edit,Write,Glob,Grep,Bash" \
    --disallowedTools "Agent" \
    --no-chrome \
    "Execute the complete delegated task supplied on stdin." \
  < "$prompt_file"
```

### Claude Code independent review or finding verification

```bash
project_root="${PROJECT_ROOT:?set PROJECT_ROOT to the delegated project root}"
prompt_file="${TMPDIR:-/tmp}/project-review-prompt.md"
supervisor="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/skills/delegated-pi-loop/scripts/run_delegate.py"
cd "$project_root"
uv run --no-project python "$supervisor" \
  --require-result \
  --label review-claude-opus-5 \
  -- \
  env \
    -u AI_AGENT \
    -u PI_CODING_AGENT \
    -u PI_SESSION_ID \
    -u PI_SESSION_FILE \
    -u PI_PROVIDER \
    -u PI_MODEL \
    -u PI_REASONING_LEVEL \
    claude \
    --print \
    --model claude-opus-5 \
    --effort medium \
    --no-session-persistence \
    --permission-mode dontAsk \
    --allowedTools "Read,Glob,Grep,Bash" \
    --disallowedTools "Edit,Write,Agent" \
    --no-chrome \
    "Execute the complete read-only delegated task supplied on stdin." \
  < "$prompt_file"
```

Claude Code v2.1.219 or later resolves Opus 5, but these commands pin `claude-opus-5` so the selected family does not move over time. `--no-session-persistence` prevents resume state. Do not add `--continue` or `--resume`. Do not use `--bare`: it skips normal Claude configuration and subscription login. Broad Bash access is still not an operating-system sandbox, so preserve prompt prohibitions and pre/post tree fingerprints.

Treat supervisor and chain states other than `completed` as failed delegation. Preserve all artifact paths and diagnose attempt status before any fresh retry. `stalled` means no valid Pi activity event reached the supervisor before the event-idle deadline. `routes_unavailable` means no catalogued route could start or every eligible pre-tool route failed. `blocked`, `delegate_failed`, `invalid_result`, and `invalid_stream` are distinct terminal failures. A zero child exit with no final report becomes `missing_report`. Automatic chain failover is the only retry exception; all other retry decisions remain with the orchestrator.

## Common delegate header

Every role prompt should establish:

```markdown
# Task: <project and exact role>

You are a fresh delegated CLI agent working directly in `<project-root>`.

Execute this assigned role yourself. Do not spawn or orchestrate another Pi instance, Claude Code session, or subagent.
Read all required context and project instructions before acting. More-specific project instructions win.
The working tree may contain user-owned changes. Do not reset, clean, stash, overwrite, or revert them.
Do not stage, commit, push, or mutate hosted services unless this prompt explicitly authorizes that exact action.
```

Use actual safe paths in the generated temporary prompt. Do not retain generic angle-bracket placeholders.

## Attempt and terminal-result contract

Every generated role prompt must define a bounded attempt budget for each required proof, gate, or objective. Unless a more-specific project workflow defines stricter limits, allow at most two materially equivalent attempts and at most ten minutes without new evidence on one requirement. Do not repeat an action without new evidence. When a required result remains unavailable after its budget, stop unrelated work and report `BLOCKED`.

End the final response with exactly one of these lines:

```text
DELEGATE_RESULT: COMPLETED
DELEGATE_RESULT: BLOCKED
DELEGATE_RESULT: FAILED
```

The marker must be the final non-whitespace line and must not appear earlier. `COMPLETED` means the delegate completed its assigned role; an independent review can therefore report required fixes and still use `COMPLETED`. Use `BLOCKED` when missing evidence, access, prerequisites, or reproducibility prevents role completion. Use `FAILED` when execution failed without a narrower blocker report. After `BLOCKED` or `FAILED`, do not start another attempt or unrelated task.

## Implementation prompt contract

Include:

1. **Objective** — one narrow implementation outcome.
2. **Exact scope** — files/areas expected to change and explicitly deferred work.
3. **Binding reading** — project instructions, plans, architecture, ADRs, review reports, and ledgers.
4. **Invariants** — behaviors that must remain true.
5. **Concrete defect mechanics** — exact race, interleaving, durable state, error, or user-visible consequence when fixing a finding.
6. **Success criteria** — regression tests, behavior, documentation, and gates.
7. **Prohibitions** — no broad review, unrelated cleanup, recursive delegation, Git transitions, or hosted-service mutation.
8. **Report** — changed paths, implementation summary, tests with exact commands/results, and remaining risks.

Require the implementation delegate to update project review/remediation documentation when the project workflow requires it. Self-reported tests do not count as independent approval.

## Independent-review prompt contract

Keep the reviewer neutral. Include only information required to locate and judge the candidate:

1. Exact base/head or working-tree scope.
2. Complete governing documents and accepted decisions.
3. Required implementation and release invariants.
4. Explicitly deferred scope.
5. Required review gates and whether tests may be run.
6. Read-only and non-recursive-delegation prohibitions.
7. Structured output contract.

Do **not** include:

- expected findings;
- remediation rationale;
- statements that the tree should pass;
- a summary that hides the governing source documents;
- prior reviewer conclusions when the workflow requires context isolation.

Recommended output:

```markdown
# Verdict
PASS | PASS WITH REQUIRED FIXES | CHANGES REQUESTED

# Findings
## <stable ID>: <title>
- Severity:
- Location:
- Evidence:
- Reproduction/interleaving:
- Impact:
- Required contract:
- Suggested validation:

# Gate evidence
- <command>: <result>

# Deferred scope and limits
- ...
```

A no-findings review should say so explicitly and still report gate evidence and limits.

## Finding-verification prompt contract

Give the verifier:

1. The complete independent finding verbatim.
2. Exact tree/base under verification.
3. Governing architecture and decision documents.
4. A strict verification-only scope.
5. Permission to run bounded diagnostics/tests but not edit files.
6. The project's classification taxonomy.

Require evidence for control flow, realistic reproduction, impact, existing coverage, and whether the required contract follows from accepted architecture. The verifier must not fix the issue, conduct a new broad review, or optimize for agreement with the reviewer.

Recommended output:

```markdown
# Classification
REPRODUCED | PARTIALLY REPRODUCED | NOT REPRODUCED | ALREADY FIXED | DUPLICATE | ARCHITECTURE AMBIGUITY

# Evidence
- ...

# Exact remediation contract
- Required only when reproduced or partially reproduced.

# Limits
- ...
```

## Focused-remediation prompt contract

Give the remediator:

1. The complete original finding.
2. The complete independent verification report.
3. Exact scope and binding documents.
4. The smallest acceptable behavioral contract.
5. Required failing regression and targeted/full gates.
6. Required ledger/review-document updates.
7. Explicit prohibitions against broad review, unrelated cleanup, recursive delegation, and unauthorized Git/hosted-service changes.

Require tests before or alongside behavior. The regression should fail for the verified reason and pass because of the fix, not because expectations were weakened.

## Handoff preservation

Store generated role prompts and complete delegate reports under `${TMPDIR:-/tmp}` or another explicitly temporary location outside the tracked project. Use stable round/finding identifiers in filenames. Do not place local workflow prompts into a commit unless the project explicitly requires them to be tracked.

Before the next role begins, preserve:

- exact finding text;
- verifier classification and evidence;
- remediation scope and changed paths;
- gate commands/results;
- current tree identity and authorization state.

Do not pass remediation narratives into the next independent reviewer.
