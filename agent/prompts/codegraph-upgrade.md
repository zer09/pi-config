---
description: Investigate upgrade path for the custom Pi CodeGraph extension dependency
argument-hint: "[upstream-clone-path]"
---

We need to upgrade the CodeGraph dependency used by our custom Pi extension at:

  ~/.pi/agent/extensions/codegraph/

The upstream CodeGraph repository is:

  https://github.com/colbymchenry/codegraph

The local upstream clone is:

  ${1:-~/development/codegraph/}

Before making any changes, do a read-only investigation of the upgrade path.

Read this project context first, if present:

  ~/.pi/docs/
  ~/.pi/docs/adr/
  ~/.pi/docs/skills/

Then inspect the custom extension:

  ~/.pi/agent/extensions/codegraph/

Important:

- This is an upgrade investigation prompt.
- Do not hard-code or assume the currently installed CodeGraph version.
- Discover the current dependency version from the extension's package metadata and lockfile.
- Discover the target upstream version/state from the local upstream clone.
- Treat CodeGraph as a dependency of our custom extension.

Tasks:

1. Determine the current dependency state:
   - package manager and lockfile
   - currently pinned/resolved CodeGraph dependency
   - installed package metadata
   - runtime module-loading assumptions
   - public CodeGraph APIs/types imported or called by the extension

2. Inspect the local upstream clone and determine:
   - current branch and commit
   - package version
   - latest local tag/version
   - exported public API
   - CLI/package entrypoints
   - build/runtime requirements
   - changelog, migration notes, docs, or ADRs relevant to upgrading

3. Compare the extension's current usage against the target CodeGraph API:
   - changed exports/import paths
   - changed static methods or constructors
   - changed instance methods
   - changed return types
   - changed node/file/search types
   - changed config/index/database behavior
   - changed sync/index/reindex semantics
   - changed CLI behavior referenced by user-facing messages
   - dependency/build/runtime changes

4. Pay special attention to:
   - `codegraph-package.ts`
   - `graph-manager.ts`
   - `types.ts`
   - `source-files.ts`
   - `symbol-search.ts`
   - files under `tools/`
   - `package.json`
   - lockfile
   - `README.md`

5. Recommend the safest upgrade path:
   - dependency bump only
   - dependency bump plus adapter changes
   - staged upgrade through intermediate versions
   - local patch/fork requirement
   - defer upgrade due to incompatibility

6. Produce an implementation-ready plan:
   - files likely to change
   - exact migration steps
   - validation commands
   - expected risks
   - rollback strategy
   - open questions

Constraints:

- Investigation only.
- Do not edit, create, delete, stage, commit, or push files.
- Do not run destructive commands.
- Do not fetch or update the local upstream clone unless I approve it.
- If the local upstream clone may be stale, report that clearly.
- Use `~` paths in the report.

Deliverable:

A structured report with:

- Summary
- Current dependency state
- Current extension API usage
- Upstream CodeGraph state
- Compatibility findings
- Recommended upgrade path
- Files likely to change
- Validation checklist
- Rollback plan
- Open questions
