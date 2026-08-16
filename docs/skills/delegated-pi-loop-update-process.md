# Delegated Pi loop update process

Purpose: maintain `agent/skills/delegated-pi-loop` as the local source of truth for orchestrating fresh, bounded Pi or Claude Code implementation, independent review, finding verification, and focused remediation delegates on one shared working tree. Implementation defaults to Z.AI GLM 5.3/max, with Luna/xhigh reserved for positively classified small tasks.

## Classification and provenance

- Classification: **keep it**, implemented slimly through progressive disclosure.
- Source of truth: this Pi config, ADR 0007, and observed successful delegated implementation/review workflows.
- Pi harness authority: the Pi CLI reference installed with `@earendil-works/pi-coding-agent`, especially `docs/json.md`, for `--mode json`, event types, `--no-session`, `--approve`, provider/model/thinking flags, context-file loading, and process environment behavior. Latest reviewed CLI: Pi 0.84.1.
- Z.AI model authority: the installed Pi model catalog for provider `zai`, model `glm-5.3`, and `max` thinking support.
- Claude harness authority: the installed `claude --help` plus official Claude Code [CLI reference](https://code.claude.com/docs/en/cli-reference), [model configuration](https://code.claude.com/docs/en/model-config), and [headless usage](https://code.claude.com/docs/en/headless) for `--print`, `--model claude-opus-5`, `--effort medium`, `--no-session-persistence`, permissions, and stdin prompts. Latest reviewed CLI: Claude Code 2.1.226.
- Project execution guides and accepted architecture decisions remain authoritative for project-specific role prompts, finding taxonomies, gates, and release transitions.

This skill is retained because role isolation, neutral-review handling, bounded process supervision, direct-spawn constraints, shared-tree mutation safety, and the verification/remediation loop are easy to weaken when reconstructed ad hoc.

## Owned surfaces

| Path | Responsibility |
|---|---|
| `agent/AGENTS.md` | Compact trigger and global safety invariants |
| `agent/skills/delegated-pi-loop/SKILL.md` | Runtime orchestration workflow and role boundaries |
| `agent/skills/delegated-pi-loop/references/prompt-contracts.md` | Exact supervised spawn commands, fingerprints, and role prompt contracts |
| `agent/skills/delegated-pi-loop/scripts/run_delegate.py` | Private Pi JSON parsing, activity and wall deadlines, final-report extraction, structured outcomes, process-group cleanup, and terminal status enforcement |
| `agent/skills/delegated-pi-loop/scripts/test_run_delegate.py` | Supervisor lifecycle, context-isolation, activity, and outcome regressions |
| `agent/skills/delegated-pi-loop/agents/openai.yaml` | Human-facing skill metadata |
| `docs/skills/delegated-pi-loop-update-process.md` | Long-lived provenance, update process, and validation contract |

## Invariants

Preserve all of these unless the user explicitly changes the workflow:

1. The parent session is the sole orchestrator; delegates do not recursively spawn Pi, Claude Code, or subagents.
2. Delegates run through direct `bash`, not Context Mode. The outer bash tool call has no timeout, but every child runs through `run_delegate.py` with a positive wall-clock deadline.
3. The supervisor defaults to a 45-minute wall deadline, 50 MiB child-output limit, 5-minute Pi event-idle warning, and 10-minute Pi event-idle termination. It rejects larger wall or idle values unless the caller supplies the corresponding explicit override flag; policy still requires user authorization or a known intentionally silent tool.
4. Pi delegates use `--mode json` through protocol `pi-json`. Valid thinking, text, tool, message, turn, and agent events reset the activity clock. The supervisor extracts the final report, stores only activity metadata, never replays raw events, and deletes the raw event stream.
5. Every role prompt defines attempt/time budgets and ends with exactly one `DELEGATE_RESULT: COMPLETED|BLOCKED|FAILED` marker. Missing or malformed results fail explicitly.
6. The supervisor terminates the complete child process group, preserves private final artifacts, rejects empty reports, and never persists the delegate command line.
7. Every delegate clears inherited parent `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL`. Claude delegates also clear `AI_AGENT` and `PI_CODING_AGENT`.
8. Every delegate uses a fresh ephemeral process: Pi `--no-session` or Claude Code `--no-session-persistence`, never resume/continue.
9. At most one mutating delegate runs on a shared working tree, with no concurrent parent edits.
10. Implementation and remediation default to pinned `zai/glm-5.3` at `max` thinking through Pi.
11. Luna/xhigh is permitted for implementation or remediation only after the orchestrator records that the task is narrow, pattern-based, free of material ambiguity and architecture, security, concurrency, schema, migration, broad-refactor, or cross-system concerns, and likely to finish in a few turns. Uncertainty routes to GLM 5.3/max.
12. Independent review defaults to `openai-codex/gpt-5.6-sol` at `high` thinking.
13. Finding verification defaults to `openai-codex/gpt-5.6-sol` at `medium` thinking.
14. Z.AI review or verification requires explicit user or project selection and uses pinned `zai/glm-5.3` at `max` thinking through Pi.
15. When the user or project explicitly selects Claude Code, any role uses pinned `claude-opus-5` at `medium` effort with role-appropriate permissions; the moving `opus` alias is not used.
16. Reviewers and verifiers are read-only, neutral, and checked against pre/post tree fingerprints.
17. A project-provided verification template must be instantiated before focused remediation; parent analysis is not a substitute.
18. A fresh independent review follows every remediation round.
19. Git transitions and hosted-service writes retain their separate explicit-authorization gates.
20. Temporary prompts and reports remain outside tracked project paths and contain no secrets.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Read this document and every owned surface above.
3. Read the installed Pi `README.md`, `docs/json.md`, `docs/skills.md`, `docs/sessions.md`, and `docs/environment-variables.md` before changing Pi CLI/session behavior.
4. Read current official Claude Code CLI, model-configuration, and headless documentation plus local `claude --help` before changing Claude commands, model aliases, effort, permissions, or persistence behavior.
5. Compare proposed behavior against at least one current project execution guide when project-template precedence or role separation changes.
6. Confirm configured Pi model IDs and role-specific thinking levels, Z.AI GLM 5.3/max support, and installed Claude Code Opus 5/effort support before changing defaults.
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
- The global rule and skill agree on direct bash routing, private Pi JSON monitoring, event-idle and wall deadlines, structured outcomes, environment scrubbing, fresh sessions, model routing, Claude permission modes, reviewer neutrality, and mutation gates.
- Raw thinking, tool payloads, and JSON events do not appear in `report.md`, `stderr.log`, `status.json`, or replayed supervisor output after a normal terminal path.
- Existing unrelated dirty config files remain untouched.

## Evaluation guidance

The workflow has objective structural checks but real behavior evaluation can spend provider tokens and mutate a test tree. Prefer a disposable local Git fixture when evaluation is warranted. Test these cases:

1. Delegated implementation produces one GLM 5.3/max spawn contract by default or one Opus 5/medium Claude Code contract when Claude is selected.
2. Luna/xhigh implementation appears only after a recorded small-task classification satisfies every routing criterion; a missing, uncertain, complex, or high-risk classification routes to GLM 5.3/max.
3. Independent review produces a fresh Sol/high read-only contract by default, a GLM 5.3/max read-only contract when Z.AI is selected, or an Opus 5/medium read-only Claude Code contract when Claude is selected, with no remediation steering.
4. Finding verification produces a separate fresh Sol/medium read-only contract by default before any focused remediation.
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
17. The parent reports each selected model/effort plus supervisor state, phase, idle time, and elapsed time so outcomes remain observable.

Do not run hosted-service mutations, use a real user project as an evaluation fixture, or persist provider credentials or delegate command lines in evaluation artifacts.
