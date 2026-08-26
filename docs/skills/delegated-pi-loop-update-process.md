# Delegated Pi extension update process

Purpose: maintain the native TypeScript `delegate_run` extension that runs in the parent Pi process and supervises fresh ephemeral Pi RPC children. The extension owns role routing, strict RPC JSONL, one same-session report recovery, provider-failure classification, bounded subprocess lifecycle, private event parsing, targeted cancellation, result validation, diagnostics, cleanup, and every model-visible delegation instruction through one canonical module. A second read-only tool, `delegate_model_catalog`, searches the validated routing models catalog before an explicitly requested one-run routing substitution.

## Classification and authority

- Extension classification: **keep it**. Process supervision, fallback cutoffs, report recovery, shared-tree safety, and delegated child resource isolation are executable behavior.
- Source of truth: this Pi config, ADR 0007 through ADR 0011, and installed Pi RPC/extension documentation.
- Route authority: `agent/extensions/delegated-pi-loop/routing.json`, strictly validated by `routing.ts` at load time and checked against Pi's live model catalog.
- Child resource authority: `agent/extensions/delegated-pi-loop/resources.json`, strictly validated by `resources.ts` at parent-extension startup and rechecked at argument construction before every spawn.
- Direct Claude Code authority: none. The extension has no direct Claude CLI backend and must not inspect, invoke, install, uninstall, or modify the user's Claude CLI.
- Claude-named models served through ordinary Pi providers remain supported. Their provider/model route order is independent from the removed direct CLI integration.

## Owned surfaces

| Path | Responsibility |
|---|---|
| `agent/extensions/delegated-pi-loop/instructions.ts` | Canonical model-visible delegation instructions and builders: parent tool metadata and parameter descriptions, the parent workflow guidelines, the child role-family contracts, the base child assignment prompt with terminal-result contract and generic recursion prohibition, the fixed restart note, and the report-recovery prompt. |
| `agent/extensions/delegated-pi-loop/index.ts` | Tool registration from one validated routing snapshot and the canonical instruction module, commands, child recursion suppression, and execute finalization. |
| `agent/extensions/delegated-pi-loop/docsync.ts` | Documentation synchronization: renders the marked model-visible sections of `docs/delegated-pi-loop-agent-instructions.md` from the canonical exports and the routing snapshot, extracts them for checking, and rewrites them in place. |
| `agent/extensions/delegated-pi-loop/render-instructions-doc.ts` | CLI entry (`npm run render:instructions-doc`) that regenerates the marked reference-document sections. No external dependencies. |
| `agent/extensions/delegated-pi-loop/catalog.ts` | Read-only delegate model catalog search over the validated routing models catalog: query, provider, thinking, and limit filters with bounded deterministic output. |
| `agent/extensions/delegated-pi-loop/protocol.ts` | Strict LF-framed RPC JSONL, prompt correlation, UI cancellation, and bounded provider-failure categories. |
| `agent/extensions/delegated-pi-loop/monitor.ts` | Two-round Pi lifecycle validation, report extraction, activity, and structured provider-failure evidence. |
| `agent/extensions/delegated-pi-loop/supervisor.ts` | Persistent RPC child, limits, cancellation, process groups, cleanup, progress, and private artifacts. |
| `agent/extensions/delegated-pi-loop/runner.ts` | Catalog preflight, operational route fallback, restart-note application, route attempts, and shared deadline. |
| `agent/extensions/delegated-pi-loop/routing.json` | Extension-owned versioned routing policy: capabilities, profiles, tiers, version-2 family assignments (ordered solution/review arrays plus singleton profile strings), disabled providers, override policy. |
| `agent/extensions/delegated-pi-loop/routing.ts` | Strict routing config loader/validator, the normalized role registry, the one shared route selector, and the registration snapshot loader. |
| `agent/extensions/delegated-pi-loop/resources.json` | Extension-owned versioned delegated child resource policy: catalog and runtime extension allowlists plus the allowed and excluded skill sets. |
| `agent/extensions/delegated-pi-loop/resources.ts` | Strict resource-policy loader/validator, skill-candidate resolution, and the catalog/runtime child argument builders. |
| `agent/extensions/delegated-pi-loop/routes.ts` | Role classification (read-only and exclusive families), role labels, route keys, and the pre-spawn oracle guard. Prompt and contract text lives in `instructions.ts`. |
| `agent/extensions/delegated-pi-loop/result.ts` | Model-visible Markdown, terminal-marker stripping, error marking, and final cleanup. |
| `agent/extensions/delegated-pi-loop/diagnostics.ts` | Bounded private failure diagnostics. |
| `agent/extensions/delegated-pi-loop/manager.ts` | Concurrency, numeric IDs, active summaries, and targeted cancellation. |
| `agent/extensions/delegated-pi-loop/render.ts` | Compact and expanded TUI rendering. |
| `agent/extensions/delegated-pi-loop/artifacts.ts` | Private temporary artifacts and bounded output helpers. |
| `agent/extensions/delegated-pi-loop/types.ts` | Runtime, progress, result, and diagnostic contracts. |
| `agent/extensions/delegated-pi-loop/*.test.ts` | Protocol, monitor, supervisor, runner, privacy, rendering, and policy regressions. |

The retired runtime skill and the removed direct Claude CLI backend must not be restored without a new explicit decision.

## Runtime contract

### Instruction ownership and tool scoping

1. Every model-visible delegation instruction lives in `instructions.ts`: parent tool metadata and parameter descriptions, the complete parent workflow guidelines, the child role-family contracts, the base child assignment prompt with its attempt budget, generic recursion prohibition, and terminal-result contract, the fixed restart note, and the report-recovery prompt. Runtime modules import this text or these builders; they own no instruction text of their own.
2. The parent receives the complete delegation workflow exactly once, through the active `delegate_run` tool's `promptGuidelines`. `delegate_model_catalog` receives only its own concise lookup guidance and never the delegation workflow. Tool-scoped prompt content is absent when the tool is inactive.
3. The delegated-child branch registers neither tool and returns before routing or resource loading, so children receive none of the parent tool guidelines. The child prompt carries one short generic recursion prohibition that never names or explains `delegate_run`.
4. `agent/AGENTS.md` carries no delegation policy. The former detailed `## Delegated work` section was removed with instruction centralization (ADR 0011); do not reintroduce delegation policy there, because every delegated child loads `AGENTS.md` as a context file and must not pay for parent orchestration policy.
5. The semantic role-family policy stays in the machine-policy modules: families and the normalized registry derive from `routing.ts`, and the instruction builders consume those types. An unknown runtime family value fails closed at the `roleFamilyContract` boundary.
6. The marked model-visible sections of `docs/delegated-pi-loop-agent-instructions.md` are generated from the canonical exports by `docsync.ts`. After any instruction change, run `npm run render:instructions-doc`; `docsync.test.ts` fails when the checked-in content drifts. The surrounding runtime explanation stays manually authored, and the marker mechanism must stay a fixed named-section renderer, not a general-purpose Markdown template language.

### Parent and child boundaries

1. The extension executes in the parent Pi process and registers `delegate_run`.
2. The parent remains the sole orchestrator and receives only a validated final report.
3. Each route attempt starts one separate ephemeral Pi process with the fixed child resource arguments followed by `--mode rpc --no-session --approve` and a piped stdin.
4. One route attempt uses one persistent child session for the initial task and, when eligible, one report-recovery prompt.
5. `PI_DELEGATED_CHILD=1` suppresses recursive `delegate_run` registration.
6. `PI_DELEGATE_PARENT_PID` lets the child watchdog terminate its process group if the parent disappears.
7. Numeric delegate IDs and manager slots remain active through both report rounds and cleanup.
8. `session_shutdown`, Escape, and `/delegate:stop <id>` cancel either round and remove the full process group.

### Delegated child resource boundary

1. Every delegated child disables discovery with `--no-extensions`, `--no-skills`, `--no-prompt-templates`, and `--no-themes`; the runtime child keeps context-file discovery enabled, the catalog preflight additionally passes `--no-context-files`.
2. The runtime child explicitly loads exactly five extension entry files in policy order: `delegated-pi-loop/index.ts` (watchdog and recursive-tool suppression only), `openai-codex-aliases/index.ts` (provider aliases only), `web-search/index.ts`, `context-mode/src/index.ts`, and `codegraph/index.ts`. Only `web-search`, `context-mode`, and `codegraph` add model-visible child tools; the runtime probe shows 4 built-ins plus 13 extension tools and nothing else.
3. The catalog preflight loads exactly the `openai-codex-aliases` entry file and never loads `delegated-pi-loop`, `web-search`, `context-mode`, `codegraph`, any skill, context files, or presentation resources.
4. `resources.json` is the single authority for these allowlists. It is strictly validated by `resources.ts` when the parent extension instance starts, and a missing or invalid policy fails closed before `delegate_run` registration with no broad-discovery fallback. `/reload` re-reads it with the rest of the extension runtime.
5. Validation enforces version `1`, an exact document shape, unique non-blank relative paths only, regular-file entry files, per-skill regular `SKILL.md` files, canonical containment under the `agent/extensions` and `agent/skills` roots (symlink resolution may not escape either root, including a symlinked `SKILL.md`), no allowed/excluded skill overlap, repeated keys rejected in every object scope through object-scope-correct duplicate-aware parsing (`JSON.parse` alone silently keeps the last duplicate; a flat textual scan misses nested container keys and risks false positives inside string values), and exact canonical profile identity and order: catalog must resolve to exactly `openai-codex-aliases/index.ts`, and runtime to exactly `delegated-pi-loop/index.ts`, `openai-codex-aliases/index.ts`, `web-search/index.ts`, `context-mode/src/index.ts`, and `codegraph/index.ts` in that order; extra contained entries, reordered entries, and alternate same-directory entry files all fail closed after canonical resolution.
6. Argument construction and every catalog or runtime spawn re-verify canonical identity, containment, and regular-file/directory/`SKILL.md` invariants for each approved extension entry and selected skill, immediately before the child command line exists and including every fallback attempt; a vanished or symlink-swapped approved path fails the run before private artifact creation or child spawn (each per-spawn recheck closes the open attempt cleanly) while the immutable argument arrays stay byte-for-byte identical across attempts.
7. One immutable resource selection covers the whole delegate invocation: every route attempt, catalog preflight, and report-recovery round reuses byte-for-byte identical resource arguments, and provider fallback never changes the child's extensions or candidate skills.
8. Installing a new skill or extension does not make it delegate-available: it requires an explicit `resources.json` update. The excluded skill names implement the requested patterns (`crit*`, `developing-*`, `directus*`, `grill-with-docs`, `improve-codebase-arch*`, `intent-layer`, `nlm-skill`, `pi-browser-harness`, `session-handoff`, `skill-creator`) against the current inventory; the runtime stays allowlist-based and fails closed.

### Skill candidate selection

1. `delegate_run.availableSkills` is optional and orchestrator-selected. The parameter enum is built from the validated policy's allowed names in policy order, and the progressive-disclosure description sits on the array property, not the item enum.
2. The field means "make these approved skills discoverable to this delegate". Pi's two-stage progressive disclosure stays authoritative: the child sees only selected skills' catalog names and descriptions, and a full `SKILL.md` body loads only when the delegate decides its task needs it.
3. Omitted or empty `availableSkills` means no skills are discoverable in the child.
4. Selection resolves before manager admission, private artifact creation, or any child spawn. A defined non-array `availableSkills` value fails with the exact bounded error `availableSkills must be an array of skill names` before a length is read or an entry is iterated; unknown, excluded, blank, and non-string names fail closed with the name only; no policy filesystem path is exposed.
5. Duplicate requested names collapse and selected paths are emitted in policy order, not caller order, for deterministic child prompts. There is no arbitrary maximum count; selecting the complete allowed set is valid.
6. The extension never reads, appends, or copies selected skill content, never forces `/skill:name` expansion, never passes skill text through `--append-system-prompt`, and never instructs a blanket read of selected skills.

### RPC and report recovery

1. Send the initial command as one LF-terminated object with id `prompt-1` and type `prompt`.
2. A successful correlated `response` accepts the command. It does not complete the task.
3. Buffer bounded lifecycle events that arrive before the matching successful response, then process them in order.
4. A rejected prompt command becomes `prompt_rejected`. It never becomes `missing_report`, never receives a recovery prompt, and advances operationally to the next configured route.
5. Split stdout only on LF, strip one trailing CR, preserve partial UTF-8 with `StringDecoder`, and fail closed on malformed, duplicate, unknown, oversized, or trailing protocol records.
6. Cancel blocking `select`, `confirm`, `input`, and `editor` extension UI requests with one matching `extension_ui_response`. Consume fire-and-forget UI requests without replying.
7. A clean settled `missing_report` or `invalid_result` receives exactly one fixed `prompt-2` recovery command in the same child session.
8. The recovery response must be a complete self-contained report. The extension never merges reports or inserts a marker.
9. There is no third prompt.
10. `BLOCKED` and `FAILED` remain immediate after their authoritative final assistant message. `COMPLETED` remains provisional until final `agent_end`, `agent_settled`, and a clean stream.
11. A non-completed terminal report carries exactly one `DELEGATE_REASON: <code>` line directly above the final `DELEGATE_RESULT` marker. Allowed BLOCKED codes are `evidence_inaccessible`, `user_decision_required`, `assignment_conflict`, `policy_restriction`, `budget_exhausted`, `external_dependency`, and `finding_reported`; allowed FAILED codes are `execution_failure`, `verification_failure`, `internal_inconsistency`, and `policy_violation`.
12. The parser accepts only exact fixed codes. Unknown, malformed, duplicate, misplaced, path-like, credential-like, overlong, Unicode, or outcome-mismatched values are discarded; a BLOCKED/FAILED outcome then stays terminal with reason `unspecified` plus status `rejected`, and a bare legacy marker stays terminal with `unspecified` plus `missing`. No delegate-authored free text is ever persisted or rendered.
13. A reason line paired with `COMPLETED` violates the terminal contract and follows the existing `invalid_result` recovery and fallback behavior. A missing or rejected reason never triggers report recovery or route fallback by itself.
14. A `blockedMisuseSuspected` flag is recorded only when the outcome is BLOCKED and the accepted reason is `finding_reported`, because reviews with findings must use `COMPLETED`; it is never inferred from the role alone. The typed reason, reason status, and flag propagate through RoundState/MonitorSnapshot, AttemptStatus (schema stays 1), DelegateProgress, supervisor status/progress, the runner result, ToolResult details, failure diagnostics (schema 5), and the fixed failure-Markdown reason lines.

### Provider failure and fallback

1. Classify typed `message_update` errors and assistant `message_end` with `stopReason: "error"` before report-recovery eligibility.
2. Confirm transient evidence only after retries fail or the round settles without a valid result. A later valid `COMPLETED`, `BLOCKED`, or `FAILED` result supersedes recovered retry evidence.
3. Retain only a bounded category: `credits_exhausted`, `quota_exhausted`, `billing_limit`, `usage_limit`, `authentication`, `rate_limit`, or `provider_unavailable`.
4. Compatibility phrase matching covers HTTP 402/payment required, quota exhaustion, depleted credits or credit balances, billing/spending/usage limits, authentication, rate limits, overload, timeout, network, and model availability.
5. Never retain raw provider errors, billing text, balances, account data, credentials, prompts, reports, or protocol payloads in status, diagnostics, rendering, or failure Markdown.
6. Operational failure states advance to the next route while productive-work time remains, even after tools or accepted report recovery: `provider_failed`, `stalled`, `output_limit`, `prompt_rejected`, `invalid_result`, `invalid_stream`, `missing_report`, `child_failed`, and `spawn_failed`. A catalog preflight timeout also advances while work time remains.
7. Terminal states never fall back: global `timed_out/work_deadline`, `completed`, intentional `blocked`, intentional `delegate_failed`, `interrupted`, and the sanitized `cleanup_failed` proof failure. Catalog-unavailable routes still continue without spending an attempt.
8. When advancing after an attempt that executed tools or accepted report recovery, rewrite the next attempt's private prompt from the original assignment plus the one fixed sanitized restart note. The note never carries provider errors, raw output, tool payloads, reports, paths, or credentials, and rebuilding from the original assignment keeps it from stacking.
9. A bounded restart-after-work count and per-attempt restart flags travel in progress, attempts, diagnostics, and rendering.
10. An exhausted operational chain ends as the existing safe `routes_unavailable` outcome without surfacing partial reports.
11. A provider failure never consumes the report-recovery prompt.

### Limits, privacy, and cleanup

1. One monotonic 45-minute productive-work deadline covers catalog checks, initial work, every sequential fallback, tools, retries, compaction, and report recovery. Every route receives the same absolute deadline and the actual remaining work time; provider count never divides or reduces it. Catalog preflight is capped at 15 seconds. Global `work_deadline` expiry is terminal `timed_out` and starts no later route.
2. One shared five-minute idle warning and ten-minute idle deadline covers both rounds. Prompt acceptance, lifecycle transitions, nonempty thinking/text/tool-call/bash deltas, tool execution events, retry, compaction, summarization retry, and report-recovery activity reset idle age. Empty deltas, rendering ticks, unchanged queue or status heartbeats, raw stderr, and malformed output do not. Active tools are tracked by call ID when available; updates keep a tool live, while a silent tool reaches the normal idle deadline.
3. One cumulative 50 MiB limit covers protocol and child output across both rounds.
4. Progress rendering is throttled to about one second independently from 100 ms safety checks.
5. Temporary prompt, report, stderr, and status artifacts use private permissions. The prompt artifact remains for supervision, but no chain-level report or status file is written.
6. Successful output contains only the validated final report with the completed marker stripped.
7. Unsuccessful output contains deterministic bounded Markdown without raw child content or file paths.
8. Failure diagnostics use schema version 5 and include only bounded fixed causes, work budgets, state, delegate outcome, terminal reason and status, route, timing, recovery metadata, provider category, active-tool metadata, sanitized progress, attempts, and stream error categories. Existing schema 3 and 4 files are not migrated. No delegate-authored reason text is included.
9. Process-group termination remains authoritative after final classification. Cleanup has its own ten-second maximum: five seconds of SIGTERM grace, three seconds of SIGKILL disappearance verification, and two seconds for final cleanup. Success requires leader close or recorded exit plus a final dead-group probe. Negative proof records `group_alive` or `close_unconfirmed`, remains terminal, and prevents route overlap.

### Routing configuration and overrides

- `routing.json` is the single authority for model, provider, and thinking policy. It is not coupled to `agent/settings.json`, enabled models, `models.json`, or `models-store.json`.
- The strict loader fails closed on a missing or invalid config before any artifact or child process; there is no compiled-route fallback. Schema version 2 is atomic: a version-1 document is rejected with one clear migration error, and no dual-schema compatibility exists.
- The config encodes model capability records (provider-specific supported thinking levels and a default), reusable profiles of ordered model tiers with optional provider allowlists, disabled providers, a per-profile override policy, and version-2 family assignments: ordered non-empty `solution` and `review` arrays of profile names (deriving role ids `solution-a`..`solution-z` and `review-a`..`review-z`, capped at 26 per indexed family, a profile may repeat inside and across arrays) plus exactly one profile string for each singleton family (`implementation`, `remediation`, `verification`, `oracle`). Singleton families stay singleton: route fallback belongs in profile tiers, never in extra implementation/remediation/verification/oracle slots.
- One validated snapshot builds the normalized role registry (id, family, profile, optional slot). Runtime role validation, route selection, child contracts, read-only/exclusive classification, concurrency, and oracle checks all resolve through this registry; no runtime code infers a role family from a role-id prefix, and an unknown role id fails closed instead of falling through to an implementation contract. The oracle self-review model set derives from every tier of the assigned oracle profile, and that profile must keep `overridePolicy: "rejected"`.
- The parent tool registration loads one fresh snapshot: the `delegate_run` role enum, the count-aware guidance (naming and counting the configured solution and review roles), and the `delegate_model_catalog` parameters derive from it, and the same instance flows into every execution so registration and runtime never drift. Routing changes take effect after extension reload or restart; delegated children register no parent orchestration or catalog tool.
- `delegate_model_catalog` is a read-only lookup over the top-level routing models catalog: a required case-insensitive substring `query` on model ids, an optional exact `provider` filter, an optional configured `thinking` filter, and an optional integer `limit` (default 10, range 1..20). Output is concise, bounded, deterministic, and truncation-aware; models whose routes are all filtered out are omitted, disabled providers never appear, and a zero-match result never dumps the catalog. It never invokes `pi --list-models` and never enumerates model/provider/thinking combinations in the `delegate_run` schema or the permanent prompt.
- One shared selector serves every role: per tier it derives eligible providers from capabilities, intersects allowlists, disabled providers, and override exclusions, draws one random primary for a multi-provider tier (single-provider tiers stay deterministic and consume no draw), appends the remaining providers in stable config order, and concatenates the tiers. No parent-provider preference exists; only the parent model id feeds Oracle self-review prevention.
- Gate A runs Muse Spark alone; Gate B runs DeepSeek alone; Gate C runs `openrouter/stealth/ox-alpha:high` then Hy3. AgentRouter, TokenReply, Tabitoken, and GoRouter have no capability or tier entries in delegated routing. Every A/B/C/F tier allowlists exactly one provider and is deterministic without a random draw. Gate D runs `gpt-5.5` at thinking `high`; Solution E and the Oracle each run `gpt-5.6-sol` at thinking `high` on the nine eligible OpenAI Codex providers `openai-codex`, `openai-codex-zahlo`, and `openai-codex-cgpt1` through `openai-codex-cgpt7`; Cursor stays excluded. Solution F (`gate-f`) runs `zai/glm-5.3:max` only; Review E (`gate-g`) runs `zai/glm-5.3:max` then the same nine-provider `gpt-5.6-sol:high` chain. Inside those multi-provider chains the primary is exactly one random draw and the remaining providers follow in stable config order.
- A temporary sixth reviewer needs no dedicated role or profile: it reuses an existing non-exclusive review role with a distinct prompt, and an optional reason-required one-run `routingOverride` such as `openai-codex-cgpt5/gpt-5.6-sol` at thinking `high` pins its distinct route for that run without changing role permissions or concurrency.
- Implementation and remediation use only `zai/glm-5.3:max`; the removed `tokenreply/claude-fable-5` capability and tier must not return. Verification remains `openai-codex/gpt-5.6-sol:high`. The removed `agentrouter` capabilities and the `claude-opus-4-8` capability record must not return to delegated routing.
- The public tool schema has no routine backend parameter. The optional exceptional `routingOverride` carries `provider`, `model`, `thinking`, `excludeProviders`, and a mandatory non-empty `reason`; empty or no-op overrides are rejected, the Oracle rejects every override, and an override never changes role permissions or concurrency.
- Guidance states routing is automatic and an override is valid only for an explicit user or project operational request; no default route matrix is model-visible.

### Concurrency and authorization

1. All configured solution roles and all configured review roles retain their concurrent gates; the derived role ids and gate sizes come from the routing snapshot assignments, so resizing a gate is a `routing.json` edit with no synchronized code, schema, or guidance count edits. A temporary extra reviewer reuses an existing non-exclusive review role under the same overlap rules, and the manager admits duplicate review roles by design.
2. Independent verifications overlap only other verifications, in batches of at most four.
3. Implementation, remediation, and oracle remain exclusive against every active delegate.
4. Read-only roles remain semantic contracts, not filesystem sandboxes.
5. The parent must not edit while a mutating delegate runs.
6. Staging, commits, pushes, deployments, and hosted-service writes require separate explicit authorization.
7. The review gate stays strict: every configured reviewer must complete before the gate passes. After one or more reviewers fail operationally or end non-completed (including `blocked`, `cleanup_failed`, and `routes_unavailable`), only the user may explicitly waive the named failed reviewer roles for that one current gate; the parent then continues with the completed reports, records which reviewers were waived and that the gate completed under user waiver, and never labels a waived failure as a reviewer pass. The waiver is one-shot and gate-scoped: it changes no later gates, role schema, routing, or concurrency, it does not dismiss findings from completed reviewers or waive finding verification, remediation, or other safety rules, and it must not be inferred from a generic request to continue, commit, or skip retries. Gate completion is parent-side orchestration policy; the extension enforces no waiver state.
8. The solution-investigation gate stays strict in parallel: every configured solution investigator must complete before synthesis. After one or more solution delegates fail operationally or end non-completed (including `blocked`, `cleanup_failed`, and `routes_unavailable`), only the user may explicitly waive the named failed solution roles for that one current solution gate; the parent then continues synthesis using only the completed solution reports plus parent-verified repository evidence, records which solution roles were waived and that the solution gate proceeded under user waiver, and never labels a waived failure as completed or passed. At least one solution delegate must have completed; the user cannot waive the entire evidence set and synthesize from zero completed investigator reports. The waiver is one-shot and gate-scoped: it changes no later solution gates, role schema, routing, or concurrency, it does not fabricate or dismiss evidence, resolve uncertainties, authorize implementation, replace parent evidence verification, skip the advisory oracle when otherwise required, or weaken implementation, review, verification, or remediation rules, and it must not be inferred from a generic request to continue, commit, or skip retries. Gate completion is parent-side orchestration policy; the extension enforces no waiver state.

## Update workflow

1. Read installed Pi `docs/rpc.md`, `docs/extensions.md`, `docs/json.md`, `docs/environment-variables.md`, and `docs/tui.md` completely.
2. Read ADR 0007, ADR 0008, ADR 0009, this document, and every owned source file.
3. Preserve `routing.json` route intent, role contracts (`instructions.ts`), manager IDs, cancellation, cleanup, deadlines, privacy, diagnostics, and recursive suppression.
4. Update tests with behavior changes.
5. Update root `README.md`, ADR current-policy text, changelog, and context-cost accounting when the public tool contract changes; regenerate the reference document's generated sections with `npm run render:instructions-doc`. Never re-add delegation policy to `agent/AGENTS.md`.
6. Do not run paid model inference without explicit authorization.

## Required checks

Run the extension suite:

```bash
cd ~/.pi/agent/extensions/delegated-pi-loop
npm test
```

Run strict TypeScript with `strict`, `noUnusedLocals`, and `noUnusedParameters` against the installed Pi declarations.

Regenerate the instruction reference document after any instruction change and confirm it is current:

```bash
cd ~/.pi/agent/extensions/delegated-pi-loop
npm run render:instructions-doc
```

Validate extension loading without inference:

```bash
pi --list-models zai/glm-5.3
```

Verify each route with the lean catalog resource profile, which loads only the alias extension and disables every discovery flag:

```bash
LEAN="--no-extensions -e ~/.pi/agent/extensions/openai-codex-aliases/index.ts --no-skills --no-prompt-templates --no-themes --no-context-files"
pi $LEAN --list-models opencode-go/muse-spark-1.2-contributor
pi $LEAN --list-models opencode-go/deepseek-v4-flash
pi $LEAN --list-models openrouter/stealth/ox-alpha
pi $LEAN --list-models opencode-go/hy3
pi $LEAN --list-models zai/glm-5.3
pi $LEAN --list-models openai-codex/gpt-5.6-sol
pi $LEAN --list-models openai-codex-zahlo/gpt-5.6-sol
pi $LEAN --list-models openai-codex-cgpt1/gpt-5.6-sol
pi $LEAN --list-models openai-codex-cgpt2/gpt-5.6-sol
pi $LEAN --list-models openai-codex-cgpt3/gpt-5.6-sol
pi $LEAN --list-models openai-codex-cgpt4/gpt-5.6-sol
pi $LEAN --list-models openai-codex-cgpt5/gpt-5.6-sol
pi $LEAN --list-models openai-codex-cgpt6/gpt-5.6-sol
pi $LEAN --list-models openai-codex-cgpt7/gpt-5.6-sol
pi $LEAN --list-models openai-codex/gpt-5.5
pi $LEAN --list-models openai-codex-zahlo/gpt-5.5
pi $LEAN --list-models openai-codex-cgpt1/gpt-5.5
pi $LEAN --list-models openai-codex-cgpt2/gpt-5.5
pi $LEAN --list-models openai-codex-cgpt3/gpt-5.5
pi $LEAN --list-models openai-codex-cgpt4/gpt-5.5
pi $LEAN --list-models openai-codex-cgpt5/gpt-5.5
pi $LEAN --list-models openai-codex-cgpt6/gpt-5.5
pi $LEAN --list-models openai-codex-cgpt7/gpt-5.5
```

Also verify:

- the complete parent delegation workflow reaches the model only through the active `delegate_run` promptGuidelines; `delegate_model_catalog` keeps only its concise lookup guidance; the delegated-child branch registers neither tool and returns before routing or resource loading; the child prompt keeps exactly one generic recursion prohibition that never names `delegate_run`;
- `agent/AGENTS.md` stays free of delegation policy and duplicated workflow wording, every role family receives its centralized contract from `instructions.ts`, unknown families fail closed at the contract boundary, and the checked-in instruction document's generated sections match the canonical exports for the shipped routing snapshot (covered by `instructions.test.ts` and `docsync.test.ts`);
- `routing.json` passes the strict validator and a missing or invalid file fails closed with no compiled-route fallback; a version-1 document is rejected with the migration error; assignment validation rejects empty, oversized (beyond 26 per indexed family), malformed, blank, or unknown-profile entries, non-string singleton assignments, missing or extra family keys, and an oracle profile without the rejected override policy; duplicate profiles inside and across the solution/review arrays stay valid;
- the normalized role registry derives ordered role ids with zero-based slots, the `delegate_run` role enum and count-aware guidance regenerate from the snapshot, unknown role ids fail closed at the registry boundary before admission, artifacts, or spawn, and `delegate_model_catalog` query, provider, thinking, and limit filters, zero-match bounding, truncation flags, and disabled-provider exclusion behave as specified;
- `resources.json` passes the strict validator, the shipped policy inventory matches the pinned allowed and excluded sets, and a missing, invalid, escaping, overlapping, or profile-violating policy fails closed before `delegate_run` registration with no broad-discovery fallback; the catalog and runtime lists must resolve to the exact canonical entry files in the exact canonical order (extra contained entries such as a listed `footer` extension, reordered fixed entries, and alternate same-directory entry files all fail closed); repeated keys are rejected in every object scope, including the nested `extensions.catalog`, `extensions.runtime`, `skills.allowed`, and `skills.excluded` containers, while key-like text inside string values stays accepted;
- post-validation symlink swaps of an approved extension entry or selected skill directory fail closed at argument construction and again immediately before every catalog or runtime spawn, including fallback attempts; a post-selection selected-skill directory or `SKILL.md` invalidation additionally fails the catalog pre-spawn verifier itself, so no catalog or runtime child command line exists, while an invalidated unselected skill does not fail it; and a defined non-array `availableSkills` value fails with the exact bounded error before manager admission, artifact creation, or spawn;
- catalog preflight argv carries the isolation flags plus only the alias `-e` entry and no `--skill` argument; runtime argv carries exactly the five fixed `-e` entries, selected `--skill` paths in policy order, and no `--no-context-files`; every fallback attempt receives byte-for-byte identical resource arguments;
- `availableSkills` accepts the complete allowed set with no count limit, rejects unknown, excluded, blank, and non-string names before manager admission, artifact creation, or spawn, and never reads or appends selected skill content;
- no-inference real-Pi resource probes with the production child resource arguments show only intended tools and skills, no `browser_*` tool, no `delegate_run`, context files present for runtime probes, and no prompt-template commands; paid provider calibration is rerun only under separate authorization;
- fake clean missing reports receive one same-session recovery prompt;
- fake credit-depleted routes fall back before tools without a recovery prompt;
- operational failures after tools or accepted recovery fall back with the fixed sanitized restart note, which never stacks and never leaks provider errors, raw output, tool payloads, reports, paths, or credentials;
- intentional `blocked` and `delegate_failed` outcomes, completed runs, and interruption stay terminal without fallback, including with a missing or rejected terminal reason, and a reason line paired with COMPLETED follows the invalid-result recovery path;
- routing overrides are exceptional only: no-op overrides are rejected, the Oracle rejects every override, and overrides never change role permissions or concurrency;
- prompt rejection advances operationally to the next route;
- one child PID handles both prompts;
- first invalid reports never reach parent content;
- shared deadlines and cumulative output bounds do not reset;
- UI requests cannot block the child;
- cancellation and natural completion remove descendants;
- direct Claude route, backend, runner, supervisor, permission, plain-protocol, and fixture scans are empty;
- delegated routing contains no AgentRouter capability or tier and no Claude-model route; the encoded chains keep their tier order, with primary rotation only inside the Codex alias tiers;
- unrelated dirty files remain untouched;
- `git diff --check` passes;
- the active model-visible context surfaces are recounted locally;
- no paid inference or live smoke runs without explicit approval.
