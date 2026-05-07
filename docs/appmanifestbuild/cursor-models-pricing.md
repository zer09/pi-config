# Cursor Cloud Agent Models & Pricing

Source: `GET https://api.cursor.com/v1/models` (live fetch 2026-05-07)

All pricing per 1M tokens. USD.

## Quick Reference (Tier Placement)

| Model ID              | Provider      | Input   | Output  | Tier            | Use Case                   |
| --------------------- | ------------- | ------- | ------- | --------------- | -------------------------- |
| `default`             | Cursor Auto   | $1.25   | $6.00   | Simple/Standard | Auto router, balanced cost |
| `composer-2`          | Cursor        | $0.50   | $2.50   | Simple          | Fast, cheap generation     |
| `composer-1.5`        | Cursor        | $3.50   | $17.50  | Standard        | Mid-range multimodal       |
| `gemini-2.5-flash`    | Google        | $0.30   | $2.50   | Simple          | Cheapest, fast             |
| `gemini-3-flash`      | Google        | $0.50   | $3.00   | Simple          | Fast, reliable             |
| `gemini-3.1-pro`      | Google        | $2.00   | $12.00  | Standard        | Strong general-purpose     |
| `gpt-5.4-nano`        | OpenAI        | $0.20   | $1.25   | Simple          | Ultra-cheap, tiny tasks    |
| `gpt-5.4-mini`        | OpenAI        | $0.75   | $4.50   | Simple          | Cost-effective small       |
| `gpt-5.2`             | OpenAI        | UNKNOWN | UNKNOWN | Standard        | Mid-range, older           |
| `gpt-5.2-codex`       | OpenAI        | UNKNOWN | UNKNOWN | Standard        | Code-focused, older        |
| `gpt-5.1`             | OpenAI        | UNKNOWN | UNKNOWN | Standard        | Older generation           |
| `gpt-5.1-codex-mini`  | OpenAI        | UNKNOWN | UNKNOWN | Simple          | Cheaper older Codex        |
| `gpt-5.1-codex-max`   | OpenAI        | UNKNOWN | UNKNOWN | Complex         | Max context older          |
| `gpt-5.3-codex`       | OpenAI        | UNKNOWN | UNKNOWN | Standard        | Codex mid-tier             |
| `gpt-5.3-codex-spark` | OpenAI        | UNKNOWN | UNKNOWN | Simple          | Spark variant              |
| `gpt-5.4`             | OpenAI        | $2.50   | $15.00  | Complex         | Strong reasoning           |
| `gpt-5.5`             | OpenAI        | $5.00   | $30.00  | Reasoning       | Frontier, expensive        |
| `gpt-5-mini`          | OpenAI        | UNKNOWN | UNKNOWN | Simple          | Mini variant               |
| `claude-haiku-4-5`    | Anthropic     | $1.00   | $5.00   | Simple          | Fast, cheap Claude         |
| `claude-sonnet-4`     | Anthropic     | $3.00   | $15.00  | Standard        | Solid mid-range            |
| `claude-sonnet-4-5`   | Anthropic     | $3.00   | $15.00  | Standard        | Latest Sonnet stable       |
| `claude-sonnet-4-6`   | Anthropic     | $3.00   | $15.00  | Standard        | Latest Sonnet              |
| `claude-opus-4-5`     | Anthropic     | $5.00   | $25.00  | Complex         | High-quality reasoning     |
| `claude-opus-4-6`     | Anthropic     | $5.00   | $25.00  | Complex         | Latest Opus stable         |
| `claude-opus-4-7`     | Anthropic     | $5.00   | $25.00  | Reasoning       | Latest Opus frontier       |
| `grok-4.3`            | xAI           | $1.25   | $2.50   | Standard        | Reasoning-focused          |
| `kimi-k2.5`           | Moonshot/Kimi | UNKNOWN | UNKNOWN | Standard        | Asian provider             |

## Pricing Lookup Details

### Simple Tier (Fast, Cost-Optimized)

Use for: quick edits, rewrites, small tasks, boilerplate.

- `gemini-2.5-flash`: $0.30 / $2.50 ✓ Cheapest
- `gemini-3-flash`: $0.50 / $3.00
- `composer-2`: $0.50 / $2.50 (Cursor native)
- `gpt-5.4-nano`: $0.20 / $1.25 (Ultra-cheap)
- `gpt-5.4-mini`: $0.75 / $4.50
- `claude-haiku-4-5`: $1.00 / $5.00
- `default` (Auto): $1.25 / $6.00 (fallback only)

### Standard Tier (Balanced Quality)

Use for: routine coding, medium generation, test writing.

- `gemini-3.1-pro`: $2.00 / $12.00
- `composer-1.5`: $3.50 / $17.50
- `claude-sonnet-4-6`: $3.00 / $15.00
- `claude-sonnet-4-5`: $3.00 / $15.00
- `claude-sonnet-4`: $3.00 / $15.00
- `grok-4.3`: $1.25 / $2.50 (xAI reasoning)
- `gpt-5.4`: $2.50 / $15.00

### Complex Tier (Deep Analysis)

Use for: multi-file refactors, architecture planning, difficult debugging.

- `gpt-5.4`: $2.50 / $15.00
- `claude-opus-4-7`: $5.00 / $25.00
- `claude-opus-4-6`: $5.00 / $25.00
- `claude-opus-4-5`: $5.00 / $25.00

### Reasoning Tier (Frontier Capabilities)

Use for: design docs, system decomposition, high-stakes decisions.

- `gpt-5.5`: $5.00 / $30.00 (Most expensive)
- `claude-opus-4-7`: $5.00 / $25.00 (Latest)
- `grok-4.3`: $1.25 / $2.50 (Budget reasoning)

## Unknown Pricing

The following models were returned by Cursor but pricing is not documented in accessible Cursor pricing tables. Assume provider rates apply or check Cursor dashboard:

- `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5-mini`
- `kimi-k2.5` (Moonshot)

## Notes

1. **Auto Router (`default`)**: Fixed rate $1.25 input, $6.00 output, $0.25 cache read. Cursor picks model internally.
2. **Thinking/Reasoning variants**: Some models support thinking parameters. Cost may increase when thinking is enabled.
3. **Context/Max Mode**: Some models (Claude Opus, GPT-5.x with context param) charge 2x input beyond 200k tokens.
4. **Cache**: Composer models do not support cache write. Claude/GPT support standard cache pricing.
5. **Fast variants**: Some models (Opus 4.6 Fast, GPT-5 Fast) charge 2x base price for faster inference.
6. **Kimi K2.5**: Regional provider; pricing varies by region/deployment.

## For Manifest Integration

Use the `id` field from each row as the model ID in Manifest custom provider config.

Example:

```json
{
  "id": "gpt-5.5",
  "name": "GPT-5.5 (Cursor)",
  "input": 5.0,
  "output": 30.0,
  "notes": "Frontier, use for reasoning tier only"
}
```

See `/home/gc/.pi/docs/manifest-cursor-provider-template.json` for ready-to-use Manifest config.
