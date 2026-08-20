# Delegated Pi loop update process

Purpose: maintain `agent/skills/delegated-pi-loop` as the local source of truth for fresh, bounded Pi or Claude Code solution investigation, implementation, independent review, finding verification, and focused remediation delegates on one shared working tree. When a problem lacks an accepted solution contract, three read-only investigators A, B, and C propose solutions before the orchestrator verifies evidence and finalizes the contract. Z.AI GLM 5.3/max can serve any assigned role and defaults to implementation/remediation. Final independent review uses three fresh concurrent read-only reviewers A, B, and C with the same route maps. AgentRouter, Tabitoken, SeekAI, and GoRouter are backup-only backends inside each member's ordered map.

## Classification and provenance

- Classification: **keep it**, implemented slimly through progressive disclosure.
- Source of truth: this Pi config, ADR 0007, and observed successful delegated solution-investigation, implementation, and review workflows.
- Pi harness authority: the Pi CLI reference installed with `@earendil-works/pi-coding-agent`, especially `docs/json.md`, for `--mode json`, event types, `--no-session`, `--approve`, provider/model/thinking flags, context-file loading, and process environment behavior. Latest reviewed CLI: Pi 0.84.1.
- Z.AI model authority: the installed Pi model catalog for provider `zai`, model `glm-5.3`, and `max` thinking support.
- Fallback-provider authority: tracked `agent/models.json` plus Pi's available model catalog. Current primaries use `opencode-go/muse-spark-1.2-contributor`, `opencode-go/deepseek-v4-flash`, and `opencode-go/hy3`. Current backup routes use `agentrouter/gpt-5.6-sol`, `tabitoken/claude-opus-5-thinking`, `gorouter/claude-opus-5-thinking`, `seekai/deepseek-v4-flash`, `agentrouter/claude-opus-5`, and `seekai/claude-opus-5`. A configured model can remain unavailable when its credential or provider is intermittent, so the chain must preflight the live available catalog. Catalog validation for a provider additionally requires the parent Pi process to have inherited that provider's credential variable, such as `TABITOKEN_API_KEY`; restart Pi from a refreshed shell containing that variable before treating that provider's route as unavailable.
- Claude harness authority: the installed `claude --help` plus official Claude Code [CLI reference](https://code.claude.com/docs/en/cli-reference), [model configuration](https://code.claude.com/docs/en/model-config), and [headless usage](https://code.claude.com/docs/en/headless) for `--print`, `--model claude-opus-5`, `--effort medium`, `--no-session-persistence`, permissions, and stdin prompts. Latest reviewed CLI: Claude Code 2.1.226.
- Project execution guides and accepted architecture decisions remain authoritative for project-specific role prompts, finding taxonomies, gates, and release transitions.

This skill is retained because independent solution analysis, orchestrator synthesis, role isolation, neutral-review handling, bounded process supervision, direct-spawn constraints, shared-tree mutation safety, and the verification/remediation loop are easy to weaken when reconstructed ad hoc.

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
4. Pi delegates use `--mode json` through protocol `pi-json`. Valid thinking, text, tool, message, turn, and agent events reset the activity clock. A valid `COMPLETED` report followed by final `agent_settled` is terminal success even if Pi remains alive; the supervisor cleans up the process group and records `completion_cleanup_performed`. Malformed trailing stream data still fails closed. The supervisor extracts the final report, stores only activity metadata, never replays raw events, and deletes the raw event stream.
5. Guarded routes and ordered chains preflight each exact provider/model against Pi's available catalog. Recognized provider unavailability includes gateway cancellation signals such as `client_gone` and `context canceled`, provider stream-scanner failures such as `scanner_error` and `unexpected EOF` matched case-insensitively with the existing separator tolerance, plus the machine-rendered `[error]` envelope a provider can return as the complete single-line final assistant report without a structured outcome. Arbitrary missing-marker reports, including multi-section text that starts with `[error]`, remain terminal failures. A chain may move forward once only before any tool starts and before any terminal delegate result. Every candidate uses a fresh process, all candidates share one wall deadline, and a chain never cycles.
6. Every role prompt defines attempt/time budgets and ends with exactly one `DELEGATE_RESULT: COMPLETED|BLOCKED|FAILED` marker. Missing or malformed results fail explicitly.
7. The supervisor terminates the complete child process group, preserves private final artifacts, rejects empty reports, and never persists the delegate command line.
8. Every delegate clears inherited parent `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL`. Claude delegates also clear `AI_AGENT` and `PI_CODING_AGENT`. Provider credentials inherit unchanged from the parent Pi process. Variables added after Pi starts require a restart from a refreshed shell; delegate commands never source shell startup files or print credential values.
9. Every delegate uses a fresh ephemeral process: Pi `--no-session` or Claude Code `--no-session-persistence`, never resume/continue.
10. At most one mutating delegate runs on a shared working tree, with no concurrent parent edits. Each documented read-only three-member gate runs concurrently; mutators and finding verifiers remain sequential.
11. When a problem lacks an accepted solution contract, three fresh read-only investigators receive the same neutral prompt: A on `opencode-go/muse-spark-1.2-contributor` at `xhigh`, B on `opencode-go/deepseek-v4-flash` at `max`, and C on `opencode-go/hy3` at `high`. Muse Spark 1.2 Contributor maps `max` to null in its thinking-level map, so `xhigh` is its highest supported level. HY3 does not support `max`: Pi would clamp `max` to `high`, and the user selected HY3 at `high`. Each member carries its ordered pre-tool backup map. Their reports remain isolated.
12. The orchestrator verifies material `path:line`, control-flow, and architecture claims from all three investigator reports before finalizing one solution contract. Material architecture ambiguity stops for user input.
13. Solution investigators never implement and are never reused as post-implementation reviewers.
14. Implementation and remediation default to pinned `zai/glm-5.3` at `max` thinking through Pi.
15. AgentRouter, Tabitoken, SeekAI, and GoRouter are never default primaries; they appear only as ordered pre-tool backups inside the A, B, and C member chains. The former Tabitoken-first small-task implementation/remediation chain is retired: all implementation and remediation work defaults to GLM 5.3/max, and explicit user or project backend selection remains allowed with role-based permissions.
16. Default independent review launches three fresh read-only reviewers A, B, and C concurrently with the same route maps as solution investigation: `opencode-go/muse-spark-1.2-contributor` at `xhigh`, `opencode-go/deepseek-v4-flash` at `max`, and `opencode-go/hy3` at `high`, each with its ordered pre-tool backup map. All three must complete, and findings from any report require processing. Reviewers receive no investigator reports or synthesis rationale.
17. Finding verification remains `openai-codex/gpt-5.6-sol` at `high`.
18. Z.AI can serve any assigned role through pinned `zai/glm-5.3` at `max` thinking. It defaults to implementation/remediation; investigation, review, or verification requires explicit user or project selection when it replaces a default route. The assigned role controls mutation permissions.
19. When the user or project explicitly selects Claude Code, any role uses pinned `claude-opus-5` at `medium` effort with role-appropriate permissions; the moving `opus` alias is not used.
20. Solution investigators, reviewers, and verifiers are read-only, neutral, and checked against pre/post tree fingerprints.
21. A project-provided verification template must be instantiated before focused remediation; parent analysis is not a substitute.
22. A fresh independent review follows every remediation round.
23. Git transitions and hosted-service writes retain their separate explicit-authorization gates.
24. Temporary prompts and reports remain outside tracked project paths and contain no secrets.

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Read this document and every owned surface above.
3. Read the installed Pi `README.md`, `docs/json.md`, `docs/skills.md`, `docs/sessions.md`, and `docs/environment-variables.md` before changing Pi CLI/session behavior.
4. Read current official Claude Code CLI, model-configuration, and headless documentation plus local `claude --help` before changing Claude commands, model aliases, effort, permissions, or persistence behavior.
5. Compare proposed behavior against at least one current project execution guide when project-template precedence or role separation changes.
6. Confirm every configured route ID and thinking level in `agent/models.json`. Use `pi --list-models provider/model` to distinguish configured routes from routes currently available with credentials. Before classifying a configured route as unavailable, confirm the parent Pi process inherited the required credential variable without printing its value. Restart Pi from a refreshed shell if the variable was added after startup. Also confirm Z.AI GLM 5.3/max and installed Claude Code Opus 5/effort support before changing defaults.
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
- The global rule and skill agree on direct bash routing, private Pi JSON monitoring, event-idle and shared wall deadlines, bounded pre-tool route failover, concurrent solution investigators, orchestrator evidence verification and synthesis, fresh independent reviewers, structured outcomes, session-metadata scrubbing, provider-credential inheritance, fresh sessions, exact model routing, Z.AI any-role availability, assigned-role mutation limits, Claude permission modes, reviewer neutrality, and mutation gates.
- Raw thinking, tool payloads, and JSON events do not appear in `report.md`, `stderr.log`, `status.json`, or replayed supervisor output after a normal terminal path.
- Existing unrelated dirty config files remain untouched.

## Evaluation guidance

The workflow has objective structural checks but real behavior evaluation can spend provider tokens and mutate a test tree. Prefer a disposable local Git fixture when evaluation is warranted. Test these cases:

1. A problem without an accepted solution contract launches the three investigators A, B, and C concurrently with identical neutral prompts and isolated outputs: OpenCode Go Muse Spark 1.2 Contributor/xhigh, OpenCode Go DeepSeek V4 Flash/max, and OpenCode Go HY3/high. Each member advances through its ordered backup map only after catalog absence or pre-tool provider unavailability.
2. All three investigator reports cite exact files and lines, explain root cause and control flow, propose solutions and alternatives, and remain read-only. The parent verifies material evidence and produces one final solution contract. Architecture ambiguity stops for user input.
3. A task with an accepted plan or obvious established pattern skips unnecessary solution investigation.
4. Delegated implementation consumes the finalized solution contract and produces one GLM 5.3/max spawn contract by default or one Opus 5/medium Claude Code contract when Claude is selected.
5. No default primary is AgentRouter, Tabitoken, SeekAI, or GoRouter; those backends appear only as ordered pre-tool backups, and every implementation or remediation task routes to GLM 5.3/max unless the user or project explicitly selects another backend.
6. Final independent review uses three fresh processes that did not investigate or implement. It launches the same A, B, and C routes as investigation concurrently with isolated outputs. Each member advances through its ordered backup map only after catalog absence or pre-tool provider unavailability. Reviewers receive no investigator reports or synthesis rationale.
7. Finding verification produces a separate fresh OpenAI Codex Sol/high read-only contract by default before any focused remediation. Explicit Z.AI selection uses GLM 5.3/max with the same verification-only mutation prohibition.
8. A reproduced finding routes through verification, focused remediation, and a fresh review.
9. A non-reproduced finding does not trigger speculative mutation.
10. Architecture ambiguity stops for user input.
11. A read-only delegate tree change invalidates the delegation instead of being silently reverted.
12. Requests for ordinary coding without delegation do not force an unnecessary spawned loop.
13. Valid Pi thinking and tool events keep the delegate active without entering orchestrator context.
14. Five event-idle minutes produce one warning; ten event-idle minutes reach `stalled`, terminate the process group, and leave no active descendant.
15. A child that emits a valid `COMPLETED` report, final `agent_end`, and `agent_settled` but remains alive reaches `completed` promptly, records completion cleanup, and leaves no active process. Partial trailing JSON still reaches `invalid_stream`.
16. An active event stream cannot bypass the 45-minute `timed_out` wall deadline.
17. `BLOCKED` and `FAILED` terminal markers stop work and return distinct non-success states. Missing markers reach `invalid_result`; malformed or incomplete Pi lifecycle streams reach `invalid_stream`.
18. Excess output reaches `output_limit` before it can grow without bound.
19. A zero exit with no final report reaches `missing_report` and cannot count as approval.
20. A successful delegate extracts and replays only its final report while writing no command line or raw event content to `status.json`.
21. Catalog absence skips a route without starting a delegate. A guarded single route reports `routes_unavailable`. Before treating that state as provider failure, verify that the parent Pi process inherited the required credential variable. `client_gone`, `context canceled`, `scanner_error`, or `unexpected EOF` can advance a chain only before tool execution. The same errors after a tool start must not advance the chain. A provider-rendered single-line `[error]` envelope forming the complete assistant report is another recognized availability signal under the same pre-tool cutoff; report prose and multi-section reports that merely mention unavailability are not. Any terminal result, wall timeout, output limit, or unrelated failure also disables automatic failover.
21. Every fallback route gets at most one fresh attempt, each chain shares its original wall deadline, and unavailable-route diagnostics remain private.
22. Each three-member gate starts concurrently, remains internally context-isolated, and produces separate reports. One or two completed delegates cannot satisfy a required gate when another member fails or is unavailable.
23. The parent reports solution-investigation and review outcomes plus each selected route, attempted routes, model/effort, supervisor state, phase, idle time, and elapsed time so outcomes remain observable.

Do not run hosted-service mutations, use a real user project as an evaluation fixture, or persist provider credentials or delegate command lines in evaluation artifacts.
