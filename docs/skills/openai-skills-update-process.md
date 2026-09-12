# Updating OpenAI skills

Purpose: keep OpenAI-derived local skills aligned with `openai/skills` while preserving local Pi routing, safety gates, and skill-creator compliance.

## Local invariants

Before and after syncing upstream, apply `local-skill-update-invariants.md`. Upstream content is input, not final truth; preserve local safety gates, routing, token footprint, and OpenAI skill compatibility.

## Upstream provenance

- Upstream repository: https://github.com/openai/skills
- Current upstream commit checked locally: `49f948faa9258a0c61caceaf225e179651397431`

| Local skill | Upstream path | Local notes |
| --- | --- | --- |
| `skill-creator` | `skills/.system/skill-creator` | Foundational unified skill. OpenAI is one of two upstreams; follow `skill-creator-update-process.md` and validate this before changing other skills. |
| `figma` | `skills/.curated/figma` | Owns MCP setup, troubleshooting, and context/screenshots/variables/assets fetching, not code implementation. |
| `figma-implement-design` | `skills/.curated/figma-implement-design` | Owns repository UI implementation from a supplied Figma node/URL or supported desktop selection. |
| `figma-create-design-system-rules` | `skills/.curated/figma-create-design-system-rules` | Owns reusable project-level Figma-to-code rule authoring, not ordinary implementation. |

## Local policy

- Keep frontmatter limited to `name` and `description`.
- Keep `agents/openai.yaml` as UI metadata with intentionally required dependencies. Preserve the Figma MCP dependency metadata in all three Figma skills.
- Do not add `disable-model-invocation: false`; false is the default.
- Keep `gh-cli-update-process.md` separate. The local `gh-cli` skill is generated from local `gh help`, not copied from OpenAI.
- Figma, GitHub, and other hosted services remain read-only by default. Exact explicit user instruction is required for mutations.

## Durable Figma overlays

Apply these local overlays after every upstream comparison or sync. [ADR 0020](../adr/0020-gpt-6-astra-skill-maintenance-policy.md) governs the local shape; upstream remains input, not automatic replacement content.

- Preserve the ownership split in the table above across descriptions, roots, and UI metadata. Use short intent-based descriptions with adjacent-skill exclusions, not procedures or broad Figma-topic triggers.
- Keep `figma` a minimal base router. Keep `figma-implement-design` focused on boundaries, the selected MCP/context workflow, implementation decisions, completion checks, and targeted references. Keep the rule-authoring root focused on prerequisites, target selection, authoring, safety, and completion.
- Keep the ordered implementation workflow in one authoritative runtime location: [figma-implement-design/SKILL.md](../../agent/skills/figma-implement-design/SKILL.md). It must require both `get_design_context` and `get_screenshot` before code edits or implementation asset downloads. Truncated context requires metadata and targeted re-fetches.
- Do not duplicate that workflow in the base skill, rule-authoring root, or references. Route to the implementation owner. Generated project rules may summarize its safeguards or use a loadable project reference without copying a long itinerary.
- Preserve component/token reuse, project conventions, supplied Figma assets instead of placeholders or unnecessary icon packages, and validation of look, behavior, responsive states, assets, and accessibility.
- Keep the local Figma set design-to-code only. Reject canvas writes, design generation inside Figma, and Code Connect work unless separately and explicitly requested with authorized tooling. Do not install write-oriented skills such as `figma-use`, `figma-generate-design`, `figma-generate-library`, or `figma-create-new-file` as part of a routine update.
- Keep rule-file selection platform-neutral: prefer the active project's existing convention, preserve unrelated rules, treat platform-specific locations as examples, and ask when the target is ambiguous. Rule authoring does not authorize sample UI implementation or mandatory team sharing.
- Keep roots compact. Move URL parsing, templates, worked examples, explanatory guidance, and troubleshooting into directly linked references. Do not restore marketing prose, generic JSDoc/type mandates, or blanket "Do not skip steps" instructions.
- Keep each metadata default prompt aligned with its owner and mentioning exactly its own `$skill-name`. Preserve valid 25-64 character UI short descriptions; do not impose an arbitrary local cap on skill descriptions.

## Update workflow

1. Load `skill-creator`, then read this file. Load `gh-cli` only when fetching upstream GitHub content or checking command syntax.
2. Fetch upstream files with authenticated `gh` CLI through Context Mode, for example:

```bash
gh api repos/openai/skills/contents/skills/.system/skill-creator/SKILL.md?ref=main
gh api repos/openai/skills/contents/skills/.curated/figma/SKILL.md?ref=main
```

3. Compare upstream runtime files with local skill folders, including `references/`, `scripts/`, and `agents/openai.yaml` where present.
4. Adopt or adapt upstream runtime changes only when they preserve local invariants and the durable overlays above. Reject conflicting routing, duplicated workflows, or weakened safety gates.
5. Keep local maintenance pointers in each `SKILL.md` pointing to this grouped update process.
6. Regenerate or update `agents/openai.yaml` if a skill description changes.
7. Update the upstream commit SHA in this file when source content changes.
8. Validate all OpenAI-derived skills:

```bash
for skill in skill-creator figma figma-implement-design figma-create-design-system-rules; do
  uv run --with pyyaml python ~/.pi/agent/skills/skill-creator/scripts/quick_validate.py ~/.pi/agent/skills/$skill || exit 1
done
```

9. Compile or test bundled scripts when they change.
10. Run all Local Skill validators using `local-skill-update-invariants.md`. Check changed Markdown links, YAML/default prompts, and generated artifacts. Review intended triggers, adjacent-skill near misses, workflow ownership, safety boundaries, and completion; static checks alone do not prove model behavior.
11. Scan changed files for literal home paths and secret values. Commit only when explicitly requested.

## Foundational skill caution

`skill-creator` defines the local expectations for skill structure, frontmatter, bundled resources, evaluation, and `agents/openai.yaml`. It now combines OpenAI scaffolding, Anthropic evaluation principles, and a Pi-native runner. Follow `skill-creator-update-process.md`; do not replace its folder wholesale from OpenAI. Update it carefully, validate it first, then use the updated version to validate the rest of the skill set.
