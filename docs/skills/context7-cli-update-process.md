# Updating the Context7 CLI skill

Purpose: keep `agent/skills/context7-cli` aligned with the Context7 upstream skill while preserving local OpenAI skill-creator conventions.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Source of truth

- Upstream repository: https://github.com/upstash/context7
- Upstream skill path: `skills/context7-cli/SKILL.md`
- Current upstream commit checked locally: `7e956e594584db4b1b66a3a4a07781e92b4d7e45`
- Upstream default branch checked locally: `master`
- Local CLI version checked locally during slimming: `0.4.4`

## Local files

- `agent/skills/context7-cli/SKILL.md`: Context7 CLI workflow.
- `agent/skills/context7-cli/references/`: runtime references.
- `agent/skills/context7-cli/agents/openai.yaml`: local UI metadata.

## Local safety rule

Context7 docs lookup is read-only, but login/logout, setup/remove, skill install/remove/generate, and upgrade commands change local auth state, config, installed skills, global packages, or remote state. Require exact explicit user instruction before running those mutating commands. Never print or document Context7 API keys, OAuth tokens, cookies, or generated config secrets.

## Slimming policy

Keep `SKILL.md` concise. Runtime guidance should contain only command boundaries, safety gates, reference navigation, common docs workflow, gotchas, and the maintenance pointer. Keep longer command details in `references/`. Do not reintroduce install/upgrade instructions that imply global package mutation should happen automatically.

## Update workflow

1. Load `skill-creator` and `gh-cli`, then read this file.
2. Fetch upstream with authenticated `gh` CLI through Context Mode/RTK:

```bash
rtk gh api repos/upstash/context7/contents/skills/context7-cli/SKILL.md?ref=master
```

3. Compare upstream runtime files with local skill files, and inspect local `ctx7 --help` for new commands or changed flags.
4. Copy upstream runtime changes unless they conflict with local Pi routing, mutation safety gates, or OpenAI skill-creator rules.
5. Keep frontmatter limited to `name` and `description`.
6. Keep placeholder secrets as placeholders such as `<api-key>`, never realistic token examples.
7. Regenerate or update `agents/openai.yaml` if the skill description changes.
8. Update the upstream commit SHA, default branch if changed, and local CLI version in this file when source or observed CLI behavior changes.
9. Validate:

```bash
uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/context7-cli
```

10. Scan changed files for literal home paths and secret values before committing.
