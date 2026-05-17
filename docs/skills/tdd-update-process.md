# Updating the tdd skill

Purpose: keep `agent/skills/tdd` aligned with Matt Pocock's upstream TDD skill while preserving local Pi metadata and skill maintenance conventions.

## Source of truth

- Upstream repository: https://github.com/mattpocock/skills
- Upstream skill directory: `skills/engineering/tdd`
- Upstream files to check:
  - `SKILL.md`
  - `deep-modules.md`
  - `interface-design.md`
  - `mocking.md`
  - `refactoring.md`
  - `tests.md`
- Current upstream `main` commit checked locally: `e74f0061bb67222181640effa98c675bdb2fdaa7`

## Local file model

- `agent/skills/tdd/SKILL.md`: red-green-refactor workflow and TDD rules.
- `agent/skills/tdd/deep-modules.md`: deep module guidance for TDD.
- `agent/skills/tdd/interface-design.md`: interface design guidance.
- `agent/skills/tdd/mocking.md`: mocking guidance.
- `agent/skills/tdd/refactoring.md`: refactoring guidance.
- `agent/skills/tdd/tests.md`: behavior-focused test guidance.
- `agent/skills/tdd/agents/openai.yaml`: UI metadata only. Keep deterministic and minimal.

## Update workflow for a future agent

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example `rtk gh api repos/mattpocock/skills/contents/skills/engineering/tdd/SKILL.md?ref=main`.
3. Compare upstream files with local files.
4. Copy upstream runtime changes unless they conflict with local Pi routing or safety rules.
5. Keep `SKILL.md` frontmatter limited to `name` and `description`.
6. Keep the local maintenance pointer in `SKILL.md`.
7. Keep `agents/openai.yaml` valid YAML with only `display_name`, `short_description`, and `default_prompt` unless UI assets are intentionally installed.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/tdd`.
10. Run a local scan for accidental extra frontmatter fields, literal home paths, and secret values.

## Validation checklist

- `agent/skills/tdd/SKILL.md` exists and references this update process.
- `agent/skills/tdd/deep-modules.md` exists.
- `agent/skills/tdd/interface-design.md` exists.
- `agent/skills/tdd/mocking.md` exists.
- `agent/skills/tdd/refactoring.md` exists.
- `agent/skills/tdd/tests.md` exists.
- `agent/skills/tdd/agents/openai.yaml` exists and parses as YAML.
- No file contains a literal local home path or secret value.
