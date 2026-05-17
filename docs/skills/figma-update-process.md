# Updating the Figma skill set

Purpose: keep the local Figma design-to-code skills aligned with OpenAI's curated skills while preserving this user's workflow: inspect Figma and implement code, but do not push designs into Figma by default.

## Source of truth

- OpenAI skills repo: https://github.com/openai/skills
- Root Figma skill: `skills/.curated/figma`
- Design-to-code skill: `skills/.curated/figma-implement-design`
- Design system rules skill: `skills/.curated/figma-create-design-system-rules`

## Local skill set

Keep these active:

- `agent/skills/figma`: lightweight Figma MCP setup/context helper.
- `agent/skills/figma-implement-design`: main design-to-code workflow.
- `agent/skills/figma-create-design-system-rules`: project-specific Figma-to-code rules.

Do not install or auto-enable these unless the user explicitly changes their workflow:

- `figma-create-new-file`: creates Figma or FigJam files.
- `figma-generate-design`: builds or updates screens inside Figma.
- `figma-generate-library`: builds or updates design system libraries inside Figma.
- `figma-use`: direct Figma canvas/plugin API writes.
- `figma-code-connect-components`: Code Connect mappings. This is useful only when the user wants Figma Dev Mode mappings, not for visual alignment by itself.

## Update workflow for a future agent

1. Load `skill-creator` and `gh-cli`.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example `rtk gh api repos/openai/skills/contents/skills/.curated/figma/SKILL.md?ref=main`.
3. Update `SKILL.md` files from the OpenAI source of truth, but keep frontmatter limited to `name` and `description`. Remove `disable-model-invocation: false`; false is the default.
4. Keep the root `figma` skill boundary that Figma writes are not allowed unless the user explicitly requests the exact Figma mutation.
5. Copy only text resources needed by these skills: `SKILL.md`, `agents/openai.yaml`, and references. Do not copy binary assets unless the UI metadata also references them and they are required.
6. Keep `agents/openai.yaml` deterministic and minimal: `display_name`, `short_description`, `default_prompt`, and the Figma MCP dependency are enough.
7. Preserve this file and update the source list if the maintained skill set changes.
8. Validate each changed skill with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py <skill-dir>`.
9. Run a local scan for accidental false-default metadata and missing expected files.

## Validation checklist

- `agent/skills/figma/SKILL.md` exists and references this update process.
- `agent/skills/figma/references/figma-mcp-config.md` exists.
- `agent/skills/figma/references/figma-tools-and-prompts.md` exists.
- `agent/skills/figma-implement-design/SKILL.md` has no `disable-model-invocation: false` field.
- `agent/skills/figma-create-design-system-rules/SKILL.md` has no `disable-model-invocation: false` field.
- `agent/skills/figma-code-connect` is absent unless the user explicitly requests Code Connect support.
- No file contains a literal local home path or secret value.
