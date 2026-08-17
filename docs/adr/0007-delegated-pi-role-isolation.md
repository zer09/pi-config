# ADR 0007: Isolate delegated solution, implementation, and review roles

## Status

Accepted

## Context

A successful implementation workflow used the current Pi session as an orchestrator and fresh one-shot Pi processes as solution-investigation, implementation, independent-review, finding-verification, and focused-remediation delegates. The same role isolation applies whenever Z.AI GLM 5.3 or Claude Code with Claude Opus 5 serves an assigned role. The useful behavior came from more than merely asking a second model for help:

- solution investigation, implementation, and review used fresh role-appropriate processes;
- each role started without conversation history;
- only one delegate could mutate the shared working tree;
- independent reviewers received governing documents but no remediation steering;
- blocking findings were verified independently before a separate remediation run;
- every remediation was followed by another fresh review;
- project execution guides remained authoritative; and
- Git and hosted-service transitions remained separately authorized.

Reconstructing these constraints ad hoc is error-prone. Putting the full procedure in global `AGENTS.md` would increase every session's context cost. Prompt templates require explicit user invocation and do not reliably route implicit orchestration requests. A Pi extension could automate process management, but would introduce executable lifecycle, cancellation, output-capture, and mutation-safety complexity before it is needed.

The previously retired `context-watcher` was a broad orchestration runtime skill. Restoring that broad scope is unnecessary; this decision concerns one narrow, explicitly requested implementation/review loop.

Repeated delegate calls exposed a missing lifecycle bound. One delegate remained silent for about 85 minutes and ended only after SIGTERM with no report. A later retry left no tool result when the parent session ended. Another browser verifier stayed active for two hours although its remaining proof was already blocked. Fresh sessions and role isolation do not protect against provider stalls, silent tools, active but unproductive loops, empty reports, or abandoned descendants.

A 2026-08-16 external chart review supplied only directional evidence that lower reasoning effort can reduce latency. Its subscription estimates and Pareto curve were not reliable enough to establish model policy. After a brief lower-effort trial decision, the user selected GLM 5.3/max as the implementation default and retained Luna/xhigh only for positively classified small tasks. Final independent review retains higher effort because missed blockers have greater cost than slower execution.

AgentRouter, SeekAI, and GoRouter later supplied useful additional routes, but their catalog or provider availability can be intermittent. A live check initially reported SeekAI and GoRouter as unavailable because the existing Pi process predated their API-key environment variables. Fresh supervised smokes succeeded after Pi restarted from a refreshed shell. Catalog availability therefore reflects both provider health and the credentials inherited when the parent Pi process starts. Blind automatic retries are unsafe for mutating delegates because a prior attempt may already have changed the shared tree. A safe route fallback therefore needs a strict pre-tool boundary, fresh processes, ordered one-shot candidates, and one shared deadline.

For problems without an accepted implementation plan, parent-only diagnosis can commit too early to one interpretation. Two independent read-only investigators can first locate the relevant flow, cite exact source evidence, and propose solutions. The parent remains the orchestrator: it verifies those claims, resolves non-architectural differences, and finalizes the solution contract. Investigators cannot later provide independent approval of the implementation they influenced, so post-implementation review uses completely fresh processes.

## Decision

Adopt a layered delegated-Pi workflow:

1. Keep only the trigger and non-negotiable safety rules in global `agent/AGENTS.md`.
2. Keep the runtime workflow in the progressively disclosed `delegated-pi-loop` Local Skill.
3. Keep exact generic spawn commands and role prompt contracts in the skill's on-demand reference.
4. Keep provenance, update checks, and evaluation guidance in `docs/skills/delegated-pi-loop-update-process.md`.

The parent Pi session is the sole orchestrator. Spawned Pi or Claude Code delegates execute their assigned role directly and do not recursively delegate.

Run delegates through direct `bash`, never Context Mode, and omit the spawning tool call's timeout. Route every child through the `delegated-pi-loop` supervisor. The defaults are a 45-minute wall deadline, 50 MiB child-output limit, 5-minute Pi event-idle warning, and 10-minute Pi event-idle termination. Larger wall or idle values require explicit supervisor override flags in addition to the applicable authorization or known-tool justification. Pi delegates use JSON event mode. The Python supervisor parses thinking, text, tool, message, turn, and agent events privately; updates activity metadata; identifies provider-availability errors and tool starts without retaining their content; extracts only the final report; and deletes raw events. Plain-protocol delegates retain process heartbeats until they gain a stream adapter. The supervisor terminates the complete child process group, rejects empty or malformed results, and writes a terminal status record.

Documented multi-provider Pi roles use a guarded route wrapper. The wrapper preflights each exact provider/model against Pi's currently available catalog. An ordered chain can advance after catalog absence, recognized provider unavailability, or an event-idle stall only before any tool execution and without a terminal delegate result. Each candidate starts in a fresh process, receives the same role prompt, and runs within the original shared wall deadline. The wrapper never cycles to an earlier route and never exposes failed-route raw events or provider errors to the parent model. Provider credentials pass unchanged from the parent Pi environment; newly configured variables require a parent Pi restart from a refreshed shell. Delegate commands do not source shell startup files or expose credential values. Clear inherited `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL` before each delegate. Also clear `AI_AGENT` and `PI_CODING_AGENT` before Claude delegates. Run mutators and finding verifiers sequentially. Run each documented read-only pair concurrently in separate direct bash tool calls: solution investigators before implementation when needed, then fresh independent reviewers after implementation. Use fresh ephemeral processes:

- Pi: `--mode json --no-session --approve` through supervisor protocol `pi-json`;
- Claude Code: `--print --no-session-persistence` with role-appropriate non-interactive permissions.

Pi 0.84.1 sets `AI_AGENT=pi` and `PI_CODING_AGENT=true` in each Pi child. Pi's built-in bash tool replaces the cleared metadata with the child session's values. The scrub prevents parent metadata from misleading child extensions or generic subprocesses.

Default role assignments are:

- independent solution investigation A: `gorouter/claude-opus-5-thinking`, thinking `high`;
- independent solution investigation B: `agentrouter/claude-opus-5` → `agentrouter/gpt-5.6-sol`, thinking `high`;
- implementation and focused remediation: `zai/glm-5.3`, thinking `max`;
- small-task implementation or remediation only: `gorouter/claude-opus-4-8-thinking` → `agentrouter/claude-opus-4-8` → `seekai/deepseek-v4-flash` → `openai-codex/gpt-5.6-luna`, thinking `xhigh`;
- independent review A: `gorouter/claude-opus-5-thinking`, thinking `high`;
- independent review B: `agentrouter/claude-opus-5` → `agentrouter/gpt-5.6-sol`, thinking `high`;
- finding verification: `openai-codex/gpt-5.6-sol`, thinking `medium`;
- explicit Z.AI alternative for any assigned role: `zai/glm-5.3`, thinking `max`, with mutation permissions inherited from the role;
- explicit Claude Code alternative for any role: `claude-opus-5`, effort `medium`.

When a problem lacks an accepted solution contract, default solution investigation launches both read-only investigators concurrently with the same neutral prompt. Only investigator B has fallback, from AgentRouter Opus 5/high to AgentRouter GPT-5.6 Sol/high before tool execution. Both reports remain isolated. The orchestrator verifies cited source and architecture evidence, compares the proposals, and finalizes one solution contract. Material architecture ambiguity stops for user input. Investigators do not implement and cannot serve as the later reviewers.

GLM 5.3/max is available for any assigned role and remains the implementation and remediation default. Z.AI investigation, review, or verification requires explicit user or project selection and remains read-only. The assigned role, not the backend, controls mutation permissions. The orchestrator may select the GoRouter-first small-task chain only after recording that the task is narrow, follows an established pattern, has no material ambiguity or architecture, security, concurrency, schema, migration, broad-refactor, or cross-system concern, and should finish in a few turns. Uncertainty routes to GLM 5.3/max. Default independent review launches both fresh read-only reviewers concurrently after implementation. Only reviewer B has fallback, from AgentRouter Opus 5/high to AgentRouter GPT-5.6 Sol/high before tool execution. Both reviews must complete, and findings from either report require processing. An explicit Z.AI or Claude Code reviewer selection does not silently reduce a required two-reviewer gate. OpenAI Codex Sol/medium remains the finding-verification default. Use Claude Code for any role only when the user or project explicitly selects it. Pin model and effort identifiers rather than using moving aliases. User instructions and more-specific project workflows may otherwise override model selection. Project role templates, finding taxonomies, and release gates take precedence over generic skill skeletons.

Only one mutating delegate may run on a shared working tree, and the parent must not edit concurrently. Solution investigators, reviewers, and verifiers are read-only and neutral; compare tree state before and after their runs. Every role prompt defines attempt/time budgets and ends with one structured `DELEGATE_RESULT` marker. A delegate that cannot establish a required result within its budget reports `BLOCKED` and stops unrelated work. If a project provides separate solution-investigation, finding-verification, or focused-remediation templates, instantiate each in separate fresh processes. Parent-session analysis cannot replace required independent verification.

Do not stage, commit, push, open or merge pull requests, deploy, or mutate hosted services unless that exact transition has been separately authorized.

## Consequences

- Other Pi sessions can reproduce concurrent pre-implementation solution investigation, parent evidence verification and synthesis, default GLM 5.3/max implementation, guarded GoRouter-first small-task fallback, fresh concurrent independent review, OpenAI Codex verification, or explicitly selected Z.AI and Claude Code assignments from a compact trigger.
- The always-loaded global context grows only by the short trigger/safety section; detailed behavior remains on demand.
- Independent-review credibility depends on role and context isolation rather than model self-approval.
- Shared-tree safety remains prompt- and fingerprint-enforced; this is not an operating-system sandbox because reviewers may still have `bash`.
- A Pi delegate with no valid activity event for ten minutes reaches `stalled`; an active loop still reaches the 45-minute wall deadline.
- `COMPLETED`, `BLOCKED`, and `FAILED` outcomes are machine-readable. Empty reports, malformed streams, and missing markers fail explicitly.
- Supervisor artifacts preserve the final report, bounded stderr, activity metadata, and terminal status without persisting the command line or raw Pi events.
- Complex or uncertain implementation routes to GLM 5.3/max. The GoRouter-first xhigh chain remains available only for clearly small, low-risk, few-turn work.
- Conditional solution investigation consumes two concurrent provider calls before implementation. Final review consumes two additional fresh calls. A pair remains incomplete if either assigned delegate fails or is unavailable.
- Catalog checks can skip an unavailable provider without spending a delegate attempt. Runtime fallback stops permanently once any tool starts or a terminal result exists.
- Model identifiers, thinking or effort levels, live catalog availability, and process environment markers are maintenance points. Check each contract when Pi or Claude Code changes them.
- Real delegate evaluations can spend provider tokens and may mutate a fixture, so structural validation is the default and live smoke tests require an appropriate disposable workspace and authorization.

## Alternatives rejected

- **Full workflow in global `AGENTS.md`:** rejected because it taxes every request and duplicates progressively disclosed material.
- **Prompt templates only:** rejected because they depend on explicit slash-command use and do not establish automatic routing for future agents.
- **Immediate Pi extension:** deferred because executable orchestration, cancellation, output capture, and sandboxing are unnecessary complexity for the mostly sequential workflow and bounded concurrent review pair.
- **Restore broad `context-watcher`:** rejected because the requested capability is narrower and should not revive unrelated orchestration behavior.
- **Repurpose solution investigators as final reviewers:** rejected because they would assess an implementation shaped by their own proposals.
- **Let implementers self-review:** rejected because it does not provide fresh context or independent judgment.
- **Keep delegates unbounded:** rejected because provider or process stalls can hold the parent tool call indefinitely and lose the final report.
- **Use only the bash tool timeout:** rejected because a dedicated supervisor provides heartbeats, durable diagnostics, explicit empty-report failure, and descendant cleanup while the outer orchestration call remains observable.
- **Retry any failed route automatically:** rejected because a mutating attempt may already have changed the shared tree. Automatic failover stops at the first tool execution or terminal delegate result.

## Validation

1. Validate the target skill and every Local Skill.
2. Parse every `agents/openai.yaml` and verify the delegated skill's default prompt names `$delegated-pi-loop`.
3. Check configured model IDs for the concurrent high-thinking solution pair, GoRouter-first xhigh implementation chain, fresh concurrent review pair and AgentRouter fallback, OpenAI Codex Sol/medium verification, and Z.AI GLM 5.3/max. Separately record which routes appear in Pi's live available catalog.
4. Check the installed Claude Code version supports Opus 5, `--effort medium`, `--no-session-persistence`, and the documented permission flags.
5. Check global and skill instructions agree on direct bash, bounded child supervision, environment scrubbing, fresh sessions, one mutator, concurrent context-isolated solution investigators, orchestrator evidence verification and synthesis, fresh neutral reviewers, paired gate semantics, and authorization gates.
6. Run supervisor and chain regressions for private Pi JSON parsing, active-event liveness, idle stalls, shared wall deadlines, structured outcomes, context isolation, catalog skips, pre-tool provider failover, tool-start cutoff, successful/empty reports, and descendant cleanup.
7. Check changed Markdown links, placeholders, user-specific paths, secrets, and runtime artifacts.
8. Measure the incremental global-context and skill-catalog cost without requiring paid inference.
9. When CLI/model semantics change materially, run a disposable-fixture delegate smoke only with appropriate authorization.
