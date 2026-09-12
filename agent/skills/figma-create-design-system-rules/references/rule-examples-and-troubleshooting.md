# Rule Examples and Troubleshooting

Use these templates and examples only when they match inspected project conventions. Replace example paths and placeholders before saving rules.

## Evidence and Rule Categories

| Category | Inspect | Useful rule content |
| --- | --- | --- |
| Component discovery | Existing UI, feature, and layout directories | Exact component paths and when to reuse or extend them |
| Tokens and styling | CSS variables, theme files, framework configuration | Token sources, spacing and typography scales, styling approach |
| Component patterns | Representative components and exports | Existing naming, composition, props, and export conventions |
| Architecture | Imports, aliases, routing, state, and data fetching | Relevant project patterns, without imposing a new architecture |
| Assets | Public assets, import handling, image wrappers | Where supplied Figma assets belong and how the runtime loads them |
| Validation | Tests, stories, accessibility checks | Project commands and states that verify Figma-derived UI |

Include only categories that help this project. Types, JSDoc, memoization, directory layouts, or documentation formats are not universal requirements.

## Project Rule Template

Use the MCP tool's response as drafting guidance, then adapt the structure to the project. Do not copy paths or requirements that the codebase does not support.

```markdown
# Figma-to-Code Project Rules

## Components

- Reuse UI components from `[COMPONENT_PATH]` when they represent the design intent.
- Place new components in `[COMPONENT_DIRECTORY]`.
- Follow `[NAMING_AND_EXPORT_CONVENTION]`.

## Styling

- Use `[STYLING_APPROACH]`.
- Import colors, spacing, and typography from `[TOKEN_LOCATION]`.
- Use `[LAYOUT_PRIMITIVES]` for page structure.

## Assets

- Store supplied Figma assets in `[ASSET_DIRECTORY]` using `[ASSET_IMPORT_CONVENTION]`.

## Project Validation

- Run `[RELEVANT_PROJECT_CHECKS]`.
- Verify `[PROJECT_ACCESSIBILITY_REQUIREMENTS]`.
```

Add a concise Figma integration policy derived from the [implementation owner's workflow and safeguards](../../figma-implement-design/SKILL.md). Preserve its evidence gate, truncation recovery, hosted-service boundary, asset requirements, and completion checks without copying the full itinerary.

If the project uses a shared policy reference instead of inline safeguards, verify that the intended agent can load that reference. A link to a skill in this installation is not automatically portable to another project or harness.

## Rule File Formats

These are examples, not default targets. The active project's convention determines the file and format.

| Existing convention | Example location | Format concern |
| --- | --- | --- |
| Root Markdown instructions | `AGENTS.md` or another established root rule file | Add or update a named section; preserve unrelated instructions |
| Tool-specific rule directory | `.cursor/rules/figma.mdc` | Use only the metadata supported by that tool |
| Documented project rules | `docs/rules/figma.md` | Verify how the intended agent discovers or loads the file |

For a format that supports scoped frontmatter, a rule might start like this:

```markdown
---
description: Project conventions for Figma-derived UI.
globs: "src/components/**"
alwaysApply: false
---

# Figma-to-Code Rules
```

Do not add this frontmatter to plain Markdown instructions unless the active tool requires it. Adjust globs to the real implementation directories. If a format accepts arrays, multiple scopes might be `src/components/**` and `src/pages/**`; verify the tool's syntax before writing them.

## Worked Examples

These examples show project-specific additions, not complete rule files. Combine relevant additions with the shared safeguards described above. Validate rules through a read-only walkthrough unless the user also requested implementation.

### React and Tailwind

For a verified React project, the MCP call can be:

```text
create_design_system_rules(clientLanguages="typescript,javascript", clientFrameworks="react")
```

After confirming the paths and Tailwind configuration, useful project rules could be:

```markdown
- Reuse UI components from `src/components/ui/`.
- Page components live in `src/app/`.
- Use Tailwind utilities and the color tokens in `tailwind.config.js`.
- Store static Figma assets in `public/assets/`.
```

Walk through an existing button: can the rules identify its variant API, color tokens, icon source, and relevant checks without inventing a second button component?

### Vue and Custom CSS

For a verified Vue project, the call can be:

```text
create_design_system_rules(clientLanguages="typescript,javascript", clientFrameworks="vue")
```

If inspection confirms Vue 3 Composition API and CSS Modules, useful additions could be:

```markdown
- Components live in `src/components/`; reusable composables live in `src/composables/`.
- Follow existing Vue SFC and Composition API patterns instead of copying generated React code.
- Use CSS Modules for component styles.
- Use the color, spacing, and typography variables in `src/styles/tokens.css`.
```

Check an existing card to ensure these rules describe the actual project. Do not mix scoped-style and CSS Modules requirements unless the project uses both deliberately.

### Design System Library

For a TypeScript React library:

```text
create_design_system_rules(clientLanguages="typescript", clientFrameworks="react")
```

If a monorepo already has component, token, and documentation packages, rules could be:

```markdown
- Components live in `packages/design-system/src/components/`.
- Export public components from `packages/design-system/src/index.ts`.
- Import tokens from `packages/tokens/src/`.
- Follow the existing component story and test file layout.
- Document supported variants and accessibility behavior in `packages/docs/`.
```

Check that each referenced package exists. Do not require Storybook, a particular test runner, or a new documentation format merely because an example uses one.

## Authoring Guidance

- Start with conventions that prevent observed mistakes. Add detail when the project needs it, not to fill every template category.
- Prefer an actionable path and API over a slogan: name the existing button component and supported variants instead of saying only "use the design system."
- State what to use, not only what to avoid. Point to the token source rather than forbidding every literal value without an alternative.
- Explain non-obvious constraints briefly. For example, a server-component data-fetch rule should identify the project boundary it protects.
- Distinguish existing conventions from proposed changes. Ask when a proposal would materially change architecture or the rule-loading target.
- Use the project's accessibility requirements. Accessible names, keyboard behavior, focus, and contrast are more useful checks than requiring an `aria-label` on every element.

## Troubleshooting

| Problem | Response |
| --- | --- |
| Rules are ignored | Verify discovery, file scope, and whether the agent needs a reload. Replace vague instructions with concrete paths and decisions; capitalization alone does not ensure compliance. |
| Rules conflict | Compare existing instructions and their precedence. Update the relevant section rather than appending a competing rule; ask if the intended convention is ambiguous. |
| Too much rule text | Keep frequently needed decisions inline. Move detailed variants into references that the target agent can load on demand. |
| Rules are outdated | Recheck paths, tokens, and examples when project architecture changes. Update only the affected conventions. |
| MCP is unavailable | Use the base skill's [setup reference](../../figma/references/figma-mcp-config.md). Report the missing prerequisite instead of claiming tool-backed completion. |
| Validation would require UI changes | Describe the untested behavior. Use [figma-implement-design](../../figma-implement-design/SKILL.md) only if the user also requested that implementation. |

## External References

- [Figma MCP Server Documentation](https://developers.figma.com/docs/figma-mcp-server/)
- [Figma Variables and Design Tokens](https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma)
