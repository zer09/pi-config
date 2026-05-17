# Updating the refine-linear-task skill

Purpose: keep `agent/skills/refine-linear-task` aligned with Uniswap's `refine-linear-task` skill while preserving local Pi routing, Linear mutation gates, and OpenAI skill-creator frontmatter rules.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/Uniswap/ai-toolkit
- Upstream branch: `next`
- Upstream skill directory: `packages/plugins/uniswap-integrations/skills/refine-linear-task`
- Upstream runtime file to check:
  - `SKILL.md`
- Current upstream `next` commit checked locally: `c4c6369f7e15e6e247f18be0e1f7c17e71bd1c38`

## Local file model

- `agent/skills/refine-linear-task/SKILL.md`: compact local instructions and safety rules. Keep frontmatter limited to `name` and `description`.
- `agent/skills/refine-linear-task/agents/openai.yaml`: UI metadata only. Keep deterministic and minimal.

## Update workflow for a future agent

1. Load `skill-creator`, `gh-cli`, and `linear-cli`, then read this file.
2. Fetch upstream with authenticated `gh` CLI through Context Mode/RTK, for example `rtk gh api repos/Uniswap/ai-toolkit/contents/packages/plugins/uniswap-integrations/skills/refine-linear-task/SKILL.md?ref=next`.
3. Compare upstream `SKILL.md` with local `SKILL.md`.
4. Preserve useful upstream workflow content: gap analysis, codebase research, refined-description structure, focus areas, and update phase.
5. Keep local `SKILL.md` concise. Preserve local rules requiring `linear-cli`, file-based markdown flags, codebase research through code-review-graph/Context Mode, Linear mutation gating, and no scope expansion without assumptions.
6. Keep `SKILL.md` frontmatter limited to `name` and `description`; do not copy upstream extra metadata such as `allowed-tools`.
7. Keep `agents/openai.yaml` valid YAML with only `display_name`, `short_description`, and `default_prompt` unless additional UI assets are intentionally installed.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/refine-linear-task`.
10. Run a local scan for accidental extra frontmatter fields, literal home paths, and secret values.

## Validation checklist

- `agent/skills/refine-linear-task/SKILL.md` exists and references this update process.
- `agent/skills/refine-linear-task/SKILL.md` has only `name` and `description` in frontmatter.
- `agent/skills/refine-linear-task/agents/openai.yaml` exists and parses as YAML.
- The skill requires explicit user authorization before any Linear update.
- No file contains a literal local home path or secret value.
