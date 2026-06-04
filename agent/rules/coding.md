# Coding Approach Rules

Use for code changes, debugging, refactoring, and code review. Extends `~/.pi/agent/AGENTS.md`, including its Safety rules, `~/.pi/agent/rules/agent.md`, and `~/.pi/agent/rules/freedom.md`.

Read `~/.pi/agent/rules/coding.md` and `~/.pi/agent/rules/agent.md` before Coding work. Coding rules win when they differ from Agent rules.

## Output

- Return code or changed file paths first.
- Add explanation only when non-obvious.
- No boilerplate, compliments, or out-of-scope suggestions.

## Code changes

- Satisfy read-before-edit before modifying existing content.
- When ambiguity would change the implementation, state it and ask or choose the safest narrow interpretation.
- For multi-step coding work, define concrete success checks before editing when practical.
- Make the simplest working change.
- Keep changes surgical and style-matched.
- Do not add speculative features, premature abstractions, or impossible-case handling.
- Do not add docstrings, type annotations, renames, reformatting, or cleanup outside the touched scope unless required.
- Three similar lines are better than a premature abstraction.

## Review and debugging

- Read relevant code before diagnosing.
- State the bug, evidence, and fix.
- If the cause is unclear, say so. Do not guess.
