# Skill maintenance docs

Centralized maintenance notes for local Pi skills.

When the user asks to update any skill, first read `local-skill-update-invariants.md`, then read the relevant update-process document. Updating a skill means syncing from upstream and then reapplying local invariants before validation. Upstream content is input, not final truth.

## How to ask an agent to update skills

Use one of these prompts:

```text
Update the <skill-name> skill. Follow docs/skills/README.md and apply local-skill-update-invariants.md before and after syncing upstream.
```

```text
Update all local skills. Start with docs/skills/README.md, apply local-skill-update-invariants.md, then use each relevant update-process doc. Preserve local invariants and validate everything before committing.
```

Examples:

```text
Update the Firebase skills from upstream and preserve local invariants.
```

```text
Update the OpenAI-derived skills, including skill-creator and Figma, using docs/skills/README.md.
```

```text
Update gh-cli from local gh help, keep SKILL.md compact, and validate all skills.
```

You do not need to restate every invariant in the prompt. The invariant doc is the contract.

## How to ask an agent to install new skills

Use one of these prompts:

```text
Install the <skill-name> skill. Follow docs/skills/README.md, apply local-skill-update-invariants.md, add or update the relevant docs/skills update-process doc, and validate all skills before committing.
```

For an upstream skill:

```text
Install the <skill-name> skill from <upstream repo/url>. Treat upstream as input, preserve local invariants, add agents/openai.yaml, add a maintenance pointer, document the update process in docs/skills, and validate all skills.
```

For a custom local skill:

```text
Create a custom local skill for <purpose>. Use skill-creator, follow local-skill-update-invariants.md, keep SKILL.md compact, add agents/openai.yaml, and document any future maintenance guidance in docs/skills.
```

Installing a new skill means:

1. Read this README.
2. Read `local-skill-update-invariants.md`.
3. Load `skill-creator`.
4. Add the skill under `agent/skills/<skill-name>/`.
5. Normalize `SKILL.md` frontmatter to only `name` and `description`.
6. Add `agents/openai.yaml`.
7. Add hosted-service safety gates if relevant.
8. Keep `SKILL.md` under 500 lines where practical.
9. Move long examples, command catalogs, and troubleshooting into `references/`.
10. Add a lightweight `## Maintenance` pointer in `SKILL.md`.
11. Add or update a `docs/skills/*-update-process.md` document.
12. Update this README.
13. Validate all skills before committing.

## Update documents

- `local-skill-update-invariants.md`: canonical local overlays and validation checks that apply to every skill update or install.
- `agent-toolkit-skills-update-process.md`: update workflow for softaworks agent-toolkit skills.
- `astral-python-tools-update-process.md`: update workflow for Astral uv, Ruff, and ty skills.
- `chrome-devtools-skills-update-process.md`: update workflow for Chrome DevTools MCP skills.
- `context7-cli-update-process.md`: update workflow for the Context7 CLI skill.
- `firebase-skills-update-process.md`: update workflow for Firebase and Genkit skills.
- `gh-cli-update-process.md`: update workflow for the generated GitHub CLI skill and its command references.
- `grill-with-docs-usage.md`: usage reference for initializing CONTEXT.md and applying ADR guidance in other repos.
- `linear-cli-update-process.md`: update workflow for the Linear CLI skill.
- `mattpocock-skills-update-process.md`: update workflow for Matt Pocock engineering skills.
- `minimax-cli-update-process.md`: update workflow for the MiniMax CLI skill.
- `nlm-skill-update-process.md`: update workflow for the NotebookLM CLI and MCP skill.
- `openai-skills-update-process.md`: update workflow for OpenAI-derived skills, including skill-creator, Figma skills, and gh-address-comments.
- `planetscale-database-skills-update-process.md`: update workflow for PlanetScale MySQL and Postgres skills.
- `refine-linear-task-update-process.md`: update workflow for the Linear task refinement skill.

Keep long-lived update process docs here for discovery. Skill folders should contain only runtime skill instructions, references needed during skill use, and lightweight pointers to these docs.
