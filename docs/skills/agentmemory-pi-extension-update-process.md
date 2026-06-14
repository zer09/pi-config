# Retired AgentMemory Pi extension skill

Status: retired during the old pasted-skills re-setup.

## Decision

The Pi-native AgentMemory extension and its bundled `agentmemory` runtime skill are not installed by default in this skill set. Do not copy the old extension, bundled skill, or upstream task skills back into Pi unless the user explicitly asks for AgentMemory again.

Reason: AgentMemory is powerful and policy-sensitive. If restored, it must be a deliberate extension install with a curated tool surface, redaction rules, workflow-state boundaries, and external-integration policy rather than an untracked pasted skill directory.

## Former local files

Former active paths in the old setup:

- `agent/extensions/agentmemory/`
- `agent/extensions/agentmemory/skills/agentmemory/`
- `agent/extensions/agentmemory/docs/agentmemory-upgrade-process.md`

The active skill inventory should not contain `agent/skills/agentmemory/` or a generic AgentMemory MCP server by default.

## Reinstall checklist

If reinstalling later:

1. Read `docs/skills/README.md`, `docs/skills/local-skill-update-invariants.md`, and `docs/skills/skill-slimming-process.md`.
2. Load `skill-creator`.
3. Restore or fetch the AgentMemory extension source deliberately; do not copy old local state, sessions, caches, or databases as part of a skill install.
4. Keep one Pi-specific bundled `agentmemory` skill. Do not copy the upstream task-skill set wholesale.
5. Preserve the secret refusal, redaction, prompt-review boundary, and delegate-child skip behavior.
6. Keep workflow/task-state tools disabled unless a future ADR explicitly adopts AgentMemory as a workflow-state owner.
7. Keep external integrations disabled by default; exports, team/mesh sharing, vision search, generic MCP exposure, and other clients need explicit policy.
8. Keep `SKILL.md` compact, with frontmatter limited to `name` and `description`.
9. Add `agents/openai.yaml` with `default_prompt` mentioning `$agentmemory`.
10. Update `docs/skills/README.md`, `docs/skills/installed-skills-trim-verdict.md`, and AgentMemory ADRs if the extension is restored.
11. Validate the bundled skill with `uv run --with pyyaml python agent/skills/skill-creator/scripts/quick_validate.py agent/extensions/agentmemory/skills/agentmemory` and run extension tests documented by the restored extension.

## Policy notes for any future restore

- Pi plans, handoffs, delegates, and normal agent planning remain the default workflow-state systems unless an ADR says otherwise.
- Do not expose optional AgentMemory external integrations by default.
- Do not print, commit, or document memory contents that contain secrets, cookies, tokens, private keys, OAuth headers, or private local data.
