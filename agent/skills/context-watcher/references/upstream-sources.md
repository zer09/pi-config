# Upstream sources and maintenance

This reference tracks Context Watcher provenance, architecture, compatibility, and maintenance. Load it when updating the skill or checking source-of-truth decisions.

## Source of truth

`context-watcher` is a Custom Local Skill. Its source of truth is this Pi config, not a single upstream skill repository.

Maintenance docs:

- `../../../../docs/skills/custom-local-skills-update-process.md`
- `../../../../docs/skills/local-skill-update-invariants.md`
- `../../../../docs/skills/context-watcher-token-footprint-refactor-plan.md`

## Architecture overview

Context Watcher coordinates three token-protection layers:

1. Context Mode: sandbox execution, indexing, search, large-output protection, web fetching, and file analysis.
2. RTK Token Optimizer: command-output compression for read-only shell work.
3. Code Review Graph: structural codebase exploration, review context, impact radius, callers/callees, flows, and architecture analysis.

The intended order is:

```text
Task intent -> Context Watcher routing -> Context Mode sandbox
                                      -> RTK inside sandbox when useful
                                      -> Code Review Graph first for supported code work
```

## Compatibility notes

- Context Mode MCP tools are preferred when available.
- If MCP tools are unavailable on a platform, use the closest sandboxed equivalent with RTK compression and keep the same routing rules conceptually.
- Code Review Graph applies to supported languages only.
- Browser tools are not substitutes for authenticated `gh` CLI on private GitHub data.
- Native file tools remain required for file writes and precise edits.

## External references

- RTK Token Optimizer: use local RTK help and installed documentation. Do not guess flags.
- Context Mode: use `ctx_doctor`, `ctx_stats`, and installed Context Mode skill docs when troubleshooting.
- Code Review Graph: use MCP tool descriptions, graph stats, and `code_review_graph_get_docs_section_tool(section_name="commands")` as the source of truth for current function signatures. If schemas do not match the documented parameters, restart Pi or reinstall the configured package.
- GitHub CLI: load the local `gh-cli` skill before GitHub work.
- Context7 CLI: load the local `context7-cli` skill when Context7 usage is unclear.

## Local skill invariants

When updating this skill:

1. Preserve frontmatter with only `name` and `description`.
2. Preserve OpenAI agent metadata under `agents/openai.yaml`.
3. Preserve hosted-service mutation gates.
4. Preserve GitHub routing through `gh-cli` and authenticated `gh` through Context Mode/RTK.
5. Preserve Context Mode routing for shell commands, large output, file analysis, tests, builds, logs, and URLs.
6. Preserve RTK as the default read-only shell prefix inside Context Mode.
7. Preserve Code Review Graph first for supported code exploration/review tasks. Keep detailed MCP parameter guidance in `code-review-graph-protocol.md`.
8. Preserve worktree graph daemon/watch rules.
9. Preserve sub-agent safety and compact-output rules.
10. Prefer `uv run python <script.py>` or `uv run --with <package> python <script.py>` for Python script execution in docs.
11. Avoid realistic secret-looking values and user-specific home paths.

## Token-footprint maintenance

Keep `SKILL.md` compact and load-bearing. References may be longer, but each reference must have a visible load trigger in `SKILL.md`.

Do not move mandatory behavior only into references. An agent that loads only `SKILL.md` must still choose safe routes for shell, files, URLs, GitHub, Context7, Code Review Graph, worktrees, sub-agents, and fallback.
