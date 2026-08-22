# Delegated Pi extension update process

Purpose: maintain the native TypeScript `delegate_run` extension that runs in the parent Pi process and supervises fresh ephemeral Pi RPC children. The extension owns role routing, strict RPC JSONL, one same-session report recovery, provider-failure classification, bounded subprocess lifecycle, private event parsing, targeted cancellation, result validation, diagnostics, and cleanup.

## Classification and authority

- Extension classification: **keep it**. Process supervision, fallback cutoffs, report recovery, and shared-tree safety are executable behavior.
- Source of truth: this Pi config, ADR 0007, ADR 0008, and installed Pi RPC/extension documentation.
- Route authority: `agent/extensions/delegated-pi-loop/routes.ts`, checked against Pi's live model catalog.
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
| `agent/extensions/delegated-pi-loop/runner.ts` | Catalog preflight, ordered pre-tool fallback, route attempts, and shared deadline. |
| `agent/extensions/delegated-pi-loop/routes.ts` | Pi route maps, role classification, role prompts, and terminal marker contract. |
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
4. A rejected prompt command becomes `prompt_rejected`. It never becomes `missing_report`, never falls back, and receives no extra prompt.
5. Split stdout only on LF, strip one trailing CR, preserve partial UTF-8 with `StringDecoder`, and fail closed on malformed, duplicate, unknown, oversized, or trailing protocol records.
6. Cancel blocking `select`, `confirm`, `input`, and `editor` extension UI requests with one matching `extension_ui_response`. Consume fire-and-forget UI requests without replying.
7. A clean settled `missing_report` or `invalid_result` receives exactly one fixed `prompt-2` recovery command in the same child session.
8. The recovery response must be a complete self-contained report. The extension never merges reports or inserts a marker.
9. There is no third prompt.
10. `BLOCKED` and `FAILED` remain immediate after their authoritative final assistant message. `COMPLETED` remains provisional until final `agent_end`, `agent_settled`, and a clean stream.

### Provider failure and fallback

1. Classify typed `message_update` errors and assistant `message_end` with `stopReason: "error"` before report-recovery eligibility.
2. Confirm transient evidence only after retries fail or the round settles without a valid result. A later valid `COMPLETED`, `BLOCKED`, or `FAILED` result supersedes recovered retry evidence.
3. Retain only a bounded category: `credits_exhausted`, `quota_exhausted`, `billing_limit`, `usage_limit`, `authentication`, `rate_limit`, or `provider_unavailable`.
4. Compatibility phrase matching covers HTTP 402/payment required, quota exhaustion, depleted credits or credit balances, billing/spending/usage limits, authentication, rate limits, overload, timeout, network, and model availability.
5. Never retain raw provider errors, billing text, balances, account data, credentials, prompts, reports, or protocol payloads in status, diagnostics, rendering, or failure Markdown.
6. A provider failure before tools has state `provider_failed` and may carry `provider_unavailable_before_tools`, which advances the existing ordered route chain.
7. A provider failure after any tool fails closed on the selected route.
8. A provider failure after the recovery prompt is accepted fails closed even when no tool ran.
9. A provider failure never consumes the report-recovery prompt.
10. If all eligible routes fail before tools, the chain ends as `routes_unavailable`.
11. The existing pre-tool idle fallback remains. No other fallback is allowed.

### Limits, privacy, and cleanup

1. One shared 45-minute wall deadline covers initial work and recovery.
2. One shared five-minute idle warning and ten-minute idle deadline covers both rounds. Accepted activity resets idle age; empty deltas do not.
3. One cumulative 50 MiB limit covers protocol and child output across both rounds.
4. Progress rendering is throttled to about one second independently from 100 ms safety checks.
5. Temporary prompt, report, stderr, and status artifacts use private permissions. The prompt artifact remains for supervision, but no chain-level report or status file is written.
6. Successful output contains only the validated final report with the completed marker stripped.
7. Unsuccessful output contains deterministic bounded Markdown without raw child content or file paths.
8. Failure diagnostics use schema version 2 and include only bounded state, route, timing, recovery metadata, provider category, sanitized progress, attempts, and stream error categories.
9. Process-group termination remains authoritative after final classification. The extension then waits for cleanup, persists a failure diagnostic when needed, removes temporary artifacts, and releases the manager slot.

### Backends and routes

- Public backends are exactly `default` and `zai`.
- `backend=claude` is not in the schema or runtime types and must fail tool schema validation before execution.
- The oracle requires `backend=default`; explicit Z.AI is rejected before spawn.
- A/B/C Pi route arrays, including Tabitoken, SeekAI, AgentRouter, and GoRouter model IDs that contain `claude`, remain supported and retain their exact ordering.
- D and Oracle still select one inherited eligible or random primary once, then use the canonical remaining OpenAI Codex aliases.
- Implementation and remediation remain `zai/glm-5.3:max`; verification remains `openai-codex/gpt-5.6-sol:high`.
- Backend selection never changes role mutation permissions.

### Concurrency and authorization

1. Solution and review A/B/C/D roles retain their concurrent gates.
2. Independent verifications overlap only other verifications, in batches of at most four.
3. Implementation, remediation, and oracle remain exclusive against every active delegate.
4. Read-only roles remain semantic contracts, not filesystem sandboxes.
5. The parent must not edit while a mutating delegate runs.
6. Staging, commits, pushes, deployments, and hosted-service writes require separate explicit authorization.

## Update workflow

1. Read installed Pi `docs/rpc.md`, `docs/extensions.md`, `docs/json.md`, `docs/environment-variables.md`, and `docs/tui.md` completely.
2. Read ADR 0007, ADR 0008, this document, and every owned source file.
3. Preserve route arrays, role contracts, manager IDs, cancellation, cleanup, deadlines, privacy, diagnostics, and recursive suppression.
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
pi --list-models opencode-go/hy3
pi --list-models agentrouter/gpt-5.6-sol
pi --list-models tabitoken/claude-opus-5-thinking
pi --list-models seekai/claude-opus-5
pi --list-models seekai/deepseek-v4-flash
pi --list-models agentrouter/claude-opus-5
pi --list-models gorouter/claude-opus-5-thinking
pi --list-models zai/glm-5.3
pi --list-models openai-codex/gpt-5.6-sol
pi --list-models openai-codex-zahlo/gpt-5.6-sol
pi --list-models openai-codex-cgpt1/gpt-5.6-sol
pi --list-models openai-codex-cgpt2/gpt-5.6-sol
pi --list-models openai-codex-cgpt3/gpt-5.6-sol
pi --list-models openai-codex/gpt-5.5
pi --list-models openai-codex-zahlo/gpt-5.5
pi --list-models openai-codex-cgpt1/gpt-5.5
pi --list-models openai-codex-cgpt2/gpt-5.5
pi --list-models openai-codex-cgpt3/gpt-5.5
```

Also verify:

- fake clean missing reports receive one same-session recovery prompt;
- fake credit-depleted routes fall back before tools without a recovery prompt;
- provider failures after tools or accepted recovery do not fall back;
- prompt rejection fails closed;
- one child PID handles both prompts;
- first invalid reports never reach parent content;
- shared deadlines and cumulative output bounds do not reset;
- UI requests cannot block the child;
- cancellation and natural completion remove descendants;
- direct Claude route, backend, runner, supervisor, permission, plain-protocol, and fixture scans are empty;
- Pi-served Claude route arrays and order are unchanged;
- unrelated dirty files remain untouched;
- `git diff --check` passes;
- the active model-visible context surfaces are recounted locally;
- no paid inference or live smoke runs without explicit approval.
