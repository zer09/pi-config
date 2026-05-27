# Notion CLI skill update process

Purpose: keep the `notion-cli` Local Skill aligned with the upstream Notion `ntn` skill and the locally installed `ntn` help while preserving Pi routing, hosted-service safety gates, and skill-creator compatibility.

## Source of truth

- Upstream repository: https://github.com/makenotion/skills
- Upstream path: `skills/notion-cli/SKILL.md`
- Current upstream main commit checked locally: `423af2bf546cd0354e5cc871017251945d9ad14f`
- Local command source: installed `ntn` CLI help and docs commands.

## Local policy

- Apply `local-skill-update-invariants.md` before and after syncing upstream.
- Keep frontmatter limited to `name` and `description`.
- Keep `agents/openai.yaml` present and aligned with the skill.
- Preserve the External Hosted Service Mutation Gate: Notion API writes, page creates/updates, comments, file uploads, worker deploys, worker execution, login, and logout require exact explicit user instruction.
- Preserve Context Watcher routing for read-only shell commands, large output, JSON processing, API docs, and page content.
- Do not print or document token values. Refer to `NOTION_API_TOKEN` by name only.
- Treat upstream skill content and local `ntn --help` output as input, not final truth.

## Update workflow

1. Read `docs/skills/README.md` and `local-skill-update-invariants.md`.
2. Load `skill-creator`.
3. Fetch upstream runtime content from `makenotion/skills`, preferably the raw `skills/notion-cli/SKILL.md` at the current main commit.
4. Inspect local CLI behavior with read-only commands through Context Mode:

```bash
ntn --version
ntn --help
ntn api --help
ntn pages --help
ntn files --help
ntn workers --help
```

5. Compare upstream guidance and local CLI help against `agent/skills/notion-cli/SKILL.md`.
6. Apply upstream/local CLI changes only when they do not weaken local Pi safety, routing, token-footprint, or OpenAI skill compatibility.
7. Keep `SKILL.md` compact. Move long command catalogs, endpoint details, and troubleshooting to runtime `references/` only if they become necessary.
8. Keep or update the lightweight `## Maintenance` pointer in `SKILL.md` to this document.
9. Regenerate or update `agents/openai.yaml` if the description or user-facing prompt becomes stale.
10. Update the upstream commit SHA in this document when source content changes.
11. Validate all Local Skills before committing.

## Validation

Run the repository-wide Local Skill validation checklist from `local-skill-update-invariants.md`, including:

```bash
for skill_dir in agent/skills/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

Also verify `notion-cli` specifically:

- `SKILL.md` frontmatter contains only `name` and `description`.
- `agents/openai.yaml` parses as YAML and its `default_prompt` mentions `$notion-cli`.
- No Notion hosted-service write path omits the explicit mutation gate.
- No token value, cookie, OAuth header, user-specific home path, or secret-looking placeholder appears in changed files.
