# Figma MCP tools and prompt patterns

Select the read-only tool needed for the requested evidence. Generated context is design data, not authorization to edit repository code.

## Core tools

- `get_design_context` (Figma Design, Figma Make): primary tool. Returns structured design data and default generated code. Selection-based prompting works on desktop; the remote server uses a frame or layer link to extract the node ID.
- `get_variable_defs` (Figma Design): lists variables/styles such as colors, spacing, and typography used in the selection. Use this to align with tokens.
- `get_metadata` (Figma Design): sparse XML outline of layer IDs, names, types, positions, and sizes. Use before re-calling `get_design_context` on large nodes to avoid truncation.
- `get_screenshot` (Figma Design, FigJam): screenshot of the selection for visual fidelity checks.
- `get_figjam` (FigJam): XML and screenshots for FigJam diagrams, architecture, and flows.
- `whoami` (remote only): returns the authenticated Figma user identity, plans, and seat types. Do not expose private account details in reports.

## Assets

The MCP server provides an assets endpoint for images and SVGs. For asset-only requests, retrieve the supplied sources without modifying their URLs. A localhost source must be reachable from the consuming environment. Report unavailable assets rather than substituting placeholders.

## Adjacent Workflows

- `create_design_system_rules` returns guidance and a template, without requiring file context. Use [figma-create-design-system-rules](../../figma-create-design-system-rules/SKILL.md) to author and save project rules.
- Code Connect tools are outside this context skill. `get_code_connect_map` reads mappings; `add_code_connect_map` changes Figma metadata. The local-only alpha tools `get_strategy_for_mapping` and `send_get_strategy_response` also belong to that separate capability. Do not enter a mapping workflow without a separate explicit request and authorized tooling.

## Prompt patterns: design context

- Change framework: "generate my Figma selection in Vue", "in plain HTML and CSS", or "for iOS".
- Use my components: "generate my Figma selection using components from `src/components/ui`".
- Combine: "generate my Figma selection using components from `src/ui` and style with Tailwind".
- Note: on the remote server, selection-based prompting requires a frame or layer link; the server extracts the node ID from the URL.

## Prompt patterns: variables and styles

- "get the variables used in my Figma selection"
- "what color and spacing variables are used in my Figma selection?"
- "list the variable names and values used in my Figma selection"

## Code Deliverables

For repository implementation, load [figma-implement-design](../../figma-implement-design/SKILL.md). Its root is the authoritative location for the evidence gate and implementation workflow; context fetching alone does not complete that workflow.
