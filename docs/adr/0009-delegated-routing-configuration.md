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

Fallback policy changes from a pre-tool cutoff to an operational-failure rule: `provider_failed`, `stalled`, `timed_out`, `output_limit`, `prompt_rejected`, `invalid_result`, `invalid_stream`, `missing_report`, `child_failed`, and `spawn_failed` always continue to the next route, even after tools or accepted report recovery. `completed`, intentional `blocked`, intentional `delegate_failed`, `interrupted`, and the later-added sanitized `cleanup_failed` proof failure stay terminal, and catalog-unavailable routes still continue. An exhausted operational chain keeps the existing safe `routes_unavailable` outcome.

Route attempts share one monotonic absolute cumulative wall deadline, but a non-final route never receives the whole remaining budget. Each route receives a deterministic soft share of the current remainder, divided equally across the routes still ahead, and the share covers that route's catalog preflight, supervision, and cleanup/termination; because the final route is the only route remaining, its share is the full remainder. The share is an absolute route deadline: before supervision starts, a termination budget (capped at the configured grace and half the remaining share, and never below the later-added mandatory cleanup tail of forced-kill verification plus final stderr/status/progress cleanup) is reserved out of it, so graceful termination, forced termination, and process-group cleanup all fit inside the share. Every termination is clamped to that absolute deadline, the graceful window is clamped so forced kill and its verification still fit before it, and when the graceful window cannot fit before it, termination escalates immediately to SIGKILL. The later-added one-shot soft-deadline timer enforces shares shorter than the progress interval at their own deadline, and a share that cannot fit the mandatory reserve records a soft `timed_out` without spawning. Catalog preflight termination is stored and awaited, with process-group disappearance verified through the later-added positive proof (leader close or recorded exit plus a final dead-group probe), before any outcome returns, so no route's process group ever overlaps the next route's; an unproven cleanup records the terminal sanitized `cleanup_failed` state and the chain fails closed. A non-final route that reaches its soft deadline records `timed_out` and the chain advances while cumulative time remains. A catalog preflight stopped by its share records `timed_out`, distinct from `catalog_unavailable`, which still means the route is absent from the live catalog. The chain-level `timed_out` outcome occurs only when the cumulative deadline itself is exhausted.

Because a failed attempt may already have changed the working tree, advancing after tools or accepted recovery rewrites the next route attempt's private prompt from the original assignment plus one fixed sanitized restart note: the previous route may have changed the working tree, the current state is authoritative, inspect the existing work, and do not repeat irreversible operations. The note never contains provider errors, raw output, tool payloads, reports, paths, or credentials, and rebuilding from the original assignment keeps it from stacking. A bounded restart-after-work count travels in progress, attempts, diagnostics, and rendering.

Everything else from ADR 0008 is preserved: the cumulative wall deadline, cancellation, process groups, strict RPC framing and report recovery, output bounds, privacy, diagnostic permissions, role contracts, manager IDs and concurrency, recursive suppression, and the absence of any direct Claude CLI path.

## Consequences

- Route changes are now JSON edits validated by a strict loader instead of TypeScript edits inside selector logic.
- An invalid or missing `routing.json` disables delegation entirely rather than silently falling back to stale compiled routes.
- Gate D and the Oracle select primaries from nine eligible Codex providers through `openai-codex-cgpt7`.
- The implementation review gate runs four concurrent reviewers. A temporary extra reviewer reuses an existing non-exclusive review role and, when it needs a distinct route, an exact one-run `routingOverride` with no provider fallback.
- A provider failure after tool execution no longer discards the delegation; the chain advances with an explicit restart note, and the safe exhausted-chain outcome still bounds the worst case.
- A hanging route can no longer starve the fallback chain: it is cut off at its soft share and the remaining routes keep their reserved time, with `timed_out` attempt records distinguishing budget stops from catalog absence. Cleanup is part of the budget: termination is clamped to the route's absolute deadline with immediate SIGKILL escalation when the grace cannot fit, and a stopped route's process group is verified dead before the next route starts.
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
