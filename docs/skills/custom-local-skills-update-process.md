# Custom local skills update process

Use this Skill Maintenance Doc for Custom Local Skills whose source of truth is this Pi Config rather than a single Upstream Skill.

Current scope:

- `context-watcher`
- `codegraph`
- Any new custom Local Skill with no dedicated upstream source

Retired custom skills:

- `edge-case-analysis`: removed during the skill slimming pass because the base model can perform this generic reasoning workflow without a runtime skill.
- `codebase-memory-mcp`: replaced by `codegraph` as the graph-first structural code exploration layer. See `../adr/0002-codegraph-replaces-codebase-memory-mcp.md`.

## Update workflow

1. Read `local-skill-update-invariants.md` first.
2. Read `CONTEXT.md` and preserve the repo vocabulary for Local Skill, Custom Local Skill, Runtime Reference, Context Watcher, and External Hosted Service Mutation Gate.
3. Treat upstream articles, generated output, or external examples as input only. Do not copy them blindly into a custom Local Skill.
4. Keep `SKILL.md` focused on runtime behavior. Move long examples, command catalogs, troubleshooting, and evaluation notes into `references/` or long-lived docs under `docs/skills/`.
5. Preserve `agents/openai.yaml` and regenerate it only when the skill description or user-facing prompt becomes stale.
6. Add or keep a lightweight `## Maintenance` pointer in `SKILL.md` back to this document.
7. Validate every Local Skill after changes.

## Context Watcher rules

`context-watcher` is foundational infrastructure. Refactor it only in a dedicated, reviewed pass.

When updating it:

- Preserve Context Mode, RTK, and CodeGraph routing rules.
- Preserve the external hosted service mutation gate.
- Preserve the GitHub CLI preflight and private GitHub data routing.
- Preserve graph-first structural exploration and worktree project path/index lifecycle rules.
- Preserve the rule that large output and file analysis must stay in Context Mode.
- Avoid broad rewrites unless the user explicitly asks for a token-footprint reduction pass.

## CodeGraph rules

When updating `codegraph`:

- Verify the current CodeGraph CLI and MCP tool inventory before changing examples.
- Preserve Pi-specific MCP server naming: `codegraph` with command `codegraph serve --mcp`.
- Preserve the use of optional `projectPath` for worktrees, multi-repo tasks, and repos outside the session root.
- Preserve Context Watcher routing for shell work, large output, source edits, and explicit grep/search fallbacks.
- Keep local index operations deliberate: `codegraph init`, `codegraph index`, `codegraph sync`, and `codegraph uninit` must not be hidden side effects.
- Keep `.codegraph/` ignored in repositories where CodeGraph indexes are initialized.
- Remove stale examples that describe tool parameters not present in the current MCP schema.

## Validation

Run the same validation checklist used for all Local Skills:

```bash
for skill_dir in agent/skills/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Also verify:

- All `SKILL.md` frontmatter contains only `name` and `description`.
- All Local Skills have `agents/openai.yaml`.
- All `agents/openai.yaml` files parse as YAML.
- No new hosted-service write paths omit the External Hosted Service Mutation Gate.
- No user-specific home paths or realistic secret-looking values are introduced.
