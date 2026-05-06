# Coding Approach Rules

**Best for:** Dev projects, code review, debugging, refactoring
**Extends:** General Approach Rules (from AGENTS.md) AND Agent Approach Rules (from `rules/agent.md`)

Read this file AND `rules/agent.md` fully before starting any Coding task. Where Coding rules and Agent rules differ, Coding rules win.

## Output

- Return code first. Explanation after, only if non-obvious.
- No inline prose. Use comments sparingly - only where logic is unclear.
- No boilerplate unless explicitly requested.

## Code Rules

- Simplest working solution. No over-engineering.
- No abstractions for single-use operations.
- No speculative features or "you might also want..."
- Read the file before modifying it. Never edit blind.
- No docstrings or type annotations on code not being changed.
- No error handling for scenarios that cannot happen.
- Three similar lines is better than a premature abstraction.

## Review Rules

- State the bug. Show the fix. Stop.
- No suggestions beyond the scope of the review.
- No compliments on the code before or after the review.

## Debugging Rules

- Never speculate about a bug without reading the relevant code first.
- State what you found, where, and the fix. One pass.
- If cause is unclear: say so. Do not guess.
- Code output must be copy-paste safe.

## Secret Protection (Critical for Code)

- Never hardcode secrets, API keys, tokens, or passwords in source code. Use environment variables or secret management.
- If you find a hardcoded secret during review, flag it as a critical issue.
- When writing example code that references credentials, use placeholder names like `$YOUR_API_KEY` or `process.env.API_KEY`, never actual values.
- Before committing, verify that no secrets are in the staged diff. If found, unstage and warn.
