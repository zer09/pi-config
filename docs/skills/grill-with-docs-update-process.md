# Updating the grill-with-docs skill

Purpose: keep `agent/skills/grill-with-docs` aligned with Matt Pocock's upstream skill while preserving local Pi skill metadata and this repo's documentation setup.

## Source of truth

- Upstream repository: https://github.com/mattpocock/skills
- Upstream skill directory: `skills/engineering/grill-with-docs`
- Upstream files to check:
  - `SKILL.md`
  - `CONTEXT-FORMAT.md`
  - `ADR-FORMAT.md`
- Current upstream `main` commit checked locally: `e74f0061bb67222181640effa98c675bdb2fdaa7`

## Local file model

- `agent/skills/grill-with-docs/SKILL.md`: grilling workflow and documentation behavior.
- `agent/skills/grill-with-docs/CONTEXT-FORMAT.md`: format for project language docs.
- `agent/skills/grill-with-docs/ADR-FORMAT.md`: format for architectural decision records.
- `agent/skills/grill-with-docs/agents/openai.yaml`: UI metadata only. Keep deterministic and minimal.

## Update workflow for a future agent

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example `rtk gh api repos/mattpocock/skills/contents/skills/engineering/grill-with-docs/SKILL.md?ref=main`.
3. Compare upstream `SKILL.md`, `CONTEXT-FORMAT.md`, and `ADR-FORMAT.md` with local files.
4. Copy upstream runtime changes unless they conflict with local Pi routing or safety rules.
5. Keep `SKILL.md` frontmatter limited to `name` and `description`.
6. Keep `agents/openai.yaml` valid YAML with only `display_name`, `short_description`, and `default_prompt` unless UI assets are intentionally installed.
7. Update the upstream commit SHA in this file when source content changes.
8. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/grill-with-docs`.
9. Run a local scan for accidental extra frontmatter fields, literal home paths, and secret values.

## Repo setup guidance

- Single-context repos use one root `CONTEXT.md`.
- Multi-context repos use a root `CONTEXT-MAP.md` that points to each bounded context's `CONTEXT.md`.
- ADRs live in `docs/adr/` and should be created only when a decision is hard to reverse, surprising without context, and the result of a real trade-off.
- Do not create empty ADR directories or placeholder ADRs just for setup.

## Validation checklist

- `agent/skills/grill-with-docs/SKILL.md` exists.
- `agent/skills/grill-with-docs/CONTEXT-FORMAT.md` exists.
- `agent/skills/grill-with-docs/ADR-FORMAT.md` exists.
- `agent/skills/grill-with-docs/agents/openai.yaml` exists and parses as YAML.
- Root `CONTEXT.md` exists for this repo unless a `CONTEXT-MAP.md` replaces it.
- No file contains a literal local home path or secret value.
