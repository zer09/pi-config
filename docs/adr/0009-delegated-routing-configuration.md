# ADR 0009: Move delegated routing into a versioned extension-owned config

## Status

Accepted

## Context

ADR 0007 defined the delegated role routes and ADR 0008 moved them into native TypeScript arrays and provider lists inside `routes.ts`. Every route change since then edited executable TypeScript, and the routing policy — ordered fallback chains, eligible provider sets, per-model thinking support, and role-to-route mapping — lived as code that only a developer could safely inspect.

Three pressures made that placement wrong:

- The OpenAI Codex alias provider set changes by user request (`openai-codex-cgpt4` and `openai-codex-cgpt5` were added on 2026-08-23). Each alias addition required code edits in the middle of executable selector logic.
- Routing intent is configuration, not behavior. The mechanism (catalog preflight, ordered attempts, inherited-or-random primaries, Oracle safety) is behavior; which model, provider, and thinking each role uses is policy.
- The pre-tool-only fallback cutoff was proven too weak: an attempt that already executed tools or accepted report recovery can fail operationally, and abandoning the whole delegation because of one provider failure wastes the completed evidence.

## Decision

Move the routing policy into `agent/extensions/delegated-pi-loop/routing.json`, an extension-owned versioned configuration file, with a strict loader and validator in `routing.ts`.

The config is the single authority for model, provider, and thinking policy. It is deliberately not coupled to `agent/settings.json`, enabled models, `models.json`, or `models-store.json`. A missing or invalid config fails closed with a bounded error before any artifact or child process exists; there is no compiled-route fallback.

The config supports:

- model capability records with provider-specific supported thinking levels and a default thinking level;
- reusable routing profiles mapping ordered model tiers to roles, so solution/review pairs share one profile;
- optional per-tier provider allowlists;
- a complete mapping for every `DelegateRole`;
- disabled providers, which must never silently empty a configured tier (the validator rejects such a config);
- a per-profile override policy; and
- Oracle safety, tying `oracleSafety.selfReviewModelIds` to the exact set of models across the Oracle profile's tiers, so a parent running any tier model skips the oracle.

One shared selector in `routing.ts` replaces the A/B/C route arrays, the D and Oracle eligible-provider helpers, and the singleton implementation and verification branches. For each tier it derives eligible providers from the capability records, intersects the tier allowlist, disabled providers, and override exclusions, prefers the parent session's selected provider when eligible, otherwise draws one random primary from an injectable source, appends the remaining providers in stable config order, and concatenates the tiers. Every role uses this selector, including implementation, remediation, verification, and the Oracle. The `routeKey` format `provider/model:thinking` is unchanged.

The current route intent from ADR 0007 is encoded with three deliberate deviations: providers serving the same model at the same thinking level are grouped into one tier where that does not reorder the chain; the new Codex aliases `openai-codex-cgpt4` and `openai-codex-cgpt5` join every tier where the Codex alias group serves `gpt-5.5` or `gpt-5.6-sol`; and grouping OpenCode Go and SeekAI into Gate B's shared `deepseek-v4-flash` tier replaced ADR 0007's fixed OpenCode Go primary with the shared selector's inherited-or-random primary rotation inside that tier, while Gate B's tier order and every other primary stayed as encoded.

On 2026-08-24, the user removed the SeekAI provider from the routing config entirely: its capability records and every tier reference are gone rather than disabled, Gate B's `deepseek-v4-flash` tier runs on OpenCode Go alone, and the two SeekAI `claude-opus-5` backup tiers left Gates A and C. Every remaining A/B/C `agentrouter/claude-opus-5` and `tabitoken/claude-opus-5-thinking` tier now runs at thinking `high` — AgentRouter's `claude-opus-5` capability gained `high` support and `high` as its default while keeping `xhigh` and `max`, and Tabitoken and GoRouter keep their declared levels with `high` already the default — and Gate D moved `gpt-5.5` from `medium` to `high` across its then-current seven-provider set. No tier in A/B/C allowlisted more than one provider, so inherited-or-random primary rotation applied only to Gate D and the Oracle.

Later on 2026-08-24, TokenReply joined two role profiles without changing the shared selector: `ox-alpha:xhigh` became Gate C's first tier ahead of Hy3, and non-thinking `claude-fable-5:off` became the implementation/remediation primary ahead of the retained `zai/glm-5.3:max` fallback. `openai-codex-cgpt6` joined both Codex alias pools, expanding Gate D and the Oracle to eight providers. Every tier in A/B/C remains single-provider and deterministic.

Also on 2026-08-24, `openai-codex-cgpt7` joined both Codex alias pools with capability records matching CGPT6 for `gpt-5.5` and `gpt-5.6-sol`. Gate D and the Oracle now each select from nine Codex providers through CGPT7. Catalog validation uses no-inference `pi --list-models openai-codex-cgpt7/gpt-5.5` and `pi --list-models openai-codex-cgpt7/gpt-5.6-sol` commands.

Later on 2026-08-24, the user removed Tabitoken and GoRouter from delegated routing. The shared `claude-opus-5-thinking` capability record and all six A/B/C tiers that referenced those providers were deleted rather than disabled. Gate A now has two tiers, Gate B has two tiers, and Gate C has three tiers; global provider and model configuration remains outside this routing-policy decision.

Also on 2026-08-24, the user added permanent Solution E to the required investigation gate. Its dedicated `gate-e` profile runs `gpt-5.6-sol:high` across the same nine Codex providers through CGPT7 as the Oracle, but keeps the normal solution override policy. Solution E uses the generic read-only `solution-*` role contract and the shared selector; no role-specific child prompt or selection branch exists.

Later on 2026-08-24, the user superseded the 2026-08-23 four-reviewer restoration with permanent Review E and added permanent Solution F. The current mapping is `solution-f` to `gate-f` and `review-e` to `gate-g`; the shared selector and generic prefix classification remain unchanged. The required solution gate is now A/B/C/D/E/F and the required review gate is A/B/C/D/E. The prior temporary-extra reviewer mechanism remains only for an occasional sixth reviewer that reuses a non-exclusive role.

Still later on 2026-08-24, the user removed `tokenreply/claude-fable-5` because that provider route no longer had sufficient credit. Its capability record and implementation-profile tier are deleted rather than disabled. Implementation and remediation now use only `zai/glm-5.3:max`; TokenReply remains configured only for Gate C's `ox-alpha:xhigh` tier.

On 2026-08-23 the user added the fifth implementation reviewer `review-e`, mapped to a dedicated single-tier `gate-e` profile, then reverted the persistent fifth reviewer later the same day: the default review gate is four-member A/B/C/D again, `review-e` and `gate-e` are gone, and the role taxonomy stays fixed and fail-closed because roles define permission and concurrency classes. A temporary extra reviewer for one gate needs no dedicated role or profile: it reuses an existing non-exclusive review role with a distinct prompt, the `DelegateManager` already admits duplicate non-exclusive review roles, and an optional reason-required one-run `routingOverride` pins it to a distinct route such as `openai-codex-cgpt5/gpt-5.6-sol` at thinking `high` without changing role permissions or concurrency.

The routine `backend` tool parameter is removed from the model-visible schema, guidance, and all internal and public metadata. Its replacement is an optional exceptional `routingOverride` with `provider`, `model`, `thinking`, `excludeProviders`, and a mandatory non-empty `reason`:

- empty or no-op overrides are rejected;
- model-only overrides use the common provider selection with each provider's configured default thinking;
- provider-only overrides pin and filter the configured tiers;
- provider plus model is exact after capability validation;
- exclusions filter providers inside every tier;
- the profile override policy is enforced, and the Oracle rejects every override;
- overrides never change role permissions or concurrency; and
- the reason is only validated as non-empty, never rendered, persisted, or forwarded.

The Oracle's main-model self-review prevention stays model-id based and now reads every model reachable through the configured Oracle profile from `routing.json`; it still runs before any artifact or child process.

Fallback policy changes from a pre-tool cutoff to an operational-failure rule: `provider_failed`, `stalled`, `output_limit`, `prompt_rejected`, `invalid_result`, `invalid_stream`, `missing_report`, `child_failed`, and `spawn_failed` continue to the next route while productive-work time remains, even after tools or accepted report recovery. A catalog preflight timeout also continues while work time remains. Global work-deadline `timed_out`, `completed`, intentional `blocked`, intentional `delegate_failed`, `interrupted`, and the sanitized `cleanup_failed` proof failure stay terminal, and catalog-unavailable routes still continue. An exhausted operational chain keeps the existing safe `routes_unavailable` outcome.

The equal-share route deadline policy is superseded. One monotonic 45-minute productive-work deadline now covers catalog checks, every sequential provider attempt, tools, retries, compaction, and same-session report recovery. Every route receives the same absolute work deadline, so provider count cannot reduce working time. Operational fallback consumes only actual elapsed time and starts only while work time remains. Meaningful accepted Pi RPC activity resets the five-minute warning and ten-minute stall age, but never extends the global work deadline; empty deltas, rendering ticks, unchanged queue heartbeats, raw stderr, and malformed output do not count. Catalog preflight remains capped at 15 seconds and can advance with cause `catalog_preflight` while work time remains. Global expiry records `timed_out/work_deadline` and never falls back.

Cleanup is separate from productive work. Each stop receives at most ten seconds: up to five seconds after SIGTERM, up to three seconds to prove disappearance after SIGKILL, and two seconds for final cleanup. Catalog and supervision cleanup still require positive leader close or recorded exit plus a dead-group probe before another route starts. Negative proof records terminal `cleanup_failed` with fixed reason `group_alive` or `close_unconfirmed`. Fixed interruption sources are `delegate_stop`, `session_shutdown`, `tool_call_abort`, and `unknown`. Durable failure diagnostics use schema 5 for these causes, work and remaining budgets, active-tool count/name/elapsed time, and bounded per-attempt liveness metadata. Existing schema 3 and 4 files remain unchanged.

Because a failed attempt may already have changed the working tree, advancing after tools or accepted recovery rewrites the next route attempt's private prompt from the original assignment plus one fixed sanitized restart note: the previous route may have changed the working tree, the current state is authoritative, inspect the existing work, and do not repeat irreversible operations. The note never contains provider errors, raw output, tool payloads, reports, paths, or credentials, and rebuilding from the original assignment keeps it from stacking. A bounded restart-after-work count travels in progress, attempts, diagnostics, and rendering.

Everything else from ADR 0008 is preserved: the cumulative wall deadline, cancellation, process groups, strict RPC framing and report recovery, output bounds, privacy, diagnostic permissions, role contracts, manager IDs and concurrency, recursive suppression, and the absence of any direct Claude CLI path.

## Consequences

- Route changes are now JSON edits validated by a strict loader instead of TypeScript edits inside selector logic.
- An invalid or missing `routing.json` disables delegation entirely rather than silently falling back to stale compiled routes.
- Gate D, Solution E, and the Oracle select primaries from nine eligible Codex providers through `openai-codex-cgpt7`.
- The solution-investigation gate runs six concurrent investigators A/B/C/D/E/F; the implementation review gate runs five concurrent reviewers A/B/C/D/E. A temporary sixth reviewer reuses an existing non-exclusive review role and, when it needs a distinct route, an exact one-run `routingOverride` with no provider fallback.
- A provider failure after tool execution no longer discards the delegation; the chain advances with an explicit restart note, and the safe exhausted-chain outcome still bounds the worst case.
- Provider count no longer changes deadlines. A silent route stalls after ten minutes and can fall back with the actual remaining work time; an active route may consume the full 45-minute work budget. Cleanup uses a separate ten-second maximum and still proves the prior process group dead before fallback.
- The `zai` backend value disappears from the public schema; an explicit user or project request for that route becomes a `routingOverride` with `provider`/`model` fields.
- The model-visible guidance states that routing is automatic and the override exists only for explicit operational requests; no default route matrix is exposed to the model.
- Model identifiers, thinking levels, provider capability claims, tier allowlists, and the live catalog remain maintenance points; check each contract when Pi or the provider set changes.

## Alternatives rejected

- **Keep routes in TypeScript:** rejected because provider-set changes are policy edits that should not touch executable selector code.
- **Derive routing from `settings.json`/`models.json`:** rejected because those files describe the interactive session and provider transport, not delegation policy, and coupling would silently change delegate routes when the user switches their own model.
- **Fall back to compiled routes when the config is invalid:** rejected because silently stale routing is worse than a bounded tool error.
- **Keep the pre-tool-only fallback cutoff:** rejected because operational failures after real work were already possible, and a restart note gives the next route a safe, private way to build on that work.
- **Expose the route matrix in tool guidance:** rejected because it would tax every request and duplicate the executable config.

## Validation

1. Run the extension suite, including config validation, selector, override, Oracle, fallback, restart-note, exhaustion, cleanup, deadline, privacy, and backend-removal regressions.
2. Run strict TypeScript with unused-symbol checks against installed Pi declarations.
3. Load Pi with `--list-models` to validate extension startup without paid inference.
4. Confirm every configured route in Pi's live catalog, including `openai-codex-cgpt7/gpt-5.5` and `openai-codex-cgpt7/gpt-5.6-sol`, using no-inference `pi --list-models` commands.
5. Confirm the failure diagnostics, tool results, and rewritten prompts contain no provider errors, raw output, tool payloads, reports, paths, or credentials.
