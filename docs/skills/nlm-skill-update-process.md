# Updating the nlm-skill skill

Purpose: keep `agent/skills/nlm-skill` aligned with the upstream NotebookLM MCP CLI skill data while keeping the local skill token-friendly and compliant with the OpenAI skill-creator spec.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/jacob-bd/notebooklm-mcp-cli
- Source directory: `src/notebooklm_tools/data`
- Upstream files to check:
  - `SKILL.md`
  - `AGENTS_SECTION.md`
  - `references/command_reference.md`
  - `references/workflows.md`
  - `references/troubleshooting.md`
- Current upstream source version used locally: `0.6.10`

## Local file model

- `agent/skills/nlm-skill/SKILL.md`: compact trigger, safety, tool-selection, quick workflows, and reference map. Keep it under 500 lines.
- `agent/skills/nlm-skill/references/command_reference.md`: full command signatures and options from upstream.
- `agent/skills/nlm-skill/references/workflows.md`: full workflow sequences from upstream.
- `agent/skills/nlm-skill/references/troubleshooting.md`: troubleshooting from upstream.
- `agent/skills/nlm-skill/references/agents-section.md`: upstream AGENTS.md snippet adapted for local formatting.
- `agent/skills/nlm-skill/agents/openai.yaml`: UI metadata only. Regenerate if the skill trigger intent changes.

## Update workflow for a future agent

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream source files with authenticated `gh` CLI through Context Mode/RTK, for example `rtk gh api repos/jacob-bd/notebooklm-mcp-cli/contents/src/notebooklm_tools/data/SKILL.md?ref=main`.
3. Compare upstream files with local files. Prefer updating reference files from upstream instead of expanding `SKILL.md`.
4. Keep `SKILL.md` frontmatter limited to `name` and `description`. Do not add upstream metadata such as `version`; track source versions in this file instead.
5. Keep local safety rules in `SKILL.md`: NotebookLM and Google hosted changes are external hosted service mutations, deletes require explicit confirmation, secrets/cookies must not be printed, and `nlm chat start` must not be used by agents.
6. Copy upstream command/reference changes into `references/` when they are runtime-relevant. Keep long command signatures out of `SKILL.md`.
7. Keep `agents/openai.yaml` deterministic and minimal: `display_name`, `short_description`, `default_prompt`, and the NotebookLM MCP dependency are enough.
8. Update the source version in this file when upstream changes.
9. Validate with `uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/nlm-skill`.
10. Run a local scan for accidental extra frontmatter fields, literal home paths, and secret values.

## Validation checklist

- `agent/skills/nlm-skill/SKILL.md` has only `name` and `description` in frontmatter.
- `agent/skills/nlm-skill/SKILL.md` references this update process.
- `agent/skills/nlm-skill/references/command_reference.md` includes current command options, including `nlm research import --cited-only` for source version `0.6.10`.
- `agent/skills/nlm-skill/references/workflows.md` exists.
- `agent/skills/nlm-skill/references/troubleshooting.md` exists.
- `agent/skills/nlm-skill/references/agents-section.md` exists.
- `agent/skills/nlm-skill/agents/openai.yaml` exists.
- No file contains a literal local home path or secret value.
