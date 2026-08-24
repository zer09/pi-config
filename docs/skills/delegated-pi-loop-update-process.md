# Delegated Pi extension update process

Purpose: maintain the native TypeScript `delegate_run` extension that runs in the parent Pi process and supervises fresh ephemeral Pi RPC children. The extension owns role routing, strict RPC JSONL, one same-session report recovery, provider-failure classification, bounded subprocess lifecycle, private event parsing, targeted cancellation, result validation, diagnostics, and cleanup.

## Classification and authority

- Extension classification: **keep it**. Process supervision, fallback cutoffs, report recovery, and shared-tree safety are executable behavior.
- Source of truth: this Pi config, ADR 0007, ADR 0008, ADR 0009, and installed Pi RPC/extension documentation.
- Route authority: `agent/extensions/delegated-pi-loop/routing.json`, strictly validated by `routing.ts` at load time and checked against Pi's live model catalog.
- Direct Claude Code authority: none. The extension has no direct Claude CLI backend and must not inspect, invoke, install, uninstall, or modify the user's Claude CLI.
- Claude-named models served through ordinary Pi providers remain supported. Their provider/model route order is independent from the removed direct CLI integration.

## Owned surfaces

| Path | Responsibility |
|---|---|
| `agent/AGENTS.md` | Compact trigger and orchestration policy. |
| `agent/extensions/delegated-pi-loop/index.ts` | Tool registration, model-visible schema/guidance, commands, child recursion suppression, and execute finalization. |
| `agent/extensions/delegated-pi-loop/protocol.ts` | Strict LF-framed RPC JSONL, prompt correlation, UI cancellation, and bounded provider-failure categories. |
| `agent/extensions/delegated-pi-loop/monitor.ts` | Two-round Pi lifecycle validation, report extraction, activity, and structured provider-failure evidence. |
| `agent/extensions/delegated-pi-loop/supervisor.ts` | Persistent RPC child, limits, cancellation, process groups, cleanup, progress, and private artifacts. |
| `agent/extensions/delegated-pi-loop/runner.ts` | Catalog preflight, operational route fallback, restart-note application, route attempts, and shared deadline. |
| `agent/extensions/delegated-pi-loop/routing.json` | Extension-owned versioned routing policy: capabilities, profiles, tiers, role mapping, disabled providers, override policy, Oracle safety. |
| `agent/extensions/delegated-pi-loop/routing.ts` | Strict routing config loader/validator and the one shared route selector. |
| `agent/extensions/delegated-pi-loop/routes.ts` | Role classification, role prompts, the fixed restart note, and the terminal marker contract. |
| `agent/extensions/delegated-pi-loop/result.ts` | Model-visible Markdown, terminal-marker stripping, error marking, and final cleanup. |
| `agent/extensions/delegated-pi-loop/diagnostics.ts` | Bounded private failure diagnostics. |
| `agent/extensions/delegated-pi-loop/manager.ts` | Concurrency, numeric IDs, active summaries, and targeted cancellation. |
| `agent/extensions/delegated-pi-loop/render.ts` | Compact and expanded TUI rendering. |
| `agent/extensions/delegated-pi-loop/artifacts.ts` | Private temporary artifacts and bounded output helpers. |
| `agent/extensions/delegated-pi-loop/types.ts` | Runtime, progress, result, and diagnostic contracts. |
| `agent/extensions/delegated-pi-loop/*.test.ts` | Protocol, monitor, supervisor, runner, privacy, rendering, and policy regressions. |

The retired runtime skill and the removed direct Claude CLI backend must not be restored without a new explicit decision.

## Runtime contract

### Parent and child boundaries

1. The extension executes in the parent Pi process and registers `delegate_run`.
2. The parent remains the sole orchestrator and receives only a validated final report.
3. Each route attempt starts one separate ephemeral Pi process with `--mode rpc --no-session --approve` and a piped stdin.
4. One route attempt uses one persistent child session for the initial task and, when eligible, one report-recovery prompt.
5. `PI_DELEGATED_CHILD=1` suppresses recursive `delegate_run` registration.
6. `PI_DELEGATE_PARENT_PID` lets the child watchdog terminate its process group if the parent disappears.
7. Numeric delegate IDs and manager slots remain active through both report rounds and cleanup.
8. `session_shutdown`, Escape, and `/delegate:stop <id>` cancel either round and remove the full process group.

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
- The strict loader fails closed on a missing or invalid config before any artifact or child process; there is no compiled-route fallback.
- The config encodes model capability records (provider-specific supported thinking levels and a default), reusable profiles of ordered model tiers with optional provider allowlists, a complete mapping for every `DelegateRole`, disabled providers, a per-profile override policy, and Oracle safety tied to the configured Oracle model id.
- One shared selector serves every role: per tier it derives eligible providers from capabilities, intersects allowlists, disabled providers, and override exclusions, prefers the parent's selected provider when eligible, otherwise draws one random primary, appends the remaining providers in stable config order, and concatenates the tiers.
- Gate A runs Muse Spark then AgentRouter Sol; Gate B runs DeepSeek then AgentRouter Opus; Gate C runs `tokenreply/ox-alpha:xhigh`, Hy3, then AgentRouter Opus. Tabitoken and GoRouter have no capability or tier entries in delegated routing. Every A/B/C tier allowlists exactly one provider and is deterministic without a random draw. Gate D runs `gpt-5.5` at thinking `high`; Solution E and the Oracle each run `gpt-5.6-sol` at thinking `high` on the nine eligible OpenAI Codex providers `openai-codex`, `openai-codex-zahlo`, and `openai-codex-cgpt1` through `openai-codex-cgpt7`; Cursor stays excluded. Solution F (`gate-f`) runs `agentrouter/claude-opus-5:high` then `zai/glm-5.3:max`; Review E (`gate-g`) runs `zai/glm-5.3:max` then the same nine-provider `gpt-5.6-sol:high` chain. Inside those multi-provider chains the primary is the eligible parent provider, otherwise exactly one random draw, and the remaining providers follow in stable config order.
- A temporary sixth reviewer needs no dedicated role or profile: it reuses an existing non-exclusive review role with a distinct prompt, and an optional reason-required one-run `routingOverride` such as `openai-codex-cgpt5/gpt-5.6-sol` at thinking `high` pins its distinct route for that run without changing role permissions or concurrency.
- Implementation and remediation use only `zai/glm-5.3:max`; the removed `tokenreply/claude-fable-5` capability and tier must not return. Verification remains `openai-codex/gpt-5.6-sol:high`.
- The public tool schema has no routine backend parameter. The optional exceptional `routingOverride` carries `provider`, `model`, `thinking`, `excludeProviders`, and a mandatory non-empty `reason`; empty or no-op overrides are rejected, the Oracle rejects every override, and an override never changes role permissions or concurrency.
- Guidance states routing is automatic and an override is valid only for an explicit user or project operational request; no default route matrix is model-visible.

### Concurrency and authorization

1. Solution A/B/C/D/E/F and review A/B/C/D/E roles retain their concurrent gates; a temporary sixth reviewer reuses an existing non-exclusive review role under the same overlap rules, and the manager admits duplicate review roles by design.
2. Independent verifications overlap only other verifications, in batches of at most four.
3. Implementation, remediation, and oracle remain exclusive against every active delegate.
4. Read-only roles remain semantic contracts, not filesystem sandboxes.
5. The parent must not edit while a mutating delegate runs.
6. Staging, commits, pushes, deployments, and hosted-service writes require separate explicit authorization.
7. The five-reviewer gate stays strict: all five reviews must complete before the gate passes. After one or more reviewers fail operationally or end non-completed (including `blocked`, `cleanup_failed`, and `routes_unavailable`), only the user may explicitly waive the named failed reviewer roles for that one current gate; the parent then continues with the completed reports, records which reviewers were waived and that the gate completed under user waiver, and never labels a waived failure as a reviewer pass. The waiver is one-shot and gate-scoped: it changes no later gates, role schema, routing, or concurrency, it does not dismiss findings from completed reviewers or waive finding verification, remediation, or other safety rules, and it must not be inferred from a generic request to continue, commit, or skip retries. Gate completion is parent-side orchestration policy; the extension enforces no waiver state.
8. The solution-investigation gate stays strict in parallel: all six investigators must complete before synthesis. After one or more solution delegates fail operationally or end non-completed (including `blocked`, `cleanup_failed`, and `routes_unavailable`), only the user may explicitly waive the named failed solution roles for that one current solution gate; the parent then continues synthesis using only the completed solution reports plus parent-verified repository evidence, records which solution roles were waived and that the solution gate proceeded under user waiver, and never labels a waived failure as completed or passed. At least one solution delegate must have completed; the user cannot waive the entire evidence set and synthesize from zero completed investigator reports. The waiver is one-shot and gate-scoped: it changes no later solution gates, role schema, routing, or concurrency, it does not fabricate or dismiss evidence, resolve uncertainties, authorize implementation, replace parent evidence verification, skip the advisory oracle when otherwise required, or weaken implementation, review, verification, or remediation rules, and it must not be inferred from a generic request to continue, commit, or skip retries. Gate completion is parent-side orchestration policy; the extension enforces no waiver state.

## Update workflow

1. Read installed Pi `docs/rpc.md`, `docs/extensions.md`, `docs/json.md`, `docs/environment-variables.md`, and `docs/tui.md` completely.
2. Read ADR 0007, ADR 0008, ADR 0009, this document, and every owned source file.
3. Preserve `routing.json` route intent, role contracts, manager IDs, cancellation, cleanup, deadlines, privacy, diagnostics, and recursive suppression.
4. Update tests with behavior changes.
5. Update `agent/AGENTS.md`, root `README.md`, ADR current-policy text, changelog, and context-cost accounting when the public tool contract changes.
6. Do not run paid model inference without explicit authorization.

## Required checks

Run the extension suite:

```bash
cd ~/.pi/agent/extensions/delegated-pi-loop
npm test
```

Run strict TypeScript with `strict`, `noUnusedLocals`, and `noUnusedParameters` against the installed Pi declarations.

Validate extension loading without inference:

```bash
pi --list-models zai/glm-5.3
```

Verify each route with `pi --list-models`, including all Pi-served Claude model routes:

```bash
pi --list-models opencode-go/muse-spark-1.2-contributor
pi --list-models opencode-go/deepseek-v4-flash
pi --list-models tokenreply/ox-alpha
pi --list-models opencode-go/hy3
pi --list-models agentrouter/gpt-5.6-sol
pi --list-models agentrouter/claude-opus-5
pi --list-models zai/glm-5.3
pi --list-models openai-codex/gpt-5.6-sol
pi --list-models openai-codex-zahlo/gpt-5.6-sol
pi --list-models openai-codex-cgpt1/gpt-5.6-sol
pi --list-models openai-codex-cgpt2/gpt-5.6-sol
pi --list-models openai-codex-cgpt3/gpt-5.6-sol
pi --list-models openai-codex-cgpt4/gpt-5.6-sol
pi --list-models openai-codex-cgpt5/gpt-5.6-sol
pi --list-models openai-codex-cgpt6/gpt-5.6-sol
pi --list-models openai-codex-cgpt7/gpt-5.6-sol
pi --list-models openai-codex/gpt-5.5
pi --list-models openai-codex-zahlo/gpt-5.5
pi --list-models openai-codex-cgpt1/gpt-5.5
pi --list-models openai-codex-cgpt2/gpt-5.5
pi --list-models openai-codex-cgpt3/gpt-5.5
pi --list-models openai-codex-cgpt4/gpt-5.5
pi --list-models openai-codex-cgpt5/gpt-5.5
pi --list-models openai-codex-cgpt6/gpt-5.5
pi --list-models openai-codex-cgpt7/gpt-5.5
```

Also verify:

- `routing.json` passes the strict validator and a missing or invalid file fails closed with no compiled-route fallback;
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
- Pi-served Claude routes keep their encoded tier order, with primary rotation only inside Gate D's and the Oracle's Codex alias tiers;
- unrelated dirty files remain untouched;
- `git diff --check` passes;
- the active model-visible context surfaces are recounted locally;
- no paid inference or live smoke runs without explicit approval.
