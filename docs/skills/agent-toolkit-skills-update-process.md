# Updating agent-toolkit skills

Purpose: keep the skills imported from `softaworks/agent-toolkit` aligned with upstream while preserving local OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/softaworks/agent-toolkit
- Current upstream commit checked locally: `3027f20f31816a7c66e5290c0bc62e9294c8d974`

| Local skill | Upstream path |
| --- | --- |
| `session-handoff` | `skills/session-handoff/SKILL.md` plus runtime resources |
| `humanizer` | `skills/humanizer/SKILL.md` |

Prefer the `skills/` source paths over generated `dist/plugins/...` copies.

## Local files

- `agent/skills/session-handoff/`: handoff workflow, references, and scripts.
- `agent/skills/humanizer/`: AI-writing cleanup workflow.
- Each skill has local `agents/openai.yaml` UI metadata.

## Session-handoff local overlays

When updating or reinstalling `session-handoff`, apply these local overlays after copying upstream content:

- Handoffs are project-local and platform-neutral: use `<project-root>/handoffs/`, not `.claude/handoffs/` or any other AI-platform-specific directory.
- Runtime scripts must create, list, validate, and check staleness against `<project-root>/handoffs/`. Fallback project-root detection should go up from `handoffs/` to the project root.
- Eval docs must use model capability tiers such as fast/lightweight, balanced, and high-capability. Do not reintroduce Claude-specific model names or Claude Code commands in generic session-handoff eval instructions.
- Keep `results-high-capability-baseline.md` as the neutral baseline name. Do not restore `results-opus-baseline.md` unless a platform-specific eval suite is intentionally added.
- Provider-specific secret detection patterns, such as OpenAI API key regexes, are security checks and may stay.
- Keep the `SKILL.md` maintenance pointer to this file.

For a fresh install or reinstall from upstream, copy the upstream runtime resources first, then immediately apply the overlays above before validation or commit.

## Humanizer local overlays

When updating or reinstalling `humanizer`, keep `README.md` platform-neutral:

- Do not restore Claude Code-only install paths such as `~/.claude/skills`.
- Describe this repo's tracked location as `agent/skills/humanizer/`.
- For installs outside this repo, tell users to copy the skill directory to their agent or harness-supported skill location.
- Keep usage examples agent-neutral.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode/RTK, for example:

```bash
rtk gh api repos/softaworks/agent-toolkit/contents/skills/session-handoff/SKILL.md?ref=main
rtk gh api repos/softaworks/agent-toolkit/contents/skills/humanizer/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders.
4. Copy upstream runtime changes unless they conflict with local Pi routing, mutation safety gates, or OpenAI skill-creator rules.
5. Keep all `SKILL.md` frontmatter limited to `name` and `description`.
6. Preserve local scripts and references that are required by the skill.
7. Regenerate or update `agents/openai.yaml` if a skill description changes.
8. Update the upstream commit SHA in this file when source content changes.
9. Validate both skills:

```bash
for skill in session-handoff humanizer; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

10. Scan changed files for literal home paths and secret values before committing.
