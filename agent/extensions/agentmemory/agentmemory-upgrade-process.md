# AgentMemory Pi upgrade process

This is the guide for upgrading the local Pi AgentMemory extension when upstream AgentMemory releases a new version or changes its MCP tool surface.

The goal is to keep Pi useful and safe: sync upstream compatibility deliberately, preserve local safety deltas, and never blindly expose the full upstream MCP surface.

## Scope

This process covers the local curated Pi integration in this repo:

```text
agent/extensions/agentmemory/
agent/extensions/gc-footer/
agent/extensions/delegates/
agent/settings.json
```

It does not automatically upgrade a running AgentMemory server, publish npm packages, push branches, create PRs, or mutate hosted services.

## Non-negotiable rules

- Do not replace `agent/extensions/agentmemory/index.ts` with upstream `integrations/pi/index.ts` without reapplying local Pi safety deltas.
- Do not dynamically grow the active Pi tool list from live server metadata.
- Do not default-expose destructive, broad export, synthesis, coordination, file-writing, team sharing, or workflow automation tools.
- Keep gated tools behind `AGENTMEMORY_PI_ENABLE_GATED=1` unless there is an explicit policy change.
- Preserve delegate-child behavior: `PI_DELEGATE_CHILD` must skip AgentMemory tools, hooks, and bundled skill discovery.
- Preserve headless behavior: sessions without UI must not crash.
- Preserve security behavior: `PI_AGENTMEMORY_SECURITY_ENABLED`, secret-content refusal, output redaction, and HTTPS bearer checks must remain intact.
- Preserve the bundled skill location under `agent/extensions/agentmemory/skills/agentmemory/` and expose it through `resources_discover`.
- Preserve gc-footer compatibility when AgentMemory status text changes, or update gc-footer tests in the same change.
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

Track these local files after every upgrade:

```text
agent/extensions/agentmemory/index.ts
agent/extensions/agentmemory/security.ts
agent/extensions/agentmemory/README.md
agent/extensions/agentmemory/package.json
agent/extensions/agentmemory/tool-policy.json
agent/extensions/agentmemory/skills/agentmemory/SKILL.md
agent/extensions/agentmemory/scripts/extract-upstream-tools.mjs
agent/extensions/agentmemory/scripts/check-upstream-sync.mjs
agent/extensions/gc-footer/index.ts
agent/extensions/gc-footer/test.cjs
agent/extensions/delegates/constants.ts
agent/extensions/delegates/child-process.ts
agent/extensions/delegates/toolsets.ts
agent/settings.json
```

## Upgrade workflow

### 1. Prepare a clean branch

```bash
git status --short --branch
git checkout -b chore/agentmemory-upstream-<version>
```

Stop if the worktree is dirty and the changes are unrelated.

### 2. Update the upstream checkout

In the upstream clone:

```bash
cd <agentmemory-upstream>
git fetch --tags --prune
git status --short --branch
git log --oneline -1
```

If the user explicitly asked to update the clone, pull or checkout the target tag/commit. Otherwise only inspect the current checkout.

Record:

- upstream version
- upstream commit SHA
- upstream tag, if any
- tool count from the registry

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
- local invariants are still present

Useful inspection command:

```bash
cd agent/extensions/agentmemory
node scripts/extract-upstream-tools.mjs --upstream <agentmemory-upstream>
```

### 4. Review upstream Pi integration changes

Compare upstream `integrations/pi/*` against local files, but do not copy blindly.

Keep these local deltas unless intentionally changed:

- curated tool surface instead of all upstream tools
- AgentMemory health and friendly `memory_search` local wrappers
- delegate-child skip guard
- headless UI guard
- Pi security toggle and secret safeguards
- bundled skill discovery
- footer status text shape or matching gc-footer updates

### 5. Classify tool-surface changes

If upstream adds, removes, or renames a tool, update `tool-policy.json`.

Use this policy:

| Bucket | Use when |
|---|---|
| `defaultTools` | Bounded, routine Pi memory operations. Mostly read-only. Writes are allowed only for the primary guarded durable save path. |
| `gatedTools` | Broad private reads, exports, destructive operations, healing, synthesis, consolidation, additional durable writes, or operations that mutate memory subsystem state. |
| `notExposedTools` | File rewrite/export workflows, team/share/mesh sync, optional provider workflows, coordination/task-state workflows not adopted by Pi, or surfaces overlapping better Pi tools such as handoffs or CodeGraph. |

Do not leave a new upstream tool uncategorized.

### 6. Update local files

Typical changes are:

- update `tool-policy.json` upstream metadata
- update default/gated wrapper schemas in `index.ts` only when selected upstream schemas changed
- update `README.md` when visible commands, env vars, or policy change
- update bundled `skills/agentmemory/SKILL.md` only when routing guidance changes
- update tests for changed defaults, security behavior, or wrapper schemas
- update `agent/extensions/gc-footer/test.cjs` if AgentMemory footer status text changes

Keep edits surgical. Do not reformat unrelated code.

### 7. Validate

Minimum local checks:

```bash
cd agent/extensions/agentmemory
npm test
npm run check:sync -- --upstream <agentmemory-upstream>
```

If AgentMemory status text or gc-footer integration changed:

```bash
node agent/extensions/gc-footer/test.cjs
```

If delegate exposure changed, run delegate-related tests for the touched files.

Before committing, scan staged diffs for secrets. Never commit token, key, credential, bearer, password, or private key values.

### 8. Optional live smoke

Only run live smoke checks when the local AgentMemory server is intentionally running.

Safe read-oriented checks:

```text
memory_health
memory_diagnose
memory_smart_search
memory_recall
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
2. Identify whether the failure is a new tool, removed tool, schema drift, server case drift, standalone drift, or local invariant failure.
3. Update policy, wrappers, tests, or docs as appropriate.
4. Re-run the checker.

If an upstream change conflicts with local safety rules, keep the local safety rule and document the divergence in the PR.

## Rollback

If an upgrade breaks Pi:

1. Revert the upgrade commit or branch.
2. Confirm the previous `tool-policy.json` upstream metadata.
3. Run AgentMemory tests.
4. Restart or reload Pi if extension files changed.
5. Record the failure in a handoff or follow-up plan with upstream version, commit SHA, failing check, and suspected cause.
