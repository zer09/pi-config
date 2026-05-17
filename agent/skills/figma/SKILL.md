---
name: figma
description: Use the Figma MCP server to fetch design context, screenshots, variables, and assets from Figma, and to translate Figma nodes into production code. Trigger when a task involves Figma URLs, node IDs, design-to-code implementation, or Figma MCP setup and troubleshooting.
---

# Figma MCP

Use the Figma MCP server for Figma-driven implementation. For setup and debugging details, including env vars, config, and verification, see `references/figma-mcp-config.md`.

## Boundaries

- Use this skill for design-to-code work: inspect Figma, fetch screenshots, fetch variables, fetch assets, and implement code in the repository.
- Do not create or update Figma files, canvas nodes, variables, libraries, or Code Connect mappings unless the user explicitly asks for that exact Figma mutation.
- If the user asks to implement a Figma design in code, load `figma-implement-design` after using this skill for MCP setup/context.
- If the user asks for reusable project rules for Figma-to-code work, load `figma-create-design-system-rules`.

## Figma MCP integration rules

These rules define how to translate Figma inputs into code for this project and must be followed for every Figma-driven code change.

### Required flow

1. Run `get_design_context` first to fetch the structured representation for the exact node or nodes.
2. If the response is too large or truncated, run `get_metadata` to get the high-level node map and then re-fetch only the required nodes with `get_design_context`.
3. Run `get_screenshot` for a visual reference of the node variant being implemented.
4. Only after you have both `get_design_context` and `get_screenshot`, download any assets needed and start implementation.
5. Translate the output, usually React and Tailwind, into this project's conventions, styles, and framework. Reuse the project's color tokens, components, and typography wherever possible.
6. Validate against Figma for 1:1 look and behavior before marking complete.

### Implementation rules

- Treat the Figma MCP output as a representation of design and behavior, not as final code style.
- Replace Tailwind utility classes with the project's preferred utilities or design-system tokens when applicable.
- Reuse existing components, such as buttons, inputs, typography, and icon wrappers, instead of duplicating functionality.
- Use the project's color system, typography scale, and spacing tokens consistently.
- Respect existing routing, state management, and data-fetch patterns already adopted in the repo.
- Strive for 1:1 visual parity with the Figma design. When conflicts arise, prefer design-system tokens and adjust spacing or sizes minimally to match visuals.
- Validate the final UI against the Figma screenshot for both look and behavior.

### Asset handling

- The Figma MCP Server provides an assets endpoint which can serve image and SVG assets.
- If the Figma MCP Server returns a localhost source for an image or SVG, use that image or SVG source directly.
- Do not import or add new icon packages when the asset is available in the Figma payload.
- Do not use or create placeholders if a localhost source is provided.

### Link-based prompting

- The server is link-based: copy the Figma frame or layer link and give that URL to the MCP client when asking for implementation help.
- The client cannot browse the URL but extracts the node ID from the link; always ensure the link points to the exact node or variant you want.

## References

- `references/figma-mcp-config.md`: setup, verification, troubleshooting, and link-based usage reminders.
- `references/figma-tools-and-prompts.md`: tool catalog and prompt patterns for selecting frameworks/components and fetching metadata.
- `../../../docs/skills/figma-update-process.md`: source-of-truth and update workflow for future agents.
