# ADR 0007: Isolate delegated Pi and Claude Code implementation and review roles

## Status

Accepted

## Context

A successful implementation workflow used the current Pi session as an orchestrator and fresh one-shot Pi processes as implementation, independent-review, finding-verification, and focused-remediation delegates. The same role isolation applies when the user explicitly selects Z.AI GLM 5.3 through Pi or Claude Code with Claude Opus 5. The useful behavior came from more than merely asking a second model for help:

- implementation and review used different role-appropriate models and reasoning levels;
- each role started without conversation history;
- only one delegate could mutate the shared working tree;
- independent reviewers received governing documents but no remediation steering;
- blocking findings were verified independently before a separate remediation run;
- every remediation was followed by another fresh review;
- project execution guides remained authoritative; and
- Git and hosted-service transitions remained separately authorized.

Reconstructing these constraints ad hoc is error-prone. Putting the full procedure in global `AGENTS.md` would increase every session's context cost. Prompt templates require explicit user invocation and do not reliably route implicit orchestration requests. A Pi extension could automate process management, but would introduce executable lifecycle, cancellation, output-capture, and mutation-safety complexity before it is needed.

The previously retired `context-watcher` was a broad orchestration runtime skill. Restoring that broad scope is unnecessary; this decision concerns one narrow, explicitly requested implementation/review loop.

Repeated delegate calls exposed a missing lifecycle bound. One delegate remained silent for about 85 minutes and ended only after SIGTERM with no report. A later retry left no tool result when the parent session ended. Fresh sessions and role isolation do not protect against provider stalls, deadlocks, empty stdout, or abandoned descendants.

A 2026-08-16 external chart review supplied only directional evidence that lower reasoning effort can reduce latency. Its subscription estimates and Pareto curve were not reliable enough to establish model policy. The user chose to adopt lower effort now as an operational trial. Final independent review retains higher effort because missed blockers have greater cost than slower execution.

## Decision

Adopt a layered delegated-Pi workflow:

1. Keep only the trigger and non-negotiable safety rules in global `agent/AGENTS.md`.
2. Keep the runtime workflow in the progressively disclosed `delegated-pi-loop` Local Skill.
3. Keep exact generic spawn commands and role prompt contracts in the skill's on-demand reference.
4. Keep provenance, update checks, and evaluation guidance in `docs/skills/delegated-pi-loop-update-process.md`.

The parent Pi session is the sole orchestrator. Spawned Pi or Claude Code delegates execute their assigned role directly and do not recursively delegate.

Run delegates through direct `bash`, never Context Mode, and omit the spawning tool call's timeout. Route every child through the `delegated-pi-loop` supervisor with a positive wall-clock deadline. The default deadline is 45 minutes, with a 50 MiB combined output limit. The supervisor emits heartbeats, captures stdout and stderr in a private temporary directory, terminates the complete child process group, rejects empty reports, and writes a terminal status record. Clear inherited `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` before each delegate. Also clear `AI_AGENT` and `PI_CODING_AGENT` before Claude delegates. Run delegates sequentially by default and use fresh ephemeral processes:

- Pi: `--print --no-session --approve`;
- Claude Code: `--print --no-session-persistence` with role-appropriate non-interactive permissions.

Pi 0.84.1 sets `AI_AGENT=pi` and `PI_CODING_AGENT=true` in each Pi child. Pi's built-in bash tool replaces the cleared metadata with the child session's values. The scrub prevents parent metadata from misleading child extensions or generic subprocesses.

Default role assignments are:

- implementation and focused remediation: `openai-codex/gpt-5.6-luna`, thinking `xhigh`;
- independent review: `openai-codex/gpt-5.6-sol`, thinking `high`;
- finding verification: `openai-codex/gpt-5.6-sol`, thinking `medium`;
- explicit Z.AI alternative for any role: `zai/glm-5.3`, thinking `max`;
- explicit Claude Code alternative for any role: `claude-opus-5`, effort `medium`.

The OpenAI Codex role models remain the defaults. Use Z.AI or Claude Code only when the user or project explicitly selects that alternative. Pin `zai/glm-5.3` at `max` thinking or `claude-opus-5` at `medium` effort rather than using a moving alias. User instructions and more-specific project workflows may otherwise override model selection. Project role templates, finding taxonomies, and release gates take precedence over generic skill skeletons.

Only one mutating delegate may run on a shared working tree, and the parent must not edit concurrently. Reviewers and verifiers are read-only and neutral; compare tree state before and after their runs. If a project provides separate finding-verification and focused-remediation templates, instantiate both in separate fresh processes. Parent-session analysis cannot replace required independent verification.

Do not stage, commit, push, open or merge pull requests, deploy, or mutate hosted services unless that exact transition has been separately authorized.

## Consequences

- Other Pi sessions can reproduce the workflow with default Pi role models, explicitly selected Z.AI GLM 5.3 delegates, or explicitly selected Claude Code delegates from a compact automatic trigger.
- The always-loaded global context grows only by the short trigger/safety section; detailed behavior remains on demand.
- Independent-review credibility depends on role and context isolation rather than model self-approval.
- Shared-tree safety remains prompt- and fingerprint-enforced; this is not an operating-system sandbox because reviewers may still have `bash`.
- A stalled delegate now terminates within its configured bound. Empty stdout becomes a failed `missing_report` state instead of silent success.
- Supervisor artifacts preserve the report, stderr, and terminal status without persisting the delegate command line.
- Routine implementation and verification should complete faster if the directional evidence transfers to local workloads; final review retains Sol/high as the quality gate.
- Model identifiers, thinking or effort levels, and process environment markers are maintenance points. Check each contract when Pi or Claude Code changes them.
- Real delegate evaluations can spend provider tokens and may mutate a fixture, so structural validation is the default and live smoke tests require an appropriate disposable workspace and authorization.

## Alternatives rejected

- **Full workflow in global `AGENTS.md`:** rejected because it taxes every request and duplicates progressively disclosed material.
- **Prompt templates only:** rejected because they depend on explicit slash-command use and do not establish automatic routing for future agents.
- **Immediate Pi extension:** deferred because executable orchestration, cancellation, output capture, and sandboxing are unnecessary complexity for the proven sequential workflow.
- **Restore broad `context-watcher`:** rejected because the requested capability is narrower and should not revive unrelated orchestration behavior.
- **Let implementers self-review:** rejected because it does not provide fresh context or independent judgment.
- **Keep delegates unbounded:** rejected because provider or process stalls can hold the parent tool call indefinitely and lose the final report.
- **Use only the bash tool timeout:** rejected because a dedicated supervisor provides heartbeats, durable diagnostics, explicit empty-report failure, and descendant cleanup while the outer orchestration call remains observable.

## Validation

1. Validate the target skill and every Local Skill.
2. Parse every `agents/openai.yaml` and verify the delegated skill's default prompt names `$delegated-pi-loop`.
3. Check Pi accepts Luna/xhigh, Sol/high, Sol/medium, and Z.AI GLM 5.3/max selections without provider inference.
4. Check the installed Claude Code version supports Opus 5, `--effort medium`, `--no-session-persistence`, and the documented permission flags.
5. Check global and skill instructions agree on direct bash, bounded child supervision, environment scrubbing, fresh sessions, one mutator, neutral reviewers, and authorization gates.
6. Run supervisor regressions for successful reports, empty reports, deadlines, and descendant cleanup.
7. Check changed Markdown links, placeholders, user-specific paths, secrets, and runtime artifacts.
8. Measure the incremental global-context and skill-catalog cost without requiring paid inference.
9. When CLI/model semantics change materially, run a disposable-fixture delegate smoke only with appropriate authorization.
