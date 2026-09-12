---
name: figma
description: Set up or troubleshoot Figma MCP, or fetch design context, screenshots, variables, and assets. Not for UI implementation or project rule authoring.
---

# Figma MCP

Base context and connection support for the local design-to-code skill set.

## Boundaries

- Keep Figma access read-only. Canvas writes, design generation inside Figma, variable or library updates, and Code Connect work require a separate explicit request and authorized tooling. Hosted mutations require exact user authorization.
- Keep credentials out of output and saved files. Change local MCP configuration only when requested.

## Route the Request

- **Setup or troubleshooting:** read [MCP configuration](references/figma-mcp-config.md) for connection, authentication, and verification details.
- **Context, screenshots, variables, or assets:** read [tools and prompt patterns](references/figma-tools-and-prompts.md) for the selected read-only operation.
- **Code matching Figma:** use [figma-implement-design](../figma-implement-design/SKILL.md). It owns the required evidence gate, implementation decisions, and validation; do not implement from this base skill alone.
- **Reusable project rules:** use [figma-create-design-system-rules](../figma-create-design-system-rules/SKILL.md), not the implementation workflow.

For context-only work, return the requested evidence and identify missing data or access blockers. Do not invent unavailable design details.

## Maintenance

For updates, read the [OpenAI-derived skills update process](../../../docs/skills/openai-skills-update-process.md).
