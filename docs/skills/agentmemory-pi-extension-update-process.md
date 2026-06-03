# AgentMemory Pi extension skill update process

Use this document when updating the bundled `agentmemory` skill or AgentMemory skill metadata inside the Pi-native AgentMemory extension.

The full extension upgrade process lives in:

```text
agent/extensions/agentmemory/docs/agentmemory-upgrade-process.md
```

This document covers the Local Skill maintenance layer for the bundled extension skill at:

```text
agent/extensions/agentmemory/skills/agentmemory/
```

## Classification

Classification: `keep it`.

Reason: AgentMemory encodes custom local memory tooling, cross-session provenance workflows, and Pi-specific safety gates that are not generic base-model behavior.

## Bundled extension skill rule

A Bundled Extension Skill is still a Local Skill for maintenance purposes unless an explicit repo policy says otherwise. Preserve these metadata requirements:

- `SKILL.md` frontmatter has only `name` and `description`.
- `agents/openai.yaml` exists.
- `interface.default_prompt` mentions `$agentmemory`.
- `interface.short_description` is 25-64 characters.
- `SKILL.md` stays compact and points here through a lightweight `## Maintenance` section.

Do not copy the eight upstream AgentMemory task skills into Pi by default. Keep one Pi-specific `agentmemory` skill and fold in only concise triggers or routing that preserve local safety policy.

## Update workflow

1. Read `docs/skills/README.md`.
2. Read `docs/skills/local-skill-update-invariants.md`.
3. Read `docs/skills/skill-slimming-process.md`.
4. Read `agent/extensions/agentmemory/docs/agentmemory-upgrade-process.md`.
5. Compare upstream AgentMemory skill or integration changes only as input.
6. Keep the Pi-native curated tool surface, secret refusal, redaction, delegate-child skip, and prompt-review boundary.
7. Update this bundled skill only when visible tool routing, safety gates, or maintenance metadata change.
8. Update `docs/skills/installed-skills-trim-verdict.md` if the skill classification changes.

## Validation

Target skill validation:

```bash
uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/extensions/agentmemory/skills/agentmemory
```

All normal Local Skills validation:

```bash
for skill_dir in agent/skills/*; do
  test -f "$skill_dir/SKILL.md" || continue
  uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1
done
```

AgentMemory extension validation when tool surface or wrapper docs change:

```bash
cd agent/extensions/agentmemory
npm test
npm run check:sync -- --upstream <agentmemory-upstream>
```

Before finishing, check changed files for literal home paths, secret-looking values, stale update-doc references, and generated caches.
