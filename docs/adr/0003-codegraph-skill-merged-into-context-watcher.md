# CodeGraph skill merged into Context Watcher

Pi no longer keeps `codegraph` as a standalone Local Skill. CodeGraph remains the graph-first structural code exploration capability, but Context Watcher owns its runtime routing, MCP/CLI fallback rules, worktree project-path guidance, and token-efficiency constraints. This avoids loading two overlapping runtime skills while preserving CodeGraph quality through Context Watcher's compact `SKILL.md` and detailed CodeGraph Runtime Reference.
