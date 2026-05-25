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

## Project selection

codebase-memory-mcp indexes repositories as projects. Select the graph project by matching `root_path` to the repository or worktree repo you are working in.

Use this sequence:

1. Call `codebase_memory_mcp_list_projects`.
2. Match the active worktree repo to a project by `root_path`.
3. If a project matches, call `codebase_memory_mcp_index_status(project=...)`; if none matches, skip status and treat the project as missing.
4. Rebuild the active worktree graph with `codebase_memory_mcp_index_repository(repo_path=<worktree repo>, mode="full", persistence=false)` only when indexing is authorized and useful, and when the project is missing, status is empty/stale/incomplete/failed, the branch/worktree state changed, code was edited and graph accuracy matters, or deep/semantic graph accuracy is required. Then repeat project selection and status checks.
5. Query that project for structural code work.

Do not assume a base-repo graph represents a worktree after branch-specific edits. Re-index the worktree repo with `mode="full"` only when indexing is authorized and useful, and when branch-specific edits or changed relationships matter.

## Multi-repo feature roots

When a story or feature root contains multiple repositories:

1. Index each repository as its own codebase-memory project only when indexing is authorized and useful.
2. Use the project that matches the repo under investigation for repo-scoped work.
3. Use `index_repository(repo_path=<active repo>, mode="cross-repo-intelligence", target_projects=[...])` only when cross-repo route/channel links are authorized, useful, needed, and target projects already have fresh indexes.
4. Use `trace_path(project=..., function_name=..., mode="cross_service")` or `query_graph` over cross-service edge types only if the schema shows those edges exist.

Do not require every nested repo to be combined into one containing root. codebase-memory project boundaries are repository roots.

## Stale or incomplete graph

If project status, schema, or query results show the graph is missing, stale, empty, incomplete, or failed:

1. Do not treat that as permission to skip graph-first automatically.
2. Re-index the matching worktree repo with `mode="full"` and `persistence=false` only when indexing is authorized and useful, and when graph accuracy matters.
3. Retry the graph query.
4. Fall back to Context Mode/RTK only when needed indexing fails or graph results remain insufficient.

## Removing worktrees

When removing a worktree group:

1. Verify removal targets are inside the expected worktree tree.
2. Before any `rm -rf`, verify the path is not a symlink to somewhere outside the expected tree.
3. Never delete outside the project directory or `.pi/` without explicit user confirmation.
4. Do not call `codebase_memory_mcp_delete_project` unless the user explicitly asks to delete the local graph project.
5. If the user does request graph cleanup, list projects first and delete only the exact project whose `root_path` matches the removed worktree repo.

## Safety reminders

- Worktree creation and local branch operations are local mutations and may use whitelisted direct Bash when safe.
- Remote branch pushes still require exact explicit user instruction.
- Keep graph-first structural code behavior active inside worktrees and follow `codebase-memory-mcp-protocol.md` for MCP parameters.
