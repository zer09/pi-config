# Notion skill update process

Status: active Local Skill, classified `make it slim`.

## Purpose and local shape

The installed `notion` skill combines two official Notion sources:

- `makenotion/skills`: current `ntn` CLI discovery, authentication, pages, data sources, files, API, and workers guidance.
- `makenotion/claude-code-notion-plugin`: knowledge capture, workspace research, meeting preparation, spec/task tracking, task-board operation, and code-change documentation workflows.

`SKILL.md` remains a compact runtime router with hosted-service safety gates. Higher-level workflows live in `references/workflows.md` and load only when needed. Do not restore the plugin's duplicated tutorials, Claude-specific command names, unavailable reference links, or mandatory polling behavior.

The narrower historical `notion-cli` skill remains retired; see `notion-cli-update-process.md`.

## Sources of truth

- CLI repository: https://github.com/makenotion/skills
- CLI runtime path: `skills/notion-cli/SKILL.md`
- Last CLI commit integrated: `423af2bf546cd0354e5cc871017251945d9ad14f`
- Workflow repository: https://github.com/makenotion/claude-code-notion-plugin
- Workflow paths: `skills/notion/*/SKILL.md` and `commands/**/*.md`
- Last workflow commit integrated: `9847f2aa1a15f25df35ed1fb7b4557dbb60cd651`
- Runtime command source: installed `ntn --help` and subcommand help (`ntn 0.19.0` when installed).

## Update workflow

1. Read `docs/skills/README.md`, `local-skill-update-invariants.md`, and `skill-slimming-process.md`.
2. Fetch both upstream repositories or update existing local clones. Record the compared commit hashes here.
3. Compare the source paths above with `agent/skills/notion/`.
4. Inspect current local behavior with Context Mode: `ntn --version`, `ntn --help`, and help for changed subcommands. Use `ntn api <path> --spec` only for endpoint details needed by runtime instructions.
5. Keep exact CLI discovery, authentication, destructive-edit warnings, database/data-source distinctions, and current commands. Remove stale syntax rather than preserving compatibility prose.
6. Reconcile upstream workflow changes into `references/workflows.md`. Preserve capability while compressing repeated templates into short structures and selection rules.
7. Preserve the external hosted-service mutation gate: creating/editing/trashing pages, changing properties/comments, uploading files, deploying/executing workers, login/logout, and every other Notion write require an exact explicit user request.
8. Preserve the rule that `ntn pages edit` replaces page content: fetch first, retain unrequested content, and require confirmation before `--allow-deleting-content` or non-interactive trashing.
9. Do not print or document token values. Refer to `NOTION_API_TOKEN` by name only.
10. Keep `SKILL.md` frontmatter to `name` and `description`, retain `agents/openai.yaml`, and keep its default prompt aligned with `$notion`.
11. Update this document, `docs/skills/README.md`, and `installed-skills-trim-verdict.md` if source, classification, or runtime inventory changes.
12. Run target and all-skill validation from `local-skill-update-invariants.md`; also check links, YAML, secret/home-path scans, and generated artifacts.

## Slimming invariants

- Keep simple CRUD/search/file/worker routing in `SKILL.md` without loading workflow references.
- Keep only workflow-specific, non-obvious procedures in `references/workflows.md`.
- Prefer self-documenting CLI help over copied API schemas or command catalogs.
- Do not add scripts unless a repeated deterministic operation proves necessary.
- Do not add the hosted Notion MCP as a dependency unless Pi is deliberately configured to expose and authenticate it.
