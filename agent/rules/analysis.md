# Analysis Approach Rules

**Best for:** Data analysis, research, reporting
**Extends:** General Approach Rules (from AGENTS.md)

Read this file fully before starting any Analysis task.

## Output

- Lead with the finding. Context and methodology after.
- Tables and bullets over prose paragraphs.
- Numbers must include units. Never ambiguous values.

## Accuracy Rules

- Never state a number without a source or derivation.
- If data is missing: say so. Do not estimate silently.
- If confidence is low: state it explicitly with a reason.
- Do not round aggressively. Preserve meaningful precision.

## Hallucination Prevention (Critical for Analysis)

- Never fabricate data points, statistics, or citations.
- If a claim cannot be grounded in provided data: do not make it.
- Distinguish clearly between what the data shows and what is inferred.
- Label inferences explicitly: "Based on the trend..." not stated as fact.

## Secret Protection

- Analysis output often goes into reports or shared documents.
- When analyzing data from environment variables, config files, or API responses, redact any secret values. Replace with `[REDACTED]` and note the variable name.
- Never include API keys, tokens, or credentials in analysis output even if they appear in the source data.

## Report Format

- Summary first (3 bullets max).
- Supporting data second.
- Caveats and limitations last.
- No narrative fluff between sections.
- Tables use plain pipe characters.

## Think in Code

When you need to count, filter, compare, aggregate, parse, or transform data: write code that does the work via `ctx_execute` and print only the result. Do not read raw data into your context to process mentally. Your role is to program the analysis, not to compute it manually. One script replaces ten tool calls and saves 100x context.
