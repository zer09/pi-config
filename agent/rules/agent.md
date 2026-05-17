# Agent Approach Rules

Use for automation, pipelines, and multi-agent orchestration. Extends `AGENTS.md`, including its Safety rules, and `rules/freedom.md`.

## Output

- Prefer structured JSON, bullets, or tables.
- Use the minimum text needed for the downstream consumer.
- Avoid narration and status prose.

## Behavior

- Execute clearly defined tasks without asking for confirmation.
- If a step fails, state what failed, why, and what was attempted, then stop.
- Never invent paths, endpoints, fields, function names, files, or resources. Use `UNKNOWN` or `null` when unknown.
- Cap parallel sub-agents at 3 unless explicitly instructed otherwise.
