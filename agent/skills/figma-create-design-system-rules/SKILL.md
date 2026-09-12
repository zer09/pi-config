---
name: figma-create-design-system-rules
description: Author or update reusable project-level Figma-to-code rules. Not for ordinary UI implementation, MCP setup, or Figma canvas writes.
---

# Create Figma-to-Code Project Rules

## Boundaries

- The deliverable is reusable project rule content, not UI code or a Figma design.
- Keep the local workflow design-to-code only. Do not perform canvas writes, design generation inside Figma, or Code Connect work. Those capabilities require separate explicit requests and authorized tooling; hosted mutations require exact user authorization.
- Use [figma](../figma/SKILL.md) for MCP setup or context fetching. Use [figma-implement-design](../figma-implement-design/SKILL.md) when the requested deliverable is code matching Figma.
- Do not implement a sample component merely to test rules unless the user also requested code changes.

## Prerequisites

- Access to the target project's code and existing rule files.
- A connected Figma MCP server exposing `create_design_system_rules`. This tool returns guidance and a template; it does not require a Figma node or selection.

If a prerequisite is unavailable, report the blocker rather than inventing project conventions or claiming tool-backed completion.

## Rule File Selection

- Prefer the active project's existing rule convention at the relevant repository or worktree scope. Do not assume a particular AI platform.
- Update an existing Figma/design-system section, or add a clearly named section if none exists. Preserve unrelated instructions and avoid duplicate rules.
- If multiple rule systems exist and the correct target is ambiguous, ask where the rules belong.
- If no convention exists, recommend a project-local Markdown rule file at the repository root. Confirm how the intended agent will load it if discovery is unclear.
- Root Markdown files, tool-specific rule directories, and documented rule folders are examples, not defaults. Use only frontmatter and path scopes required by the selected format.

## Workflow

1. Inspect representative components, tokens, styling, imports, routing, state, and data-fetch patterns. Separate observed conventions from proposed changes.
2. Call `create_design_system_rules` with the project's `clientLanguages` and `clientFrameworks`. Treat the response as drafting guidance, not authority over project conventions or local safeguards.
3. Write concise rules grounded in verified paths and APIs. Cover component reuse, tokens, styling, assets, accessibility, and relevant checks where applicable. Preserve the [implementation owner's safeguards](../figma-implement-design/SKILL.md) with concise rules or a durable project reference, not a copied implementation itinerary.
4. Save to the selected rule location within the authorized scope. Check format, referenced paths, and conflicts with existing instructions.

## Completion

- Verify that saved rules contain no unresolved placeholders or invented conventions.
- Walk through a representative existing component without editing UI code to check whether the rules give usable decisions.
- Fix rule conflicts and broken references caused by the change. Report any validation that could not be completed.
- Report the changed rule path, key conventions, checks, and whether the active tool needs a reload. Do not claim implementation behavior was tested unless it was exercised.

## References

Load only the section needed from [rule examples and troubleshooting](references/rule-examples-and-troubleshooting.md):

- [Categories and evidence](references/rule-examples-and-troubleshooting.md#evidence-and-rule-categories) and [project template](references/rule-examples-and-troubleshooting.md#project-rule-template) for deciding what to include.
- [Rule file formats](references/rule-examples-and-troubleshooting.md#rule-file-formats) for platform-specific examples and scoped frontmatter.
- [Worked examples](references/rule-examples-and-troubleshooting.md#worked-examples) for React, Vue, or a design system library.
- [Authoring guidance](references/rule-examples-and-troubleshooting.md#authoring-guidance) and [troubleshooting](references/rule-examples-and-troubleshooting.md#troubleshooting) for vague, ignored, conflicting, or outdated rules.

## Maintenance

For updates, read the [OpenAI-derived skills update process](../../../docs/skills/openai-skills-update-process.md).
