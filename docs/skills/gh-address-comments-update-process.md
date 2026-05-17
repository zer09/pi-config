# Updating the gh-address-comments skill

Purpose: keep `agent/skills/gh-address-comments` aligned with OpenAI's curated `gh-address-comments` skill while preserving local Pi routing, GitHub mutation gates, and OpenAI skill-creator frontmatter rules.

## Source of truth

- OpenAI skills repo: https://github.com/openai/skills
- Upstream skill directory: `skills/.curated/gh-address-comments`
- Upstream runtime files to check:
  - `SKILL.md`
  - `scripts/fetch_comments.py`
  - `agents/openai.yaml`

## Local file model

- `agent/skills/gh-address-comments/SKILL.md`: compact local instructions and safety rules. Keep frontmatter limited to `name` and `description`.
- `agent/skills/gh-address-comments/scripts/fetch_comments.py`: PR comment fetcher copied from upstream.
- `agent/skills/gh-address-comments/agents/openai.yaml`: UI metadata only. Keep deterministic and minimal.

## Update workflow for a future agent

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example `rtk gh api repos/openai/skills/contents/skills/.curated/gh-address-comments/SKILL.md?ref=main`.
3. Compare upstream `scripts/fetch_comments.py` with the local script and copy runtime-relevant changes.
4. Keep local `SKILL.md` concise. Preserve local rules requiring `gh-cli`, Context Mode/RTK for read-only GitHub commands, GitHub mutation gating, and token secrecy.
5. Keep `SKILL.md` frontmatter limited to `name` and `description`; do not copy upstream extra metadata fields.
6. Keep `agents/openai.yaml` valid YAML. The upstream file may include optional icon fields; omit them locally unless the assets are installed too.
7. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/gh-address-comments`.
8. Run a local scan for accidental extra frontmatter fields, literal home paths, and secret values.

## Validation checklist

- `agent/skills/gh-address-comments/SKILL.md` exists and references this update process.
- `agent/skills/gh-address-comments/SKILL.md` has only `name` and `description` in frontmatter.
- `agent/skills/gh-address-comments/scripts/fetch_comments.py` exists.
- `agent/skills/gh-address-comments/agents/openai.yaml` exists and parses as YAML.
- No file contains a literal local home path or secret value.
