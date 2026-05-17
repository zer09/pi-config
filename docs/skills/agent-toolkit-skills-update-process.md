# Updating agent-toolkit skills

Purpose: keep the skills imported from `softaworks/agent-toolkit` aligned with upstream while preserving local OpenAI skill-creator conventions.

## Source of truth

- Upstream repository: https://github.com/softaworks/agent-toolkit
- Current upstream commit checked locally: `3027f20f31816a7c66e5290c0bc62e9294c8d974`

| Local skill | Upstream path |
| --- | --- |
| `session-handoff` | `skills/session-handoff/SKILL.md` plus runtime resources |
| `humanizer` | `skills/humanizer/SKILL.md` |

Prefer the `skills/` source paths over generated `dist/plugins/...` copies.

## Local files

- `agent/skills/session-handoff/`: handoff workflow, references, and scripts.
- `agent/skills/humanizer/`: AI-writing cleanup workflow.
- Each skill has local `agents/openai.yaml` UI metadata.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example:

```bash
rtk gh api repos/softaworks/agent-toolkit/contents/skills/session-handoff/SKILL.md?ref=main
rtk gh api repos/softaworks/agent-toolkit/contents/skills/humanizer/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders.
4. Copy upstream runtime changes unless they conflict with local Pi routing, mutation safety gates, or OpenAI skill-creator rules.
5. Keep all `SKILL.md` frontmatter limited to `name` and `description`.
6. Preserve local scripts and references that are required by the skill.
7. Regenerate or update `agents/openai.yaml` if a skill description changes.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate both skills:

```bash
for skill in session-handoff humanizer; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

10. Scan changed files for literal home paths and secret values before committing.
