# Changelog

This document summarizes local Pi configuration changes. Detailed upgrade notes live under [`docs/changelogs/`](./changelogs/).

## 2026-08-22 — Remove global Git tree fingerprints for read-only delegates

- Removed the active pre/post Git tree fingerprint capture and comparison from delegate execution for the read-only solution, review, verification, and oracle roles. Shared monorepo worktrees are modified concurrently by unrelated agents, so the before/after fingerprint cannot attribute the actor and incorrectly invalidated otherwise completed read-only reports; a concurrent working-tree change no longer converts a completed read-only delegate into a failure state.
- Removed the `read_only_mutation` delegate state, the `tree_fingerprint_changed` event, the user-facing message `A read-only delegate changed the working tree; its report was invalidated.`, the `TreeFingerprint` type, and the `fingerprintBefore`/`fingerprintAfter` result fields, along with the now-unused `captureTreeFingerprint`, `fingerprintsEqual`, `hashUntrackedFiles`, Git status/diff hashing helpers, and their imports; no expensive unused capture is retained.
- Kept roles semantically read-only through the existing role contracts and permission classification, including the direct Claude read-only permission arguments. Documented the residual risk in the maintenance contract and ADRs: Pi-based read-only delegates still receive the normal tool set and extensions and can misuse writable tools, and without fingerprinting the extension no longer detects such mutation automatically. No filesystem sandbox, worktree clone, path exclusion, configuration flag, or replacement mutation detector was introduced.
- Preserved all provider/model routes, Oracle behavior and guards, parallel verification scheduling and manager rules, the pre-tool fallback cutoff, supervision, cleanup, results, diagnostics privacy, and Git/hosted authorization. `agent/AGENTS.md`, the `delegate_run` description, prompt snippet, prompt guidelines, and parameter schema are unchanged because none mentioned fingerprints, so every always-loaded surface is byte-identical.
- Updated the focused runner regressions: the former fingerprint-invalidation test now proves that a read-only delegate which mutates the working tree still completes and returns its report with no fingerprint result fields, the oracle chain test no longer asserts fingerprint capture, and a new source scan keeps every runtime source free of `read_only_mutation`, tree-fingerprint capture, comparison, and result plumbing. The state-summary and tool-result patch regressions drop the removed state, and the diagnostics fixture drops the removed fields while keeping them on the exclusion list.
- Updated the maintenance contract (purpose, owned surfaces, diagnostic exclusions, orchestration gate 17 with the removal rationale and residual risk, update-workflow preserve list, required checks), ADR 0007 (dated removal provenance paragraph, current-policy decision sentence, consequences bullet), and ADR 0008 (current-policy decision paragraph), while preserving historical fingerprint statements as clearly superseded provenance.
- Validation: extension suite (67 tests), strict TypeScript check via a temporary config resolving Pi's installed declarations, `pi --list-models` extension load, exact scans for active `read_only_mutation`/fingerprint behavior, context-cost recount confirming a zero startup-context delta because no model-visible surface changed, and `git diff --check`, all without paid inference.

## 2026-08-22 — Parallelize independent finding verifications

- Moved independent finding verification from strictly sequential to bounded parallelism in the native `DelegateManager`: verification delegates may now overlap only other verification delegates, one through four run concurrently, and a fifth concurrent verification is rejected with a clear bounded batching error (`At most 4 verification delegates may run concurrently; batch the remaining findings after the current batch completes`) before any child process spawns. Finishing one verification releases its slot, and the parent batches additional findings rather than retrying blindly.
- Verification still never overlaps a solution, review, implementation, remediation, or oracle role in either start order, and implementation, remediation, and oracle remain exclusive against every active delegate. Solution and review A/B/C/D concurrency is unchanged.
- Encoded the parent policy in the model-visible `delegate_run` prompt guidelines without route details: consolidate exact duplicate findings first, give each verification exactly one finding without sibling verification reports, run independent findings concurrently in batches of at most four, keep dependent findings sequential, wait for every verification in the current batch before remediation, treat a non-completed verification as unresolved without erasing completed sibling reports, and send only verification-confirmed findings to one focused remediation role followed by a fresh four-reviewer gate.
- Updated `agent/AGENTS.md` compactly with the same batching, consolidation, batch-wait, and verification-only-overlap rules, and updated the maintenance document's orchestration gates, concurrency matrix, manager responsibility, and verification checks. ADR 0008's current-policy text now describes the bounded verification overlap, and ADR 0007 gained a dated provenance paragraph while preserving all historical sequential-verification text.
- Preserved one tool call per verification, separate artifact directories, read-only permissions with pre/post Git fingerprints, pre-tool fallback, lifecycle supervision, sibling result independence, and every provider/model route including verification's `openai-codex/gpt-5.6-sol:high`.
- Added exhaustive focused manager regressions: one-through-four verification concurrency, fifth rejection, slot release and batch reset, verification-versus-solution/review blocking in both directions, verification-versus-implementation/remediation/oracle blocking in both directions, unchanged solution/review concurrency, exclusive blocking in both directions, and abort of concurrent verification siblings; updated the exclusive-classification and guideline source-scan regressions.
- Validation: extension suite (66 tests), strict TypeScript check via a temporary config resolving Pi's installed declarations, `pi --list-models` extension load, context-cost recount with local `tiktoken` `o200k_base`, exact reference scans, and `git diff --check`, all without paid inference.

## 2026-08-22 — Restore the delegated C primary to HY3

- Restored the active C primary for both conditional solution investigation and independent review: `opencode-go/hy3:high` replaces `opencode-go/ox-alpha-free:max` in the executable route map and the focused route regression. The C ordered backup map is unchanged: AgentRouter Opus 5/max, Tabitoken Opus 5 Thinking/max, SeekAI Opus 5/max, then GoRouter Opus 5 Thinking/high.
- Documented that HY3's live catalog entry still maps `max` to null in its local thinking-level map, so the restored C primary runs at `high`, the highest mapped level, replacing the interim Ox Alpha native-`max` rationale. Verified the route in Pi's live catalog and the stored level map without paid inference.
- Preserved the A/B/D route maps, D inheritance and single random draw, the conditional Sol oracle routing and model-id-based skip, explicit backend overrides, implementation, remediation, and verification routes, pre-tool-only fallback cutoff, supervision, result, diagnostics, and fingerprint behavior.
- Updated ADR 0007 current policy with a dated restoration paragraph while preserving the earlier HY3 and interim Ox Alpha paragraphs as factual provenance, the maintenance document's role table, thinking rationale, and catalog checks, and the context-cost line for this route-only change with a zero startup-context delta because the executable route map is not model-visible.
- Validation: extension suite (60 tests), strict TypeScript check via a temporary config resolving Pi's installed declarations, `pi --list-models` extension load, live-catalog verification of the restored C primary and its no-`max` level map, `git diff --check`, and exact reference scans, all without paid inference.

## 2026-08-21 — Add the conditional Sol oracle stage

- Added a distinct read-only advisory `oracle` role to the native `delegate_run` tool between solution synthesis and implementation. The oracle runs exactly once, only after a required solution A/B/C/D investigation gate completed, the parent verified evidence, and the parent synthesized a draft solution contract; a small task that skips solution investigation also skips the oracle and still runs exactly one implementation delegate.
- The oracle always uses `gpt-5.6-sol` at thinking `high` through default Pi routing on exactly the five D-eligible providers `openai-codex`, `openai-codex-zahlo`, `openai-codex-cgpt1`, `openai-codex-cgpt2`, and `openai-codex-cgpt3` in canonical order, with the same inherited-eligible-or-one-random primary selection as D and the existing pre-tool-only fallback cutoff. Cursor, AgentRouter, SeekAI, and every other provider are excluded.
- Main-Sol skip detection is model-id based, not provider based: when the parent session's current model id is exactly `gpt-5.6-sol`, the oracle is skipped on any parent provider and the parent finalizes the solution contract directly. The extension enforces this skip and rejects explicit `backend=zai`/`backend=claude` for the oracle defensively before any child process spawns, using a bounded tool error rather than a fabricated oracle report; `routes.ts` additionally refuses to build a non-default oracle route.
- The oracle is advisory, not the final authority: it reports exactly one `VALID` or `REVISE` verdict with correctness analysis, missing invariants and risks, better alternatives where material, exact path:line evidence, validation changes, and limits, and must not edit, mutate Git or hosted state, implement, or start delegates. The parent verifies oracle claims, revises the draft when warranted, and finalizes before implementation; there is no automatic oracle loop, and a non-completed oracle run blocks implementation.
- The oracle is read-only with the existing pre/post Git fingerprint invalidation and sequential/exclusive like finding verification: no concurrent mutating or other exclusive delegate, with the manager diagnostics updated accordingly.
- Kept `agent/AGENTS.md` slim and route-free by adding only the oracle workflow responsibility, and put the exact `gpt-5.6-sol` condition and routing requirements in the model-visible `delegate_run` guidelines and the maintenance document.
- Updated the oracle role contract and prompt construction guidance so the parent passes the neutral problem, governing documents, verified evidence, the draft solution contract, constraints, and unresolved uncertainties, never raw investigator reports or synthesis rationale.
- Preserved all A/B/C/D routes, D behavior, implementation, remediation, and verification routes, supervision, deadlines, fallback cutoff, output limits, cleanup, results, diagnostics, fingerprints, and Git/hosted authorization. ADR 0007 gained a dated provenance paragraph, ADR 0008's gate description gained the oracle, and the maintenance document's role table, orchestration gates, and catalog checks were extended.
- Added deterministic regressions for the role enum exposure, read-only/exclusive classification, role contract, exact oracle route model/thinking, inherited eligible provider, one random draw with canonical fallback order, exclusion of Cursor/AgentRouter/SeekAI, exact main-model skip detection across providers, pre-spawn skip and backend rejection, manager exclusivity, and the runner oracle chain with fingerprint capture.
- Validation: extension suite (60 tests), strict TypeScript check via a temporary config resolving Pi's installed type declarations, `pi --list-models` extension load, live-catalog verification of the five eligible `gpt-5.6-sol` routes and their high thinking support, `git diff --check`, exact reference scans, and local `tiktoken o200k_base` attribution, all without paid inference.

## 2026-08-21 — Adopt automatic delegation for repository changes

- Replaced the request-gated `delegate_run` trigger with an automatic one: use `delegate_run` automatically for repository changes unless the user explicitly opts out; only a truly trivial edit, such as one typo with no behavior change, may be implemented directly by the parent, and a small task with an accepted plan or an obvious established pattern skips the solution-investigation gate and still runs exactly one implementation delegate.
- Replaced the 12-rule `## Delegated implementation and review` section in `agent/AGENTS.md` with a materially slimmer 7-rule `## Delegated work` section covering the automatic trigger with its trivial-only direct-edit exception, the solution-investigation decision boundary that still delegates small tasks, the concurrent A/B/C/D gates, parent diff and evidence inspection, finding verification and remediation cycling until no blocking findings remain, sole-orchestrator and one-mutator safety, and separate authorization for Git transitions and hosted writes.
- Removed the role D provider/model route map from model-visible `delegate_run` prompt guidelines; route selection remains executable TypeScript in `routes.ts`, which is unchanged, and refined the adjacent guidelines to encode the accepted flow (automatic trigger, trivial-only direct-edit exception, exactly one implementation delegate for small tasks, parent inspects the implementation diff and evidence before the review gate, only verification-confirmed findings reach one focused remediation role, fresh gates repeat until no blocking findings remain).
- Updated the maintenance document's orchestration gates to state the automatic trigger with its trivial-only direct-edit exception and mandatory implementation delegate for small tasks, to require parent diff and evidence inspection before review, and to repeat verification, remediation, and fresh four-reviewer gates until no blocking findings remain.
- Added a focused source-scan regression asserting the automatic trigger, the trivial-only direct-edit exception, the mandatory implementation delegate for small tasks, parent diff and evidence inspection, the review and verification/remediation gates with the verification-confirmed-findings-only remediation condition, separate authorization, and the case-insensitive absence of provider route details in model-visible guidelines.
- Validation: extension suite (46 tests), strict TypeScript check via a temporary config resolving Pi's installed type declarations, `pi --list-models` extension load, documentation/reference scans, `git diff --check`, and local `tiktoken o200k_base` attribution, all without paid inference.

## 2026-08-21 — Replace the delegated C primary with Ox Alpha Free

- Replaced the active C primary for both conditional solution investigation and independent review: `opencode-go/ox-alpha-free:max` replaces `opencode-go/hy3:high` in the executable route map and the focused route regression. The C ordered backup map is unchanged: AgentRouter Opus 5/max, Tabitoken Opus 5 Thinking/max, SeekAI Opus 5/max, then GoRouter Opus 5 Thinking/high.
- Documented that Ox Alpha Free's local `thinkingLevelMap` maps `max` to `max`, so the C primary runs natively at `max` without Pi clamping, replacing the former HY3 no-`max` rationale. Verified the route in Pi's live catalog and the stored level map without paid inference.
- Preserved the A/B/D route maps, D inheritance and single random draw, explicit backend overrides, implementation, remediation, and verification routes, pre-tool-only fallback cutoff, supervision, result, diagnostics, and fingerprint behavior.
- Updated ADR 0007 current policy with a dated provenance paragraph while preserving historical HY3 paragraphs as factual provenance, the maintenance document's role table, thinking rationale, and catalog checks, and the context-cost line for this route-only change with a zero startup-context delta because the executable route map is not model-visible.
- Validation: extension suite (45 tests), strict TypeScript check via a temporary config resolving Pi's installed declarations, `pi --list-models` extension load, live-catalog verification of the new C primary, `git diff --check`, and exact reference scans, all without paid inference.

## 2026-08-21 — Expand delegated gates to four members with role D

- Added `solution-d` and `review-d` to the native `delegate_run` role enum. D carries the same independent read-only solution-investigation and review role contracts as A/B/C. Solution and review gates now launch A, B, C, and D concurrently with the same neutral assignment and require all four completed reports; the parent synthesizes evidence and does not vote.
- D always uses `gpt-5.5` at thinking `medium` under backend=default across exactly five eligible providers: `openai-codex`, `openai-codex-zahlo`, `openai-codex-cgpt1`, `openai-codex-cgpt2`, and `openai-codex-cgpt3`. Cursor is excluded from D by definition.
- The D primary inherits the parent session's currently selected provider read from native extension context (`ctx.model?.provider`), never by inspecting environment variables. When the parent provider is ineligible, one eligible provider is selected at random. The draw happens exactly once per `delegate_run` invocation through an injectable selection point, the remaining four providers follow in stable canonical order, existing catalog preflight still skips unavailable routes, and the ordered attempts return through the existing chain result machinery.
- Explicit backend=zai or backend=claude continues to override default D routing with assigned-role permissions, exactly as for other roles. The A/B/C route maps and all implementation, remediation, and verification routes are unchanged.
- Preserved shared deadlines, pre-tool-only fallback with no post-tool fallback, process-group cleanup, the raw-Markdown result envelope, private failure diagnostics, one-second UI throttling, read-only fingerprint invalidation, and recursive-delegate suppression.
- Updated the model-facing tool role enum description and prompt guidelines, the global orchestration policy in `agent/AGENTS.md`, ADR 0007 current policy with a dated provenance paragraph while preserving historical incident paragraphs, ADR 0008's gate description, the maintenance document's role table, orchestration gates, and catalog checks, and the context-cost attribution with measured local token deltas.
- Added deterministic regressions for inherited eligible provider, ineligible-parent random primary with a single draw, canonical remaining fallback order, Cursor exclusion, explicit backend override for D, D gate recording through the runner chain, and unchanged A/B/C maps.
- Validation: extension suite (45 tests), strict TypeScript check via a temporary config resolving Pi's installed declarations, `pi --list-models` extension load, live-catalog verification of the five eligible `gpt-5.5` routes, `git diff --check`, and documentation scans, all without paid inference.

## 2026-08-21 — Adopt the native delegate_run result and diagnostics contract

- Made `delegate_run` return raw Markdown in model-visible `content[0].text`: a minimal status header plus the delegate's verbatim report for completed runs, with the validated terminal `DELEGATE_RESULT: COMPLETED` marker stripped to avoid duplicate status tokens. Report, status, artifact, and diagnostic paths no longer appear in model-visible content.
- Replaced the old failure body with a compact sanitized failure Markdown carrying state, role, backend, selected or final route, phase, the last sanitized event with its exact UTC receipt time, elapsed time, the ordered attempt chain, and one deterministic per-state summary sentence, so the parent can act without reading any diagnostics.
- Marked unsuccessful `delegate_run` results as Pi tool errors through the native `tool_result` extension lifecycle, preserving the structured Markdown content and renderer details instead of exposing diagnostics to the model.
- Added a small private failure diagnostic JSON under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/logs/delegated-pi-loop/` with 0700 directories and 0600 atomic files, holding only bounded sanitized fields (times, routes, sanitized progress and attempts, bounded stream errors) and excluding prompts, reports, raw output, tool payloads, Git fingerprints, credentials, provider bodies, and every file path.
- Surfaced the diagnostic path only in the TUI renderer for unsuccessful results, with no read prompt, and never in model-visible tool content.
- Removed the duplicate aggregate below-editor widget; live delegate state now renders only in the streaming `delegate_run` tool row, throttled to at most once per second during normal Pi child activity while the 100 ms safety checks remain independent.
- Removed per-attempt artifact paths from chain attempts, ToolResult details, and the failure diagnostic, and stopped writing the chain-level `status.json` and `report.md`; every chain outcome now returns in memory.
- Made execute-level finalization remove the entire temporary supervision artifact directory for every terminal outcome (completed and unsuccessful) after the failure diagnostic is persisted and the tool result is assembled, in a `finally` that also runs when diagnostic persistence fails; a failed diagnostic write still returns sanitized failure content with no diagnostic path, and directory removal stays best-effort.
- Added regressions for exact happy and failure Markdown, sanitization, the `tool_result` error patch, diagnostic permissions, location and content bounds, TUI-only diagnostic path handling, execute-level artifact cleanup for every terminal outcome, absence of chain-level `status.json`, path-free attempts and diagnostics, and diagnostic-write-failure cleanup.
- Validation: extension suite (39 tests), strict TypeScript check via a temporary config resolving Pi's installed declarations, `pi --list-models` extension load, and live-catalog verification of every role route, all without paid inference.

## 2026-08-21 — Replace delegated-loop skill with native TypeScript extension

- Replaced the `delegated-pi-loop` Local Skill and Python supervisors with the native `agent/extensions/delegated-pi-loop/` extension and `delegate_run` custom tool.
- Kept fresh Pi/Claude role processes, the A/B/C route maps, pre-tool-only fallback, shared deadlines, terminal markers, read-only fingerprints, and one-mutator safety.
- Added live sanitized progress rendering and an aggregate TUI widget with each delegate's last accepted event, optional tool name, exact UTC receipt time, relative age, phase, route, attempt, and elapsed time.
- Added parent-session cancellation, process-group cleanup after natural leader exit, child recursion suppression, and a child-side parent watchdog.
- Retired the runtime skill, updated global routing and maintenance docs, and recorded the architecture change in ADR 0008.
- Added TypeScript tests for event privacy, timestamps, lifecycle parsing, route policy, catalog fallback, stalls, malformed trailing JSON, terminal cleanup, and descendant cleanup.

## 2026-08-21 — Replace active A Luna routes with OpenCode Go Muse

- Replaced the active A primary for both conditional solution investigation and independent review: `opencode-go/muse-spark-1.2-contributor:xhigh` replaces `openai-codex-cgpt3/gpt-5.6-luna:max` in the role table, route paragraphs, and both A spawn commands with updated provider, model, thinking, and labels.
- Removed the active A SeekAI GPT-5.6 Luna/high backup as part of replacing Luna. A now backs up through `agentrouter/gpt-5.6-sol:max`, `tabitoken/claude-opus-5-thinking:max`, `seekai/claude-opus-5:max`, then `gorouter/claude-opus-5-thinking:high`. B and C maps are unchanged.
- Documented that Muse Spark 1.2 Contributor maps `max` to null in its local `thinkingLevelMap`, so `xhigh` is its highest supported thinking level. Verified the route in Pi's live catalog and the stored level map without paid inference.
- Removed CGPT3 from the skill trigger description because it no longer backs any delegated role; OpenCode Go already covers the new A primary.
- Updated ADR 0007 current policy with a dated provenance paragraph, the update-process fallback-provider authority and invariants 11 and 16, evaluation guidance, and the context-cost attribution. Preserved the concurrent three-member gates, all-three completion semantics, backup-only AgentRouter, Tabitoken, SeekAI, and GoRouter policy, pre-tool-only fallback and supervisor safety rules, GLM 5.3/max implementation and remediation default, Sol/high finding verification, the retired small-task chain, and explicit Claude and Z.AI role behavior. Runtime scripts stayed unchanged.
- Preserved historical ADR incident paragraphs, historical changelog entries, and historical context-cost attributions as factual provenance.
- Validation: Muse live-catalog and thinking-level-map verification, exact A/B/C command-block comparison against the accepted maps, `bash -n` on every documented spawn block, target-skill and all-Local-Skills validation, supervisor regressions with bytecode disabled, Python compilation outside the tree, Ruff lint and format checks, `git diff --check`, link, placeholder, secret, and artifact checks, `o200k_base` attribution against the committed baseline, and dirty-file fingerprint checks, all without paid provider calls.

## 2026-08-20 — Expand delegated primary gates to three members

- Expanded conditional solution investigation and post-implementation independent review from two members to three: A, B, and C, launched concurrently as three separate direct bash calls in one parallel tool batch with the same neutral prompt and separate artifacts. Every gate now requires all three reports; one or two surviving reports remain useful evidence but cannot complete the gate.
- Set identical primary assignments for investigation and review: A on `openai-codex-cgpt3/gpt-5.6-luna:max`, B on `opencode-go/deepseek-v4-flash:max`, and C on `opencode-go/hy3:high`. Documented that HY3 does not support `max` and Pi would clamp `max` to `high`; the user selected HY3 at `high`. Documented that SeekAI GPT-5.6 Luna maps no `max` thinking level, so its A backup runs at `high` because Pi would clamp an unmapped `max` to `high`.
- Gave each member one ordered backup map expressed through repeated `--fallback-route` options. A backs up through `seekai/gpt-5-6-luna:high`, `agentrouter/gpt-5.6-sol:max`, `tabitoken/claude-opus-5-thinking:max`, then `gorouter/claude-opus-5-thinking:high`; B through `seekai/deepseek-v4-flash:max`, `agentrouter/claude-opus-5:max`, `tabitoken/claude-opus-5-thinking:max`, then `gorouter/claude-opus-5-thinking:high`; C through `agentrouter/claude-opus-5:max`, `tabitoken/claude-opus-5-thinking:max`, `seekai/claude-opus-5:max`, then `gorouter/claude-opus-5-thinking:high`.
- Made AgentRouter, Tabitoken, SeekAI, and GoRouter backup-only backends that never start as primaries in the default policy, preserving catalog preflight, fresh attempts, the one-shared-deadline, no-cycle, no-post-tool-fallback, terminal-result, privacy, and process-cleanup rules.
- Changed default finding verification from `openai-codex/gpt-5.6-sol:medium` to `openai-codex/gpt-5.6-sol:high` across labels, prose, commands, ADR, maintenance, and evaluation guidance.
- Kept `zai/glm-5.3:max` as the default for all implementation and focused remediation and retired the Tabitoken-first small-task implementation/remediation route, removing its role-table row, eligibility narrative, command block, maintenance invariants, evaluation cases, and current-policy references. Explicit user or project backend selection remains allowed with role-based permissions.
- Added CGPT3 and OpenCode Go to the skill trigger description because they are now primary delegated backends. Runtime scripts stayed unchanged; every new primary and backup route was verified in Pi's live catalog without paid provider calls.
- Preserved historical SeekAI and Tabitoken incident narratives, historical changelog entries, and prior context-cost attributions as factual provenance.
- Validation: target-skill validation, delegated-loop supervisor regressions with bytecode disabled, Ruff lint and format checks, Python compilation, all-Local-Skills validation, `bash -n` on every documented spawn block, `git diff --check`, dirty-file fingerprint checks, and active-policy route scans passed without paid provider calls.

## 2026-08-20 — Replace active SeekAI delegate routes with Tabitoken

- Changed solution investigator A from SeekAI Claude Opus 5/high to Tabitoken Claude Opus 5 Thinking/high.
- Changed independent reviewer A from SeekAI Claude Fable 5/high to Tabitoken Claude Opus 4.8 Thinking/high because Tabitoken has no configured Fable-equivalent model and Opus 4.8 Thinking avoids duplicating Investigator A's Opus 5 model.
- Changed the small-task chain primary from SeekAI Claude Opus 4.8/xhigh to Tabitoken Claude Opus 4.8 Thinking/high because Tabitoken maps no `xhigh` thinking level for that model and the primary deliberately stays below the mapped `max` level to preserve the lower-cost purpose of this narrowly classified route; the AgentRouter Opus 4.8/xhigh and Luna/xhigh fallbacks keep `xhigh`.
- Removed the SeekAI DeepSeek V4 Flash/xhigh fallback because Tabitoken has no configured DeepSeek equivalent; no substitute fallback was invented.
- Updated the skill trigger description, supervised command examples including provider, model, thinking, and labels, fallback-provider authority, ADR 0007 policy, update-process invariants, and context-cost attribution. Runtime scripts stayed provider-neutral and unchanged.
- Preserved historical SeekAI incident narratives, historical changelog entries, and prior context-cost attributions as factual provenance.
- Deferred live Tabitoken catalog validation because the parent Pi process has `TABITOKEN_API_KEY` unset; Pi must restart from a refreshed shell containing that variable before `pi --list-models tabitoken/...` availability checks or paid route smokes.
- Validation: target-skill validation, delegated-loop supervisor regressions with bytecode disabled, Ruff lint and format checks, all-Local-Skills validation, `git diff --check`, dirty-file fingerprint checks, and active-policy route scans passed without paid provider calls.

## 2026-08-19 — Recognize SeekAI scanner-error stream failures

- Classified the provider signatures `scanner_error` and `unexpected EOF` as provider unavailability in the existing availability pattern, matched case-insensitively with the existing underscore/space/hyphen tolerance for `scanner_error`.
- Applied the signatures only to typed Pi error fields the supervisor already scans, plus the existing one-line `[error]` envelope, after a SeekAI Fable 5 attempt ended as `invalid_result` with `route_unavailable_seen` false while the dashboard reported `scanner_error`/`unexpected EOF` failures.
- Let documented chains use their existing pre-tool fallback for the signal. Preserved the absolute post-tool cutoff: the observed five-tool attempt stays a terminal `invalid_result` failure, and arbitrary missing-marker reports remain non-replaceable.
- Persisted no new provider text, request IDs, raw events, or status fields; only the existing `route_unavailable_seen` boolean can change.
- Added regressions for pre-tool typed scanner-error fallback with private failed-route text, the post-tool cutoff, and the retry-path incident shape (typed error, retry cycle, unmarked substantial report).

## 2026-08-19 — Restrict the provider error envelope to one line

- Tightened machine error-envelope recognition: after outer whitespace is stripped, the report must be one nonempty logical line with no `\n` or `\r`, start with the exact `[error]` prefix, and match the availability pattern on that line only.
- Kept the observed one-line `[error] Service temporarily unavailable` envelope positively recognized. A multi-section missing-marker report that starts with `[error]` and mentions a status code later now stays a terminal `invalid_result` failure with `route_unavailable_seen` false.
- Added supervisor regressions for that multi-section non-match and for a report that starts with `[error]` yet ends with one valid `DELEGATE_RESULT: COMPLETED` marker; structured outcomes keep precedence over the availability signal, preserved by both the outcome guard and the single-line shape.
- Restored doubled-brace escaping for the three membership collections in the fake-Pi fixture template without changing fixture behavior.

## 2026-08-19 — Recognize provider error envelopes returned as report text

- Fixed the supervisor storing a provider-rendered `[error] Service temporarily unavailable` notice as the final assistant report, recording `invalid_result`, and leaving `route_unavailable_seen` false.
- Recognized exactly that whole-message machine envelope as provider unavailability when no structured delegate outcome exists and its body matches the existing availability pattern.
- Let documented chains apply their existing pre-tool fallback for that signal; a guarded single route now ends as `routes_unavailable`. Preserved the post-tool and terminal-outcome cutoffs, the routing defaults, and the no-fallback Reviewer A policy.
- Kept arbitrary missing-marker reports and prose that merely mentions unavailability as terminal failures, and persisted no new error detail beyond the existing boolean.
- Added six regressions covering the observed representation, chain fallback with private failed-route text, guarded single-route exhaustion, the post-tool cutoff, prose and completed-report non-matches.

## 2026-08-19 — Recognize provider-side client cancellation

- Classified `client_gone` and `context canceled` as provider-unavailability signals.
- Allowed guarded fallback for those signals only before any tool execution.
- Preserved the no-fallback safety boundary after tool execution and replaced the failed read-only reviewer explicitly.

## 2026-08-17 — Accept completed delegates that linger after settlement

- Fixed the supervisor misclassifying valid completed OpenAI Codex and AgentRouter delegates as stalled when Pi remained alive after final `agent_settled`.
- Made a valid `COMPLETED` report plus final settled lifecycle terminate the lingering process group and return success immediately.
- Added `completion_cleanup_performed` status metadata and regressions for prompt cleanup plus malformed trailing JSON.

## 2026-08-16 — Replace default GoRouter roles with SeekAI

- Changed solution investigator A to SeekAI Claude Opus 5/high.
- Changed the small-task primary route to SeekAI Claude Opus 4.8/xhigh while preserving the AgentRouter Opus 4.8, SeekAI DeepSeek V4 Flash, and Luna fallbacks.
- Changed independent reviewer A to SeekAI Claude Fable 5/high.
- Removed GoRouter from default role assignments because its observed latency was too high; explicit user-selected routes remain possible through the generic supervisor.

## 2026-08-16 — Add independent solution investigation

- Added two concurrent read-only solution investigators for problems without an accepted solution contract: GoRouter Opus 5 Thinking/high and AgentRouter Opus 5/high with AgentRouter GPT-5.6 Sol/high fallback.
- Required both investigators to report root cause, exact source evidence, candidate solutions, alternatives, tradeoffs, validation, and uncertainties without editing the tree.
- Made the parent orchestrator verify material citations and architecture claims before finalizing one solution contract for implementation.
- Preserved post-implementation independence by requiring completely fresh reviewers with no investigator reports, discarded alternatives, or synthesis rationale.

## 2026-08-16 — Document delegated provider credential inheritance

- Clarified that catalog preflight and delegate children inherit provider credentials from the parent Pi process.
- Added restart guidance for credential variables configured after Pi starts, without sourcing shell startup files inside delegates or printing secret values.
- Recorded successful bounded smokes for AgentRouter, SeekAI, and GoRouter after the parent environment refreshed, including a GoRouter `read` tool round trip.

## 2026-08-16 — Align Z.AI delegated role availability

- Clarified that Z.AI GLM 5.3/max can serve any assigned delegated role while remaining the implementation/remediation default.
- Kept review and verification read-only and explicitly selected. The assigned role, not the backend, controls mutation permissions.
- Preserved the two-reviewer gate when Z.AI or Claude Code replaces an assigned reviewer slot.

## 2026-08-16 — Add bounded delegate provider fallback

- Added live-catalog-aware Pi route guards and chains for classified small-task implementation and independent review.
- Small-task routing now tries GoRouter Opus 4.8 Thinking, AgentRouter Opus 4.8, SeekAI DeepSeek V4 Flash, then OpenAI Codex Luna at xhigh.
- Independent review now launches GoRouter Opus 5 Thinking/high and AgentRouter Opus 5/high concurrently. Only the AgentRouter reviewer falls back, to AgentRouter GPT-5.6 Sol/high. OpenAI Codex Sol/medium remains the finding-verification default.
- Automatic failover uses a fresh process and advances only after catalog absence, recognized provider unavailability, or an event-idle stall before any tool starts. Every chain shares one 45-minute deadline and each route receives one attempt.
- Added chain status metadata and regressions for guarded single routes, catalog skips, runtime provider errors, event-idle fallback, route exhaustion, and the tool-start cutoff without exposing failed-route payloads.

## 2026-08-16 — Detect stalled and blocked delegates

- Added private Pi JSON event monitoring for provider-exposed thinking, text, tool, message, turn, and agent activity without forwarding raw events into orchestrator context.
- Added a 5-minute event-idle warning, 10-minute `stalled` termination, and retained the 45-minute absolute deadline for active loops.
- Added final-report extraction plus machine-readable `COMPLETED`, `BLOCKED`, and `FAILED` outcomes. Missing markers and malformed streams now fail explicitly.
- Added bounded-attempt prompt rules so a delegate reports `BLOCKED` instead of repeating work after a required proof exhausts its budget.
- Raw Pi events exist only during supervision and are deleted after final extraction. Status artifacts retain only bounded activity metadata.
- Validation covered context isolation, active thinking, silent stalls, active wall timeouts, blocked early exit, result enforcement, process cleanup, command contracts, and all Local Skills without paid inference.

## 2026-08-16 — Default implementation to GLM 5.3

- Made Z.AI GLM 5.3/max the default model for delegated implementation and focused remediation.
- Restricted Luna/xhigh to tasks the orchestrator positively classifies as narrow, pattern-based, low-risk, free of material ambiguity or cross-cutting concerns, and likely to finish in a few turns. Uncertainty routes to GLM 5.3/max.
- Retained Sol/high independent review, Sol/medium finding verification, explicit Z.AI read-only selection, and explicit Claude Opus 5/medium selection.
- Added recorded small-task classification and selected-route reporting so future delegate outcomes remain observable.
- Validation used no-inference model selection, command contracts, all-skill checks, documentation checks, and supervisor regressions.

## 2026-08-16 — Adopt role-specific delegate effort

- Changed default implementation and focused remediation from Luna/max to Luna/xhigh.
- Changed narrow finding verification from Sol/high to Sol/medium while retaining Sol/high for final independent review.
- Kept explicitly selected Z.AI GLM 5.3/max and Claude Opus 5/medium alternatives unchanged.
- Treated the external pricing/performance analysis as directional evidence only. This policy is an operational trial that requires local outcome observation.
- Validation used model-selection, command-contract, skill, documentation, and whitespace checks without paid inference.

## 2026-08-15 — Bound delegated process lifetime

- Confirmed repeated unbounded delegate failures, including one silent call that lasted about 85 minutes before SIGTERM and produced no report.
- Added a delegated process supervisor with a 45-minute default deadline, 60-second heartbeats, a 50 MiB output limit, SIGTERM/SIGKILL process-group cleanup, parent-death cleanup, private temporary report/stderr/status artifacts, and explicit empty-report failure.
- Routed all Pi, Z.AI GLM, and Claude Code role commands through the supervisor while preserving direct bash, fresh sessions, environment scrubbing, role isolation, and authorization gates.
- Validation: six supervisor lifecycle regressions, Ruff lint/format checks, target and all-local skill validation, YAML/contract checks, whitespace checks, and artifact scans passed without paid inference.

## 2026-08-15 — Add Z.AI GLM 5.3 delegate alternative

- Added explicitly selected `zai/glm-5.3` at `max` thinking as an implementation, remediation, review, or finding-verification alternative in `delegated-pi-loop`.
- Preserved Luna/max and Sol/high as the default role models, Claude Opus 5/medium as the explicit Claude alternative, and all existing fresh-session, role-isolation, environment-scrubbing, single-mutator, and authorization rules.
- Added exact GLM implementation and read-only role commands. Updated global routing, skill metadata, ADR 0007, maintenance guidance, inventory rationale, and context-cost attribution.
- Validation: the installed Pi catalog resolves Z.AI GLM 5.3, a no-inference RPC selection accepted `max`, target and all 34 Local Skills validated, YAML and contract checks passed, and no runtime artifacts were added.

## 2026-08-09 — Synchronize Local Skills and owned CLIs

- Updated user-level CLIs to GitHub CLI 2.97.0, Crit 0.18.4, Linear CLI 2.4.0, Notion `ntn` 0.21.9, NotebookLM/Gemini Notebook CLI 0.9.6, Ruff 0.16.2, ty 0.0.69, and Claude Code 2.1.226. Firebase CLI 15.26.0, uv 0.12.3, and PostHog CLI 2026.7.1 were already current.
- Installed the official Crit review binary in the user path, which now takes precedence over the unrelated system CRIU Image Tool named `crit`.
- Regenerated changed GitHub CLI help references from 2.97.0 and Linear command references from 2.4.0 while preserving compact runtime routers and hosted-service mutation gates.
- Updated the NotebookLM skill and references to the published Gemini Notebook 0.9.6 contract, including durable auth, Studio confirmation, chats, local source upload, and research-destination guidance.
- Ported relevant Firebase AI Logic/App Check and routing changes, Directus 12/MCP/security guidance, Crit session/comment behavior, and architecture hot-spot/CodeGraph routing.
- Reviewed every active skill source. OpenAI, Anthropic skill-creator runtime, Agent Toolkit, Astral skill source, Notion sources, PlanetScale skill paths, and PostHog skill paths had no runtime drift; the removed upstream Intent Layer path remains a retained local snapshot.
- Updated skill provenance, CLI version notes, and context-cost attribution. No skill classification or installed inventory changed, and no retired skill was restored.
- Validation: all 34 Local Skills, 13 skill-creator regressions, 29 changed GitHub help pages, GitHub URL normalization, Linear/NotebookLM/Crit CLI contracts, Markdown links, whitespace checks, and a no-inference Pi RPC loader smoke passed.

## 2026-08-09 — Upgrade Pi 0.82.1 to 0.84.1

Details: [`docs/changelogs/pi-0.82.1-to-0.84.1-upgrade.md`](./changelogs/pi-0.82.1-to-0.84.1-upgrade.md)

- Prepared the Pi 0.84.1 core upgrade in an isolated worktree, then applied it to the active installation after approval. Audited the 0.83 TypeBox break plus 0.84 RPC, provider, auth, model-refresh, session, Agent Harness, and environment contracts.
- Selected `pi-blackhole@0.4.5`, ported percentage compaction, added nullable provider-header preservation, and retired the upstreamed public provider-discovery patch.
- Kept `pi-browser-harness@0.10.2` because 0.11.0 still has the production daemon launcher defect and removes deep-research resources; an unpublished upstream fix passed a production-layout test.
- Made pi-btw runtime-key sync cancellation-aware and scrubbed inherited parent session/model markers before delegated Pi or Claude processes.
- Preserved the active dark theme and OpenAI Codex reflector override, then corrected stale README model, package, extension, and patch inventory text. Live validation returned 59 commands, 102 models, and no extension errors; local suites passed. Browser Harness retains eight npm audit findings in its transitive tree because npm proposes an incompatible package downgrade. No paid inference was intentional; the upgrade note records one possible Browser command fallthrough.

## 2026-08-03 — Add delegated Pi implementation/review loop

- Added the compact `delegated-pi-loop` Local Skill for fresh Luna/max implementation or remediation delegates, fresh Sol/high review or verification delegates, and explicitly selected Claude Code Opus 5/medium alternatives for either role.
- Added global orchestration rules for direct non-Context-Mode Pi/Claude spawning without a timeout, no recursive delegation, one shared-tree mutator, neutral independent review, pre/post read-only tree checks, and separate Git/hosted-service authorization.
- Documented ADR 0007, exact generic Pi and Claude Code spawn commands, role prompt contracts, finding classification/remediation flow, maintenance invariants, installed-skill classification, and incremental context cost.
- Validation: target and all-local-skill structural validation, YAML parsing, changed-link checks, placeholder/path/secret scans, runtime-artifact checks, Claude Code 2.1.220 flag inspection, and official Opus 5 alias/model verification passed without paid inference.

## 2026-07-29 — Pi 0.80.10 to 0.82.1 upgrade

Details: [`docs/changelogs/pi-0.80.10-to-0.82.1-upgrade.md`](./changelogs/pi-0.80.10-to-0.82.1-upgrade.md)

- Upgraded the Bun-global Pi core family to 0.82.1 and audited the 0.81 agent-core/session-storage and 0.82 AgentHarness tool-context breaks; no local shim was needed.
- Upgraded Blackhole 0.3.9 → 0.4.2, browser-harness 0.8.3 → 0.10.2, Claude Bridge 0.6.2 → 0.6.3, and CodeGraph SDK/CLI 1.4.1 → 1.5.0 with exact pins.
- Retained and ported Blackhole's percentage/provider-stream patches, retained pi-btw's ModelRuntime/runtime-auth patch, and explicitly disabled unsafe mid-run compaction.
- Expanded the custom footer's lifetime totals to include usage-bearing tool results, compactions, and branch summaries; changed DeepSeek worker fallbacks from unsupported `xhigh` to `max`.
- Evaluated constrained sampling and custom `PI_*` propagation but deferred unsafe schema rewrites and process-global environment emulation.
- Validation included isolated and live RPC/SDK startup, all configured models, 59 registered tools, package/local extension suites, patch idempotence, wrapper checks, and CodeGraph index compatibility without a full reindex. No paid inference was used.

## 2026-07-19 — Pi 0.80.6 to 0.80.10 upgrade

Details: [`docs/changelogs/pi-0.80.6-to-0.80.10-upgrade.md`](./changelogs/pi-0.80.6-to-0.80.10-upgrade.md)

- Reworked native CodeGraph freshness around per-root SDK watchers, initial and 10-second query reconciliation, pending-file watcher draining, a four-root watcher LRU, and nested-repository/worktree isolation; `getChangedFiles()` is no longer the general sync gate, remaining status diagnostics plus a removal-only macOS/Windows coalesced-directory fallback.
- Follow-up review hardening: copy only transient runtime API-key overrides into pi-btw child runtimes, add stock/previous-patch/offline integration regression tests, and make `agent/pi-btw/` denylist-by-default.
- Added `docs/TODO.md` to recheck maintainer releases on or after 2026-08-19 before deciding whether to submit the proven local `pi-btw` and `pi-blackhole` fixes upstream.

- Revised the requested 0.80.9 target to 0.80.10 with approval because 0.80.10 fixes Kimi deferred-tool regressions and the 0.80.9 xAI catalog-removal defect.
- Upgraded the Bun-global Pi core package family to 0.80.10 and migrated active child SDK construction from removed `modelRegistry` options to `ModelRuntime` through a documented `pi-btw@0.4.1` local patch.
- Ported Blackhole's custom-provider stream scan from removed private registry state to public ModelRegistry facade methods; retained percentage compaction and retired the now-duplicate environment-auth shim.
- Upgraded CodeGraph CLI and native extension dependency from 1.4.0 to 1.4.1 without a full reindex; kept context-mode at current 1.0.169.
- Measured Pi 0.80.10's 57 registered/54 active tools. Kept the eager tool set because browser-harness dominates context cost and current deferred candidates carry active-only prompt guidance that would undermine cache stability.
- Validation included complete isolated Scenario B loading, package/local extension suites, strict type checks, disposable CodeGraph migration/full Explore, command-backed and ambient auth, wrapper checks, Blackhole threshold/bridge tests, and offline custom-provider BTW conversation/summarizer tests. No paid inference was used.

## 2026-07-10 — Upgrade native CodeGraph integration to 1.4.0

- Refreshed upstream Git tags, npm metadata, and the GitHub release before selecting CodeGraph 1.4.0; confirmed the WSL CLI was already current.
- Upgraded the native extension dependency and Linux x64 platform bundle from 1.3.1 to 1.4.0 with an exact package pin and refreshed lockfile.
- Added full-index completeness and pending-reference status reporting, query-time healing for unresolved references left by interrupted indexing, and incomplete-index warnings.
- Reworked `/codegraph-upgrade` into an execution prompt that always fetches authoritative upstream metadata, reconciles npm/tag/GitHub/CLI versions, performs compatible upgrades, and validates in WSL.
- Replaced the extension README's stale concrete upgrade version with a `<version>` placeholder and refreshed prompt-template inventory/token attribution.
- Validation: npm clean install and dependency checks passed; required public SDK exports are present; the 401-module Bun build passed; Node 24 opened the existing index and reported completeness; Pi RPC startup passed without inference; CLI update check reports 1.4.0 current.

## 2026-07-10 — Extend Fastlane to official GPT-5.6 Fast models

- Replaced the stale GPT-5.4/GPT-5.5-only Fastlane allowlist with the official Codex model catalog's complete `priority`/Fast tier set: `gpt-5.4`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-5.6-terra`.
- Kept `gpt-5.4-mini` and every model without an advertised Fast tier ineligible.
- Documented the catalog semantics (`Fast`, 1.5x speed, increased usage) and exact source blob.
- Validation: Fastlane tests cover all five eligible models and the unsupported-model guard; footer integration and Pi RPC startup passed without a paid inference request.

## 2026-07-10 — Pi 0.80.3 to 0.80.6 recovery upgrade

Details: [`docs/changelogs/pi-0.80.3-to-0.80.6-recovery-upgrade.md`](./changelogs/pi-0.80.3-to-0.80.6-recovery-upgrade.md)

- Reconstructed the failed 0.80.4 transition and confirmed that 0.80.4 existed only as a Git tag: all four `@earendil-works` 0.80.4 npm packages return `E404`. Version 0.80.5 was the publishable recovery build and contains no functional runtime change beyond the 0.80.4 code.
- Upgraded the Bun-global Pi core package family from installed 0.80.5 to 0.80.6 and verified `pi-coding-agent`, `pi-agent-core`, `pi-ai`, and `pi-tui` all report 0.80.6.
- Synchronized tracked settings with the live baseline: `pi-browser-harness` 0.8.3, `pi-claude-bridge` 0.6.2, `gpt-5.6-sol`, `high` thinking, and changelog state 0.80.6.
- Migrated the footer timer from low-level `agent_end` to session-level `agent_settled`; added distinct `max` thinking glyph/color support in the footer and both themes.
- Updated CodeGraph 1.2.0 → 1.3.1 and context-mode 1.0.163 → 1.0.169 with lockfiles; made context-mode prefer Pi's active `ctx.cwd` over process `PWD`.
- Hardened the theme wrapper so package/config and non-interactive commands bypass settings writes.
- Reapplied and verified both local pi-blackhole patches after package refresh, including recreation of `src/om/compaction-budget.ts`.
- Validation: footer/fastlane/web-search suites passed; context-mode 210 tests, typecheck, and fuzz passed; CodeGraph build passed; all local and configured package extensions loaded under Pi 0.80.6 RPC mode; both themes loaded; post-patch pi-blackhole RPC smoke passed.

## 2026-07-09 — Add Directus browser-operation skill

- Added `agent/skills/directus-browser`, a custom local skill for operating Directus Studio through `pi-browser-harness` when Directus MCP is unavailable.
- Documented Directus Studio routing, browser-first workflows, read-only same-origin API probes, script/API mutation gates, and Directus schema/access-control safety rules.
- Added split Directus reference files with official source inventory, authenticated schema API mutation workflow, the Directus browser skill maintenance doc, installed-skill inventory entry, and refreshed skill-catalog context-cost attribution.
- Validation: Directus skill validator passed; all local skill validators passed.

## 2026-07-08 — Align native `codegraph_node` symbol/file behavior

- Updated the native Pi CodeGraph extension so `codegraph_node` treats `symbol` + `file` as symbol mode filtered by file, matching CodeGraph MCP semantics instead of reading the whole file and ignoring `symbol`.
- Kept `file`-only calls as file-read mode and hardened invalid/blank argument handling to fail before graph readiness/sync work where practical.
- Improved strict no-match diagnostics for wrong `symbol` + `file` calls by listing matching symbols outside the requested file without returning unrelated symbol bodies as successful results.
- Validation: Bun extension build passed, cached diff whitespace check passed, Pi was reloaded, and independent smoke tests passed for file-only, symbol-only, symbol+correct-file, symbol+wrong-file, whitespace-file, empty-args, and blank-symbol cases.

## 2026-07-04 — Add structured review prompt

- Added `agent/prompts/codex-review.md`, a slash-command prompt template for code-review output using structured Markdown findings and correctness verdicts.
- Updated the prompt-template inventory in `README.md` and prompt-template token attribution in `docs/config-context-cost.md`.
- Validation: loaded prompt templates through Pi's prompt-template loader and counted prompt-template tokens with local `tiktoken` `o200k_base`.

## 2026-07-02 — Pi 0.80.2 to 0.80.3

Details: [`docs/changelogs/pi-0.80.2-to-0.80.3-upgrade.md`](./changelogs/pi-0.80.2-to-0.80.3-upgrade.md)

- Upgraded local Pi from `0.80.2` to `0.80.3`.
- Updated configured package `pi-claude-bridge` from `0.5.0` to `0.6.1`.
- Added tracked `agent/claude-bridge.json` with `askClaude.enabled: false`, keeping Claude Bridge provider models available while disabling the delegate tool.
- Kept `@schultzp2020/pi-cursor`, `pi-blackhole`, `pi-btw`, and `pi-browser-harness` pins unchanged because no newer safe npm version was found.
- Verified Pi `0.80.3`'s `session_info_changed` event is additive for this config; no local extension currently consumes or depends on session-name metadata.
- Kept `pi-web-access` removed from configured packages; the local `agent/extensions/web-search` remains the active web-search implementation.
- Verified local `pi-blackhole` patches remained present after package installation.
- Validation: `web-search` Bun tests passed, `context-mode` typecheck/tests passed, local extension import smoke passed, and Pi's loader listed the updated `claude-bridge` model catalog offline.

## 2026-07-01 — Document config context cost

- Added `docs/config-context-cost.md` with a provider-calibrated and local `tiktoken` `o200k_base` breakdown of startup/first-request context cost across Pi system prompt sections, `AGENTS.md`, skill catalog entries, active tool schemas, prompt templates, extension commands, and on-demand full skill loads.
- Corrected the methodology to include `session_start` dynamic tool registration and `before_agent_start` prompt injection; this captures `pi-browser-harness` browser tools that a pre-`session_start` SDK snapshot misses.
- Added reproducible provider-calibration commands so the `hi` usage baseline can be regenerated on another machine without relying on a machine-local session file.
- Added a README pointer to the context-cost snapshot and update triggers.
- Validation: compared local runtime attribution against real `openai-codex/gpt-5.5` `hi` calibration runs and provider-reported usage stored in the session JSONL.

## 2026-07-01 — Retire Context7 CLI skill

- Removed `agent/skills/context7-cli` from active Local Skills.
- Reclassified `context7-cli` as retired in the skill inventory and converted its maintenance doc to reinstall notes.
- Updated the skill maintenance README and ADR 0001 to record the retirement decision.
- Validation: local skill validators passed for all remaining `agent/skills/*/SKILL.md`.

## 2026-06-30 — CodeGraph extension 1.1.6 upgrade

- Upgraded `agent/extensions/codegraph` to `@colbymchenry/codegraph@1.1.6` with an exact package pin.
- Updated GraphManager to reopen cached graph handles when the on-disk database is replaced.
- Aligned confirmed full reindex handling with CodeGraph 1.1.x by recreating the database before indexing.
- Improved `codegraph_status` diagnostics for explicit missing `projectPath` values and symlinked file paths.
- Validation: SDK export smoke test, strict TypeScript check, and Bun import smoke test passed for the extension.

## 2026-06-30 — Web search grounded output simplification

- Updated `agent/extensions/web-search` so successful `web_search` results enter context as final Markdown with inline citation markers and a trailing `### Sources:` section.
- Sunset `fetch_grounding`; registered web-search extension tools are now `web_search` and `fetch_contents`.
- Added a focused Gemini+Exa Markdown renderer that joins multipart Gemini responses, inserts citations from grounding support offsets, normalizes bullets/source-title spacing, and keeps `### Sources:` present even when no sources are returned.
- Added local Gemini+Exa response fixtures under the extension test tree, replacing deleted absolute-path benchmark fixtures.
- Added citation edge-case coverage for duplicate same-position supports and `endIndex: 0` insertion.
- Validation: `bun test` passed for the extension with 18 tests.

## 2026-06-28 — Native Gemini+Exa web search cutover

- Added local `agent/extensions/web-search` Pi extension.
- Registered public tools: `web_search`, `fetch_grounding`, and `fetch_contents`.
- `web_search` now uses native Gemini + Exa grounding first, with internal direct Exa fallbacks for web/code searches.
- Added disk-backed raw response and content caches under `~/.pi/web_search_cache` with TTL, atomic writes, secret redaction, and cache-size safeguards.
- Removed `npm:pi-web-access@0.13.0` from configured packages; existing installed files remain on disk and can be re-enabled later if needed.
- Validation: `bun test` passed for the extension and import smoke confirmed `web_search,fetch_grounding,fetch_contents`.
- Added compact/expanded TUI renderers for the web search tools.
- Increased tool-call summary truncation to 480 characters for web-search, CodeGraph, and context-mode renderers.

## 2026-06-25 — Pi 0.79.9 to 0.80.2

Details: [`docs/changelogs/pi-0.79.9-to-0.80.2-upgrade.md`](./changelogs/pi-0.79.9-to-0.80.2-upgrade.md)

- Upgraded local Pi from `0.79.9` to `0.80.2`.
- Updated configured packages:
  - `pi-blackhole` to `0.3.9`
  - `pi-web-access` to `0.13.0`
- Kept other configured packages unchanged because they were already current.
- Changed `web-search.json` to prefer Exa, use env-provided API keys, and disable extension-side summary generation with `workflow: "none"`.
- Removed stale unconfigured npm cache package `@diegopetrucci/pi-openai-fast@0.1.4`.
- No required local extension, model, theme, prompt-template, or skill migration was identified.

Important caveats:

- `pi update --all` was intentionally avoided for this transition because it updates extensions before the Pi CLI.
- `pi-web-access@0.13.0` has a single default `provider` config field; exact ordered fallback such as `Exa -> Gemini only` is not configurable.
- `code_search` was removed by `pi-web-access`; use `web_search`, `fetch_content`, or the `librarian` skill instead.
