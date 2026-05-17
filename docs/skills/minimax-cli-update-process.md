# Updating the MiniMax CLI skill

Purpose: keep `agent/skills/mmx-cli` aligned with the MiniMax CLI upstream skill while preserving local OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/MiniMax-AI/cli
- Upstream skill path: `skill/SKILL.md`
- Current upstream commit checked locally: `a6b93ba03cfaeaa19e733b45b17422af0503e541`

## Local files

- `agent/skills/mmx-cli/SKILL.md`: MiniMax CLI usage workflow.
- `agent/skills/mmx-cli/agents/openai.yaml`: local UI metadata.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream with authenticated `gh` CLI through Context Mode/RTK:

```bash
rtk gh api repos/MiniMax-AI/cli/contents/skill/SKILL.md?ref=main
```

3. Compare upstream with local `SKILL.md`.
4. Copy upstream runtime changes unless they conflict with local Pi routing, mutation safety gates, or OpenAI skill-creator rules.
5. Keep frontmatter limited to `name` and `description`.
6. Keep placeholder secrets as placeholders such as `<api-key>`, never realistic token examples.
7. Regenerate or update `agents/openai.yaml` if the skill description changes.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate:

```bash
uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/mmx-cli
```

10. Scan changed files for literal home paths and secret values before committing.
