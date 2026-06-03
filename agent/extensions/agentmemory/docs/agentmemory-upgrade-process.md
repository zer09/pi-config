# AgentMemory Pi upgrade process

This document is the source of truth for upgrading this repository's Pi-native AgentMemory extension when upstream AgentMemory releases a new version or changes its MCP, CLI, REST, or Pi integration surface.

In this repository, `agent/extensions/agentmemory/` is a Pi-native extension that wraps the upstream AgentMemory server with a curated tool surface, safety gates, status hooks, and a bundled Pi skill. It is not the upstream AgentMemory project itself.

Use this guide before changing `agent/extensions/agentmemory/`. For the architecture rationale behind the curated Pi-native extension, see `docs/adr/0001-curated-pi-agentmemory-extension.md`.

## Goal

Keep the Pi integration useful, safe, and compatible with upstream AgentMemory without importing the entire upstream MCP surface into every Pi session.

An upgrade is successful when:

- upstream changes are inspected against a known clone and commit
- every upstream MCP tool remains categorized in local policy
- local wrappers still match selected upstream schemas
- local Pi safety deltas are preserved
- tests and sync checks pass
- docs and skill guidance stay aligned with the actual tool surface

## Scope

This process covers this Pi-native AgentMemory extension:

```text
agent/extensions/agentmemory/
```

It does not automatically upgrade a running AgentMemory server, publish packages, push branches, create PRs, comment on GitHub, or mutate hosted services.

## Required local posture

- Treat `src/mcp/tools-registry.ts` in upstream AgentMemory as the MCP source of truth.
- Treat `agent/extensions/agentmemory/tool-policy.json` as the local source of truth for what Pi exposes, gates, or excludes.
- Treat this document as the upgrade operator guide.
- Treat `docs/adr/0001-curated-pi-agentmemory-extension.md` as the rationale for the curated Pi-native architecture.

## Non-negotiable rules

- Do not replace `agent/extensions/agentmemory/index.ts` with upstream `integrations/pi/index.ts` without reapplying local Pi safety deltas.
- Do not dynamically grow the active Pi tool list from live server metadata.
- Do not wire `agentmemory mcp --tools all` into Pi by default.
- Do not install optional external AgentMemory integration config by default; Codex, GitHub Copilot MCP, OpenCode, OpenClaw, Hermes, generic MCP, Obsidian, team/mesh, and vision/image integrations require an active client/workflow policy.
- Do not default-expose destructive, broad export, synthesis, coordination, file-writing, team sharing, or workflow automation tools.
- Keep gated tools behind `AGENTMEMORY_PI_ENABLE_GATED=1` unless there is an explicit policy change.
- Preserve delegate-child behavior: `PI_DELEGATE_CHILD` must skip AgentMemory tools, hooks, and bundled skill discovery.
- Preserve headless behavior: sessions without UI must not crash.
- Preserve security behavior: `PI_AGENTMEMORY_SECURITY_ENABLED`, secret-content refusal, output redaction, and HTTPS bearer checks must remain intact.
- Preserve the bundled skill under `agent/extensions/agentmemory/skills/agentmemory/` and expose it through `resources_discover`.
- Preserve stable AgentMemory status text unless intentionally changed, and update AgentMemory tests or docs in the same change.
- Do not call gated mutating tools such as export, delete, heal, consolidate, reflect, or lesson-save during an upgrade unless the user explicitly asks for that exact operation.

## Inputs

Use an upstream AgentMemory clone. In this guide, `<agentmemory-upstream>` means the local directory where that clone is checked out.

```text
<agentmemory-upstream>
```

When documenting or sharing commands, keep the placeholder instead of a machine-specific path.

Track these upstream files on every upgrade:

```text
<agentmemory-upstream>/integrations/pi/index.ts
<agentmemory-upstream>/integrations/pi/README.md
<agentmemory-upstream>/integrations/pi/package.json
<agentmemory-upstream>/src/mcp/tools-registry.ts
<agentmemory-upstream>/src/mcp/server.ts
<agentmemory-upstream>/src/mcp/standalone.ts
<agentmemory-upstream>/src/mcp/rest-proxy.ts
<agentmemory-upstream>/src/cli.ts
<agentmemory-upstream>/README.md
<agentmemory-upstream>/plugin/skills/*/SKILL.md
```

Track these local extension files after every upgrade:

```text
agent/extensions/agentmemory/index.ts
agent/extensions/agentmemory/security.ts
agent/extensions/agentmemory/README.md
agent/extensions/agentmemory/package.json
agent/extensions/agentmemory/tool-policy.json
agent/extensions/agentmemory/skills/agentmemory/SKILL.md
agent/extensions/agentmemory/scripts/extract-upstream-tools.mjs
agent/extensions/agentmemory/scripts/check-upstream-sync.mjs
```

## Current baseline

The current local policy records this upstream baseline:

```text
upstream source: src/mcp/tools-registry.ts
last checked version: 0.9.26
last checked commit: 3e9011096184de0601550662fdbd90093f2fabca
tool count: 53
```

If the upstream clone is newer than this, run the sync workflow below and update `tool-policy.json` metadata after review.

## Tool exposure policy

### Local-only tools

These are Pi-local wrappers and are not categorized as upstream MCP tools:

```text
memory_health             - local AgentMemory REST health check
memory_search             - friendly compatibility alias for quick smart-search output
memory_mcp_resources      - read-only MCP resource listing wrapper
memory_mcp_resource_read  - read-only exact MCP resource URI wrapper
memory_mcp_prompts        - read-only MCP prompt listing wrapper
memory_mcp_prompt_get     - returns MCP prompt text for review only
```

### Default upstream-backed tools

Default tools should be bounded and routine. They are mostly read-only; the one durable write path is `memory_save`, which must keep secret-looking content guards.

```text
memory_recall
memory_save
memory_file_history
memory_patterns
memory_sessions
memory_smart_search
memory_timeline
memory_profile
memory_commit_lookup
memory_commits
memory_diagnose
memory_verify
memory_lesson_recall
memory_slot_list
memory_slot_get
```

Default wrapper rule: if upstream required fields or accepted properties change for any default tool, update the Pi wrapper and tests before marking the upgrade complete.

### Gated tools

These wrappers are registered only when `AGENTMEMORY_PI_ENABLE_GATED=1` is set. Even when registered, they still require exact user intent for destructive, mutating, or broad-private operations. High-risk wrappers use local-only `confirm` fields that are validated and stripped before forwarding to upstream AgentMemory.

```text
memory_export              - broad private memory export
memory_consolidate         - mutates or reclassifies memory state
memory_audit               - broad private operation history
memory_governance_delete   - destructive memory deletion
memory_heal                - mutates memory subsystem state
memory_lesson_save         - additional durable write path
memory_reflect             - synthesizes higher-order memories or insights
memory_insight_list        - broad insight inspection coupled to reflection workflows
memory_slot_create         - creates named editable persistent memory state
memory_slot_append         - mutates named editable persistent memory state
memory_slot_replace        - overwrites named editable persistent memory state
memory_slot_delete         - deletes named persistent memory state
```

Confirmation phrases currently enforced in `index.ts`:

```text
memory_export              confirm="export agentmemory"
memory_heal                confirm="heal agentmemory" unless dryRun is true
memory_governance_delete   confirm="delete memories:<comma-separated sorted ids>"
memory_slot_create         confirm="create slot:<label>"
memory_slot_append         confirm="append slot:<label>"
memory_slot_replace        confirm="replace slot:<label>"
memory_slot_delete         confirm="delete slot:<label>"
```

### Not exposed tools

Tools stay not exposed when they rewrite files, export content to files, require optional providers, assume team/mesh workflows, mutate coordination/task state not adopted by Pi, or overlap with better Pi systems such as plans, handoffs, Context Mode, or CodeGraph.

Workflow/task-state tools are default-deny by ADR 0004 (`docs/adr/0004-agentmemory-workflow-state-policy.md`). Do not move action, frontier, lease, signal, checkpoint, sentinel, routine, sketch, or crystallize tools into default or gated exposure unless a future ADR explicitly adopts AgentMemory for that workflow role.

External integrations are default-deny by ADR 0005 (`docs/adr/0005-agentmemory-external-integrations-policy.md`). Keep Claude bridge sync, vision search, team sharing/feed, mesh sync, Obsidian export, generic MCP registration, and other optional external integration config out of the default Pi setup until an active client/workflow policy adopts them.

Current not-exposed tools:

```text
memory_compress_file
memory_vision_search
memory_relations
memory_claude_bridge_sync
memory_graph_query
memory_team_share
memory_team_feed
memory_snapshot_create
memory_action_create
memory_action_update
memory_frontier
memory_next
memory_lease
memory_routine_run
memory_signal_send
memory_signal_read
memory_checkpoint
memory_mesh_sync
memory_sentinel_create
memory_sentinel_trigger
memory_sketch_create
memory_sketch_promote
memory_crystallize
memory_facet_tag
memory_facet_query
memory_obsidian_export
```

If upstream adds a tool, classify it into exactly one bucket before completing the upgrade. Do not leave a new upstream tool uncategorized.

## Local invariants

`tool-policy.json` lists local invariants that `check-upstream-sync.mjs` must verify. Upgrade work must preserve these behaviors:

```text
delegate-child-disabled
headless-ui-guard
https-bearer-guard
secret-content-guard
mcp-call-endpoint
gated-env-default-off
local-confirm-strip
workflow-state-default-deny
external-integration-default-deny
bundled-skill-discovery
status-output-shape
```

Meaning:

- delegate child sessions do not register AgentMemory tools, hooks, or bundled skills
- headless sessions do not crash when status UI is absent
- bearer credentials are not silently sent over non-loopback plaintext HTTP
- durable memory writes reject obvious secret-looking content
- curated MCP-compatible wrappers use the upstream MCP REST bridge
- gated AgentMemory wrappers stay default-off behind `AGENTMEMORY_PI_ENABLE_GATED=1`
- local confirmation fields are stripped before forwarding to upstream AgentMemory
- AgentMemory workflow/task-state tools stay not exposed unless a future ADR adopts that role
- AgentMemory external integration tools and config stay not exposed or uninstalled unless an active client/workflow policy adopts them
- the AgentMemory skill stays bundled beside the extension
- AgentMemory status text shape remains stable unless intentionally changed

## Upgrade workflow

### 1. Prepare a clean branch

```bash
git status --short --branch
git checkout -b chore/agentmemory-upstream-<version>
```

Stop if the worktree is dirty and the changes are unrelated.

### 2. Update the upstream clone first

Before reviewing AgentMemory changes, make sure the local upstream clone is current. In the upstream clone:

```bash
cd <agentmemory-upstream>
git status --short --branch
git fetch --tags --prune
git pull --ff-only
git log --oneline -1
```

Only run `git pull --ff-only` when the clone is on a branch with a configured upstream and the worktree is clean. If the clone is dirty, detached, pinned to a specific tag/commit, or intentionally not meant to move, stop and record that state before running the sync checker.

Record:

- upstream version
- upstream commit SHA
- upstream tag, if any
- registry tool count
- server case count
- standalone fallback implemented count

### 3. Run the sync checker

From this repo:

```bash
cd agent/extensions/agentmemory
npm run check:sync -- --upstream <agentmemory-upstream>
```

The checker should report whether:

- every upstream MCP tool is categorized in exactly one local policy bucket
- local default wrapper required fields match upstream schemas
- upstream registry and server case counts drifted
- upstream standalone fallback support changed
- upstream `integrations/pi/index.ts` drift is summarized
- local invariants are still present

Useful inspection command:

```bash
cd agent/extensions/agentmemory
node scripts/extract-upstream-tools.mjs --upstream <agentmemory-upstream>
```

The extractor should make it easy to inspect:

- tool names
- descriptions
- required fields
- property names/types/descriptions
- essential/core set
- registry group name
- registry count
- implemented `case` count from `src/mcp/server.ts`
- standalone fallback implemented count from `src/mcp/standalone.ts`

### 4. Review upstream Pi integration changes

Compare upstream `integrations/pi/*` against local files, but do not copy blindly.

Keep these local deltas unless intentionally changed:

- curated tool surface instead of all upstream tools
- AgentMemory health and friendly `memory_search` local wrappers
- delegate-child skip guard
- headless UI guard
- Pi security toggle and secret safeguards
- bundled skill discovery
- AgentMemory status text shape and matching tests/docs

If upstream ships a Pi-specific skill, compare it with the bundled local skill and preserve local safety additions.

### 5. Review MCP, REST, and CLI drift

Inspect these surfaces when the checker reports drift or upstream release notes mention them:

```text
GET  /agentmemory/mcp/tools
POST /agentmemory/mcp/call
GET  /agentmemory/mcp/resources
POST /agentmemory/mcp/resources/read
GET  /agentmemory/mcp/prompts
POST /agentmemory/mcp/prompts/get
```

For CLI/docs drift, verify any public tool counts or help text against `src/mcp/tools-registry.ts` rather than copying stale README counts.

### 6. Update local files

Typical changes are:

- update `tool-policy.json` upstream metadata
- update `tool-policy.json` buckets for added/removed/renamed tools
- update default/gated wrapper schemas in `index.ts` only when selected upstream schemas changed
- update `security.ts` only when preserving or strengthening local safety behavior
- update `README.md` when visible commands, env vars, docs paths, or policy change
- update bundled `skills/agentmemory/SKILL.md` only when routing guidance changes
- update tests for changed defaults, security behavior, wrapper schemas, skill discovery, or status text

Keep edits surgical. Do not reformat unrelated code.

### 7. Validate

Minimum local checks:

```bash
cd agent/extensions/agentmemory
npm test
npm run check:sync -- --upstream <agentmemory-upstream>
```

If child-session behavior changed, run the AgentMemory tests that cover `PI_DELEGATE_CHILD`.

Before committing, scan staged diffs for secrets. Never commit token, key, credential, bearer, password, or private key values.

### 8. Optional live smoke

Only run live smoke checks when the local AgentMemory server is intentionally running.

Safe read-oriented checks:

```text
memory_health
memory_diagnose
memory_smart_search
memory_recall
memory_sessions
```

Optional REST smoke checks, still read-oriented:

```text
GET  /agentmemory/health
GET  /agentmemory/mcp/tools
POST /agentmemory/mcp/call memory_smart_search
POST /agentmemory/mcp/call memory_sessions
POST /agentmemory/mcp/call memory_diagnose
```

Do not run gated write/export/delete/heal/consolidate/reflect operations as smoke tests unless the user explicitly requested that exact operation.

### 9. Commit and PR checklist

Commit message examples:

```text
chore(agentmemory): sync upstream tool policy to <version>
fix(agentmemory): preserve pi guards after upstream sync
```

PR body should include:

- upstream version and commit SHA
- tool count before and after
- policy changes by bucket
- preserved local invariants
- tests run
- any live smoke checks run, or why none were run

Hosted-service writes such as push, PR creation, comments, and reviews still require explicit user authorization.

## Failure handling

If `check:sync` fails:

1. Do not bypass it.
2. Identify whether the failure is a new tool, removed tool, schema drift, server case drift, standalone drift, docs/count drift, or local invariant failure.
3. Update policy, wrappers, tests, or docs as appropriate.
4. Re-run the checker.

Expected handling:

```text
new upstream tool -> fail until categorized in tool-policy.json
required field change for default tool -> fail until wrapper reviewed
count drift -> warn or fail depending on severity
missing server case -> fail
local invariant missing -> fail until safety behavior restored or policy explicitly changed
```

If an upstream change conflicts with local safety rules, keep the local safety rule and document the divergence in the PR.

## Rollback

If an upgrade breaks Pi:

1. Revert the upgrade commit or branch.
2. Confirm the previous `tool-policy.json` upstream metadata.
3. Run AgentMemory tests.
4. Restart or reload Pi if extension files changed.
5. Record the failure in a handoff or follow-up issue with upstream version, commit SHA, failing check, and suspected cause.
