# Figma Implementation Notes

Use the [implementation root](../SKILL.md) for the required workflow and completion checks. Load the sections below only for the selected input or implementation issue.

## URL and Desktop Inputs

For a remote MCP request, extract the file key and node ID from the supplied frame or layer link. The client uses these identifiers; it does not browse the Figma page.

Example URL:

```text
https://figma.com/design/ExampleFileKey/DesignSystem?node-id=42-15
```

- File key: `ExampleFileKey`, the segment after `/design/`.
- Node ID: `42-15`, the `node-id` query value. Use the argument format accepted by the connected tool.
- Confirm that the link identifies the intended component, frame, and variant rather than a neighboring layer.

A remote call has this shape; use the connected server's schema for exact arguments:

```text
get_design_context(fileKey="ExampleFileKey", nodeId="42-15")
```

With `figma-desktop`, the server uses the open Figma file, so `fileKey` is not passed. A supplied node ID selects a node in that file. If the user requests the current selection without a URL, the desktop app must be open with the intended node selected. Remote MCP does not support this selection-only route; request a frame or layer link instead.

## Worked Examples

These examples illustrate implementation decisions after obtaining the evidence required by the root. They do not replace that workflow.

### Button Variant

Request: implement the button at the example URL above.

Inspect the existing button component before adding a new component. If its API supports the design, add or reuse a variant rather than duplicating the button. Map the design's colors to project tokens such as `primary-500` and `primary-hover`. Use the supplied button icon from the assets endpoint.

Compare padding, border radius, typography, and icon alignment against the reference. Exercise the requested hover, active, disabled, and focus states using the project's test conventions.

### Dashboard with Large Context

Request: build a dashboard frame whose context response is truncated.

Use the root's metadata recovery path to identify the header, sidebar, content area, and card node IDs. Fetch the needed sections separately. Keep the full-frame screenshot for overall layout comparison and fetch section screenshots where details need closer inspection.

Build with the project's layout primitives and existing card or navigation components. Check how constraints affect sidebar collapse, card wrapping, and content width. If the supplied design does not establish a material responsive decision, use an existing project convention or ask rather than inventing a new interaction.

## Visual Parity and Project Conventions

- Compare each implemented section during development, not only the completed page. This makes spacing or typography differences easier to locate.
- Read Auto Layout, constraints, sizing, typography, component variants, and spacing from structured context; use the screenshot to check the combined result.
- Prefer an existing component or token when it represents the same design intent. A similar name alone is not evidence of a match.
- Follow existing component directories, naming, exports, styling, and documentation practices. Do not impose a new language, type system, or comment format.
- Record necessary departures from the design, especially accessibility fixes or technical limits. Explain the reason in the project's normal documentation or final report.

## Troubleshooting

| Symptom | Response |
| --- | --- |
| Context is incomplete | Use the metadata recovery path in the root. Reduce each fetch to the relevant child nodes instead of repeating the oversized request. |
| Implementation looks different | Compare side by side with the screenshot. Check structured spacing, font metrics, colors, and sizing before changing unrelated styles. |
| Image or SVG fails to load | Verify that the MCP assets endpoint is reachable from the consuming environment. Use the supplied URL without rewriting it; a localhost URL refers to the machine serving the assets. Report access failures rather than replacing the asset. |
| Tokens differ from Figma values | Prefer the project's established tokens. Make minimal spacing or sizing adjustments for fidelity and record material visual differences. |
| MCP is unavailable | Use the base skill's [setup and troubleshooting reference](../../figma/references/figma-mcp-config.md). Do not implement from guessed design data. |

## External References

- [Figma MCP Server Documentation](https://developers.figma.com/docs/figma-mcp-server/)
- [Figma MCP Server Tools and Prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- [Figma Variables and Design Tokens](https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma)
