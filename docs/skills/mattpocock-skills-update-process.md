# Updating Matt Pocock skills

Purpose: keep the Matt Pocock-derived engineering skills aligned with upstream while preserving local Pi conventions and OpenAI skill-creator compliance.

## Source of truth

- Upstream repository: https://github.com/mattpocock/skills
- Current upstream commit checked locally: `e74f0061bb67222181640effa98c675bdb2fdaa7`

| Local skill | Upstream path | Local notes |
| --- | --- | --- |
| `grill-with-docs` | `skills/engineering/grill-with-docs` | Keeps `CONTEXT-FORMAT.md` and `ADR-FORMAT.md`; use as the replacement for deprecated ubiquitous-language workflow. |
| `improve-codebase-architecture` | `skills/engineering/improve-codebase-architecture` | Architecture deepening workflow informed by `CONTEXT.md` and ADRs. |
| `tdd` | `skills/engineering/tdd` | Red-green-refactor workflow with behavior-focused testing references. |

## Local files

- `agent/skills/grill-with-docs/`
- `agent/skills/improve-codebase-architecture/`
- `agent/skills/tdd/`
- Each skill has local `agents/openai.yaml` UI metadata.
- `docs/skills/grill-with-docs-usage.md` is local usage guidance and should remain separate from this update process.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example:

```bash
rtk gh api repos/mattpocock/skills/contents/skills/engineering/grill-with-docs/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders.
4. Copy upstream runtime changes unless they conflict with local Pi routing, mutation safety gates, or OpenAI skill-creator rules.
5. Keep every `SKILL.md` frontmatter limited to `name` and `description`.
6. Keep local maintenance pointers in each `SKILL.md` pointing to this grouped update process.
7. Keep `agents/openai.yaml` valid YAML with only UI metadata fields unless UI assets are intentionally installed.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate all Matt Pocock skills:

```bash
for skill in grill-with-docs improve-codebase-architecture tdd; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

10. Scan changed files for literal home paths and secret values before committing.

## Notes

- Do not install `skills/deprecated/ubiquitous-language` unless explicitly requested. The local convention is to use `grill-with-docs` for domain language and ADR discipline.
- Do not create placeholder ADRs. Create `docs/adr/` lazily when a real ADR-worthy decision appears.
