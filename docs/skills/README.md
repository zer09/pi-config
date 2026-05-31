# Skill maintenance docs

Centralized maintenance notes for local Pi skills.

When the user asks to update any skill, first read `local-skill-update-invariants.md`, then read `skill-slimming-process.md`, then read the relevant update-process document. Updating a skill means syncing from upstream, classifying whether to keep/slim/remove it, and reapplying local invariants before validation. Upstream content is input, not final truth.

## How to ask an agent to update skills

Use one of these prompts:

```text
Update the <skill-name> skill. Follow docs/skills/README.md and apply local-skill-update-invariants.md and skill-slimming-process.md before and after syncing upstream.
```

```text
Update all local skills. Start with docs/skills/README.md, apply local-skill-update-invariants.md and skill-slimming-process.md, then use each relevant update-process doc. Preserve local invariants and validate everything before committing.
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
Install the <skill-name> skill. Follow docs/skills/README.md, apply local-skill-update-invariants.md and skill-slimming-process.md, add or update the relevant docs/skills update-process doc, and validate all skills before committing.
```

For an upstream skill:

```text
Install the <skill-name> skill from <upstream repo/url>. Treat upstream as input, preserve local invariants, apply the skill slimming process, add agents/openai.yaml, add a maintenance pointer, document the update process in docs/skills, and validate all skills.
```

For a custom local skill:

```text
Create a custom local skill for <purpose>. Use skill-creator, follow local-skill-update-invariants.md, keep SKILL.md compact, add agents/openai.yaml, and document any future maintenance guidance in docs/skills.
```

Installing a new skill means:

1. Read this README.
2. Read `local-skill-update-invariants.md`.
3. Read `skill-slimming-process.md`.
4. Load `skill-creator`.
5. Classify the skill as `keep it`, `make it slim`, or `remove it`.
6. Add the skill under `agent/skills/<skill-name>/`.
7. Normalize `SKILL.md` frontmatter to only `name` and `description`.
8. Add `agents/openai.yaml`.
9. Add hosted-service safety gates if relevant.
10. Keep `SKILL.md` under 500 lines where practical.
11. Move long examples, command catalogs, and troubleshooting into `references/`.
12. Add a lightweight `## Maintenance` pointer in `SKILL.md`.
13. Add or update a `docs/skills/*-update-process.md` document.
14. Update `docs/skills/installed-skills-trim-verdict.md` when the installed-skill inventory changes.
15. Update this README.
16. Validate all skills before committing.

## Update documents

- `local-skill-update-invariants.md`: canonical local overlays and validation checks that apply to every skill update or install.
- `skill-slimming-process.md`: repeatable keep/slim/remove process for skill updates and installs.
- `installed-skills-trim-verdict.md`: tracked inventory of installed skill slimming decisions.
- `agent-toolkit-skills-update-process.md`: update workflow for the remaining softaworks agent-toolkit skills.
- `astral-python-tools-update-process.md`: update workflow for Astral uv, Ruff, and ty skills.
- `chrome-devtools-skills-update-process.md`: update workflow for Chrome DevTools MCP skills.
- `context7-cli-update-process.md`: update workflow for the Context7 CLI skill.
- `custom-local-skills-update-process.md`: update workflow for custom Local Skills such as context-watcher and codegraph.
- `firebase-skills-update-process.md`: update workflow for Firebase and Genkit skills.
- `gh-cli-update-process.md`: update workflow for the generated GitHub CLI skill and its command references.
- `grill-with-docs-usage.md`: usage reference for initializing CONTEXT.md and applying ADR guidance in other repos.
- `intent-layer-update-process.md`: update workflow for the Crafter Station Intent Layer skill.
- `linear-cli-update-process.md`: update workflow for the Linear CLI skill.
- `mattpocock-skills-update-process.md`: update workflow for the remaining Matt Pocock engineering skills.
- `minimax-cli-update-process.md`: retired-skill notes and reinstall checklist for the former MiniMax CLI skill.
- `nlm-skill-update-process.md`: update workflow for the NotebookLM CLI and MCP skill.
- `notion-cli-update-process.md`: retired-skill notes and reinstall checklist for the former Notion CLI skill.
- `openai-skills-update-process.md`: update workflow for OpenAI-derived skills, including skill-creator, Figma skills, and gh-address-comments.
- `planetscale-database-skills-update-process.md`: update workflow for PlanetScale MySQL and Postgres skills.
- `refine-linear-task-update-process.md`: retired-skill notes and reinstall checklist for the former Linear task refinement skill.

## Retired skills

These runtime skills were removed during the skill slimming pass because their workflows are strong base-model capabilities, overlap with remaining tools, or are not worth a dedicated runtime skill in this setup:

- `edge-case-analysis`
- `humanizer`
- `refine-linear-task`
- `mmx-cli`
- `notion-cli`
- `tdd`
- `understand`, `understand-chat`, `understand-dashboard`, `understand-diff`, `understand-domain`, `understand-explain`, `understand-knowledge`, `understand-onboard`

Do not restore retired skills unless the user explicitly asks for that workflow again.

Keep long-lived update process docs here for discovery. Skill folders should contain only runtime skill instructions, references needed during skill use, and lightweight pointers to these docs.
