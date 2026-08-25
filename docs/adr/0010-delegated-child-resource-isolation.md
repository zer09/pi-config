# ADR 0010: Isolate delegated child resources behind a strict extension-owned policy

## Status

Accepted (2026-08-25). Supersedes the inherited extension and skill discovery for delegated children that ADR 0008 documented; every other supervision, routing, privacy, and concurrency decision from ADR 0007 through ADR 0009 stands.

## Context

Every delegated child Pi process previously started with only mode, session, trust, provider, model, and thinking flags. Without resource-discovery flags, each child inherited global extensions, configured package extensions, approved project extensions, global and project skills, prompt templates, and themes.

That inheritance wasted repeated child context. Each of the many fresh solution, implementation, review, verification, and remediation children paid for:

- 38 `browser_*` tool schemas from `pi-browser-harness` even though delegated role contracts never use browser automation;
- `recall` and other package tool schemas unrelated to delegated roles;
- the complete 34-skill catalog descriptions even though a delegate needs at most a task-relevant few;
- prompt-template and theme discovery that RPC delegates never use.

Measured with a no-inference real-Pi RPC probe (see `docs/config-context-cost.md`), the inherited child started with 56 active tools (54,001 serialized tool-definition bytes, 11,835 local `o200k_base` tokens) and 34 skill catalog descriptions (9,865 characters, 2,149 tokens). The lean profile below starts with 17 tools (19,506 bytes, 4,125 tokens) and zero unselected skills.

The parent session must keep its normal extensions and the complete skill catalog. Only delegated subprocesses should receive the lean profile.

## Decision

### Versioned child resource policy

Add `agent/extensions/delegated-pi-loop/resources.json`, a versioned extension-owned policy, with a strict loader and validator in `resources.ts`. It is the single authority for which extensions and skills delegated children may load. It is not coupled to `agent/settings.json`, package configuration, or Pi core resource discovery.

The parent extension loads and strictly validates the policy when its instance starts, before registering `delegate_run`. A missing or invalid policy fails closed with a bounded startup error; there is no broad-discovery fallback and no compiled broad-resource default. The delegated-child branch of the extension runs before any policy parsing, so the child-side watchdog stays minimal. `/reload` re-runs the load with the rest of the extension runtime; there is no continuous file watch.

Validation enforces an exact document shape (`version` exactly `1`, `extensions.catalog`, `extensions.runtime`, `skills.allowed`, `skills.excluded`), unique non-blank relative paths only, regular-file entry checks, per-skill regular `SKILL.md` checks, canonical containment under the `agent/extensions` and `agent/skills` roots (symlink resolution may not escape either root, including a symlinked `SKILL.md`), no allowed/excluded overlap, and the required profile invariants below. Repeated keys are rejected in every object scope through object-scope-correct duplicate-aware parsing, because `JSON.parse` would silently keep the last duplicate while a flat textual scan both misses the nested `extensions.catalog`, `extensions.runtime`, `skills.allowed`, and `skills.excluded` container keys and risks false positives inside string values.

### Allowlists, not denylists

Every delegated launch disables discovery with `--no-extensions`, `--no-skills`, `--no-prompt-templates`, and `--no-themes`, then explicitly loads approved extension entry files with repeated `-e` arguments. Pi has no general extension denylist, and a denylist would silently admit every newly installed extension. The allowlist fails closed: a future package or project extension enters delegated context only through an explicit policy update.

### Model-visible versus infrastructure extensions

The runtime child profile loads exactly five extension entry files:

| Extension | Child purpose | Model-visible child context |
|---|---|---|
| `delegated-pi-loop` | Parent watchdog and recursive-tool suppression | None |
| `openai-codex-aliases` | Required `openai-codex-*` provider aliases | None |
| `web-search` | `web_search`, `fetch_contents` | Yes |
| `context-mode` | `ctx_execute_file`, `ctx_batch_execute`, `ctx_search` | Yes |
| `codegraph` | Indexed source exploration tools | Yes |

`delegated-pi-loop` inside the child keeps the parent-disappearance watchdog active and keeps recursive `delegate_run` unavailable, while adding no delegate tool schema or orchestration guidelines to child context. After canonical resolution the validator requires the runtime list to equal exactly these five canonical entry files in this exact order; extra contained entries, missing entries, reordered entries, and alternate same-directory entry files all fail closed. Focused per-directory invariants keep their detailed first-failure diagnostics ahead of that exact-profile boundary.

### Separate catalog profile

Catalog preflight needs only the live model catalog. It disables extension, skill, prompt-template, theme, and context-file discovery and loads exactly the `openai-codex-aliases` entry file, because the routed Codex alias providers come from that extension rather than Pi core. After canonical resolution the validator requires the catalog list to resolve to exactly the canonical `openai-codex-aliases/index.ts` entry; any additional, different, or reordered entry fails closed, as does every model-tool extension or the delegated child entry. Built-in providers continue to come from Pi core.

### Runtime children keep context files

Runtime children do not pass `--no-context-files`. Delegates still receive the global `agent/AGENTS.md` policy and repository `AGENTS.md`/`CLAUDE.md` project instructions, which carry safety rules more important than the additional savings. Removing context files is deliberately out of scope.

### Orchestrator-selected candidate skills

`delegate_run` gains an optional `availableSkills` array parameter whose enum is built from the validated policy allowlist:

- the field means "make these approved skills discoverable to this delegate";
- Pi's two-stage progressive disclosure stays authoritative: the child sees only selected skills' catalog names and descriptions, and full `SKILL.md` bodies load only when the delegate decides its task needs them;
- omitted or empty means no skills are discoverable;
- selection is validated and resolved before manager admission, private artifact creation, or any child spawn; a defined non-array value fails with the exact bounded error `availableSkills must be an array of skill names`, and unknown or excluded names are rejected with the name only;
- duplicate requested names collapse and paths are emitted in policy order for deterministic child prompts;
- there is no arbitrary maximum count: selecting the complete allowed set is valid;
- the extension never reads, appends, or copies selected skill content, never forces `/skill:name` expansion, and never adds forced-load instructions.

Extension selection stays fixed by the policy. There is deliberately no model-controlled `availableExtensions`.

### Fixed selection across fallback and recovery

The runner builds one immutable resource selection per delegate invocation and reuses those exact argument arrays for every sequential route attempt, catalog preflight, and same-session report-recovery round. Provider fallback never changes the child's extensions or candidate skills. If a previously validated path disappears or is replaced by a symlink that resolves outside an approved root, argument construction and every catalog or runtime spawn re-resolve canonical identity, containment, and regular-file/directory/`SKILL.md` invariants and fail closed before the child command line exists; the immutable argument arrays stay byte-for-byte identical across attempts.

### Stability and privacy preserved

Routing policy and ordering, Oracle self-review prevention, role contracts, gate concurrency and waiver rules, deadlines, idle policy, output bounds, RPC framing, report recovery, terminal markers and typed reasons, restart-after-work notes, manager IDs and targeted cancellation, diagnostics schemas and privacy exclusions, and Git/hosted-service authorization rules are unchanged. Selected skill names never enter failure diagnostics, progress, rendering, or logs. `delegateEnvironment()` is unchanged: provider credentials inherit from the parent and stale parent session metadata stays scrubbed.

### Parent and package settings unchanged

No package is uninstalled or disabled. `agent/settings.json` keeps `pi-browser-harness` and every other configured package for the parent session, which retains full discovery. The isolation is child-only.

## Consequences

- A delegated child starts with 17 active tools (4 built-ins plus 13 from the three model-visible extensions) instead of 56, and with only orchestrator-selected skill descriptions instead of all 34.
- The largest per-child reduction is the absence of `pi-browser-harness`: 38 `browser_*` tool schemas and the `pi-browser-harness` skill description disappear from every child.
- Excluded local extensions (`fastlane`, `footer`, `theme-overrides`), package extensions (`pi-blackhole`, `pi-btw`, `pi-browser-harness`, `pi-claude-bridge`, `pi-cursor`), every project-local extension, and every future extension are absent from children unless explicitly added to the policy.
- Risk accepted: excluding all project extensions also excludes project-specific safety hooks. The delegated role contract, global and project context files, process supervision, and separate mutation authorization remain the safety boundary. A future repository that requires a project safety extension in children must add it to the policy explicitly after review.
- Catalog preflight no longer exercises unrelated extensions, so an unrelated extension failure cannot spuriously fail a route catalog check; conversely, an alias extension failure now reports alias routes unavailable through the existing catalog behavior without any broad-discovery fallback.
- The `availableSkills` parameter enum adds a small one-time parent schema cost; the parent already carries the complete skill catalog and needs the exact machine-visible delegated allowlist.
- The policy adds a maintenance point: installing a new skill or extension requires an explicit `resources.json` update before delegated children can use it.

## Alternatives rejected

- **Deny selected extensions while keeping discovery:** rejected because Pi has no extension denylist and new installs would enter delegates automatically.
- **Uninstall `pi-browser-harness`:** rejected because the parent session still uses browser tools; child-only CLI isolation solves the delegate-context problem without changing global package state.
- **Give every delegate all non-excluded skills:** rejected as the default because it retains unrelated skill descriptions in every child; the orchestrator can still select the complete approved set when a task needs it.
- **Force every selected skill to load:** rejected because candidates are not requirements; forced full reads defeat progressive disclosure and can load irrelevant instructions.
- **Hard-cap selected skills:** rejected because task scope, not a fixed number, determines how many candidates are appropriate.
- **Let the model pass arbitrary skill paths:** rejected because it bypasses the approved boundary and lets project-controlled paths enter child startup.
- **Infer skills inside the extension:** rejected because keyword matching duplicates model reasoning and makes resource behavior less observable; the parent already has the complete catalog and task context.
- **Disable runtime context files:** rejected for this phase; project instructions and safety rules outweigh the savings.
- **Fall back to broad discovery when an explicit resource fails:** rejected because silent fallback negates the isolation guarantee.

## Validation

1. Extension suite including the resource-policy, duplicate-key-scope, canonical-profile identity/order, skill-selection, catalog-isolation, runtime-argv, fallback-stability, pre-spawn failure, and post-selection symlink-swap regressions.
2. Strict TypeScript with unused-symbol checks against installed Pi declarations.
3. No-inference real-Pi RPC resource probes with the production child resource arguments plus a temporary probe extension: tool names, skill names, provenance, context files, and command sources recorded to a private temporary file and deleted afterwards.
4. No-inference lean-catalog `pi --list-models` checks for every configured route.
5. Privacy and source scans plus `git diff --check`.
6. Paid inference only with separate explicit authorization.
