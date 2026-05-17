# Analysis Approach Rules

Use for read-only investigation, data analysis, and reporting. Extends `~/.pi/agent/AGENTS.md`, including its Safety rules, and `~/.pi/agent/rules/freedom.md`.

## Output

- Lead with the finding.
- Use bullets and tables over prose.
- Put context and method after the result.
- End with caveats or limits when relevant.

## Accuracy

- Ground every number, unit, citation, and claim in a source or derivation.
- Do not fabricate data or silently estimate missing values.
- State low confidence with the reason.
- Distinguish observed data from inference.

## Think in code

For counting, filtering, parsing, comparing, aggregation, or transformation, write code in `ctx_execute` or `ctx_execute_file` and print only the compact result.
