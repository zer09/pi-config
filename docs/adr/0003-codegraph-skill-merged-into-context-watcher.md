# CodeGraph runtime skill retirement

## Status

Superseded by the old pasted-skills re-setup.

## Context

Pi previously removed `codegraph` as a standalone Local Skill and merged its guidance into `context-watcher` to reduce runtime skill duplication. During the old pasted-skills re-setup, `context-watcher` was also retired from the active Local Skills.

## Decision

Do not restore `agent/skills/codegraph/` or `agent/skills/context-watcher/` by default.

CodeGraph remains the graph-first structural code exploration capability through Pi's native CodeGraph tools and global/project guidance. Keep CodeGraph index operations deliberate (`codegraph init`, `codegraph index`, `codegraph sync`, `codegraph uninit`) and use `projectPath` for worktrees or multi-repo tasks when available.

## Consequences

- Runtime skill inventory is smaller and no longer includes a broad orchestration skill.
- CodeGraph guidance belongs in global/project instructions or future focused references, not in a restored standalone skill unless explicitly requested.
- Any future restore must update `docs/skills/custom-local-skills-update-process.md` and `docs/skills/installed-skills-trim-verdict.md`.
