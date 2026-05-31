---
name: intent-layer
description: "Set up hierarchical Intent Layer documentation with root and child AGENTS.md files. Use when initializing AI-friendly project context, adding or auditing AGENTS.md/CLAUDE.md infrastructure, making agents understand a codebase, or finding context-node candidates."
---

# Intent Layer

Set up hierarchical project context so agents navigate codebases like senior engineers.

## Core principles

- Keep only one root context file: `AGENTS.md` or `CLAUDE.md`, not both at project root.
- Prefer `AGENTS.md` for this Pi setup unless an existing project convention or user instruction requires `CLAUDE.md`.
- Use child `AGENTS.md` files for complex subsystems, responsibility boundaries, and hidden contracts.
- Do not create context files for every directory, simple utilities, or simple test folders.
- Treat existing project instructions as authoritative. Preserve local safety, routing, and mutation gates.

## Example read-only prompt

Use this prompt to try the skill without modifying files:

```text
Use intent-layer to detect the Intent Layer state for this repo and suggest candidate AGENTS.md nodes. Do not edit files yet.
```

## Workflow

1. Detect state:

```text
scripts/detect_state.sh /path/to/project
```

Return state is `none`, `partial`, or `complete`.

2. Route:

- `none` or `partial`: initial setup.
- `complete`: maintenance mode.

3. Measure before editing:

```text
scripts/analyze_structure.sh /path/to/project
scripts/estimate_tokens.sh /path/to/each/source/dir
```

Show the measurement table before proposing nodes.

4. Decide:

- No root file: ask whether to create `AGENTS.md` or `CLAUDE.md`.
- Existing root file: add an Intent Layer section and child nodes only where useful.
- Existing root `AGENTS.md`: do not create root `CLAUDE.md` unless the user explicitly asks.

5. Execute:

- Use `references/templates.md` for root and child structure.
- Use `references/node-examples.md` for concise real-world patterns.
- Use native file read/edit/write tools for project file changes.
- Validate one root file, a read-first directive, relative downlinks, and target nodes under 4k tokens.

6. Maintain when state is `complete`:

Ask which mode to run:

- Audit nodes with `references/capture-protocol.md`.
- Find candidates by re-measuring token counts and boundaries.
- Do both.

## When to create child nodes

| Signal | Action |
|---|---|
| Directory exceeds ~20k tokens | Create or propose child `AGENTS.md` |
| Responsibility shift | Create child `AGENTS.md` |
| Hidden contracts or invariants | Document in nearest ancestor |
| Cross-cutting concern | Place at lowest common ancestor |

## Capture questions

When documenting existing code, ask:

1. What does this area own, and what is out of scope?
2. What invariants must never be violated?
3. What repeatedly confuses new engineers or agents?
4. What patterns should always be followed?
5. What looks deprecated, surprising, or safe to change but is not?

## Resource routing

- Scripts are measurement helpers. Run them through Context Mode when output may exceed 20 lines.
- `references/templates.md`: read before creating or editing root/child context files.
- `references/node-examples.md`: read when examples or compression patterns are needed.
- `references/capture-protocol.md`: read for SME interviews, audits, or maintenance mode.

## Maintenance

Update from `https://github.com/crafter-station/skills/tree/main/context-engineering/intent-layer` using `../../../docs/skills/intent-layer-update-process.md`.
