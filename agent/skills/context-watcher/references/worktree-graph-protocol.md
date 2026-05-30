# Worktree graph protocol

This reference expands the worktree rules in `../SKILL.md`. Load it when creating, using, indexing, or removing worktrees.

## Directory layout

For multi-repo or feature work, use story-grouped roots:

```text
.worktrees/<story>/<feature-name>/<repo-name>/
```

Examples:

```text
.worktrees/google-sso/feature-a/webapp/
.worktrees/google-sso/feature-a/admin-dashboard/
.worktrees/google-sso/feature-b/core-frontend/
```

For standalone fixes, hotfixes, and issue work, use the common `issues` story:

```text
.worktrees/issues/<issue-number>/<repo-name>/
```

Examples:

```text
.worktrees/issues/1234/webapp/
.worktrees/issues/bug-login-timeout/api/
```

## Project path selection

CodeGraph indexes repositories through a local `.codegraph/` directory. Select the graph by matching `projectPath` to the repository or worktree repo you are working in.

Use this sequence:

1. Identify the active worktree repo path.
2. Run read-only `codegraph status <worktree repo>` through Context Mode, or call `codegraph_status` with `projectPath`.
3. If the repo is not initialized, ask before `codegraph init -i <worktree repo>` unless setup/indexing was explicitly requested.
4. Query CodeGraph with `projectPath` set to the active worktree repo.
5. If no project is available after any authorized setup/recheck, follow the degraded graph fallback.

Do not assume a base-repo graph represents a worktree after branch-specific edits. Initialize or sync the worktree repo only when graph accuracy matters and local index mutation is authorized.

## Multi-repo feature roots

When a story or feature root contains multiple repositories:

1. Check or initialize each repository as its own CodeGraph project only when indexing is authorized and useful.
2. Pass `projectPath` for the repo under investigation for repo-scoped work.
3. Use `codegraph_trace` or `codegraph_context` for cross-repo route/channel questions only when CodeGraph output shows the needed edges exist.

Do not require every nested repo to be combined into one containing root. CodeGraph project boundaries should match repository roots unless a parent root is intentionally initialized.

## Stale or incomplete graph

If status or query results show the graph is missing, stale, uninitialized, or insufficient:

1. Do not treat that as permission to skip graph-first silently.
2. Initialize, sync, or index only when local index mutation is authorized and graph accuracy matters.
3. Retry the graph query after authorized setup/sync.
4. Fall back to Context Mode/RTK only when setup is not authorized, setup fails, or graph results remain insufficient.

If CodeGraph emits a stale-file banner, read only the listed files for exact current content.

## Removing worktrees

When removing a worktree group:

1. Verify removal targets are inside the expected worktree tree.
2. Before any `rm -rf`, verify the path is not a symlink to somewhere outside the expected tree.
3. Never delete outside the project directory or `.pi/` without explicit user confirmation.
4. Do not run `codegraph uninit` unless the user explicitly asks to delete the local graph index.
5. If the user does request graph cleanup, delete only the exact `.codegraph/` index for the matching worktree repo.

## Safety reminders

- Worktree creation and local branch operations are local mutations and may use whitelisted direct Bash when safe.
- Remote branch pushes still require exact explicit user instruction.
- Keep graph-first structural code behavior active inside worktrees and follow `codegraph-protocol.md` for MCP parameters.
