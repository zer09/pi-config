# Updating OpenAI skills

Purpose: keep OpenAI-derived local skills aligned with `openai/skills` while preserving local Pi routing, safety gates, and skill-creator compliance.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/openai/skills
- Current upstream commit checked locally: `c25113bf4c64c8dba6bfe61acf06051d79aa43f6`

| Local skill | Upstream path | Local notes |
| --- | --- | --- |
| `skill-creator` | `skills/.system/skill-creator` | Foundational skill. Validate this before changing other skills. |
| `gh-address-comments` | `skills/.curated/gh-address-comments` | Keep local GitHub mutation gate and use authenticated `gh` CLI through Context Mode/RTK. |
| `figma` | `skills/.curated/figma` | Lightweight Figma MCP setup and design context helper. |
| `figma-implement-design` | `skills/.curated/figma-implement-design` | Design-to-code implementation workflow. |
| `figma-create-design-system-rules` | `skills/.curated/figma-create-design-system-rules` | Project rule generation for Figma-to-code workflows. |

## Local policy

- Keep frontmatter limited to `name` and `description`.
- Keep `agents/openai.yaml` as UI metadata only.
- Do not add `disable-model-invocation: false`; false is the default.
- Keep `gh-cli-update-process.md` separate. The local `gh-cli` skill is generated from local `gh help`, not copied from OpenAI.
- Keep the local Figma set focused on design-to-code. Do not install Figma canvas-writing or generation skills such as `figma-use`, `figma-generate-design`, `figma-generate-library`, or `figma-create-new-file` unless explicitly requested.
- Figma, GitHub, and other hosted services remain read-only by default. Exact explicit user instruction is required for mutations.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example:

```bash
rtk gh api repos/openai/skills/contents/skills/.system/skill-creator/SKILL.md?ref=main
rtk gh api repos/openai/skills/contents/skills/.curated/figma/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders, including `references/`, `scripts/`, and `agents/openai.yaml` where present.
4. Copy upstream runtime changes unless they conflict with local Pi routing, hosted-service mutation gates, or OpenAI skill-creator rules.
5. Keep local maintenance pointers in each `SKILL.md` pointing to this grouped update process.
6. Regenerate or update `agents/openai.yaml` if a skill description changes.
7. Update the upstream commit SHA in this file when source content changes.
8. Validate all OpenAI-derived skills:

```bash
for skill in skill-creator gh-address-comments figma figma-implement-design figma-create-design-system-rules; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

9. Compile or test bundled scripts when they change. For example:

```bash
python3 -m py_compile ~/.pi/agent/skills/gh-address-comments/scripts/fetch_comments.py
```

10. Scan changed files for literal home paths and secret values before committing.

## Foundational skill caution

`skill-creator` defines the local expectations for skill structure, frontmatter, bundled resources, and `agents/openai.yaml`. Update it carefully, validate it first, then use the updated version to validate the rest of the skill set.
