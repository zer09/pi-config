# Figma MCP tools and prompt patterns

Quick reference for the Figma MCP toolset, when to use each tool, and prompt examples to steer output toward your stack.

## Core tools

- `get_design_context` (Figma Design, Figma Make): primary tool. Returns structured design data and default generated code. Selection-based prompting works on desktop; the remote server uses a frame or layer link to extract the node ID.
- `get_variable_defs` (Figma Design): lists variables/styles such as colors, spacing, and typography used in the selection. Use this to align with tokens.
- `get_metadata` (Figma Design): sparse XML outline of layer IDs, names, types, positions, and sizes. Use before re-calling `get_design_context` on large nodes to avoid truncation.
- `get_screenshot` (Figma Design, FigJam): screenshot of the selection for visual fidelity checks.
- `get_figjam` (FigJam): XML and screenshots for FigJam diagrams, architecture, and flows.
- `create_design_system_rules` (no file context): generates a rule file with design-to-code guidance for your stack. Save it where the agent can read it.
- `get_code_connect_map` (Figma Design): returns mapping of Figma node IDs to code components. Use only when Code Connect context is needed for component reuse.
- `add_code_connect_map` (Figma Design): adds or updates a mapping between a Figma node and a code component. This mutates Figma metadata; do not call it unless the user explicitly requests that exact update.
- `get_strategy_for_mapping` (alpha, local only): Figma-prompted tool to decide mapping strategy for connecting a node to a code component.
- `send_get_strategy_response` (alpha, local only): sends the response after `get_strategy_for_mapping`.
- `whoami` (remote only): returns the authenticated Figma user identity, plans, and seat types.

## Prompt patterns: design context

- Change framework: "generate my Figma selection in Vue", "in plain HTML and CSS", or "for iOS".
- Use my components: "generate my Figma selection using components from `src/components/ui`".
- Combine: "generate my Figma selection using components from `src/ui` and style with Tailwind".
- Note: on the remote server, selection-based prompting requires a frame or layer link; the server extracts the node ID from the URL.

## Prompt patterns: variables and styles

- "get the variables used in my Figma selection"
- "what color and spacing variables are used in my Figma selection?"
- "list the variable names and values used in my Figma selection"

## Prompt patterns: Code Connect

- "show the code connect map for this selection"
- "map this node to `src/components/ui/Button.tsx` with name `Button`"

## Best-practice flow reminder

Use `get_design_context`, optionally `get_metadata` for large nodes, then `get_screenshot`, and keep project rules from `SKILL.md` in mind when applying the generated output.
