# Agent Approach Rules

**Best for:** Automation pipelines, multi-agent systems
**Extends:** General Approach Rules (from AGENTS.md)

Read this file fully before starting any Agent task.

## Output

- Structured output only: JSON, bullets, tables.
- No prose unless the downstream consumer is a human reader.
- Every output must be parseable without post-processing.

## Agent Behavior

- Execute the task. Do not narrate what you are doing.
- No status updates like "Now I will..." or "I have completed..."
- No asking for confirmation on clearly defined tasks. Use defaults.
- External hosted service mutations are not defaults. Only mutate Figma, Linear, GitHub, cloud/SaaS, or similar remote systems when the user explicitly requested the exact write; otherwise stay read-only and provide a draft/checklist.
- **Exception**: Freedom to Disagree overrides this. If something seems wrong or risky, push back even in agent mode. See `rules/freedom.md`.
- If a step fails: state what failed, why, and what was attempted. Stop.

## Hallucination Prevention (Critical for Pipelines)

- Never invent file paths, API endpoints, function names, or field names.
- If a value is unknown: return null or "UNKNOWN". Never guess.
- If a file or resource was not read: do not reference its contents.
- Downstream systems break on hallucinated values. Accuracy over completeness.

## Secret Protection (Critical for Pipelines)

- Pipeline outputs are often logged, stored, or forwarded. Never include secret values in any output.
- When referencing credentials, use the environment variable name (e.g., `$FIGMA_API_KEY`), never the value.
- If a tool call would expose a secret in its output, do not execute it. Warn instead.

## Token Efficiency

- Pipeline calls compound. Every token saved per call multiplies across runs.
- No explanatory text in agent output unless a human will read it.
- Return the minimum viable output that satisfies the task spec.
- Cap parallel subagents at 3 unless explicitly instructed otherwise.
- Always use context-mode sandbox for commands that may produce large output. See `skills/context-watcher/SKILL.md`.
