# Updating the improve-codebase-architecture skill

Purpose: keep `agent/skills/improve-codebase-architecture` aligned with Matt Pocock's upstream skill while preserving local Pi metadata and skill maintenance conventions.

## Source of truth

- Upstream repository: https://github.com/mattpocock/skills
- Upstream skill directory: `skills/engineering/improve-codebase-architecture`
- Upstream files to check:
  - `SKILL.md`
  - `DEEPENING.md`
  - `INTERFACE-DESIGN.md`
  - `LANGUAGE.md`
- Current upstream `main` commit checked locally: `e74f0061bb67222181640effa98c675bdb2fdaa7`

## Local file model

- `agent/skills/improve-codebase-architecture/SKILL.md`: workflow for finding architecture deepening opportunities.
- `agent/skills/improve-codebase-architecture/DEEPENING.md`: deep module and deepening guidance.
- `agent/skills/improve-codebase-architecture/INTERFACE-DESIGN.md`: interface design guidance.
- `agent/skills/improve-codebase-architecture/LANGUAGE.md`: architecture vocabulary.
- `agent/skills/improve-codebase-architecture/agents/openai.yaml`: UI metadata only. Keep deterministic and minimal.

## Update workflow for a future agent

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example `rtk gh api repos/mattpocock/skills/contents/skills/engineering/improve-codebase-architecture/SKILL.md?ref=main`.
3. Compare upstream `SKILL.md`, `DEEPENING.md`, `INTERFACE-DESIGN.md`, and `LANGUAGE.md` with local files.
4. Copy upstream runtime changes unless they conflict with local Pi routing or safety rules.
5. Keep `SKILL.md` frontmatter limited to `name` and `description`.
6. Keep the local maintenance pointer in `SKILL.md`.
7. Keep `agents/openai.yaml` valid YAML with only `display_name`, `short_description`, and `default_prompt` unless UI assets are intentionally installed.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/improve-codebase-architecture`.
10. Run a local scan for accidental extra frontmatter fields, literal home paths, and secret values.

## Validation checklist

- `agent/skills/improve-codebase-architecture/SKILL.md` exists and references this update process.
- `agent/skills/improve-codebase-architecture/DEEPENING.md` exists.
- `agent/skills/improve-codebase-architecture/INTERFACE-DESIGN.md` exists.
- `agent/skills/improve-codebase-architecture/LANGUAGE.md` exists.
- `agent/skills/improve-codebase-architecture/agents/openai.yaml` exists and parses as YAML.
- No file contains a literal local home path or secret value.
