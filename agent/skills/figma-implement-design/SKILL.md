---
name: figma-implement-design
description: Implement repository UI from a Figma node, URL, or supported desktop selection. Use when the deliverable is code matching Figma, not MCP setup, project rule authoring, or canvas writes.
---

# Implement Figma Design

## Boundaries

- This skill owns UI implementation in the user's repository. The local Figma skill set is design-to-code only.
- Do not perform Figma canvas writes, design generation inside Figma, or Code Connect work as part of implementation. Those capabilities require separate explicit requests and authorized tooling; hosted mutations require exact user authorization.
- For MCP setup or context-only requests, use [figma](../figma/SKILL.md).
- For reusable project rule authoring, use [figma-create-design-system-rules](../figma-create-design-system-rules/SKILL.md).

## Required Context Workflow

Before editing code or downloading implementation assets:

1. Confirm MCP access and the intended node or variant. Remote calls need a supplied file key and node ID, usually from a URL. A supported desktop server can use a node in the open file or the user's current selection. Ask if the target is missing or ambiguous.
2. Run `get_design_context` for the target. If context is too large or truncated, run `get_metadata` for the node map, then re-fetch only the required child nodes with `get_design_context`.
3. Run `get_screenshot` for the same target and variant. Keep this visual reference available during implementation.

Proceed only after obtaining both `get_design_context` and `get_screenshot` for the intended design. If access or required evidence is unavailable, report the blocker rather than guessing.

## Implementation Decisions

- Inspect the project's components, tokens, and rule files before making implementation choices. Reuse or extend suitable components instead of duplicating them.
- Treat MCP output, often React and Tailwind, as design and behavior data, not final code style. Translate it into the project's framework and styling conventions.
- Map colors, typography, and spacing to project tokens. When values differ, prefer established tokens and make minimal spacing or sizing adjustments for fidelity. Record material deviations.
- Preserve existing component locations, naming, routing, state management, and data-fetch patterns.
- Use supplied Figma images, icons, and SVGs. Use returned localhost asset sources directly without modification. Do not substitute placeholders or add icon packages when the payload provides the asset; fetch missing assets or report the gap.

## Completion Checklist

- [ ] Layout, spacing, sizing, typography, and colors match the screenshot, except for explained deviations.
- [ ] Behavior and interactive states work as designed, including hover, active, disabled, and focus states where applicable.
- [ ] Responsive states follow Figma constraints and supplied variants.
- [ ] Supplied assets render correctly, with no unresolved asset failures.
- [ ] Accessibility checks cover semantics, accessible names, keyboard use, focus, and contrast.
- [ ] Relevant project checks pass; failures caused by the change are fixed within scope.

Report changed paths, checks, and any justified deviations or blocked checks. Do not claim completion when required validation remains unavailable.

## References

Load only the section needed:

- [URL parsing and desktop inputs](references/implementation-notes.md#url-and-desktop-inputs) for target selection and call arguments.
- [Worked examples](references/implementation-notes.md#worked-examples) for button reuse and dashboard decomposition.
- [Visual parity guidance](references/implementation-notes.md#visual-parity-and-project-conventions) for interpreting design data and documenting deviations.
- [Troubleshooting](references/implementation-notes.md#troubleshooting) for incomplete context, visual differences, assets, or token conflicts.

## Maintenance

For updates, read the [OpenAI-derived skills update process](../../../docs/skills/openai-skills-update-process.md).
