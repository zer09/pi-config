# Updating the Context7 CLI skill

Purpose: keep `agent/skills/context7-cli` aligned with the Context7 upstream skill while preserving local OpenAI skill-creator conventions.

## Source of truth

- Upstream repository: https://github.com/upstash/context7
- Upstream skill path: `skills/context7-cli/SKILL.md`
- Current upstream commit checked locally: `61de754d48e55e97ae508345c627b7ced5b7d21e`

## Local files

- `agent/skills/context7-cli/SKILL.md`: Context7 CLI workflow.
- `agent/skills/context7-cli/references/`: runtime references.
- `agent/skills/context7-cli/agents/openai.yaml`: local UI metadata.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream with authenticated `gh` CLI through Context Mode/RTK:

```bash
rtk gh api repos/upstash/context7/contents/skills/context7-cli/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill files.
4. Copy upstream runtime changes unless they conflict with local Pi routing, mutation safety gates, or OpenAI skill-creator rules.
5. Keep frontmatter limited to `name` and `description`.
6. Keep placeholder secrets as placeholders such as `<api-key>`, never realistic token examples.
7. Regenerate or update `agents/openai.yaml` if the skill description changes.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate:

```bash
uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/context7-cli
```

10. Scan changed files for literal home paths and secret values before committing.
