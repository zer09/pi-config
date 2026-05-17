# Updating the Linear CLI skill

Purpose: keep `agent/skills/linear-cli` aligned with the Linear CLI upstream skill while preserving local Pi mutation gates and OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/schpet/linear-cli
- Upstream skill path: `skills/linear-cli/SKILL.md`
- Current upstream commit checked locally: `f7922d4121612ccede0b008c1101e2ec79e04a16`

## Local files

- `agent/skills/linear-cli/SKILL.md`: Linear CLI workflow.
- `agent/skills/linear-cli/SKILL.template.md`: upstream/local template if present.
- `agent/skills/linear-cli/references/`: runtime references.
- `agent/skills/linear-cli/scripts/`: runtime scripts.
- `agent/skills/linear-cli/agents/openai.yaml`: local UI metadata.

## Local safety rule

Linear is an external hosted service. Keep reads allowed, but require explicit user instruction for create, update, delete, comment, assign, label, close, reopen, or any other Linear mutation.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream with authenticated `gh` CLI through Context Mode/RTK:

```bash
rtk gh api repos/schpet/linear-cli/contents/skills/linear-cli/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill files.
4. Copy upstream runtime changes unless they weaken the local Linear mutation gate or conflict with OpenAI skill-creator rules.
5. Keep frontmatter limited to `name` and `description`.
6. Regenerate or update `agents/openai.yaml` if the skill description changes.
7. Update the upstream commit SHA in this file when source content changes.
8. Validate:

```bash
uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/linear-cli
```

9. Scan changed files for literal home paths and secret values before committing.
