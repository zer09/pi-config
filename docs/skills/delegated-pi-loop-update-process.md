# Delegated Pi loop update process

Purpose: maintain `agent/skills/delegated-pi-loop` as the local source of truth for fresh, bounded Pi or Claude Code implementation, independent review, finding verification, and focused remediation delegates on one shared working tree. Implementation defaults to Z.AI GLM 5.3/max. Classified small tasks use a bounded ordered Pi provider chain. Default independent review uses two concurrent read-only reviewers, one with a bounded fallback.

## Classification and provenance

- Classification: **keep it**, implemented slimly through progressive disclosure.
- Source of truth: this Pi config, ADR 0007, and observed successful delegated implementation/review workflows.
- Pi harness authority: the Pi CLI reference installed with `@earendil-works/pi-coding-agent`, especially `docs/json.md`, for `--mode json`, event types, `--no-session`, `--approve`, provider/model/thinking flags, context-file loading, and process environment behavior. Latest reviewed CLI: Pi 0.84.1.
- Z.AI model authority: the installed Pi model catalog for provider `zai`, model `glm-5.3`, and `max` thinking support.
- Fallback-provider authority: tracked `agent/models.json` plus Pi's available model catalog. Current routes use `seekai/deepseek-v4-flash`, `agentrouter/claude-opus-4-8`, `agentrouter/gpt-5.6-sol`, `agentrouter/claude-opus-5`, `gorouter/claude-opus-4-8-thinking`, and `gorouter/claude-opus-5-thinking`. A configured model can remain unavailable when its credential or provider is intermittent, so the chain must preflight the live available catalog.
- Claude harness authority: the installed `claude --help` plus official Claude Code [CLI reference](https://code.claude.com/docs/en/cli-reference), [model configuration](https://code.claude.com/docs/en/model-config), and [headless usage](https://code.claude.com/docs/en/headless) for `--print`, `--model claude-opus-5`, `--effort medium`, `--no-session-persistence`, permissions, and stdin prompts. Latest reviewed CLI: Claude Code 2.1.226.
- Project execution guides and accepted architecture decisions remain authoritative for project-specific role prompts, finding taxonomies, gates, and release transitions.

This skill is retained because role isolation, neutral-review handling, bounded process supervision, direct-spawn constraints, shared-tree mutation safety, and the verification/remediation loop are easy to weaken when reconstructed ad hoc.

## Owned surfaces

| Path | Responsibility |
|---|---|
| `agent/AGENTS.md` | Compact trigger and global safety invariants |
| `agent/skills/delegated-pi-loop/SKILL.md` | Runtime orchestration workflow and role boundaries |
| `agent/skills/delegated-pi-loop/references/prompt-contracts.md` | Exact supervised spawn commands, fingerprints, and role prompt contracts |
| `agent/skills/delegated-pi-loop/scripts/run_delegate.py` | Private Pi JSON parsing, activity and wall deadlines, route-availability signals, tool-start tracking, final-report extraction, process-group cleanup, and terminal status enforcement |
| `agent/skills/delegated-pi-loop/scripts/run_delegate_chain.py` | Ordered catalog preflight and fresh pre-tool Pi route failover within one shared deadline |
| `agent/skills/delegated-pi-loop/scripts/test_run_delegate.py` | Supervisor lifecycle, context-isolation, activity, outcome, and route-chain regressions |
| `agent/skills/delegated-pi-loop/agents/openai.yaml` | Human-facing skill metadata |
| `docs/skills/delegated-pi-loop-update-process.md` | Long-lived provenance, update process, and validation contract |

## Invariants

Preserve all of these unless the user explicitly changes the workflow:

1. The parent session is the sole orchestrator; delegates do not recursively spawn Pi, Claude Code, or subagents.
2. Delegates run through direct `bash`, not Context Mode. The outer bash tool call has no timeout, but every child runs through `run_delegate.py` with a positive wall-clock deadline.
3. The supervisor defaults to a 45-minute wall deadline, 50 MiB child-output limit, 5-minute Pi event-idle warning, and 10-minute Pi event-idle termination. It rejects larger wall or idle values unless the caller supplies the corresponding explicit override flag; policy still requires user authorization or a known intentionally silent tool.
4. Pi delegates use `--mode json` through protocol `pi-json`. Valid thinking, text, tool, message, turn, and agent events reset the activity clock. The supervisor extracts the final report, stores only activity metadata, never replays raw events, and deletes the raw event stream.
5. Guarded routes and ordered chains preflight each exact provider/model against Pi's available catalog. A chain may move forward once after catalog absence, recognized provider unavailability, or an event-idle stall only before any tool starts and before any terminal delegate result. Every candidate uses a fresh process, all candidates share one wall deadline, and a chain never cycles.
6. Every role prompt defines attempt/time budgets and ends with exactly one `DELEGATE_RESULT: COMPLETED|BLOCKED|FAILED` marker. Missing or malformed results fail explicitly.
7. The supervisor terminates the complete child process group, preserves private final artifacts, rejects empty reports, and never persists the delegate command line.
8. Every delegate clears inherited parent `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL`. Claude delegates also clear `AI_AGENT` and `PI_CODING_AGENT`.
9. Every delegate uses a fresh ephemeral process: Pi `--no-session` or Claude Code `--no-session-persistence`, never resume/continue.
10. At most one mutating delegate runs on a shared working tree, with no concurrent parent edits. The two default read-only independent reviewers run concurrently; mutators and finding verifiers remain sequential.
11. Implementation and remediation default to pinned `zai/glm-5.3` at `max` thinking through Pi.
12. Small-task implementation/remediation uses `gorouter/claude-opus-4-8-thinking`, `agentrouter/claude-opus-4-8`, `seekai/deepseek-v4-flash`, then `openai-codex/gpt-5.6-luna`, all at `xhigh`. The orchestrator must first record the existing narrow, low-risk, few-turn classification; uncertainty routes to GLM 5.3/max.
13. Default independent review launches two fresh read-only reviewers concurrently: `gorouter/claude-opus-5-thinking` at `high`, plus `agentrouter/claude-opus-5` at `high` with `agentrouter/gpt-5.6-sol` at `high` as its only pre-tool fallback. Both must complete, and findings from either report require processing.
14. Finding verification remains `openai-codex/gpt-5.6-sol` at `medium`.
15. Z.AI review or verification requires explicit user or project selection and uses pinned `zai/glm-5.3` at `max` thinking through Pi.
16. When the user or project explicitly selects Claude Code, any role uses pinned `claude-opus-5` at `medium` effort with role-appropriate permissions; the moving `opus` alias is not used.
17. Reviewers and verifiers are read-only, neutral, and checked against pre/post tree fingerprints.
18. A project-provided verification template must be instantiated before focused remediation; parent analysis is not a substitute.
19. A fresh independent review follows every remediation round.
20. Git transitions and hosted-service writes retain their separate explicit-authorization gates.
21. Temporary prompts and reports remain outside tracked project paths and contain no secrets.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Read this document and every owned surface above.
3. Read the installed Pi `README.md`, `docs/json.md`, `docs/skills.md`, `docs/sessions.md`, and `docs/environment-variables.md` before changing Pi CLI/session behavior.
4. Read current official Claude Code CLI, model-configuration, and headless documentation plus local `claude --help` before changing Claude commands, model aliases, effort, permissions, or persistence behavior.
5. Compare proposed behavior against at least one current project execution guide when project-template precedence or role separation changes.
6. Confirm every configured route ID and thinking level in `agent/models.json`. Use `pi --list-models provider/model` to distinguish configured routes from routes currently available with credentials. Also confirm Z.AI GLM 5.3/max and installed Claude Code Opus 5/effort support before changing defaults.
7. Keep the global `AGENTS.md` section compact; move detailed commands and prompt formats into the runtime reference.
8. Keep `SKILL.md` under 500 lines and preserve its maintenance pointer.
9. Update `agents/openai.yaml` when the description or user-facing invocation changes.
10. Update the installed-skill inventory, skill-maintenance README, root README, config-context-cost attribution, and changelog when applicable.
11. Validate without paid model inference by default. Run a real delegate smoke only when CLI/model semantics changed and the user authorizes its cost and mutation scope.

## Required checks

Validate the target skill:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/skills/delegated-pi-loop
```

Run supervisor regressions and Python checks:

```bash
env PYTHONDONTWRITEBYTECODE=1 uv run --no-project python -m unittest \
  agent/skills/delegated-pi-loop/scripts/test_run_delegate.py -v
uvx ruff check agent/skills/delegated-pi-loop/scripts/*.py
uvx ruff format --check agent/skills/delegated-pi-loop/scripts/*.py
```

Then validate all Local Skills using the command in `local-skill-update-invariants.md`.

Also verify:

- `agents/openai.yaml` parses and its `default_prompt` mentions `$delegated-pi-loop`.
- The runtime skill and reference contain no unresolved scaffold/TODO placeholders or user-specific home paths; generic prompt fields are clearly marked for replacement.
- All changed local Markdown links resolve.
- No caches, logs, delegate transcripts, temporary prompts, or evaluation artifacts were added.
- The global rule and skill agree on direct bash routing, private Pi JSON monitoring, event-idle and shared wall deadlines, bounded pre-tool route failover, the concurrent reviewer pair, structured outcomes, environment scrubbing, fresh sessions, exact model routing, Claude permission modes, reviewer neutrality, and mutation gates.
- Raw thinking, tool payloads, and JSON events do not appear in `report.md`, `stderr.log`, `status.json`, or replayed supervisor output after a normal terminal path.
- Existing unrelated dirty config files remain untouched.

## Evaluation guidance

The workflow has objective structural checks but real behavior evaluation can spend provider tokens and mutate a test tree. Prefer a disposable local Git fixture when evaluation is warranted. Test these cases:

1. Delegated implementation produces one GLM 5.3/max spawn contract by default or one Opus 5/medium Claude Code contract when Claude is selected.
2. The GoRouter Opus 4.8 Thinking → AgentRouter Opus 4.8 → SeekAI DeepSeek → Luna xhigh chain appears only after a recorded small-task classification satisfies every routing criterion; a missing, uncertain, complex, or high-risk classification routes to GLM 5.3/max.
3. Default independent review launches GoRouter Opus 5 Thinking/high and AgentRouter Opus 5/high concurrently with isolated outputs. Only the AgentRouter reviewer may fall back, and only to AgentRouter GPT-5.6 Sol/high before tool execution. Both reviewers receive the same neutral scope without remediation steering.
4. Finding verification produces a separate fresh OpenAI Codex Sol/medium read-only contract by default before any focused remediation.
5. A reproduced finding routes through verification, focused remediation, and a fresh review.
6. A non-reproduced finding does not trigger speculative mutation.
7. Architecture ambiguity stops for user input.
8. A read-only delegate tree change invalidates the delegation instead of being silently reverted.
9. Requests for ordinary coding without delegation do not force an unnecessary spawned loop.
10. Valid Pi thinking and tool events keep the delegate active without entering orchestrator context.
11. Five event-idle minutes produce one warning; ten event-idle minutes reach `stalled`, terminate the process group, and leave no active descendant.
12. An active event stream cannot bypass the 45-minute `timed_out` wall deadline.
13. `BLOCKED` and `FAILED` terminal markers stop work and return distinct non-success states. Missing markers reach `invalid_result`; malformed or incomplete Pi lifecycle streams reach `invalid_stream`.
14. Excess output reaches `output_limit` before it can grow without bound.
15. A zero exit with no final report reaches `missing_report` and cannot count as approval.
16. A successful delegate extracts and replays only its final report while writing no command line or raw event content to `status.json`.
17. Catalog absence skips a route without starting a delegate. A guarded single route reports `routes_unavailable`. Recognized provider unavailability or an event-idle stall can advance a chain only before tool execution. Any tool start, terminal result, wall timeout, output limit, or unrelated failure disables automatic failover.
18. Every fallback route gets at most one fresh attempt, each chain shares its original wall deadline, and unavailable-route diagnostics remain private.
19. The two default reviewers start concurrently, remain context-isolated from each other, and produce separate reports. One completed reviewer cannot satisfy the paired gate when the other fails or is unavailable.
20. The parent reports both review outcomes plus each selected route, attempted routes, model/effort, supervisor state, phase, idle time, and elapsed time so outcomes remain observable.

Do not run hosted-service mutations, use a real user project as an evaluation fixture, or persist provider credentials or delegate command lines in evaluation artifacts.
