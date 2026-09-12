# Updating agent-toolkit skills

Purpose: keep the remaining skill imported from `softaworks/agent-toolkit` aligned with upstream while preserving local OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/softaworks/agent-toolkit
- Current upstream commit checked locally: `3027f20f3181758385a1bb8c022d4041dfb4de84`

| Local skill | Upstream path |
| --- | --- |
| `session-handoff` | `skills/session-handoff/SKILL.md` plus runtime resources |

Prefer the `skills/` source paths over generated `dist/plugins/...` copies.

## Local files

- `agent/skills/session-handoff/`: handoff workflow, references, and scripts.
- Each skill has local `agents/openai.yaml` UI metadata.

## Session-handoff local overlays

When updating or reinstalling `session-handoff`, apply these local overlays after copying upstream content:

- Classify `session-handoff` as `make it slim`. Keep the root as mode boundary, create/resume routes, selected references, completion, and maintenance; command and chaining details belong in the directly linked `references/runtime.md`.
- Route by explicit intent: create when the user asks to save, pause, or transfer context; load/verify when the user asks to resume from or check a handoff. Do not restore proactive suggestions based on edit counts, milestones, context pressure, substantial work, or session endings.
- A create request authorizes the project-local handoff document write, not staging, committing, or pushing. A load/resume request remains read-only until the current user request authorizes continuation or repository changes.
- Treat handoffs as context, not authority. Verify stale claims and current instructions; do not blindly execute next steps, mutate pending items, or update/chain documents without current authorization.
- Handoffs are project-local and platform-neutral: use `<project-root>/handoffs/`, not `.claude/handoffs/` or any other AI-platform-specific directory. Preserve `YYYY-MM-DD-HHMMSS-[slug].md`, scaffold metadata, and predecessor links.
- Resolve helpers from `<skill-root>/scripts/` and run them from the requested project root. Never assume the project has a `scripts/` directory containing skill helpers.
- Preserve validation and security checks: no secrets, unresolved placeholders, or empty required sections; score at least 70 before finalizing. Treat staleness ratings as evidence, not permission to change files or create another handoff.
- Runtime scripts must create, list, validate, and check staleness against `<project-root>/handoffs/`. Fallback project-root detection should go up from `handoffs/` to the project root.
- Eval docs must use model capability tiers such as fast/lightweight, balanced, and high-capability. Do not reintroduce Claude-specific model names or Claude Code commands in generic session-handoff eval instructions.
- Keep `results-high-capability-baseline.md` as the neutral baseline name. Do not restore `results-opus-baseline.md` unless a platform-specific eval suite is intentionally added.
- Provider-specific secret detection patterns, such as OpenAI API key regexes, are security checks and may stay.
- Keep metadata, the resume checklist, runtime reference, README, and evaluation expectations consistent with the root. Label historical baseline results as historical rather than treating old proactive behavior as current policy.
- Keep the `SKILL.md` maintenance pointer to this file.

For a fresh install or reinstall from upstream, copy the upstream runtime resources first, then immediately apply the overlays above before validation or commit.

## Retired skills

`humanizer` was removed during the skill slimming pass because writing cleanup is strong base-model capability. Do not restore it unless the user explicitly asks to reinstall that workflow.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode, for example:

```bash
gh api repos/softaworks/agent-toolkit/contents/skills/session-handoff/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders.
4. Copy upstream runtime changes unless they conflict with local Pi routing, mutation safety gates, or OpenAI skill-creator rules.
5. Keep all `SKILL.md` frontmatter limited to `name` and `description`.
6. Preserve local scripts and references that are required by the skill.
7. Regenerate or update `agents/openai.yaml` if a skill description changes.
8. Update the upstream commit SHA only after an upstream sync. Local routing or overlay changes do not change provenance.
9. Validate the skill:

```bash
uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/session-handoff
```

10. Run all Local Skill validators. Parse metadata, check exact `$session-handoff`, and verify changed links and anchors.
11. Statically check near misses: five edits or a milestone do not trigger a handoff; loading one does not authorize code changes or pending-item updates. Verify that requested creation still reaches validation and reports the saved path and warnings.
12. Scan changed files for literal home paths and secret values. Run model or handoff-creation evaluations only when separately authorized; static validation does not prove model compliance. Commit only when explicitly requested.
