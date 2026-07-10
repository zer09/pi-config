---
description: Audit and upgrade the custom Pi CodeGraph extension and CLI to the latest published release
argument-hint: "[upstream-clone-path]"
---

Upgrade CodeGraph for this Pi configuration.

Custom Pi extension:

  ~/.pi/agent/extensions/codegraph/

Upstream repository:

  https://github.com/colbymchenry/codegraph

Local upstream clone:

  ${1:-~/development/codegraph/}

This prompt authorizes the CodeGraph-specific local changes required for the upgrade: fetching upstream Git refs/tags, updating the installed CodeGraph CLI when outdated, updating the extension dependency/lockfile, making necessary adapter changes, updating extension documentation, and running validation. It does not authorize commits, pushes, destructive Git operations, or unrelated changes.

Read this project context first, if present:

  ~/.pi/docs/
  ~/.pi/docs/adr/
  ~/.pi/docs/skills/

Then inspect:

  ~/.pi/agent/extensions/codegraph/

## Source-of-truth rules

- This is an upgrade execution prompt, not only an investigation prompt.
- Do not hard-code or assume the currently installed, declared, or target CodeGraph version.
- Discover the extension's current version from `package.json`, the lockfile, and installed package metadata.
- Always refresh upstream metadata before choosing a target:
  - run `git fetch origin --tags --prune` in the local upstream clone;
  - inspect fetched `origin/main` and fetched tags;
  - do not rely on the clone's pre-fetch worktree `HEAD` or pre-fetch local tags;
  - do not merge, reset, pull, or check out the upstream worktree merely to inspect a fetched tag.
- Query the current published npm version/dist-tag for `@colbymchenry/codegraph`.
- Query the latest stable GitHub release with authenticated `gh`.
- Check the installed CLI with `codegraph --version` and the CLI's update check when available.
- The dependency target is the latest stable version that is published on npm and has a matching fetched upstream release tag. Inspect that exact tag, even if the local worktree branch is behind it.
- If npm, the fetched tag, and the latest stable GitHub release disagree, stop before upgrading and report the release mismatch.
- Treat CodeGraph as a dependency of the custom extension. Do not replace the extension with MCP or upstream installer configuration.

## Phase 1: read-only audit

Before changing the extension or CLI, determine:

1. Current dependency state:
   - package manager and lockfile
   - declared, locked, and installed CodeGraph versions
   - installed platform bundle metadata
   - runtime module-loading assumptions
   - public CodeGraph APIs/types imported or called by the extension

2. Fresh upstream target state:
   - fetched `origin/main` commit
   - exact target tag and commit
   - target package version
   - npm latest version/dist-tag
   - latest stable GitHub release
   - exported public API
   - CLI/package entrypoints
   - build/runtime requirements
   - changelog, migration notes, docs, or ADRs relevant to the current-to-target range

3. Compatibility:
   - changed exports/import paths
   - changed static methods or constructors
   - changed instance methods
   - changed return types
   - changed node/file/search types and enums
   - changed config/index/database and schema behavior
   - changed sync/index/reindex semantics
   - changed CLI behavior referenced by user-facing messages
   - dependency/build/runtime changes
   - newly available public health/completeness APIs that would materially improve the native extension

Pay special attention to:

- `codegraph-package.ts`
- `graph-manager.ts`
- `types.ts`
- `source-files.ts`
- `symbol-search.ts`
- `status-format.ts`
- files under `tools/`
- `package.json`
- lockfile
- `README.md`

## Phase 2: perform the upgrade

Unless the audit finds a release mismatch or genuine incompatibility:

1. Update the installed CodeGraph CLI to the selected target if `codegraph --version` is older.
2. Pin `@colbymchenry/codegraph` exactly to the selected target in the extension and update its npm lockfile/install.
3. Make the smallest adapter changes required by the target API.
4. Adopt additive public APIs when they materially improve correctness or health reporting. In particular, evaluate index completeness state and interrupted-reference healing; do not ignore them merely because the old adapter still compiles.
5. Update stale extension documentation and versioned command examples. Prefer `<version>` placeholders in maintenance examples so the README does not later recommend a downgrade.
6. Preserve package-root-only CodeGraph imports and the existing native Pi tool surface unless upstream compatibility requires otherwise.
7. Keep all changes unstaged. Do not commit or push.

Do not use staged intermediate versions unless upstream migration requirements make that necessary. Do not add a fork or local patch unless the public target package cannot support the extension safely.

## Validation

Validate inside the current WSL/Linux x64 environment only; Windows, native Linux outside WSL, and macOS validation are out of scope unless separately requested.

At minimum:

- confirm manifest, lockfile, installed SDK package, installed platform bundle, npm latest, fetched target tag, GitHub release, and CLI all agree on the target version;
- run `npm ls` for the extension;
- run a clean npm install from the lockfile when safe;
- verify required root exports through `require("@colbymchenry/codegraph")`;
- build the extension with Pi host imports externalized;
- load the extension through Pi's actual loader/RPC mode without a paid model request;
- reload/restart Pi when needed;
- smoke-test `codegraph_status`, `codegraph_search`, `codegraph_node`, `codegraph_explore`, callers/callees, impact, and files;
- verify status/completeness reporting and query-time sync behavior on an existing safe index;
- inspect the final diff and confirm no unrelated files or secrets were introduced.

Do not create or rebuild disposable CodeGraph indexes in unsafe roots. Ask before running a full reindex of an existing project unless the user explicitly requested that mutation.

## Rollback

Before implementation, identify the pre-upgrade manifest/lockfile state and any database migration risk. The rollback plan must cover:

- restoring `package.json`, lockfile, adapter files, and README;
- reinstalling from the restored lockfile;
- restoring the previous CLI version if it was changed;
- restarting Pi;
- restoring or rebuilding project `.codegraph` databases if the new SDK performed a non-backward-compatible migration.

## Deliverable

Provide a concise structured report containing:

- Summary
- Previous and target versions
- Fresh upstream/npm/GitHub/CLI evidence
- Compatibility findings
- Changes made
- Completeness/healing decision
- Validation results
- Risks and caveats
- Rollback plan
- Open questions

Use `~` paths in the report. Clearly distinguish the fetched upstream target from the local clone's checked-out worktree state.
